#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid


IMAGE = sys.argv[1] if len(sys.argv) > 1 else "hypercli-hermes:local"
MODEL = "default-anthropic"
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


def main() -> None:
    inspect = json.loads(run("docker", "image", "inspect", IMAGE).stdout)[0]["Config"]
    assert inspect["Entrypoint"] == ["/opt/hypercli-hermes/entrypoint.sh"]
    assert inspect["Cmd"] == ["/usr/local/bin/hyper-acp"]
    assert inspect["ExposedPorts"] == {"3000/tcp": {}}
    assert inspect["Healthcheck"]["Test"] == ["NONE"]
    assert "HYPER_ACP_AGENT_COMMAND=/opt/hermes/.venv/bin/hermes-acp" in inspect["Env"]
    assert "HERMES_ACP_SKIP_CONFIGURED_MCP=1" in inspect["Env"]
    assert not any(value.startswith("API_SERVER_") for value in inspect["Env"])
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

    volume = f"hermes-image-test-{uuid.uuid4().hex[:10]}"
    try:
        run(
            "docker", "volume", "create",
            "--label", f"{TEST_RUN_LABEL}={TEST_RUN_ID}",
            volume,
        )
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
        assert "gateway:" not in seeded
        assert "_config_version: 33" in seeded

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

        # mem0's OSS LLM/embedder must follow the launch's agents API base:
        # mem0's openai provider prefers the config's openai_base_url over
        # OPENAI_BASE_URL, so configure_mem0.py rewrites the seeded file from
        # HYPER_AGENTS_API_BASE (stripping a caller's trailing /agents —
        # litellm owns /v1 only at the host root).
        mem0_dev_base = run(
            "docker", "run", "--rm",
            "-v", f"{volume}:/home/hermes",
            "-e", "HYPER_AGENTS_API_BASE=https://api.dev.hypercli.com/agents",
            IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/mem0.json').read_text())",
        ).stdout
        mem0_dev_config = parse_stdout_json(mem0_dev_base)
        assert mem0_dev_config["oss"]["llm"]["config"]["openai_base_url"] == (
            "https://api.dev.hypercli.com/v1"
        )
        assert mem0_dev_config["oss"]["embedder"]["config"]["openai_base_url"] == (
            "https://api.dev.hypercli.com/v1"
        )
        mem0_default_base = run(
            "docker", "run", "--rm",
            "-v", f"{volume}:/home/hermes",
            IMAGE,
            "python", "-c",
            "from pathlib import Path; print(Path('/home/hermes/.hermes/mem0.json').read_text())",
        ).stdout
        mem0_default_config = parse_stdout_json(mem0_default_base)
        assert mem0_default_config["oss"]["llm"]["config"]["openai_base_url"] == (
            "https://api.agents.hypercli.com/v1"
        )
        assert mem0_default_config["oss"]["embedder"]["config"]["openai_base_url"] == (
            "https://api.agents.hypercli.com/v1"
        )

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

        # Memory-configured probe (env-gated): mirrors how the runtime really
        # reaches litellm. The entrypoint rewrites the seeded mem0.json via
        # configure_mem0.py from HYPER_AGENTS_API_BASE, then the leg (1) POSTs
        # one real embeddings request against the derived base URL and asserts
        # 200 + the pinned vector length, and (2) round-trips a mem0
        # add/search through OSSBackend against a SCRATCH qdrant path (never
        # the live store path, whose lock the agent's backend may hold). A
        # 400/401 from /embeddings fails the leg loudly. CI runs hermes-sanity
        # without a key, so the leg only runs when the caller exports
        # HYPER_AGENTS_API_KEY; HYPER_AGENTS_API_BASE defaults to the dev
        # agents base like the openclaw sanity script
        # (.github/scripts/agents/openclaw_sanity_check.sh).
        memory_probe_key = os.environ.get("HYPER_AGENTS_API_KEY", "").strip()
        if memory_probe_key:
            memory_probe_base = (
                os.environ.get("HYPER_AGENTS_API_BASE", "").strip()
                or "https://api.dev.hypercli.com"
            )
            memory_probe = run(
                "docker", "run", "--rm",
                "--add-host", "host.docker.internal:host-gateway",
                "-v", f"{volume}:/home/hermes",
                "-e", f"HYPER_AGENTS_API_BASE={memory_probe_base}",
                "-e", f"HYPER_AGENTS_API_KEY={memory_probe_key}",
                "-e", "MEM0_TELEMETRY=false",
                # Docker proxy injection can replace the image's baked
                # NO_PROXY; keep the no-proxy set explicit for local probes.
                "-e", "NO_PROXY=localhost,127.0.0.1,host.docker.internal",
                "-e", "no_proxy=localhost,127.0.0.1,host.docker.internal",
                IMAGE,
                "python", "-c",
                "\n".join(
                    [
                        "import json, os, shutil, sys, tempfile, urllib.error, urllib.request",
                        "from pathlib import Path",
                        "config = json.loads(Path('/home/hermes/.hermes/mem0.json').read_text())",
                        "embedder = config['oss']['embedder']",
                        "embedder_config = embedder['config']",
                        "assert embedder['provider'] == 'openai', embedder",
                        "base_url = embedder_config['openai_base_url'].rstrip('/')",
                        "model = embedder_config['model']",
                        "# mem0 forwards embedding_dims as `dimensions`; sending it here is",
                        "# exactly the request shape that trips LiteLLM's non-OpenAI-name",
                        "# dimensions reject when the allowlist is missing.",
                        "expected_dims = embedder_config['embedding_dims']",
                        "key = os.environ['OPENAI_API_KEY']",
                        "request = urllib.request.Request(",
                        "    f'{base_url}/embeddings',",
                        "    data=json.dumps({'model': model, 'input': ['hermes memory sanity probe'], 'encoding_format': 'float', 'dimensions': expected_dims}).encode('utf-8'),",
                        "    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},",
                        "    method='POST',",
                        ")",
                        "try:",
                        "    with urllib.request.urlopen(request, timeout=60) as response:",
                        "        payload = json.loads(response.read())",
                        "except urllib.error.HTTPError as exc:",
                        "    body = exc.read().decode('utf-8', 'replace')[:500]",
                        "    raise SystemExit(f'memory embeddings probe failed: HTTP {exc.code} from {base_url}/embeddings: {body}')",
                        "vector = payload['data'][0]['embedding']",
                        "assert isinstance(vector, list) and vector, payload",
                        "assert len(vector) == expected_dims, (f'embeddings probe returned {len(vector)} dims; mem0.json pins {expected_dims}')",
                        "print(f'memory embeddings probe ok: {model} returned {len(vector)} dims via {base_url}')",
                        "scratch = tempfile.mkdtemp(prefix='hermes-mem0-sanity-')",
                        "oss = dict(config['oss'])",
                        "oss['vector_store'] = {'provider': 'qdrant', 'config': {'path': scratch}}",
                        "from plugins.memory.mem0._backend import OSSBackend",
                        "backend = OSSBackend(oss)",
                        "try:",
                        "    backend.add(",
                        "        [{'role': 'user', 'content': 'hermes memory sanity probe note'}],",
                        "        user_id='hermes-sanity',",
                        "        agent_id='hermes-sanity',",
                        "        infer=False,",
                        "    )",
                        "    hits = backend.search('hermes memory sanity probe note', filters={'user_id': 'hermes-sanity'}, top_k=1)",
                        "    assert hits, 'mem0 search over the scratch store returned no hits'",
                        "finally:",
                        "    backend.close()",
                        "# The probe runs as root; do not leave root-owned mem0 history",
                        "# state on the volume for the agent user (uid 10000).",
                        "shutil.rmtree('/home/hermes/.mem0', ignore_errors=True)",
                        "print('mem0 scratch round-trip ok')",
                    ]
                ),
                check=False,
            )
            assert memory_probe.returncode == 0, (
                memory_probe.stdout,
                memory_probe.stderr,
            )
            assert "memory embeddings probe ok" in memory_probe.stdout
            assert "mem0 scratch round-trip ok" in memory_probe.stdout
            print(memory_probe.stdout.strip())
        else:
            print(
                "memory probe skipped: env-gated; export HYPER_AGENTS_API_KEY "
                "(and optionally HYPER_AGENTS_API_BASE) to run the embeddings "
                "and mem0 scratch round-trip legs"
            )

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
        run("docker", "volume", "rm", "-f", volume, check=False)

    print("Hermes agent image contract passed")


if __name__ == "__main__":
    main()
