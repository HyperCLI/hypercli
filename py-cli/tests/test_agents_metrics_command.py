import json

from typer.testing import CliRunner

from hypercli_cli import agents as agents_module
from hypercli_cli.cli import app


runner = CliRunner()


def test_agents_metrics_prints_container_usage(monkeypatch):
    calls = []

    class FakeDeployments:
        def metrics(self, agent_id):
            calls.append(agent_id)
            return {
                "event": "agent_metrics_result",
                "ok": True,
                "cpu": "25m",
                "memory": "128Mi",
                "timestamp": 1785508800,
            }

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "metrics", "demo"])

    assert result.exit_code == 0
    assert calls == ["demo"]
    assert "Agent Metrics" in result.stdout
    assert "reef" in result.stdout
    assert "25m" in result.stdout
    assert "128Mi" in result.stdout
    assert "1785508800" in result.stdout


def test_agents_metrics_supports_json_output(monkeypatch):
    payload = {
        "event": "agent_metrics_result",
        "ok": True,
        "cpu": "25m",
        "memory": "128Mi",
        "timestamp": 1785508800,
    }

    class FakeDeployments:
        def metrics(self, agent_id):
            return payload

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "metrics", "demo", "--json"])

    assert result.exit_code == 0
    assert json.loads(result.stdout) == payload


def test_agents_metrics_reports_operation_error(monkeypatch):
    class FakeDeployments:
        def metrics(self, agent_id):
            raise RuntimeError("metrics.k8s.io is unavailable")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "metrics", "demo"])

    assert result.exit_code == 1
    assert "Failed to get agent metrics" in result.stdout
    assert "metrics.k8s.io is unavailable" in result.stdout


def test_agents_metrics_reports_sdk_failure(monkeypatch):
    class FakeDeployments:
        def metrics(self, agent_id):
            raise RuntimeError("Agent is not running")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "metrics", "demo"])

    assert result.exit_code == 1
    assert "Failed to get agent metrics" in result.stdout
    assert "Agent is not running" in result.stdout
