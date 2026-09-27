from __future__ import annotations

import asyncio
import json
import logging

import pytest
import websockets

from hypercli.acp import (
    ACPClient,
    ACPClosedError,
    ACPError,
    ACPRequestError,
    ACPUnavailableError,
    AmbiguousDeliveryError,
    RetryableACPError,
)


class StubWs:
    """In-memory WebSocket stand-in: outbound frames are recorded, inbound
    frames arrive through :meth:`feed` into the client's read loop."""

    def __init__(self, *, fail_send: bool = False):
        self.sent: list[dict] = []
        self.fail_send = fail_send
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.close_calls = 0

    async def send(self, data: str):
        if self.fail_send:
            raise OSError("stub send failure")
        self.sent.append(json.loads(data))

    async def recv(self):
        return await self._incoming.get()

    async def close(self):
        self.close_calls += 1

    def feed(self, frame: dict) -> None:
        self._incoming.put_nowait(json.dumps(frame))


class FakeAcpBridge:
    """Scripted ACP bridge over a real loopback WebSocket.

    ``drop_on`` lists methods whose frames make the bridge slam the connection
    shut instead of replying — used to prove retry classification boundaries.
    """

    def __init__(self, handlers=None, *, drop_on=(), push_update_on_new=False):
        self.handlers = handlers or {}
        self.drop_on = set(drop_on)
        self.push_update_on_new = push_update_on_new
        self.received: list[dict] = []
        self.paths: list[str] = []
        self.server = None

    async def _handler(self, ws):
        self.paths.append(ws.request.path)
        async for raw in ws:
            frame = json.loads(raw)
            self.received.append(frame)
            method = frame.get("method")
            if not method or "id" not in frame:
                continue
            if method in self.drop_on:
                await ws.close(code=1011)
                return
            if self.push_update_on_new and method == "session/new":
                notification = {"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s-1", "update": {"sessionUpdate": "agent_message_chunk"}}}
                await ws.send(json.dumps(notification))
            handler = self.handlers.get(method)
            if handler is None:
                reply = {"jsonrpc": "2.0", "id": frame["id"], "error": {"code": -32601, "message": f"Method not found: {method}"}}
            else:
                try:
                    result = handler(frame.get("params") or {})
                    if asyncio.iscoroutine(result):
                        result = await result
                    reply = {"jsonrpc": "2.0", "id": frame["id"], "result": result}
                except Exception as exc:
                    reply = {"jsonrpc": "2.0", "id": frame["id"], "error": {"code": -32000, "message": str(exc)}}
            await ws.send(json.dumps(reply))

    async def start(self, handler=None):
        self.server = await websockets.serve(handler or self._handler, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        return f"ws://127.0.0.1:{port}/ws"

    async def stop(self):
        if self.server is not None:
            self.server.close(close_connections=True)
            await self.server.wait_closed()

    def methods(self) -> list[str]:
        return [frame["method"] for frame in self.received if frame.get("method")]

    def params(self, method: str) -> list[dict]:
        return [frame["params"] for frame in self.received if frame.get("method") == method]


def _handlers(**overrides):
    base = {
        "initialize": lambda params: {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}},
        "session/new": lambda params: {"sessionId": "created-session"},
        "session/load": lambda params: {},
        "session/prompt": lambda params: {"stopReason": "end_turn"},
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_full_frame_flow_new_session_then_prompt():
    bridge = FakeAcpBridge(_handlers())
    url = await bridge.start()
    try:
        client = await ACPClient.connect(f"{url}?agent_id=agent-1", token="bridge-key", open_timeout=5.0)
        try:
            assert client.initialize_response["protocolVersion"] == 1
            assert client.load_session_capable is True
            session_id = await client.new_session(cwd="/home/node")
            assert session_id == "created-session"
            turn = await client.prompt(session_id, "Summarize overnight mail", timeout=5.0)
            assert turn.session_id == "created-session"
            assert turn.stop_reason == "end_turn"
            assert turn.raw == {"stopReason": "end_turn"}
        finally:
            await client.close()
        assert client.closed
    finally:
        await bridge.stop()
    assert bridge.paths == ["/ws?agent_id=agent-1&token=bridge-key"]
    assert bridge.methods() == ["initialize", "session/new", "session/prompt"]
    initialize = bridge.params("initialize")[0]
    assert initialize["protocolVersion"] == 1
    assert initialize["clientCapabilities"] == {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False}
    assert initialize["clientInfo"]["name"] == "hypercli-py-sdk"
    assert bridge.params("session/new") == [{"cwd": "/home/node", "mcpServers": []}]
    assert bridge.params("session/prompt") == [
        {"sessionId": "created-session", "prompt": [{"type": "text", "text": "Summarize overnight mail"}]}
    ]


@pytest.mark.asyncio
async def test_load_session_happy_path():
    bridge = FakeAcpBridge(_handlers())
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            await client.load_session("existing-session", cwd="/home/node")
    finally:
        await bridge.stop()
    assert bridge.params("session/load") == [{"sessionId": "existing-session", "cwd": "/home/node", "mcpServers": []}]


@pytest.mark.asyncio
async def test_load_session_gate_raises_when_capability_not_advertised():
    bridge = FakeAcpBridge(_handlers(initialize=lambda params: {"protocolVersion": 1, "agentCapabilities": {}}))
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            assert client.load_session_capable is False
            with pytest.raises(ACPUnavailableError, match="loadSession"):
                await client.load_session("whatever", cwd="/home/node")
    finally:
        await bridge.stop()
    assert bridge.params("session/load") == []


@pytest.mark.asyncio
async def test_rpc_error_raises_request_error():
    def failing_load(params):
        raise ValueError("session not found")

    bridge = FakeAcpBridge(_handlers(**{"session/load": failing_load}))
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            with pytest.raises(ACPRequestError, match="ACP session/load failed") as excinfo:
                await client.load_session("stale-session", cwd="/home/node")
            assert excinfo.value.code == -32000
            assert excinfo.value.method == "session/load"
    finally:
        await bridge.stop()


@pytest.mark.asyncio
async def test_dial_failure_is_retryable_bridge_down():
    bridge = FakeAcpBridge(_handlers())
    url = await bridge.start()
    await bridge.stop()
    with pytest.raises(RetryableACPError, match="WebSocket connection failed"):
        await ACPClient.connect(url, open_timeout=2.0)


@pytest.mark.asyncio
async def test_drop_before_prompt_is_retryable():
    bridge = FakeAcpBridge(_handlers(), drop_on={"session/new"})
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            with pytest.raises(RetryableACPError, match="WebSocket connection failed"):
                await client.new_session(cwd="/home/node")
    finally:
        await bridge.stop()
    assert bridge.params("session/prompt") == []


@pytest.mark.asyncio
async def test_drop_after_prompt_send_is_ambiguous():
    bridge = FakeAcpBridge(_handlers(), drop_on={"session/prompt"})
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            session_id = await client.new_session(cwd="/home/node")
            with pytest.raises(AmbiguousDeliveryError, match="not retrying to avoid duplicate execution") as excinfo:
                await client.prompt(session_id, "run once")
            assert "session/load" in str(excinfo.value)
            assert isinstance(excinfo.value, ACPError)
            assert not isinstance(excinfo.value, RetryableACPError)
    finally:
        await bridge.stop()
    assert len(bridge.params("session/prompt")) == 1


@pytest.mark.asyncio
async def test_prompt_is_never_resent_across_caller_driven_attempts():
    prompt_frames = 0
    succeeded = False
    for attempt in range(1, 4):
        bridge = FakeAcpBridge(_handlers(), drop_on={"session/prompt"} if attempt == 1 else set())
        url = await bridge.start()
        try:
            try:
                async with await ACPClient.connect(url) as client:
                    session_id = await client.new_session(cwd="/home/node")
                    turn = await client.prompt(session_id, "run once")
                succeeded = True
                assert turn.stop_reason == "end_turn"
                break
            except AmbiguousDeliveryError:
                continue
        finally:
            prompt_frames += len(bridge.params("session/prompt"))
            await bridge.stop()
    assert succeeded
    assert prompt_frames == 2  # one send per caller-driven attempt; no client ever resends


@pytest.mark.asyncio
async def test_explicit_close_fails_pending_non_prompt_requests_with_terminal_closed_error():
    session_new_started = asyncio.Event()

    async def hang_session_new(params):
        session_new_started.set()
        await asyncio.sleep(10)
        return {"sessionId": "never"}

    bridge = FakeAcpBridge(_handlers(**{"session/new": hang_session_new}))
    url = await bridge.start()
    try:
        client = await ACPClient.connect(url, open_timeout=5.0)
        pending = asyncio.create_task(client.new_session(cwd="/home/node"))
        await asyncio.wait_for(session_new_started.wait(), timeout=5.0)
        await client.close()
        with pytest.raises(ACPClosedError, match="ACP client closed"):
            await pending
        assert isinstance(pending.exception(), ACPError)
        # Terminal classification: explicit close is never retryable.
        assert not isinstance(pending.exception(), RetryableACPError)
        assert not isinstance(pending.exception(), AmbiguousDeliveryError)
        # Requests after close fail with the same terminal error.
        with pytest.raises(ACPClosedError, match="ACP client is closed"):
            await client.new_session(cwd="/home/node")
    finally:
        await bridge.stop()


@pytest.mark.asyncio
async def test_explicit_close_keeps_pending_prompt_ambiguous():
    prompt_started = asyncio.Event()

    async def hang_prompt(params):
        prompt_started.set()
        await asyncio.sleep(10)
        return {"stopReason": "end_turn"}

    bridge = FakeAcpBridge(_handlers(**{"session/prompt": hang_prompt}))
    url = await bridge.start()
    try:
        client = await ACPClient.connect(url, open_timeout=5.0)
        session_id = await client.new_session(cwd="/home/node")
        pending = asyncio.create_task(client.prompt(session_id, "run once"))
        await asyncio.wait_for(prompt_started.wait(), timeout=5.0)
        await client.close()
        # The prompt frame already left: closing cannot retract it, so the
        # pending turn stays AmbiguousDelivery (never retry, never Closed).
        with pytest.raises(AmbiguousDeliveryError, match="ACP client closed"):
            await pending
    finally:
        await bridge.stop()
    assert len(bridge.params("session/prompt")) == 1


@pytest.mark.asyncio
async def test_session_update_notifications_reach_listeners():
    bridge = FakeAcpBridge(_handlers(), push_update_on_new=True)
    url = await bridge.start()
    updates: list[dict] = []
    try:
        async with await ACPClient.connect(url) as client:
            unsubscribe = client.add_update_listener(updates.append)
            await client.new_session(cwd="/home/node")
            await asyncio.sleep(0.1)
            unsubscribe()
    finally:
        await bridge.stop()
    assert len(updates) == 1
    assert updates[0]["sessionId"] == "s-1"
    assert updates[0]["update"]["sessionUpdate"] == "agent_message_chunk"


@pytest.mark.asyncio
async def test_prompt_timeout_raises_timeout_error_and_is_not_resent():
    async def hang_prompt(params):
        await asyncio.sleep(2)
        return {"stopReason": "end_turn"}

    bridge = FakeAcpBridge(_handlers(**{"session/prompt": hang_prompt}))
    url = await bridge.start()
    try:
        async with await ACPClient.connect(url) as client:
            session_id = await client.new_session(cwd="/home/node")
            with pytest.raises(TimeoutError):
                await client.prompt(session_id, "slow turn", timeout=0.05)
    finally:
        await bridge.stop()
    assert len(bridge.params("session/prompt")) == 1
    assert bridge.methods().count("session/prompt") == 1


@pytest.mark.asyncio
async def test_permission_requests_are_cancelled_by_default():
    bridge = FakeAcpBridge(_handlers())
    answers: list[dict] = []

    async def handler(ws):
        async for raw in ws:
            frame = json.loads(raw)
            bridge.received.append(frame)
            method = frame.get("method")
            if method is None:
                answers.append(frame)
                continue
            if method == "session/prompt":
                permission = {
                    "jsonrpc": "2.0",
                    "id": 999,
                    "method": "session/request_permission",
                    "params": {"sessionId": "created-session", "toolCall": {}, "options": []},
                }
                await ws.send(json.dumps(permission))
                answer = json.loads(await ws.recv())
                answers.append(answer)
                await ws.send(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {"stopReason": "end_turn"}}))
                continue
            reply = {"jsonrpc": "2.0", "id": frame["id"], "result": bridge.handlers[method](frame.get("params") or {})}
            await ws.send(json.dumps(reply))

    url = await bridge.start(handler)
    try:
        async with await ACPClient.connect(url) as client:
            session_id = await client.new_session(cwd="/home/node")
            result = await client.prompt(session_id, "go", timeout=5.0)
            assert result.stop_reason == "end_turn"
    finally:
        await bridge.stop()
    assert answers[0]["id"] == 999
    assert answers[0]["result"] == {"outcome": {"outcome": "cancelled"}}


