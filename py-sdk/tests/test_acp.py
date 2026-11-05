"""Public Python API against the actual pinned versioned SDK and loopback WS.

The peer uses the installed upstream v1 implementation.
"""
import asyncio
import gc
import json
from contextlib import asynccontextmanager
from copy import deepcopy

import httpx
import pytest
from acp import schema
from acp.agent import AgentSideConnection
from acp.exceptions import RequestError
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from hypercli.acp import (
    ACP_TERMINAL_CLOSE_CODES,
    ACPClient,
    ACPClosedError,
    ACPError,
    ACPRequestError,
    ACPStartupError,
    ACPTerminalCloseError,
    ACPUnavailableError,
    AmbiguousDeliveryError,
    RetryableACPError,
)

pytestmark = pytest.mark.asyncio

RECOVERED_SETUP = {"cwd": "/saved/project", "mcpServers": [
    {"name": "local", "command": "mcp-tool", "args": ["serve"],
     "env": [{"name": "MODE", "value": "test"}]},
    {"name": "remote", "type": "http", "url": "https://mcp.example.com/api",
     "headers": [{"name": "X-Test", "value": "test"}]},
    {"name": "events", "type": "sse", "url": "https://mcp.example.com/events",
     "headers": []},
]}


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
        self.reject_resume = False
        self.hold_initialize = False
        self.hold_new = False
        self.hold_close = False
        self.early_close = None
        self.close_on_upgrade = False
        self.version = 1
        self.catalog_cwd = "/original/project"

    async def initialize(self, **kwargs):
        if self.early_close:
            await self.socket.close(code=self.early_close, reason="fixture refusal")
        if self.hold_initialize:
            await self.release.wait()
        return schema.InitializeResponse.model_validate({"protocolVersion": self.version,
            "agentInfo": {"name": "fixture", "version": "1"}, "agentCapabilities": {"sessionCapabilities": {"resume": {}}}})

    async def new_session(self, **kwargs):
        if self.hold_new:
            await self.release.wait()
        return schema.NewSessionResponse(session_id="opaque/runtime:id")

    async def resume_session(self, session_id, **kwargs):
        assert session_id == "opaque/runtime:id"
        if self.reject_resume:
            raise RequestError(-32602, "unsupported setup")
        return schema.ResumeSessionResponse()

    async def list_sessions(self, **kwargs):
        return schema.ListSessionsResponse.model_validate({"sessions": [
            {"sessionId": "opaque/runtime:id", "cwd": self.catalog_cwd},
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


async def test_platform_factory_recovers_memoryless_setup_through_authenticated_rest(monkeypatch):
    from hypercli import HyperCLI
    from hypercli.agents import Deployments

    requests = []
    agent_id = "3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45"
    sid = "opaque/runtime:id"

    def send(self, request, **kwargs):
        requests.append(request)
        return httpx.Response(200, json={
            "session_id": sid, "agent_id": agent_id, "setup": RECOVERED_SETUP,
        }, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="caller-key", api_url="https://example.com").deployments
    async with server() as (peer, url):
        monkeypatch.setattr(Deployments, "acp_ws_url", property(lambda self: url))
        async with await api.acp_connect(agent_id) as client:
            await client.resume_session(sid)
        assert len(requests) == 1
        assert str(requests[0].url) == (
            f"https://example.com/agents/sessions/opaque%2Fruntime%3Aid/setup?agent_id={agent_id}"
        )
        assert requests[0].headers["Authorization"] == "Bearer caller-key"
        assert requests[0].method == "GET"
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in inbound] == ["initialize", "session/resume"]
        assert inbound[-1]["params"] == {"sessionId": sid, **RECOVERED_SETUP}
        schema.ResumeSessionRequest.model_validate(inbound[-1]["params"])


async def test_recovered_setup_is_copied_and_only_cached_after_native_success():
    saved = deepcopy(RECOVERED_SETUP)
    calls = []

    async def resolve(sid):
        calls.append(sid)
        return saved

    sid = "opaque/runtime:id"
    async with server() as (peer, url), await ACPClient.connect(url, resolve_session_setup=resolve) as client:
        peer.reject_resume = True
        with pytest.raises(ACPRequestError):
            await client.resume_session(sid)
        assert sid not in client._session_setups
        peer.reject_resume = False
        await client.resume_session(sid)
        saved["mcpServers"][0]["env"][0]["value"] = "changed"
        saved["cwd"] = "/changed"
        await client.resume_session(sid)
        assert calls == [sid, sid]
        frames = [f for direction, f in peer.frames if direction == "in" and f["method"] == "session/resume"]
        assert all(f["params"] == {"sessionId": sid, **RECOVERED_SETUP} for f in frames)


@pytest.mark.parametrize("status,payload", [
    (403, {"detail": "denied"}), (500, {"detail": "unavailable"}),
    (200, {"session_id": "opaque/runtime:id", "agent_id": "agent"}),
    (200, {"session_id": "wrong", "agent_id": "agent", "setup": None}),
])
async def test_factory_recovery_failure_prevents_native_resume(monkeypatch, status, payload):
    from hypercli import HyperCLI
    from hypercli.agents import Deployments
    from hypercli.http import APIError

    def send(self, request, **kwargs):
        return httpx.Response(status, json=payload, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="caller-key", api_url="https://example.com").deployments
    async with server() as (peer, url):
        monkeypatch.setattr(Deployments, "acp_ws_url", property(lambda self: url))
        async with await api.acp_connect("agent") as client:
            with pytest.raises(APIError if status >= 400 else ValueError):
                await client.resume_session("opaque/runtime:id")
        assert [f["method"] for direction, f in peer.frames if direction == "in"] == ["initialize"]


@pytest.mark.parametrize("servers", [[], RECOVERED_SETUP["mcpServers"]])
async def test_explicit_mcp_list_bypasses_recovery(servers):
    def forbidden(sid):
        pytest.fail("an explicit list must bypass platform recovery")

    async with server() as (peer, url), await ACPClient.connect(url, resolve_session_setup=forbidden) as client:
        await client.resume_session("opaque/runtime:id", mcp_servers=servers)
        await client.resume_session("opaque/runtime:id")
        frames = [f for direction, f in peer.frames if direction == "in" and f["method"] == "session/resume"]
        assert [f["params"]["mcpServers"] for f in frames] == [servers, servers]


@pytest.mark.parametrize("recovered", [{}, {"cwd": "/saved"},
    {"cwd": "/saved", "mcpServers": None}, {"cwd": "/saved", "mcpServers": [42]}, []])
async def test_malformed_recovery_never_sends_resume(recovered):
    async with server() as (peer, url), await ACPClient.connect(
        url, resolve_session_setup=lambda sid: recovered,
    ) as client:
        with pytest.raises(ValueError):
            await client.resume_session("opaque/runtime:id", cwd="/override")
        assert [f["method"] for direction, f in peer.frames if direction == "in"] == ["initialize"]


@pytest.mark.parametrize("error", [httpx.TimeoutException("timeout"), RuntimeError("denied")])
async def test_recovery_errors_propagate_before_resume(error):
    async def resolve(sid):
        raise error

    async with server() as (peer, url), await ACPClient.connect(url, resolve_session_setup=resolve) as client:
        with pytest.raises(type(error)) as caught:
            await client.resume_session("opaque/runtime:id")
        assert caught.value is error
        assert [f["method"] for direction, f in peer.frames if direction == "in"] == ["initialize"]


async def test_unknown_setup_keeps_catalog_fallback_and_explicit_cwd_wins():
    async with server() as (peer, url), await ACPClient.connect(
        url, resolve_session_setup=lambda sid: None,
    ) as client:
        await client.resume_session("opaque/runtime:id")
        frames = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in frames] == ["initialize", "session/list", "session/resume"]
        assert frames[-1]["params"] == {
            "sessionId": "opaque/runtime:id", "cwd": peer.catalog_cwd, "mcpServers": [],
        }
    async with server() as (peer, url), await ACPClient.connect(
        url, resolve_session_setup=lambda sid: RECOVERED_SETUP,
    ) as client:
        await client.resume_session("opaque/runtime:id", cwd="/override")
        frames = [f for direction, f in peer.frames if direction == "in"]
        assert frames[-1]["params"] == {
            "sessionId": "opaque/runtime:id", **RECOVERED_SETUP, "cwd": "/override",
        }


async def test_v2_initialize_answer_is_not_a_supported_execution_profile():
    async with server() as (peer, url):
        peer.version = 2
        with pytest.raises(ACPError, match="requires ACP v1"):
            await ACPClient.connect(url)
        assert peer.prompts == []


async def test_mcp_setup_explicit_empty_and_omitted_preserve_standard_entries():
    from copy import deepcopy
    entries = [
        {"name": "stdio", "command": "/bin/tool", "args": ["a:b"], "env": [{"name": "KEY", "value": "value"}]},
        {"name": "http", "type": "http", "url": "https://example.test/mcp", "headers": [{"name": "Authorization", "value": "Bearer explicit"}]},
        {"name": "sse", "type": "sse", "url": "https://example.test/events", "headers": []},
    ]
    original = deepcopy(entries)
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace", mcp_servers=entries)
        entries[0]["name"] = "caller-mutated"
        await client.resume_session(sid)
        await client.resume_session(sid, mcp_servers=[])
        await client.resume_session(sid)
        await client.resume_session(sid, mcp_servers=original)
        peer.reject_resume = True
        with pytest.raises(ACPRequestError) as refusal:
            await client.resume_session(sid, mcp_servers=[])
        assert refusal.value.code == -32602
        peer.reject_resume = False
        await client.resume_session(sid)
        frames = [f for direction, f in peer.frames if direction == "in" and f["method"] in ("session/new", "session/resume")]
        assert [f["params"]["mcpServers"] for f in frames] == [original, original, [], [], original, [], original]
        for frame in frames:
            model = {"session/new": schema.NewSessionRequest, "session/resume": schema.ResumeSessionRequest}[frame["method"]]
            model.model_validate(frame["params"])
            assert "HYPER_ADDITIONAL_MCP_SERVERS" not in frame["params"]


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


async def test_resume_has_no_private_window_and_sends_standard_params():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        sid = await client.new_session(cwd="/workspace")
        with pytest.raises(TypeError):
            await client.resume_session(sid, cwd="/workspace", replay_from={"type": "start", "limit": 50})
        await client.resume_session(sid)
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in inbound] == ["initialize", "session/new", "session/resume"]
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


