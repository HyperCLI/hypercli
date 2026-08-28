from __future__ import annotations

import asyncio
import json

import pytest
import httpx
import websockets

from hypercli.openclaw.gateway import (
    AGENT_EXEC_OUTPUT_MAX_BYTES,
    AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES,
    OPENCLAW_DASHBOARD_SESSION_PREFIX,
    OPENCLAW_INTERNAL_MAIN_SESSION_KEY,
    OPENCLAW_SDK_SESSION_PREFIX,
    GatewayClient,
    create_openclaw_sdk_session_key,
    create_openclaw_session_key,
    is_openclaw_internal_main_session_key,
    is_openclaw_sdk_session_key,
    normalize_gateway_chat_message,
)


class MockConnection:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self._recv_queue: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False

    async def recv(self) -> str:
        return await self._recv_queue.get()

    async def send(self, data: str) -> None:
        self.sent.append(json.loads(data))

    async def close(self) -> None:
        self.closed = True

    def push(self, message: dict) -> None:
        self._recv_queue.put_nowait(json.dumps(message))

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        if self.closed:
            raise StopAsyncIteration
        return await self.recv()




def test_openclaw_session_key_helpers() -> None:
    sdk_key = create_openclaw_sdk_session_key()
    dashboard_key = create_openclaw_session_key(prefix=OPENCLAW_DASHBOARD_SESSION_PREFIX)
    bare_key = create_openclaw_session_key(prefix="")

    assert sdk_key.startswith(OPENCLAW_SDK_SESSION_PREFIX)
    assert sdk_key != OPENCLAW_INTERNAL_MAIN_SESSION_KEY
    assert dashboard_key.startswith(OPENCLAW_DASHBOARD_SESSION_PREFIX)
    assert ":" not in bare_key
    assert is_openclaw_internal_main_session_key("main")
    assert is_openclaw_internal_main_session_key("agent:default:main")
    assert not is_openclaw_internal_main_session_key(sdk_key)
    assert is_openclaw_sdk_session_key(sdk_key)
    assert is_openclaw_sdk_session_key(f"agent:default:{sdk_key}")
    assert not is_openclaw_sdk_session_key(dashboard_key)


@pytest.mark.asyncio
async def test_connection_state_transitions(monkeypatch: pytest.MonkeyPatch) -> None:
    sockets: list[MockConnection] = []

    async def fake_connect(*args, **kwargs):
        conn = MockConnection()
        sockets.append(conn)
        return conn

    monkeypatch.setattr("hypercli.openclaw.gateway.websockets.connect", fake_connect)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        token="jwt-token",
        gateway_token="gw-token",
    )
    seen: list[str] = []
    unsubscribe = client.on_connection_state(lambda state: seen.append(state))

    connect_task = asyncio.create_task(client.connect())
    await asyncio.sleep(0)
    assert client.connection_state == "connecting"

    while not sockets:
        await asyncio.sleep(0)

    first = sockets[0]
    first.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not first.sent:
        await asyncio.sleep(0)
    connect_request = first.sent[0]
    assert connect_request["params"]["minProtocol"] == 3
    assert connect_request["params"]["maxProtocol"] == 4
    first.push({
        "type": "res",
        "id": connect_request["id"],
        "ok": True,
        "payload": {
            "protocol": 3,
            "server": {"version": "test"},
            "auth": {
                "deviceToken": "device-token-1",
                "role": "operator",
                "scopes": ["operator.admin"],
            },
        },
    })

    await connect_task
    assert client.connection_state == "connected"

    await client.close()
    assert client.connection_state == "disconnected"
    assert "connecting" in seen
    assert "connected" in seen
    assert "disconnected" in seen
    unsubscribe()


