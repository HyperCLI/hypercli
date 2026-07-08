from pathlib import Path

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


class _FakeWorkspace:
    def __init__(self):
        self.id = "workspace-1"
        self.name = "Demo Workspace"
        self.slug = "demo"
        self.description = None


class _FakeGrant:
    def __init__(self):
        self.id = "grant-1"
        self.workspace_id = "workspace-1"
        self.subject_type = "agent"
        self.subject_id = "agent-1"
        self.role = "viewer"
        self.expires_at = None
        self.revoked_at = None


class _FakeFile:
    def __init__(self):
        self.id = "file-1"
        self.workspace_id = "workspace-1"
        self.path = "projects/example/report.pdf"
        self.display_name = "report.pdf"
        self.current_version_id = "version-1"
        self.file_state = "uploaded"
        self.upload_status = "uploaded"
        self.projection_status = "queued"


class _FakeDownloadUrl:
    def __init__(self):
        self.file_id = "file-1"
        self.file_version_id = "version-1"
        self.source_path = "projects/example/report.pdf"
        self.source_s3_key = "test/workspaces/workspace-1/originals/file-1/version-1/report.pdf"
        self.s3_bucket = "hypercli-workspaces"
        self.s3_endpoint = "https://storage.streamformation.com"
        self.url = "https://download.example/report.pdf"
        self.download_command = "hyper workspaces download demo projects/example/report.pdf --raw"


def test_workspaces_create_invokes_cli(monkeypatch):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def create(self, *, name, slug=None, description=None, user_id=None):
            captured.update({"name": name, "slug": slug, "description": description, "user_id": user_id})
            return _FakeWorkspace()

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    result = runner.invoke(app, ["workspaces", "create", "Demo Workspace", "--slug", "demo"])

    assert result.exit_code == 0, result.stdout
    assert captured == {"name": "Demo Workspace", "slug": "demo", "description": None, "user_id": None}


def test_workspaces_grant_agent_invokes_cli(monkeypatch):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def grant(self, workspace, *, subject_type, subject_id, role, user_id=None):
            captured.update(
                {
                    "workspace": workspace,
                    "subject_type": subject_type,
                    "subject_id": subject_id,
                    "role": role,
                    "user_id": user_id,
                }
            )
            return _FakeGrant()

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    result = runner.invoke(app, ["workspaces", "grant", "demo", "--agent-id", "agent-1"])

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "workspace": "demo",
        "subject_type": "agent",
        "subject_id": "agent-1",
        "role": "viewer",
        "user_id": None,
    }


def test_workspaces_update_delete_and_grants_invokes_cli(monkeypatch):
    import hypercli_cli.workspaces as workspaces_mod

    calls = []

    class _FakeWorkspaces:
        def update(self, workspace, *, name=None, slug=None, description=None, user_id=None):
            calls.append(("update", workspace, name, slug, description, user_id))
            item = _FakeWorkspace()
            item.name = name or item.name
            item.slug = slug or item.slug
            item.description = description
            return item

        def delete_workspace(self, workspace, *, user_id=None):
            calls.append(("delete_workspace", workspace, user_id))
            return {"deleted": True}

        def list_grants(self, workspace, *, user_id=None):
            calls.append(("list_grants", workspace, user_id))
            return [_FakeGrant()]

        def revoke_grant(self, workspace, grant_id, *, user_id=None):
            calls.append(("revoke_grant", workspace, grant_id, user_id))
            return {"revoked": True}

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    updated = runner.invoke(
        app,
        ["workspaces", "update", "demo", "--name", "Renamed", "--slug", "renamed", "--description", "Updated", "--user-id", "user-1"],
    )
    listed = runner.invoke(app, ["workspaces", "grants", "renamed", "--user-id", "user-1", "--output", "json"])
    revoked = runner.invoke(app, ["workspaces", "revoke-grant", "renamed", "grant-1", "--user-id", "user-1"])
    deleted = runner.invoke(app, ["workspaces", "delete", "renamed", "--user-id", "user-1"])

    assert updated.exit_code == 0, updated.stdout
    assert listed.exit_code == 0, listed.stdout
    assert revoked.exit_code == 0, revoked.stdout
    assert deleted.exit_code == 0, deleted.stdout
    assert calls == [
        ("update", "demo", "Renamed", "renamed", "Updated", "user-1"),
        ("list_grants", "renamed", "user-1"),
        ("revoke_grant", "renamed", "grant-1", "user-1"),
        ("delete_workspace", "renamed", "user-1"),
    ]
    assert '"grant-1"' in listed.stdout


def test_workspaces_register_file_and_download_url(monkeypatch):
    import hypercli_cli.workspaces as workspaces_mod

    calls = []

    class _FakeWorkspaces:
        def register_file(self, workspace, **kwargs):
            calls.append(("register_file", workspace, kwargs))
            return _FakeFile()

        def download_url(self, workspace, file_ref, **kwargs):
            calls.append(("download_url", workspace, file_ref, kwargs))
            return _FakeDownloadUrl()

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    registered = runner.invoke(
        app,
        [
            "workspaces",
            "register-file",
            "demo",
            "projects/example/report.pdf",
            "--sha256",
            "a" * 64,
            "--content-type",
            "application/pdf",
            "--size",
            "123",
        ],
    )
    downloaded = runner.invoke(app, ["workspaces", "download-url", "demo", "projects/example/report.pdf"])

    assert registered.exit_code == 0, registered.stdout
    assert downloaded.exit_code == 0, downloaded.stdout
    assert calls[0] == (
        "register_file",
        "demo",
        {
            "path": "projects/example/report.pdf",
            "source_filename": None,
            "source_content_type": "application/pdf",
            "source_size_bytes": 123,
            "source_sha256": "a" * 64,
            "source_etag": None,
            "user_id": None,
        },
    )
    assert calls[1][0:3] == ("download_url", "demo", "projects/example/report.pdf")
    assert "https://download.example/report.pdf" in downloaded.stdout


