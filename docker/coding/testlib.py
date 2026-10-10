from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any


WORKSPACE = Path("/home/node")
WORKSPACES = Path("/home/node/shared")
STATE_DIR = Path("/home/node/.coding-agent")
ENTRYPOINT_EXIT_CODE = 42
ENTRYPOINT_EXIT_TIMEOUT_SECONDS = 30
RUNTIME_STATE_DIRS = {
    "claude-code": ".claude",
    "goose": ".goose",
    "kimi-code": ".kimi-code",
    "pi": ".pi",
    "opencode": ".config/opencode",
}
# Native instruction file seeded at boot from the baked
# /opt/hypercli/share/runtime/AGENTS.md.template (paths relative to the
# resolved native instruction root, which is the sync-rooted home here).
INSTRUCTION_FILES = {
    "buzz-agent": "AGENTS.md",
    "claude-code": ".claude/CLAUDE.md",
    "codex": ".codex/AGENTS.md",
    "goose": ".goose/config/.goosehints",
    "kimi-code": ".kimi-code/AGENTS.md",
    "opencode": ".config/opencode/AGENTS.md",
    "pi": ".pi/agent/AGENTS.md",
}
INSTRUCTION_HEADING = "# AGENTS.md — HyperCLI Hosted Agent"
INSTRUCTION_PERSONA_REFS = ("~/.hypercli/USER.md", "~/.hypercli/SOUL.md")
# Key-phrase markers only, never full copy: identity + files/skills contract.
INSTRUCTION_MARKERS = (
    "hyper me",
    "/opt/hypercli/share/runtime/runtime",
    "~/.inbox",
    "resource_link",
    "/opt/hypercli/skills",
    "hyper skills list",
)


def require_image_argument() -> str:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} IMAGE")
    return sys.argv[1]


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["docker", *args],
        check=False,
        text=True,
        capture_output=True,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"docker {' '.join(args)} failed with {result.returncode}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def image_config(image: str) -> dict[str, Any]:
    result = docker("image", "inspect", "--format", "{{json .Config}}", image)
    payload = json.loads(result.stdout)
    assert isinstance(payload, dict)
    return payload


