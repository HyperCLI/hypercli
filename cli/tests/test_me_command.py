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
                external_id="did:privy:privy-123",
                privy_user_id="did:privy:privy-123",
                wallet_address="0x1111111111111111111111111111111111111111",
                team_id="team-123",
                plan_id="pro",
                email="user@example.com",
                user_type="paid",
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
    assert "external_id" in result.stdout
    assert "did:privy:privy-123" in result.stdout
    assert "wallet_address" in result.stdout
    assert "runtime-key" in result.stdout


def test_me_command_outputs_agents_entitlement_summary(monkeypatch):
    class FakeUserAPI:
        def auth_me(self):
            return SimpleNamespace(
                user_id="user-123",
                orchestra_user_id=None,
                external_id="did:privy:privy-123",
                privy_user_id="did:privy:privy-123",
                wallet_address="0x1111111111111111111111111111111111111111",
                team_id="",
                plan_id="",
                email=None,
                user_type="paid",
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
                has_active_plan=True,
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
                external_id="did:privy:privy-123",
                privy_user_id="did:privy:privy-123",
                wallet_address="0x1111111111111111111111111111111111111111",
                team_id="",
                plan_id="",
                email=None,
                user_type="paid",
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
                has_active_plan=True,
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
    assert payload["external_id"] == "did:privy:privy-123"
    assert payload["privy_user_id"] == "did:privy:privy-123"
    assert payload["wallet_address"] == "0x1111111111111111111111111111111111111111"
    entitlements = payload["agents_entitlements"]
    assert entitlements["billing_reset_at"] == billing_reset_at.isoformat()
    assert entitlements["entitlement_items"][0]["expires_at"] == expires_at.isoformat()


def _auth_me_stub():
    return SimpleNamespace(
        user_id="user-123",
        orchestra_user_id="orch-123",
        external_id=None,
        privy_user_id=None,
        wallet_address=None,
        team_id="team-123",
        plan_id="pro",
        email=None,
        user_type="paid",
        auth_type="orchestra_key",
        capabilities=["models:*"],
        key_id="key-123",
        key_name="runtime-key",
    )


def _client_with_identity(identity):
    class FakeUserAPI:
        def auth_me(self):
            return _auth_me_stub()

    class FakeDeployments:
        def access_identity(self):
            if isinstance(identity, Exception):
                raise identity
            return identity

    class FakeClient:
        user = FakeUserAPI()
        deployments = FakeDeployments()

    return FakeClient


def test_me_command_shows_agent_identity_for_a_runtime_key(monkeypatch):
    from hypercli import AgentAccessIdentity

    agent_id = "11111111-1111-4111-8111-111111111111"
    identity = AgentAccessIdentity(
        user_id="user-123",
        auth_type="orchestra_key",
        agent_id=agent_id,
        capabilities=["agents:self"],
    )
    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", _client_with_identity(identity))

    result = runner.invoke(app, ["me"])
    assert result.exit_code == 0
    assert "agent_id" in result.stdout
    assert agent_id in result.stdout

    json_result = runner.invoke(app, ["me", "--output", "json"])
    assert json_result.exit_code == 0
    payload = json.loads(json_result.stdout)
    assert payload["agent_id"] == agent_id
    assert payload["agent_capabilities"] == ["agents:self"]


def test_me_command_output_is_unchanged_for_a_non_runtime_key(monkeypatch):
    from hypercli import AgentAccessIdentity

    user_identity = AgentAccessIdentity(user_id="user-123", auth_type="user")
    monkeypatch.setattr("hypercli_cli.cli.HyperCLI", _client_with_identity(user_identity))
    owner = runner.invoke(app, ["me", "--output", "json"])

    monkeypatch.setattr(
        "hypercli_cli.cli.HyperCLI",
        _client_with_identity(RuntimeError("agents introspection unavailable")),
    )
    degraded = runner.invoke(app, ["me", "--output", "json"])

    assert owner.exit_code == 0 and degraded.exit_code == 0
    assert owner.stdout == degraded.stdout
    payload = json.loads(owner.stdout)
    assert "agent_id" not in payload
    assert "agent_capabilities" not in payload
