from __future__ import annotations

import json
from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli.agents import Agent
from hypercli_cli.cli import app
import hypercli_cli.agent as agent_mod


runner = CliRunner()


def test_agent_subscribe_passes_explicit_passphrase(monkeypatch, tmp_path):
    hypercli_dir = tmp_path / ".hypercli"
    monkeypatch.setattr(agent_mod, "HYPERCLI_DIR", hypercli_dir)
    monkeypatch.setattr(agent_mod, "AGENT_KEY_PATH", hypercli_dir / "agent-key.json")
    monkeypatch.setattr(agent_mod, "X402_AVAILABLE", True)

    load_calls: list[str | None] = []

    def _fake_load_wallet(*, passphrase=None):
        load_calls.append(passphrase)
        return SimpleNamespace(address="0xabc")

    def _fake_subscribe_async(account, plan_id: str, api_base: str, amount: str | None = None):
        assert account.address == "0xabc"
        assert plan_id == "solo"
        assert amount == "0.01"
        return {
            "key": "hyper_api_test",
            "plan_id": "solo",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "solo", "0.01", "--passphrase", "secret"])

    assert result.exit_code == 0
    assert load_calls == ["secret"]
    saved = json.loads((hypercli_dir / "agent-key.json").read_text())
    assert saved["key"] == "hyper_api_test"


def test_agent_subscribe_uses_product_api_base_env(monkeypatch, tmp_path):
    hypercli_dir = tmp_path / ".hypercli"
    monkeypatch.setattr(agent_mod, "HYPERCLI_DIR", hypercli_dir)
    monkeypatch.setattr(agent_mod, "AGENT_KEY_PATH", hypercli_dir / "agent-key.json")
    monkeypatch.setattr(agent_mod, "X402_AVAILABLE", True)
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    def _fake_load_wallet(*, passphrase=None):
        assert passphrase is None
        return SimpleNamespace(address="0xabc")

    def _fake_subscribe_async(account, plan_id: str, api_base: str, amount: str | None = None):
        assert account.address == "0xabc"
        assert plan_id == "solo"
        assert amount == "0.01"
        assert api_base == "https://api.dev.hypercli.com"
        return {
            "key": "hyper_api_test",
            "plan_id": "solo",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "solo", "0.01"])

    assert result.exit_code == 0


def test_resolve_x402_timeout(monkeypatch):
    monkeypatch.delenv("HYPERCLI_X402_TIMEOUT", raising=False)
    assert agent_mod._resolve_x402_timeout() == agent_mod.DEFAULT_X402_TIMEOUT_SECONDS

    monkeypatch.setenv("HYPERCLI_X402_TIMEOUT", "90")
    assert agent_mod._resolve_x402_timeout() == 90

    monkeypatch.setenv("HYPERCLI_X402_TIMEOUT", "")
    assert agent_mod._resolve_x402_timeout() == agent_mod.DEFAULT_X402_TIMEOUT_SECONDS

    monkeypatch.setenv("HYPERCLI_X402_TIMEOUT", "not-a-number")
    assert agent_mod._resolve_x402_timeout() == agent_mod.DEFAULT_X402_TIMEOUT_SECONDS

    monkeypatch.setenv("HYPERCLI_X402_TIMEOUT", "0")
    assert agent_mod._resolve_x402_timeout() == agent_mod.DEFAULT_X402_TIMEOUT_SECONDS


def test_extract_plan_purchase_url_from_agent_discovery():
    discovery = {
        "resources": [
            "https://api.dev.hypercli.com/agents/x402/solo",
            "https://api.dev.hypercli.com/agents/x402/team",
        ]
    }

    assert (
        agent_mod._extract_plan_purchase_url_from_discovery(discovery, "solo")
        == "https://api.dev.hypercli.com/agents/x402/solo"
    )


def test_extract_plan_purchase_url_from_discovery_ignores_nonmatching_resources():
    discovery = {
        "resources": [
            "https://api.dev.hypercli.com/api/x402/top_up",
            "https://api.dev.hypercli.com/api/x402/job",
        ]
    }

    assert agent_mod._extract_plan_purchase_url_from_discovery(discovery, "solo") is None


