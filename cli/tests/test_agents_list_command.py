import json

from typer.testing import CliRunner

from hypercli_cli import agents as agents_module
from hypercli_cli.cli import app


runner = CliRunner()


def test_agents_ls_alias_uses_list_command(monkeypatch):
    calls = []

    class FakeDeployments:
        def list(self):
            calls.append("list")
            return []

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "ls", "--json"])

    assert result.exit_code == 0
    assert calls == ["list"]
    assert json.loads(result.stdout) == []
