"""Contract tests for canonical hosted coding-agent runtimes."""
from __future__ import annotations

from unittest.mock import Mock

import pytest

from hypercli import (
    ClaudeCodeAgent as ExportedClaudeCodeAgent,
    CodexAgent as ExportedCodexAgent,
    GooseAgent as ExportedGooseAgent,
    KimiCodeAgent as ExportedKimiCodeAgent,
    OpenCodeAgent as ExportedOpenCodeAgent,
)
from hypercli.agents import (
    ClaudeCodeAgent,
    CodexAgent,
    DEFAULT_CLAUDE_CODE_IMAGE,
    DEFAULT_CODEX_IMAGE,
    DEFAULT_GOOSE_IMAGE,
    DEFAULT_KIMI_CODE_IMAGE,
    DEFAULT_OPENCODE_IMAGE,
    Deployments,
    ExecResult,
    GooseAgent,
    KimiCodeAgent,
    OpenCodeAgent,
    RuntimeAuthClient,
    RuntimeAuthMethod,
)


class _HTTP:
    api_key = "hyper_api_test"


def test_coding_agent_types_are_exported_from_sdk_root():
    assert ExportedOpenCodeAgent is OpenCodeAgent
    assert ExportedCodexAgent is CodexAgent
    assert ExportedClaudeCodeAgent is ClaudeCodeAgent
    assert ExportedGooseAgent is GooseAgent
    assert ExportedKimiCodeAgent is KimiCodeAgent


def _agent_payload(runtime: str) -> dict:
    return {
        "id": f"{runtime}-1",
        "user_id": "user-1",
        "pod_id": "pod-1",
        "pod_name": f"{runtime}-pod",
        "state": "starting",
        "runtime": runtime,
    }


@pytest.mark.parametrize(
    ("method_name", "runtime", "image", "agent_type"),
    [
        ("create_opencode", "opencode", DEFAULT_OPENCODE_IMAGE, OpenCodeAgent),
        ("create_codex", "codex", DEFAULT_CODEX_IMAGE, CodexAgent),
        (
            "create_claude_code",
            "claude-code",
            DEFAULT_CLAUDE_CODE_IMAGE,
            ClaudeCodeAgent,
        ),
        ("create_goose", "goose", DEFAULT_GOOSE_IMAGE, GooseAgent),
        (
            "create_kimi_code",
            "kimi-code",
            DEFAULT_KIMI_CODE_IMAGE,
            KimiCodeAgent,
        ),
    ],
)
def test_create_coding_agent_contract(method_name, runtime, image, agent_type):
    deployments = Deployments(
        _HTTP(),
        api_base="https://api.test.hypercli.com/agents",
    )
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload(runtime)

    deployments._post = fake_post
    agent = getattr(deployments, method_name)(name="coder")

    assert isinstance(agent, agent_type)
    assert posted["runtime"] == runtime
    assert posted["image"] == image
    assert posted["routes"] == {}
    assert posted["sync_root"] == "/home/node"
    assert posted["sync_enabled"] is True
    assert posted["sync_uid"] == 1000
    assert posted["sync_gid"] == 1000
    assert posted["env"] == {
        "HYPER_API_BASE": "https://api.test.hypercli.com",
        "HYPER_WORKSPACES_BOOT_SYNC": "1",
        "HYPER_WORKSPACES_DIR": "/home/node/workspaces",
        "HYPER_WORKSPACES_SYNC_READY_ONLY": "1",
    }


def test_runtime_hydration_uses_explicit_backend_discriminator():
    deployments = Deployments(_HTTP())

    assert isinstance(deployments._hydrate_agent(_agent_payload("opencode")), OpenCodeAgent)
    assert isinstance(deployments._hydrate_agent(_agent_payload("codex")), CodexAgent)
    assert isinstance(
        deployments._hydrate_agent(_agent_payload("claude-code")),
        ClaudeCodeAgent,
    )
    assert isinstance(deployments._hydrate_agent(_agent_payload("goose")), GooseAgent)
    assert isinstance(
        deployments._hydrate_agent(_agent_payload("kimi-code")),
        KimiCodeAgent,
    )