def test_agent_activate_code_redeems_via_sdk(monkeypatch):
    class _FakeAgent:
        def redeem_grant_code(self, code: str, **kwargs):
            assert code == "promo-123"
            assert kwargs == {"extend_existing": None}
            return {
                "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": "promo-123", "plan_id": "solo"},
                "entitlement": {
                    "id": "ent-1",
                    "plan_id": "solo",
                    "plan_name": "Basic",
                    "starts_at": "2026-04-27T00:00:00Z",
                    "expires_at": "2026-05-27T00:00:00Z",
                    "tags": ["customer=acme"],
                },
            }

    class _FakeClient:
        agent = _FakeAgent()

    monkeypatch.setattr(agent_mod, "_get_agent_query_client", lambda dev: _FakeClient())

    result = runner.invoke(app, ["agent", "activate-code", "promo-123"])

    assert result.exit_code == 0
    assert "HyperCLI Code Activated" in result.output
    assert "promo-123" in result.output
    assert "Basic" in result.output


def test_agent_activate_code_can_request_extension(monkeypatch):
    calls = []

    class _FakeAgent:
        def redeem_grant_code(self, code: str, **kwargs):
            calls.append((code, kwargs))
            return {
                "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": code, "plan_id": "solo"},
                "entitlement": {
                    "id": "ent-1",
                    "plan_id": "solo",
                    "plan_name": "Basic",
                    "starts_at": "2026-04-27T00:00:00Z",
                    "expires_at": "2026-05-27T00:00:00Z",
                    "tags": [],
                },
            }

    class _FakeClient:
        agent = _FakeAgent()

    monkeypatch.setattr(agent_mod, "_get_agent_query_client", lambda dev: _FakeClient())

    result = runner.invoke(app, ["agent", "activate-code", "promo-123", "--extend-existing"])

    assert result.exit_code == 0
    assert calls == [("promo-123", {"extend_existing": True})]