@pytest.mark.asyncio
async def test_connect_sends_upstream_metadata_and_auth_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    sockets: list[MockConnection] = []

    async def fake_connect(*args, **kwargs):
        conn = MockConnection()
        sockets.append(conn)
        return conn

    monkeypatch.setattr("hypercli.openclaw.gateway.websockets.connect", fake_connect)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        gateway_token="gw-token",
        device_token="explicit-device-token",
        password="password-token",
        approval_runtime_token="approval-runtime-token",
        agent_runtime_identity_token="agent-runtime-token",
        client_id="openclaw-worker",
        client_mode="worker",
        client_device_family="Linux",
        permissions={"screen": True, "shell": False},
        path_env="/usr/local/bin:/usr/bin",
        min_protocol=4,
        max_protocol=4,
    )

    connect_task = asyncio.create_task(client.connect())
    while not sockets:
        await asyncio.sleep(0)

    first = sockets[0]
    first.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not first.sent:
        await asyncio.sleep(0)

    connect_request = first.sent[0]
    assert connect_request["params"]["minProtocol"] == 4
    assert connect_request["params"]["maxProtocol"] == 4
    assert connect_request["params"]["client"]["id"] == "openclaw-worker"
    assert connect_request["params"]["client"]["mode"] == "worker"
    assert connect_request["params"]["client"]["deviceFamily"] == "Linux"
    assert connect_request["params"]["permissions"] == {"screen": True, "shell": False}
    assert connect_request["params"]["pathEnv"] == "/usr/local/bin:/usr/bin"
    assert connect_request["params"]["auth"] == {
        "token": "gw-token",
        "deviceToken": "explicit-device-token",
        "password": "password-token",
        "approvalRuntimeToken": "approval-runtime-token",
        "agentRuntimeIdentityToken": "agent-runtime-token",
    }

    first.push({
        "type": "res",
        "id": connect_request["id"],
        "ok": True,
        "payload": {"protocol": 4, "server": {"version": "test"}},
    })
    await connect_task
    await client.close()


@pytest.mark.asyncio
async def test_connect_uses_bootstrap_auth_without_shared_or_device_token(monkeypatch: pytest.MonkeyPatch) -> None:
    sockets: list[MockConnection] = []

    async def fake_connect(*args, **kwargs):
        conn = MockConnection()
        sockets.append(conn)
        return conn

    monkeypatch.setattr("hypercli.openclaw.gateway.websockets.connect", fake_connect)

    client = GatewayClient(
        url="wss://openclaw-agent.example/bootstrap",
        bootstrap_token="bootstrap-token",
    )

    connect_task = asyncio.create_task(client.connect())
    while not sockets:
        await asyncio.sleep(0)

    first = sockets[0]
    first.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not first.sent:
        await asyncio.sleep(0)

    connect_request = first.sent[0]
    assert connect_request["params"]["auth"] == {"bootstrapToken": "bootstrap-token"}

    first.push({
        "type": "res",
        "id": connect_request["id"],
        "ok": True,
        "payload": {"protocol": 3, "server": {"version": "test"}},
    })
    await connect_task
    await client.close()

@pytest.mark.asyncio
async def test_connect_auto_approves_pairing_and_reconnects(monkeypatch: pytest.MonkeyPatch) -> None:
    sockets: list[MockConnection] = []

    async def fake_connect(*args, **kwargs):
        conn = MockConnection()
        sockets.append(conn)
        return conn

    approvals: list[tuple[str, str]] = []

    async def fake_approve(self: GatewayClient, request_id: str) -> None:
        approvals.append((self.deployment_id or "", request_id))

    monkeypatch.setattr("hypercli.openclaw.gateway.websockets.connect", fake_connect)
    monkeypatch.setattr(GatewayClient, "_approve_pairing_request", fake_approve)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        token="jwt-token",
        gateway_token="gw-token",
        deployment_id="deployment-123",
        api_key="agent-key",
        api_base="https://api.dev.hypercli.com/agents",
        auto_approve_pairing=True,
    )

    connect_task = asyncio.create_task(client.connect())
    while not sockets:
        await asyncio.sleep(0)

    first = sockets[0]
    first.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not first.sent:
        await asyncio.sleep(0)
    connect_request = first.sent[0]
    first.push(
        {
            "type": "res",
            "id": connect_request["id"],
            "ok": False,
            "error": {
                "code": "INVALID_REQUEST",
                "message": "pairing required",
                "details": {
                    "code": "PAIRING_REQUIRED",
                    "requestId": "pairing-req-1",
                },
            },
        }
    )

    while len(sockets) < 2:
        await asyncio.sleep(0.05)

    second = sockets[1]
    second.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-2"}})
    while not second.sent:
        await asyncio.sleep(0)
    reconnect_request = second.sent[0]
    assert reconnect_request["params"]["minProtocol"] == 3
    assert reconnect_request["params"]["maxProtocol"] == 4
    second.push(
        {
            "type": "res",
            "id": reconnect_request["id"],
            "ok": True,
            "payload": {
                "protocol": 3,
                "server": {"version": "test"},
                "auth": {
                    "deviceToken": "device-token-2",
                    "role": "operator",
                    "scopes": ["operator.admin"],
                },
            },
        }
    )

    await connect_task

    assert approvals == [("deployment-123", "pairing-req-1")]
    assert client.is_connected is True
    assert client.pending_pairing is None

    await client.close()


