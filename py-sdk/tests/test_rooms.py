import json
from unittest.mock import MagicMock

import httpx
import pytest

from hypercli import HyperCLI, RoomAgent, RoomMessage, RoomRecord
from hypercli.agents import Deployments
from hypercli.http import APIError, HTTPClient

ROOM_ID = "2f5d8a10-97c3-4a1e-8b4d-9a2f6c0e7d31"
AGENT_A = "3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45"
AGENT_B = "8d1f2b34-56a7-48b9-9c01-d23e4f5a6b7c"
OWNER_ID = "81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d"


def room_row(**overrides):
    row = {
        "id": ROOM_ID,
        "kind": "room",
        "title": "Build triage",
        "purpose": "Investigate CI failures.",
        "style": "Concise technical discussion.",
        "rules": ["Respond with new information only."],
        "owner_id": OWNER_ID,
        "agents": [
            {"agent_id": AGENT_A, "name": "Atlas", "internal_session_id": "claude-9f2e"},
            {"agent_id": AGENT_B, "name": "Maya", "internal_session_id": None},
        ],
        "token_limit": None,
        "agent_turn_limit": 25,
        "configured_agent_turn_limit": None,
        "status": "live",
        "setup_revision": 3,
        "created_at": "2026-11-12T10:00:00Z",
        "updated_at": "2026-11-12T10:00:00Z",
    }
    row.update(overrides)
    return row


def message_row(**overrides):
    row = {
        "session_id": ROOM_ID,
        "message_id": "msg-1",
        "seq": 7,
        "epoch_id": "epoch-1",
        "sender_id": OWNER_ID,
        "sender_kind": "user",
        "sender_name": "Dmitry",
        "body": "Can you look at the build failure?",
        "reply_to": None,
        "created_at": "2026-11-12T10:05:00Z",
        "fanout": {AGENT_A: True, AGENT_B: False},
    }
    row.update(overrides)
    return row


