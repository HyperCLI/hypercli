"""Public Python API against the actual pinned versioned SDK and loopback WS.

Backend ASGI -> v1/v2 runtime coverage is in agents/test_acp_v2_pipe.py.
"""
import asyncio
import json
from contextlib import asynccontextmanager

import pytest
from acp.exceptions import RequestError
from acp.experimental import AgentProtocolRouter, v2
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
        self.echo_after_response = False

    async def initialize(self, **kwargs):
        if self.early_close:
            await self.socket.close(code=self.early_close, reason="fixture refusal")
        if self.hold_initialize:
            await self.release.wait()
        return v2.schema.InitializeResponse.model_validate({"protocolVersion": 2,
            "info": {"name": "fixture", "version": "1"}, "capabilities": {"session": {}}})

    async def new_session(self, **kwargs):
        return v2.schema.NewSessionResponse(session_id="opaque/runtime:id")

    async def resume_session(self, session_id, **kwargs):
        assert session_id == "opaque/runtime:id"
        return v2.schema.ResumeSessionResponse()

    async def close_session(self, **kwargs):
        self.entered.set()
        if self.hold_close:
            await self.release.wait()
        return v2.schema.CloseSessionResponse()

    async def prompt(self, session_id, prompt, **kwargs):
        self.prompts.append([b.model_dump(by_alias=True, exclude_unset=True) for b in prompt])
        self.entered.set()
        if self.reject_prompt:
            raise RequestError(-32012, "fixture refusal", {"detail": "retained"})
        message_id = f"input-{len(self.prompts)}"
        async def work():
            if self.echo_after_response:
                await asyncio.sleep(.02)
            await self.emit(session_id, {"sessionUpdate": "user_message", "messageId": message_id, "content": self.prompts[-1]})
            await self.emit(session_id, {"sessionUpdate": "state_update", "state": "running"})
            await self.release.wait()
            await self.emit(session_id, {"sessionUpdate": "agent_message_chunk", "messageId": "answer", "content": {"type": "text", "text": "answer"}})
            await self.emit(session_id, {"sessionUpdate": "state_update", "state": "idle", "stopReason": "cancelled" if self.cancelled else "end_turn"})
        task = asyncio.create_task(work())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return v2.schema.PromptResponse(message_id=message_id)

    async def cancel_session(self, **kwargs):
        self.cancelled = True
        self.release.set()

    async def emit(self, sid, update):
        await self.connected.session_update(session_id=sid,
            update=v2.schema.UpdateSessionNotification.model_validate({"sessionId": sid, "update": update}).update)


@asynccontextmanager
async def server():
    peer = Peer()
    def factory(connection):
        peer.connected = connection
        return peer
    async def handler(socket):
        peer.socket = socket
        peer.paths.append(socket.request.path)
        await AgentProtocolRouter(v2=factory).run(Transport(socket, peer))
    async with serve(handler, "127.0.0.1", 0) as listener:
        try:
            yield peer, f"ws://127.0.0.1:{listener.sockets[0].getsockname()[1]}/ws/acp"
        finally:
            peer.release.set()
            for task in list(peer.tasks):
                task.cancel()
            await asyncio.gather(*peer.tasks, return_exceptions=True)


async def test_v2_handshake_source_and_setup_use_standard_shapes():
    async with server() as (peer, url), await ACPClient.connect(url, source="routines") as client:
        assert client.initialize_response["protocolVersion"] == 2
        assert "source=routines" in peer.paths[0]
        sid = await client.new_session(cwd="/workspace")
        await client.resume_session(sid, cwd="/workspace", replay=True)
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert inbound[0]["params"] == {"protocolVersion": 2, "info": {"name": "hypercli-py-sdk", "version": ""}, "capabilities": {}}
        assert [f["method"] for f in inbound] == ["initialize", "session/new", "session/resume"]
        assert inbound[-1]["params"]["replayFrom"] == {"type": "start"}
        assert not any("source" in f.get("params", {}) for f in inbound)


@pytest.mark.parametrize("late_echo", [False, True])
async def test_foreground_waits_for_echo_acceptance_and_idle(late_echo):
    async with server() as (peer, url), await ACPClient.connect(url, on_update=peer.updates.append) as client:
        peer.echo_after_response = late_echo
        sid = await client.new_session(cwd="/workspace")
        blocks = [{"type": "text", "text": "  /compact\n[hypercli conversation context] \n"},
                  {"type": "image", "data": "AA==", "mimeType": "image/png"},
                  {"type": "resource_link", "uri": "file:///workspace/input", "name": "input", "_meta": {"literal": 1}}]
        task = asyncio.create_task(client.prompt(sid, blocks, timeout=5))
        await peer.entered.wait()
        assert not task.done()
        peer.release.set()
        result = await task
        assert result.message_id == "input-1" and result.stop_reason == "end_turn"
        assert peer.prompts == [blocks]
        await until(lambda: any(u["update"].get("sessionUpdate") == "agent_message_chunk" for u in peer.updates))


async def test_submit_accepts_separate_messages_without_waiting_for_idle():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        accepted = [await client.submit_prompt(sid, text) for text in "ABC"]
        assert [a.message_id for a in accepted] == ["input-1", "input-2", "input-3"]
        assert peer.prompts == [[{"type": "text", "text": t}] for t in "ABC"]
        assert not peer.release.is_set()


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


@pytest.mark.parametrize("kind", ["notice", "other_input"])
async def test_foreground_fails_on_notice_or_competing_admission(kind):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "A", timeout=5))
        await peer.entered.wait()
        if kind == "notice":
            await peer.emit(sid, {"sessionUpdate": "notice", "severity": "error", "title": "Runtime refused input"})
        else:
            await peer.emit(sid, {"sessionUpdate": "user_message", "messageId": "other", "content": [{"type": "text", "text": "B"}]})
        with pytest.raises(ACPError):
            await task
        assert len(peer.prompts) == 1


async def test_prompt_timeout_never_sends_cancel_or_retries():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        with pytest.raises(TimeoutError):
            await client.prompt(sid, "once", timeout=.05)
        assert len(peer.prompts) == 1
        assert not any(f.get("method") == "session/cancel" for d, f in peer.frames if d == "in")


async def test_disconnect_after_acceptance_rejects_foreground_observation():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        task = asyncio.create_task(client.prompt(sid, "once", timeout=5))
        await peer.entered.wait()
        await peer.socket.close()
        with pytest.raises(AmbiguousDeliveryError):
            await task
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
async def test_terminal_refusal_is_not_retryable(code):
    async with server() as (peer, url):
        peer.early_close = code
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


@pytest.mark.parametrize("listener", ["default", "custom", "wildcard", "error", "unsubscribed"])
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
            if listener == "unsubscribed":
                remove()
        operation = peer.connected.request_permission(session_id=sid, title="Read file", options=[
            v2.schema.PermissionOption(option_id="deny", name="Deny", kind="reject_once")])
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


async def test_unknown_standard_request_is_not_silently_served():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        await client.new_session(cwd="/workspace")
        with pytest.raises(RequestError) as error:
            await peer.connected._conn.send_request("fs/read_text_file", {"path": "/tmp/input"})
        assert error.value.code == -32601