@pytest.mark.asyncio
async def test_connect_treats_unknown_request_id_as_concurrent_pairing_approval(monkeypatch: pytest.MonkeyPatch) -> None:
    sockets: list[MockConnection] = []

    async def fake_connect(*args, **kwargs):
        conn = MockConnection()
        sockets.append(conn)
        return conn

    approvals: list[tuple[str, str]] = []

    async def fake_approve(self: GatewayClient, request_id: str) -> None:
        approvals.append((self.deployment_id or "", request_id))
        raise RuntimeError("unknown requestId")

    monkeypatch.setattr("hypercli.openclaw.gateway.websockets.connect", fake_connect)
    monkeypatch.setattr(GatewayClient, "_approve_pairing_request", fake_approve)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        token="jwt-token",
        gateway_token="gw-token",
        deployment_id="deployment-123",
        api_key="agent-key",
        api_base="https://api.dev.hypercli.com/agents",
        auto_approve_pairing=True,
    )

    connect_task = asyncio.create_task(client.connect())
    while not sockets:
        await asyncio.sleep(0)

    first = sockets[0]
    first.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not first.sent:
        await asyncio.sleep(0)
    connect_request = first.sent[0]
    first.push(
        {
            "type": "res",
            "id": connect_request["id"],
            "ok": False,
            "error": {
                "code": "INVALID_REQUEST",
                "message": "pairing required",
                "details": {
                    "code": "PAIRING_REQUIRED",
                    "requestId": "pairing-req-race",
                },
            },
        }
    )

    while len(sockets) < 2:
        await asyncio.sleep(0.05)

    second = sockets[1]
    second.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-2"}})
    while not second.sent:
        await asyncio.sleep(0)
    reconnect_request = second.sent[0]
    assert reconnect_request["params"]["minProtocol"] == 3
    assert reconnect_request["params"]["maxProtocol"] == 4
    second.push(
        {
            "type": "res",
            "id": reconnect_request["id"],
            "ok": True,
            "payload": {
                "protocol": 3,
                "server": {"version": "test"},
                "auth": {
                    "deviceToken": "device-token-race",
                    "role": "operator",
                    "scopes": ["operator.admin"],
                },
            },
        }
    )

    await connect_task

    assert approvals == [("deployment-123", "pairing-req-race")]
    assert client.is_connected is True
    assert client.pending_pairing is None

    await client.close()


