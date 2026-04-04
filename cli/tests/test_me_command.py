from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_me_command_outputs_capabilities(monkeypatch):
    class FakeUserAPI:
        def auth_me(self):
            return SimpleNamespace(
                user_id="user-123",
                orchestra_user_id="orch-123",
                team_id="team-123",
                plan_id="pro",
                email="user@example.com",
                auth_type="orchestra_key",
                capabilities=["models:*", "voice:*"],
                key_id="key-123",
                key_name="runtime-key",
            )

    class FakeClient:
        user = FakeUserAPI()

    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["me"])

    assert result.exit_code == 0
    assert "models:*" in result.stdout
    assert "voice:*" in result.stdout
    assert "runtime-key" in result.stdout
