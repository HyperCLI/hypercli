from datetime import datetime, timezone
import json
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


def test_me_command_outputs_agents_entitlement_summary(monkeypatch):
    class FakeUserAPI:
        def auth_me(self):
            return SimpleNamespace(
                user_id="user-123",
                orchestra_user_id=None,
                team_id="",
                plan_id="",
                email=None,
                auth_type="api_key",
                capabilities=["*:*"],
                has_active_subscription=False,
                key_id="key-123",
                key_name="gpu-operator-prod",
            )

    class FakeAgentAPI:
        def subscription_summary(self):
            return SimpleNamespace(
                effective_plan_id="pro",
                current_subscription_id=None,
                current_entitlement_id="ent-123",
                active_subscription_count=0,
                active_entitlement_count=1,
                pooled_tpm_limit=17_361_100,
                pooled_rpm_limit=1_736,
                pooled_tpd=500_000_000,
                billing_reset_at=None,
                entitlement_items=[
                    SimpleNamespace(
                        plan_id="pro",
                        status="ACTIVE",
                        expires_at=datetime(2036, 5, 16, 11, 36, 49, tzinfo=timezone.utc),
                    )
                ],
            )

    class FakeClient:
        user = FakeUserAPI()
        agent = FakeAgentAPI()

    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["me"])

    assert result.exit_code == 0
    assert "has_active_subscription" in result.stdout
    assert "no" in result.stdout
    assert "agents_effective_plan" in result.stdout
    assert "pro" in result.stdout
    assert "agents_time_left" in result.stdout
    assert "17,361,100 TPM / 1,736 RPM / 500,000,000 TPD" in result.stdout


def test_me_command_json_serializes_agents_entitlement_datetimes(monkeypatch):
    expires_at = datetime(2036, 5, 16, 11, 36, 49, tzinfo=timezone.utc)
    billing_reset_at = datetime(2036, 5, 1, 0, 0, tzinfo=timezone.utc)

    class FakeUserAPI:
        def auth_me(self):
            return SimpleNamespace(
                user_id="user-123",
                orchestra_user_id=None,
                team_id="",
                plan_id="",
                email=None,
                auth_type="api_key",
                capabilities=["*:*"],
                has_active_subscription=False,
                key_id="key-123",
                key_name="gpu-operator-prod",
            )

    class FakeAgentAPI:
        def subscription_summary(self):
            return SimpleNamespace(
                effective_plan_id="pro",
                current_subscription_id=None,
                current_entitlement_id="ent-123",
                active_subscription_count=0,
                active_entitlement_count=1,
                pooled_tpm_limit=17_361_100,
                pooled_rpm_limit=1_736,
                pooled_tpd=500_000_000,
                billing_reset_at=billing_reset_at,
                entitlement_items=[
                    SimpleNamespace(
                        plan_id="pro",
                        status="ACTIVE",
                        expires_at=expires_at,
                    )
                ],
            )

    class FakeClient:
        user = FakeUserAPI()
        agent = FakeAgentAPI()

    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["me", "--output", "json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    entitlements = payload["agents_entitlements"]
    assert entitlements["billing_reset_at"] == billing_reset_at.isoformat()
    assert entitlements["entitlement_items"][0]["expires_at"] == expires_at.isoformat()