@pytest.mark.parametrize("session_id", ["resuscitator", "pr-watch", "builder-watch", "missing-session"])
async def test_unknown_session_reports_catalog_lookup_not_filesystem_failure(session_id):
    async def forbidden_launch_resolution():
        pytest.fail("an unknown binding must not be replaced with the launch cwd")

    async with server() as (peer, url), await ACPClient.connect(url, resolve_default_cwd=forbidden_launch_resolution) as client:
        with pytest.raises(ACPUnavailableError, match="not found in the available session catalog") as error:
            await client.resume_session(session_id)
        assert session_id in str(error.value)
        assert [f["method"] for direction, f in peer.frames if direction == "in"] == ["initialize", "session/list"]


@pytest.mark.parametrize("cwd", [r"C:\Users\old-runner\project", "/home/alice/project", "/home/node/shared"])
async def test_old_session_preserves_original_catalog_cwd_and_runtime_refusal(cwd):
    async def forbidden_launch_resolution():
        pytest.fail("resume must preserve the original cwd, including legacy paths")

    async with server() as (peer, url), await ACPClient.connect(url, resolve_default_cwd=forbidden_launch_resolution) as client:
        peer.catalog_cwd = cwd
        peer.reject_resume = True
        with pytest.raises(ACPRequestError, match="unsupported setup"):
            await client.resume_session("opaque/runtime:id")
        inbound = [f for direction, f in peer.frames if direction == "in"]
        assert [f["method"] for f in inbound] == ["initialize", "session/list", "session/resume"]
        assert inbound[-1]["params"]["cwd"] == cwd


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


