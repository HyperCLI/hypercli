"""Public Python API against the actual pinned versioned SDK and loopback WS.

The peer uses the installed upstream v1 implementation.
"""
import asyncio
import gc
import json
from contextlib import asynccontextmanager

import pytest
from acp.exceptions import RequestError
from acp import schema
from acp.agent import AgentSideConnection
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from hypercli.acp import (
    ACPClient, ACPClosedError, ACPError, ACPRequestError, ACPTerminalCloseError,
    AmbiguousDeliveryError, RetryableACPError, ACP_TERMINAL_CLOSE_CODES,
)

pytestmark = pytest.mark.asyncio


async def until(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(.005)


class Transport:
    def __init__(self, socket, peer):
        self.socket, self.peer = socket, peer

    async def send(self, message):
        self.peer.frames.append(("out", message))
        await self.socket.send(json.dumps(message))

    async def receive(self):
        try:
            message = json.loads(await self.socket.recv())
        except ConnectionClosed:
            return None
        self.peer.frames.append(("in", message))
        return message

    async def close(self):
        await self.socket.close()


class Peer:
    def __init__(self):
        self.frames, self.prompts, self.updates, self.paths = [], [], [], []
        self.release = asyncio.Event()
        self.entered = asyncio.Event()
        self.connected = None
        self.socket = None
        self.tasks = set()
        self.cancelled = False
        self.reject_prompt = False
        self.hold_initialize = False
        self.hold_close = False
        self.early_close = None
        self.close_on_upgrade = False
        self.version = 1

    async def initialize(self, **kwargs):
        if self.early_close:
            await self.socket.close(code=self.early_close, reason="fixture refusal")
        if self.hold_initialize:
            await self.release.wait()
        return schema.InitializeResponse.model_validate({"protocolVersion": self.version,
            "agentInfo": {"name": "fixture", "version": "1"}, "agentCapabilities": {"sessionCapabilities": {"resume": {}}}})

    async def new_session(self, **kwargs):
        return schema.NewSessionResponse(session_id="opaque/runtime:id")

    async def resume_session(self, session_id, **kwargs):
        assert session_id == "opaque/runtime:id"
        return schema.ResumeSessionResponse()

    async def load_session(self, session_id, **kwargs):
        assert session_id == "opaque/runtime:id"
        return schema.LoadSessionResponse()

    async def list_sessions(self, **kwargs):
        return schema.ListSessionsResponse.model_validate({"sessions": [
            {"sessionId": "opaque/runtime:id", "cwd": "/original/project"},
        ]})

    async def close_session(self, **kwargs):
        self.entered.set()
        if self.hold_close:
            await self.release.wait()
        return schema.CloseSessionResponse()

    async def prompt(self, session_id, prompt, **kwargs):
        self.prompts.append([b.model_dump(mode="json", by_alias=True, exclude_unset=True) for b in prompt])
        self.entered.set()
        if self.reject_prompt:
            raise RequestError(-32012, "fixture refusal", {"detail": "retained"})
        for block in self.prompts[-1]:
            await self.emit(session_id, {"sessionUpdate": "user_message_chunk", "content": block})
        await self.release.wait()
        await self.emit(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "answer"}})
        return schema.PromptResponse(stop_reason="cancelled" if self.cancelled else "end_turn")

    async def cancel(self, **kwargs):
        self.cancelled = True
        self.release.set()

    async def emit(self, sid, update):
        await self.connected.session_update(session_id=sid,
            update=schema.SessionNotification.model_validate({"sessionId": sid, "update": update}).update)


@asynccontextmanager
async def server():
    peer = Peer()
    def factory(connection):
        peer.connected = connection
        return peer
    async def handler(socket):
        peer.socket = socket
        peer.paths.append(socket.request.path)
        if peer.close_on_upgrade:
            await socket.close(code=peer.early_close, reason="fixture refusal")
            return
        connection = AgentSideConnection(factory, Transport(socket, peer), listening=False, use_unstable_protocol=True)
        try:
            await connection.listen()
        finally:
            await connection.close()
    async with serve(handler, "127.0.0.1", 0) as listener:
        try:
            yield peer, f"ws://127.0.0.1:{listener.sockets[0].getsockname()[1]}/ws/acp"
        finally:
            peer.release.set()
            for task in list(peer.tasks):
                task.cancel()
            await asyncio.gather(*peer.tasks, return_exceptions=True)


