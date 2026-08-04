from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path

import pytest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2]
    / ".github"
    / "scripts"
    / "bootstrap_agents_e2e_user.py"
)
SPEC = importlib.util.spec_from_file_location("bootstrap_agents_e2e_user", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_new_agents_e2e_identity_is_fresh_and_uuid_backed() -> None:
    first = MODULE._new_test_identity("Agents Subscription")
    second = MODULE._new_test_identity("Agents Subscription")

    assert first != second
    assert str(uuid.UUID(first.orchestra_user_id)) == first.orchestra_user_id
    assert str(uuid.UUID(second.orchestra_user_id)) == second.orchestra_user_id
    assert first.email.startswith("agents-subscription-")
    assert first.email.endswith("@example.com")


def test_bootstrap_creates_unpaid_projections_without_seeding_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid.uuid4())
    identity = MODULE.TestIdentity(user_id, "agents-subscription-fresh@example.com")
    calls: list[tuple[str, str, dict[str, object] | None]] = []

    monkeypatch.setenv("BACKEND_API_KEY", "admin-key")
    monkeypatch.setenv("TEST_API_BASE_URL", "https://api.dev.hypercli.com")
    monkeypatch.setattr(MODULE, "_new_test_identity", lambda suite: identity)

    def fake_request(method, url, *, json_body=None, **kwargs):
        calls.append((method, url, json_body))
        if url == "https://api.agents.dev.hypercli.com/admin/users":
            return MODULE.Response(200, {"id": user_id}, "")
        return MODULE.Response(200, {"user_id": user_id}, "")

    monkeypatch.setattr(MODULE, "_request", fake_request)

    state = MODULE.bootstrap()

    assert state.orchestra_user_id == user_id
    assert state.hyperclaw_user_id == user_id
    assert calls == [
        (
            "POST",
            "https://api.dev.hypercli.com/api/admin/users",
            {"user_id": user_id, "email": identity.email, "user_type": "PAID"},
        ),
        (
            "POST",
            "https://api.agents.dev.hypercli.com/admin/users",
            {
                "user_id": user_id,
                "external_id": user_id,
                "orchestra_user_id": user_id,
                "email": identity.email,
            },
        ),
    ]
    assert all("topup" not in url and "/billing/" not in url for _, url, _ in calls)


def test_cleanup_attempts_both_projections_when_hyperclaw_delete_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid.uuid4())
    state = MODULE.BootstrapState(
        orchestra_api_base="https://api.dev.hypercli.com/api",
        agents_admin_base="https://api.agents.dev.hypercli.com",
        orchestra_user_id=user_id,
        hyperclaw_user_id=user_id,
        email="fresh@example.com",
    )
    calls: list[str] = []

    def fake_request(method, url, **kwargs):
        calls.append(url)
        if "api.agents.dev" in url:
            raise RuntimeError("agents delete failed")
        return MODULE.Response(200, {"deleted": True}, "")

    monkeypatch.setattr(MODULE, "_request", fake_request)

    errors = MODULE.cleanup(state, admin_key="admin-key")

    assert calls == [
        f"https://api.agents.dev.hypercli.com/admin/users/{user_id}",
        f"https://api.dev.hypercli.com/api/admin/users/{user_id}",
    ]
    assert errors == ["HyperClaw cleanup failed: agents delete failed"]


def test_partial_bootstrap_failure_removes_orchestra_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid.uuid4())
    identity = MODULE.TestIdentity(user_id, "agents-subscription-partial@example.com")
    calls: list[tuple[str, str]] = []

    monkeypatch.setenv("BACKEND_API_KEY", "admin-key")
    monkeypatch.setenv("TEST_API_BASE_URL", "https://api.dev.hypercli.com")
    monkeypatch.setattr(MODULE, "_new_test_identity", lambda suite: identity)

    def fake_request(method, url, **kwargs):
        calls.append((method, url))
        if method == "POST" and "api.agents.dev" in url:
            raise RuntimeError("agents create failed")
        return MODULE.Response(200, {}, "")

    monkeypatch.setattr(MODULE, "_request", fake_request)

    with pytest.raises(RuntimeError, match="agents create failed"):
        MODULE.bootstrap()

    assert calls[-1] == (
        "DELETE",
        f"https://api.dev.hypercli.com/api/admin/users/{user_id}",
    )


def test_agents_browser_contract_accepts_current_workspace_empty_state() -> None:
    source = (SCRIPT_PATH.parents[2] / "site/tests/claw/fixtures/auth.ts").read_text(
        encoding="utf-8"
    )

    assert 'return "workspace-selector"' in source
    assert 'return "workspace-empty-state"' in source
    assert 'name: /^Launch an agent\\b/i' in source
    assert "await findLastVisible(workspaceEmptyStateLaunchButton" in source
    assert 'name: "Team", exact: true' in source
    assert "expected Team to select medium launch capacity" in source


def test_agents_browser_contract_allows_immutable_subscription_history() -> None:
    source = (
        SCRIPT_PATH.parents[2] / "site/tests/claw/agents-subscription.spec.ts"
    ).read_text(encoding="utf-8")

    assert "beforeSummary.activeSubscriptions).toHaveLength(0)" in source
    assert "filter((subscription) => subscription.isCurrent)" in source
    assert "beforeSummary.subscriptions ?? []).toHaveLength(0)" not in source
