from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
import requests


SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "bootstrap_console_test_key.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_console_test_key", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | list | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text

    def json(self):
        return self._payload


def test_request_retries_transient_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake_request(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise requests.exceptions.ReadTimeout("timed out")
        return _FakeResponse(200, {"ok": True})

    monkeypatch.setattr(MODULE.requests, "request", fake_request)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)

    response = MODULE._request("GET", "https://example.test/api/admin/users")

    assert response.status_code == 200
    assert len(calls) == 2


def test_create_user_returns_existing_user_after_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = [
        _FakeResponse(409, text="User already exists"),
        _FakeResponse(200, [{"user_id": "console-e2e-existing", "email": "console@example.com"}]),
    ]

    def fake_request(*_args, **_kwargs):
        return responses.pop(0)

    monkeypatch.setattr(MODULE.requests, "request", fake_request)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)

    user_id = MODULE._create_user("https://api.dev.hypercli.com/api", "admin-key", "console@example.com")

    assert user_id == "console-e2e-existing"
