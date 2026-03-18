from __future__ import annotations

import asyncio
import json

import pytest

from hypercli.gateway import GatewayClient, normalize_gateway_chat_message


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

    monkeypatch.setattr("hypercli.gateway.websockets.connect", fake_connect)
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


@pytest.mark.asyncio
async def test_chat_send_streams_legacy_chat_events_and_treats_final_without_message_as_done() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "legacy-run-1"

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
                    "sessionKey": "main",
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
                    "sessionKey": "main",
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
                    "sessionKey": "main",
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
async def test_chat_send_uses_history_fallback_when_final_has_no_message_or_stream() -> None:
    client = GatewayClient(url="wss://openclaw-agent.example")
    client._connected = True
    server_run_id = "legacy-run-2"

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        if method == "chat.send":
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
        await asyncio.sleep(0)
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat",
                "payload": {
                    "runId": server_run_id,
                    "sessionKey": "main",
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
                    "sessionKey": "main",
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
