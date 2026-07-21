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
        assert plan_id == "basic"
        assert amount == "0.01"
        return {
            "key": "hyper_api_test",
            "plan_id": "basic",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "basic", "0.01", "--passphrase", "secret"])

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
        assert plan_id == "basic"
        assert amount == "0.01"
        assert api_base == "https://api.dev.hypercli.com"
        return {
            "key": "hyper_api_test",
            "plan_id": "basic",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "basic", "0.01"])

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
            "https://api.dev.hypercli.com/agents/x402/basic",
            "https://api.dev.hypercli.com/agents/x402/plus",
        ]
    }

    assert (
        agent_mod._extract_plan_purchase_url_from_discovery(discovery, "basic")
        == "https://api.dev.hypercli.com/agents/x402/basic"
    )


def test_extract_plan_purchase_url_from_discovery_ignores_nonmatching_resources():
    discovery = {
        "resources": [
            "https://api.dev.hypercli.com/api/x402/top_up",
            "https://api.dev.hypercli.com/api/x402/job",
        ]
    }

    assert agent_mod._extract_plan_purchase_url_from_discovery(discovery, "basic") is None


def test_agent_activate_code_redeems_via_sdk(monkeypatch):
    class _FakeAgent:
        def redeem_grant_code(self, code: str, **kwargs):
            assert code == "promo-123"
            assert kwargs == {"extend_existing": None}
            return {
                "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": "promo-123", "plan_id": "basic"},
                "entitlement": {
                    "id": "ent-1",
                    "plan_id": "basic",
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
                "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": code, "plan_id": "basic"},
                "entitlement": {
                    "id": "ent-1",
                    "plan_id": "basic",
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
                state="STARTING",
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
                state="STOPPED",
            )

    monkeypatch.setattr(agent_mod, "_get_deployments_client", lambda dev=False: _FakeDeployments())

    result = runner.invoke(app, ["agent", "stop", "clear-window-works", "--force"])

    assert result.exit_code == 0
    assert calls == [
        ("get", "clear-window-works"),
        ("stop", "11111111-1111-4111-8111-111111111111"),
    ]
    assert "Agent stopped" in result.output
