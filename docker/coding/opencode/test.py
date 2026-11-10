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
    terminal={"opencode-login"},
)

login_result = run(image, ["opencode", "auth", "login", "--help"])
login_help = login_result.stdout + login_result.stderr
assert "[<target>]" in login_help
assert "--method" in login_help
list_result = run(image, ["opencode", "auth", "list"])
assert "No authenticated integrations" in list_result.stdout + list_result.stderr
assert_models(
    image,
    agent_command="/opt/hypercli/bin/opencode",
    agent_args="acp",
)

# The gateway deliberately routes default-anthropic to 128k GLM Flash,
# while the other image aliases route to 256k Kimi. Check the actual COPY
# and first-boot seed path, not just the source JSON. These native limits
# drive context accounting/compaction before a request reaches the gateway.
run(
    image,
    ["python3", "-c", """
import json
import os
from pathlib import Path

baked = json.loads(Path('/opt/hypercli/share/runtime/opencode.json').read_text())
seeded = json.loads((Path(os.environ['OPENCODE_CONFIG_DIR']) / 'opencode.json').read_text())
assert seeded == baked
assert seeded['model'] == 'hypercli/default-anthropic'
models = seeded['provider']['hypercli']['models']
expected_context = {
    'default': 262144,
    'default-anthropic': 131072,
    'coding': 262144,
    'coding-anthropic': 262144,
    'kimi-k3': 262144,
    'kimi-k3-anthropic': 262144,
}
assert set(models) == set(expected_context)
for alias, context in expected_context.items():
    assert models[alias]['limit'] == {'context': context, 'output': 65536}, alias
"""],
)
assert_user_config_preserved(
    image,
    relative_path=".config/opencode/opencode.json",
    generated_contains="hypercli/default-anthropic",
    user_content=json.dumps({
        "userManaged": True,
        "agent": {"personal": {"mode": "primary", "permission": {"*": "ask"}}},
        "provider": {"hypercli": {"models": {
            "default-anthropic": {"limit": {"context": 262144, "output": 32768}}
        }}},
    }) + "\n",
)

entrypoint_env = run(
    image,
    ["sh", "-c", "printf '%s' \"${HYPER_MCP_API_KEY}\""],
    env={
        "HYPER_API_KEY": "long-term-user-key",
        "HYPER_AGENTS_API_KEY": "runtime-injected-key",
    },
)
# Product MCP credentials arrive in standard SDK session setup.
assert entrypoint_env.stdout == ""

runtime_env = run(
    image,
    ["sh", "-c", "printf '%s' \"${HYPER_MCP_API_KEY}\""],
    env={"HYPER_AGENTS_API_KEY": "runtime-injected-key"},
)
assert runtime_env.stdout == ""

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
