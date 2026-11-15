from unittest.mock import MagicMock
import json
import asyncio
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import serve
from websockets.exceptions import InvalidStatus

import httpx
import pytest

from hypercli import HyperCLI, SessionRecord, SessionSetup
from hypercli.agents import Deployments
from hypercli.http import APIError, HTTPClient


MESSAGE = {"session_id": "s", "seq": 1, "role": "assistant", "message_id": "m",
           "acp": {"content": {"type": "text", "text": "hello"}}, "participant_id": "a"}


@pytest.mark.parametrize("later", [False, True])
@pytest.mark.parametrize("payload", [
    None, {}, [], {"items": []}, {"items": None, "has_more": False},
    {"items": {}, "has_more": False}, {"items": [], "has_more": "false"},
    {"items": [], "has_more": None}, {"items": [], "has_more": 0},
    {"items": [], "has_more": False, "next_cursor": 3},
    {"items": [], "has_more": True}, {"items": [], "has_more": True, "next_cursor": None},
    {"items": [], "has_more": True, "next_cursor": ""},
    *[{"items": [row], "has_more": False, "next_cursor": None} for row in [
        None, {}, {**MESSAGE, "session_id": ""}, {**MESSAGE, "session_id": 1},
        {**MESSAGE, "seq": "1"}, {**MESSAGE, "seq": 0}, {**MESSAGE, "seq": 1.5},
        {**MESSAGE, "role": []}, {**MESSAGE, "role": "unknown"},
        {**MESSAGE, "acp": []}, {**MESSAGE, "acp": None}, {**MESSAGE, "message_id": 4},
    ]],
])
def test_message_pages_reject_malformed_http_success(monkeypatch, later, payload):
    calls = []

    def send(self, request, **kwargs):
        calls.append(request)
        body = {"items": [MESSAGE], "has_more": True, "next_cursor": "older"} if later and len(calls) == 1 else payload
        return httpx.Response(200, content=json.dumps(body), headers={"Content-Type": "application/json"}, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="test", api_url="https://example.test").deployments
    cursor = None
    if later:
        first = api.get_session_messages("s")
        assert first.has_more and len(first.items) == 1
        cursor = first.next_cursor
    with pytest.raises(ValueError):
        api.get_session_messages("s", cursor=cursor)
    if later:
        assert calls[-1].url.params["cursor"] == "older"


@pytest.mark.parametrize("payload", [
    {"items": [], "has_more": False, "next_cursor": None}, {"items": [], "has_more": False},
])
def test_message_pages_preserve_genuine_empty_http_success(monkeypatch, payload):
    monkeypatch.setattr(httpx.Client, "send", lambda self, request, **kwargs: httpx.Response(200, json=payload, request=request))
    page = HyperCLI(api_key="test", api_url="https://example.test").deployments.get_session_messages("s")
    assert page.items == [] and not page.has_more and page.next_cursor is None and page.head_seq is None


