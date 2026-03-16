from __future__ import annotations

import asyncio
import json

import pytest

from hypercli.gateway import GatewayClient


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

    async def fake_call(method: str, params: dict | None = None, timeout: float | None = None):
        return {}

    client.call = fake_call  # type: ignore[method-assign]

    events: list[dict] = []

    async def produce() -> None:
        while not events:
            await asyncio.sleep(0)
        run_id = events[0]["params"]["idempotencyKey"]
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.content",
                "payload": {"runId": run_id, "text": "SMOKE_"},
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.content",
                "payload": {"runId": run_id, "text": "OK"},
            }
        )
        client._event_queue.put_nowait(
            {
                "type": "event",
                "event": "chat.done",
                "payload": {"runId": run_id},
            }
        )

    async def recording_call(method: str, params: dict | None = None, timeout: float | None = None):
        events.append({"method": method, "params": params, "timeout": timeout})
        return {}

    client.call = recording_call  # type: ignore[method-assign]
    producer = asyncio.create_task(produce())
    chunks = [event async for event in client.chat_send("Reply with exactly: SMOKE_OK")]
    await producer

    assert [chunk.type for chunk in chunks] == ["content", "content", "done"]
    assert "".join(chunk.text or "" for chunk in chunks if chunk.type == "content") == "SMOKE_OK"
