"""Experimental OpenClaw node egress helpers.

This module proves a narrow no-OpenClaw-change proxy/egress shape using the
existing node protocol:

* A node process connects with ``role="node"`` and declares explicit
  ``egress.*`` commands in the gateway connect handshake.
* An operator process calls ``GatewayClient.node_invoke(node_id, command, ...)``.
* The gateway sends exactly one ``node.invoke.request`` to the node and waits
  for exactly one ``node.invoke.result``. This is RPC over ``node.invoke``, not
  a generic socket bus.

The portable API names are ``NodeEgressServer``, ``NodeEgressClient``, and
``NodeEgressCommandHandlers``. The reliable lane is ``egress.http.fetch``: the
node performs one bounded HTTP request and returns base64 body chunks. The TCP
lane (``egress.tcp.*`` and ``LoopbackNodeProxy`` CONNECT support) is deliberately
small and experimental: it approximates a socket by issuing many chunked invoke
calls, so latency and overhead are high. Production-grade streaming would need a
gateway protocol change that supports bidirectional stream frames, flow control,
and node-pushed userland data frames.

Security defaults are intentionally conservative. Local proxy listeners bind to
``127.0.0.1`` by default, callers must provide an explicit node id, and node
handlers deny loopback, private, link-local, multicast, and cloud metadata
addresses unless ``allow_private_network=True`` is set by the operator.

Pairing note: custom ``egress.*`` commands must be declared by the node,
approved as part of the node command surface, and may need to be listed in the
gateway config ``gateway.nodes.allowCommands`` before ``node.invoke`` accepts
them.

Native-node note: Backseat Driver's macOS ``NodeRuntime`` is the precedent for
this model. macOS and Android native apps can become node hosts with the same
``role="node"``/declared-command approach; Android should eventually get
Kotlin NodeRuntime parity rather than a separate protocol.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import socket
import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from .gateway import GatewayClient, NodeInvokeHandler, NodeServer


EGRESS_HTTP_FETCH_COMMAND = "egress.http.fetch"
EGRESS_TCP_OPEN_COMMAND = "egress.tcp.open"
EGRESS_TCP_READ_COMMAND = "egress.tcp.read"
EGRESS_TCP_WRITE_COMMAND = "egress.tcp.write"
EGRESS_TCP_CLOSE_COMMAND = "egress.tcp.close"
EGRESS_COMMANDS = [
    EGRESS_HTTP_FETCH_COMMAND,
    EGRESS_TCP_OPEN_COMMAND,
    EGRESS_TCP_READ_COMMAND,
    EGRESS_TCP_WRITE_COMMAND,
    EGRESS_TCP_CLOSE_COMMAND,
]

__all__ = [
    "EGRESS_COMMANDS",
    "EGRESS_HTTP_FETCH_COMMAND",
    "EGRESS_TCP_CLOSE_COMMAND",
    "EGRESS_TCP_OPEN_COMMAND",
    "EGRESS_TCP_READ_COMMAND",
    "EGRESS_TCP_WRITE_COMMAND",
    "EgressCommandHandlers",
    "EgressNodeClient",
    "EgressNodeServer",
    "EgressPolicyError",
    "EgressProtocolError",
    "LoopbackNodeProxy",
    "NodeEgressClient",
    "NodeEgressCommandHandlers",
    "NodeEgressServer",
    "assert_public_destination",
]

DEFAULT_CHUNK_BYTES = 64 * 1024
MIN_CHUNK_BYTES = 1024
MAX_CHUNK_BYTES = 64 * 1024
DEFAULT_MAX_HTTP_BYTES = 2 * 1024 * 1024
MAX_HTTP_BYTES = 8 * 1024 * 1024
DEFAULT_TCP_READ_BYTES = 32 * 1024
MAX_TCP_READ_BYTES = 64 * 1024
DEFAULT_TCP_TTL_SECONDS = 60.0
MAX_TCP_CONNECTIONS = 128
DEFAULT_INVOKE_TIMEOUT_MS = 30_000
DEFAULT_HTTP_TIMEOUT_SECONDS = 20.0
DEFAULT_TCP_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_TCP_READ_WAIT_MS = 250
MAX_TCP_READ_WAIT_MS = 2_000
HTTP_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class EgressPolicyError(ValueError):
    """Raised when an egress request violates the local node policy."""


class EgressProtocolError(RuntimeError):
    """Raised when an egress node returns an invalid payload."""


def _b64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64_decode(data: Any, *, field: str) -> bytes:
    if not isinstance(data, str):
        raise ValueError(f"{field} must be base64 text")
    try:
        return base64.b64decode(data.encode("ascii"), validate=True)
    except Exception as exc:
        raise ValueError(f"{field} is not valid base64") from exc


def _clamp_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return default
    return max(minimum, min(maximum, value))


def _now() -> float:
    return time.monotonic()


def _normalize_host(host: Any) -> str:
    if not isinstance(host, str) or not host.strip():
        raise ValueError("host required")
    normalized = host.strip().strip("[]")
    if not normalized:
        raise ValueError("host required")
    return normalized


def _normalize_port(port: Any) -> int:
    if isinstance(port, str) and port.strip().isdigit():
        port = int(port.strip())
    if not isinstance(port, int) or isinstance(port, bool) or port <= 0 or port > 65535:
        raise ValueError("port must be 1..65535")
    return port


def _is_disallowed_ip(ip: ipaddress._BaseAddress) -> bool:
    if ip.is_private:
        return True
    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
        return True
    if ip.is_unspecified:
        return True
    if ip.version == 4 and ip == ipaddress.ip_address("169.254.169.254"):
        return True
    if ip.version == 6 and ip == ipaddress.ip_address("fd00:ec2::254"):
        return True
    return False


async def _resolve_host_ips(host: str, port: int) -> list[ipaddress._BaseAddress]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(
            host,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as exc:
        raise EgressPolicyError(f"host resolution failed: {host}") from exc
    ips: list[ipaddress._BaseAddress] = []
    seen: set[str] = set()
    for family, _type, _proto, _canon, sockaddr in infos:
        if family not in {socket.AF_INET, socket.AF_INET6}:
            continue
        raw_ip = sockaddr[0]
        try:
            parsed = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        key = str(parsed)
        if key not in seen:
            seen.add(key)
            ips.append(parsed)
    if not ips:
        raise EgressPolicyError(f"host resolution returned no usable addresses: {host}")
    return ips


async def assert_public_destination(
    host: str,
    port: int,
    *,
    allow_private_network: bool = False,
) -> None:
    """Resolve and reject private/link-local/metadata destinations by default."""

    if allow_private_network:
        return
    ips = await _resolve_host_ips(host, port)
    blocked = [str(ip) for ip in ips if _is_disallowed_ip(ip)]
    if blocked:
        raise EgressPolicyError(f"destination resolves to blocked address: {host} -> {blocked[0]}")


def _http_port_for_url(parts) -> int:
    if parts.port is not None:
        return parts.port
    if parts.scheme == "https":
        return 443
    if parts.scheme == "http":
        return 80
    raise ValueError("url scheme must be http or https")


def _sanitize_request_headers(headers: Any) -> dict[str, str]:
    if headers is None:
        return {}
    if not isinstance(headers, dict):
        raise ValueError("headers must be an object")
    out: dict[str, str] = {}
    for key, value in headers.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("headers must contain string keys and values")
        name = key.strip()
        lower = name.lower()
        if not name or lower in HTTP_HOP_BY_HOP_HEADERS:
            continue
        if lower == "host":
            continue
        out[name] = value
    return out


def _sanitize_response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        lower = key.lower()
        if lower in HTTP_HOP_BY_HOP_HEADERS or lower == "set-cookie":
            continue
        out[key] = value
    return out


def _decode_request_body(params: dict[str, Any]) -> bytes | None:
    if "bodyBase64" in params and params["bodyBase64"] is not None:
        return _b64_decode(params["bodyBase64"], field="bodyBase64")
    if "bodyText" in params and params["bodyText"] is not None:
        body_text = params["bodyText"]
        if not isinstance(body_text, str):
            raise ValueError("bodyText must be a string")
        return body_text.encode("utf-8")
    return None


def _payload_from_node_response(response: Any) -> dict[str, Any]:
    if isinstance(response, dict) and isinstance(response.get("payload"), dict):
        return response["payload"]
    if isinstance(response, dict) and isinstance(response.get("payloadJSON"), str):
        import json

        decoded = json.loads(response["payloadJSON"])
        if isinstance(decoded, dict):
            return decoded
    if isinstance(response, dict) and "ok" in response:
        return response
    raise EgressProtocolError("node.invoke returned an invalid egress payload")


@dataclass
class _TcpConnection:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    created_at: float = field(default_factory=_now)
    last_used: float = field(default_factory=_now)
    closed: bool = False


class NodeEgressCommandHandlers:
    """Node-local handlers for ``egress.*`` commands."""

    def __init__(
        self,
        *,
        allow_private_network: bool = False,
        chunk_bytes: int = DEFAULT_CHUNK_BYTES,
        max_http_bytes: int = DEFAULT_MAX_HTTP_BYTES,
        tcp_ttl_seconds: float = DEFAULT_TCP_TTL_SECONDS,
        max_tcp_connections: int = MAX_TCP_CONNECTIONS,
    ) -> None:
        self.allow_private_network = allow_private_network
        self.chunk_bytes = max(MIN_CHUNK_BYTES, min(MAX_CHUNK_BYTES, int(chunk_bytes)))
        self.max_http_bytes = max(0, min(MAX_HTTP_BYTES, int(max_http_bytes)))
        self.tcp_ttl_seconds = max(1.0, float(tcp_ttl_seconds))
        self.max_tcp_connections = max(1, int(max_tcp_connections))
        self._tcp: dict[str, _TcpConnection] = {}

    def commands(self) -> dict[str, NodeInvokeHandler]:
        return {
            EGRESS_HTTP_FETCH_COMMAND: self.http_fetch,
            EGRESS_TCP_OPEN_COMMAND: self.tcp_open,
            EGRESS_TCP_READ_COMMAND: self.tcp_read,
            EGRESS_TCP_WRITE_COMMAND: self.tcp_write,
            EGRESS_TCP_CLOSE_COMMAND: self.tcp_close,
        }

    async def aclose(self) -> None:
        for conn_id in list(self._tcp.keys()):
            await self._close_conn(conn_id)

    async def http_fetch(self, params: dict[str, Any]) -> dict[str, Any]:
        method = str(params.get("method") or "GET").upper()
        if method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}:
            raise ValueError("unsupported HTTP method")
        url = params.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError("url required")
        parts = urlsplit(url.strip())
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise ValueError("url scheme must be http or https")
        port = _http_port_for_url(parts)
        await assert_public_destination(
            parts.hostname,
            port,
            allow_private_network=self.allow_private_network
            or params.get("allowPrivateNetwork") is True,
        )

        max_bytes = _clamp_int(
            params.get("maxBytes"),
            default=self.max_http_bytes,
            minimum=0,
            maximum=MAX_HTTP_BYTES,
        )
        chunk_bytes = _clamp_int(
            params.get("chunkBytes"),
            default=self.chunk_bytes,
            minimum=MIN_CHUNK_BYTES,
            maximum=MAX_CHUNK_BYTES,
        )
        timeout_s = float(params.get("timeoutSeconds") or DEFAULT_HTTP_TIMEOUT_SECONDS)
        headers = _sanitize_request_headers(params.get("headers"))
        body = _decode_request_body(params)

        chunks: list[str] = []
        total = 0
        truncated = False
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            async with client.stream(method, url.strip(), headers=headers, content=body) as res:
                async for chunk in res.aiter_bytes(chunk_size=chunk_bytes):
                    if not chunk:
                        continue
                    remaining = max_bytes - total
                    if remaining <= 0:
                        truncated = True
                        break
                    if len(chunk) > remaining:
                        chunks.append(_b64_encode(chunk[:remaining]))
                        total += remaining
                        truncated = True
                        break
                    chunks.append(_b64_encode(chunk))
                    total += len(chunk)
                return {
                    "ok": True,
                    "status": res.status_code,
                    "headers": _sanitize_response_headers(res.headers),
                    "bodyBase64Chunks": chunks,
                    "bodyBytes": total,
                    "truncated": truncated,
                }

    async def tcp_open(self, params: dict[str, Any]) -> dict[str, Any]:
        self._cleanup_expired()
        if len(self._tcp) >= self.max_tcp_connections:
            raise RuntimeError("too many open egress tcp connections")
        host = _normalize_host(params.get("host"))
        port = _normalize_port(params.get("port"))
        await assert_public_destination(
            host,
            port,
            allow_private_network=self.allow_private_network
            or params.get("allowPrivateNetwork") is True,
        )
        timeout_s = float(params.get("timeoutSeconds") or DEFAULT_TCP_CONNECT_TIMEOUT_SECONDS)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout_s,
        )
        conn_id = uuid.uuid4().hex
        self._tcp[conn_id] = _TcpConnection(reader=reader, writer=writer)
        return {"ok": True, "connId": conn_id}

    async def tcp_write(self, params: dict[str, Any]) -> dict[str, Any]:
        conn = self._require_conn(params.get("connId"))
        chunks = params.get("dataBase64Chunks")
        if not isinstance(chunks, list):
            raise ValueError("dataBase64Chunks must be a list")
        total = 0
        for index, chunk in enumerate(chunks):
            data = _b64_decode(chunk, field=f"dataBase64Chunks[{index}]")
            if len(data) > MAX_CHUNK_BYTES:
                raise ValueError("tcp write chunk exceeds 64 KiB")
            total += len(data)
            conn.writer.write(data)
        await conn.writer.drain()
        conn.last_used = _now()
        return {"ok": True, "writtenBytes": total}

    async def tcp_read(self, params: dict[str, Any]) -> dict[str, Any]:
        conn = self._require_conn(params.get("connId"))
        max_bytes = _clamp_int(
            params.get("maxBytes"),
            default=DEFAULT_TCP_READ_BYTES,
            minimum=1,
            maximum=MAX_TCP_READ_BYTES,
        )
        wait_ms = _clamp_int(
            params.get("waitMs"),
            default=DEFAULT_TCP_READ_WAIT_MS,
            minimum=0,
            maximum=MAX_TCP_READ_WAIT_MS,
        )
        data = b""
        closed = False
        try:
            if wait_ms > 0:
                data = await asyncio.wait_for(conn.reader.read(max_bytes), timeout=wait_ms / 1000)
            else:
                data = await asyncio.wait_for(conn.reader.read(max_bytes), timeout=0.001)
        except asyncio.TimeoutError:
            data = b""
        if data == b"" and conn.reader.at_eof():
            closed = True
            conn.closed = True
        conn.last_used = _now()
        return {
            "ok": True,
            "dataBase64Chunks": [_b64_encode(data)] if data else [],
            "readBytes": len(data),
            "closed": closed,
        }

    async def tcp_close(self, params: dict[str, Any]) -> dict[str, Any]:
        conn_id = self._normalize_conn_id(params.get("connId"))
        existed = conn_id in self._tcp
        await self._close_conn(conn_id)
        return {"ok": True, "closed": existed}

    def _normalize_conn_id(self, value: Any) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("connId required")
        return value.strip()

    def _require_conn(self, value: Any) -> _TcpConnection:
        self._cleanup_expired()
        conn_id = self._normalize_conn_id(value)
        conn = self._tcp.get(conn_id)
        if conn is None or conn.closed:
            raise ValueError("unknown or closed connId")
        return conn

    async def _close_conn(self, conn_id: str) -> None:
        conn = self._tcp.pop(conn_id, None)
        if conn is None:
            return
        conn.closed = True
        conn.writer.close()
        try:
            await conn.writer.wait_closed()
        except Exception:
            pass

    def _cleanup_expired(self) -> None:
        cutoff = _now() - self.tcp_ttl_seconds
        expired = [
            conn_id
            for conn_id, conn in self._tcp.items()
            if conn.closed or conn.last_used < cutoff
        ]
        for conn_id in expired:
            conn = self._tcp.pop(conn_id, None)
            if conn is not None:
                conn.closed = True
                conn.writer.close()


class NodeEgressServer:
    """Node-side egress server built on the existing OpenClaw ``NodeServer``."""

    def __init__(
        self,
        url: str,
        node_id: str,
        *,
        token: str | None = None,
        gateway_token: str | None = None,
        display_name: str | None = "HyperCLI Egress Node",
        allow_private_network: bool = False,
        **node_server_kwargs: Any,
    ) -> None:
        self.handlers = NodeEgressCommandHandlers(
            allow_private_network=allow_private_network,
        )
        self.node_server = NodeServer(
            url=url,
            node_id=node_id,
            commands=self.handlers.commands(),
            token=token,
            gateway_token=gateway_token,
            display_name=display_name,
            caps=["egress"],
            **node_server_kwargs,
        )

    @property
    def is_connected(self) -> bool:
        return self.node_server.is_connected

    async def connect(self) -> None:
        await self.node_server.connect()

    async def close(self) -> None:
        await self.handlers.aclose()
        await self.node_server.close()

    async def __aenter__(self) -> "NodeEgressServer":
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()


class NodeEgressClient:
    """Operator-side helper that invokes explicit ``egress.*`` node commands."""

    def __init__(
        self,
        gateway: GatewayClient,
        *,
        node_id: str,
        invoke_timeout_ms: int = DEFAULT_INVOKE_TIMEOUT_MS,
    ) -> None:
        if not node_id or not node_id.strip():
            raise ValueError("node_id is required; egress helpers never auto-select a node")
        self.gateway = gateway
        self.node_id = node_id.strip()
        self.invoke_timeout_ms = invoke_timeout_ms

    async def http_fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        max_bytes: int = DEFAULT_MAX_HTTP_BYTES,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "url": url,
            "method": method,
            "headers": headers or {},
            "maxBytes": max_bytes,
            "chunkBytes": DEFAULT_CHUNK_BYTES,
        }
        if body is not None:
            params["bodyBase64"] = _b64_encode(body)
        return await self.invoke(EGRESS_HTTP_FETCH_COMMAND, params)

    async def tcp_open(self, host: str, port: int) -> str:
        payload = await self.invoke(EGRESS_TCP_OPEN_COMMAND, {"host": host, "port": port})
        conn_id = payload.get("connId")
        if not isinstance(conn_id, str) or not conn_id:
            raise EgressProtocolError("tcp.open response missing connId")
        return conn_id

    async def tcp_write(self, conn_id: str, data: bytes) -> int:
        chunks = [_b64_encode(data[i : i + MAX_CHUNK_BYTES]) for i in range(0, len(data), MAX_CHUNK_BYTES)]
        payload = await self.invoke(
            EGRESS_TCP_WRITE_COMMAND,
            {"connId": conn_id, "dataBase64Chunks": chunks},
        )
        return int(payload.get("writtenBytes") or 0)

    async def tcp_read(
        self,
        conn_id: str,
        *,
        max_bytes: int = DEFAULT_TCP_READ_BYTES,
        wait_ms: int = DEFAULT_TCP_READ_WAIT_MS,
    ) -> tuple[bytes, bool]:
        payload = await self.invoke(
            EGRESS_TCP_READ_COMMAND,
            {"connId": conn_id, "maxBytes": max_bytes, "waitMs": wait_ms},
        )
        chunks = payload.get("dataBase64Chunks")
        if not isinstance(chunks, list):
            raise EgressProtocolError("tcp.read response missing dataBase64Chunks")
        data = b"".join(_b64_decode(chunk, field="dataBase64Chunks[]") for chunk in chunks)
        return data, payload.get("closed") is True

    async def tcp_close(self, conn_id: str) -> None:
        await self.invoke(EGRESS_TCP_CLOSE_COMMAND, {"connId": conn_id})

    async def invoke(self, command: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await self.gateway.node_invoke(
            self.node_id,
            command,
            params,
            timeout_ms=self.invoke_timeout_ms,
        )
        payload = _payload_from_node_response(response)
        if payload.get("ok") is False:
            message = payload.get("error") or payload.get("message") or "egress command failed"
            raise EgressProtocolError(str(message))
        return payload


class LoopbackNodeProxy:
    """Small loopback HTTP proxy using an egress node.

    Absolute-form HTTP requests are relayed through ``egress.http.fetch``.
    ``CONNECT host:port`` creates an experimental polling TCP tunnel through
    ``egress.tcp.*``. Bind remains loopback by default and node id is explicit.
    """

    def __init__(
        self,
        egress: NodeEgressClient,
        *,
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        if host not in {"127.0.0.1", "localhost"}:
            raise ValueError("LoopbackNodeProxy binds to 127.0.0.1/localhost only")
        self.egress = egress
        self.host = "127.0.0.1" if host == "localhost" else host
        self.port = port
        self._server: asyncio.AbstractServer | None = None

    @property
    def bound_port(self) -> int:
        if not self._server or not self._server.sockets:
            return self.port
        return int(self._server.sockets[0].getsockname()[1])

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle_client, self.host, self.port)

    async def close(self) -> None:
        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()
        self._server = None

    async def __aenter__(self) -> "LoopbackNodeProxy":
        await self.start()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            request_head = header.decode("iso-8859-1")
            lines = request_head.split("\r\n")
            request_line = lines[0]
            method, target, _version = request_line.split(" ", 2)
            headers = _parse_http_headers(lines[1:])
            if method.upper() == "CONNECT":
                await self._handle_connect(target, reader, writer)
            else:
                await self._handle_http(method, target, headers, reader, writer)
        except Exception as exc:
            if not writer.is_closing():
                _write_simple_response(writer, 502, f"proxy error: {exc}".encode("utf-8"))
        finally:
            if not writer.is_closing():
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass

    async def _handle_http(
        self,
        method: str,
        target: str,
        headers: dict[str, str],
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        if not target.startswith("http://") and not target.startswith("https://"):
            _write_simple_response(writer, 400, b"absolute-form URL required")
            return
        body = await _read_proxy_request_body(reader, headers)
        payload = await self.egress.http_fetch(target, method=method, headers=headers, body=body)
        status = int(payload.get("status") or 502)
        response_headers = payload.get("headers") if isinstance(payload.get("headers"), dict) else {}
        body_chunks = payload.get("bodyBase64Chunks")
        if not isinstance(body_chunks, list):
            body_chunks = []
        body_bytes = b"".join(_b64_decode(chunk, field="bodyBase64Chunks[]") for chunk in body_chunks)
        head = [f"HTTP/1.1 {status} OK"]
        for key, value in response_headers.items():
            if isinstance(key, str) and isinstance(value, str) and key.lower() != "content-length":
                head.append(f"{key}: {value}")
        head.append(f"Content-Length: {len(body_bytes)}")
        head.append("Connection: close")
        writer.write(("\r\n".join(head) + "\r\n\r\n").encode("iso-8859-1") + body_bytes)
        await writer.drain()

    async def _handle_connect(
        self,
        target: str,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        host, port = _parse_connect_target(target)
        conn_id = await self.egress.tcp_open(host, port)
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        stop = asyncio.Event()

        async def upload() -> None:
            try:
                while not stop.is_set():
                    data = await reader.read(DEFAULT_TCP_READ_BYTES)
                    if not data:
                        break
                    await self.egress.tcp_write(conn_id, data)
            finally:
                stop.set()

        async def download() -> None:
            try:
                while not stop.is_set():
                    data, closed = await self.egress.tcp_read(conn_id)
                    if data:
                        writer.write(data)
                        await writer.drain()
                    if closed:
                        break
            finally:
                stop.set()

        try:
            await asyncio.gather(upload(), download())
        finally:
            await self.egress.tcp_close(conn_id)


def _parse_http_headers(lines: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in lines:
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip()] = value.strip()
    return headers


async def _read_proxy_request_body(
    reader: asyncio.StreamReader,
    headers: dict[str, str],
) -> bytes | None:
    length_raw = next((v for k, v in headers.items() if k.lower() == "content-length"), None)
    if not length_raw:
        return None
    try:
        length = int(length_raw)
    except ValueError:
        raise ValueError("invalid content-length")
    if length < 0 or length > MAX_HTTP_BYTES:
        raise ValueError("request body too large")
    return await reader.readexactly(length) if length else b""


def _parse_connect_target(target: str) -> tuple[str, int]:
    raw = target.strip()
    if raw.startswith("["):
        end = raw.find("]")
        if end < 0 or end + 2 > len(raw) or raw[end + 1] != ":":
            raise ValueError("CONNECT target must be host:port")
        return raw[1:end], _normalize_port(raw[end + 2 :])
    if ":" not in raw:
        raise ValueError("CONNECT target must be host:port")
    host, port = raw.rsplit(":", 1)
    return _normalize_host(host), _normalize_port(port)


def _write_simple_response(
    writer: asyncio.StreamWriter,
    status: int,
    body: bytes,
) -> None:
    writer.write(
        (
            f"HTTP/1.1 {status} Error\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        + body
    )


# Compatibility aliases for the first prototype naming. Prefer NodeEgress* for
# the portable contract shared by Python, native macOS/Android nodes, and TS.
EgressCommandHandlers = NodeEgressCommandHandlers
EgressNodeServer = NodeEgressServer
EgressNodeClient = NodeEgressClient
