from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from uuid import UUID

import pytest

try:
    import requests as _requests
except ModuleNotFoundError:
    _requests = types.ModuleType("requests")

    class _ReadTimeout(Exception):
        pass

    class _ConnectionError(Exception):
        pass

    _requests.exceptions = types.SimpleNamespace(
        ReadTimeout=_ReadTimeout,
        Timeout=_ReadTimeout,
        ConnectionError=_ConnectionError,
    )
    _requests.request = lambda *_args, **_kwargs: None  # pragma: no cover

sys.modules.setdefault("requests", _requests)


SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "bootstrap_dev_test_keys.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_dev_test_keys", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload


def test_dev_bootstrap_uses_canonical_team_plan() -> None:
    assert MODULE.DEFAULT_PLAN_ID == "team"


def test_new_bootstrap_identity_is_fresh_and_uuid_backed() -> None:
    first = MODULE._new_bootstrap_identity()
    second = MODULE._new_bootstrap_identity()

    first_uuid = UUID(first.orchestra_user_id)
    second_uuid = UUID(second.orchestra_user_id)

    assert first_uuid != second_uuid
    assert first.email != second.email
    assert first.suffix == first_uuid.hex[:10]
    assert second.suffix == second_uuid.hex[:10]
    assert first.email == f"sdk-int-{first.suffix}@example.com"
    assert second.email == f"sdk-int-{second.suffix}@example.com"


def test_github_env_file_separates_mask_commands(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state = MODULE.BootstrapState(
        product_base="https://api.dev.hypercli.com",
        orchestra_api_base="https://api.dev.hypercli.com/api",
        agents_api_base="https://api.dev.hypercli.com/agents",
        agents_admin_base="https://api.agents.dev.hypercli.com",
        orchestra_admin_key="orchestra-admin",
        agents_admin_key="agents-admin",
        orchestra_user_id="orchestra-user",
        hyperclaw_user_id="hyperclaw-user",
        email="sdk-test@example.com",
        test_api_key="hyper-api-key",
        test_agent_api_key="hyper-agent-key",
    )
    github_env = tmp_path / "github-env"

    MODULE._print_github_env(
        state,
        "/tmp/bootstrap-state.json",
        github_env_file=str(github_env),
    )

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.splitlines() == [
        "::add-mask::hyper-api-key",
        "::add-mask::hyper-agent-key",
    ]
    env_text = github_env.read_text(encoding="utf-8")
    assert "::add-mask::" not in env_text
    assert "TEST_API_KEY<<EOF\nhyper-api-key\nEOF\n" in env_text
    assert "TEST_AGENT_API_KEY<<EOF\nhyper-agent-key\nEOF\n" in env_text
    assert "BOOTSTRAP_STATE_FILE<<EOF\n/tmp/bootstrap-state.json\nEOF\n" in env_text


def test_request_retries_transient_status(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake_request(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            return _FakeResponse(504, text="Gateway Timeout")
        return _FakeResponse(200, {"ok": True})

    monkeypatch.setattr(MODULE.requests, "request", fake_request)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)

    response = MODULE._request("POST", "https://example.test/admin/users")

    assert response.status_code == 200
    assert len(calls) == 2


def test_request_retries_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake_request(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise _requests.exceptions.ReadTimeout("timed out")
        return _FakeResponse(200, {"ok": True})

    monkeypatch.setattr(MODULE.requests, "request", fake_request)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)

    response = MODULE._request("GET", "https://example.test/admin/users")

    assert response.status_code == 200
    assert len(calls) == 2


def test_dev_bootstrap_uses_canonical_orchestra_api_base(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_API_BASE_URL", "https://api.dev.hypercli.com")
    monkeypatch.setenv("ORCHESTRA_API_BASE_URL", "https://api.dev.hypercli.com/api")
    monkeypatch.delenv("TEST_API_BASE", raising=False)

    product_base = MODULE._configured_product_base()
    orchestra_api_base = MODULE._configured_orchestra_api_base(product_base)

    assert product_base == "https://api.dev.hypercli.com"
    assert orchestra_api_base == "https://api.dev.hypercli.com/api"


def test_dev_bootstrap_accepts_legacy_test_api_base(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TEST_API_BASE_URL", raising=False)
    monkeypatch.delenv("ORCHESTRA_API_BASE_URL", raising=False)
    monkeypatch.setenv("TEST_API_BASE", "https://api.dev.hypercli.com/api")

    product_base = MODULE._configured_product_base()
    orchestra_api_base = MODULE._configured_orchestra_api_base(product_base)

    assert product_base == "https://api.dev.hypercli.com"
    assert orchestra_api_base == "https://api.dev.hypercli.com/api"


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("https://api.dev.hypercli.com", "https://api.agents.dev.hypercli.com"),
        ("https://api.dev.hypercli.com/api", "https://api.agents.dev.hypercli.com"),
        ("https://api.dev.hypercli.com/agents", "https://api.agents.dev.hypercli.com"),
        ("https://api.dev.hypercli.com/agents/admin", "https://api.agents.dev.hypercli.com"),
        ("https://api.agents.dev.hypercli.com", "https://api.agents.dev.hypercli.com"),
        ("https://api.agents.dev.hypercli.com/admin", "https://api.agents.dev.hypercli.com"),
    ],
)
def test_agents_admin_base_targets_private_admin_host(configured: str, expected: str) -> None:
    assert (
        MODULE._normalize_agents_admin_base(
            configured,
            product_base="https://api.dev.hypercli.com",
        )
        == expected
    )


def test_create_or_get_hyperclaw_user_resolves_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = [
        _FakeResponse(409, text="User already exists"),
        _FakeResponse(200, {"items": [{"id": "user-123", "orchestra_user_id": "orch-123"}]}),
    ]

    def fake_request(*_args, **_kwargs):
        return responses.pop(0)

    monkeypatch.setattr(MODULE.requests, "request", fake_request)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)

    payload = MODULE._create_or_get_hyperclaw_user(
        agents_api_base="https://api.dev.hypercli.com/agents",
        agents_admin_key="admin-key",
        orchestra_user_id="orch-123",
        email="sdk-int@example.com",
    )

    assert payload["id"] == "user-123"
