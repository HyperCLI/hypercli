from __future__ import annotations

import ast
import json
import os
import shlex
import sys
from pathlib import Path
from uuid import uuid4


BUZZ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUZZ_DIR))

from testlib import (  # noqa: E402
    assert_auth_methods,
    assert_common_contract,
    assert_models,
    assert_user_config_preserved,
    docker,
    require_image_argument,
    run_python,
)


def assert_exec_models(image: str, env: dict[str, str]) -> None:
    # Exercise the actual smoke command without importing live smoke fixtures.
    smoke = Path(os.environ["HYPERCLI_TEST_SMOKE_HELPERS"])
    tree = ast.parse(smoke.read_text())
    probe = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_acp_probe_command"
    )
    namespace = {}
    exec(compile(ast.Module(body=[probe], type_ignores=[]), str(smoke), "exec"), namespace)
    command = shlex.split(namespace["_acp_probe_command"]("goose"))
    source = r'''
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import time

deadline = time.monotonic() + 15
ready = Path('/tmp/goose-exec-ready')
root = os.environ['HYPER_RUNTIME_HOME']
while (not ready.exists() or ready.read_text() != root) and time.monotonic() < deadline:
    time.sleep(0.1)
assert ready.exists(), 'entrypoint did not become ready'
assert 'GOOSE_PATH_ROOT' not in os.environ, 'exec inherited startup exports'
assert ready.read_text() == root
assert (Path(root) / 'config/config.yaml').is_file()
assert (Path(root) / 'config/custom_providers/hypercli.json').is_file()

# Initialize does not need provider config; session/new does. Capture the
# real child's structured error, which the launcher reduces to Internal error.
child = subprocess.Popen(['goose', 'acp'], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    def request(number, method, params):
        child.stdin.write(json.dumps(dict(jsonrpc='2.0', id=number,
                                         method=method, params=params)) + '\n')
        child.stdin.flush()
        assert select.select([child.stdout], [], [], 15)[0], 'ACP response timeout'
        response = json.loads(child.stdout.readline())
        assert response['id'] == number
        return response

    initialized = request(1, 'initialize', dict(protocolVersion=1, clientCapabilities={}))
    assert initialized['result']['agentInfo']['name'] == 'goose'
    session = request(2, 'session/new', dict(cwd='/home/node', mcpServers=[]))
    assert session['error']['code'] == -32603
    assert session['error']['data'] == (
        'Failed to resolve provider: Configuration value not found: GOOSE_PROVIDER'
    )
finally:
    child.terminate()
    child.communicate(timeout=10)

bare = subprocess.run(['hyper-acp', 'plugin', 'buzz', 'models', '--json'],
                      capture_output=True, text=True, timeout=60)
assert bare.returncode != 0
assert 'Agent reported error (code -32603): Internal error' in bare.stderr
wrapped = subprocess.run(json.loads(sys.argv[1]) + ['models', '--json'],
                         capture_output=True, text=True, timeout=60)
assert wrapped.returncode == 0, 'wrapped models failed'
models = json.loads(wrapped.stdout)
assert models['agent']['name'] == 'goose'
assert isinstance(models['stable'], dict)
print('Goose pod-exec config/session/models regression passed')
'''
    for root in ("/home/node/.goose", "/home/node/custom-goose"):
        name = f"hypercli-goose-exec-{uuid4().hex}"
        args = ["run", "--detach", "--network", "none", "--name", name]
        for key, value in {
            **env,
            "HYPER_RUNTIME_HOME": root,
            "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/goose",
            "BUZZ_ACP_AGENT_ARGS": "acp",
        }.items():
            args.extend(["--env", f"{key}={value}"])
        try:
            docker(*args, image, "python3", "-c", (
                "import os,time; from pathlib import Path; "
                "Path('/tmp/goose-exec-ready').write_text(os.environ['GOOSE_PATH_ROOT']); "
                "time.sleep(180)"
            ))
            docker("exec", name, "/bin/sh", "-lc", shlex.join([
                "python3", "-c", source, json.dumps(command),
            ]))
        finally:
            docker("rm", "--force", name)


image = require_image_argument()
runtime_env = {
    "HYPER_API_KEY": "image-sanity-placeholder",
    "HYPER_API_BASE": "https://api.example.invalid",
}
assert_common_contract(
    image,
    runtime="goose",
    agent_command="/usr/local/bin/goose",
    agent_args="acp",
    entrypoint="/opt/hypercli/bin/goose-entrypoint",
)
assert_auth_methods(
    image,
    agent_command="/usr/local/bin/goose",
    agent_args="acp",
    expected={"goose-provider"},
    env=runtime_env,
)
assert_models(
    image,
    agent_command="/usr/local/bin/goose",
    agent_args="acp",
    env=runtime_env,
)
assert_exec_models(image, runtime_env)
provider_probe = """
import json
import os
from pathlib import Path

provider = json.loads(Path('/opt/hypercli/share/runtime/goose-provider.json').read_text())
models = {model['name']: model for model in provider['models']}
config_text = Path('/opt/hypercli/share/runtime/goose-config.yaml').read_text()
print(json.dumps({
    'model_names': sorted(models),
    'context_limits': {name: model.get('context_limit') for name, model in models.items()},
    'reasoning': {name: model.get('reasoning') for name, model in models.items()},
    'config_text': config_text,
    'api_key_env': provider['api_key_env'],
    'base_url': provider['base_url'],
    'env_vars': provider['env_vars'],
    'agent_command': os.environ.get('HYPER_ACP_AGENT_COMMAND'),
    'model_prefix': os.environ.get('BUZZ_MODEL_PREFIX'),
    'legacy_agents_skills_exists': Path('/home/node/.agents/skills').exists(),
    'goose_skills_exists': Path('/home/node/.goose/skills').exists(),
}))
"""
provider_contract = run_python(image, provider_probe, env=runtime_env)
assert provider_contract["api_key_env"] == "HYPER_RUNTIME_API_KEY"
assert provider_contract["base_url"] == "${HYPER_API_BASE}"
assert provider_contract["env_vars"] == [{
    "name": "HYPER_API_BASE", "required": False, "secret": False,
    "default": "https://api.hypercli.com",
}]
assert provider_contract["model_names"] == [
    "coding",
    "coding-anthropic",
    "default",
    "default-anthropic",
    "kimi-k3",
    "kimi-k3-anthropic",
]
assert set(provider_contract["context_limits"].values()) == {262144}
assert set(provider_contract["reasoning"].values()) == {True}
config_text = provider_contract["config_text"]
for expected_config in [
    "active_provider: hypercli",
    "model: coding-anthropic",
    "  developer:",
    "    type: builtin",
    "  memory:",
    "  skills:",
    "    type: platform",
]:
    assert expected_config in config_text, config_text
assert provider_contract["agent_command"] == "/usr/local/bin/goose"
assert provider_contract["model_prefix"] is None
assert provider_contract["legacy_agents_skills_exists"] is False
assert provider_contract["goose_skills_exists"] is False
assert_user_config_preserved(
    image,
    relative_path=".goose/config/config.yaml",
    generated_contains="active_provider: hypercli",
    user_content="user_managed: true\n",
    env=runtime_env,
)
assert_user_config_preserved(
    image,
    relative_path=".goose/config/custom_providers/hypercli.json",
    generated_contains='"engine": "anthropic"',
    user_content='{"user_managed": true}\n',
    env=runtime_env,
)

print(f"{image}: Goose contract passed")
