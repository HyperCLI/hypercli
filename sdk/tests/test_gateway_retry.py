from __future__ import annotations

import asyncio
import json

import pytest
from websockets.exceptions import InvalidStatus

from hypercli.gateway import GatewayClient


class _FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.headers = {}
        self.body = b""


class _RetryConnection:
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
async def test_connect_retries_transient_503(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0
    connection = _RetryConnection()

    async def fake_connect(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise InvalidStatus(_FakeResponse(503))
        return connection

    monkeypatch.setattr("hypercli.gateway.websockets.connect", fake_connect)

    client = GatewayClient(
        url="wss://openclaw-agent.example",
        token="jwt-token",
        gateway_token="gw-token",
        timeout=1,
    )

    task = asyncio.create_task(client.connect())
    while attempts < 2:
        await asyncio.sleep(0.05)

    connection.push({"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}})
    while not connection.sent:
        await asyncio.sleep(0)
    request = connection.sent[0]
    connection.push(
        {
            "type": "res",
            "id": request["id"],
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
        }
    )

    await task

    assert attempts == 2
    assert client.is_connected is True
