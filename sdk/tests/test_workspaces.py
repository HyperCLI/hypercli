from datetime import datetime, timezone
from pathlib import Path

import pytest

from hypercli import (
    WorkspaceAccessEntry,
    WorkspaceAccessSnapshot,
    WorkspaceAccessVisibility,
    WorkspaceAgentAssociation,
)
from hypercli.http import APIError
from hypercli.workspaces import WorkspacesAPI, _derive_workspaces_base, _headers


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        return value if tz is None else value.astimezone(tz)


def test_workspaces_base_derives_from_agents_base(monkeypatch):
    monkeypatch.delenv("HYPER_WORKSPACES_API_BASE", raising=False)

    assert (
        _derive_workspaces_base("https://api.agents.dev.hypercli.com/agents")
        == "https://api.agents.dev.hypercli.com/workspaces"
    )


def test_workspaces_base_uses_explicit_env(monkeypatch):
    monkeypatch.setenv("HYPER_WORKSPACES_API_BASE", "http://127.0.0.1:18080/workspaces")

    assert _derive_workspaces_base("https://ignored.example/agents") == "http://127.0.0.1:18080/workspaces"


def test_get_workspace_normalizes_metadata_and_encodes_reference(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        return {
            "id": "workspace-1",
            "name": "Team Knowledge",
            "slug": "team-knowledge",
            "display_name": "Team Docs",
            "display_slug": "team-docs",
            "description": "Shared runbooks",
            "role": "admin",
            "created_at": "2026-07-20T10:00:00Z",
            "updated_at": "2026-07-21T11:00:00Z",
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    workspace = api.get("team knowledge", agent_id="agent-1")

    assert workspace.display_name == "Team Docs"
    assert workspace.display_slug == "team-docs"
    assert workspace.role == "admin"
    assert workspace.created_at == "2026-07-20T10:00:00Z"
    assert workspace.updated_at == "2026-07-21T11:00:00Z"
    assert calls == [
        (
            "GET",
            "http://workspaces.test/workspaces/team%20knowledge",
            "key",
            None,
            "agent-1",
            None,
        )
    ]


def test_admin_access_snapshot_uses_only_workspace_and_grants_routes(monkeypatch):
    calls = []
    responses = [
        {"id": "workspace-1", "name": "Team", "slug": "team", "role": "admin"},
        [
            {
                "id": "agent-admin",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "shared-id",
                "role": "admin",
                "display_name": "Research Agent",
                "display_slug": "research-a",
                "expires_at": "2026-09-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "agent-viewer",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "shared-id",
                "role": "viewer",
                "display_name": "",
                "display_slug": "research-b",
                "expires_at": "2026-08-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "user-contributor",
                "workspace_id": "workspace-1",
                "subject_type": "user",
                "subject_id": "shared-id",
                "role": "contributor",
                "display_name": "Alice",
                "display_slug": "alice",
                "expires_at": None,
                "revoked_at": None,
            },
            {
                "id": "user-viewer",
                "workspace_id": "workspace-1",
                "subject_type": "user",
                "subject_id": "shared-id",
                "role": "viewer",
                "display_name": "Alicia",
                "display_slug": "alice",
                "expires_at": "2026-10-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "revoked",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "revoked-agent",
                "role": "admin",
                "expires_at": None,
                "revoked_at": "2026-07-20T00:00:00Z",
            },
            {
                "id": "expired",
                "workspace_id": "workspace-1",
                "subject_type": "user",
                "subject_id": "expired-user",
                "role": "admin",
                "expires_at": "2026-07-21T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "boundary",
                "workspace_id": "workspace-1",
                "subject_type": "user",
                "subject_id": "boundary-user",
                "role": "admin",
                "expires_at": "2026-07-22T12:00:00Z",
                "revoked_at": None,
            },
        ],
    ]

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs))
        return responses.pop(0)

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces.datetime", FixedDateTime)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    snapshot = api.access_snapshot("team knowledge/#1", user_id="user-1")
    visibility: WorkspaceAccessVisibility = snapshot.visibility

    assert isinstance(snapshot, WorkspaceAccessSnapshot)
    assert visibility == "all-direct-access"
    assert snapshot.current_role == "admin"
    assert snapshot.captured_at == "2026-07-22T12:00:00Z"
    assert snapshot.grants is not None
    assert [grant.id for grant in snapshot.grants] == [
        "agent-admin",
        "agent-viewer",
        "user-contributor",
        "user-viewer",
        "revoked",
        "expired",
        "boundary",
    ]
    assert snapshot.entries is not None
    assert all(isinstance(entry, WorkspaceAccessEntry) for entry in snapshot.entries)
    assert [(entry.subject_type, entry.subject_id) for entry in snapshot.entries] == [
        ("agent", "shared-id"),
        ("user", "shared-id"),
    ]
    agent_entry, user_entry = snapshot.entries
    assert agent_entry.role == "admin"
    assert agent_entry.display_name == "Research Agent"
    assert agent_entry.display_slug is None
    assert [grant.id for grant in agent_entry.grants] == ["agent-admin", "agent-viewer"]
    assert agent_entry.grants[0] is snapshot.grants[0]
    assert user_entry.role == "contributor"
    assert user_entry.display_name is None
    assert user_entry.display_slug == "alice"
    assert calls == [
        (
            "GET",
            "http://workspaces.test/workspaces/team%20knowledge%2F%231",
            "key",
            "user-1",
            None,
            {},
        ),
        (
            "GET",
            "http://workspaces.test/workspaces/team%20knowledge%2F%231/grants",
            "key",
            "user-1",
            None,
            {},
        ),
    ]


