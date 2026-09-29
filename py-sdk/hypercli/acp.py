"""Async ACP (Agent Client Protocol) client for coding agents.

Every hosted coding-agent pod runs a ``hyper-acp`` bridge that proxies an ACP child
(``opencode acp``, ``claude-code acp``, ...) onto a WebSocket endpoint at
``/ws``. This module dials that bridge as the client side
(``?agent_id=<uuid>&token=<api key>``), runs the ACP ``initialize`` handshake,
and exposes one-shot session helpers: ``new_session``, ``load_session`` (gated
on the advertised ``agentCapabilities.loadSession`` capability), and
``prompt``.

Parity across sibling SDKs:

- TypeScript SDK (``ts-sdk/src/acp.ts``): full ``CodingAgentAcpClient`` with
  reconnect backoff, session replay via ``session/load``, pooled update
  listeners, and terminal-close classification.
- Python SDK (this module): minimal one-shot client with the same framing and
  capability gate. There is deliberately NO auto-reconnect magic here: callers
  like the routines scheduler are one-shot per fire and own reconnect/retry
  semantics themselves.
- Rust SDK (``rs-sdk``): ``AcpClient`` mirroring this module's framing,
  capability gate, and error classification (``AcpError::Retryable`` /
  ``AmbiguousDelivery`` / ``Request`` / ``Unavailable`` / ``Closed``).
- ``py-cli``: no ACP client.

Retry policy (mirrors the TypeScript client):

- Failures before a ``session/prompt`` frame is ever sent — dial, WS
  handshake, ``initialize``, session setup — raise :class:`RetryableACPError`.
  Restarting the whole operation is safe because no agent work can have
  started.
- Once a ``session/prompt`` frame has been sent, an in-flight turn is NEVER
  retried: the prompt may still reach the agent, so resending risks duplicate
  execution. Post-send failures raise :class:`AmbiguousDeliveryError`; callers
  must reconcile by inspecting the agent's sessions (``session/load`` /
  ``session/list``) before deciding whether to re-issue the prompt.
- JSON-RPC error responses from the agent raise :class:`ACPRequestError` and
  are terminal protocol failures (not transport noise).
- An explicit client close rejects pending non-prompt requests with
  :class:`ACPClosedError` — terminal, never retryable — while pending prompt
  turns still surface :class:`AmbiguousDeliveryError` (the prompt may already
  be executing). This matches the Rust client's ``AcpError::Closed`` split.
- A bridge refusal carrying a terminal close code (:data:`ACP_TERMINAL_CLOSE_CODES`
  — 4401/4403 auth refusals, 4404 unknown-session attach, 4408 invalid
  binding) raises :class:`ACPTerminalCloseError` with the close ``code``:
  terminal, never retryable, because re-dialing with the same credentials or
  pinned session can never succeed (mirrors the ts-sdk classification).

The default permission policy matches the TypeScript SDK: a raw client never
auto-approves — inbound ``session/request_permission`` requests are answered
with the ``cancelled`` outcome, and unknown inbound requests get a
JSON-RPC ``method not found`` error. Callers that want to serve agent→client
requests register a request listener (:meth:`ACPClient.add_request_listener`)
which takes over that default handling for matching methods.

Vendor extension frames (``_hypercli.dev/*``) are leg-side only
(pod ↔ backend): this client emits none and silently drops inbound ones.
``_hypercli.dev/turn_ended_ack`` and ``_hypercli.dev/session_read_ack`` are
retired from the wire contract (no pod-side retention, no acks; user read
receipts are backend-owned), and the proxy tee is 100% vanilla ACP — there is
no ``_meta["hypercli.dev"].seq`` annotation to consume. Mirrors the ts-sdk
artifacts, which keep only the constant definitions plus the refusal
guardrails on this boundary.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import websockets
from websockets.exceptions import WebSocketException

logger = logging.getLogger("hypercli.acp")

ACP_PROTOCOL_VERSION = 1
DEFAULT_OPEN_TIMEOUT = 30.0
DEFAULT_CLIENT_INFO = {"name": "hypercli-py-sdk", "version": ""}

# Proxy (`/ws/acp`) close code for an attach whose `session_id` the backend
# session store does not hold for this agent. Re-dialing the same id can
# never succeed, so the code is terminal just like the auth refusals.
# (Mirrors ts-sdk ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE.)
ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE = 4404

# Bridge close codes that must not be retried: the identity/binding itself is
# rejected, so re-dialing with the same credentials can never succeed. 4404
# is the proxy's unknown-session attach — same permanence, the session the
# URL pins does not exist. (4409, duplicate side, is transient — the other
# client may disconnect.) Mirrors ts-sdk acp.ts ACP_TERMINAL_CLOSE_CODES.
ACP_TERMINAL_CLOSE_CODES = frozenset({4401, 4403, ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE, 4408})

UpdateListener = Callable[[dict[str, Any]], None]
RequestListener = Callable[..., Any]


class ACPError(RuntimeError):
    """Base class for ACP client failures."""


class RetryableACPError(ACPError):
    """Pre-prompt failure: connect, handshake, ``initialize``, or session setup.

    No ``session/prompt`` frame was ever sent, so restarting the whole
    operation from scratch cannot duplicate agent work.
    """


class AmbiguousDeliveryError(ACPError):
    """Post-prompt-send failure: the turn may still reach the agent.

    NEVER auto-retry on this error: the prompt may have been delivered and the
    agent may already be executing it, so resending risks duplicate execution.
    Reconcile by inspecting the agent's session state (``session/load`` or
    ``session/list``) before re-issuing the prompt.

    ``detail`` carries the underlying transport failure text for diagnostics.
    """

    def __init__(self, detail: str = "", *, cause: BaseException | None = None):
        self.detail = detail
        super().__init__(
            f"ACP connection dropped after the session/prompt frame was sent ({detail}); "
            "not retrying to avoid duplicate execution — the prompt may still reach the "
            "agent; inspect the agent's session state with session/load or session/list "
            "before re-issuing the prompt"
        )
        if cause is not None:
            self.__cause__ = cause


class ACPTerminalCloseError(ACPError):
    """Terminal bridge refusal: the socket closed with a terminal close code.

    Codes in :data:`ACP_TERMINAL_CLOSE_CODES` reject the identity or the
    pinned session itself, so re-dialing with the same credentials can never
    succeed — never classified as :class:`RetryableACPError`. ``code`` carries
    the bridge close code and ``reason`` the close-frame text (mirrors the
    ts-sdk ``terminate`` path, where these codes end the connection).
    """

    def __init__(self, code: int, reason: str = "", *, cause: BaseException | None = None):
        self.code = code
        self.reason = reason
        detail = f"ACP bridge rejected the connection with terminal close code {code}"
        if reason:
            detail += f": {reason}"
        super().__init__(detail)
        if cause is not None:
            self.__cause__ = cause


class ACPClosedError(ACPError):
    """Terminal failure: the client was closed explicitly.

    Never classified as :class:`RetryableACPError`: retrying means opening a
    brand-new client and the caller made the close decision. In-flight prompts
    still surface :class:`AmbiguousDeliveryError`; this class covers the
    non-prompt pending requests and any request attempted after close.
    """


class ACPRequestError(ACPError):
    """JSON-RPC error response from the agent (terminal protocol failure)."""

    def __init__(self, method: str, code: int | None, message: str):
        self.method = method
        self.code = code
        self.rpc_message = message
        error = {"code": code, "message": message}
        super().__init__(f"ACP {method} failed: {error}")


class ACPUnavailableError(ACPError):
    """A capability-gated helper hit an agent that does not advertise it."""

    def __init__(self, capability: str, detail: str):
        self.capability = capability
        super().__init__(f"{capability} is not available: {detail}")


@dataclass(frozen=True)
class ACPPromptResult:
    """End-of-turn result of one ``session/prompt`` exchange."""

    session_id: str
    stop_reason: str | None
    raw: dict[str, Any]


def _with_token(url: str, token: str) -> str:
    parsed = urlsplit(url)
    query = parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("token", token))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def _terminal_close(exc: BaseException) -> ACPTerminalCloseError | None:
    """Classify a transport failure carrying a terminal bridge close code.

    websockets>=13 exposes the received close frame on ``exc.rcvd`` (the
    top-level ``code``/``reason`` attributes are deprecated); other transports
    may surface ``code``/``reason`` directly.
    """
    if hasattr(exc, "rcvd"):
        rcvd = exc.rcvd
        if rcvd is None:  # no close frame received — no bridge code to classify
            return None
        code, reason = rcvd.code, rcvd.reason
    else:
        code, reason = getattr(exc, "code", None), getattr(exc, "reason", "")
    if isinstance(code, int) and code in ACP_TERMINAL_CLOSE_CODES:
        return ACPTerminalCloseError(code, str(reason or ""), cause=exc)
    return None


class ACPClient:
    """One-shot async ACP client; create with :meth:`ACPClient.connect`.

    The client fails loudly instead of reconnecting: once any transport
    failure surfaces, pending requests are rejected with
    :class:`RetryableACPError` (pre-prompt) or :class:`AmbiguousDeliveryError`
    (in-flight prompt) and the caller decides the next step.
    """

    def __init__(
        self,
        ws: Any,
        initialize_response: dict[str, Any] | None = None,
        *,
        on_update: UpdateListener | None = None,
        ws_exit: Any = None,
    ) -> None:
        self._ws = ws
        self._initialize_response = initialize_response or {}
        self._ws_exit = ws_exit
        self._pending: dict[int, tuple[str, asyncio.Future]] = {}
        self._next_id = 1
        self._closed = False
        self._update_listeners: list[UpdateListener] = []
        if on_update is not None:
            self._update_listeners.append(on_update)
        self._request_listeners: dict[str, list[RequestListener]] = {}
        self._reader = asyncio.ensure_future(self._read_loop())

    @classmethod
    async def connect(
        cls,
        url: str,
        *,
        token: str | None = None,
        open_timeout: float = DEFAULT_OPEN_TIMEOUT,
        client_info: dict[str, str] | None = None,
        on_update: UpdateListener | None = None,
    ) -> "ACPClient":
        """Dial the ACP bridge and complete the ``initialize`` handshake.

        Dial/handshake failures raise :class:`RetryableACPError`; an agent-side
        JSON-RPC rejection of ``initialize`` raises :class:`ACPRequestError`.
        A bridge refusal carrying a terminal close code (4401/4403/4404/4408)
        raises :class:`ACPTerminalCloseError` — re-dialing with the same
        credentials or pinned session can never succeed, so callers must not
        burn a retry budget on it. The ``initialize`` await is bounded by
        ``open_timeout`` (the same budget the dial gets): a bridge that accepts
        the socket but never answers the handshake fails the connect as
        :class:`RetryableACPError` instead of hanging forever, so callers'
        retry budgets engage.
        """
        if token:
            url = _with_token(url, token)
        connector = websockets.connect(url, open_timeout=open_timeout)
        ws_exit = None
        try:
            if hasattr(connector, "__aenter__"):
                ws = await connector.__aenter__()
                ws_exit = connector.__aexit__
            else:
                ws = await connector
        except TimeoutError as exc:
            raise RetryableACPError(f"ACP WebSocket connect exceeded {open_timeout:g}s") from exc
        except (WebSocketException, OSError) as exc:
            terminal = _terminal_close(exc)
            if terminal is not None:
                raise terminal from exc
            raise RetryableACPError(f"ACP WebSocket connection failed: {exc}") from exc
        client = cls(ws, on_update=on_update, ws_exit=ws_exit)
        try:
            initialize_response = await asyncio.wait_for(
                client._request(
                    "initialize",
                    {
                        "protocolVersion": ACP_PROTOCOL_VERSION,
                        "clientCapabilities": {
                            "fs": {"readTextFile": False, "writeTextFile": False},
                            "terminal": False,
                        },
                        "clientInfo": client_info or DEFAULT_CLIENT_INFO,
                    },
                ),
                timeout=open_timeout,
            )
        except (TimeoutError, asyncio.TimeoutError) as exc:
            await client.close()
            raise RetryableACPError(f"ACP initialize handshake exceeded {open_timeout:g}s") from exc
        except BaseException:
            await client.close()
            raise
        client._initialize_response = initialize_response
        return client

    @property
    def initialize_response(self) -> dict[str, Any]:
        return self._initialize_response

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def load_session_capable(self) -> bool:
        """True when the agent advertised ``agentCapabilities.loadSession``."""
        capabilities = self._initialize_response.get("agentCapabilities")
        return isinstance(capabilities, dict) and bool(capabilities.get("loadSession"))

    async def __aenter__(self) -> "ACPClient":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        await self.close()
        return False

    async def close(self) -> None:
        """Close the client, reject pending requests, and stop the reader."""
        if self._closed:
            return
        self._closed = True
        self._fail_pending(ACPClosedError("ACP client closed"))
        self._update_listeners.clear()
        self._request_listeners.clear()
        if self._reader is not asyncio.current_task():
            self._reader.cancel()
            await asyncio.gather(self._reader, return_exceptions=True)
        if self._ws_exit is not None:
            await self._ws_exit(None, None, None)
            return
        close = getattr(self._ws, "close", None)
        if close is not None:
            result = close()
            if asyncio.iscoroutine(result) or isinstance(result, asyncio.Future):
                await result

    def add_update_listener(self, listener: UpdateListener) -> Callable[[], None]:
        """Register a ``session/update`` notification sink; returns an unsubscribe."""

        self._update_listeners.append(listener)

        def unsubscribe() -> None:
            if listener in self._update_listeners:
                self._update_listeners.remove(listener)

        return unsubscribe

    def add_request_listener(
        self,
        method: str,
        listener: RequestListener,
    ) -> Callable[[], None]:
        """Register a handler for inbound agent→client REQUESTS; returns an unsubscribe.

        ``method`` is an exact method-name key (``session/request_permission``,
        ``fs/read_text_file``, ...) or the wildcard ``"*"``. Exact-key listeners
        are invoked as ``listener(params)``; wildcard listeners as
        ``listener(method, params)``. Only ONE response exists per request, so
        the first-registered exact-key listener wins over any wildcard; the
        first-registered wildcard is used when no exact listener matches.

        The listener is served off the read loop so dispatch keeps pumping
        while it runs. Its return value becomes the JSON-RPC ``result``.
        Raising :class:`ACPRequestError` replies with its code/message; any
        other exception replies with a JSON-RPC internal error. When NO
        listener matches, the default policy answers ``session/request_permission``
        with ``cancelled`` and every other method with ``-32601``.
        """
        key = method or "*"
        self._request_listeners.setdefault(key, []).append(listener)

        def unsubscribe() -> None:
            self.remove_request_listener(method, listener)

        return unsubscribe

    def remove_request_listener(self, method: str, listener: RequestListener) -> None:
        """Remove a listener registered with :meth:`add_request_listener`."""
        listeners = self._request_listeners.get(method or "*")
        if listeners and listener in listeners:
            listeners.remove(listener)

    async def new_session(self, *, cwd: str, mcp_servers: list[Any] | None = None) -> str:
        """Create a session with ``session/new`` and return its session id."""
        result = await self._request(
            "session/new",
            {"cwd": cwd, "mcpServers": mcp_servers if mcp_servers is not None else []},
        )
        session_id = str(result.get("sessionId") or "")
        if not session_id:
            raise ACPError("ACP session/new did not return sessionId")
        return session_id

    async def load_session(
        self,
        session_id: str,
        *,
        cwd: str,
        mcp_servers: list[Any] | None = None,
    ) -> dict[str, Any]:
        """Resume a session with ``session/load``, gated on the advertised capability."""
        if not self.load_session_capable:
            raise ACPUnavailableError(
                "session/load",
                "the agent did not advertise agentCapabilities.loadSession in its initialize response",
            )
        return await self._request(
            "session/load",
            {"sessionId": session_id, "cwd": cwd, "mcpServers": mcp_servers if mcp_servers is not None else []},
        )

    async def prompt(
        self,
        session_id: str,
        prompt: str | list[dict[str, Any]],
        *,
        timeout: float | None = None,
    ) -> ACPPromptResult:
        """Run one prompt turn and return the end-of-turn result.

        Sends ``session/prompt`` once and waits for the response. If the
        connection drops after the frame is sent, raises
        :class:`AmbiguousDeliveryError`; the turn is never resent. A
        ``timeout`` expiry raises :class:`TimeoutError` without resending.
        """
        blocks: list[dict[str, Any]]
        if isinstance(prompt, str):
            blocks = [{"type": "text", "text": prompt}]
        else:
            blocks = list(prompt)
        request = self._request("session/prompt", {"sessionId": session_id, "prompt": blocks})
        if timeout is not None:
            result = await asyncio.wait_for(request, timeout)
        else:
            result = await request
        return ACPPromptResult(session_id=session_id, stop_reason=result.get("stopReason"), raw=result)

    async def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Raw JSON-RPC escape hatch for extension methods (``_hyper/*`` etc)."""
        return await self._request(method, params or {})

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise ACPClosedError("ACP client is closed")
        frame_id = self._next_id
        self._next_id += 1
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[frame_id] = (method, future)
        try:
            await self._ws.send(json.dumps({"jsonrpc": "2.0", "id": frame_id, "method": method, "params": params}, separators=(",", ":")))
        except asyncio.CancelledError:
            self._pending.pop(frame_id, None)
            raise
        except (WebSocketException, OSError) as exc:
            self._pending.pop(frame_id, None)
            if method == "session/prompt":
                raise AmbiguousDeliveryError(str(exc), cause=exc) from exc
            terminal = _terminal_close(exc)
            if terminal is not None:
                raise terminal from exc
            raise RetryableACPError(f"ACP WebSocket connection failed: {exc}") from exc
        try:
            result = await future
        except asyncio.CancelledError:
            self._pending.pop(frame_id, None)
            raise
        return dict(result or {})

    async def _read_loop(self) -> None:
        try:
            while not self._closed:
                raw = await self._ws.recv()
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                frame = json.loads(raw)
                if not isinstance(frame, dict):
                    raise ACPError("ACP bridge returned a non-object frame")
                await self._dispatch(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._fail_pending(exc)

    async def _dispatch(self, frame: dict[str, Any]) -> None:
        frame_id = frame.get("id")
        if frame_id is not None and ("result" in frame or "error" in frame):
            pending = self._pending.pop(frame_id, None)
            if pending is None:
                return
            method, future = pending
            if future.done():
                return
            if "error" in frame:
                error = frame.get("error") or {}
                future.set_exception(
                    ACPRequestError(method, error.get("code"), str(error.get("message") or ""))
                )
            else:
                future.set_result(frame.get("result") or {})
            return
        method_name = str(frame.get("method") or "")
        if not method_name:
            return
        if frame_id is None:
            if method_name == "session/update":
                self._emit_update(frame.get("params") or {})
            # Any other notification — including vendor ``_hypercli.dev/*``
            # leg frames — is dropped silently: the proxy tee is vanilla ACP
            # (mirrors ts-sdk) and this client has no vendor-frame registry.
            return
        listener, wildcard = self._request_listener_for(method_name)
        if listener is not None:
            # Served as a task so the read loop keeps dispatching while the
            # listener awaits its (possibly cross-connection) answer.
            asyncio.ensure_future(
                self._serve_inbound_request(listener, wildcard, method_name, frame.get("params") or {}, frame_id)
            )
            return
        if method_name == "session/request_permission":
            reply: dict[str, Any] = {"jsonrpc": "2.0", "id": frame_id, "result": {"outcome": {"outcome": "cancelled"}}}
        else:
            reply = {
                "jsonrpc": "2.0",
                "id": frame_id,
                "error": {"code": -32601, "message": f"Method not found: {method_name}"},
            }
        await self._send_reply(reply)

    def _request_listener_for(self, method: str) -> tuple[RequestListener | None, bool]:
        """Resolve the serving listener; returns ``(listener, is_wildcard)``."""
        listeners = self._request_listeners.get(method)
        if listeners:
            return listeners[0], False
        listeners = self._request_listeners.get("*")
        if listeners:
            return listeners[0], True
        return None, False

    async def _serve_inbound_request(
        self,
        listener: RequestListener,
        wildcard: bool,
        method: str,
        params: dict[str, Any],
        frame_id: Any,
    ) -> None:
        if self._closed:
            return
        try:
            result = listener(method, params) if wildcard else listener(params)
            if inspect.isawaitable(result):
                result = await result
            reply: dict[str, Any] = {
                "jsonrpc": "2.0",
                "id": frame_id,
                "result": result if isinstance(result, dict) else {},
            }
        except asyncio.CancelledError:
            raise
        except ACPRequestError as exc:
            reply = {
                "jsonrpc": "2.0",
                "id": frame_id,
                "error": {"code": exc.code if exc.code is not None else -32603, "message": exc.rpc_message},
            }
        except Exception as exc:
            logger.exception("ACP inbound-request listener for %s raised", method)
            reply = {
                "jsonrpc": "2.0",
                "id": frame_id,
                "error": {"code": -32603, "message": str(exc)},
            }
        await self._send_reply(reply)

    async def _send_reply(self, reply: dict[str, Any]) -> None:
        try:
            await self._ws.send(json.dumps(reply, separators=(",", ":")))
        except (WebSocketException, OSError) as exc:
            logger.debug("ACP inbound-request reply failed: %s", exc)

    def _emit_update(self, params: dict[str, Any]) -> None:
        for listener in list(self._update_listeners):
            try:
                listener(params)
            except Exception:
                logger.exception("ACP session/update listener raised")

    def _fail_pending(self, exc: BaseException) -> None:
        pending, self._pending = self._pending, {}
        terminal = _terminal_close(exc)
        for method, future in pending.values():
            if future.done():
                continue
            if method == "session/prompt":
                # The prompt frame already left: even a terminal drop keeps the
                # turn ambiguous (the close code survives in the detail text).
                future.set_exception(AmbiguousDeliveryError(str(exc), cause=exc))
            elif terminal is not None:
                future.set_exception(ACPTerminalCloseError(terminal.code, terminal.reason, cause=exc))
            elif isinstance(exc, (WebSocketException, OSError)):
                failure = RetryableACPError(f"ACP WebSocket connection failed: {exc}")
                failure.__cause__ = exc
                future.set_exception(failure)
            else:
                future.set_exception(exc)
