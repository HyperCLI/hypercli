"""Contract tests for canonical hosted coding-agent runtimes."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from hypercli import (
    BuzzLaunchConfig,
    ClaudeCodeAgent as ExportedClaudeCodeAgent,
    CodexAgent as ExportedCodexAgent,
    DEFAULT_AGENT_RUNTIME_SCOPES as ExportedRuntimeScopes,
    DEFAULT_BUZZ_CODING_AGENT_IMAGES as ExportedBuzzImageCatalog,
    DEFAULT_CODING_AGENT_IMAGES as ExportedImageCatalog,
    GooseAgent as ExportedGooseAgent,
    KimiCodeAgent as ExportedKimiCodeAgent,
    OpenCodeAgent as ExportedOpenCodeAgent,
)
from hypercli.agents import (
    ClaudeCodeAgent,
    CodexAgent,
    DEFAULT_AGENT_RUNTIME_SCOPES,
    DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
    DEFAULT_BUZZ_CODING_AGENT_IMAGES,
    DEFAULT_BUZZ_CODEX_IMAGE,
    DEFAULT_BUZZ_GOOSE_IMAGE,
    DEFAULT_BUZZ_KIMI_CODE_IMAGE,
    DEFAULT_BUZZ_OPENCODE_IMAGE,
    DEFAULT_CLAUDE_CODE_IMAGE,
    DEFAULT_CODING_AGENT_IMAGES,
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


_BUZZ_GOLDEN = json.loads(
    (Path(__file__).parents[2] / "tests/fixtures/buzz-launch-contract.json").read_text()
)


def test_coding_agent_types_are_exported_from_sdk_root():
    assert ExportedOpenCodeAgent is OpenCodeAgent
    assert ExportedCodexAgent is CodexAgent
    assert ExportedClaudeCodeAgent is ClaudeCodeAgent
    assert ExportedGooseAgent is GooseAgent
    assert ExportedKimiCodeAgent is KimiCodeAgent
    assert ExportedImageCatalog is DEFAULT_CODING_AGENT_IMAGES
    assert ExportedBuzzImageCatalog is DEFAULT_BUZZ_CODING_AGENT_IMAGES
    assert ExportedRuntimeScopes is DEFAULT_AGENT_RUNTIME_SCOPES


def test_generic_and_buzz_image_catalogs_are_explicit_and_disjoint():
    assert DEFAULT_CODING_AGENT_IMAGES == {
        "opencode": DEFAULT_OPENCODE_IMAGE,
        "codex": DEFAULT_CODEX_IMAGE,
        "claude-code": DEFAULT_CLAUDE_CODE_IMAGE,
        "goose": DEFAULT_GOOSE_IMAGE,
        "kimi-code": DEFAULT_KIMI_CODE_IMAGE,
    }
    assert DEFAULT_BUZZ_CODING_AGENT_IMAGES == {
        "opencode": DEFAULT_BUZZ_OPENCODE_IMAGE,
        "codex": DEFAULT_BUZZ_CODEX_IMAGE,
        "claude-code": DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
        "goose": DEFAULT_BUZZ_GOOSE_IMAGE,
        "kimi-code": DEFAULT_BUZZ_KIMI_CODE_IMAGE,
    }
    assert set(DEFAULT_CODING_AGENT_IMAGES.values()).isdisjoint(
        DEFAULT_BUZZ_CODING_AGENT_IMAGES.values()
    )


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
    assert "size" not in posted
    assert posted["image"] == image
    assert posted["routes"] == {}
    assert posted["sync_root"] == "/home/node"
    assert posted["sync_enabled"] is True
    assert posted["sync_uid"] == 1000
    assert posted["sync_gid"] == 1000
    assert posted["runtime_scopes"] == DEFAULT_AGENT_RUNTIME_SCOPES
    assert posted["env"] == {
        "HYPER_API_BASE": "https://api.test.hypercli.com",
        "HYPER_WORKSPACES_BOOT_SYNC": "1",
        "HYPER_WORKSPACES_DIR": "/home/node/workspaces",
        "HYPER_WORKSPACES_SYNC_READY_ONLY": "1",
    }


def test_create_coding_agent_honors_runtime_scope_override():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(runtime_scopes=["models:*"])

    assert posted["runtime_scopes"] == ["models:*"]


@pytest.mark.parametrize(
    ("method_name", "runtime", "buzz_image"),
    [
        ("create_opencode", "opencode", DEFAULT_BUZZ_OPENCODE_IMAGE),
        ("create_codex", "codex", DEFAULT_BUZZ_CODEX_IMAGE),
        (
            "create_claude_code",
            "claude-code",
            DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
        ),
        ("create_goose", "goose", DEFAULT_BUZZ_GOOSE_IMAGE),
        ("create_kimi_code", "kimi-code", DEFAULT_BUZZ_KIMI_CODE_IMAGE),
    ],
)
def test_buzz_coding_agent_uses_specialized_default_image(
    method_name,
    runtime,
    buzz_image,
):
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload(runtime)

    deployments._post = fake_post
    getattr(deployments, method_name)(buzz_enabled=True)

    assert posted["image"] == buzz_image
    assert posted["command"] == ["/usr/local/bin/buzz-acp"]


@pytest.mark.parametrize(
    ("method_name", "runtime"),
    [
        ("create_opencode", "opencode"),
        ("create_codex", "codex"),
        ("create_claude_code", "claude-code"),
        ("create_goose", "goose"),
        ("create_kimi_code", "kimi-code"),
    ],
)
def test_typed_buzz_launch_matches_shared_cross_language_golden(method_name, runtime):
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload(runtime)

    deployments._post = fake_post
    getattr(deployments, method_name)(
        buzz=BuzzLaunchConfig(
            private_key_nsec="nsec1test",
            relay_url="wss://buzz.example.test",
        )
    )

    expected_runtime = _BUZZ_GOLDEN["runtimes"][runtime]
    for key, value in _BUZZ_GOLDEN["common"].items():
        assert posted[key] == value
    assert posted["runtime"] == runtime
    assert posted["runtime_scopes"] == _BUZZ_GOLDEN["runtime_scopes"]
    assert posted["image"] == expected_runtime["image"]
    assert posted["env"]["BUZZ_ACP_AGENT_COMMAND"] == expected_runtime["agent_command"]
    assert posted["env"]["BUZZ_ACP_AGENT_ARGS"] == expected_runtime["agent_args"]
    assert posted["env"]["BUZZ_ACP_MCP_COMMAND"] == expected_runtime["mcp_command"]
    assert posted["env"].get("CLAUDE_CODE_EXECUTABLE") == expected_runtime[
        "claude_code_executable"
    ]


def test_typed_buzz_launch_honors_explicit_image_override():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(
        image="registry.example.test/custom-buzz-opencode:immutable",
        buzz=BuzzLaunchConfig(
            private_key_nsec="nsec1test",
            relay_url="wss://buzz.example.test",
        ),
    )

    assert posted["image"] == "registry.example.test/custom-buzz-opencode:immutable"


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
    assert posted["image"] == DEFAULT_BUZZ_OPENCODE_IMAGE
    assert posted["restart"] is False
    assert "entrypoint" not in posted
    assert posted["env"]["BUZZ_PRIVATE_KEY"] == agent_nsec
    assert posted["env"]["NOSTR_PRIVATE_KEY"] == agent_nsec
    assert (
        posted["env"]["RUST_LOG"]
        == "buzz_acp=info,pool::prompt=info,acp::stream=off"
    )
    assert "OPENCLAW_GATEWAY_TOKEN" not in posted["env"]


def test_coding_agent_buzz_mode_rejects_ambiguous_command_override():
    deployments = Deployments(_HTTP())

    with pytest.raises(ValueError, match="Buzz launch"):
        deployments.create_codex(
            buzz_enabled=True,
            command=["sleep", "infinity"],
        )


def test_typed_buzz_launch_owns_reserved_env_and_sets_opencode_harness():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(
        name="Fizz4",
        env={
            "BUZZ_RELAY_URL": "wss://attacker.invalid",
            "BUZZ_ACP_AGENT_COMMAND": "/tmp/not-opencode",
            "BUZZ_ACP_REQUIRE_REPLY": "false",
            "CLAUDE_CODE_EXECUTABLE": "/host/bin/claude",
            "RUST_LOG": "debug",
            "HYPER_API_KEY": "inference-key",
        },
        buzz=BuzzLaunchConfig(
            private_key_nsec="nsec1test",
            relay_url="wss://buzz.example.test",
            model="hypercli/kimi-k2.6-anthropic",
            parallelism=3,
            require_reply=True,
        ),
    )

    assert posted["size"] == "large"
    assert posted["image"] == DEFAULT_BUZZ_OPENCODE_IMAGE
    assert posted["routes"] == {}
    assert posted["command"] == ["/usr/local/bin/buzz-acp"]
    assert posted["restart"] is False
    assert posted["env"]["BUZZ_RELAY_URL"] == "wss://buzz.example.test"
    assert posted["env"]["BUZZ_ACP_AGENT_COMMAND"] == "/usr/local/bin/opencode"
    assert posted["env"]["BUZZ_ACP_AGENT_ARGS"] == "acp"
    assert posted["env"]["BUZZ_ACP_MCP_COMMAND"] == ""
    assert posted["env"]["BUZZ_ACP_SESSION_TITLE"] == "Fizz4"
    assert posted["env"]["BUZZ_ACP_MODEL"] == "hypercli/kimi-k2.6-anthropic"
    assert posted["env"]["BUZZ_ACP_AGENTS"] == "3"
    assert posted["env"]["BUZZ_ACP_LAZY_POOL"] == "true"
    assert posted["env"]["BUZZ_ACP_RELAY_OBSERVER"] == "true"
    assert posted["env"]["BUZZ_ACP_REQUIRE_REPLY"] == "true"
    assert posted["env"]["RUST_LOG"] == "debug"
    assert posted["env"]["HYPER_API_KEY"] == "inference-key"
    assert "CLAUDE_CODE_EXECUTABLE" not in posted["env"]


def test_typed_buzz_launch_uses_safe_default_acp_logging():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(
        buzz=BuzzLaunchConfig(
            private_key_nsec="nsec1test",
            relay_url="wss://buzz.example.test",
        ),
    )

    assert (
        posted["env"]["RUST_LOG"]
        == "buzz_acp=info,pool::prompt=info,acp::stream=off"
    )
    assert posted["restart"] is False


def test_typed_buzz_launch_forces_restart_false():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(
        restart=True,
        buzz=BuzzLaunchConfig(
            private_key_nsec="nsec1test",
            relay_url="wss://buzz.example.test",
        ),
    )

    assert posted["restart"] is False


def test_non_buzz_coding_agent_preserves_requested_size():
    deployments = Deployments(_HTTP())
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return _agent_payload("opencode")

    deployments._post = fake_post
    deployments.create_opencode(size="small")

    assert posted["size"] == "small"


def test_buzz_coding_agent_rejects_non_large_size():
    deployments = Deployments(_HTTP())

    with pytest.raises(ValueError, match="require size='large'"):
        deployments.create_opencode(
            size="small",
            buzz=BuzzLaunchConfig(
                private_key_nsec="nsec1test",
                relay_url="wss://buzz.example.test",
            ),
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
        messages=["Open https://auth.example/device and enter device code ACP-1234\n"]
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
    agent = CodexAgent.from_dict(_agent_payload("codex"))
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