@pytest.mark.parametrize("role", ["viewer", "contributor"])
def test_non_admin_access_snapshot_does_not_request_grants(monkeypatch, role):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs))
        return {"id": "workspace-1", "name": "Team", "slug": "team", "role": role}

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces.datetime", FixedDateTime)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    snapshot = api.access_snapshot("team", agent_id="agent-1")

    assert snapshot.current_role == role
    assert snapshot.visibility == "current-access-only"
    assert snapshot.captured_at == "2026-07-22T12:00:00Z"
    assert snapshot.entries is None
    assert snapshot.grants is None
    assert calls == [
        (
            "GET",
            "http://workspaces.test/workspaces/team",
            "key",
            None,
            "agent-1",
            {},
        )
    ]


def test_access_snapshot_rejects_invalid_expiration(monkeypatch):
    responses = [
        {"id": "workspace-1", "name": "Team", "slug": "team", "role": "admin"},
        [
            {
                "id": "invalid-expiration",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "agent-1",
                "role": "viewer",
                "expires_at": "not-a-timestamp",
                "revoked_at": None,
            }
        ],
    ]
    monkeypatch.setattr(
        "hypercli.workspaces._request",
        lambda *_args, **_kwargs: responses.pop(0),
    )
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    with pytest.raises(
        ValueError,
        match="Invalid expiration timestamp for workspace grant invalid-expiration: not-a-timestamp",
    ):
        api.access_snapshot("team")


def test_access_snapshot_rejects_malformed_grants_payload(monkeypatch):
    responses = [
        {"id": "workspace-1", "name": "Team", "slug": "team", "role": "admin"},
        {"grants": []},
    ]
    monkeypatch.setattr(
        "hypercli.workspaces._request",
        lambda *_args, **_kwargs: responses.pop(0),
    )
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    with pytest.raises(ValueError, match="Workspace grants response must be a list"):
        api.access_snapshot("team")