async def test_v1_handshake_source_and_setup_use_standard_shapes():
    async with server() as (peer, url), await ACPClient.connect(url, source="routines") as client:
        assert client.initialize_response["protocolVersion"] == 1
        assert "source=routines" in peer.paths[0]
        sid = await client.new_session(cwd="/workspace")
        await client.resume_session(sid, cwd="/workspace")
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert inbound[0]["params"] == {"protocolVersion": 1, "clientInfo": {"name": "hypercli-py-sdk", "version": ""}, "clientCapabilities": {}}
        assert [f["method"] for f in inbound] == ["initialize", "session/new", "session/resume"]
        assert inbound[-1]["params"] == {"sessionId": sid, "cwd": "/workspace", "mcpServers": []}
        assert not any("source" in f.get("params", {}) for f in inbound)
        for frame, model in zip(inbound, [schema.InitializeRequest, schema.NewSessionRequest, schema.ResumeSessionRequest], strict=True):
            model.model_validate(frame["params"])


async def test_v2_initialize_answer_is_not_a_supported_execution_profile():
    async with server() as (peer, url):
        peer.version = 2
        with pytest.raises(ACPError, match="requires ACP v1"):
            await ACPClient.connect(url)
        assert peer.prompts == []


async def test_opaque_update_bypasses_typed_union_with_upstream_callback_correlation():
    async with server() as (peer, url), await ACPClient.connect(url, on_update=peer.updates.append) as client:
        sid = await client.new_session(cwd="/workspace")
        params = {"sessionId": sid, "update": {"sessionUpdate": "future_native_update",
                  "payload": [None, {"data": "opaque"}], "_meta": {"peer": True}},
                  "_meta": {"peer": {"untouched": True}}}
        await peer.connected._conn.send_notification("session/update", params)
        await until(lambda: len(peer.updates) == 1)
        assert peer.updates == [params]
        client.add_request_listener("session/request_permission", lambda _: {
            "outcome": {"outcome": "selected", "optionId": "allow"}})
        permission = await peer.connected.request_permission(session_id=sid,
            tool_call=schema.ToolCallUpdate(tool_call_id="native-tool"),
            options=[schema.PermissionOption(option_id="allow", name="Allow", kind="allow_once")])
        assert permission.outcome.option_id == "allow"
        peer.release.set()
        assert (await client.prompt(sid, "once")).stop_reason == "end_turn"
        assert len(peer.prompts) == 1


async def test_native_tool_plan_config_and_opaque_payloads_are_preserved():
    async with server() as (peer, url), await ACPClient.connect(url, on_update=peer.updates.append) as client:
        sid = await client.new_session(cwd="/workspace")
        updates = [
            {"sessionUpdate": "tool_call", "toolCallId": "tool", "title": "Read", "status": "pending",
             "rawInput": {"data": {"opaque": [1, False, None]}}, "_meta": {"peer": "opaque"}},
            {"sessionUpdate": "tool_call_update", "toolCallId": "tool", "status": "completed",
             "rawOutput": {"data": "nonbinary"}},
            {"sessionUpdate": "plan", "entries": [{"content": "Read", "priority": "medium", "status": "completed"}]},
            {"sessionUpdate": "config_option_update", "configOptions": [{"id": "model", "name": "Model",
             "type": "select", "currentValue": "a", "options": [{"value": "a", "name": "A"}]}]},
        ]
        for update in updates:
            await peer.emit(sid, update)
        await until(lambda: len(peer.updates) == len(updates))
        assert [notification["update"] for notification in peer.updates] == updates


@pytest.mark.parametrize("cwd", ["/runtime/alias/../project", r"C:\runtime\project", r"\\runtime\share\project"])
async def test_setup_preserves_absolute_runtime_host_cwd_verbatim(cwd):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd=cwd)
        await client.resume_session(sid, cwd=cwd)
        setup = [f for direction, f in peer.frames if direction == "in" and f["method"].startswith("session/")]
        assert [f["method"] for f in setup] == ["session/new", "session/resume"]
        assert [f["params"]["cwd"] for f in setup] == [cwd, cwd]
        assert setup[-1]["params"]["sessionId"] == sid


