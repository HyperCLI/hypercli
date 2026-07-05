from __future__ import annotations

import asyncio
import ipaddress

import pytest

from hypercli.openclaw.node_proxy import (
    DEFAULT_CHUNK_BYTES,
    EGRESS_HTTP_FETCH_COMMAND,
    EGRESS_TCP_CLOSE_COMMAND,
    EGRESS_TCP_OPEN_COMMAND,
    EGRESS_TCP_READ_COMMAND,
    EGRESS_TCP_WRITE_COMMAND,
    EgressPolicyError,
    LoopbackNodeProxy,
    NodeEgressClient,
    NodeEgressCommandHandlers,
    assert_public_destination,
)


class FakeGateway:
    def __init__(self, handlers: NodeEgressCommandHandlers) -> None:
        self.handlers = handlers
        self.calls: list[tuple[str, str, dict, int | None]] = []

    async def node_invoke(
        self,
        node_id: str,
        command: str,
        params: dict | None = None,
        timeout_ms: int | None = None,
    ) -> dict:
        self.calls.append((node_id, command, params or {}, timeout_ms))
        result = await self.handlers.commands()[command](params or {})
        return {"ok": True, "payload": result, "payloadJSON": None}


async def _start_http_server(body: bytes, *, status: str = "200 OK"):
    seen: list[bytes] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = await reader.readuntil(b"\r\n\r\n")
        headers = request.decode("iso-8859-1").split("\r\n")
        length = 0
        for line in headers:
            if line.lower().startswith("content-length:"):
                length = int(line.split(":", 1)[1].strip())
        if length:
            request += await reader.readexactly(length)
        seen.append(request)
        writer.write(
            (
                f"HTTP/1.1 {status}\r\n"
                "Content-Type: text/plain\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n"
                "\r\n"
            ).encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, int(server.sockets[0].getsockname()[1]), seen


async def _start_echo_server():
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data.upper())
            await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, int(server.sockets[0].getsockname()[1])


@pytest.mark.asyncio
async def test_assert_public_destination_blocks_private_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_resolve(host: str, port: int):
        return [ipaddress.ip_address("10.1.2.3")]

    monkeypatch.setattr("hypercli.openclaw.node_proxy._resolve_host_ips", fake_resolve)

    with pytest.raises(EgressPolicyError, match="blocked address"):
        await assert_public_destination("example.test", 443)


@pytest.mark.asyncio
async def test_http_fetch_returns_bounded_base64_chunks() -> None:
    server, port, _seen = await _start_http_server(b"abcdef")
    handlers = NodeEgressCommandHandlers(allow_private_network=True, chunk_bytes=2)
    try:
        payload = await handlers.http_fetch(
            {
                "url": f"http://127.0.0.1:{port}/hello",
                "maxBytes": 5,
                "chunkBytes": 2,
            }
        )
    finally:
        server.close()
        await server.wait_closed()

    assert payload["status"] == 200
    assert payload["bodyBytes"] == 5
    assert payload["truncated"] is True
    decoded = b"".join(__import__("base64").b64decode(chunk) for chunk in payload["bodyBase64Chunks"])
    assert decoded == b"abcde"