@pytest.mark.asyncio
async def test_unknown_inbound_requests_get_method_not_found():
    bridge = FakeAcpBridge(_handlers())
    answers: list[dict] = []

    async def handler(ws):
        async for raw in ws:
            frame = json.loads(raw)
            bridge.received.append(frame)
            method = frame.get("method")
            if method is None:
                answers.append(frame)
                continue
            if method == "session/prompt":
                mystery = {"jsonrpc": "2.0", "id": 555, "method": "fs/read_text_file", "params": {"path": "/etc/passwd"}}
                await ws.send(json.dumps(mystery))
                answers.append(json.loads(await ws.recv()))
                await ws.send(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {"stopReason": "end_turn"}}))
                continue
            reply = {"jsonrpc": "2.0", "id": frame["id"], "result": bridge.handlers[method](frame.get("params") or {})}
            await ws.send(json.dumps(reply))

    url = await bridge.start(handler)
    try:
        async with await ACPClient.connect(url) as client:
            session_id = await client.new_session(cwd="/home/node")
            result = await client.prompt(session_id, "go", timeout=5.0)
            assert result.stop_reason == "end_turn"
    finally:
        await bridge.stop()
    assert answers[0]["error"]["code"] == -32601
    assert "fs/read_text_file" in answers[0]["error"]["message"]