def test_workspaces_upload_invokes_cli(monkeypatch, tmp_path: Path):
    import hypercli_cli.workspaces as workspaces_mod

    source = tmp_path / "report.pdf"
    source.write_text("hello", encoding="utf-8")
    captured = {}

    class _FakeWorkspaces:
        def upload(self, workspace, file_path, *, workspace_path=None, user_id=None):
            captured.update(
                {
                    "workspace": workspace,
                    "file_path": file_path,
                    "workspace_path": workspace_path,
                    "user_id": user_id,
                }
            )
            return _FakeFile()

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    result = runner.invoke(
        app,
        ["workspaces", "upload", "demo", str(source), "--path", "projects/example/report.pdf", "--user-id", "user-1"],
    )

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "workspace": "demo",
        "file_path": str(source),
        "workspace_path": "projects/example/report.pdf",
        "user_id": "user-1",
    }


def test_workspaces_sync_invokes_cli(monkeypatch, tmp_path: Path):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def sync_manifest(self, workspace, output_dir, *, user_id=None, agent_id=None, ready_only=False):
            captured.update(
                {
                    "workspace": workspace,
                    "output_dir": output_dir,
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "ready_only": ready_only,
                }
            )
            return [str(tmp_path / "demo" / "projects" / "example" / ".tomd" / "report.md")]

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    result = runner.invoke(
        app,
        ["workspaces", "sync", "demo", "--agent-id", "agent-1", "--output-dir", str(tmp_path)],
    )

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "workspace": "demo",
        "output_dir": str(tmp_path),
        "user_id": None,
        "agent_id": "agent-1",
        "ready_only": False,
    }


def test_workspaces_sync_all_invokes_cli(monkeypatch, tmp_path: Path):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def sync_all(self, output_dir, *, user_id=None, agent_id=None, ready_only=False):
            captured.update(
                {
                    "output_dir": output_dir,
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "ready_only": ready_only,
                }
            )
            return {"demo": [str(tmp_path / "demo" / "projects" / "example" / ".tomd" / "report.md")]}

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    result = runner.invoke(
        app,
        ["workspaces", "sync", "--all", "--agent-id", "agent-1", "--output-dir", str(tmp_path), "--json"],
    )

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "output_dir": str(tmp_path),
        "user_id": None,
        "agent_id": "agent-1",
        "ready_only": False,
    }
    assert '"demo"' in result.stdout


def test_workspaces_download_writes_markdown_projection(monkeypatch, tmp_path: Path):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def projection_markdown(self, workspace, file_ref, *, user_id=None, agent_id=None):
            captured.update({"workspace": workspace, "file_ref": file_ref, "user_id": user_id, "agent_id": agent_id})
            return (
                {"source_path": "projects/example/report.pdf", "projection_path": "projects/example/.tomd/report.md"},
                '---\nsource_path: "projects/example/report.pdf"\ndownload_command: "hyper workspaces download demo projects/example/report.pdf --raw --output report.pdf"\n---\n',
            )

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())

    target = tmp_path / "report.md"
    result = runner.invoke(
        app,
        ["workspaces", "download", "demo", "projects/example/report.pdf", "--agent-id", "agent-1", "--output", str(target)],
    )

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "workspace": "demo",
        "file_ref": "projects/example/report.pdf",
        "user_id": None,
        "agent_id": "agent-1",
    }
    assert 'download_command: "hyper workspaces download demo projects/example/report.pdf --raw --output report.pdf"' in target.read_text()


def test_workspaces_download_raw_fetches_original(monkeypatch, tmp_path: Path):
    import hypercli_cli.workspaces as workspaces_mod

    captured = {}

    class _FakeWorkspaces:
        def download_url(self, workspace, file_ref, *, user_id=None, agent_id=None):
            captured.update({"workspace": workspace, "file_ref": file_ref, "user_id": user_id, "agent_id": agent_id})
            return _FakeDownloadUrl()

    class _FakeResponse:
        content = b"raw-pdf"

        def raise_for_status(self):
            return None

    class _FakeHttpClient:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def get(self, url):
            assert url == "https://download.example/report.pdf"
            return _FakeResponse()

    monkeypatch.setattr(workspaces_mod, "_get_workspaces", lambda: _FakeWorkspaces())
    monkeypatch.setattr(workspaces_mod.httpx, "Client", _FakeHttpClient)

    target = tmp_path / "report.pdf"
    result = runner.invoke(
        app,
        ["workspaces", "download", "demo", "projects/example/report.pdf", "--raw", "--agent-id", "agent-1", "--output", str(target)],
    )

    assert result.exit_code == 0, result.stdout
    assert captured == {
        "workspace": "demo",
        "file_ref": "projects/example/report.pdf",
        "user_id": None,
        "agent_id": "agent-1",
    }
    assert target.read_bytes() == b"raw-pdf"
