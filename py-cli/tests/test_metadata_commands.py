from types import SimpleNamespace
from unittest.mock import Mock

from typer.testing import CliRunner
from hypercli_cli.cli import app
from hypercli_cli import metadata, persona, user


def test_dynamic_commands_use_metadata_and_canonical_soul(monkeypatch):
    client = Mock()
    client.deployments.resolve_agent_id.return_value = "agent"
    client.deployments.get.return_value = SimpleNamespace(id="agent", meta={"soul": "canonical", "persona": "selected"})
    client.deployments.update.return_value = SimpleNamespace(id="agent", meta={"persona": None})
    client.personas.resolve.return_value = {"soul": "effective", "user": {"profile": "profile"}}
    client.user.update_profile.return_value = {"id": "owner", "profile": "new profile"}
    for module in [metadata, persona, user]:
        monkeypatch.setattr(module, "HyperCLI", lambda: client)
    runner = CliRunner()
    result = runner.invoke(app, ["soul", "--agent", "agent"])
    assert result.exit_code == 0, result.output
    assert result.output == "canonical"
    result = runner.invoke(app, ["persona", "resolve", "--agent", "agent"])
    assert result.exit_code == 0, result.output
    assert "effective" in result.output
    result = runner.invoke(app, ["agents", "persona", "agent", "--clear"])
    assert result.exit_code == 0, result.output
    client.deployments.update.assert_called_with("agent", persona=None)
    result = runner.invoke(app, ["user", "profile", "-f", "-"], input="new profile")
    assert result.exit_code == 0, result.output
    client.user.update_profile.assert_called_once_with("new profile")
    assert not client.files.mock_calls


def test_selector_rejects_blank_and_value_with_clear_before_backend(monkeypatch):
    client = Mock()
    factory = Mock(return_value=client)
    monkeypatch.setattr(metadata, "HyperCLI", factory)
    runner = CliRunner()
    for args in [[""], ["  "], ["researcher", "--clear"], ["", "--clear"]]:
        result = runner.invoke(app, ["agents", "persona", "agent", *args])
        assert result.exit_code != 0, result.output
    factory.assert_not_called()
