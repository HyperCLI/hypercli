from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_status_command_outputs_compact_json(monkeypatch):
    class FakeClient:
        def status(self):
            return {
                "ok": False,
                "checked_at": "2026-06-16T10:00:00Z",
                "models": {"qwen3-tts": True},
                "clusters": {"large": False},
            }

    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["status", "--output", "json"])

    assert result.exit_code == 0
    assert '"qwen3-tts": true' in result.stdout
    assert '"large": false' in result.stdout
    assert "hostname" not in result.stdout
