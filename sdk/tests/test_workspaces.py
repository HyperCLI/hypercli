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


def test_sync_manifest_writes_tomd_projection(monkeypatch, tmp_path: Path):
    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        assert method == "GET"
        assert agent_id == "agent-1"
        return {
            "workspace_id": "workspace-1",
            "workspace_name": "Demo Workspace",
            "workspace_slug": "demo",
            "snapshot_id": "snapshot-1",
            "generated_at": "2026-07-08T00:00:00Z",
            "base_path": "/home/node/Workspaces/demo",
            "projections": [
                {
                    "file_id": "file-1",
                    "projection_id": "projection-1",
                    "source_path": "projects/example/report.pdf",
                    "projection_path": "projects/example/.tomd/report.md",
                    "source_sha256": "a" * 64,
                    "markdown_sha256": None,
                    "status": "queued",
                    "download_command": "hyper workspaces download demo projects/example/report.pdf --output report.pdf",
                }
            ],
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    written = api.sync_manifest("demo", str(tmp_path), agent_id="agent-1")

    assert len(written) == 1
    target = tmp_path / "demo" / "projects" / "example" / ".tomd" / "report.md"
    assert written == [str(target)]
    assert "download_command: hyper workspaces download demo projects/example/report.pdf --output report.pdf" in target.read_text()