CALLBACKS = [
    ("fs/read_text_file", {"path": "/workspace/input", "line": 2, "limit": 3},
     {"content": "hello\n"}, schema.ReadTextFileRequest, schema.ReadTextFileResponse),
    ("fs/write_text_file", {"path": "/workspace/output", "content": "hello\n"},
     {}, schema.WriteTextFileRequest, schema.WriteTextFileResponse),
    ("terminal/create", {"command": "fixture", "args": ["arg"], "cwd": "/workspace",
                         "env": [{"name": "FIXTURE", "value": "yes"}], "outputByteLimit": 1024},
     {"terminalId": "terminal:opaque"}, schema.CreateTerminalRequest, schema.CreateTerminalResponse),
    ("terminal/output", {"terminalId": "terminal:opaque"},
     {"output": "hello\n", "truncated": False, "exitStatus": {"exitCode": 0}},
     schema.TerminalOutputRequest, schema.TerminalOutputResponse),
    ("terminal/wait_for_exit", {"terminalId": "terminal:opaque"},
     {"exitCode": 0}, schema.WaitForTerminalExitRequest, schema.WaitForTerminalExitResponse),
    ("terminal/kill", {"terminalId": "terminal:opaque"},
     {}, schema.KillTerminalRequest, schema.KillTerminalResponse),
    ("terminal/release", {"terminalId": "terminal:opaque"},
     {}, schema.ReleaseTerminalRequest, schema.ReleaseTerminalResponse),
]
CALLBACK_IDS = [case[0] for case in CALLBACKS]
CALLBACK_CAPABILITIES = {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True}


