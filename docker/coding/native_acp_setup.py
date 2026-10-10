"""Test-only stdio initialize/session-new capture; never prompts or publishes."""
import json
import os
import select
import shlex
import subprocess
import sys
import time

command = (json.loads(sys.argv[2]) if len(sys.argv) > 2 else
           [os.environ["BUZZ_ACP_AGENT_COMMAND"], *shlex.split(os.environ.get("BUZZ_ACP_AGENT_ARGS", ""))])
child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, bufsize=0)
buffer = b""


def request(identifier, method, params):
    global buffer
    child.stdin.write((json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}) + "\n").encode())
    child.stdin.flush()
    deadline = time.monotonic() + 30
    while True:
        while b"\n" not in buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([child.stdout], [], [], remaining)[0]:
                raise RuntimeError(f"native {method} timed out")
            data = os.read(child.stdout.fileno(), 65536)
            if not data:
                raise RuntimeError(f"native {method} transport closed")
            buffer += data
        line, buffer = buffer.split(b"\n", 1)
        frame = json.loads(line)
        if frame.get("id") == identifier and "method" not in frame:
            if "error" in frame:
                raise RuntimeError(f"native {method} error code={frame['error'].get('code')}")
            return frame["result"]


try:
    initialized = request(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {}})
    assert initialized["protocolVersion"] == 1
    result = {"initialize": initialized}
    if sys.argv[1] == "session/new":
        result["session"] = request(2, "session/new", {"cwd": os.getcwd(), "mcpServers": []})
    else:
        assert sys.argv[1] == "initialize"
    print(json.dumps(result))
finally:
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
