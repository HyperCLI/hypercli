import json
from unittest.mock import MagicMock

import httpx
import pytest

from hypercli import HyperCLI, RoomMessage, RoomRecord
from hypercli.agents import Deployments
from hypercli.http import APIError, HTTPClient

ROOM_ID = "2f5d8a10-97c3-4a1e-8b4d-9a2f6c0e7d31"
AGENT_A = "3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45"
AGENT_B = "8d1f2b34-56a7-48b9-9c01-d23e4f5a6b7c"
OWNER_ID = "81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d"


def room_row(**overrides):
    row = {
        "id": ROOM_ID, "room_id": OWNER_ID, "session_id": ROOM_ID,
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
        "configured_agent_turn_limit": None, "configured_token_limit": None,
        "users": [{"user_id": OWNER_ID, "name": "Owner", "role": "owner"}],
        "status": "live",
        "setup_revision": 3,
        "created_at": "2026-11-12T10:00:00Z",
        "updated_at": "2026-11-12T10:00:00Z",
    }
    row.update(overrides)
    return row


def parent_row(**overrides):
    return {"id": OWNER_ID, "title": None, "purpose": "", "style": "", "rules": [], "status": "live",
            "token_limit": None, "agent_turn_limit": None, "created_at": "2026-11-12T10:00:00Z", **overrides}


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


def test_room_message_lost_response_is_not_resent(monkeypatch):
    posts = []

    def reset_after_commit(self, request, **kwargs):
        posts.append((request.method, request.url.path))
        raise httpx.ReadError("Connection reset after commit", request=request)

    monkeypatch.setattr(httpx.Client, "send", reset_after_commit)
    with pytest.raises(httpx.ReadError, match="reset after commit"):
        make_api().create_room_message(ROOM_ID, "Send once")
    assert posts == [("POST", f"/agents/sessions/{ROOM_ID}/room/messages")]


def test_session_member_grant_and_period_addressed_revocation(monkeypatch):
    path = f"/agents/sessions/{ROOM_ID}/grants/{AGENT_B}"
    created = {"id": AGENT_B, "session_id": ROOM_ID, "room_id": None, "role": "member", "subject_type": "agent",
               "subject_id": AGENT_A, "member_grant_id": OWNER_ID, "revoked_at": None}
    revoked = dict(created, revoked_at="2026-11-12T10:00:01Z")
    requests = patch_transport(monkeypatch, {("POST", path): created, ("POST", path + "/revoke"): revoked})
    api = make_api()
    assert api.issue_member("sessions", ROOM_ID, AGENT_B, subject_type="agent",
                            subject_id=AGENT_A, member_grant_id=OWNER_ID) == created
    assert json.loads(requests[0].content) == {"subject_type": "agent", "subject_id": AGENT_A, "member_grant_id": OWNER_ID}
    assert api.revoke_member("sessions", ROOM_ID, AGENT_B) == revoked


def test_create_room_exact_wire_and_default_readback(monkeypatch):
    requests = patch_transport(monkeypatch, {("POST", "/agents/rooms"): {"id": OWNER_ID,"session_id": ROOM_ID}})
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
    assert room["id"] != room["session_id"]



def test_create_room_defaults_send_documented_body(monkeypatch):
    requests = patch_transport(monkeypatch, {("POST", "/agents/rooms"): {"id": OWNER_ID,"session_id": ROOM_ID}})
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
    assert room["session_id"] == ROOM_ID


def test_get_room_exact_wire(monkeypatch):
    requests = patch_transport(monkeypatch, {("GET", f"/agents/rooms/{OWNER_ID}"): parent_row()})
    room = make_api().get_room(OWNER_ID)
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == f"https://example.com/agents/rooms/{OWNER_ID}"
    assert request.method == "GET" and request.content == b""
    assert request.headers["Authorization"] == "Bearer caller-key"
    assert room["id"] == OWNER_ID
    assert room["status"] == "live"


def test_update_room_omits_unsupplied_fields(monkeypatch):
    requests = patch_transport(
        monkeypatch,
        {("PATCH", f"/agents/rooms/{OWNER_ID}"): parent_row(title="New focus", status="archived")},
    )
    room = make_api().update_room(OWNER_ID, title="New focus", status="archived")
    assert json.loads(requests[0].content) == {"title": "New focus", "status": "archived"}
    assert requests[0].method == "PATCH"
    assert room["title"] == "New focus"


@pytest.mark.parametrize("patch,expected", [
    ({"purpose": None}, {"purpose": None}),
    ({"rules": None}, {"rules": None}),
    ({"rules": []}, {"rules": []}),
    ({"token_limit": None}, {"token_limit": None}),
    ({"agent_turn_limit": 5}, {"agent_turn_limit": 5}),
])
def test_update_room_null_semantics(monkeypatch, patch, expected):
    requests = patch_transport(monkeypatch, {("PATCH", f"/agents/rooms/{OWNER_ID}"): parent_row()})
    make_api().update_room(OWNER_ID, **patch)
    assert json.loads(requests[0].content) == expected