@pytest.mark.parametrize("method,params,result,request_model,response_model", CALLBACKS, ids=CALLBACK_IDS)
@pytest.mark.parametrize("wildcard", [False, True], ids=["exact", "wildcard"])
async def test_registered_callbacks_round_trip(method, params, result, request_model, response_model, wildcard):
    async with server() as (peer, url), await ACPClient.connect(
        url, client_capabilities=CALLBACK_CAPABILITIES,
    ) as client:
        calls = []
        wire = {"sessionId": "opaque/runtime:id", **params}
        request_model.model_validate(wire)
        response_model.model_validate(result)

        def answer(*args):
            calls.append(args)
            return result

        async def async_answer(*args):
            await asyncio.sleep(0)
            return answer(*args)

        client.add_request_listener("*" if wildcard else method, async_answer if wildcard else answer)
        assert await asyncio.wait_for(peer.connected._conn.send_request(method, wire), 5) == result
        assert calls == ([(method, wire)] if wildcard else [(wire,)])
        initialize = next(f for d, f in peer.frames if d == "in" and f.get("method") == "initialize")
        assert initialize["params"]["clientCapabilities"] == CALLBACK_CAPABILITIES
        request = next(f for d, f in peer.frames if d == "out" and f.get("method") == method)
        responses = [f for d, f in peer.frames if d == "in" and "method" not in f and f.get("id") == request["id"]]
        assert responses == [{"jsonrpc": "2.0", "id": request["id"], "result": result}]


@pytest.mark.parametrize("method,params,result,request_model,response_model", CALLBACKS, ids=CALLBACK_IDS)
@pytest.mark.parametrize("wildcard", [False, True], ids=["exact", "wildcard"])
async def test_callback_refusal_is_preserved(method, params, result, request_model, response_model, wildcard):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        calls = []
        data = {"reason": "fixture refusal", "detail": [None, False, {"retained": 1}]}

        def refuse(*args):
            calls.append(args)
            if wildcard:
                raise RequestError(-32012, "denied verbatim", data)
            raise ACPRequestError(method, -32012, "denied verbatim", data)

        client.add_request_listener("*" if wildcard else method, refuse)
        wire = {"sessionId": "opaque/runtime:id", **params}
        with pytest.raises(RequestError) as error:
            await asyncio.wait_for(peer.connected._conn.send_request(method, wire), 5)
        assert (error.value.code, str(error.value), error.value.data) == (-32012, "denied verbatim", data)
        assert calls == ([(method, wire)] if wildcard else [(wire,)])
        request = next(f for d, f in peer.frames if d == "out" and f.get("method") == method)
        responses = [f for d, f in peer.frames if d == "in" and "method" not in f and f.get("id") == request["id"]]
        assert responses == [{"jsonrpc": "2.0", "id": request["id"], "error": {
            "code": -32012, "message": "denied verbatim", "data": data}}]


