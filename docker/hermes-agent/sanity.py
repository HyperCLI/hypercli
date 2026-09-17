#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread


IMAGE = sys.argv[1] if len(sys.argv) > 1 else "hypercli-hermes:local"
API_KEY = "hermes-image-test-api-key-32-chars"
ROTATED_API_KEY = "hermes-image-test-rotated-api-key-32-chars"
MODEL_KEY = "hermes-image-test-model-key"
PROMPT = "Hermes image contract ping"
REPLY = "Hermes image contract pong"
MODEL = "default-anthropic"
ALLOWED_ORIGIN = "https://agents.example"
TEST_RUN_LABEL = "io.hypercli.hermes-test-run"
TEST_RUN_ID = os.environ.get("HERMES_TEST_RUN_ID", f"local-{uuid.uuid4().hex}")
EXPECTED_RUNTIME_TOOLS = (
    "cc",
    "curl",
    "ffmpeg",
    "git",
    "jq",
    "lsof",
    "make",
    "nano",
    "node",
    "npm",
    "npx",
    "pdftotext",
    "pnpm",
    "python3",
    "rg",
    "sudo",
    "unzip",
    "vim",
    "xxd",
    "yarn",
    "zip",
    "corepack",
    "google-chrome",
    "hypercli-chrome",
    "websockify",
    "x11vnc",
    "Xvfb",
)


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True)


def parse_stdout_json(stdout: str) -> object:
    start = stdout.find("{")
    end = stdout.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise AssertionError(f"stdout did not contain a JSON object: {stdout!r}")
    return json.loads(stdout[start : end + 1])


class ModelHandler(BaseHTTPRequestHandler):
    observed_requests: list[dict[str, object]] = []

    def log_message(self, *_args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/v1/messages":
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        self.observed_requests.append(
            {
                "path": self.path,
                "has_x_api_key": self.headers.get("x-api-key") == MODEL_KEY,
                "anthropic_version": self.headers.get("anthropic-version"),
                "model": payload.get("model"),
                "stream": payload.get("stream"),
                "has_prompt": PROMPT in json.dumps(payload.get("messages", [])),
            }
        )
        if self.headers.get("x-api-key") != MODEL_KEY:
            self.send_error(401)
            return
        if self.headers.get("anthropic-version") != "2023-06-01":
            self.send_error(400)
            return
        if payload.get("model") != MODEL:
            self.send_error(400)
            return
        if PROMPT not in json.dumps(payload.get("messages", [])):
            self.send_error(400)
            return
        if payload.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            events = [
                ("message_start", {"type": "message_start", "message": {"id": "msg_hermes_image_test", "type": "message", "role": "assistant", "content": [], "model": MODEL, "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 4, "output_tokens": 0}}}),
                ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": REPLY}}),
                ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 4}}),
                ("message_stop", {"type": "message_stop"}),
            ]
            for event, data in events:
                self.wfile.write(
                    f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
                )
            self.wfile.flush()
            return
        body = json.dumps(
            {
                "id": "msg_hermes_image_test",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": REPLY}],
                "model": MODEL,
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 4, "output_tokens": 4},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def request_json(url: str, *, bearer: str | None = None, payload: dict | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    data = json.dumps(payload).encode() if payload is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers, data=data), timeout=30) as response:
        return json.load(response)


def request_sse(url: str, *, bearer: str, payload: dict) -> list[tuple[str, dict]]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode(),
    )
    events: list[tuple[str, dict]] = []
    event_name = "message"
    data_lines: list[str] = []
    with urllib.request.urlopen(request, timeout=30) as response:
        for raw_line in response:
            line = raw_line.decode().rstrip("\r\n")
            if line.startswith("event:"):
                event_name = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").lstrip())
            elif not line and data_lines:
                events.append((event_name, json.loads("\n".join(data_lines))))
                event_name = "message"
                data_lines = []
    return events