def test_coding_agent_buzz_mode_only_changes_container_args_and_preserves_credentials():
    deployments = Deployments(_HTTP())
    posted: dict = {}
    agent_nsec = "nsec1agent"

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(
        name="buzz-coder",
        buzz_enabled=True,
        env={
            "BUZZ_PRIVATE_KEY": agent_nsec,
            "NOSTR_PRIVATE_KEY": agent_nsec,
            "BUZZ_RELAY_URL": "wss://buzz.example.test",
            "BUZZ_AUTH_TAG": '["auth","owner","","signature"]',
        },
    )

    assert posted["command"] == ["/usr/local/bin/buzz-acp"]
    assert "entrypoint" not in posted
    assert posted["env"]["BUZZ_PRIVATE_KEY"] == agent_nsec
    assert posted["env"]["NOSTR_PRIVATE_KEY"] == agent_nsec
    assert "OPENCLAW_GATEWAY_TOKEN" not in posted["env"]


def test_coding_agent_buzz_mode_rejects_ambiguous_command_override():
    deployments = Deployments(_HTTP())

    with pytest.raises(ValueError, match="buzz_enabled"):
        deployments.create_codex(
            buzz_enabled=True,
            command=["sleep", "infinity"],
        )


def test_goose_uses_injected_runtime_key_and_has_no_destructive_logout():
    agent = GooseAgent.from_dict(_agent_payload("goose"))
    agent._deployments = Mock()

    with pytest.raises(RuntimeError, match="injected deployment credential"):
        agent.auth.logout()


def test_codex_auth_methods_merge_acp_and_native_device_login():
    agent = CodexAgent.from_dict(_agent_payload("codex"))
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
    assert command == "buzz-acp auth-methods --agent-command codex-acp --json"


def test_claude_auth_methods_honor_adapter_terminal_metadata():
    agent = ClaudeCodeAgent.from_dict(_agent_payload("claude-code"))
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


@pytest.mark.asyncio
async def test_adapter_owned_login_uses_buzz_acp_authenticate():
    socket = _LoginSocket(
        messages=["Open https://auth.example/device and enter device code ACP-1234"]
    )
    deployments = Mock()

    async def shell_connect(_agent_id, shell=None):
        assert shell is None
        return socket

    deployments.shell_connect = shell_connect
    agent = OpenCodeAgent.from_dict(_agent_payload("opencode"))
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
        "buzz-acp authenticate --agent-command opencode "
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
    agent_type = OpenCodeAgent if runtime == "opencode" else CodexAgent
    agent = agent_type.from_dict(_agent_payload(runtime))
    agent._deployments = Mock()
    agent._deployments.exec.return_value = ExecResult(0, output, "")

    assert agent.auth.status().authenticated is expected


class _LoginSocket:
    def __init__(self, messages=None):
        self.sent: list[str] = []
        self.closed = False
        self._messages = iter(
            messages
            or ["Open https://auth.example/device and enter device code ABCD-EFGH"]
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
async def test_login_uses_existing_authenticated_shell_and_parses_device_challenge():
    socket = _LoginSocket()
    deployments = Mock()
    deployments.shell_connect = Mock(return_value=None)

    async def shell_connect(_agent_id, shell=None):
        assert shell is None
        return socket

    deployments.shell_connect = shell_connect
    agent = CodexAgent.from_dict(_agent_payload("codex"))
    agent._deployments = deployments
    auth = RuntimeAuthClient(agent)
    auth.methods = lambda: [
        RuntimeAuthMethod(
            id="device",
            name="Device login",
            command=("codex", "login", "--device-auth"),
        )
    ]

    session = await auth.login("device")

    assert session.verification_url == "https://auth.example/device"
    assert session.user_code == "ABCD-EFGH"
    assert socket.sent[0].startswith("codex login --device-auth;")
    await session.cancel()
    assert socket.closed is True


def test_claude_status_parses_json_without_exposing_credentials():
    agent = ClaudeCodeAgent.from_dict(_agent_payload("claude-code"))
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
    agent = ClaudeCodeAgent.from_dict(_agent_payload("claude-code"))
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