@pytest.mark.asyncio
async def test_approve_pairing_request_uses_token_authenticated_exec_ws(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict:
            return {
                "agent_id": "deployment-123",
                "jwt": "jwt-exec",
                "expires_at": "2026-08-15T00:05:00Z",
                "ws_url": "wss://socket.example.test/product/ws/exec/deployment-123",
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(self, url: str, *, headers: dict):
            captured["url"] = url
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    class FakeExecSocket:
        def __init__(self):
            stdout = "\x01" * AGENT_EXEC_OUTPUT_MAX_BYTES
            frame = json.dumps(
                {
                    "event": "agent_exec_result",
                    "ok": True,
                    "exit_code": 0,
                    "stdout": stdout,
                    "stderr": "",
                },
                separators=(",", ":"),
            )
            assert len(frame.encode()) <= AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES
            captured["result_frame_size"] = len(frame.encode())
            self.frames = [frame]

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def send(self, frame: str):
            captured["frame"] = json.loads(frame)

        async def recv(self):
            if self.frames:
                return self.frames.pop(0)
            from websockets.exceptions import ConnectionClosedOK
            from websockets.frames import Close

            close = Close(1000, "")
            raise ConnectionClosedOK(close, close, True)

    def fake_connect(url: str, **kwargs):
        captured["ws_url"] = url
        captured["ws_kwargs"] = kwargs
        return FakeExecSocket()

    monkeypatch.setattr(websockets, "connect", fake_connect)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        gateway_token="gw-token",
        deployment_id="deployment-123",
        api_key="agent-key",
        api_base="https://api.dev.hypercli.com/agents",
        auto_approve_pairing=True,
    )

    await client._approve_pairing_request("pairing-req-1")

    assert captured["url"] == (
        "https://api.dev.hypercli.com/agents/deployments/deployment-123/exec/token"
    )
    assert captured["headers"] == {"Authorization": "Bearer agent-key"}
    assert captured["ws_url"] == (
        "wss://socket.example.test/product/ws/exec/deployment-123?jwt=jwt-exec"
    )
    assert captured["ws_kwargs"]["max_size"] == AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES
    assert captured["result_frame_size"] > AGENT_EXEC_OUTPUT_MAX_BYTES
    assert captured["frame"]["timeout"] == 30
    assert captured["frame"]["dry_run"] is False
    assert captured["frame"]["command"] == [
        "openclaw",
        "devices",
        "approve",
        "pairing-req-1",
        "--json",
    ]


def test_set_gateway_token_normalizes_blank_values() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example", gateway_token="gw-token-1")

    client.set_gateway_token("  gw-token-2  ")
    assert client.gateway_token == "gw-token-2"

    client.set_gateway_token("   ")
    assert client.gateway_token is None


@pytest.mark.asyncio
async def test_gateway_python_parity_rpc_wrappers() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example", gateway_token="gw-token")
    calls: list[tuple[str, dict | None, float | None]] = []

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        calls.append((method, params, timeout))
        return {"ok": True}

    client.call = fake_call  # type: ignore[method-assign]

    await client.config_schema_lookup("channels.slack")
    await client.skills_status({"agentId": "default"})
    await client.skills_search({"query": "slack", "limit": 5})
    await client.skills_detail({"slug": "demo"})
    await client.skills_security_verdicts({"agentId": "default"})
    await client.skills_skill_card({"skillKey": "demo"})
    await client.skills_install({"source": "clawhub", "slug": "demo", "timeoutMs": 450000})
    await client.skills_update({"source": "clawhub", "slug": "demo"})
    await client.integrations_auth_start({"integrationId": "github"})
    await client.integrations_auth_status({"authId": "auth-1"})
    await client.integrations_status({"integrationId": "github"})
    await client.integrations_disconnect({"integrationId": "github"})
    await client.message_action({"channel": "slack", "action": "react", "params": {"emoji": "eyes"}})
    await client.send({"to": "C123", "message": "hello", "channel": "slack"})
    await client.plugins_list()
    await client.plugins_install({"source": "official", "pluginId": "whatsapp"})
    await client.plugins_set_enabled({"pluginId": "whatsapp", "enabled": True})
    await client.plugins_uninstall({"pluginId": "whatsapp"})
    await client.plugins_refresh()
    await client.tools_catalog({"agentId": "default"})
    await client.tools_effective({"agentId": "default"})
    await client.tools_invoke({"toolName": "shell", "params": {"command": "true"}})
    await client.commands_list({"agentId": "default"})

    names = [entry[0] for entry in calls]
    assert names == [
        "config.schema.lookup",
        "skills.status",
        "skills.search",
        "skills.detail",
        "skills.securityVerdicts",
        "skills.skillCard",
        "skills.install",
        "skills.update",
        "integrations.auth.start",
        "integrations.auth.status",
        "integrations.status",
        "integrations.disconnect",
        "message.action",
        "send",
        "plugins.list",
        "plugins.install",
        "plugins.setEnabled",
        "plugins.uninstall",
        "plugins.refresh",
        "tools.catalog",
        "tools.effective",
        "tools.invoke",
        "commands.list",
    ]
    assert calls[6][2] == 450
    assert calls[7][2] == 300.0
    assert calls[8][2] == 30
    assert calls[12][1]["idempotencyKey"]
    assert calls[13][1]["idempotencyKey"]
    assert calls[15][2] == 300.0
    assert calls[17][2] == 300.0
    assert calls[21][1]["idempotencyKey"]


@pytest.mark.asyncio
async def test_gateway_read_media_bytes_uses_gateway_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"
        content = b"image-bytes"

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def get(self, url: str, *, headers: dict):
            captured["url"] = url
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    client = GatewayClient(url="wss://agent.example/ws", gateway_token="gw-token", timeout=12)
    content = await client.read_media_bytes("/media/cat.png")

    assert content == b"image-bytes"
    assert captured["url"] == "https://agent.example/media/cat.png"
    assert captured["headers"] == {"Authorization": "Bearer gw-token"}
    assert captured["timeout"] == 12


@pytest.mark.asyncio
async def test_chat_send_accepts_chat_content_and_done_events() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True

    events: list[dict] = []
    server_run_id = "server-run-1"

    async def produce() -> None:
        while not events:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.content",
                "payload": {"runId": server_run_id, "text": "SMOKE_"},
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.content",
                "payload": {"runId": server_run_id, "text": "OK"},
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.done",
                "payload": {"runId": server_run_id},
            }
        )

    async def recording_call(method: str, params: dict | None = None, timeout: float | None = None):
        events.append({"method": method, "params": params, "timeout": timeout})
        return {"runId": server_run_id}

    client.call = recording_call  # type: ignore[method-assign]
    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Reply with exactly: SMOKE_OK")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "content", "done"]
    assert "".join(chunk.text or "" for chunk in chunks if chunk.type == "content") == "SMOKE_OK"
    assert events[0]["timeout"] == 900.0


