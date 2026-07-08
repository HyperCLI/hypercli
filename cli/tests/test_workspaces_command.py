from pathlib import Path

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


class _FakeWorkspace:
    id = "workspace-1"
    name = "Demo Workspace"
    slug = "demo"
    description = None


class _FakeGrant:
    id = "grant-1"
    workspace_id = "workspace-1"
    subject_type = "agent"
    subject_id = "agent-1"
    role = "viewer"


class _FakeFile:
    id = "file-1"
    workspace_id = "workspace-1"
    path = "projects/example/report.pdf"
    display_name = "report.pdf"
    current_version_id = "version-1"
    file_state = "uploaded"
    upload_status = "uploaded"
    projection_status = "queued"


class _FakeDownloadUrl:
    file_id = "file-1"
    file_version_id = "version-1"
    source_path = "projects/example/report.pdf"
    source_s3_key = "test/workspaces/workspace-1/originals/file-1/version-1/report.pdf"
    s3_bucket = "hypercli-workspaces"
    s3_endpoint = "https://storage.streamformation.com"
    url = "https://download.example/report.pdf"
    download_command = "hyper workspaces download demo projects/example/report.pdf"


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
