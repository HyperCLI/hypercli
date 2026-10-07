from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path


BUZZ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUZZ_DIR))

from testlib import (  # noqa: E402
    assert_auth_methods,
    assert_common_contract,
    assert_models,
    assert_runtime_auth_wrapper,
    require_image_argument,
    run,
)


image = require_image_argument()
assert_common_contract(
    image,
    runtime="claude-code",
    agent_command="/opt/hypercli/bin/claude-agent-acp",
    agent_args="",
    entrypoint="/opt/hypercli/bin/claude-entrypoint",
)
assert_auth_methods(
    image,
    agent_command="/opt/hypercli/bin/claude-agent-acp",
    agent_args="",
    expected={"claude-ai-login", "console-login"},
    terminal={"claude-ai-login", "console-login"},
)
assert_runtime_auth_wrapper(
    image,
    runtime_command="/usr/local/bin/hypercli-claude-auth",
)

claude_path = run(image, ["sh", "-lc", "command -v claude"]).stdout.strip()
assert claude_path == "/opt/hypercli/bin/claude", claude_path

with tempfile.TemporaryDirectory() as home_name:
    home = Path(home_name)
    home.chmod(0o777)
    mounts = [(home, "/home/node")]
    settings = home / ".claude/settings.json"
    marker = home / ".claude/.hypercli-settings.json"

    # Native is the default and must not manufacture a Kimi catalog.
    run(image, ["true"], mounts=mounts)
    assert not settings.exists()
    assert not marker.exists()

    legacy = {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "model": "kimi-k2.6-anthropic",
        "availableModels": ["kimi-k2.6-anthropic"],
    }
    settings.write_text(json.dumps(legacy) + "\n", encoding="utf-8")
    run(image, ["true"], mounts=mounts)
    assert not settings.exists()

    # Any deviation from the exact old generated shape is user-owned.
    user_settings = {**legacy, "enabledPlugins": {"example": True}}
    settings.write_text(json.dumps(user_settings) + "\n", encoding="utf-8")
    run(image, ["true"], mounts=mounts)
    assert json.loads(settings.read_text(encoding="utf-8")) == user_settings
    settings.unlink()

    compatibility_env = {
        "HYPERCLI_RUNTIME_INFERENCE": "hypercli",
        "BUZZ_ACP_MODEL": "runtime-model",
        "HYPER_API_BASE": "https://api.dev.hypercli.com/",
        "HYPER_AGENTS_API_KEY": "runtime-secret",
    }
    run(image, ["true"], env=compatibility_env, mounts=mounts)
    configured = json.loads(settings.read_text(encoding="utf-8"))
    assert configured == {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "model": "runtime-model",
        "availableModels": ["runtime-model"],
    }
    assert json.loads(marker.read_text(encoding="utf-8")) == {
        "managed_by": "hypercli",
        "version": 1,
        "model": "runtime-model",
    }
    assert "runtime-secret" not in settings.read_text(encoding="utf-8")
    assert "runtime-secret" not in marker.read_text(encoding="utf-8")

    # Returning to native removes only the marked, still-unmodified catalog.
    run(image, ["true"], mounts=mounts)
    assert not settings.exists()
    assert not marker.exists()

    default_env = {
        "HYPERCLI_RUNTIME_INFERENCE": "hypercli",
        "HYPER_API_BASE": "https://api.dev.hypercli.com/",
        "HYPER_AGENTS_API_KEY": "runtime-secret",
    }
    run(image, ["true"], env=default_env, mounts=mounts)
    configured = json.loads(settings.read_text(encoding="utf-8"))
    assert configured == {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "model": "coding-anthropic",
        "availableModels": ["coding-anthropic"],
    }
    assert json.loads(marker.read_text(encoding="utf-8")) == {
        "managed_by": "hypercli",
        "version": 1,
        "model": "coding-anthropic",
    }
    run(image, ["true"], mounts=mounts)
    assert not settings.exists()
    assert not marker.exists()

    # A user edit relinquishes ownership and survives a native-mode launch.
    run(image, ["true"], env=compatibility_env, mounts=mounts)
    edited = json.loads(settings.read_text(encoding="utf-8"))
    edited["permissions"] = {"allow": ["Read"]}
    settings.write_text(json.dumps(edited) + "\n", encoding="utf-8")
    run(image, ["true"], mounts=mounts)
    assert json.loads(settings.read_text(encoding="utf-8")) == edited
    assert not marker.exists()

    # A persisted marker symlink must be replaced, never followed. Atomic
    # replacement also avoids modifying a hard-linked target in place.
    settings.unlink()
    victim = home / "must-not-be-overwritten"
    victim.write_text("preserve me\n", encoding="utf-8")
    victim.chmod(0o666)
    marker.symlink_to(victim)
    run(image, ["true"], env=compatibility_env, mounts=mounts)
    assert victim.read_text(encoding="utf-8") == "preserve me\n"
    assert marker.is_file() and not marker.is_symlink()
    assert json.loads(marker.read_text(encoding="utf-8"))["managed_by"] == "hypercli"

invalid_mode = run(
    image,
    ["true"],
    env={"HYPERCLI_RUNTIME_INFERENCE": "true"},
    check=False,
)
assert invalid_mode.returncode == 2
assert "unsupported HYPERCLI_RUNTIME_INFERENCE" in invalid_mode.stderr

login_help = run(image, ["claude", "auth", "login", "--help"]).stdout
assert "--claudeai" in login_help
assert "--console" in login_help
assert "--sso" in login_help
status = run(image, ["claude", "auth", "status", "--json"], check=False)
assert status.returncode == 1
assert json.loads(status.stdout)["loggedIn"] is False
wrapper_status = run(image, ["hypercli-runtime-auth", "status"], check=False)
assert wrapper_status.returncode == 0
assert json.loads(wrapper_status.stdout) == {
    "runtime": "claude-code",
    "authenticated": False,
}
wrapper_login_help = run(
    image,
    ["hypercli-runtime-auth", "login", "--help"],
).stdout
assert "--claudeai" in wrapper_login_help
wrapper_token_help = run(
    image,
    ["hypercli-runtime-auth", "setup-token", "--help"],
).stdout
assert "setup-token" in wrapper_token_help.lower()
assert_models(
    image,
    agent_command="/opt/hypercli/bin/claude-agent-acp",
    agent_args="",
    env={
        "HYPERCLI_RUNTIME_INFERENCE": "hypercli",
        "BUZZ_ACP_MODEL": "runtime-model",
        "HYPER_API_BASE": "https://api.dev.hypercli.com/",
        "HYPER_AGENTS_API_KEY": "runtime-secret",
    },
)

print(f"{image}: Claude Code contract passed")
