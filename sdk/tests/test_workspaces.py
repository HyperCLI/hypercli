from pathlib import Path

from hypercli.workspaces import WorkspacesAPI, _derive_workspaces_base


def test_workspaces_base_derives_from_agents_base(monkeypatch):
    monkeypatch.delenv("HYPER_WORKSPACES_API_BASE", raising=False)

    assert (
        _derive_workspaces_base("https://api.agents.dev.hypercli.com/agents")
        == "https://api.agents.dev.hypercli.com/workspaces"
    )


def test_workspaces_base_uses_explicit_env(monkeypatch):
    monkeypatch.setenv("HYPER_WORKSPACES_API_BASE", "http://127.0.0.1:18080/workspaces")

    assert _derive_workspaces_base("https://ignored.example/agents") == "http://127.0.0.1:18080/workspaces"


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
            }
        return {"id": "workspace-1", "name": kwargs["json"]["name"], "slug": kwargs["json"]["slug"]}

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    workspace = api.create(name="Demo Workspace", slug="demo", user_id="user-1")
    grant = api.grant("demo", subject_type="agent", subject_id="agent-1", role="viewer", user_id="user-1")

    assert workspace.slug == "demo"
    assert grant.subject_id == "agent-1"
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
            {"subject_type": "agent", "subject_id": "agent-1", "role": "viewer"},
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
            "base_path": "/home/node/Workspaces/demo",
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
            "base_path": "/home/node/Workspaces/demo",
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
