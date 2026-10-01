from unittest.mock import MagicMock

import httpx
import pytest

from hypercli import HyperCLI, SessionRecord
from hypercli.agents import Deployments
from hypercli.http import APIError, HTTPClient


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
def test_detail_http_contract_and_list_consistency(monkeypatch, source):
    row = {**SESSION_ROW, "source": source}
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
