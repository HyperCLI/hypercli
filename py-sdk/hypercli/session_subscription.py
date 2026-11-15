"""Read-only product /ws observer, independent of native ACP connections."""

import asyncio
import inspect
import json
from collections.abc import Callable
from contextlib import suppress
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

from .sessions import SessionMessage, SessionMessageEvent


class _CallbackError(Exception):
    """Keep user callback failures outside transport retry classification."""

    def __init__(self, error: Exception):
        self.error = error


async def subscribe_session(
    ws_url: str, credential: str, session_id: str,
    handler: Callable[[SessionMessageEvent], Any], *,
    stop_event: asyncio.Event | None = None, on_ready: Callable[[], Any] | None = None,
) -> None:
    if not session_id:
        raise ValueError("session_id is required")
    parts = urlsplit(ws_url)
    query = dict(parse_qsl(parts.query))
    query.update(mode="observe", token=credential)
    url = urlunsplit(parts._replace(query=urlencode(query)))

    async def callback(fn, *args):
        if fn is not None:
            try:
                result = fn(*args)
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:
                raise _CallbackError(exc) from exc

    async def run():
        delay = 0.25
        request = 0
        while stop_event is None or not stop_event.is_set():
            started = asyncio.get_running_loop().time()
            connected = False
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    connected = True
                    ready = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    if not isinstance(ready, dict) or ready.get("type") != "ready":
                        raise ValueError("Session observer did not send ready")
                    request += 1
                    request_id = str(request)
                    await ws.send(json.dumps({"type": "sessionSubscribe", "requestId": request_id, "sessionId": session_id}))
                    ack = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    if (not isinstance(ack, dict) or ack.get("requestId") != request_id
                            or ack.get("sessionId") != session_id):
                        raise ValueError("Invalid session subscription acknowledgement")
                    if ack.get("type") == "sessionSubscriptionError":
                        raise ValueError(ack.get("message") or "Session subscription rejected")
                    if ack.get("type") != "sessionSubscribed":
                        raise ValueError("Invalid session subscription acknowledgement")
                    try:
                        await callback(on_ready)
                        while stop_event is None or not stop_event.is_set():
                            frame = json.loads(await ws.recv())
                            if (not isinstance(frame, dict) or frame.get("sessionId") != session_id):
                                raise ValueError("Invalid session observer event")
                            if frame.get("type") == "sessionSubscriptionError":
                                raise ValueError(frame.get("message") or "Session subscription rejected")
                            if frame.get("type") != "sessionMessage":
                                raise ValueError("Invalid session observer event")
                            message = SessionMessage.from_dict(frame.get("message"))
                            if message.session_id != session_id:
                                raise ValueError("Session message does not match selected session")
                            await callback(handler, SessionMessageEvent("sessionMessage", session_id, message))
                    finally:
                        if ws.state.name == "OPEN":
                            with suppress(ConnectionClosed):
                                await ws.send(json.dumps({"type": "sessionUnsubscribe", "requestId": str(request + 1), "sessionId": session_id}))
            except _CallbackError as exc:
                raise exc.error
            except ConnectionClosed as exc:
                if exc.rcvd and exc.rcvd.code in {1008, 4401, 4403}:
                    raise
            except InvalidStatus as exc:
                if exc.response.status_code in {401, 403}:
                    raise
            except TimeoutError:
                # Opening the transport can be retried. Once open, a missing
                # ready/subscribed frame is a terminal protocol timeout.
                if connected:
                    raise
            except OSError:
                pass
            if asyncio.get_running_loop().time() - started >= 10:
                delay = 0.25
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5)

    if stop_event is None:
        await run()
        return
    if stop_event.is_set():
        return
    task = asyncio.create_task(run())
    stopped = asyncio.create_task(stop_event.wait())
    try:
        done, _ = await asyncio.wait((task, stopped), return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            await task
    finally:
        task.cancel()
        stopped.cancel()
        await asyncio.gather(task, stopped, return_exceptions=True)
