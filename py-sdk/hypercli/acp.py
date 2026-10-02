"""Standard ACP v2 client for the backend conversation authority.

``submit_prompt`` returns durable conversation admission, not execution.
``prompt`` requires an authoritative per-message completion reader. Idle only
triggers a REST check; a missing receipt fails truthfully, including when older
queued work has ended but this input is still pending.
Neither API reconnects, retries, decorates prompts, or interprets slash text.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from acp.connection import StreamDirection
from acp.exceptions import RequestError
from acp.experimental import v2
from acp.ws.client import create_websocket_stream
from websockets.exceptions import WebSocketException

logger = logging.getLogger("hypercli.acp")
ACP_PROTOCOL_VERSION = 2
DEFAULT_OPEN_TIMEOUT = 30.0
DEFAULT_CLIENT_INFO = {"name": "hypercli-py-sdk", "version": ""}
ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE = 4404
ACP_TERMINAL_CLOSE_CODES = frozenset({4401, 4403, 4404, 4408})
UpdateListener = Callable[[dict[str, Any]], Any]
RequestListener = Callable[..., Any]


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


class ACPObservationError(ACPError):
    """Prompt was sent, but foreground observation failed; never auto-resubmit."""
    def __init__(self, detail, message_id=None):
        self.message_id = message_id
        super().__init__(detail)


@dataclass(frozen=True)
class ACPPromptResult:
    """Admission identity and completion verified by the supplied REST reader."""
    session_id: str
    stop_reason: str | None
    raw: dict[str, Any]
    message_id: str | None = None


@dataclass
class _Foreground:
    future: asyncio.Future
    message_id: str | None = None
    idle: bool = False
    checking: asyncio.Task | None = None


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


class ACPClient(v2.Client):
    """One v2 connection, using the pinned upstream versioned SDK runtime."""
    def __init__(self, transport, *, on_update=None, get_prompt_completion=None):
        self._closed = False
        self._disconnected = False
        self._transport_error = None
        self._initialize_response = {}
        self._update_listeners = [on_update] if on_update else []
        self._request_listeners = {}
        self._foreground: dict[str, _Foreground] = {}
        self._states: dict[str, str] = {}
        self._get_prompt_completion = get_prompt_completion
        self._transport = _Transport(transport, self)
        self._connection = v2.connect_to_agent(self, self._transport, observers=[self._observe])

    @classmethod
    async def connect(cls, url, *, token=None, open_timeout=DEFAULT_OPEN_TIMEOUT, source=None,
                      client_info=None, client_capabilities=None, on_update=None, get_prompt_completion=None):
        if client_capabilities and ({"fs", "terminal"} & client_capabilities.keys()):
            raise ACPUnavailableError("initialize", "v1 filesystem/terminal capabilities are not a v2 frontend profile")
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
        client = cls(transport, on_update=on_update, get_prompt_completion=get_prompt_completion)
        try:
            result = await asyncio.wait_for(client._connection.initialize(protocol_version=2,
                info=v2.schema.Implementation.model_validate(client_info or DEFAULT_CLIENT_INFO),
                capabilities=v2.schema.ClientCapabilities.model_validate(client_capabilities or {})), open_timeout)
            client._initialize_response = result.model_dump(by_alias=True, exclude_unset=True)
            if result.protocol_version != 2:
                raise ACPUnavailableError("initialize", "This client requires ACP v2")
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
        """Compatibility name for standard v2 session/resume capability."""
        return isinstance(self._initialize_response.get("capabilities", {}).get("session"), dict)

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
        for pending in self._foreground.values():
            if not pending.future.done():
                pending.future.set_exception(AmbiguousDeliveryError("connection closed before foreground observation finished"))

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
        request = v2.schema.RequestPermissionRequest.model_validate(params)
        wire = request.model_dump(by_alias=True, exclude_unset=True)
        listeners = self._request_listeners.get("session/request_permission") or self._request_listeners.get("*")
        if not listeners:
            return v2.schema.RequestPermissionResponse.model_validate({"outcome": {"outcome": "cancelled"}})
        try:
            listener = listeners[0]
            result = listener(wire) if self._request_listeners.get("session/request_permission") else listener("session/request_permission", wire)
            if inspect.isawaitable(result):
                result = await result
            return v2.schema.RequestPermissionResponse.model_validate(result)
        except ACPRequestError as exc:
            raise RequestError(exc.code, exc.rpc_message, exc.data) from exc

    async def session_update(self, session_id, update, **kwargs):
        params = {"sessionId": session_id, "update": update.model_dump(mode="json", by_alias=True, exclude_unset=True)}
        if "_meta" in kwargs:
            params["_meta"] = kwargs["_meta"]
        for listener in list(self._update_listeners):
            result = listener(params)
            if inspect.isawaitable(result):
                await result

    def _observe(self, event):
        message = event.message
        if event.direction != StreamDirection.INCOMING or message.get("method") != "session/update":
            return
        params = message["params"]
        sid, update = params["sessionId"], params["update"]
        pending = self._foreground.get(sid)
        kind = update.get("sessionUpdate")
        if kind == "state_update":
            self._states[sid] = update["state"]
        if pending is None or pending.future.done():
            return
        if kind == "notice" and update.get("severity") == "error":
            pending.future.set_exception(ACPObservationError(f"ACP session error: {update['title']}: {update.get('description') or ''}", pending.message_id))
        elif kind == "state_update":
            if update["state"] == "idle":
                pending.idle = True
        self._settle(sid, pending)

    def _settle(self, sid, pending):
        if pending.future.done() or pending.message_id is None:
            return
        if pending.idle and pending.checking is None:
            async def verify():
                try:
                    proof = await self._get_prompt_completion(sid, pending.message_id)
                    if pending.future.done() or self._foreground.get(sid) is not pending:
                        return
                    if not proof:
                        raise ACPObservationError("Input accepted, but no completion receipt exists for this message; follow history without resubmitting", pending.message_id)
                    pending.future.set_result(ACPPromptResult(sid, proof["stopReason"], proof, pending.message_id))
                except Exception as exc:
                    if not pending.future.done():
                        pending.future.set_exception(ACPObservationError(f"Completion receipt unavailable: {exc}", pending.message_id))
            pending.checking = asyncio.create_task(verify())

    async def new_session(self, *, cwd, mcp_servers=None):
        result = await self.request("session/new", {"cwd": cwd, "mcpServers": mcp_servers or []})
        parsed = v2.schema.NewSessionResponse.model_validate(result)
        self._states.setdefault(parsed.session_id, "idle")
        return parsed.session_id

    async def resume_session(self, session_id, *, cwd, mcp_servers=None, replay=False):
        params = {"sessionId": session_id, "cwd": cwd, "mcpServers": mcp_servers or []}
        if replay:
            params["replayFrom"] = {"type": "start"}
        return await self.request("session/resume", params)

    async def load_session(self, session_id, *, cwd, mcp_servers=None):
        """Compatibility helper name; sends standard v2 resume with replay."""
        return await self.resume_session(session_id, cwd=cwd, mcp_servers=mcp_servers, replay=True)

    async def submit_prompt(self, session_id, prompt, *, timeout=None):
        """Return the standard inserted messageId, independent of execution."""
        if session_id in self._foreground:
            raise ACPError("Cannot mix submit_prompt with an isolated prompt observation")
        return await self._submit(session_id, prompt, timeout=timeout)

    async def _submit(self, session_id, prompt, *, timeout=None):
        blocks = [{"type": "text", "text": prompt}] if isinstance(prompt, str) else prompt
        params = {"sessionId": session_id, "prompt": blocks}
        v2.schema.PromptRequest.model_validate(params)
        operation = self.request("session/prompt", params)
        result = await asyncio.wait_for(operation, timeout) if timeout is not None else await operation
        return v2.schema.PromptResponse.model_validate(result)

    async def prompt(self, session_id, prompt, *, timeout=None):
        """Submit once; resolve only with exact Backend message completion evidence.

        Without get_prompt_completion this helper refuses before submission.
        Missing evidence at idle is an error, never an inferred end_turn.
        """
        if self._get_prompt_completion is None:
            raise ACPUnavailableError("prompt", "v2 has no per-message completion event; use submit_prompt or supply an exact platform REST receipt reader")
        if session_id in self._foreground or self._states.get(session_id) in {"running", "requires_action"}:
            raise ACPError("Session foreground is active; use submit_prompt for concurrent admission")
        pending = _Foreground(asyncio.get_running_loop().create_future())
        pending.future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        self._foreground[session_id] = pending
        async def observe():
            submission = asyncio.create_task(self._submit(session_id, prompt))
            try:
                await asyncio.wait({submission, pending.future}, return_when=asyncio.FIRST_COMPLETED)
                if pending.future.done():
                    return await pending.future
                accepted = await submission
                pending.message_id = accepted.message_id
                self._settle(session_id, pending)
                return await pending.future
            finally:
                if not submission.done():
                    submission.cancel()
                await asyncio.gather(submission, return_exceptions=True)
        try:
            return await asyncio.wait_for(observe(), timeout) if timeout is not None else await observe()
        finally:
            self._foreground.pop(session_id, None)
            if pending.checking is not None:
                pending.checking.cancel()
                await asyncio.gather(pending.checking, return_exceptions=True)

    async def cancel(self, session_id):
        await self._connection.cancel_session(session_id=session_id)

    async def request(self, method, params=None):
        """Low-level SDK JSON-RPC request, preserving result and error data."""
        if self._closed:
            raise ACPClosedError("ACP client is closed")
        if self._disconnected:
            if self._transport_error is not None:
                raise self._transport_error
            raise RetryableACPError("ACP transport disconnected before request write")
        try:
            return dict(await self._connection._conn.send_request(method, params or {}) or {})
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