@pytest.mark.parametrize("method", CALLBACK_IDS + ["unknown/method"])
async def test_unhandled_callbacks_report_method_not_found(method):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        client.add_request_listener("unrelated/method", lambda _: pytest.fail("unrelated listener called"))
        with pytest.raises(RequestError) as error:
            await asyncio.wait_for(peer.connected._conn.send_request(method, {}), 5)
        assert (error.value.code, str(error.value), error.value.data) == (
            -32601, "Method not found", {"method": method})


async def test_callback_selection_unsubscribe_and_notification_boundary():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        method = "fs/read_text_file"
        wire = {"sessionId": "opaque/runtime:id", "path": "/workspace/input"}
        calls = []

        def answer(label, args):
            calls.append((label, args))
            return {"content": label}

        # Wildcard registration order does not override the existing exact-first policy.
        remove_wildcard = client.add_request_listener("*", lambda *args: answer("wildcard", args))
        remove_first = client.add_request_listener(method, lambda *args: answer("first", args))
        remove_second = client.add_request_listener(method, lambda *args: answer("second", args))
        for label, remove in [("first", remove_first), ("second", remove_second), ("wildcard", remove_wildcard)]:
            assert await peer.connected._conn.send_request(method, wire) == {"content": label}
            remove()
            remove()
        assert calls == [("first", (wire,)), ("second", (wire,)), ("wildcard", (method, wire))]
        with pytest.raises(RequestError) as error:
            await peer.connected._conn.send_request(method, wire)
        assert error.value.code == -32601
        notification_calls = []
        client.add_request_listener("*", lambda *args: notification_calls.append(args))
        await peer.connected._conn.send_notification(method, wire)
        # A subsequent observed update is a barrier for notification processing.
        client.add_update_listener(peer.updates.append)
        await peer.emit("opaque/runtime:id", {
            "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "barrier"}})
        await until(lambda: len(peer.updates) == 1)
        assert notification_calls == []


@pytest.mark.parametrize("wildcard", [False, True], ids=["exact", "wildcard"])
async def test_registered_unknown_callback_uses_raw_dispatch(wildcard):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        method, params, result = "unknown/method", {"opaque": [None, False]}, {"answer": [1, None]}
        calls = []

        def answer(*args):
            calls.append(args)
            return result

        client.add_request_listener("*" if wildcard else method, answer)
        assert await peer.connected._conn.send_request(method, params) == result
        assert calls == ([(method, params)] if wildcard else [(params,)])


async def test_concurrent_callbacks_keep_ids_and_do_not_block_outbound_requests():
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        entered, release = asyncio.Event(), asyncio.Event()

        async def read(params):
            if params["path"] == "/slow":
                entered.set()
                await release.wait()
            return {"content": params["path"]}

        client.add_request_listener("fs/read_text_file", read)
        transport = Transport(peer.socket, peer)
        for request_id, path in [("opaque:slow", "/slow"), (0, "/fast")]:
            await transport.send({"jsonrpc": "2.0", "id": request_id, "method": "fs/read_text_file",
                                  "params": {"sessionId": "opaque/runtime:id", "path": path}})
        try:
            await asyncio.wait_for(entered.wait(), 5)
            def responses():
                return [f for d, f in peer.frames if d == "in" and "method" not in f]
            await until(lambda: len(responses()) == 1)
            assert responses() == [{"jsonrpc": "2.0", "id": 0, "result": {"content": "/fast"}}]
            assert await client.new_session(cwd="/workspace") == "opaque/runtime:id"
            release.set()
            await until(lambda: len(responses()) == 2)
            assert responses()[1] == {"jsonrpc": "2.0", "id": "opaque:slow", "result": {"content": "/slow"}}
        finally:
            release.set()


@pytest.mark.parametrize("wildcard", [False, True], ids=["exact", "wildcard"])
async def test_close_cancels_inflight_callback_without_fabricated_response(wildcard):
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def wait(*args):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        client.add_request_listener("*" if wildcard else "terminal/wait_for_exit", wait)
        pending = asyncio.create_task(peer.connected._conn.send_request("terminal/wait_for_exit", {
            "sessionId": "opaque/runtime:id", "terminalId": "terminal:opaque"}))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            await asyncio.wait_for(client.close(), 5)
            assert cancelled.is_set()
            with pytest.raises(ConnectionError):
                await asyncio.wait_for(pending, 5)
            assert not any(d == "in" and "method" not in f for d, f in peer.frames)
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)


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


def inbound(peer, method):
    return next(f for d, f in peer.frames if d == "in" and f.get("method") == method)


def inbound_seen(peer, method):
    return any(d == "in" and f.get("method") == method for d, f in peer.frames)


async def test_session_startup_refusal_settles_pending_request_and_keeps_connection_usable():
    """A product sessionStartupError settles only its request; the socket lives on."""
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        peer.hold_new = True

        async def refuse_startup():
            await until(lambda: inbound_seen(peer, "session/new"))
            request = inbound(peer, "session/new")
            await peer.socket.send(json.dumps({"type": "sessionStartupError", "requestId": request["id"],
                "error": {"code": "unavailable", "message": "All worker slots are occupied"}}))

        peer.tasks.add(asyncio.create_task(refuse_startup()))
        with pytest.raises(ACPStartupError, match="All worker slots are occupied"):
            async with asyncio.timeout(5):
                await client.new_session(cwd="/workspace")
        # The peer's blocked session/new answer arrives late for a request that
        # already settled; the connection must keep reading past both frames.
        refused_id = inbound(peer, "session/new")["id"]
        peer.release.set()
        await until(lambda: any(d == "out" and f.get("id") == refused_id for d, f in peer.frames))
        async with asyncio.timeout(5):
            assert await client.new_session(cwd="/workspace") == "opaque/runtime:id"


async def test_malformed_or_foreign_startup_frames_do_not_settle_pending_requests():
    """Invalid product shapes are not answered with fabricated request errors."""
    async with server() as (peer, url), await ACPClient.connect(url) as client:
        peer.hold_new = True

        async def send_startup_frames():
            await until(lambda: inbound_seen(peer, "session/new"))
            request = inbound(peer, "session/new")
            for frame in (
                {"type": "sessionStartupError", "requestId": request["id"],
                 "error": {"code": "busy", "message": "wrong code"}},
                {"type": "sessionStartupError", "requestId": "foreign-id",
                 "error": {"code": "unavailable", "message": "foreign id"}},
                {"type": "sessionStartupError", "requestId": True,
                 "error": {"code": "unavailable", "message": "bool id"}},
                {"type": "unrelatedProductFrame"},
            ):
                await peer.socket.send(json.dumps(frame))

        peer.tasks.add(asyncio.create_task(send_startup_frames()))
        pending = asyncio.create_task(client.new_session(cwd="/workspace"))
        await asyncio.sleep(0.05)
        assert not pending.done(), "invalid product frames must not settle the pending request"
        peer.release.set()
        assert await asyncio.wait_for(pending, 5) == "opaque/runtime:id"


async def test_session_startup_refusal_without_pending_seam_fails_closed_instead_of_hanging():
    """Without a dict ``_pending`` seam the refusal still fails the caller, closed."""

    class NonDictPending:
        # Upstream-shaped request map that defeats the isinstance(dict) seam
        # while keeping the installed Connection's own bookkeeping working.
        def __init__(self):
            self.entries = {}

        def __setitem__(self, request_id, future):
            self.entries[request_id] = future

        def pop(self, request_id, *default):
            return self.entries.pop(request_id, *default)

        def values(self):
            return self.entries.values()

        def clear(self):
            self.entries.clear()

    async with server() as (peer, url), await ACPClient.connect(url) as client:
        client._connection._pending = NonDictPending()
        peer.hold_new = True

        async def refuse_startup():
            await until(lambda: inbound_seen(peer, "session/new"))
            request = inbound(peer, "session/new")
            await peer.socket.send(json.dumps({"type": "sessionStartupError", "requestId": request["id"],
                "error": {"code": "unavailable", "message": "All worker slots are occupied"}}))

        peer.tasks.add(asyncio.create_task(refuse_startup()))
        with pytest.raises(ACPStartupError, match="All worker slots are occupied") as refusal:
            async with asyncio.timeout(5):
                await client.new_session(cwd="/workspace")
        # The caller saw the recorded typed error rather than a hang, and the
        # fallback closed the transport and marked the connection dead.
        assert refusal.value is client._transport_error
        assert client._disconnected
        assert client._transport.transport._ws.close_code is not None
