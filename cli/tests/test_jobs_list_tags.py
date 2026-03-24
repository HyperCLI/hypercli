from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_jobs_list_passes_tags(monkeypatch):
    captured = {}

    class FakeJobs:
        def list_page(self, state=None, tags=None, page=None, page_size=None):
            captured["state"] = state
            captured["tags"] = tags
            captured["page"] = page
            captured["page_size"] = page_size
            return SimpleNamespace(jobs=[], total_count=0, page=page, page_size=page_size)

    fake_client = SimpleNamespace(jobs=FakeJobs())
    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(
        app,
        ["jobs", "list", "--state", "running", "--tag", "team=ml", "--tag", "env=prod"],
    )

    assert result.exit_code == 0
    assert captured == {
        "state": "running",
        "tags": {"team": "ml", "env": "prod"},
        "page": 1,
        "page_size": 50,
    }


def test_jobs_list_passes_backend_pagination(monkeypatch):
    captured = {}

    class FakeJobs:
        def list_page(self, state=None, tags=None, page=None, page_size=None):
            captured["page"] = page
            captured["page_size"] = page_size
            return SimpleNamespace(jobs=[], total_count=0, page=page, page_size=page_size)

    fake_client = SimpleNamespace(jobs=FakeJobs())
    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(app, ["jobs", "list", "--page", "3", "--page-size", "25"])

    assert result.exit_code == 0
    assert captured == {"page": 3, "page_size": 25}


def test_jobs_list_rejects_invalid_tag(monkeypatch):
    fake_client = SimpleNamespace(
        jobs=SimpleNamespace(
            list_page=lambda state=None, tags=None, page=None, page_size=None: SimpleNamespace(
                jobs=[], total_count=0, page=page, page_size=page_size
            )
        )
    )
    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(app, ["jobs", "list", "--tag", "broken"])

    assert result.exit_code == 1
    assert "Expected KEY=VALUE" in result.stdout