def test_list_agents_projects_admin_snapshot_and_rejects_non_admin(monkeypatch):
    calls = []
    responses = [
        {"id": "workspace-1", "name": "Team", "slug": "team", "role": "admin"},
        [
            {
                "id": "agent-1-admin",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "agent-1",
                "role": "admin",
                "expires_at": "2026-09-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "agent-1-viewer",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "agent-1",
                "role": "viewer",
                "expires_at": "2026-08-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "agent-2-viewer",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "agent-2",
                "role": "viewer",
                "expires_at": None,
                "revoked_at": None,
            },
            {
                "id": "agent-2-contributor",
                "workspace_id": "workspace-1",
                "subject_type": "agent",
                "subject_id": "agent-2",
                "role": "contributor",
                "expires_at": "2026-10-01T00:00:00Z",
                "revoked_at": None,
            },
            {
                "id": "user-admin",
                "workspace_id": "workspace-1",
                "subject_type": "user",
                "subject_id": "user-1",
                "role": "admin",
                "expires_at": None,
                "revoked_at": None,
            },
        ],
        {"id": "workspace-2", "name": "Viewer", "slug": "viewer", "role": "viewer"},
    ]

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url))
        return responses.pop(0)

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces.datetime", FixedDateTime)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    assert api.list_agents("team") == [
        WorkspaceAgentAssociation(
            workspace_id="workspace-1",
            agent_id="agent-1",
            role="admin",
            expires_at="2026-09-01T00:00:00Z",
        ),
        WorkspaceAgentAssociation(
            workspace_id="workspace-1",
            agent_id="agent-2",
            role="contributor",
            expires_at=None,
        ),
    ]
    with pytest.raises(
        ValueError,
        match="Workspace agent associations are available only to Workspace admins",
    ):
        api.list_agents("viewer")
    assert calls == [
        ("GET", "http://workspaces.test/workspaces/team"),
        ("GET", "http://workspaces.test/workspaces/team/grants"),
        ("GET", "http://workspaces.test/workspaces/viewer"),
    ]


def test_workspace_headers_keep_identity_bearer_resolved():
    headers = _headers("key", user_id="user-1", agent_id="agent-1")

    assert headers == {"Authorization": "Bearer key", "Content-Type": "application/json"}


def test_create_and_grant_payloads(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        if url.endswith("/grants"):
            return {
                "id": "grant-1",
                "workspace_id": "workspace-1",
                "subject_type": kwargs["json"]["subject_type"],
                "subject_id": kwargs["json"]["subject_id"],
                "role": kwargs["json"]["role"],
                "display_name": kwargs["json"].get("display_name"),
                "display_slug": kwargs["json"].get("display_slug"),
                "is_owner": True,
                "expires_at": kwargs["json"].get("expires_at"),
            }
        return {"id": "workspace-1", "name": kwargs["json"]["name"], "slug": kwargs["json"]["slug"]}

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    workspace = api.create(name="Demo Workspace", slug="demo", user_id="user-1")
    grant = api.grant(
        "demo",
        subject_type="agent",
        subject_id="agent-1",
        role="viewer",
        display_name="Research Agent",
        display_slug="research-agent",
        expires_at="2026-08-01T00:00:00Z",
        user_id="user-1",
    )

    assert workspace.slug == "demo"
    assert grant.subject_id == "agent-1"
    assert grant.display_name == "Research Agent"
    assert grant.display_slug == "research-agent"
    assert grant.is_owner is True
    assert grant.expires_at == "2026-08-01T00:00:00Z"
    assert calls == [
        (
            "POST",
            "http://workspaces.test/workspaces",
            "key",
            "user-1",
            None,
            {"name": "Demo Workspace", "slug": "demo"},
        ),
        (
            "POST",
            "http://workspaces.test/workspaces/demo/grants",
            "key",
            "user-1",
            None,
            {
                "subject_type": "agent",
                "subject_id": "agent-1",
                "role": "viewer",
                "display_name": "Research Agent",
                "display_slug": "research-agent",
                "expires_at": "2026-08-01T00:00:00Z",
            },
        ),
    ]


def test_search_workspaces_uses_backend_search_endpoint(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("params")))
        return [{"id": "workspace-1", "name": "Team Knowledge", "slug": "team-knowledge"}]

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    results = api.search("handoff", user_id="user-1")

    assert results[0].slug == "team-knowledge"
    assert calls == [
        ("GET", "http://workspaces.test/workspaces/search", "key", "user-1", None, {"q": "handoff", "vector": "true"}),
    ]