def patch_transport(monkeypatch, responses):
    """Route by (method, path); responses is a dict of path -> payload or status."""
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        key = (request.method, request.url.path)
        if key not in responses:
            return httpx.Response(404, json={"detail": "no route"}, request=request)
        reply = responses[key]
        if isinstance(reply, httpx.Response):
            return reply
        return httpx.Response(200, json=reply, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    return requests


def make_api():
    return HyperCLI(api_key="caller-key", api_url="https://example.com").deployments


def test_create_room_exact_wire_and_default_readback(monkeypatch):
    requests = patch_transport(monkeypatch, {("POST", "/agents/rooms"): room_row()})
    room = make_api().create_room([AGENT_A, AGENT_B], title="Build triage",
                                  purpose="Investigate CI failures.",
                                  style="Concise technical discussion.",
                                  rules=["Respond with new information only."])
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://example.com/agents/rooms"
    assert request.method == "POST"
    assert request.headers["Authorization"] == "Bearer caller-key"
    assert json.loads(request.content) == {
        "title": "Build triage",
        "purpose": "Investigate CI failures.",
        "style": "Concise technical discussion.",
        "rules": ["Respond with new information only."],
        "agents": [AGENT_A, AGENT_B],
        "token_limit": None,
        "agent_turn_limit": None,
    }
    assert room == RoomRecord(
        id=ROOM_ID, title="Build triage", purpose="Investigate CI failures.",
        style="Concise technical discussion.", rules=["Respond with new information only."],
        owner_id=OWNER_ID,
        agents=[RoomAgent(AGENT_A, "Atlas", "claude-9f2e"), RoomAgent(AGENT_B, "Maya")],
        token_limit=None, agent_turn_limit=25, configured_agent_turn_limit=None,
        status="live", setup_revision=3,
        created_at="2026-11-12T10:00:00Z", updated_at="2026-11-12T10:00:00Z",
    )


def test_create_room_defaults_send_documented_body(monkeypatch):
    requests = patch_transport(monkeypatch, {("POST", "/agents/rooms"): room_row()})
    make_api().create_room([AGENT_A])
    assert json.loads(requests[0].content) == {
        "title": None, "purpose": "", "style": "", "rules": [],
        "agents": [AGENT_A], "token_limit": None, "agent_turn_limit": None,
    }


def test_create_room_passes_explicit_policy_knobs(monkeypatch):
    requests = patch_transport(monkeypatch, {
        ("POST", "/agents/rooms"): room_row(
            token_limit=100000, agent_turn_limit=0, configured_agent_turn_limit=0,
        ),
    })
    room = make_api().create_room([AGENT_A], token_limit=100000, agent_turn_limit=0)
    body = json.loads(requests[0].content)
    assert body["token_limit"] == 100000 and body["agent_turn_limit"] == 0
    assert room.token_limit == 100000
    assert room.agent_turn_limit == 0 and room.configured_agent_turn_limit == 0


def test_get_room_exact_wire(monkeypatch):
    requests = patch_transport(monkeypatch, {("GET", f"/agents/rooms/{ROOM_ID}"): room_row()})
    room = make_api().get_room(ROOM_ID)
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == f"https://example.com/agents/rooms/{ROOM_ID}"
    assert request.method == "GET" and request.content == b""
    assert request.headers["Authorization"] == "Bearer caller-key"
    assert room.id == ROOM_ID and room.kind == "room"
    assert room.status == "live"


def test_update_room_omits_unsupplied_fields(monkeypatch):
    requests = patch_transport(
        monkeypatch,
        {("PATCH", f"/agents/rooms/{ROOM_ID}"): room_row(title="New focus", setup_revision=4)},
    )
    room = make_api().update_room(ROOM_ID, title="New focus", status="archived")
    assert json.loads(requests[0].content) == {"title": "New focus", "status": "archived"}
    assert requests[0].method == "PATCH"
    assert room.title == "New focus" and room.setup_revision == 4


@pytest.mark.parametrize("patch,expected", [
    ({"purpose": None}, {"purpose": None}),
    ({"rules": []}, {"rules": []}),
    ({"token_limit": None}, {"token_limit": None}),
    ({"agent_turn_limit": 5}, {"agent_turn_limit": 5}),
])
def test_update_room_null_semantics(monkeypatch, patch, expected):
    requests = patch_transport(monkeypatch, {("PATCH", f"/agents/rooms/{ROOM_ID}"): room_row()})
    make_api().update_room(ROOM_ID, **patch)
    assert json.loads(requests[0].content) == expected


def test_update_room_requires_at_least_one_field(monkeypatch):
    requests = patch_transport(monkeypatch, {("PATCH", f"/agents/rooms/{ROOM_ID}"): room_row()})
    make_api().update_room(ROOM_ID)
    assert json.loads(requests[0].content) == {}


def test_create_room_message_exact_wire_and_readback(monkeypatch):
    requests = patch_transport(
        monkeypatch, {("POST", f"/agents/rooms/{ROOM_ID}/messages"): message_row(reply_to="msg-0")},
    )
    message = make_api().create_room_message(
        ROOM_ID, "Can you look at the build failure?", reply_to="msg-0",
    )
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == f"https://example.com/agents/rooms/{ROOM_ID}/messages"
    assert request.method == "POST"
    assert json.loads(request.content) == {
        "body": "Can you look at the build failure?", "reply_to": "msg-0",
    }
    assert message == RoomMessage(
        session_id=ROOM_ID, message_id="msg-1", seq=7, epoch_id="epoch-1",
        sender_id=OWNER_ID, sender_kind="user", sender_name="Dmitry",
        body="Can you look at the build failure?", reply_to="msg-0",
        created_at="2026-11-12T10:05:00Z", fanout={AGENT_A: True, AGENT_B: False},
    )


def test_create_room_message_omits_absent_reply_to(monkeypatch):
    requests = patch_transport(
        monkeypatch, {("POST", f"/agents/rooms/{ROOM_ID}/messages"): message_row()},
    )
    make_api().create_room_message(ROOM_ID, "hello")
    assert json.loads(requests[0].content) == {"body": "hello"}


def test_room_message_encodes_odd_room_ids(monkeypatch):
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        return httpx.Response(200, json=message_row(), request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    make_api().create_room_message("platform/odd id?#%", "hello")
    assert str(requests[0].url) == \
        "https://example.com/agents/rooms/platform%2Fodd%20id%3F%23%25/messages"


@pytest.mark.parametrize("status", [401, 403, 404, 422])
def test_room_errors_propagate_without_fallback(monkeypatch, status):
    denied = httpx.Response(status, json={"detail": "Only the room owner may manage this room"})
    requests = patch_transport(monkeypatch, {
        ("POST", "/agents/rooms"): denied,
        ("GET", f"/agents/rooms/{ROOM_ID}"): denied,
        ("PATCH", f"/agents/rooms/{ROOM_ID}"): denied,
        ("POST", f"/agents/rooms/{ROOM_ID}/messages"): denied,
    })
    api = make_api()
    with pytest.raises(APIError) as exc:
        api.create_room([AGENT_A])
    assert exc.value.status_code == status
    with pytest.raises(APIError):
        api.get_room(ROOM_ID)
    with pytest.raises(APIError):
        api.update_room(ROOM_ID, title="x")
    with pytest.raises(APIError):
        api.create_room_message(ROOM_ID, "hello")
    assert len(requests) == 4


@pytest.mark.parametrize("overrides", [
    {"kind": "dm"}, {"id": None}, {"agent_turn_limit": None}, {"setup_revision": "3"},
    {"token_limit": True}, {"rules": "be nice"}, {"agents": [{"agent_id": AGENT_A}]},
])
def test_room_record_rejects_malformed_responses(overrides):
    with pytest.raises(ValueError):
        RoomRecord.from_dict(room_row(**overrides))


@pytest.mark.parametrize("overrides", [
    {"seq": "7"}, {"fanout": {AGENT_A: "yes"}}, {"body": None}, {"sender_kind": None},
])
def test_room_message_rejects_malformed_responses(overrides):
    with pytest.raises(ValueError):
        RoomMessage.from_dict(message_row(**overrides))


def test_room_helpers_use_the_sessions_transport_scope():
    """Rooms ride the same agents API base and user auth as the DM session reads."""
    http = MagicMock(spec=HTTPClient)
    http.api_key = "test"
    api = Deployments(http, api_base="https://example.com/agents")
    api._get = MagicMock(return_value=room_row())
    api.get_room("room-id")
    api._get.assert_called_once_with("/rooms/room-id")