def assert_entrypoint_exit_passthrough(image: str) -> None:
    """Prove the real image entrypoint terminates with its child process."""
    container_name = f"hypercli-entrypoint-exit-{uuid.uuid4().hex}"
    docker(
        "create",
        "--name",
        container_name,
        "--network",
        "none",
        image,
        "python3",
        "-c",
        f"raise SystemExit({ENTRYPOINT_EXIT_CODE})",
    )
    try:
        docker("start", container_name)
        try:
            waited = subprocess.run(
                ["docker", "wait", container_name],
                check=False,
                text=True,
                capture_output=True,
                timeout=ENTRYPOINT_EXIT_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise AssertionError(
                f"{image}: real entrypoint did not exit within "
                f"{ENTRYPOINT_EXIT_TIMEOUT_SECONDS}s"
            ) from exc
        assert waited.returncode == 0, (
            f"docker wait failed with {waited.returncode}\n"
            f"stdout:\n{waited.stdout}\nstderr:\n{waited.stderr}"
        )
        assert waited.stdout.strip() == str(ENTRYPOINT_EXIT_CODE), (
            f"{image}: expected entrypoint exit {ENTRYPOINT_EXIT_CODE}, "
            f"got {waited.stdout.strip()!r}"
        )
    finally:
        cleanup = docker("rm", "--force", container_name, check=False)
        if cleanup.returncode != 0:
            raise AssertionError(
                f"could not remove entrypoint probe container {container_name}\n"
                f"stdout:\n{cleanup.stdout}\nstderr:\n{cleanup.stderr}"
            )


def run(
    image: str,
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    mounts: list[tuple[Path, str]] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    args = ["run", "--rm", "--network", "none"]
    for key, value in (env or {}).items():
        args.extend(["--env", f"{key}={value}"])
    for source, destination in mounts or []:
        args.extend(["--mount", f"type=bind,src={source},dst={destination}"])
    args.extend([image, *command])
    return docker(*args, check=check)


def run_json(
    image: str,
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    mounts: list[tuple[Path, str]] | None = None,
) -> dict[str, Any]:
    result = run(image, command, env=env, mounts=mounts)
    payload = json.loads(result.stdout)
    assert isinstance(payload, dict), payload
    return payload


def run_python(
    image: str,
    source: str,
    *,
    env: dict[str, str] | None = None,
    mounts: list[tuple[Path, str]] | None = None,
) -> dict[str, Any]:
    return run_json(image, ["python3", "-c", source], env=env, mounts=mounts)


def native_setup_command(
    operation: str,
    *,
    agent_command: str,
    agent_args: str,
) -> list[str]:
    assert operation in {"initialize", "session/new"}
    source = Path(__file__).with_name("native_acp_setup.py").read_text()
    return ["python3", "-c", source, operation, json.dumps([agent_command, *shlex.split(agent_args)])]


def assert_auth_methods(
    image: str,
    *,
    agent_command: str,
    agent_args: str,
    expected: set[str],
    terminal: set[str] | None = None,
    env: dict[str, str] | None = None,
) -> None:
    payload = run_json(
        image,
        native_setup_command(
            "initialize",
            agent_command=agent_command,
            agent_args=agent_args,
        ),
        env=env,
    )
    methods = payload["initialize"].get("authMethods", [])
    assert isinstance(methods, list), payload
    # Inspect the actual native v1 initialize response, not a plugin probe.
    terminal = terminal or set()
    assert terminal <= expected
    ids = []
    for method in methods:
        assert isinstance(method, dict), method
        method_id = method.get("id")
        assert isinstance(method_id, str), method
        ids.append(method_id)
        assert isinstance(method.get("name"), str), method
        assert method.get("description") is None or isinstance(method["description"], str), method
        method_type = method.get("type", "agent")
        assert method_type in {"agent", "terminal"}, method
        terminal_routed = method_type == "terminal"
        assert terminal_routed == (method_id in terminal), method
        allowed = {"id", "name", "description", "type", "_meta"}
        if method.get("_meta") is not None:
            assert isinstance(method["_meta"], dict), method
        if terminal_routed:
            allowed |= {"args", "env"}
            args = method.get("args", [])
            assert isinstance(args, list) and all(isinstance(arg, str) for arg in args), method
            env_vars = method.get("env", {})
            assert isinstance(env_vars, dict), method
            assert all(isinstance(value, str) for value in env_vars.values()), method
        # Upstream metadata is opaque and must not select routing. Our client
        # neither invents nor consumes private metadata; the standard top-level
        # discriminator above is the only terminal-routing authority.
        assert set(method) <= allowed, method
    assert len(ids) == len(set(ids)), payload
    assert set(ids) == expected, payload


def assert_runtime_auth_wrapper(
    image: str,
    *,
    runtime_command: str,
) -> None:
    """Prove the stable HyperCLI auth entrypoint resolves to this runtime."""
    payload = run_python(
        image,
        f"""
import json
import os
from pathlib import Path

generic = Path('/usr/local/bin/hypercli-runtime-auth')
specific = Path({runtime_command!r})
print(json.dumps({{
    'generic_is_link': generic.is_symlink(),
    'generic_target': os.path.realpath(generic),
    'specific_is_file': specific.is_file(),
    'specific_executable': os.access(specific, os.X_OK),
}}))
""",
    )
    assert payload == {
        "generic_is_link": True,
        "generic_target": runtime_command,
        "specific_is_file": True,
        "specific_executable": True,
    }, payload
    help_result = run(image, ["hypercli-runtime-auth", "--help"])
    assert f"Usage: {Path(runtime_command).name}" in help_result.stdout


def assert_models(
    image: str,
    *,
    agent_command: str,
    agent_args: str,
    env: dict[str, str] | None = None,
    mounts: list[tuple[Path, str]] | None = None,
) -> dict[str, Any]:
    payload = run_json(
        image,
        native_setup_command(
            "session/new",
            agent_command=agent_command,
            agent_args=agent_args,
        ),
        env=env,
        mounts=mounts,
    )
    assert isinstance(payload["initialize"].get("agentInfo"), dict), payload
    assert isinstance(payload.get("session"), dict), payload
    return payload


COMMON_PROBE = r"""
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

workspace = Path("/home/node")
runtime_dirs = [
    Path("/home/node/.coding-agent"),
    Path("/home/node/shared"),
]
removed_layout_paths = [
    workspace / "GUIDES",
    workspace / "RESEARCH",
    workspace / "PLANS",
    workspace / "WORK_LOGS",
    workspace / "OUTBOX",
    workspace / "REPOS",
    workspace / ".scratch",
    workspace / ".agents",
]

hypercli_skills = sorted(
    path.parent.name
    for path in Path("/opt/hypercli/skills").glob("*/SKILL.md")
)
runtime = Path("/opt/hypercli/share/runtime/runtime").read_text().strip()
agents_path = workspace / "AGENTS.md"
instructions_path = workspace / __INSTRUCTION_FILES__[runtime]
instructions_text = (
    instructions_path.read_text(encoding="utf-8")
    if instructions_path.is_file() and not instructions_path.is_symlink()
    else None
)
runtime_state_dir = {
    "claude-code": ".claude",
    "goose": ".goose",
    "kimi-code": ".kimi-code",
    "opencode": ".config/opencode",
}.get(runtime)

payload = {
    "uid": os.getuid(),
    "cwd": str(Path.cwd()),
    "sudo_user": subprocess.check_output(
        ["sudo", "-n", "whoami"],
        text=True,
    ).strip(),
    "runtime": runtime,
    "agents_exists": agents_path.exists() or agents_path.is_symlink(),
    "agents_heading": agents_path.read_text(encoding="utf-8").splitlines()[0]
    if agents_path.exists()
    else None,
    "instructions_exists": instructions_text is not None,
    "instructions_heading": instructions_text.splitlines()[0]
    if instructions_text is not None
    else None,
    "instructions_persona_refs": all(
        ref in instructions_text
        for ref in ("~/.hypercli/USER.md", "~/.hypercli/SOUL.md")
    )
    if instructions_text is not None
    else False,
    "instructions_markers": all(
        marker in instructions_text for marker in __INSTRUCTION_MARKERS__
    )
    if instructions_text is not None
    else False,
    "hypercli_skill_names": {
        skill: f"name: {skill}" in (
            Path("/opt/hypercli/skills") / f"{skill}/SKILL.md"
        ).read_text(encoding="utf-8")
        for skill in hypercli_skills
    },
    "directory_modes": {
        str(path): stat.S_IMODE(path.stat().st_mode)
        for path in runtime_dirs
    },
    "removed_layout_paths": {
        str(path): path.exists() or path.is_symlink()
        for path in removed_layout_paths
    },
    "tools": {
        tool: shutil.which(tool)
        for tool in (
            [
            "node",
            "npm",
            "python3",
            "hyper",
            "git",
            "jq",
            "rg",
            "ssh",
            "sudo",
            "tini",
            "hyper-acp",
            "Xvfb",
            "x11vnc",
            "websockify",
            "dbus-launch",
            "xfwm4",
            "xfce4-terminal",
            "thunar",
            ]
            + (["buzz-agent", "buzz-dev-mcp"] if runtime == "buzz-agent" else [])
        )
    },
    "vanilla_buzz_cli": shutil.which("buzz"),
    "hyper_acp_link": str(Path("/usr/local/bin/hyper-acp").readlink()),
    "hyper_acp_executable": os.access("/opt/hypercli/bin/hyper-acp", os.X_OK),
    "acp_compat_link": str(Path("/usr/local/bin/acp").readlink()),
    "acp_compat_help": "--ws-url"
    in subprocess.run(
        ["/usr/local/bin/acp", "--help"],
        capture_output=True,
        text=True,
    ).stdout,
    "hidden_sprig": Path("/usr/local/lib/acp/buzz/sprig").is_file(),
    "workspaces_is_dir": Path("/home/node/shared").is_dir(),
    "legacy_buzz_nest_exists": (workspace / ".buzz").exists(),
    "base_prompt_in_workspace": (workspace / "base_prompt.md").exists(),
    "runtime_state_dir": runtime_state_dir,
    "runtime_state_exists": (workspace / runtime_state_dir).exists()
    if runtime_state_dir
    else False,
}
print(json.dumps(payload))
"""
COMMON_PROBE = COMMON_PROBE.replace("__INSTRUCTION_FILES__", repr(dict(INSTRUCTION_FILES)))
COMMON_PROBE = COMMON_PROBE.replace("__INSTRUCTION_MARKERS__", repr(tuple(INSTRUCTION_MARKERS)))


def assert_common_contract(
    image: str,
    *,
    runtime: str,
    agent_command: str,
    agent_args: str,
    entrypoint: str,
) -> None:
    config = image_config(image)
    labels = config.get("Labels") or {}
    env = dict(
        item.split("=", 1)
        for item in config.get("Env") or []
        if "=" in item
    )

    assert config.get("Entrypoint") == [
        "/usr/bin/tini",
        "--",
        entrypoint,
    ], config.get("Entrypoint")
    assert config.get("WorkingDir") == "/home/node"
    assert config.get("Cmd") == ["/usr/local/bin/hyper-acp"], config.get("Cmd")
    if runtime == "buzz-agent":
        assert labels.get("org.hypercli.buzz_runtime") == "true"
    else:
        assert "org.hypercli.buzz_runtime" not in labels
    assert labels.get("org.hypercli.coding_workspace") == str(WORKSPACE)
    assert labels.get("org.hypercli.coding_runtime") == runtime
    assert env.get("CODING_AGENT_WORKSPACE_DIR") == str(WORKSPACE)
    assert env.get("CODING_AGENT_STATE_DIR") == str(STATE_DIR)
    assert env.get("HYPER_WORKSPACES_DIR") == str(WORKSPACES)
    assert env.get("HOME") == "/home/node"
    assert env.get("HYPER_ACP_AGENT_COMMAND") == agent_command
    assert env.get("HYPER_ACP_AGENT_ARGS") == agent_args
    if runtime == "buzz-agent":
        assert env.get("BUZZ_AGENT_PROVIDER") == "openai"
        assert env.get("BUZZ_AGENT_MODEL") == "coding-anthropic"
        assert env.get("OPENAI_COMPAT_API") == "chat"
        assert "OPENAI_COMPAT_API_KEY" not in env
        assert "OPENAI_COMPAT_BASE_URL" not in env
        assert env.get("BUZZ_ACP_AGENT_COMMAND") == agent_command
        assert env.get("BUZZ_ACP_AGENT_ARGS", "") == agent_args
        assert "BUZZ_ACP_MCP_COMMAND" not in env
        assert "BUZZ_ACP_BASE_PROMPT_FILE" not in env
    else:
        assert "HYPER_ACP_BASE_PROMPT_FILE" not in env
        assert "BUZZ_ACP_AGENT_COMMAND" not in env
        assert "BUZZ_ACP_AGENT_ARGS" not in env
        assert "BUZZ_ACP_MCP_COMMAND" not in env
        assert "BUZZ_ACP_BASE_PROMPT_FILE" not in env

    assert_buzz_launch_contract(image, runtime=runtime)
    assert_entrypoint_exit_passthrough(image)
    run(image, ["true"], env={"HYPER_DESKTOP_ENABLED": "1"})
    payload = run_python(image, COMMON_PROBE)
    assert payload["uid"] == 1000
    assert payload["cwd"] == str(WORKSPACE)
    assert payload["sudo_user"] == "root"
    assert payload["runtime"] == runtime
    # buzz-agent's native instruction root is its home (= workspace); every
    # other runtime seeds its instruction file under its native runtime root,
    # never the workspace root.
    assert payload["agents_exists"] is (runtime == "buzz-agent")
    assert payload["agents_heading"] == (
        INSTRUCTION_HEADING if runtime == "buzz-agent" else None
    )
    assert payload["instructions_exists"] is True, payload
    assert payload["instructions_heading"] == INSTRUCTION_HEADING, payload
    assert payload["instructions_persona_refs"] is True, payload
    assert payload["instructions_markers"] is True, payload
    assert payload["hypercli_skill_names"]
    assert all(payload["hypercli_skill_names"].values())
    assert not any(payload["removed_layout_paths"].values()), payload[
        "removed_layout_paths"
    ]
    assert set(payload["directory_modes"].values()) == {0o700}
    assert all(payload["tools"].values()), payload["tools"]
    assert payload["vanilla_buzz_cli"] is None
    assert payload["hyper_acp_link"] == "/opt/hypercli/bin/hyper-acp"
    assert payload["hyper_acp_executable"] is True
    assert payload["acp_compat_link"] == "/opt/hypercli/bin/hyper-acp"
    assert payload["acp_compat_help"] is True
    assert payload["hidden_sprig"] is True
    assert payload["workspaces_is_dir"] is True
    assert payload["legacy_buzz_nest_exists"] is False
    assert payload["base_prompt_in_workspace"] is False
    runtime_state_dir = RUNTIME_STATE_DIRS.get(runtime)
    assert payload["runtime_state_dir"] == runtime_state_dir
    assert payload["runtime_state_exists"] == (runtime_state_dir is not None)
    assert_workspace_persistence(image, runtime=runtime)


def assert_buzz_launch_contract(image: str, *, runtime: str) -> None:
    """Check provider/SDK launch paths against the actual candidate filesystem."""
    # The provider integration golden is parent-owned, not public image source.
    fixture = Path(os.environ["HYPERCLI_TEST_LAUNCH_CONTRACT"])
    golden = json.loads(fixture.read_text(encoding="utf-8"))
    contract = golden["runtimes"][runtime]
    command = golden["common"]["command"]
    env = {
        "BUZZ_ACP_AGENT_COMMAND": contract["agent_command"],
        "BUZZ_ACP_AGENT_ARGS": contract["agent_args"],
    }
    if contract["claude_code_executable"]:
        env["CLAUDE_CODE_EXECUTABLE"] = contract["claude_code_executable"]
    # The provider's real-binary protocol test checks emitted requests against
    # this golden for all six runtimes. This independent leg must resolve those
    # same paths inside each built image, as UID 1000 after its real entrypoint.
    paths = [command[0], contract["agent_command"]]
    if contract["claude_code_executable"]:
        paths.append(contract["claude_code_executable"])
    payload = run_python(
        image,
        f"""
import json
import os
from pathlib import Path

print(json.dumps({{
    "uid": os.getuid(),
    "env": {{key: os.environ.get(key) for key in {list(env)!r}}},
    "executables": {{
        path: Path(path).is_file() and os.access(path, os.X_OK)
        for path in {paths!r}
    }},
}}))
""",
        env=env,
    )
    assert payload["uid"] == 1000, payload
    assert payload["env"] == env, payload
    assert payload["executables"] == dict.fromkeys(paths, True), (
        f"{image}: Buzz launch executable missing or not executable: {payload}"
    )
    # Exercise the emitted launcher mode without connecting to a relay or API.
    run(image, [*command, "--help"], env=env)


def assert_workspace_persistence(image: str, *, runtime: str) -> None:
    with tempfile.TemporaryDirectory() as persisted_name:
        persisted = Path(persisted_name)
        persisted.chmod(0o777)
        run(image, ["true"], mounts=[(persisted, "/home/node")])

        seeded = persisted / INSTRUCTION_FILES[runtime]
        assert seeded.is_file() and not seeded.is_symlink()
        seeded_text = seeded.read_text(encoding="utf-8")
        for ref in INSTRUCTION_PERSONA_REFS:
            assert ref in seeded_text
        for marker in INSTRUCTION_MARKERS:
            assert marker in seeded_text, marker

        agents = persisted / "AGENTS.md"
        agents.write_text("user-managed AGENTS\n", encoding="utf-8")

        claude = persisted / "CLAUDE.md"
        claude.write_text(
            "user-managed Claude instructions\n",
            encoding="utf-8",
        )

        run(image, ["true"], mounts=[(persisted, "/home/node")])
        agents_content = agents.read_text(encoding="utf-8")
        assert agents_content == "user-managed AGENTS\n"
        if runtime != "buzz-agent":
            # The seeded native instruction file survives later boots.
            assert seeded.read_text(encoding="utf-8") == seeded_text
        assert not claude.is_symlink()
        assert (
            claude.read_text(encoding="utf-8")
            == "user-managed Claude instructions\n"
        )
        for removed_path in (
            "GUIDES",
            "RESEARCH",
            "PLANS",
            "WORK_LOGS",
            "OUTBOX",
            "REPOS",
            ".scratch",
            ".agents",
            "SKILLS.md",
        ):
            assert not (persisted / removed_path).exists()


def assert_user_config_preserved(
    image: str,
    *,
    relative_path: str,
    generated_contains: str,
    user_content: str,
    env: dict[str, str] | None = None,
) -> None:
    with tempfile.TemporaryDirectory() as home_name:
        home = Path(home_name)
        home.chmod(0o777)
        mounts = [(home, "/home/node")]

        run(image, ["true"], env=env, mounts=mounts)
        config = home / relative_path
        assert generated_contains in config.read_text(encoding="utf-8")

        config.unlink()
        run(image, ["true"], env=env, mounts=mounts)
        assert generated_contains in config.read_text(encoding="utf-8")

        config.write_text(user_content, encoding="utf-8")
        run(image, ["true"], env=env, mounts=mounts)
        assert config.read_text(encoding="utf-8") == user_content
