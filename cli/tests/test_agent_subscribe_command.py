from __future__ import annotations

import json
from types import SimpleNamespace

from typer.testing import CliRunner

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
        assert plan_id == "1aiu"
        assert amount == "0.01"
        return {
            "key": "hyper_api_test",
            "plan_id": "1aiu",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "1aiu", "0.01", "--passphrase", "secret"])

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
        assert plan_id == "1aiu"
        assert amount == "0.01"
        assert api_base == "https://api.dev.hypercli.com"
        return {
            "key": "hyper_api_test",
            "plan_id": "1aiu",
            "amount_paid": "0.010000",
            "duration_days": 0.5,
            "expires_at": "2026-04-14T00:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }

    monkeypatch.setattr("hypercli_cli.wallet.load_wallet", _fake_load_wallet)
    monkeypatch.setattr(agent_mod.asyncio, "run", lambda coro: coro)
    monkeypatch.setattr(agent_mod, "_subscribe_async", _fake_subscribe_async)

    result = runner.invoke(app, ["agent", "subscribe", "1aiu", "0.01"])

    assert result.exit_code == 0


def test_extract_plan_purchase_url_from_agent_discovery():
    discovery = {
        "resources": [
            "https://api.dev.hypercli.com/agents/x402/1aiu",
            "https://api.dev.hypercli.com/agents/x402/2aiu",
        ]
    }

    assert (
        agent_mod._extract_plan_purchase_url_from_discovery(discovery, "1aiu")
        == "https://api.dev.hypercli.com/agents/x402/1aiu"
    )


def test_extract_plan_purchase_url_from_discovery_ignores_nonmatching_resources():
    discovery = {
        "resources": [
            "https://api.dev.hypercli.com/api/x402/top_up",
            "https://api.dev.hypercli.com/api/x402/job",
        ]
    }

    assert agent_mod._extract_plan_purchase_url_from_discovery(discovery, "1aiu") is None
