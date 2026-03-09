from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_jobs_list_passes_tags(monkeypatch):
    captured = {}

    class FakeJobs:
        def list(self, state=None, tags=None):
            captured["state"] = state
            captured["tags"] = tags
            return []

    fake_client = SimpleNamespace(jobs=FakeJobs())
    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(
        app,
        ["jobs", "list", "--state", "running", "--tag", "team=ml", "--tag", "env=prod"],
    )

    assert result.exit_code == 0
    assert captured == {"state": "running", "tags": {"team": "ml", "env": "prod"}}


def test_jobs_list_rejects_invalid_tag(monkeypatch):
    fake_client = SimpleNamespace(jobs=SimpleNamespace(list=lambda state=None, tags=None: []))
    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(app, ["jobs", "list", "--tag", "broken"])

    assert result.exit_code == 1
    assert "Expected KEY=VALUE" in result.stdout