def test_search_files_uses_vector_by_default_and_can_disable(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("params")))
        return [
            {
                "id": "file-1",
                "workspace_id": "workspace-1",
                "path": "docs/brief.md",
                "display_name": "brief.md",
                "current_version_id": "version-1",
                "file_state": "processed",
                "upload_status": "uploaded",
                "processing_state": "processed",
                "match_reasons": ["vector"],
                "keyword_score": 0,
                "vector_score": 0.91,
                "score": 0.91,
            }
        ]

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    results = api.search_files("demo", "visual language", user_id="user-1")
    exact_results = api.search_files("demo", "visual language", user_id="user-1", vector=False)

    assert results[0].match_reasons == ["vector"]
    assert exact_results[0].score == 0.91
    assert calls == [
        (
            "GET",
            "http://workspaces.test/workspaces/demo/files/search",
            "key",
            "user-1",
            None,
            {"q": "visual language", "vector": "true"},
        ),
        (
            "GET",
            "http://workspaces.test/workspaces/demo/files/search",
            "key",
            "user-1",
            None,
            {"q": "visual language", "vector": "false"},
        ),
    ]


def test_update_delete_and_grant_lifecycle_payloads(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        if method == "PATCH":
            return {"id": "workspace-1", "name": kwargs["json"]["name"], "slug": kwargs["json"]["slug"]}
        if url.endswith("/grants") and method == "GET":
            return [
                {
                    "id": "grant-1",
                    "workspace_id": "workspace-1",
                    "subject_type": "agent",
                    "subject_id": "agent-1",
                    "role": "viewer",
                    "revoked_at": None,
                }
            ]
        return {"deleted": True}

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    updated = api.update("demo", name="Renamed", slug="renamed", user_id="user-1")
    grants = api.list_grants("renamed", user_id="user-1")
    revoked = api.revoke_grant("renamed", "grant-1", user_id="user-1")
    deleted = api.delete_workspace("renamed", user_id="user-1")

    assert updated.slug == "renamed"
    assert grants[0].revoked_at is None
    assert revoked == {"deleted": True}
    assert deleted == {"deleted": True}
    assert calls == [
        (
            "PATCH",
            "http://workspaces.test/workspaces/demo",
            "key",
            "user-1",
            None,
            {"name": "Renamed", "slug": "renamed"},
        ),
        ("GET", "http://workspaces.test/workspaces/renamed/grants", "key", "user-1", None, None),
        ("DELETE", "http://workspaces.test/workspaces/renamed/grants/grant-1", "key", "user-1", None, None),
        ("DELETE", "http://workspaces.test/workspaces/renamed", "key", "user-1", None, None),
    ]


def test_update_grant_sends_patch_and_explicit_null_expiry(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        return {
            "id": "grant-1",
            "workspace_id": "workspace-1",
            "subject_type": "agent",
            "subject_id": "agent-1",
            "role": kwargs["json"].get("role", "viewer"),
            "display_name": "Research Agent",
            "display_slug": "research-agent",
            "is_owner": False,
            "expires_at": kwargs["json"].get("expires_at"),
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    grant = api.update_grant(
        "team knowledge",
        "grant/#1",
        role="admin",
        expires_at=None,
        user_id="user-1",
    )

    assert grant.role == "admin"
    assert grant.expires_at is None
    assert grant.display_name == "Research Agent"
    assert grant.display_slug == "research-agent"
    assert grant.is_owner is False
    assert calls == [
        (
            "PATCH",
            "http://workspaces.test/workspaces/team%20knowledge/grants/grant%2F%231",
            "key",
            "user-1",
            None,
            {"role": "admin", "expires_at": None},
        )
    ]


def test_register_file_sends_keywords(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        return {
            "id": "file-1",
            "workspace_id": "workspace-1",
            "path": kwargs["json"]["path"],
            "display_name": "report.pdf",
            "current_version_id": "version-1",
            "file_state": "uploaded",
            "upload_status": "uploaded",
            "processing_state": "pending",
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    item = api.register_file(
        "demo",
        path="projects/example/report.pdf",
        source_content_type="application/pdf",
        source_size_bytes=123,
        source_sha256="a" * 64,
        source_etag="etag-1",
        keywords=["handoff", "launch"],
        user_id="user-1",
    )

    assert item.path == "projects/example/report.pdf"
    assert calls == [
        (
            "POST",
            "http://workspaces.test/workspaces/demo/files",
            "key",
            "user-1",
            None,
            {
                "path": "projects/example/report.pdf",
                "source_content_type": "application/pdf",
                "source_size_bytes": 123,
                "source_sha256": "a" * 64,
                "source_etag": "etag-1",
                "keywords": ["handoff", "launch"],
            },
        ),
    ]


def test_list_and_update_files_match_typescript_payloads(monkeypatch):
    calls = []
    file_data = {
        "id": "file-1",
        "workspace_id": "workspace-1",
        "path": "docs/research #1?.md",
        "display_name": "research.md",
        "current_version_id": "version-1",
        "file_state": "processed",
        "upload_status": "uploaded",
        "processing_state": "processed",
        "keywords": ["research"],
        "summary": "Research notes.",
    }

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, api_key, user_id, agent_id, kwargs.get("json")))
        if method == "GET":
            return [file_data]
        return {
            **file_data,
            "display_name": kwargs["json"]["display_name"],
            "keywords": kwargs["json"]["keywords"],
            "summary": kwargs["json"]["summary"],
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    files = api.list_files("team knowledge", agent_id="agent-1")
    updated = api.update_file(
        "team knowledge",
        "docs/research #1?.md",
        display_name="",
        keywords=[],
        summary=None,
        user_id="user-1",
    )

    assert files[0].summary == "Research notes."
    assert updated.display_name == ""
    assert updated.keywords == []
    assert updated.summary is None
    assert calls == [
        (
            "GET",
            "http://workspaces.test/workspaces/team%20knowledge/files",
            "key",
            None,
            "agent-1",
            None,
        ),
        (
            "PATCH",
            "http://workspaces.test/workspaces/team%20knowledge/files/docs/research%20%231%3F.md",
            "key",
            "user-1",
            None,
            {"display_name": "", "keywords": [], "summary": None},
        ),
    ]


def test_wait_until_processed_polls_file_state(monkeypatch):
    calls = []
    responses = [
        {
            "id": "file-1",
            "workspace_id": "workspace-1",
            "path": "projects/example/report.pdf",
            "display_name": "report.pdf",
            "current_version_id": "version-1",
            "file_state": "processing",
            "upload_status": "uploaded",
            "processing_state": "running",
        },
        {
            "id": "file-1",
            "workspace_id": "workspace-1",
            "path": "projects/example/report.pdf",
            "display_name": "report.pdf",
            "current_version_id": "version-1",
            "file_state": "processed",
            "upload_status": "uploaded",
            "processing_state": "processed",
        },
    ]

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, user_id, agent_id))
        return responses.pop(0)

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces.time.sleep", lambda _seconds: None)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    item = api.wait_until_processed(
        "demo",
        "projects/example/report.pdf",
        agent_id="agent-1",
        timeout=5,
        poll_interval=0,
    )

    assert item.file_state == "processed"
    assert item.processing_state == "processed"
    assert calls == [
        ("GET", "http://workspaces.test/workspaces/demo/files/projects/example/report.pdf", None, "agent-1"),
        ("GET", "http://workspaces.test/workspaces/demo/files/projects/example/report.pdf", None, "agent-1"),
    ]


def test_sync_manifest_writes_tomd_markdown(monkeypatch, tmp_path: Path):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        return {
            "workspace_id": "workspace-1",
            "workspace_name": "Demo Workspace",
            "workspace_slug": "demo",
            "snapshot_id": "snapshot-1",
            "generated_at": "2026-07-08T00:00:00Z",
            "base_path": "/home/node/workspaces/demo",
            "markdown_files": [
                {
                    "file_id": "file-1",
                    "path": "projects/example/report.pdf",
                    "version": 1,
                    "part_count": 1,
                    "keywords": ["handoff", "launch"],
                    "state": "processed",
                }
            ],
        }

    def fake_request_bytes(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        return b"---\npath: \"projects/example/report.pdf\"\n---\n\n# Report\n"

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces._request_bytes", fake_request_bytes)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    written = api.sync_manifest("demo", str(tmp_path), agent_id="agent-1")

    assert len(written) == 1
    target = tmp_path / "demo" / "projects" / "example" / "report.pdf.md"
    assert written == [str(target)]
    markdown = target.read_text()
    assert 'path: "projects/example/report.pdf"' in markdown
    assert "# Report" in markdown
    assert calls == [
        ("GET", "http://workspaces.test/workspaces/demo/manifest", None, "agent-1"),
        (
            "POST",
            "http://workspaces.test/workspaces/tomd",
            {"workspace": "demo", "path": "projects/example/report.pdf", "index": 1},
            "agent-1",
        ),
    ]


def test_sync_manifest_ready_only_skips_missing_markdown(monkeypatch, tmp_path: Path):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        return {
            "workspace_id": "workspace-1",
            "workspace_name": "Demo Workspace",
            "workspace_slug": "demo",
            "snapshot_id": "snapshot-1",
            "generated_at": "2026-07-08T00:00:00Z",
            "base_path": "/home/node/workspaces/demo",
            "markdown_files": [
                {
                    "file_id": "file-1",
                    "path": "projects/example/stale.pdf",
                    "version": 1,
                    "part_count": 1,
                    "state": "processed",
                }
            ],
        }

    def fake_request_bytes(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        raise APIError(404, "Workspace Markdown not found for projects/example/stale.pdf")

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces._request_bytes", fake_request_bytes)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    written = api.sync_manifest("demo", str(tmp_path), agent_id="agent-1", ready_only=True)

    assert written == []
    assert not (tmp_path / "demo" / "projects" / "example" / "stale.pdf.md").exists()
    assert calls == [
        ("GET", "http://workspaces.test/workspaces/demo/manifest", None, "agent-1"),
        (
            "POST",
            "http://workspaces.test/workspaces/tomd",
            {"workspace": "demo", "path": "projects/example/stale.pdf", "index": 1},
            "agent-1",
        ),
    ]


def test_markdown_file_finds_single_file(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        return {
            "workspace_id": "workspace-1",
            "workspace_name": "Demo Workspace",
            "workspace_slug": "demo",
            "snapshot_id": "snapshot-1",
            "generated_at": "2026-07-08T00:00:00Z",
            "base_path": "/home/node/workspaces/demo",
            "markdown_files": [
                {
                    "file_id": "file-1",
                    "path": "docs/source.md",
                    "version": 1,
                    "part_count": 1,
                    "state": "processed",
                }
            ],
        }

    def fake_request_bytes(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), agent_id))
        return b"---\npath: \"docs/source.md\"\n---\n\n# Source\n"

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    monkeypatch.setattr("hypercli.workspaces._request_bytes", fake_request_bytes)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    markdown_file, markdown = api.markdown_file("demo", "docs/source.md", agent_id="agent-1")

    assert markdown_file["path"] == "docs/source.md"
    assert 'path: "docs/source.md"' in markdown
    assert calls[-1] == (
        "POST",
        "http://workspaces.test/workspaces/tomd",
        {"workspace": "demo", "path": "docs/source.md", "index": 1},
        "agent-1",
    )