@pytest.mark.asyncio
async def test_chat_send_uses_history_fallback_when_done_has_no_content() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "done-run-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        if method == "chat.history":
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "SMOKE_OK"}],
                        "runId": server_run_id,
                    }
                ]
            }
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.done",
                "payload": {"runId": server_run_id, "sessionKey": sent_session_key},
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Reply with exactly: SMOKE_OK")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "done"]
    assert chunks[0].text == "SMOKE_OK"


@pytest.mark.asyncio
async def test_chat_send_streams_legacy_chat_events_and_treats_final_without_message_as_done() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "legacy-run-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "delta",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello"}]},
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "delta",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello world"}]},
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "final",
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Say hello")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "content", "done"]
    assert "".join(chunk.text or "" for chunk in chunks if chunk.type == "content") == "Hello world"


@pytest.mark.asyncio
async def test_chat_send_streams_v4_chat_delta_text_without_message_snapshots() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "delta-text-run-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "delta",
                    "deltaText": "Hello ",
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "delta",
                    "deltaText": "world",
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "final",
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Say hello")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "content", "done"]
    assert "".join(chunk.text or "" for chunk in chunks if chunk.type == "content") == "Hello world"


@pytest.mark.asyncio
async def test_chat_send_accepts_canonical_agent_session_key_aliases() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "legacy-run-alias"

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        if method == "chat.send":
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": "agent:main:main",
                    "state": "delta",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "Alias OK"}]},
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": "agent:main:main",
                    "state": "final",
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("alias test", session_key="main")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "done"]
    assert chunks[0].text == "Alias OK"


@pytest.mark.asyncio
async def test_chat_send_forwards_attachments_in_chat_send_request() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "attachments-run-1"
    seen_params: dict[str, object] = {}

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        if method == "chat.send":
            seen_params.update(params or {})
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while "sessionKey" not in seen_params:
            await asyncio.sleep(0)
        sent_session_key = str(seen_params["sessionKey"])
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "final",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "done"}],
                    },
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [
        event
        async for event in client.chat_send(
            "With attachment",
            attachments=[{"type": "file", "path": "/tmp/file.txt"}],
        )
    ]
    await producer

    assert seen_params["attachments"] == [{"type": "file", "path": "/tmp/file.txt"}]
    assert str(seen_params["sessionKey"]).startswith("hcli:")
    assert [chunk.type for chunk in chunks] == ["content", "done"]


