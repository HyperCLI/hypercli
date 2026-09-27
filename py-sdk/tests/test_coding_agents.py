"""Contract tests for the canonical hosted coding-agent runtime surface."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import Mock

import pytest

from hypercli.agents import (
    CodingAgent,
    DEFAULT_AGENT_RUNTIME_SCOPES,
    DEFAULT_BUZZ_AGENT_IMAGE,
    DEFAULT_BUZZ_CODING_AGENT_IMAGES,
    DEFAULT_BUZZ_OPENCODE_IMAGE,
    DEFAULT_CLAUDE_CODE_IMAGE,
    DEFAULT_CODING_AGENT_IMAGES,
    DEFAULT_CODEX_IMAGE,
    DEFAULT_GOOSE_IMAGE,
    DEFAULT_KIMI_CODE_IMAGE,
    DEFAULT_PI_ENV,
    DEFAULT_PI_IMAGE,
    DEFAULT_OPENCODE_IMAGE,
    Deployments,
    ExecResult,
    RuntimeAuthClient,
    RuntimeAuthMethod,
    build_permissions_json,
)


_CODEX_0146_DEVICE_AUTH_PROMPT = (
    "\r\nWelcome to Codex [v\x1b[90m0.146.0\x1b[0m]\r\n"
    "\x1b[90mOpenAI's command-line coding agent\x1b[0m\r\n\r\n"
    "Follow these steps to sign in with ChatGPT using device code authorization:\r\n\r\n"
    "1. Open this link in your browser and sign in to your account\r\n"
    "   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\r\n\r\n"
    "2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n"
    "   \x1b[94mABCD-EFGHJ\x1b[0m\r\n\r\n"
    "\x1b[90mContinue only if you started this login in Codex. If a website or another "
    "person gave you this code, cancel.\x1b[0m\r\n\r\n"
)


def test_generic_and_buzz_image_catalogs_are_explicit():
    assert DEFAULT_CODING_AGENT_IMAGES == {
        "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
        "opencode": DEFAULT_OPENCODE_IMAGE,
        "codex": DEFAULT_CODEX_IMAGE,
        "claude-code": DEFAULT_CLAUDE_CODE_IMAGE,
        "goose": DEFAULT_GOOSE_IMAGE,
        "kimi-code": DEFAULT_KIMI_CODE_IMAGE,
        "pi": DEFAULT_PI_IMAGE,
    }
    assert DEFAULT_BUZZ_CODING_AGENT_IMAGES == {
        "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
        "opencode": DEFAULT_BUZZ_OPENCODE_IMAGE,
        "codex": DEFAULT_CODEX_IMAGE,
        "claude-code": DEFAULT_CLAUDE_CODE_IMAGE,
        "goose": DEFAULT_GOOSE_IMAGE,
        "kimi-code": DEFAULT_KIMI_CODE_IMAGE,
        "pi": DEFAULT_PI_IMAGE,
    }
    assert DEFAULT_BUZZ_CODING_AGENT_IMAGES == DEFAULT_CODING_AGENT_IMAGES


def _agent_payload(runtime: str) -> dict:
    return {
        "id": f"{runtime}-1",
        "user_id": "user-1",
        "state": "starting",
        "runtime": runtime,
    }


def test_goose_uses_injected_runtime_key_and_has_no_destructive_logout():
    agent = CodingAgent.from_dict(_agent_payload("goose"))
    agent._deployments = Mock()

    with pytest.raises(RuntimeError, match="injected deployment credential"):
        agent.auth.logout()


def test_codex_auth_methods_merge_acp_and_native_device_login():
    agent = CodingAgent.from_dict(_agent_payload("codex"))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(
        exit_code=0,
        stdout="""{
          "methods": [{
            "id": "api-key",
            "name": "API key",
            "description": "Use an injected credential"
          }]
        }""",
        stderr="",
    )

    methods = agent.auth.methods()

    assert [method.id for method in methods] == ["api-key", "device"]
    assert methods[1].command == ("codex", "login", "--device-auth")
    command = agent._deployments.exec.call_args.args[1]
    assert command == [
        "hyper-acp",
            "plugin",
            "auth-methods",
        "--agent-command",
        "codex-acp",
        "--json",
    ]


def test_pi_auth_methods_use_the_native_adapter_terminal_login():
    agent = CodingAgent.from_dict(_agent_payload("pi"))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(
        exit_code=0,
        stdout=json.dumps({"methods": [{
            "id": "pi_terminal_login",
            "name": "Launch pi in the terminal",
            "type": "terminal",
            "_meta": {"terminal-auth": {
                "command": "pi-acp", "args": ["--terminal-login"],
            }},
        }]}),
        stderr="",
    )
    methods = agent.auth.methods()
    assert len(methods) == 1
    assert methods[0].command == ("pi-acp", "--terminal-login")
    assert agent._deployments.exec.call_args.args[1] == [
        "hyper-acp", "plugin", "auth-methods", "--agent-command", "pi-acp", "--json",
    ]


def test_claude_auth_methods_honor_adapter_terminal_metadata():
    agent = CodingAgent.from_dict(_agent_payload("claude-code"))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(
        exit_code=0,
        stdout="""{
          "methods": [{
            "id": "claude-login",
            "name": "Claude login",
            "_meta": {
              "terminal-auth": {
                "command": "node",
                "args": ["/opt/claude/cli.js"]
              }
            }
          }, {
            "id": "console-login",
            "name": "Console login",
            "type": "terminal",
            "command": ["claude", "auth", "login", "--console"]
          }]
        }""",
        stderr="",
    )

    methods = {method.id: method for method in agent.auth.methods()}

    assert methods["claude-login"].command == (
        "node",
        "/opt/claude/cli.js",
        "auth",
        "login",
    )
    assert methods["console-login"].command == (
        "claude",
        "auth",
        "login",
        "--console",
    )


class _LoginSocket:
    def __init__(self, messages=None):
        self.sent: list[str] = []
        self.closed = False
        self._messages = iter(
            messages
            if messages is not None
            else ["Open https://auth.example/device and enter device code ABCD-EFGH"]
        )

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._messages)
        except StopIteration:
            raise StopAsyncIteration

    async def send(self, value):
        self.sent.append(value)

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_adapter_owned_login_uses_buzz_acp_authenticate():
    socket = _LoginSocket(
        messages=["Open https://auth.example/device and enter device code ACP-1234\n"]
    )
    deployments = Mock()

    async def shell_connect(_agent_id, shell=None):
        assert shell is None
        return socket

    deployments.shell_connect = shell_connect
    agent = CodingAgent.from_dict(_agent_payload("opencode"))
    agent._deployments = deployments
    auth = RuntimeAuthClient(agent)
    auth.methods = lambda: [
        RuntimeAuthMethod(
            id="oauth",
            name="OpenCode OAuth",
            kind="acp",
        )
    ]

    session = await auth.login("oauth")

    assert session.verification_url == "https://auth.example/device"
    assert session.user_code == "ACP-1234"
    assert socket.sent[0].startswith(
        "hyper-acp plugin authenticate --agent-command opencode "
        "--agent-args acp --method-id oauth;"
    )
    await session.cancel()


@pytest.mark.parametrize(
    ("runtime", "output", "expected"),
    [
        ("opencode", "0 credentials", False),
        ("codex", "Logged in using ChatGPT", True),
        ("codex", "Not logged in", False),
    ],
)
def test_runtime_auth_status_normalization(runtime, output, expected):
    agent = CodingAgent.from_dict(_agent_payload(runtime))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(0, output, "")

    assert agent.auth.status().authenticated is expected


@pytest.mark.asyncio
async def test_login_uses_existing_authenticated_shell_and_parses_device_challenge():
    split_url = _CODEX_0146_DEVICE_AUTH_PROMPT.index("codex/device") + len("cod")
    split_code = _CODEX_0146_DEVICE_AUTH_PROMPT.index("ABCD-EFGHJ") + len("ABCD-")
    socket = _LoginSocket(
        messages=[
            "\x1b]0;codex login --device-auth",
            "\x07" + _CODEX_0146_DEVICE_AUTH_PROMPT[:split_url],
            _CODEX_0146_DEVICE_AUTH_PROMPT[split_url:split_code],
            _CODEX_0146_DEVICE_AUTH_PROMPT[split_code:],
        ]
    )
    deployments = Mock()

    async def shell_connect(_agent_id, shell=None):
        assert shell is None
        return socket

    deployments.shell_connect = shell_connect
    agent = CodingAgent.from_dict(_agent_payload("codex"))
    agent._deployments = deployments
    auth = RuntimeAuthClient(agent)
    auth.methods = lambda: [
        RuntimeAuthMethod(
            id="device",
            name="Device login",
            kind="device",
            command=("codex", "login", "--device-auth"),
        )
    ]

    session = await auth.login("device")

    assert session.verification_url == "https://auth.openai.com/codex/device"
    assert session.user_code == "ABCD-EFGHJ"
    assert "device code authorization" in session.instructions
    assert "\x1b" not in session.output
    assert socket.sent[0].startswith("codex login --device-auth;")
    await session.cancel()
    assert socket.closed is True


class _HangingLoginSocket(_LoginSocket):
    def __init__(self):
        super().__init__(["Open https://auth.example/device and enter device code ABCD-EFGH\n"])
        self._block = asyncio.Event()

    async def __anext__(self):
        try:
            return next(self._messages)
        except StopIteration:
            await self._block.wait()
            raise StopAsyncIteration


@pytest.mark.asyncio
async def test_login_wait_timeout_cancels_shell_session():
    socket = _HangingLoginSocket()
    deployments = Mock()

    async def shell_connect(_agent_id, shell=None):
        return socket

    deployments.shell_connect = shell_connect
    agent = CodingAgent.from_dict(_agent_payload("codex"))
    agent._deployments = deployments
    auth = RuntimeAuthClient(agent)
    auth.methods = lambda: [
        RuntimeAuthMethod(
            id="device",
            name="Device login",
            kind="device",
            command=("codex", "login", "--device-auth"),
        )
    ]

    session = await auth.login("device")

    with pytest.raises(TimeoutError, match="Timed out waiting for codex login"):
        await session.wait(timeout=0)
    assert socket.closed is True
    assert "\x03" in socket.sent


def test_claude_status_parses_json_without_exposing_credentials():
    agent = CodingAgent.from_dict(_agent_payload("claude-code"))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(
        0,
        '{"loggedIn":true,"subscriptionType":"pro","email":"dev@example.com",'
        '"loginMethod":"claudeai"}',
        "",
    )

    status = agent.auth.status()

    assert status.authenticated is True
    assert status.provider == "pro"
    assert status.account == "dev@example.com"
    assert status.method == "claudeai"


def test_claude_status_parses_current_unauthenticated_cli_shape():
    agent = CodingAgent.from_dict(_agent_payload("claude-code"))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(
        1,
        '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}',
        "",
    )

    status = agent.auth.status()

    assert status.authenticated is False
    assert status.provider == "firstParty"
    assert status.method == "none"


def _created_agent_payload(runtime: str) -> dict:
    return {
        "id": "agent-1",
        "user_id": "user-1",
        "state": "CREATING",
        "runtime": runtime,
    }


def _capture_create(monkeypatch, runtime: str = "opencode"):
    http = Mock()
    http.api_key = "hyper_api_test"
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    posts = []

    def fake_post(path, json=None):
        posts.append((path, json))
        return _created_agent_payload(runtime)

    monkeypatch.setattr(deployments, "_post", fake_post)
    return deployments, posts


class TestCreateCodingAgent:
    """ts createCodingAgent parity: one launch contract, runtime-keyed defaults."""

    @pytest.mark.parametrize(
        "runtime",
        ["buzz-agent", "opencode", "codex", "claude-code", "goose", "kimi-code", "pi"],
    )
    def test_runtime_keyed_default_launch_shape(self, monkeypatch, runtime):
        deployments, posts = _capture_create(monkeypatch, runtime)

        agent = deployments.create_coding_agent(runtime)

        assert isinstance(agent, CodingAgent)
        assert agent.id == "agent-1"
        assert posts[0][0] == "/deployments"
        body = posts[0][1]
        assert body["runtime"] == runtime
        assert body["image"] == DEFAULT_CODING_AGENT_IMAGES[runtime]
        assert body["command"] == ["/usr/local/bin/hyper-acp"]
        assert body["sync_root"] == "/home/node"
        assert body["sync_uid"] == 1000
        assert body["sync_gid"] == 1000
        assert body["runtime_scopes"] == list(DEFAULT_AGENT_RUNTIME_SCOPES)
        assert body["routes"] == {}
        env = body["env"]
        assert env["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert env["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
        assert env["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert env["HYPER_ACP_PERMISSIONS"] == '{"*":"allow"}'
        assert "HYPER_ACP_PERMISSION_MODE" not in env

    @pytest.mark.parametrize(
        "runtime",
        ["opencode", "codex", "claude-code", "goose", "kimi-code", "pi"],
    )
    def test_default_sync_policy_uses_runtime_include(self, monkeypatch, runtime):
        deployments, posts = _capture_create(monkeypatch, runtime)

        deployments.create_coding_agent(runtime)

        body = posts[0][1]
        assert "sync_exclude" not in body
        assert body["sync_include"][-2:] == [".hypercli/USER.md", ".hypercli/SOUL.md"] or runtime in (
            "opencode",
            "pi",
        )

    def test_buzz_runtime_defaults_to_whole_root_with_empty_exclude(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "buzz-agent")

        deployments.create_coding_agent("buzz-agent")

        body = posts[0][1]
        assert "sync_include" not in body
        assert body["sync_exclude"] == []

    def test_opencode_default_include_is_pinned(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode")

        assert posts[0][1]["sync_include"] == [
            ".hypercli/USER.md",
            ".hypercli/SOUL.md",
            ".config/opencode",
            ".local/share/opencode",
            ".local/state/opencode",
            ".cache/opencode",
        ]

    def test_pi_gets_hyper_runtime_home_and_caller_env_wins(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "pi")

        deployments.create_coding_agent("pi", env={"HYPER_RUNTIME_HOME": "/custom", "X": "1"})

        env = posts[0][1]["env"]
        assert DEFAULT_PI_ENV["HYPER_RUNTIME_HOME"] == "/home/node/.pi/agent"
        assert env["HYPER_RUNTIME_HOME"] == "/custom"
        assert env["X"] == "1"

    def test_non_pi_runtimes_have_no_hyper_runtime_home(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode")

        assert "HYPER_RUNTIME_HOME" not in posts[0][1]["env"]

    def test_explicit_sync_include_wins_and_drops_exclude(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent(
            "opencode", sync_include=[".config/opencode"], sync_exclude=["ignored/**"]
        )

        body = posts[0][1]
        assert body["sync_include"] == [".config/opencode"]
        assert "sync_exclude" not in body

    def test_null_sync_include_selects_whole_root(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode", sync_include=None)

        body = posts[0][1]
        assert "sync_include" not in body
        assert "sync_exclude" not in body

    def test_explicit_sync_exclude_replaces_runtime_default(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode", sync_exclude=[".cache/**"])

        body = posts[0][1]
        assert "sync_include" not in body
        assert body["sync_exclude"] == [".cache/**"]

    def test_permission_mode_serializes_preset_and_legacy_mode_var(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode", permission_mode="plan")

        env = posts[0][1]["env"]
        assert env["HYPER_ACP_PERMISSIONS"] == build_permissions_json("plan")
        assert env["HYPER_ACP_PERMISSION_MODE"] == "plan"
        assert json.loads(env["HYPER_ACP_PERMISSIONS"])["bash"] == "deny"

    def test_caller_permission_env_wins_over_preset(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent(
            "opencode",
            permission_mode="plan",
            env={"HYPER_ACP_PERMISSIONS": "custom", "HYPER_ACP_PERMISSION_MODE": "custom-mode"},
        )

        env = posts[0][1]["env"]
        assert env["HYPER_ACP_PERMISSIONS"] == "custom"
        assert env["HYPER_ACP_PERMISSION_MODE"] == "custom-mode"

    @pytest.mark.parametrize("key", ["BUZZ_PRIVATE_KEY", "NOSTR_PRIVATE_KEY"])
    def test_private_key_env_is_promoted_to_secrets(self, monkeypatch, key):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        deployments.create_coding_agent("opencode", env={key: "nsec-value"})

        body = posts[0][1]
        assert key not in body["env"]
        assert body["secrets"][key] == "nsec-value"

    def test_private_key_conflict_between_env_and_secrets_rejected(self, monkeypatch):
        deployments, _ = _capture_create(monkeypatch, "opencode")

        with pytest.raises(ValueError, match="BUZZ_PRIVATE_KEY conflicts between env and secrets"):
            deployments.create_coding_agent(
                "opencode",
                env={"BUZZ_PRIVATE_KEY": "env-value"},
                secrets={"BUZZ_PRIVATE_KEY": "other-value"},
            )

    def test_unknown_runtime_rejected_with_valid_list(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        with pytest.raises(ValueError, match="runtime must be one of"):
            deployments.create_coding_agent("not-a-runtime")
        assert posts == []

    def test_non_coding_backend_response_rejected(self, monkeypatch):
        deployments, _ = _capture_create(monkeypatch, "generic")

        with pytest.raises(TypeError, match="did not identify runtime"):
            deployments.create_coding_agent("opencode")

    def test_overrides_flow_through_create(self, monkeypatch):
        deployments, posts = _capture_create(monkeypatch, "opencode")

        agent = deployments.create_coding_agent(
            "opencode",
            name="custom",
            size="medium",
            image="registry/image:tag",
            command=["/bin/custom"],
            sync_root="/data",
            sync_uid=2000,
            sync_gid=2001,
            restart=True,
            tags=["scope=test"],
            executor="docker",
            runner={"runner_id": "runner-1"},
            dry_run=True,
        )

        body = posts[0][1]
        assert agent.id == "agent-1"
        assert body["dry_run"] is True
        assert body["name"] == "custom"
        assert body["size"] == "medium"
        assert body["image"] == "registry/image:tag"
        assert body["command"] == ["/bin/custom"]
        assert body["sync_root"] == "/data"
        assert body["sync_uid"] == 2000
        assert body["sync_gid"] == 2001
        assert body["restart"] is True
        assert body["tags"] == ["scope=test"]
        assert body["executor"] == "docker"
        assert body["runner"] == {"runner_id": "runner-1"}


class TestBuildPermissionsJson:
    def test_serialized_bytes_match_ts_preset_order(self):
        assert build_permissions_json("default") == '{"*":"allow"}'
        assert build_permissions_json("accept-edits") == (
            '{"read":"allow","glob":"allow","grep":"allow","list":"allow",'
            '"edit":"allow","todowrite":"allow","*":"ask"}'
        )

    def test_buzz_hosted_preset_is_byte_pinned(self):
        assert build_permissions_json("buzz-hosted") == (
            '{"read":"allow","glob":"allow","grep":"allow","list":"allow","lsp":"allow",'
            '"todowrite":"allow","question":"allow","edit":"allow","doom_loop":"deny",'
            '"external_directory":"allow","bash":{"sprig *":"allow","sprig":"allow",'
            '"buzz *":"allow","buzz":"allow","hyper *":"allow","git *":"allow","*":"deny"},'
            '"webfetch":"allow","websearch":"allow","skill":"allow","task":"allow","*":"deny"}'
        )

    def test_unknown_mode_falls_back_to_default(self):
        assert build_permissions_json("unknown") == '{"*":"allow"}'

    def test_overrides_layer_on_preset(self):
        assert build_permissions_json("plan", {"webfetch": "allow"}) == (
            '{"read":"allow","glob":"allow","grep":"allow","list":"allow","lsp":"allow",'
            '"question":"allow","edit":"deny","bash":"deny","task":"deny",'
            '"external_directory":"deny","skill":"deny","webfetch":"allow","websearch":"deny",'
            '"*":"deny"}'
        )