async def test_resume_has_no_private_window_and_explicit_load_is_standard():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        with pytest.raises(TypeError):
            await client.resume_session(sid, cwd="/workspace", replay_from={"type": "start", "limit": 50})
        await client.load_session(sid)
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in inbound] == ["initialize", "session/new", "session/load"]
        assert inbound[-1]["params"] == {"sessionId": sid, "cwd": "/workspace", "mcpServers": []}


async def test_default_creation_and_tracked_resume_do_not_re_resolve_launch_cwd():
    resolutions = []

    async def launch_cwd():
        resolutions.append(True)
        return "/runtime/launch"

    async with server() as (peer, url), await ACPClient.connect(url, resolve_default_cwd=launch_cwd) as client:
        sid = await client.new_session()
        await client.resume_session(sid)
        assert resolutions == [True]
        setups = [f for direction, f in peer.frames if direction == "in" and f["method"].startswith("session/")]
        assert [f["method"] for f in setups] == ["session/new", "session/resume"]
        assert [f["params"]["cwd"] for f in setups] == ["/runtime/launch"] * 2


async def test_agent_connect_wires_lazy_runtime_default_without_caller_paths(monkeypatch):
    from types import SimpleNamespace
    from urllib.parse import parse_qs, urlsplit
    from hypercli.agents import Deployments

    async with server() as (peer, url):
        deployments = Deployments(SimpleNamespace(api_key="fixture", timeout=5),
                                  api_base="http://fixture.invalid/agents",
                                  agents_ws_url=url.removesuffix("/acp"))
        reads = []

        def get(path):
            reads.append(path)
            return {"cwd": "/runtime/selected"}

        monkeypatch.setattr(deployments, "_get", get)
        agent = deployments._hydrate_agent({"id": "agent-1", "runtime": "opencode", "state": "running"})
        async with await agent.acp_connect() as client:
            assert reads == []
            sid = await client.new_session()
            await client.resume_session(sid)
            assert reads == ["/deployments/agent-1/runtime-paths"]
            assert parse_qs(urlsplit(peer.paths[0]).query)["agent_id"] == ["agent-1"]
            setups = [f for direction, f in peer.frames if direction == "in" and f["method"] in {"session/new", "session/resume"}]
            assert [f["params"]["cwd"] for f in setups] == ["/runtime/selected"] * 2


async def test_fresh_resume_uses_original_catalog_cwd_without_launch_resolution():
    async def forbidden_launch_resolution():
        pytest.fail("resume must not resolve the current launch directory")

    async with server() as (peer, url), await ACPClient.connect(url, resolve_default_cwd=forbidden_launch_resolution) as client:
        await client.resume_session("opaque/runtime:id")
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in inbound] == ["initialize", "session/list", "session/resume"]
        assert inbound[-1]["params"] == {"sessionId": "opaque/runtime:id", "cwd": "/original/project", "mcpServers": []}


async def test_foreground_waits_for_terminal_result_and_preserves_media():
    async with server() as (peer, url), await ACPClient.connect(url, on_update=peer.updates.append) as client:
        sid = await client.new_session(cwd="/workspace")
        blocks = [{"type": "text", "text": "  /compact\n[hypercli conversation context] \n"},
                  {"type": "image", "data": "AA==", "mimeType": "image/png"},
                  {"type": "resource_link", "uri": "file:///workspace/input", "name": "input", "_meta": {"literal": 1}}]
        task = asyncio.create_task(client.prompt(sid, blocks, timeout=5))
        await peer.entered.wait()
        assert not task.done()
        peer.release.set()
        result = await task
        assert result.message_id is None and result.stop_reason == "end_turn"
        assert peer.prompts == [blocks]
        await until(lambda: any(u["update"].get("sessionUpdate") == "agent_message_chunk" for u in peer.updates))


async def test_submit_waits_for_each_terminal_response():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        pending = [asyncio.create_task(client.submit_prompt(sid, text)) for text in "ABC"]
        await until(lambda: len(peer.prompts) == 3)
        assert all(not task.done() for task in pending)
        peer.release.set()
        results = await asyncio.gather(*pending)
        assert [result.stop_reason for result in results] == ["end_turn"] * 3
        assert peer.prompts == [[{"type": "text", "text": t}] for t in "ABC"]


