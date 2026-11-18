"""Product /ws observer, independent of native ACP connections."""

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable
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
    on_room_activity: Callable[[list[dict[str, str]]], Any] | None = None,
    on_typing_channel: Callable[[Callable[[bool], Awaitable[None]] | None], Any] | None = None,
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
                    wants_activity = on_room_activity is not None or on_typing_channel is not None
                    await ws.send(json.dumps({"type": "sessionSubscribe", "requestId": request_id, "sessionId": session_id,
                                              **({"roomActivity": True} if wants_activity else {})}))
                    ack = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    if (not isinstance(ack, dict) or ack.get("requestId") != request_id
                            or ack.get("sessionId") != session_id):
                        raise ValueError("Invalid session subscription acknowledgement")
                    if ack.get("type") == "sessionSubscriptionError":
                        raise ValueError(ack.get("message") or "Session subscription rejected")
                    if ack.get("type") != "sessionSubscribed":
                        raise ValueError("Invalid session subscription acknowledgement")
                    enabled = wants_activity and ack.get("roomActivity") is True
                    retired = asyncio.Event()
                    clock = asyncio.get_running_loop().time
                    leases = []

                    async def typing(active: bool, *, _ws=ws, _retired=retired, _id=request_id):
                        if type(active) is bool and not _retired.is_set() and _ws.state.name == "OPEN":
                            with suppress(ConnectionClosed):
                                await _ws.send(json.dumps({"type": "roomTyping", "requestId": _id,
                                                           "sessionId": session_id, "active": active}))

                    try:
                        if enabled:
                            await callback(on_typing_channel, typing)
                        await callback(on_ready)
                        while stop_event is None or not stop_event.is_set():
                            if leases:
                                try:
                                    data = await asyncio.wait_for(ws.recv(), min(end for end, _ in leases) - clock())
                                except asyncio.TimeoutError:
                                    leases = [(end, actor) for end, actor in leases if end > clock()]
                                    await callback(on_room_activity, [actor for _, actor in leases])
                                    continue
                            else:
                                data = await ws.recv()
                            frame = json.loads(data)
                            if (not isinstance(frame, dict) or frame.get("sessionId") != session_id):
                                raise ValueError("Invalid session observer event")
                            if frame.get("type") == "sessionSubscriptionError":
                                raise ValueError(frame.get("message") or "Session subscription rejected")
                            if enabled and frame.get("type") == "roomActivity":
                                actors = frame.get("actors")
                                if not isinstance(actors, list) or not all(
                                    isinstance(a, dict) and a.get("kind") in ("user", "agent")
                                    and isinstance(a.get("id"), str) and a["id"]
                                    and type(a.get("expiresInMs")) is int and 0 < a["expiresInMs"] <= 120_000 for a in actors
                                ):
                                    raise ValueError("Invalid room activity")
                                now = clock()
                                leases = [(now + a["expiresInMs"] / 1000, {"id": a["id"], "kind": a["kind"]}) for a in actors]
                                await callback(on_room_activity, [actor for _, actor in leases])
                                continue
                            if frame.get("type") != "sessionMessage":
                                raise ValueError("Invalid session observer event")
                            message = SessionMessage.from_dict(frame.get("message"))
                            if message.session_id != session_id:
                                raise ValueError("Session message does not match selected session")
                            await callback(handler, SessionMessageEvent("sessionMessage", session_id, message))
                    finally:
                        retired.set()
                        if enabled:
                            await callback(on_typing_channel, None)
                            await callback(on_room_activity, [])
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