def test_update_room_sends_empty_patch_when_nothing_supplied(monkeypatch):
    requests = patch_transport(monkeypatch, {("PATCH", f"/agents/rooms/{OWNER_ID}"): parent_row()})
    make_api().update_room(OWNER_ID)
    assert json.loads(requests[0].content) == {}


def test_create_room_message_exact_wire_and_readback(monkeypatch):
    requests = patch_transport(
        monkeypatch, {("POST", f"/agents/sessions/{ROOM_ID}/room/messages"): message_row(reply_to="msg-0")},
    )
    message = make_api().create_room_message(
        ROOM_ID, "Can you look at the build failure?", reply_to="msg-0",
    )
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == f"https://example.com/agents/sessions/{ROOM_ID}/room/messages"
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
        monkeypatch, {("POST", f"/agents/sessions/{ROOM_ID}/room/messages"): message_row()},
    )
    make_api().create_room_message(ROOM_ID, "hello")
    assert json.loads(requests[0].content) == {"body": "hello"}


def test_room_message_encodes_odd_room_ids(monkeypatch):
    requests = []

    def send(self, request, **kwargs):
        requests.append(request)
        return httpx.Response(200, json=message_row(session_id="platform/odd id?#%"), request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    make_api().create_room_message("platform/odd id?#%", "hello")
    assert str(requests[0].url) == \
        "https://example.com/agents/sessions/platform%2Fodd%20id%3F%23%25/room/messages"


@pytest.mark.parametrize("status", [401, 403, 404, 422])
def test_room_errors_propagate_without_fallback(monkeypatch, status):
    denied = httpx.Response(status, json={"detail": "Only the room owner may manage this room"})
    requests = patch_transport(monkeypatch, {
        ("POST", "/agents/rooms"): denied,
        ("GET", f"/agents/rooms/{ROOM_ID}"): denied,
        ("PATCH", f"/agents/rooms/{ROOM_ID}"): denied,
        ("POST", f"/agents/sessions/{ROOM_ID}/room/messages"): denied,
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


def test_session_budget_exact_patch_and_configured_effective_receipt(monkeypatch):
    path = f"/agents/sessions/{ROOM_ID}/budgets"
    receipt = {"agent_turn_limit": None, "token_limit": 0, "effective_agent_turn_limit": 3, "effective_token_limit": 0}
    requests = patch_transport(monkeypatch, {("GET", path): receipt, ("PATCH", path): receipt})
    api = make_api()
    assert api.update_session_budgets(ROOM_ID, token_limit=0) == receipt
    assert api.update_session_budgets(ROOM_ID, agent_turn_limit=None) == receipt
    assert api.get_session_budgets(ROOM_ID) == receipt
    assert [json.loads(r.content) for r in requests[:2]] == [{"token_limit": 0}, {"agent_turn_limit": None}]


@pytest.mark.parametrize("override", [None, 0])
def test_child_retains_roster_and_explicit_budget(monkeypatch, override):
    patch_transport(monkeypatch, {("GET", f"/agents/sessions/{ROOM_ID}/room"): room_row(configured_token_limit=override)})
    child = make_api().get_room_session(ROOM_ID)
    assert child.room_id == OWNER_ID and child.session_id == child.id == ROOM_ID
    assert child.configured_token_limit == override
    assert [(u.user_id,u.role) for u in child.users] == [(OWNER_ID,"owner")]
    missing = room_row(); del missing["configured_token_limit"]
    with pytest.raises(ValueError): RoomRecord.from_dict(missing)


@pytest.mark.parametrize("status", [307, 308])
def test_redirect_with_matching_message_receipt_is_not_acceptance(monkeypatch, status):
    path = f"/agents/sessions/{ROOM_ID}/room/messages"
    response = httpx.Response(status, headers={"Location": "/other"}, json=message_row(message_id=AGENT_A))
    requests = patch_transport(monkeypatch, {("POST", path): response})
    with pytest.raises(APIError, match="Outcome unknown") as exc:
        make_api().create_room_message(ROOM_ID, "hello", message_id=AGENT_A)
    assert exc.value.status_code == status
    assert [(r.method, r.url.path) for r in requests] == [("POST", path)]


@pytest.mark.parametrize("field,value", [(None,None),("session_id",OWNER_ID),("session_id",None),
                                           ("message_id",AGENT_B),("message_id",None)])
def test_correlates_room_acceptance(monkeypatch, field, value):
    sid, mid = (v.replace("-", "").upper() for v in (ROOM_ID, AGENT_A))
    row = message_row(message_id=AGENT_A)
    if field and value is None:
        del row[field]
    elif field:
        row[field] = value
    path = f"/agents/sessions/{sid}/room/messages"
    requests = patch_transport(monkeypatch, {("POST",path):row})
    if field:
        with pytest.raises(ValueError, match="Outcome unknown"):
            make_api().create_room_message(sid,"hello",message_id=mid)
    else:
        message = make_api().create_room_message(sid,"hello",message_id=mid)
        assert (message.session_id,message.message_id) == (ROOM_ID,AGENT_A)
    assert [(r.method,r.url.path,json.loads(r.content)) for r in requests] == [("POST",path,{"body":"hello","message_id":mid})]