@pytest.mark.asyncio
async def test_sessions_patch_forwards_raw_patch_payload() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    seen: list[tuple[str, dict | None, float | None]] = []

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        seen.append((method, params, timeout))
        return {"ok": True, "key": "agent:main:main"}

    client.call = fake_call  # type: ignore[method-assign]

    result = await client.sessions_patch(
        "agent:main:main",
        model="openai/gpt-5.2",
        thinkingLevel="high",
    )

    assert seen == [
        (
            "sessions.patch",
            {
                "key": "agent:main:main",
                "model": "openai/gpt-5.2",
                "thinkingLevel": "high",
            },
            None,
        )
    ]
    assert result == {"ok": True, "key": "agent:main:main"}


@pytest.mark.asyncio
async def test_channel_start_and_web_login_wait_use_gateway_rpc_shapes() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    seen: list[tuple[str, dict | None, float | None]] = []

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        seen.append((method, params, timeout))
        return {"ok": True}

    client.call = fake_call  # type: ignore[method-assign]

    assert await client.channels_start("whatsapp", account_id="personal") == {"ok": True}
    assert await client.web_login_wait(
        timeout_ms=15_000,
        account_id="personal",
        current_qr_data_url="data:image/png;base64,old",
    ) == {"ok": True}

    assert seen == [
        ("channels.start", {"channel": "whatsapp", "accountId": "personal"}, None),
        (
            "web.login.wait",
            {
                "timeoutMs": 15_000,
                "accountId": "personal",
                "currentQrDataUrl": "data:image/png;base64,old",
            },
            client.chat_timeout,
        ),
    ]


@pytest.mark.asyncio
async def test_sessions_preview_uses_keys_shape_and_returns_first_preview_items() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    seen: list[tuple[str, dict | None, float | None]] = []

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        seen.append((method, params, timeout))
        return {
            "previews": [
                {
                    "key": "agent:main:main",
                    "items": [{"role": "assistant", "text": "hello"}],
                }
            ]
        }

    client.call = fake_call  # type: ignore[method-assign]

    items = await client.sessions_preview("agent:main:main", limit=12)

    assert seen == [
        (
            "sessions.preview",
            {"keys": ["agent:main:main"], "limit": 12},
            None,
        )
    ]
    assert items == [{"role": "assistant", "text": "hello"}]


@pytest.mark.asyncio
async def test_sessions_reset_uses_key_and_optional_reason() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    seen: list[tuple[str, dict | None, float | None]] = []

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        seen.append((method, params, timeout))
        return {"ok": True}

    client.call = fake_call  # type: ignore[method-assign]

    result = await client.sessions_reset("agent:main:main", reason="new")

    assert seen == [
        (
            "sessions.reset",
            {"key": "agent:main:main", "reason": "new"},
            None,
        )
    ]
    assert result == {"ok": True}


@pytest.mark.asyncio
async def test_chat_send_uses_history_fallback_when_final_has_no_message_or_stream() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "legacy-run-2"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        if method == "chat.history":
            return {
                "messages": [
                    {"role": "user", "content": [{"type": "text", "text": "prompt"}]},
                    {
                        "role": "assistant",
                        "runId": server_run_id,
                        "content": [{"type": "text", "text": "Recovered final answer"}],
                    },
                ]
            }
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "final",
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Recover answer")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "done"]
    assert chunks[0].text == "Recovered final answer"


def test_normalize_gateway_chat_message_preserves_thinking_and_tools() -> None:
    normalized = normalize_gateway_chat_message(
        {
            "role": "assistant",
            "timestamp": 1234,
            "content": [
                {"type": "thinking", "thinking": "Need to inspect the file."},
                {
                    "type": "tool_call",
                    "id": "tool-1",
                    "name": "functions.read",
                    "arguments": '{"path":"/tmp/demo.zip"}',
                },
                {
                    "type": "tool_result",
                    "toolCallId": "tool-1",
                    "name": "functions.read",
                    "result": {"ok": True},
                },
            ],
        }
    )

    assert normalized is not None
    assert normalized.role == "assistant"
    assert normalized.text == ""
    assert normalized.thinking == "Need to inspect the file."
    assert normalized.timestamp == 1234
    assert len(normalized.tool_calls) == 1
    assert normalized.tool_calls[0].id == "tool-1"
    assert normalized.tool_calls[0].name == "functions.read"
    assert normalized.tool_calls[0].args == {"path": "/tmp/demo.zip"}
    assert json.loads(normalized.tool_calls[0].result or "") == {"ok": True}