def test_agent_subscription_summary_json_includes_additive_direct_entitlements(monkeypatch):
    summary = SimpleNamespace(
        has_active_plan=True,
        effective_plan_id="team",
        current_subscription_id="sub-team",
        current_entitlement_id="ent-team",
        pooled_tpm_limit=2_604_150,
        pooled_rpm_limit=259,
        pooled_tpd=75_000_000,
        slot_inventory={
            "small": {"granted": 1, "used": 0, "available": 1},
            "medium": {"granted": 3, "used": 0, "available": 3},
        },
        billing_reset_at=None,
        active_subscription_count=1,
        active_entitlement_count=2,
        entitlements=SimpleNamespace(active_entitlement_count=2),
        entitlement_items=[
            SimpleNamespace(plan_id="team", subscription_id="sub-team"),
            SimpleNamespace(plan_id="solo", subscription_id=None),
        ],
        agent_slots=[
            SimpleNamespace(size="medium"),
            SimpleNamespace(size="medium"),
            SimpleNamespace(size="medium"),
            SimpleNamespace(size="small"),
        ],
        active_subscriptions=[],
        subscriptions=[],
        user={"id": "user-1"},
    )

    class _FakeAgent:
        def subscription_summary(self):
            return summary

    class _FakeClient:
        agent = _FakeAgent()

    monkeypatch.setattr(agent_mod, "_get_agent_query_client", lambda dev: _FakeClient())

    result = runner.invoke(app, ["agent", "subscription-summary", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["has_active_plan"] is True
    assert payload["effective_plan_id"] == "team"
    assert payload["active_entitlement_count"] == 2
    assert payload["entitlements"]["active_entitlement_count"] == 2
    assert [item["plan_id"] for item in payload["entitlement_items"]] == ["team", "solo"]
    assert [slot["size"] for slot in payload["agent_slots"]] == ["medium", "medium", "medium", "small"]


def test_agent_enable_attaches_slack_relay_without_restart(monkeypatch):
    calls: list[tuple[str, object]] = []

    class _FakeDeployments:
        def get(self, agent):
            calls.append(("get", agent))
            return Agent(
                id="11111111-1111-4111-8111-111111111111",
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="RUNNING",
            )

        def attach_slack_relay_agent(self, agent_id, *, relay_base_url):
            calls.append(("attach", (agent_id, relay_base_url)))
            return {
                "connected": True,
                "gateway_id": f"agent:{agent_id}",
                "team_name": "HyperCLI",
                "restart_required": True,
            }

    monkeypatch.setattr(agent_mod, "_get_deployments_client", lambda dev=False: _FakeDeployments())

    result = runner.invoke(app, ["agent", "enable", "clear-window-works", "--relay-base-url", "https://relay.test"])

    assert result.exit_code == 0
    assert calls == [
        ("get", "clear-window-works"),
        ("attach", ("11111111-1111-4111-8111-111111111111", "https://relay.test")),
    ]
    assert "Slack enabled for" in result.output
    assert "Restart:    required" in result.output


def test_agent_start_alias_starts_by_name(monkeypatch):
    calls: list[tuple[str, object]] = []

    class _FakeDeployments:
        def get(self, agent):
            calls.append(("get", agent))
            return Agent(
                id="11111111-1111-4111-8111-111111111111",
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="STOPPED",
            )

        def start(self, agent_id, *, dry_run=False):
            calls.append(("start", (agent_id, dry_run)))
            return Agent(
                id=agent_id,
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="PENDING",
            )

    monkeypatch.setattr(agent_mod, "_get_deployments_client", lambda dev=False: _FakeDeployments())

    result = runner.invoke(app, ["agent", "start", "clear-window-works"])

    assert result.exit_code == 0
    assert calls == [
        ("get", "clear-window-works"),
        ("start", ("11111111-1111-4111-8111-111111111111", False)),
    ]
    assert "Agent starting" in result.output


def test_agent_stop_alias_stops_by_name(monkeypatch):
    calls: list[tuple[str, object]] = []

    class _FakeDeployments:
        def get(self, agent):
            calls.append(("get", agent))
            return Agent(
                id="11111111-1111-4111-8111-111111111111",
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="RUNNING",
            )

        def stop(self, agent_id):
            calls.append(("stop", agent_id))
            return Agent(
                id=agent_id,
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="STOPPING",
            )

    monkeypatch.setattr(agent_mod, "_get_deployments_client", lambda dev=False: _FakeDeployments())

    result = runner.invoke(app, ["agent", "stop", "clear-window-works", "--force"])

    assert result.exit_code == 0
    assert calls == [
        ("get", "clear-window-works"),
        ("stop", "11111111-1111-4111-8111-111111111111"),
    ]
    assert "Agent stopping" in result.output
    assert "State: STOPPING" in result.output


def test_agent_stop_waits_for_cleanup_before_reporting_stopped(monkeypatch):
    calls: list[tuple[str, object]] = []

    class _FakeDeployments:
        def get(self, agent):
            calls.append(("get", agent))
            state = "RUNNING" if len(calls) == 1 else "STOPPED"
            return Agent(
                id="11111111-1111-4111-8111-111111111111",
                user_id="user-1",
                pod_id="pod-1" if state == "RUNNING" else "",
                pod_name="clear-window-works",
                name="clear-window-works",
                state=state,
            )

        def stop(self, agent_id):
            calls.append(("stop", agent_id))
            return Agent(
                id=agent_id,
                user_id="user-1",
                pod_id="pod-1",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="STOPPING",
            )

        def wait_for_state(self, agent_id, states, *, timeout):
            calls.append(("wait_for_state", (agent_id, states, timeout)))
            return Agent(
                id=agent_id,
                user_id="user-1",
                pod_id="",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="STOPPED",
            )

    monkeypatch.setattr(agent_mod, "_get_deployments_client", lambda dev=False: _FakeDeployments())
    monkeypatch.setattr(agent_mod.time, "sleep", lambda _seconds: None)

    result = runner.invoke(
        app,
        ["agent", "stop", "clear-window-works", "--force", "--wait"],
    )

    assert result.exit_code == 0
    assert calls == [
        ("get", "clear-window-works"),
        ("stop", "11111111-1111-4111-8111-111111111111"),
        (
            "wait_for_state",
            ("11111111-1111-4111-8111-111111111111", {"stopped"}, 900.0),
        ),
    ]
    assert "Agent stopped" in result.output
    assert "State: STOPPED" in result.output