async def test_observed_activity_does_not_preempt_prompt():
    observed = asyncio.Event()
    async with server() as (peer, url), await ACPClient.connect(
        url, on_update=lambda _: observed.set(),
    ) as client:
        sid = await client.new_session(cwd="/workspace")
        await peer.emit(sid, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "thinking"}})
        await asyncio.wait_for(observed.wait(), 5)
        task = asyncio.create_task(client.prompt(sid, "once", timeout=5))
        await peer.entered.wait()
        peer.release.set()
        assert (await task).stop_reason == "end_turn"
        assert len(peer.prompts) == 1


async def test_concurrent_prompts_keep_independent_correlated_results():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        first = asyncio.create_task(client.prompt(sid, "A", timeout=5))
        await peer.entered.wait()
        peer.reject_prompt = True
        second = asyncio.create_task(client.prompt(sid, "B", timeout=5))
        with pytest.raises(ACPRequestError):
            await second
        assert not first.done()
        peer.release.set()
        assert (await first).stop_reason == "end_turn"
        assert len(peer.prompts) == 2


async def test_cancel_active_never_resubmits():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "stop", timeout=5))
        await peer.entered.wait()
        await client.cancel(sid)
        assert (await task).stop_reason == "cancelled"
        assert len(peer.prompts) == 1
        assert sum(f.get("method") == "session/cancel" for d, f in peer.frames if d == "in") == 1


async def test_runtime_error_preserves_code_message_and_data():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        peer.reject_prompt = True
        sid = await client.new_session(cwd="/workspace")
        with pytest.raises(ACPRequestError) as error:
            await client.submit_prompt(sid, "once")
        assert error.value.code == -32012
        assert error.value.rpc_message == "fixture refusal"
        assert error.value.data == {"detail": "retained"}
        assert len(peer.prompts) == 1


async def test_failed_tool_update_is_delivered_without_settling_prompt():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        updates = []
        client.add_update_listener(updates.append)
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "A", timeout=5))
        await peer.entered.wait()
        notice = {"sessionUpdate": "tool_call_update", "toolCallId": "tool-1", "status": "failed"}
        await peer.emit(sid, notice)
        await until(lambda: any(event["update"] == notice for event in updates))
        assert not task.done()
        peer.release.set()
        assert (await task).stop_reason == "end_turn"
        assert len(peer.prompts) == 1


async def test_other_input_does_not_settle_owned_prompt():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "A", timeout=5))
        await peer.entered.wait()
        await peer.emit(sid, {"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "B"}})
        assert not task.done()
        peer.release.set()
        assert (await task).stop_reason == "end_turn"
        assert len(peer.prompts) == 1


async def test_prompt_timeout_never_sends_cancel_or_retries():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        with pytest.raises(TimeoutError):
            await client.prompt(sid, "once", timeout=.05)
        assert len(peer.prompts) == 1
        assert not any(f.get("method") == "session/cancel" for d, f in peer.frames if d == "in")


async def test_disconnect_during_prompt_rejects_foreground_observation():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "once", timeout=5))
        await peer.entered.wait()
        await peer.socket.close()
        with pytest.raises(AmbiguousDeliveryError):
            await task
        assert len(peer.prompts) == 1


async def test_caller_reconnect_and_resume_never_replays_history_or_resends_input():
    async with server() as (peer, url):
        async with await ACPClient.connect(url) as client:
            sid = await client.new_session(cwd="/workspace")
            peer.release.set()
            await client.submit_prompt(sid, "once")
            await peer.socket.close()
            await until(lambda: client._disconnected)
        first_connection_frames = len(peer.frames)
        async with await ACPClient.connect(url) as client:
            await client.resume_session(sid, cwd="/workspace")
            inbound = [frame for direction, frame in peer.frames[first_connection_frames:] if direction == "in"]
            assert [frame["method"] for frame in inbound] == ["initialize", "session/resume"]
            assert inbound[-1]["params"] == {"sessionId": sid, "cwd": "/workspace", "mcpServers": []}
            assert len(peer.prompts) == 1


async def test_disconnected_transport_before_prompt_is_known_unsent():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        await peer.socket.close()
        await until(lambda: client._disconnected)
        with pytest.raises(RetryableACPError):
            await client.submit_prompt(sid, "not sent")
        assert peer.prompts == []