@pytest.mark.asyncio
async def test_request_listener_handles_inbound_request_round_trip():
    client = ACPClient(StubWs(), {})
    client.add_request_listener("fs/read_text_file", lambda params: {"content": f"data:{params['path']}"})
    try:
        await client._dispatch({"jsonrpc": "2.0", "id": 77, "method": "fs/read_text_file", "params": {"path": "/etc/motd"}})
        for _ in range(10):
            if client._ws.sent:
                break
            await asyncio.sleep(0)
        assert client._ws.sent == [{"jsonrpc": "2.0", "id": 77, "result": {"content": "data:/etc/motd"}}]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_wildcard_request_listener_receives_method_and_params():
    client = ACPClient(StubWs(), {})
    seen: list[tuple[str, dict]] = []

    async def wildcard(method, params):
        seen.append((method, params))
        return {"ok": True}

    client.add_request_listener("*", wildcard)
    try:
        await client._dispatch({"jsonrpc": "2.0", "id": 78, "method": "elicitation/create", "params": {"x": 1}})
        for _ in range(10):
            if client._ws.sent:
                break
            await asyncio.sleep(0)
        assert seen == [("elicitation/create", {"x": 1})]
        assert client._ws.sent == [{"jsonrpc": "2.0", "id": 78, "result": {"ok": True}}]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_request_listener_acp_error_reply_uses_its_code_and_message():
    client = ACPClient(StubWs(), {})

    def deny(params):
        raise ACPRequestError("fs/read_text_file", -32601, "no fs capability here")

    client.add_request_listener("fs/read_text_file", deny)
    try:
        await client._dispatch({"jsonrpc": "2.0", "id": 79, "method": "fs/read_text_file", "params": {}})
        for _ in range(10):
            if client._ws.sent:
                break
            await asyncio.sleep(0)
        assert client._ws.sent == [{"jsonrpc": "2.0", "id": 79, "error": {"code": -32601, "message": "no fs capability here"}}]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_request_listener_generic_error_maps_to_internal_error():
    client = ACPClient(StubWs(), {})

    def boom(params):
        raise RuntimeError("kaboom")

    client.add_request_listener("session/request_permission", boom)
    try:
        await client._dispatch({"jsonrpc": "2.0", "id": 80, "method": "session/request_permission", "params": {}})
        for _ in range(10):
            if client._ws.sent:
                break
            await asyncio.sleep(0)
        assert client._ws.sent[0]["error"]["code"] == -32603
        assert "kaboom" in client._ws.sent[0]["error"]["message"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_request_listener_unsubscribe_restores_defaults():
    client = ACPClient(StubWs(), {})
    unsubscribe = client.add_request_listener("session/request_permission", lambda params: {"outcome": {"outcome": "cancelled"}})
    try:
        unsubscribe()
        # No listener: the default policy cancels permission and answers
        # unknown methods with method-not-found.
        await client._dispatch({"jsonrpc": "2.0", "id": 81, "method": "session/request_permission", "params": {}})
        await client._dispatch({"jsonrpc": "2.0", "id": 82, "method": "mcp/connect", "params": {}})
        assert client._ws.sent[0]["result"] == {"outcome": {"outcome": "cancelled"}}
        assert client._ws.sent[1]["error"]["code"] == -32601
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_notify_sends_notification_frame_without_id_then_returns():
    client = ACPClient(StubWs(), {"protocolVersion": 1})
    try:
        await client.notify("_hypercli.dev/turn_ended_ack", {"turnId": 7})
        await client.notify("_hypercli.dev/bare")
    finally:
        await client.close()
    assert client.initialize_response["protocolVersion"] == 1
    assert client._ws.sent == [
        {"jsonrpc": "2.0", "method": "_hypercli.dev/turn_ended_ack", "params": {"turnId": 7}},
        {"jsonrpc": "2.0", "method": "_hypercli.dev/bare", "params": {}},
    ]
    assert all("id" not in frame for frame in client._ws.sent)


@pytest.mark.asyncio
async def test_notify_send_failure_is_retryable_and_never_awaited():
    client = ACPClient(StubWs(fail_send=True), {})
    try:
        with pytest.raises(RetryableACPError, match="WebSocket connection failed"):
            await client.notify("_hypercli.dev/turn_ended_ack", {"turnId": 7})
    finally:
        await client.close()
    with pytest.raises(ACPClosedError, match="ACP client is closed"):
        await client.notify("_hypercli.dev/turn_ended_ack", {"turnId": 7})


@pytest.mark.asyncio
async def test_notification_listeners_exact_and_wildcard_and_removal():
    client = ACPClient(StubWs(), {})
    exact: list[dict] = []
    wildcard: list[tuple[str, dict]] = []

    def on_turn_ended(params):
        exact.append(params)

    client.add_notification_listener("_hypercli.dev/turn_ended", on_turn_ended)
    client.add_notification_listener("*", lambda method, params: wildcard.append((method, params)))
    try:
        frame = {"jsonrpc": "2.0", "method": "_hypercli.dev/turn_ended",
                 "params": {"sessionId": "s-1", "turnId": 9, "stopReason": "end_turn"}}
        await client._dispatch(frame)
        await client._dispatch({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_started",
                                "params": {"sessionId": "s-1", "turnId": 9}})
        assert exact == [{"sessionId": "s-1", "turnId": 9, "stopReason": "end_turn"}]
        assert wildcard == [
            ("_hypercli.dev/turn_ended", {"sessionId": "s-1", "turnId": 9, "stopReason": "end_turn"}),
            ("_hypercli.dev/turn_started", {"sessionId": "s-1", "turnId": 9}),
        ]
        client.remove_notification_listener("_hypercli.dev/turn_ended", on_turn_ended)
        await client._dispatch(frame)
        assert len(exact) == 1
        assert len(wildcard) == 3

        unsubscribe = client.add_notification_listener("_hypercli.dev/turn_started", lambda params: exact.append(params))
        await client._dispatch({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_started",
                                "params": {"sessionId": "s-1", "turnId": 10}})
        assert len(exact) == 2
        unsubscribe()
        await client._dispatch({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_started",
                                "params": {"sessionId": "s-1", "turnId": 11}})
        assert len(exact) == 2
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_notification_listener_exceptions_are_logged_and_never_kill_dispatch(caplog):
    client = ACPClient(StubWs(), {})
    seen: list[dict] = []

    def boom(params):
        raise RuntimeError("listener exploded")

    async def async_boom(params):
        raise RuntimeError("async listener exploded")

    client.add_notification_listener("_hypercli.dev/turn_ended", boom)
    client.add_notification_listener("_hypercli.dev/turn_ended", async_boom)
    client.add_notification_listener("_hypercli.dev/turn_ended", seen.append)
    try:
        frame = {"jsonrpc": "2.0", "method": "_hypercli.dev/turn_ended", "params": {"turnId": 1}}
        with caplog.at_level(logging.ERROR, logger="hypercli.acp"):
            await client._dispatch(frame)
            await asyncio.sleep(0)
            await asyncio.sleep(0)
        assert seen == [{"turnId": 1}]
        assert any("ACP notification listener raised" in record.getMessage() for record in caplog.records)
        assert any("async listener exploded" in record.getMessage() for record in caplog.records)

        caplog.clear()
        async_seen: list[dict] = []

        async def collect(params):
            await asyncio.sleep(0)
            async_seen.append(params)

        client.add_notification_listener("_hypercli.dev/turn_ended", collect)
        await client._dispatch({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_ended", "params": {"turnId": 2}})
        assert async_seen == []  # async listeners run off the read loop
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert async_seen == [{"turnId": 2}]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_session_update_is_not_offered_to_notification_registry():
    client = ACPClient(StubWs(), {})
    updates: list[dict] = []
    wildcard: list[tuple[str, dict]] = []
    client.add_update_listener(updates.append)
    client.add_notification_listener("*", lambda method, params: wildcard.append((method, params)))
    try:
        await client._dispatch({"jsonrpc": "2.0", "method": "session/update",
                                "params": {"sessionId": "s-1", "update": {"sessionUpdate": "agent_message_chunk"}}})
        assert len(updates) == 1
        assert wildcard == []
        # Unknown notifications without registered listeners are dropped silently.
        await client._dispatch({"jsonrpc": "2.0", "method": "_hypercli.dev/nobody", "params": {}})
        assert wildcard == [("_hypercli.dev/nobody", {})]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_vendor_notifications_reach_listeners_through_the_read_loop():
    client = ACPClient(StubWs(), {})
    started: list[dict] = []
    ended: list[dict] = []
    client.add_notification_listener("_hypercli.dev/turn_started", started.append)
    client.add_notification_listener("_hypercli.dev/turn_ended", ended.append)
    try:
        client._ws.feed({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_started",
                         "params": {"sessionId": "s-1", "turnId": 4}})
        client._ws.feed({"jsonrpc": "2.0", "method": "_hypercli.dev/turn_ended",
                         "params": {"sessionId": "s-1", "turnId": 4, "stopReason": "end_turn"}})
        for _ in range(10):
            await asyncio.sleep(0)
        assert started == [{"sessionId": "s-1", "turnId": 4}]
        assert ended == [{"sessionId": "s-1", "turnId": 4, "stopReason": "end_turn"}]
    finally:
        await client.close()
