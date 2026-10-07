from __future__ import annotations

import json
import sys
from pathlib import Path


CODING_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CODING_DIR))

from testlib import (  # noqa: E402
    assert_entrypoint_exit_passthrough,
    assert_workspace_persistence,
    docker,
    image_config,
    require_image_argument,
    run,
)


image = require_image_argument()
config = image_config(image)
env = dict(item.split("=", 1) for item in config["Env"])
labels = config["Labels"]
assert config["User"] == "node"
assert config["WorkingDir"] == "/home/node"
assert config["Entrypoint"] == [
    "/usr/bin/tini",
    "--",
    "/opt/hypercli/bin/pi-entrypoint",
]
assert config["Cmd"] == ["/usr/local/bin/hyper-acp"]
assert labels["org.hypercli.coding_runtime"] == "pi"
assert env["HOME"] == "/home/node"
assert env["HYPER_ACP_AGENT_COMMAND"] == "/opt/hypercli/bin/pi-acp"
assert env["HYPER_ACP_AGENT_ARGS"] == ""
assert env["PI_ACP_PI_COMMAND"] == "/opt/hypercli/bin/pi"
assert env["HYPER_RUNTIME_HOME"] == "/home/node/.pi/agent"
assert "PI_CODING_AGENT_DIR" not in env
for key in ("BUZZ_ACP_AGENT_COMMAND", "BUZZ_ACP_MCP_COMMAND", "HYPER_ACP_BASE_PROMPT_FILE"):
    assert key not in env

assert run(image, ["pi", "--version"]).stdout.strip() == labels[
    "org.hypercli.coding_runtime_version"
]
assert "--mode" in run(image, ["pi", "--help"]).stdout
assert "--ws-url" in run(image, ["hyper-acp", "--help"]).stdout

# All probes run in disposable container homes with networking disabled. Keep
# stdin open until initialize responds: pi-acp exits immediately on stdin EOF.
probe = r'''
import json
import os
import selectors
import shutil
import subprocess
from pathlib import Path

assert os.environ["HOME"] == "/home/node"
assert os.getcwd() == "/home/node"
assert shutil.which("pi") == os.environ["PI_ACP_PI_COMMAND"]
assert shutil.which("pi-acp") == os.environ["HYPER_ACP_AGENT_COMMAND"]
assert Path("/opt/hypercli/share/runtime/runtime").read_text().strip() == "pi"
assert not Path("AGENTS.md").exists()
# The entrypoint seeds the canonical template into the resolved pi agent dir:
# $PI_CODING_AGENT_DIR when set, else the default $HOME/.pi/agent. Probe the
# location this container actually resolved to.
agents = Path(os.environ.get("PI_CODING_AGENT_DIR", ".pi/agent")) / "AGENTS.md"
assert agents.is_file() and not agents.is_symlink()
agents_text = agents.read_text(encoding="utf-8")
assert "~/.hypercli/USER.md" in agents_text and "~/.hypercli/SOUL.md" in agents_text
version = subprocess.check_output(["node", "--version"], text=True).strip()
assert tuple(map(int, version.lstrip("v").split("."))) >= (22, 19, 0)
state = subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {getAgentDir} from '/opt/hypercli/lib/node_modules/@earendil-works/pi-coding-agent/dist/config.js'; console.log(getAgentDir())",
], text=True).strip()
assert state == os.environ["PI_CODING_AGENT_DIR"]
child = subprocess.Popen([os.environ["HYPER_ACP_AGENT_COMMAND"]],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    child.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": 1, "clientCapabilities": {}}}) + "\n")
    child.stdin.flush()
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=20), "ACP initialize timed out"
        response = json.loads(child.stdout.readline())
    assert response["id"] == 1 and "error" not in response, response
    result = response["result"]
    assert result["protocolVersion"] == 1, result
    assert result["agentInfo"]["name"] == "pi-acp", result
    print(json.dumps({"uid": os.getuid(), "node": version, "state": state,
        "adapter": result["agentInfo"]}))
finally:
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
'''
for user in ("node", "root"):
    result = docker(
        "run", "--rm", "--network", "none", "--user", user,
        image, "python3", "-c", probe,
    )
    payload = json.loads(result.stdout)
    assert payload["uid"] == (1000 if user == "node" else 0)
    assert payload["adapter"]["version"] == labels["org.hypercli.acp_adapter_version"]
    print(f"{user}: {json.dumps(payload)}")

override = json.loads(run(
    image, ["python3", "-c", probe],
    env={"PI_CODING_AGENT_DIR": "/tmp/pi-contract-state"},
).stdout)
assert override["state"] == "/tmp/pi-contract-state"
assert_entrypoint_exit_passthrough(image)
assert_workspace_persistence(image, runtime="pi")
print(f"{image}: Pi image contract and offline ACP initialize passed")