async def test_silent_initialize_times_out():
    async with server() as (peer, url):
        peer.hold_initialize = True
        with pytest.raises(RetryableACPError):
            await ACPClient.connect(url, open_timeout=.05)


@pytest.mark.parametrize("code", sorted(ACP_TERMINAL_CLOSE_CODES))
@pytest.mark.parametrize("immediate", [False, True])
async def test_terminal_refusal_is_not_retryable(code, immediate):
    async with server() as (peer, url):
        peer.early_close = code
        peer.close_on_upgrade = immediate
        with pytest.raises(ACPTerminalCloseError) as error:
            await ACPClient.connect(url)
        assert error.value.code == code


async def test_explicit_close_settles_pending_requests():
    async with server() as (peer, url):
        client = await ACPClient.connect(url)
        peer.hold_close = True
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.request("session/close", {"sessionId": sid}))
        await peer.entered.wait()
        await client.close()
        with pytest.raises(ACPClosedError):
            await task


@pytest.mark.parametrize("listener", ["default", "custom", "wildcard", "both", "error", "unsubscribed"])
async def test_standard_permission_policy_and_error_fidelity(listener):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        calls = []
        def answer(*args):
            calls.append(args)
            if listener == "error":
                raise ACPRequestError("session/request_permission", -32012, "denied", {"why": "fixture"})
            return {"outcome": {"outcome": "selected", "optionId": "deny"}}
        if listener != "default":
            remove = client.add_request_listener("*" if listener == "wildcard" else "session/request_permission", answer)
            if listener == "both":
                client.add_request_listener("*", lambda *_: pytest.fail("specific listener takes precedence"))
            if listener == "unsubscribed":
                remove()
        operation = peer.connected.request_permission(session_id=sid,
            tool_call=schema.ToolCallUpdate(tool_call_id="tool-1", title="Read file"), options=[
            schema.PermissionOption(option_id="deny", name="Deny", kind="reject_once")])
        if listener == "error":
            with pytest.raises(RequestError) as error:
                await operation
            assert error.value.code == -32012 and error.value.data == {"why": "fixture"}
        else:
            result = await operation
            expected = "cancelled" if listener in {"default", "unsubscribed"} else "selected"
            assert result.outcome.outcome == expected
        if listener == "wildcard":
            assert calls[0][0] == "session/request_permission"
        elif listener == "both":
            assert len(calls[0]) == 1


async def test_unknown_standard_request_is_not_silently_served():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        await client.new_session(cwd="/workspace")
        with pytest.raises(RequestError) as error:
            await peer.connected._conn.send_request("fs/read_text_file", {"sessionId": "opaque/runtime:id", "path": "/tmp/input"})
        assert error.value.code == -32601


async def test_reader_failure_racing_write_does_not_leak_duplicate_future_error(monkeypatch):
    import hypercli.acp as implementation
    class InterruptedTransport:
        def __init__(self):
            self.incoming = asyncio.Queue()
            self.sending = asyncio.Event()
            self.fail = asyncio.Event()

        async def send(self, message):
            if message["method"] == "initialize":
                await self.incoming.put({"jsonrpc": "2.0", "id": message["id"], "result": {
                    "protocolVersion": 1, "agentInfo": {"name": "fixture", "version": "1"}, "agentCapabilities": {}}})
                return
            self.sending.set()
            await self.fail.wait()
            raise OSError("PRIVATE fixture send failure")

        async def receive(self):
            return await self.incoming.get()

        async def close(self):
            self.fail.set()

    transport = InterruptedTransport()
    async def connect(*args, **kwargs):
        return transport
    monkeypatch.setattr(implementation, "create_websocket_stream", connect)
    diagnostics = []
    loop = asyncio.get_running_loop()
    previous = loop.get_exception_handler()
    loop.set_exception_handler(lambda _, context: diagnostics.append(context))
    try:
        async with await ACPClient.connect("ws://fixture") as client:
            pending = asyncio.create_task(client.submit_prompt("s", "original"))
            await transport.sending.wait()
            await transport.incoming.put(None)
            await asyncio.sleep(0)
            transport.fail.set()
            with pytest.raises(AmbiguousDeliveryError):
                await pending
        gc.collect()
        assert not diagnostics
    finally:
        loop.set_exception_handler(previous)