@pytest.mark.asyncio
async def test_tcp_handlers_chunk_write_read_and_cleanup() -> None:
    server, port = await _start_echo_server()
    handlers = NodeEgressCommandHandlers(allow_private_network=True, tcp_ttl_seconds=1)
    try:
        opened = await handlers.tcp_open({"host": "127.0.0.1", "port": port})
        conn_id = opened["connId"]

        written = await handlers.tcp_write(
            {
                "connId": conn_id,
                "dataBase64Chunks": [__import__("base64").b64encode(b"hello").decode("ascii")],
            }
        )
        assert written["writtenBytes"] == 5

        read = await handlers.tcp_read({"connId": conn_id, "maxBytes": 5, "waitMs": 500})
        assert read["readBytes"] == 5
        assert __import__("base64").b64decode(read["dataBase64Chunks"][0]) == b"HELLO"

        await handlers.tcp_close({"connId": conn_id})
        assert handlers._tcp == {}
    finally:
        await handlers.aclose()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_operator_client_invokes_explicit_node_and_chunks_large_write() -> None:
    server, port = await _start_echo_server()
    handlers = NodeEgressCommandHandlers(allow_private_network=True)
    gateway = FakeGateway(handlers)
    client = NodeEgressClient(gateway, node_id="node-123")
    try:
        conn_id = await client.tcp_open("127.0.0.1", port)
        await client.tcp_write(conn_id, b"x" * (DEFAULT_CHUNK_BYTES + 3))
        _data, _closed = await client.tcp_read(conn_id, max_bytes=1, wait_ms=500)
        await client.tcp_close(conn_id)
    finally:
        await handlers.aclose()
        server.close()
        await server.wait_closed()

    write_calls = [call for call in gateway.calls if call[1] == EGRESS_TCP_WRITE_COMMAND]
    assert write_calls
    assert len(write_calls[0][2]["dataBase64Chunks"]) == 2
    assert {call[0] for call in gateway.calls} == {"node-123"}


@pytest.mark.asyncio
async def test_loopback_proxy_rejects_non_loopback_bind() -> None:
    handlers = NodeEgressCommandHandlers(allow_private_network=True)
    client = NodeEgressClient(FakeGateway(handlers), node_id="node-123")
    with pytest.raises(ValueError, match="binds to 127.0.0.1"):
        LoopbackNodeProxy(client, host="0.0.0.0")


@pytest.mark.asyncio
async def test_loopback_proxy_relays_absolute_form_http_request() -> None:
    upstream, upstream_port, seen = await _start_http_server(b"proxied")
    handlers = NodeEgressCommandHandlers(allow_private_network=True)
    client = NodeEgressClient(FakeGateway(handlers), node_id="node-123")
    proxy = LoopbackNodeProxy(client)
    await proxy.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", proxy.bound_port)
        writer.write(
            (
                f"GET http://127.0.0.1:{upstream_port}/via-proxy HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{upstream_port}\r\n"
                "\r\n"
            ).encode("ascii")
        )
        await writer.drain()
        response = await reader.read()
        writer.close()
        await writer.wait_closed()
    finally:
        await proxy.close()
        await handlers.aclose()
        upstream.close()
        await upstream.wait_closed()

    assert b"HTTP/1.1 200 OK" in response
    assert response.endswith(b"proxied")
    assert b"/via-proxy" in seen[0]


@pytest.mark.asyncio
async def test_loopback_connect_tunnel_is_experimental_but_functional() -> None:
    echo, echo_port = await _start_echo_server()
    handlers = NodeEgressCommandHandlers(allow_private_network=True)
    client = NodeEgressClient(FakeGateway(handlers), node_id="node-123")
    proxy = LoopbackNodeProxy(client)
    await proxy.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", proxy.bound_port)
        writer.write(f"CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\n\r\n".encode("ascii"))
        await writer.drain()
        head = await reader.readuntil(b"\r\n\r\n")
        assert b"200 Connection Established" in head
        writer.write(b"ping")
        await writer.drain()
        assert await reader.readexactly(4) == b"PING"
        writer.close()
        await writer.wait_closed()
    finally:
        await proxy.close()
        await handlers.aclose()
        echo.close()
        await echo.wait_closed()


def test_egress_node_client_requires_explicit_node_id() -> None:
    with pytest.raises(ValueError, match="node_id is required"):
        NodeEgressClient(FakeGateway(NodeEgressCommandHandlers()), node_id="")


def test_command_surface_names_are_explicit() -> None:
    handlers = NodeEgressCommandHandlers()
    assert set(handlers.commands()) == {
        EGRESS_HTTP_FETCH_COMMAND,
        EGRESS_TCP_OPEN_COMMAND,
        EGRESS_TCP_READ_COMMAND,
        EGRESS_TCP_WRITE_COMMAND,
        EGRESS_TCP_CLOSE_COMMAND,
    }
