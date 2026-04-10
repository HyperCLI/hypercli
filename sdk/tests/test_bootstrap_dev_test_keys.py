from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

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
