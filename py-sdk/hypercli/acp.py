"""Vanilla ACP v1 client. Prompts settle on their correlated terminal response.

Platform history and receipts are separate APIs. This client never resends input.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from acp import schema
from acp.connection import Connection
from acp.exceptions import RequestError
from acp.ws.client import create_websocket_stream
from pydantic import ValidationError
from websockets.exceptions import WebSocketException

logger = logging.getLogger("hypercli.acp")
ACP_PROTOCOL_VERSION = 1
DEFAULT_OPEN_TIMEOUT = 30.0
DEFAULT_CLIENT_INFO = {"name": "hypercli-py-sdk", "version": ""}
ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE = 4404
ACP_TERMINAL_CLOSE_CODES = frozenset({4401, 4403, 4404, 4408})
UpdateListener = Callable[[dict[str, Any]], Any]
RequestListener = Callable[..., Any]
_UNSET_CWD = object()


class ACPError(RuntimeError):
    """Base ACP failure."""


class RetryableACPError(ACPError):
    """Failure before a prompt write; no automatic retry is performed."""


class AmbiguousDeliveryError(ACPError):
    def __init__(self, detail="", *, cause=None):
        self.detail = detail
        super().__init__(f"ACP delivery or foreground outcome is unresolved ({detail}); input is not retried")
        self.__cause__ = cause


class ACPTerminalCloseError(ACPError):
    def __init__(self, code, reason="", *, cause=None):
        self.code, self.reason = code, reason
        super().__init__(f"ACP connection refused ({code}): {reason}")
        self.__cause__ = cause


class ACPClosedError(ACPError):
    pass


class ACPRequestError(ACPError):
    def __init__(self, method, code, message, data=None):
        self.method, self.code, self.rpc_message, self.data = method, code, message, data
        super().__init__(f"ACP {method} failed ({code}): {message}")


class ACPUnavailableError(ACPError):
    def __init__(self, capability, detail):
        self.capability = capability
        super().__init__(f"{capability} is not available: {detail}")


@dataclass(frozen=True)
class ACPPromptResult:
    """Native terminal prompt result, without a platform receipt dependency."""
    session_id: str
    stop_reason: str | None
    raw: dict[str, Any]
    message_id: str | None = None


class _Transport:
    """Keep disconnect observation beside the SDK-owned transport/reader."""
    def __init__(self, transport, owner):
        self.transport, self.owner = transport, owner
        self.writing = asyncio.Lock()

    async def send(self, message):
        async with self.writing:
            await self.transport.send(message)

    async def receive(self):
        try:
            message = await self.transport.receive()
        except Exception:
            async with self.writing:
                self.owner._disconnect()
            raise
        if message is None:
            # The pinned SDK transport owns the socket. Preserve its public
            # WebSocket close classification at this one transport boundary.
            async with self.writing:
                self._observe_close()
        return message

    async def close(self):
        await self.transport.close()
        self._observe_close()

    def _observe_close(self):
        socket = getattr(self.transport, "_ws", None)
        code = getattr(socket, "close_code", None)
        error = ACPTerminalCloseError(code, getattr(socket, "close_reason", "") or "") if code in ACP_TERMINAL_CLOSE_CODES else None
        self.owner._disconnect(error)


class ACPClient:
    """One connection using the pinned upstream v1 SDK runtime."""
    def __init__(self, transport, *, on_update=None, resolve_default_cwd=None):
        self._closed = False
        self._disconnected = False
        self._transport_error = None
        self._initialize_response = {}
        self._update_listeners = [on_update] if on_update else []
        self._request_listeners = {}
        self._resolve_default_cwd = resolve_default_cwd
        self._session_setups: dict[str, dict[str, Any]] = {}
        self._transport = _Transport(transport, self)
        self._connection = Connection(self._handle_message, self._transport)

    @classmethod
    async def connect(cls, url, *, token=None, open_timeout=DEFAULT_OPEN_TIMEOUT, source=None,
                      client_info=None, client_capabilities=None, on_update=None,
                      resolve_default_cwd=None):
        if source is not None:
            parts = urlsplit(url)
            query = dict(parse_qsl(parts.query, keep_blank_values=True))
            query["source"] = source
            url = urlunsplit(parts._replace(query=urlencode(query)))
        try:
            transport = await asyncio.wait_for(create_websocket_stream(url,
                headers={"Authorization": f"Bearer {token}"} if token else None), open_timeout)
        except (TimeoutError, WebSocketException, OSError) as exc:
            raise RetryableACPError(f"ACP connect failed: {exc}") from exc
        client = cls(transport, on_update=on_update,
                     resolve_default_cwd=resolve_default_cwd)
        try:
            request = schema.InitializeRequest(protocol_version=ACP_PROTOCOL_VERSION,
                client_info=schema.Implementation.model_validate(client_info or DEFAULT_CLIENT_INFO),
                client_capabilities=schema.ClientCapabilities.model_validate(client_capabilities or {}))
            result = schema.InitializeResponse.model_validate(await asyncio.wait_for(
                client._connection.send_request("initialize", request.model_dump(by_alias=True, exclude_unset=True)), open_timeout))
            client._initialize_response = result.model_dump(by_alias=True, exclude_unset=True)
            if result.protocol_version != ACP_PROTOCOL_VERSION:
                raise ACPUnavailableError("initialize", "This client requires ACP v1")
        except BaseException as exc:
            await client.close()
            if isinstance(client._transport_error, ACPTerminalCloseError):
                raise client._transport_error from exc
            if isinstance(exc, RequestError):
                raise ACPRequestError("initialize", exc.code, str(exc), exc.data) from exc
            if isinstance(exc, (TimeoutError, ConnectionError, WebSocketException, OSError)):
                raise RetryableACPError("ACP initialize did not complete") from exc
            raise
        return client

    @property
    def initialize_response(self):
        return self._initialize_response

    @property
    def closed(self):
        return self._closed

    @property
    def load_session_capable(self):
        return self._initialize_response.get("agentCapabilities", {}).get("loadSession") is True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        if not self._closed:
            self._closed = True
            self._disconnect()
            # Let an interrupted write unwind before the SDK rejects remaining
            # RPC waiters. This avoids a second, unobserved future exception in
            # the pinned SDK's write-failure/reader-close race.
            await self._transport.close()
            async with self._transport.writing:
                await self._connection.close()

    def _disconnect(self, error=None):
        self._disconnected = True
        if error is not None:
            self._transport_error = error

    def add_update_listener(self, listener):
        self._update_listeners.append(listener)
        def unsubscribe():
            if listener in self._update_listeners:
                self._update_listeners.remove(listener)
        return unsubscribe

    def add_request_listener(self, method, listener):
        self._request_listeners.setdefault(method, []).append(listener)
        return lambda: self.remove_request_listener(method, listener)

    def remove_request_listener(self, method, listener):
        listeners = self._request_listeners.get(method, [])
        if listener in listeners:
            listeners.remove(listener)

    async def request_permission(self, **params):
        request = schema.RequestPermissionRequest.model_validate(params)
        wire = request.model_dump(by_alias=True, exclude_unset=True)
        listeners = self._request_listeners.get("session/request_permission")
        specific = bool(listeners)
        listeners = listeners or self._request_listeners.get("*")
        if not listeners:
            return schema.RequestPermissionResponse.model_validate({"outcome": {"outcome": "cancelled"}})
        try:
            listener = listeners[0]
            result = listener(wire) if specific else listener("session/request_permission", wire)
            if inspect.isawaitable(result):
                result = await result
            return schema.RequestPermissionResponse.model_validate(result)
        except ACPRequestError as exc:
            raise RequestError(exc.code, exc.rpc_message, exc.data) from exc

    async def _handle_message(self, method, params, is_notification):
        # Upstream owns RPC/callback correlation; updates are opaque peer data.
        if is_notification:
            if method == "session/update":
                for listener in list(self._update_listeners):
                    try:
                        result = listener(params)
                        if inspect.isawaitable(result):
                            await result
                    except Exception:
                        logger.exception("ACP update listener failed")
            return None
        if method == "session/request_permission":
            result = await self.request_permission(**params)
            return result.model_dump(by_alias=True, exclude_unset=True)
        raise RequestError.method_not_found(method)

    async def new_session(self, *, cwd=_UNSET_CWD, mcp_servers=None) -> str:
        """Create using the runtime-owned launch default or a verbatim override."""
        if cwd is _UNSET_CWD:
            if self._resolve_default_cwd is None:
                raise ACPUnavailableError("session/new", "runtime path discovery is unavailable on this connection")
            cwd = self._resolve_default_cwd()
            if inspect.isawaitable(cwd):
                cwd = await cwd
        setup = {"cwd": cwd, "mcpServers": deepcopy(mcp_servers or [])}
        result = await self.request("session/new", setup)
        session_id = schema.NewSessionResponse.model_validate(result).session_id
        self._session_setups[session_id] = setup
        return session_id

    async def _original_session_cwd(self, session_id):
        setup = self._session_setups.get(session_id)
        if setup is not None:
            return setup["cwd"]
        cursor = None
        seen = set()
        while True:
            page = schema.ListSessionsResponse.model_validate(
                await self.request("session/list", {"cursor": cursor} if cursor is not None else {}))
            for entry in page.sessions:
                if entry.session_id == session_id:
                    return entry.cwd
            cursor = page.next_cursor
            if not cursor:
                raise ACPUnavailableError("session/resume", "the original session cwd is unavailable from the standard catalog")
            if cursor in seen:
                raise ACPUnavailableError("session/list", "catalog repeated a pagination cursor")
            seen.add(cursor)

    async def resume_session(self, session_id, *, cwd=_UNSET_CWD, mcp_servers=None):
        """Resume the exact identity with its original catalog/stored setup."""
        cwd = await self._original_session_cwd(session_id) if cwd is _UNSET_CWD else cwd
        previous = self._session_setups.get(session_id, {})
        setup = {"cwd": cwd, "mcpServers": deepcopy(mcp_servers if mcp_servers is not None else previous.get("mcpServers", []))}
        params = {"sessionId": session_id, **setup}
        result = await self.request("session/resume", params)
        self._session_setups[session_id] = setup
        return result

    async def load_session(self, session_id, *, cwd=_UNSET_CWD, mcp_servers=None):
        """Explicit standard full load; attachment never falls back to this."""
        cwd = await self._original_session_cwd(session_id) if cwd is _UNSET_CWD else cwd
        previous = self._session_setups.get(session_id, {})
        setup = {"cwd": cwd, "mcpServers": deepcopy(mcp_servers if mcp_servers is not None else previous.get("mcpServers", []))}
        result = await self.request("session/load", {"sessionId": session_id, **setup})
        self._session_setups[session_id] = setup
        return result

    async def submit_prompt(self, session_id, prompt, *, timeout=None) -> schema.PromptResponse:
        """Submit once and await the native terminal stop reason."""
        return await self._submit(session_id, prompt, timeout=timeout)

    async def _submit(self, session_id, prompt, *, timeout=None) -> schema.PromptResponse:
        blocks = [{"type": "text", "text": prompt}] if isinstance(prompt, str) else prompt
        params = {"sessionId": session_id, "prompt": blocks}
        operation = self.request("session/prompt", params)
        result = await asyncio.wait_for(operation, timeout) if timeout is not None else await operation
        try:
            return schema.PromptResponse.model_validate(result)
        except ValidationError as exc:
            raise ACPError("Invalid native terminal prompt response; input is not retried") from exc

    async def prompt(self, session_id, prompt, *, timeout=None) -> ACPPromptResult:
        """Resolve on this request's terminal response, never activity or history."""
        result = await self._submit(session_id, prompt, timeout=timeout)
        return ACPPromptResult(session_id, result.stop_reason,
            result.model_dump(mode="json", by_alias=True, exclude_unset=True))

    async def cancel(self, session_id):
        params = schema.CancelNotification(session_id=session_id)
        await self._connection.send_notification("session/cancel", params.model_dump(by_alias=True, exclude_unset=True))

    async def request(self, method, params=None):
        """Low-level SDK JSON-RPC request, preserving result and error data."""
        if self._closed:
            raise ACPClosedError("ACP client is closed")
        if self._disconnected:
            if self._transport_error is not None:
                raise self._transport_error
            raise RetryableACPError("ACP transport disconnected before request write")
        try:
            return dict(await self._connection.send_request(method, params or {}) or {})
        except RequestError as exc:
            raise ACPRequestError(method, exc.code, str(exc), exc.data) from exc
        except (ConnectionError, WebSocketException, OSError) as exc:
            if method == "session/prompt":
                raise AmbiguousDeliveryError(str(exc), cause=exc) from exc
            if self._transport_error is not None:
                raise self._transport_error from exc
            if self._closed:
                raise ACPClosedError("ACP client closed") from exc
            raise RetryableACPError(f"ACP request interrupted: {exc}") from exc