@pytest.mark.asyncio
@pytest.mark.parametrize("reference,canonical", [
    ("AABBCCDD-1234-5678-9ABC-0123456789AB", "aabbccdd-1234-5678-9abc-0123456789ab"),
    ("AABBCCDD123456789ABC0123456789AB", "aabbccdd-1234-5678-9abc-0123456789ab"),
    ("room-1", "room-1"),
])
async def test_session_observer_canonical_uuid_identity(reference, canonical):
    stop = asyncio.Event()
    sent = []
    received = []

    async def peer(ws):
        await ws.send(json.dumps({"type": "ready"}))
        frame = json.loads(await ws.recv())
        sent.append(frame)
        await ws.send(json.dumps({**frame, "type": "sessionSubscribed"}))
        await ws.send(json.dumps({"type": "sessionMessage", "sessionId": canonical,
                                 "message": {**MESSAGE, "session_id": canonical}}))
        await ws.wait_closed()

    def handler(event):
        received.append(event)
        stop.set()

    async with serve(peer, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="test", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        await asyncio.wait_for(client.deployments.subscribe_session(reference, handler, stop_event=stop), 3)
    assert sent[0]["sessionId"] == canonical
    assert len(received) == 1
    assert received[0].session_id == canonical
    assert received[0].message.session_id == canonical


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["ready", "ack"])
async def test_session_observer_handshake_timeout_is_terminal(monkeypatch, phase):
    original_wait_for = asyncio.wait_for

    async def fast_wait_for(awaitable, timeout):
        return await original_wait_for(awaitable, 0.02 if timeout == 10 else timeout)

    monkeypatch.setattr(asyncio, "wait_for", fast_wait_for)
    connections = []

    async def peer(ws):
        connections.append(ws)
        if phase == "ack":
            await ws.send(json.dumps({"type": "ready"}))
            await ws.recv()
        await ws.wait_closed()

    async with serve(peer, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="test", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        with pytest.raises(TimeoutError):
            await original_wait_for(client.deployments.subscribe_session("s", lambda event: None), 0.8)
    assert len(connections) == 1


def test_canonical_message_pagination():
    http = MagicMock(spec=HTTPClient)
    http.api_key = "test"
    api = Deployments(http, api_base="https://example.com/agents")
    api._get = MagicMock(return_value={"items": [MESSAGE], "next_cursor": "opaque", "has_more": True, "head_seq": 5})
    page = api.get_session_messages("s/id", cursor="older", limit=1)
    api._get.assert_called_once_with("/sessions/s%2Fid/messages", params={"cursor": "older", "limit": 1})
    assert page.items[0].message_id == "m"
    assert page.items[0].acp == MESSAGE["acp"]
    assert (page.next_cursor, page.has_more, page.head_seq) == ("opaque", True, 5)


@pytest.mark.asyncio
async def test_session_observer_reconnect_ack_mapping_and_stop():
    stop = asyncio.Event()
    connections = 0
    readies = []
    frames = []
    events = []

    async def peer(ws):
        nonlocal connections
        connections += 1
        query = parse_qs(urlsplit(ws.request.path).query)
        assert urlsplit(ws.request.path).path == "/ws"
        assert query == {"mode": ["observe"], "token": ["existing credential"]}
        await ws.send(json.dumps({"type": "ready"}))
        frame = json.loads(await ws.recv())
        frames.append(frame)
        assert frame["type"] == "sessionSubscribe" and frame["sessionId"] == "s"
        assert isinstance(frame["requestId"], str)
        assert len(readies) == connections - 1
        await ws.send(json.dumps({**frame, "type": "sessionSubscribed"}))
        await ws.send(json.dumps({"type": "sessionMessage", "sessionId": "s", "message": MESSAGE}))
        if connections > 1:
            frame = json.loads(await ws.recv())
            assert frame["type"] == "sessionUnsubscribe"

    def handler(event):
        events.append(event)
        if len(events) == 2:
            stop.set()

    async with serve(peer, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="existing credential", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        await asyncio.wait_for(client.deployments.subscribe_session("s", handler, stop_event=stop,
                               on_ready=lambda: readies.append(True)), 5)
    assert connections == 2 and len(readies) == 2
    assert events[0].type == "sessionMessage" and events[0].session_id == "s"
    assert events[0].message.acp == MESSAGE["acp"]
    assert events[0].message.message_id == "m"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["denied", "foreign", "wrong-ack", "callback"])
async def test_session_observer_terminal_errors(mode):
    connections = 0
    readies = []
    events = []

    async def peer(ws):
        nonlocal connections
        connections += 1
        await ws.send(json.dumps({"type": "ready"}))
        frame = json.loads(await ws.recv())
        if mode == "denied":
            await ws.send(json.dumps({**frame, "type": "sessionSubscriptionError", "message": "forbidden"}))
        else:
            await ws.send(json.dumps({**frame, "type": "sessionSubscribed",
                                     "requestId": "wrong" if mode == "wrong-ack" else frame["requestId"]}))
            await ws.send(json.dumps({"type": "sessionMessage", "sessionId": "s",
                                     "message": {**MESSAGE, "session_id": "other" if mode == "foreign" else "s"}}))
        await ws.wait_closed()

    def handler(event):
        events.append(event)
        raise ValueError("callback failed")

    async with serve(peer, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="test", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        with pytest.raises(ValueError):
            await asyncio.wait_for(client.deployments.subscribe_session("s", handler,
                                   on_ready=lambda: readies.append(True)), 3)
    assert connections == 1
    if mode in {"denied", "wrong-ack"}:
        assert not readies
    if mode == "foreign":
        assert not events


@pytest.mark.asyncio
async def test_session_observer_auth_denial():
    attempts = []

    def refuse(connection, request):
        attempts.append(request)
        return connection.respond(HTTPStatus.FORBIDDEN, "Forbidden")

    async def peer(ws):
        pytest.fail("unauthorized connection accepted")

    async with serve(peer, "127.0.0.1", 0, process_request=refuse) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="test", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        with pytest.raises(InvalidStatus):
            await asyncio.wait_for(client.deployments.subscribe_session("s", lambda event: None), 3)
    assert len(attempts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["ready", "backoff"])
async def test_session_observer_stop_interrupts_wait(phase):
    stop = asyncio.Event()
    connections = []

    async def peer(ws):
        connections.append(ws)
        if phase == "backoff":
            await ws.close()
        await asyncio.sleep(0.02)
        stop.set()
        await ws.wait_closed()

    async with serve(peer, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        client = HyperCLI(api_key="test", agents_api_base_url=f"http://127.0.0.1:{port}/agents")
        await asyncio.wait_for(client.deployments.subscribe_session("s", lambda event: None, stop_event=stop), 1)
    assert len(connections) == 1


@pytest.mark.parametrize("source", [None, "slack", "future-client"])
def test_catalog_decodes_source_and_keeps_pagination(source):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "test"
    api = Deployments(http, api_base="https://example.com/agents")
    api._get = MagicMock(return_value={
        "items": [{"id": "session", "source": source, "summary_text": "My title"}],
        "next_cursor": "opaque", "has_more": True,
    })
    page = api.list_sessions(agent_id="agent", cursor="previous", limit=20)
    api._get.assert_called_once_with("/sessions", params={"agent_id": "agent", "cursor": "previous", "limit": 20})
    assert page.items[0].source == source
    assert page.items[0].summary_text == "My title"
    assert page.next_cursor == "opaque"
    assert page.has_more is True


def test_old_server_missing_source_is_null():
    assert SessionRecord.from_dict({"id": "old-session"}).source is None
    assert SessionRecord.from_dict({"id": "old-session"}).meta == {}


@pytest.mark.parametrize("patch", [{}, {"meta": {}}, {"meta": {"resolved": ["a"], "remove": None}},
                                  {"title": None, "mode": "auto", "meta": {"nested": {"x": None}}},
                                  {"meta": None}])
def test_session_update_wire_and_read_meta(monkeypatch, patch):
    requests = []
    row = {"id": "s/id", "meta": {"resolved": ["a"], "nested": {"x": None}}, "mode": "auto"}

    def send(self, request, **kwargs):
        requests.append(request)
        payload = {"items": [row]} if request.url.path == "/agents/sessions" else row
        return httpx.Response(200, json=payload, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="caller-key", api_url="https://example.com").deployments
    updated = api.update_session("s/id", **patch)
    assert requests[0].method == "POST"
    assert str(requests[0].url) == "https://example.com/agents/sessions/s%2Fid"
    assert requests[0].headers["Authorization"] == "Bearer caller-key"
    assert json.loads(requests[0].content) == patch
    assert updated.meta == row["meta"] and updated.mode == "auto"
    assert api.get_session("s/id").meta == updated.meta
    assert api.list_sessions().items[0].meta == updated.meta


def test_session_update_propagates_rejection(monkeypatch):
    def send(self, request, **kwargs):
        return httpx.Response(422, json={"detail": "meta must be an object"}, request=request)
    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="caller-key", api_url="https://example.com").deployments
    with pytest.raises(APIError) as exc:
        api.update_session("s", meta=None)
    assert exc.value.status_code == 422


def test_setup_type_distinguishes_unknown_and_copies_nested_setup():
    payload = {"session_id": "session", "agent_id": "agent", "setup": None}
    assert SessionSetup.from_dict(payload).setup is None
    payload["setup"] = {"cwd": "/project", "mcpServers": [
        {"name": "mcp", "command": "tool", "args": ["serve"], "env": []},
    ]}
    parsed = SessionSetup.from_dict(payload)
    payload["setup"]["mcpServers"][0]["args"].append("changed")
    assert parsed.setup["mcpServers"][0]["args"] == ["serve"]


@pytest.mark.parametrize("payload", [None, {},
    {"session_id": "session", "agent_id": "agent"},
    {"session_id": "session", "agent_id": "agent", "setup": {}},
    {"session_id": "session", "agent_id": "agent", "setup": []},
    {"session_id": "session", "agent_id": "agent", "setup": {"cwd": "/saved", "mcpServers": [42]}},
    {"session_id": "other", "agent_id": "agent", "setup": None},
    {"session_id": "session", "agent_id": "other", "setup": None},
])
def test_setup_helper_rejects_malformed_or_mismatched_response(payload):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "test"
    api = Deployments(http, api_base="https://example.com/agents")
    api._get = MagicMock(return_value=payload)
    with pytest.raises(ValueError):
        api.get_session_setup("session", agent_id="agent")


@pytest.mark.parametrize("status", [401, 403, 404, 422, 500])
def test_setup_propagates_http_errors(monkeypatch, status):
    def send(self, request, **kwargs):
        return httpx.Response(status, json={"detail": "setup unavailable"}, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    api = HyperCLI(api_key="caller-key", api_url="https://example.com").deployments
    with pytest.raises(APIError) as caught:
        api.get_session_setup("session", agent_id="agent")
    assert caught.value.status_code == status


@pytest.mark.parametrize("agent_state", ["live", "archived", "deleted", "future-state"])
def test_detail_parses_computed_agent_state(agent_state):
    record = SessionRecord.from_dict({"id": "session", "agentState": agent_state})
    assert record.agent_state == agent_state


def test_detail_agent_state_defaults_none_when_absent_or_null():
    assert SessionRecord.from_dict({"id": "old-session"}).agent_state is None
    assert SessionRecord.from_dict({"id": "old-session", "agentState": None}).agent_state is None


@pytest.mark.parametrize("fields,expected", [
    ({"agent_state": "archived"}, "archived"),
    ({"agentState": "live", "agent_state": "archived"}, "live"),
    ({"agentState": None, "agent_state": "archived"}, None),
    ({"agentState": 42, "agent_state": "archived"}, None),
])
def test_agent_state_snake_compatibility_does_not_override_canonical_wire(fields, expected):
    assert SessionRecord.from_dict({"id": "session", **fields}).agent_state == expected


SESSION_ID = "b7a3d1e2-4f50-4c6a-9d2b-8c1f0a5e6d7b"
SESSION_ROW = {
    "id": SESSION_ID,
    "summary_text": "Stored title",
    "summary_keywords": ["session", "metadata"],
    "created_at": "2026-09-25T12:00:00+00:00",
    "updated_at": "2026-09-26T08:30:00+00:00",
    "participants": [
        {"kind": "agent", "participant_id": "3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45",
         "internal_session_id": "runtime-session", "cursor_pos": 14},
        {"kind": "user", "participant_id": "81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d",
         "internal_session_id": None, "cursor_pos": 3},
    ],
}


@pytest.mark.parametrize("source", [None, "slack", "future-client"])
@pytest.mark.parametrize("external_fields", [
    {"external_url": "  opaque:Thread/%2f?x=A+B#片  "},
    {"external_url": ""}, {"external_url": None}, {},
])
def test_detail_http_contract_and_list_consistency(monkeypatch, source, external_fields):
    row = {**SESSION_ROW, "source": source, "agentState": "live", **external_fields}
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        payload = {"items": [row], "has_more": False} if request.url.path == "/agents/sessions" else row
        return httpx.Response(200, json=payload, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    client = HyperCLI(api_key="caller-key", api_url="https://example.com")
    detail = client.deployments.get_session(SESSION_ID)
    assert isinstance(detail, SessionRecord)
    assert detail == SessionRecord(
        id=SESSION_ID, source=source, summary_text=row["summary_text"],
        summary_keywords=row["summary_keywords"], created_at=row["created_at"],
        updated_at=row["updated_at"], participants=row["participants"],
        agent_state="live",
        external_url=external_fields.get("external_url"),
    )
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == f"https://example.com/agents/sessions/{SESSION_ID}"
    assert request.method == "GET" and request.content == b""
    assert request.headers["Authorization"] == "Bearer caller-key"
    assert "X-BACKEND-API-KEY" not in request.headers
    assert client.deployments.list_sessions().items[0] == detail


def test_detail_encodes_platform_id_and_null_metadata(monkeypatch):
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        return httpx.Response(200, json={
            **SESSION_ROW, "source": None, "summary_text": None, "summary_keywords": None,
            "participants": [],
        }, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    client = HyperCLI(api_key="caller-key", api_url="https://example.com")
    detail = client.deployments.get_session("platform/odd id?#%")
    assert len(requests) == 1
    assert str(requests[0].url) == "https://example.com/agents/sessions/platform%2Fodd%20id%3F%23%25"
    assert detail == SessionRecord(
        id=SESSION_ID, created_at=SESSION_ROW["created_at"], updated_at=SESSION_ROW["updated_at"],
    )


@pytest.mark.parametrize("status", [401, 403, 404, 422])
def test_detail_propagates_http_errors_without_fallback(monkeypatch, status):
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        return httpx.Response(status, json={"detail": "Denied or invalid session"}, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    client = HyperCLI(api_key="caller-key", api_url="https://example.com")
    with pytest.raises(APIError) as exc:
        client.deployments.get_session(SESSION_ID)
    assert exc.value.status_code == status
    assert "Denied or invalid session" in str(exc.value)
    assert len(requests) == 1
