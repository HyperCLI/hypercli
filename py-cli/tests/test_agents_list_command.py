import json

from typer.testing import CliRunner

from hypercli_cli import agents as agents_module
from hypercli_cli.cli import app


runner = CliRunner()


def test_agents_ls_alias_uses_list_command(monkeypatch):
    calls = []

    class FakeDeployments:
        def list(self, **kwargs):
            calls.append(kwargs)
            return []

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "ls", "--json"])

    assert result.exit_code == 0
    assert calls == [{
        "state": None,
        "handle": None,
        "name": None,
        "query": None,
        "include_deleted": False,
    }]
    assert json.loads(result.stdout) == []


def test_agents_list_passes_all_server_filters(monkeypatch):
    calls = []

    class FakeDeployments:
        def list(self, **kwargs):
            calls.append(kwargs)
            return []

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, [
        "agents", "list", "--json",
        "--state", "STOPPED",
        "--handle", "relay-smoke",
        "--name", "relay-agent",
        "--query", "agent-id-prefix",
        "--include-deleted",
    ])

    assert result.exit_code == 0
    assert calls == [{
        "state": "STOPPED",
        "handle": "relay-smoke",
        "name": "relay-agent",
        "query": "agent-id-prefix",
        "include_deleted": True,
    }]
