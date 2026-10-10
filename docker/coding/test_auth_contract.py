"""Offline auth discovery regressions; never invoke login or inference."""
import ast
import copy
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from testlib import assert_auth_methods, assert_buzz_launch_contract, native_setup_command


ROOT = Path(__file__).parent
RECORDED = json.loads((ROOT / "fixtures/auth-methods.json").read_text())


class AuthContractTests(unittest.TestCase):
    def test_actual_native_helper_terminal_auth_discovery_profile(self):
        child = '''import json, sys
request = json.loads(sys.stdin.readline())
assert request == {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": 1, "clientCapabilities": {"auth": {"terminal": True}}}}
print(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": 1,
    "authMethods": [{"id": "login", "name": "Login", "type": "terminal", "args": []}]}}), flush=True)
sys.stdin.read()
'''
        import shlex
        result = subprocess.run(native_setup_command("initialize", agent_command=sys.executable,
            agent_args=f"-c {shlex.quote(child)}"), capture_output=True, text=True, timeout=10, check=True)
        self.assertEqual(json.loads(result.stdout), {"initialize": {"protocolVersion": 1,
            "authMethods": [{"id": "login", "name": "Login", "type": "terminal", "args": []}]}})

    def test_launch_contract_uses_explicit_parent_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "parent-golden.json"
            fixture.write_text(json.dumps({
                "common": {"command": ["/bin/hyper-acp", "plugin", "buzz"]},
                "runtimes": {"fixture": {"agent_command": "/bin/agent", "agent_args": "acp",
                                          "claude_code_executable": None}},
            }))
            payload = {"uid": 1000, "env": {"BUZZ_ACP_AGENT_COMMAND": "/bin/agent", "BUZZ_ACP_AGENT_ARGS": "acp"},
                       "executables": {"/bin/hyper-acp": True, "/bin/agent": True}}
            with patch.dict(os.environ, {"HYPERCLI_TEST_LAUNCH_CONTRACT": str(fixture)}), \
                    patch("testlib.run_python", return_value=payload), patch("testlib.run") as run:
                assert_buzz_launch_contract("fixture-image", runtime="fixture")
            self.assertEqual(run.call_args.args[1], ["/bin/hyper-acp", "plugin", "buzz", "--help"])

    def check_methods(self, methods, expected, terminal=None):
        with patch("testlib.run_json", return_value={"initialize": {"protocolVersion": 1, "authMethods": methods}}) as run:
            assert_auth_methods("fixture", agent_command="agent", agent_args="",
                                expected=expected, terminal=terminal)
        self.assertEqual(run.call_args.args[1][3], "initialize")
        self.assertEqual(json.loads(run.call_args.args[1][4]), ["agent"])

    def test_recorded_claude(self):
        self.check_methods([RECORDED["claude"]["method"]], {"claude-ai-login"}, {"claude-ai-login"})

    def test_recorded_opencode(self):
        self.check_methods([RECORDED["opencode"]["method"]], {"opencode-login"})

    def test_nullable_metadata_for_agent_and_terminal_auth(self):
        for runtime, expected, terminal in [
            ("opencode", {"opencode-login"}, set()),
            ("claude", {"claude-ai-login"}, {"claude-ai-login"}),
        ]:
            with self.subTest(runtime=runtime):
                method = dict(RECORDED[runtime]["method"], _meta=None)
                self.check_methods([method], expected, terminal)
                self.assertIsNone(method["_meta"])

    def test_recorded_codex_preserves_opaque_upstream_metadata(self):
        # codex-acp 1.1.7 response captured in the failing Codex Build job.
        method = {"id": "api-key", "name": "API Key",
                  "description": "Use an API key to authenticate",
                  "_meta": {"api-key": {"provider": "openai"}}}
        original = copy.deepcopy(method)
        self.check_methods([method], {"api-key"})
        self.assertEqual(method, original)

    def test_upstream_metadata_cannot_select_terminal_routing(self):
        method = dict(RECORDED["opencode"]["method"],
                      _meta={"terminal-auth": {"command": "agent", "args": []}})
        self.check_methods([method], {"opencode-login"})
        with self.assertRaises(AssertionError):
            self.check_methods([method], {"opencode-login"}, {"opencode-login"})

    def test_all_image_auth_call_sites(self):
        # Synthetic coverage of every image's exact IDs and routing contract.
        count = 0
        for source in ROOT.glob("*/test.py"):
            for call in ast.walk(ast.parse(source.read_text())):
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name):
                    continue
                if call.func.id != "assert_auth_methods":
                    continue
                kwargs = {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords
                          if kw.arg in {"expected", "terminal"}}
                methods = [{"id": mid, "name": mid,
                            **({"type": "terminal", "args": []}
                               if mid in kwargs.get("terminal", set()) else {})}
                           for mid in kwargs["expected"]]
                with self.subTest(image=source.parent.name):
                    self.check_methods(methods, **kwargs)
                count += 1
        self.assertEqual(count, 6)

    def test_negative_controls(self):
        original = RECORDED["claude"]["method"]
        mutations = [
            {"_meta": "not-an-object"}, {"_meta": []},
            {"command": "agent"}, {"terminal_auth": True},
            {"id": "unexpected"}, {"type": "unknown"},
            {"args": "login"}, {"args": [1]}, {"env": {"X": 1}},
            {"env": []}, {"name": None}, {"description": 1},
            {"available": True}, {"methodId": "claude-ai-login"},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                self.check_methods([dict(original, **mutation)], {"claude-ai-login"}, {"claude-ai-login"})

    def test_duplicate_and_malformed_methods(self):
        method = RECORDED["opencode"]["method"]
        for methods in ([method, method], [method, None], [method, {}], [], None):
            with self.subTest(methods=methods), self.assertRaises(AssertionError):
                self.check_methods(methods, {"opencode-login"})

    def test_unsupported_terminal_claim(self):
        method = dict(RECORDED["opencode"]["method"], type="terminal", args=[])
        with self.assertRaises(AssertionError):
            self.check_methods([method], {"opencode-login"})

    def test_description_cannot_advertise_terminal(self):
        with self.assertRaises(AssertionError):
            self.check_methods([RECORDED["opencode"]["method"]], {"opencode-login"}, {"opencode-login"})

    def test_v1_optional_terminal_launch_fields(self):
        method = copy.deepcopy(RECORDED["claude"]["method"])
        del method["args"]
        method["env"] = {"LOGIN_MODE": "interactive"}
        self.check_methods([method], {"claude-ai-login"}, {"claude-ai-login"})


if __name__ == "__main__":
    unittest.main()
