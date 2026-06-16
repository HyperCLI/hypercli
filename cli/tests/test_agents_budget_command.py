from typer.testing import CliRunner

from hypercli_cli import agents as agents_module
from hypercli_cli.cli import app


runner = CliRunner()


def test_agents_budget_uses_slot_inventory(monkeypatch):
    class FakeDeployments:
        def budget(self):
            return {
                "plan_id": "pro",
                "slots": {
                    "small": {"granted": 0, "used": 0, "available": 0},
                    "medium": {"granted": 0, "used": 0, "available": 0},
                    "large": {"granted": 2, "used": 0, "available": 2},
                },
                "pooled_tpd": 500_000_000,
                "size_presets": {
                    "small": {"cpu": 0.5, "memory": 4},
                    "medium": {"cpu": 1.0, "memory": 4},
                    "large": {"cpu": 2.0, "memory": 4},
                },
            }

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "budget"])

    assert result.exit_code == 0
    assert "Agents:  0/2 (2 available)" in result.stdout
    assert "large" in result.stdout
    assert "500,000,000 TPD" in result.stdout


def test_agents_budget_keeps_legacy_budget_shape(monkeypatch):
    class FakeDeployments:
        def budget(self):
            return {
                "plan_id": "basic",
                "budget": {"max_agents": 5, "total_cpu": 20, "total_memory": 80},
                "used": {"agents": 2, "cpu": 8, "memory": 16},
                "available": {"agents": 3, "cpu": 12, "memory": 64},
            }

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "budget"])

    assert result.exit_code == 0
    assert "Agents:  2/5 (3 available)" in result.stdout
    assert "CPU:     8/20 cores (12 available)" in result.stdout
