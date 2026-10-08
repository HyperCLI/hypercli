from __future__ import annotations

import json
import sys
from pathlib import Path


BUZZ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUZZ_DIR))

from testlib import (  # noqa: E402
    assert_auth_methods,
    assert_common_contract,
    assert_models,
    assert_user_config_preserved,
    require_image_argument,
    run,
)


image = require_image_argument()
assert_common_contract(
    image,
    runtime="opencode",
    agent_command="/opt/hypercli/bin/opencode",
    agent_args="acp",
    entrypoint="/opt/hypercli/bin/opencode-entrypoint",
)
assert_auth_methods(
    image,
    agent_command="/opt/hypercli/bin/opencode",
    agent_args="acp",
    expected={"opencode-login"},
    # 1.18.9 advertises the v1 default agent method, not type=terminal.
    # Its human-readable CLI instruction is not a routing capability.
)

login_result = run(image, ["opencode", "auth", "login", "--help"])
login_help = login_result.stdout + login_result.stderr
assert "--provider" in login_help
assert "--method" in login_help
list_result = run(image, ["opencode", "auth", "list"])
assert "0 credentials" in list_result.stdout + list_result.stderr
assert_models(
    image,
    agent_command="/opt/hypercli/bin/opencode",
    agent_args="acp",
)
assert_user_config_preserved(
    image,
    relative_path=".config/opencode/opencode.json",
    generated_contains="https://docs.hypercli.com/mcp",
    user_content=json.dumps({"userManaged": True}) + "\n",
)

entrypoint_env = run(
    image,
    ["sh", "-c", "printf '%s' \"${HYPER_MCP_API_KEY}\""],
    env={
        "HYPER_API_KEY": "long-term-user-key",
        "HYPER_AGENTS_API_KEY": "runtime-injected-key",
    },
)
# The canonical key wins; the legacy key is only a final fallback.
assert entrypoint_env.stdout == "long-term-user-key"

runtime_env = run(
    image,
    ["sh", "-c", "printf '%s' \"${HYPER_MCP_API_KEY}\""],
    env={"HYPER_AGENTS_API_KEY": "runtime-injected-key"},
)
assert runtime_env.stdout == "runtime-injected-key"

explicit_mcp = run(
    image,
    ["sh", "-c", "printf '%s' \"${HYPER_MCP_API_KEY}\""],
    env={
        "HYPER_MCP_API_KEY": "explicit-mcp-key",
        "HYPER_API_KEY": "canonical-key",
        "HYPER_AGENTS_API_KEY": "legacy-key",
    },
)
assert explicit_mcp.stdout == "explicit-mcp-key"

model_prefix = run(
    image,
    ["sh", "-c", "printf '%s' \"${BUZZ_MODEL_PREFIX}\""],
)
assert model_prefix.stdout == "hypercli/"

# opencode's startup scratch dir must be creatable/writable by the runtime
# user (node); the build-time version smoke check must not leave it
# root-owned.
run(
    image,
    [
        "sh",
        "-c",
        "if [ -e /tmp/opencode ]; then test -w /tmp/opencode; "
        "else mkdir /tmp/opencode && rmdir /tmp/opencode; fi",
    ],
)

print(f"{image}: OpenCode contract passed")
