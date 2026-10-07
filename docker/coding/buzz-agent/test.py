from __future__ import annotations

import sys
from pathlib import Path


BUZZ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUZZ_DIR))

from testlib import (  # noqa: E402
    assert_auth_methods,
    assert_common_contract,
    assert_models,
    require_image_argument,
    run_python,
)


image = require_image_argument()
runtime_env = {
    "HYPER_AGENTS_API_KEY": "image-sanity-placeholder",
    "HYPER_API_BASE": "https://api.example.invalid",
}
assert_common_contract(
    image,
    runtime="buzz-agent",
    agent_command="/usr/local/bin/buzz-agent",
    agent_args="",
    entrypoint="/opt/hypercli/bin/entrypoint",
)
assert_auth_methods(
    image,
    agent_command="/usr/local/bin/buzz-agent",
    agent_args="",
    expected=set(),
    env=runtime_env,
)
models = assert_models(
    image,
    agent_command="/usr/local/bin/buzz-agent",
    agent_args="",
    env=runtime_env,
)
assert models["agent"]["name"] == "buzz-agent", models

env_probe = """
import json
import os
from pathlib import Path

env = {
    key: os.environ.get(key)
    for key in (
        "BUZZ_AGENT_PROVIDER",
        "BUZZ_AGENT_MODEL",
        "OPENAI_COMPAT_BASE_URL",
        "OPENAI_COMPAT_API",
        "OPENAI_COMPAT_API_KEY",
        "BUZZ_MODEL_PREFIX",
    )
}
env.update({
    "hypercli_skill_exists": Path("/opt/hypercli/skills/hypercli/SKILL.md").is_file(),
    "legacy_agents_skills_exists": Path("/home/node/.agents/skills").exists(),
    "foreign_harness_dirs_exist": any(
        Path(f"/home/node/{harness}").exists()
        for harness in (".claude", ".codex", ".goose")
    ),
})
print(json.dumps(env))
"""
defaults = run_python(image, env_probe, env=runtime_env)
assert defaults == {
    "BUZZ_AGENT_PROVIDER": "openai",
    "BUZZ_AGENT_MODEL": "coding-anthropic",
    "OPENAI_COMPAT_BASE_URL": "https://api.example.invalid/v1",
    "OPENAI_COMPAT_API": "chat",
    "OPENAI_COMPAT_API_KEY": "image-sanity-placeholder",
    "BUZZ_MODEL_PREFIX": None,
    "hypercli_skill_exists": True,
    "legacy_agents_skills_exists": False,
    "foreign_harness_dirs_exist": False,
}

overrides = {
    **runtime_env,
    "BUZZ_AGENT_PROVIDER": "anthropic",
    "BUZZ_AGENT_MODEL": "user-model",
    "OPENAI_COMPAT_BASE_URL": "",
    "OPENAI_COMPAT_API": "responses",
    "OPENAI_COMPAT_API_KEY": "user-key",
}
preserved = run_python(image, env_probe, env=overrides)
assert preserved == {
    "BUZZ_AGENT_PROVIDER": "anthropic",
    "BUZZ_AGENT_MODEL": "user-model",
    "OPENAI_COMPAT_BASE_URL": "",
    "OPENAI_COMPAT_API": "responses",
    "OPENAI_COMPAT_API_KEY": "user-key",
    "BUZZ_MODEL_PREFIX": None,
    "hypercli_skill_exists": True,
    "legacy_agents_skills_exists": False,
    "foreign_harness_dirs_exist": False,
}

for api_base in ("https://api.example.invalid/", "https://api.example.invalid/v1/"):
    resolved = run_python(image, env_probe, env={**runtime_env, "HYPER_API_BASE": api_base})
    assert resolved == defaults, resolved

empty_key = run_python(
    image, env_probe, env={**runtime_env, "OPENAI_COMPAT_API_KEY": ""},
)
assert empty_key == {**defaults, "OPENAI_COMPAT_API_KEY": ""}, empty_key

print(f"{image}: native Buzz Agent contract passed")