@pytest.mark.asyncio
async def test_chat_send_emits_thinking_and_tool_events_from_final_snapshot() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "structured-run-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "state": "final",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": "Inspecting archive"},
                            {
                                "type": "tool_call",
                                "id": "tool-1",
                                "name": "functions.read",
                                "arguments": '{"path":"/tmp/demo.zip"}',
                            },
                            {
                                "type": "tool_result",
                                "toolCallId": "tool-1",
                                "name": "functions.read",
                                "result": {"entries": ["a.txt"]},
                            },
                        ],
                    },
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Inspect this zip")]
    await producer

    assert [chunk.type for chunk in chunks] == ["thinking", "tool_call", "tool_result", "done"]
    assert chunks[0].text == "Inspecting archive"
    assert chunks[1].data == {
        "toolCallId": "tool-1",
        "name": "functions.read",
        "args": {"path": "/tmp/demo.zip"},
    }
    assert chunks[2].data == {
        "toolCallId": "tool-1",
        "name": "functions.read",
        "result": '{\n  "entries": [\n    "a.txt"\n  ]\n}',
    }


@pytest.mark.asyncio
async def test_chat_send_emits_tool_events_from_agent_tool_stream() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "agent-tool-stream-run"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "agent",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "stream": "tool",
                    "data": {
                        "phase": "start",
                        "toolCallId": "tool-1",
                        "name": "functions.read",
                        "args": {"path": "/tmp/demo.zip"},
                    },
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "agent",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "stream": "tool",
                    "data": {
                        "phase": "result",
                        "toolCallId": "tool-1",
                        "name": "functions.read",
                        "result": {"ok": True},
                        "isError": False,
                    },
                },
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.done",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Inspect this zip")]
    await producer

    assert [chunk.type for chunk in chunks] == ["tool_call", "tool_result", "done"]
    assert chunks[0].data == {
        "toolCallId": "tool-1",
        "name": "functions.read",
        "args": {"path": "/tmp/demo.zip"},
    }
    assert chunks[1].data == {
        "toolCallId": "tool-1",
        "name": "functions.read",
        "result": {"ok": True},
        "isError": False,
    }


@pytest.mark.asyncio
async def test_chat_send_uses_lifecycle_end_fallback_when_chat_final_is_missing() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "lifecycle-end-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        if method == "chat.history":
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "SMOKE_OK"}],
                        "runId": server_run_id,
                    }
                ]
            }
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "agent",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "stream": "lifecycle",
                    "data": {"phase": "end"},
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Reply with exactly: SMOKE_OK")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "done"]
    assert chunks[0].text == "SMOKE_OK"


@pytest.mark.asyncio
async def test_chat_send_uses_lifecycle_error_fallback_when_chat_error_is_missing() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "lifecycle-error-1"
    sent_session_key = ""

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        nonlocal sent_session_key
        if method == "chat.send":
            sent_session_key = str((params or {}).get("sessionKey") or "")
            return {"runId": server_run_id}
        raise AssertionError(f"Unexpected RPC {method}")

    client.call = fake_call  # type: ignore[method-assign]

    async def produce() -> None:
        while not sent_session_key:
            await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "agent",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": sent_session_key,
                    "stream": "lifecycle",
                    "data": {"phase": "error", "error": "boom"},
                },
            }
        )

    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("fail please")]
    await producer

    assert [chunk.type for chunk in chunks] == ["error"]
    assert chunks[0].text == "boom"


@pytest.mark.asyncio
async def test_wait_ready_retries_until_config_probe_succeeds() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    attempts = 0
    closed: list[bool] = []

    async def fake_connect() -> None:
        client._connected = True

    async def fake_config_get() -> dict:
        nonlocal attempts
        attempts += 1
        if attempts < 2:
            raise RuntimeError("warming up")
        return {"gateway": {"mode": "local"}}

    async def fake_close() -> None:
        client._connected = False
        closed.append(True)

    client.connect = fake_connect  # type: ignore[method-assign]
    client.config_get = fake_config_get  # type: ignore[method-assign]
    client.close = fake_close  # type: ignore[method-assign]

    result = await client.wait_ready(timeout=1, retry_interval=0)

    assert result["gateway"]["mode"] == "local"
    assert attempts == 2
    assert closed == [True]