def request_status(url: str, *, bearer: str) -> int:
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {bearer}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def request_preflight(url: str, *, origin: str) -> tuple[int, str | None]:
    request = urllib.request.Request(
        url,
        method="OPTIONS",
        headers={
            "Access-Control-Request-Method": "GET",
            "Origin": origin,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers.get("Access-Control-Allow-Origin")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Access-Control-Allow-Origin")


def start_container(
    container: str,
    volume: str,
    model_port: int,
    api_key: str,
) -> str:
    run(
        "docker", "run", "-d", "--name", container,
        "--label", f"{TEST_RUN_LABEL}={TEST_RUN_ID}",
        "--add-host", "host.docker.internal:host-gateway",
        "-p", "127.0.0.1::8642",
        "-v", f"{volume}:/home/hermes",
        "-e", f"API_SERVER_KEY={api_key}",
        "-e", f"API_SERVER_CORS_ORIGINS={ALLOWED_ORIGIN}",
        "-e", f"HYPER_AGENTS_API_KEY={MODEL_KEY}",
        "-e", f"HYPER_AGENTS_API_BASE=http://host.docker.internal:{model_port}",
        "-e", "NO_PROXY=localhost,127.0.0.1,host.docker.internal",
        "-e", "no_proxy=localhost,127.0.0.1,host.docker.internal",
        IMAGE,
    )
    port = run("docker", "port", container, "8642/tcp").stdout.strip().rsplit(":", 1)[1]
    base = f"http://127.0.0.1:{port}"
    for _ in range(30):
        try:
            if request_json(f"{base}/health").get("status") == "ok":
                return base
        except Exception:
            time.sleep(1)
    raise AssertionError(run("docker", "logs", container, check=False).stdout)


def main() -> None:
    inspect = json.loads(run("docker", "image", "inspect", IMAGE).stdout)[0]["Config"]
    assert inspect["Entrypoint"] == ["/opt/hypercli-hermes/entrypoint.sh"]
    assert inspect["Cmd"] == ["gateway", "run"]
    assert "8642/tcp" in inspect["ExposedPorts"]
    assert "3000/tcp" in inspect["ExposedPorts"]
    assert inspect["Healthcheck"]["Test"][0] == "CMD-SHELL"
    assert not any(value.startswith("HERMES_DEFAULT_MODEL=") for value in inspect["Env"])
    assert not any(value.startswith("HERMES_MODEL_TRANSPORT=") for value in inspect["Env"])
    assert not any(value.startswith("HERMES_INFERENCE_API_BASE=") for value in inspect["Env"])
    assert "HOME=/home/hermes" in inspect["Env"]
    assert "HERMES_HOME=/home/hermes/.hermes" in inspect["Env"]
    assert "HERMES_WRITE_SAFE_ROOT=/home/hermes" in inspect["Env"]
    assert "HYPER_WORKSPACES_DIR=/home/hermes/shared" in inspect["Env"]
    assert "HYPER_DESKTOP_ENABLED=0" in inspect["Env"]
    assert "HYPER_DESKTOP_PORT=3000" in inspect["Env"]
    assert "HYPER_DESKTOP_GEOMETRY=1280x800x24" in inspect["Env"]
    assert "DISPLAY=:99" in inspect["Env"]

    home_contract = run(
        "docker", "run", "--rm", "--user", "hermes", "--entrypoint", "/bin/sh", IMAGE,
        "-c",
        "printf '%s\n' \"$HOME\" \"$HERMES_HOME\" \"$HYPER_WORKSPACES_DIR\" "
        "$(getent passwd hermes | cut -d: -f6) \"$PWD\"",
    ).stdout.splitlines()
    assert home_contract == [
        "/home/hermes",
        "/home/hermes/.hermes",
        "/home/hermes/shared",
        "/home/hermes",
        "/home/hermes",
    ]

    sudo = run(
        "docker", "run", "--rm", "--user", "hermes", "--entrypoint", "/bin/sh", IMAGE,
        "-c", 'test "$(id -u)" -ne 0 && sudo -n id -u',
    )
    assert sudo.stdout.strip() == "0"

    runtime_tools = run(
        "docker", "run", "--rm", "--user", "hermes", "--entrypoint", "/bin/sh", IMAGE,
        "-c", 'for tool in "$@"; do command -v "$tool" >/dev/null || exit 1; done',
        "hermes-runtime-tools",
        *EXPECTED_RUNTIME_TOOLS,
    )
    assert runtime_tools.returncode == 0

    desktop_enabled = run(
        "docker", "run", "--rm", "-e", "HYPER_DESKTOP_ENABLED=1", IMAGE, "true"
    )
    assert desktop_enabled.returncode == 0

    package_managers = run(
        "docker", "run", "--rm", "--user", "hermes", "--entrypoint", "/bin/sh", IMAGE,
        "-c", "corepack --version && pnpm --version && yarn --version",
    )
    assert package_managers.stdout.splitlines() == ["0.35.0", "11.2.2", "1.22.22"]

    memory_deps = run(
        "docker", "run", "--rm", "--entrypoint", "/opt/hermes/.venv/bin/python", IMAGE,
        "-c",
        "import mem0, qdrant_client; print('mem0/qdrant ok')",
    )
    assert memory_deps.stdout.strip() == "mem0/qdrant ok", (
        memory_deps.stdout,
        memory_deps.stderr,
    )

    mem0_backend_contract = run(
        "docker", "run", "--rm", "--entrypoint", "/opt/hermes/.venv/bin/python", IMAGE,
        "-c",
        "\n".join(
            [
                "import json, sys, types",
                "captured = {}",
                "class Memory:",
                "    @staticmethod",
                "    def from_config(config):",
                "        captured.update(config)",
                "        return object()",
                "sys.modules['mem0'] = types.SimpleNamespace(Memory=Memory)",
                "from plugins.memory.mem0._backend import OSSBackend",
                "OSSBackend({",
                "    'llm': {'provider': 'openai', 'config': {'model': 'default-anthropic'}},",
                "    'embedder': {'provider': 'openai', 'config': {'model': 'unknown'}},",
                "    'vector_store': {'provider': 'qdrant', 'config': {'path': '/tmp/mem0-qdrant'}},",
                "    'custom_instructions': 'Remember stable facts only.',",
                "})",
                "print(json.dumps(captured, sort_keys=True))",
            ]
        ),
    )
    assert parse_stdout_json(mem0_backend_contract.stdout)["custom_instructions"] == (
        "Remember stable facts only."
    )

    version = run("docker", "run", "--rm", IMAGE, "--version")
    assert "Hermes Agent v" in version.stdout

    server = ThreadingHTTPServer(("0.0.0.0", 0), ModelHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    model_port = server.server_address[1]
    container = f"hermes-image-test-{uuid.uuid4().hex[:10]}"
    volume = f"hermes-image-test-{uuid.uuid4().hex[:10]}"
    try:
        run(
            "docker", "volume", "create",
            "--label", f"{TEST_RUN_LABEL}={TEST_RUN_ID}",
            volume,
        )
        base = start_container(container, volume, model_port, API_KEY)
        assert request_preflight(f"{base}/v1/models", origin=ALLOWED_ORIGIN) == (
            200,
            ALLOWED_ORIGIN,
        )
        assert request_preflight(
            f"{base}/v1/models", origin="https://evil.example"
        )[0] == 403

        result = request_json(
            f"{base}/v1/chat/completions",
            bearer=API_KEY,
            payload={"model": "hermes-agent", "messages": [{"role": "user", "content": PROMPT}], "stream": False},
        )
        assert result["choices"][0]["message"]["content"] == REPLY, (
            result,
            ModelHandler.observed_requests,
        )

        parent_session_id = f"image-parent-{uuid.uuid4().hex}"
        fork_session_id = f"image-fork-{uuid.uuid4().hex}"
        parent = request_json(
            f"{base}/api/sessions",
            bearer=API_KEY,
            payload={"id": parent_session_id, "source": "api_server"},
        )
        assert parent["session"]["model"] == MODEL, parent
        parent_chat = request_json(
            f"{base}/api/sessions/{parent_session_id}/chat",
            bearer=API_KEY,
            payload={"message": PROMPT},
        )
        assert parent_chat["message"]["content"] == REPLY, parent_chat
        forked = request_json(
            f"{base}/api/sessions/{parent_session_id}/fork",
            bearer=API_KEY,
            payload={"id": fork_session_id},
        )
        assert forked["session"]["id"] == fork_session_id, forked
        assert forked["session"]["parent_session_id"] == parent_session_id, forked
        assert forked["session"]["model"] == MODEL, forked
        assert forked["session"]["has_model_config"] is False, forked
        fork_stream = request_sse(
            f"{base}/api/sessions/{fork_session_id}/chat/stream",
            bearer=API_KEY,
            payload={"message": PROMPT},
        )
        fork_event_names = [name for name, _payload in fork_stream]
        assert "error" not in fork_event_names, fork_stream
        assert "assistant.completed" in fork_event_names, fork_stream
        assert "run.completed" in fork_event_names, fork_stream
        assert fork_event_names[-1] == "done", fork_stream
        fork_completed = next(
            payload for name, payload in fork_stream if name == "assistant.completed"
        )
        assert fork_completed["content"] == REPLY, fork_completed

        parent_messages = request_json(
            f"{base}/api/sessions/{parent_session_id}/messages",
            bearer=API_KEY,
        )
        fork_messages = request_json(
            f"{base}/api/sessions/{fork_session_id}/messages",
            bearer=API_KEY,
        )
        assert parent_messages["data"], parent_messages
        assert fork_messages["data"], fork_messages

        run("docker", "rm", "-f", container)
        run(
            "docker", "run", "--rm", "--entrypoint", "/bin/sh",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "-c",
            "printf '%s\\n' "
            "'API_SERVER_KEY=stale-retained-api-key-32-characters' "
            "'HYPER_AGENTS_API_KEY=stale-retained-model-key' "
            "'HYPER_AGENTS_API_BASE=http://127.0.0.1:9' "
            "'API_SERVER_CORS_ORIGINS=https://stale.example' "
            "> /home/hermes/.hermes/.env",
        )
        base = start_container(container, volume, model_port, ROTATED_API_KEY)
        assert request_status(
            f"{base}/api/sessions/{parent_session_id}/messages",
            bearer=API_KEY,
        ) == 401
        restored_parent = request_json(
            f"{base}/api/sessions/{parent_session_id}/messages",
            bearer=ROTATED_API_KEY,
        )
        restored_fork = request_json(
            f"{base}/api/sessions/{fork_session_id}/messages",
            bearer=ROTATED_API_KEY,
        )
        assert restored_parent["data"] == parent_messages["data"]
        assert restored_fork["data"] == fork_messages["data"]
        assert request_preflight(f"{base}/v1/models", origin=ALLOWED_ORIGIN) == (
            200,
            ALLOWED_ORIGIN,
        )
        assert request_preflight(
            f"{base}/v1/models", origin="https://stale.example"
        )[0] == 403
        rotated_model = request_json(
            f"{base}/v1/chat/completions",
            bearer=ROTATED_API_KEY,
            payload={"model": MODEL, "messages": [{"role": "user", "content": PROMPT}]},
        )
        assert rotated_model["choices"][0]["message"]["content"] == REPLY

        seeded = run(
            "docker", "run", "--rm", "-v", f"{volume}:/home/hermes", IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/config.yaml').read_text())",
        ).stdout
        assert "key_env: HYPER_AGENTS_API_KEY" in seeded
        assert "api: ${env:HYPER_AGENTS_API_BASE}" in seeded
        assert "provider: custom:hypercli" in seeded
        assert "memory:" in seeded
        assert "provider: mem0" in seeded
        assert "skills:" in seeded
        assert "external_dirs:" in seeded
        assert "- /opt/hypercli/skills" in seeded
        assert f"default: {MODEL}" in seeded
        assert "transport: anthropic_messages" in seeded
        assert f"model_name: {MODEL}" in seeded
        assert "model_routes:" in seeded
        assert f"model: {MODEL}" in seeded
        assert "_config_version: 33" in seeded
        assert MODEL_KEY not in seeded

        mem0_seeded = run(
            "docker", "run", "--rm", "-v", f"{volume}:/home/hermes", IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/mem0.json').read_text())",
        ).stdout
        mem0_config = parse_stdout_json(mem0_seeded)
        assert mem0_config["mode"] == "oss"
        assert mem0_config["agent_id"] == "hermes"
        assert mem0_config["oss"]["llm"]["provider"] == "openai"
        assert mem0_config["oss"]["llm"]["config"]["model"] == MODEL
        assert mem0_config["oss"]["llm"]["config"]["openai_base_url"] == (
            "https://api.agents.hypercli.com/v1"
        )
        assert mem0_config["oss"]["embedder"]["provider"] == "openai"
        assert mem0_config["oss"]["embedder"]["config"]["model"] == "qwen3-embedding-4b"
        assert mem0_config["oss"]["embedder"]["config"]["embedding_dims"] == 2560
        assert mem0_config["oss"]["embedder"]["config"]["openai_base_url"] == (
            "https://api.agents.hypercli.com/v1"
        )
        assert mem0_config["oss"]["vector_store"] == {
            "provider": "qdrant",
            "config": {"path": "/home/hermes/.hermes/mem0_qdrant"},
        }
        assert "custom_instructions" not in mem0_config["oss"]
        assert MODEL_KEY not in mem0_seeded

        memory_instructions = "Only store durable user preferences."
        mem0_with_instructions = run(
            "docker", "run", "--rm",
            "-v", f"{volume}:/home/hermes",
            "-e", f"HERMES_MEMORY_CUSTOM_INSTRUCTIONS={memory_instructions}",
            IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/mem0.json').read_text())",
        ).stdout
        assert parse_stdout_json(mem0_with_instructions)["oss"]["custom_instructions"] == (
            memory_instructions
        )

        mem0_without_instructions = run(
            "docker", "run", "--rm",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/mem0.json').read_text())",
        ).stdout
        assert "custom_instructions" not in parse_stdout_json(mem0_without_instructions)["oss"]

        run(
            "docker", "run", "--rm", "--entrypoint", "/bin/sh",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "-c", "chown -R 12345:12346 /home/hermes && rm -rf /home/hermes/.hermes/skills/hypercli",
        )
        ownership = run(
            "docker", "run", "--rm", "-e", "PUID=12345", "-e", "PGID=12346",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "stat", "-c", "%u:%g", "/home/hermes/.hermes/skills/hypercli",
        ).stdout
        assert ownership.rstrip().endswith("12345:12346")

        run(
            "docker", "run", "--rm", "--entrypoint", "/bin/sh",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "-c",
            "touch /home/hermes/.hermes/skills/hypercli/user-extra.txt && "
            "chown -R 0:0 /home/hermes/.hermes/skills /home/hermes/.hermes/config.yaml",
        )
        repaired_output = run(
            "docker", "run", "--rm", "-e", "PUID=12345", "-e", "PGID=12346",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "sh", "-c",
            "stat -c '%u:%g' /home/hermes/.hermes/skills/hypercli/SKILL.md "
            "/home/hermes/.hermes/config.yaml "
            "/home/hermes/.hermes/skills/hypercli/user-extra.txt /home/hermes/shared",
        ).stdout.splitlines()
        repaired = [line for line in repaired_output if re.fullmatch(r"\d+:\d+", line)]
        assert repaired == [
            "12345:12346",
            "12345:12346",
            "0:0",
            "12345:12346",
        ]

        run(
            "docker", "run", "--rm", "--entrypoint", "/bin/sh",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "-c",
            "mkdir -p /home/hermes/ownership-escape && "
            "touch /home/hermes/ownership-escape/SKILL.md && "
            "chown 0:0 /home/hermes/ownership-escape/SKILL.md && "
            "rm -rf /home/hermes/.hermes/skills/hypercli && "
            "ln -s /home/hermes/ownership-escape /home/hermes/.hermes/skills/hypercli",
        )
        escaped_ownership = run(
            "docker", "run", "--rm", "-e", "PUID=12345", "-e", "PGID=12346",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "stat", "-c", "%u:%g", "/home/hermes/ownership-escape/SKILL.md",
        ).stdout
        assert escaped_ownership.rstrip().endswith("0:0")
        run(
            "docker", "run", "--rm", "--entrypoint", "/bin/sh",
            "-v", f"{volume}:/home/hermes", IMAGE,
            "-c", "rm /home/hermes/.hermes/skills/hypercli",
        )

        marker = "# preserve-existing-config"
        run(
            "docker", "run", "--rm", "-v", f"{volume}:/home/hermes", IMAGE,
            "python", "-c",
            f"from pathlib import Path; p=Path('/home/hermes/.hermes/config.yaml'); p.write_text(p.read_text() + {marker!r} + '\\n')",
        )
        preserved = run(
            "docker", "run", "--rm", "-v", f"{volume}:/home/hermes", IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/config.yaml').read_text())",
        ).stdout
        assert marker in preserved
    finally:
        server.shutdown()
        run("docker", "rm", "-f", container, check=False)
        run("docker", "volume", "rm", "-f", volume, check=False)

    print("Hermes agent image contract passed")


if __name__ == "__main__":
    main()
