"""Tests for the ACP session proxy ticket mint and proxy URL derivation."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from hypercli.agents import (
    AGENTS_ACP_PROXY_WS_URL,
    DEV_AGENTS_ACP_PROXY_WS_URL,
    Deployments,
    _default_agents_acp_ws_url,
    agents_acp_proxy_ws_url,
)
from hypercli.http import APIError, HTTPClient

AGENT_ID = "11111111-1111-4111-8111-111111111111"


def _deployments(api_base: str = "https://api.example.com/agents") -> Deployments:
    http = MagicMock(spec=HTTPClient)
    http.api_key = "backend-key"
    return Deployments(http, api_base=api_base)


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def _capture_post(monkeypatch, payload, status_code: int = 200) -> dict:
    captured: dict = {}

    class FakeClient:
        def __init__(self, timeout=None):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return _FakeResponse(payload, status_code)

    monkeypatch.setattr("hypercli.agents.httpx.Client", FakeClient)
    return captured


def test_acp_ws_token_posts_to_admin_surface_with_backend_key(monkeypatch):
    captured = _capture_post(
        monkeypatch,
        {"token": "ticket-1", "expires_at": "2026-09-29T00:01:00+00:00"},
    )

    payload = _deployments().acp_ws_token(AGENT_ID)

    assert captured["url"] == f"https://api.example.com/admin/agents/{AGENT_ID}/acp-ws-token"
    assert captured["headers"]["X-BACKEND-API-KEY"] == "backend-key"
    assert captured["headers"]["Authorization"] == "Bearer backend-key"
    assert payload == {"token": "ticket-1", "expires_at": "2026-09-29T00:01:00+00:00"}


def test_acp_ws_token_rejects_malformed_response(monkeypatch):
    _capture_post(monkeypatch, {"token": "ticket-1"})

    with pytest.raises(ValueError, match="invalid Agent ACP WS token response"):
        _deployments().acp_ws_token(AGENT_ID)


def test_acp_ws_token_surfaces_conflict_as_api_error(monkeypatch):
    _capture_post(monkeypatch, {"detail": "Agent is not running"}, status_code=409)

    with pytest.raises(APIError) as exc_info:
        _deployments().acp_ws_token(AGENT_ID)

    assert exc_info.value.status_code == 409
    assert "not running" in str(exc_info.value)


def test_acp_ws_token_rejects_unauthorized_as_api_error(monkeypatch):
    _capture_post(
        monkeypatch,
        {"detail": "Invalid or missing backend API key"},
        status_code=401,
    )

    with pytest.raises(APIError) as exc_info:
        _deployments().acp_ws_token(AGENT_ID)

    assert exc_info.value.status_code == 401


def test_default_agents_acp_ws_url_swaps_ws_suffix_per_host():
    assert _default_agents_acp_ws_url("https://api.hypercli.com/agents") == AGENTS_ACP_PROXY_WS_URL
    assert _default_agents_acp_ws_url("https://api.hypercli.com/api") == AGENTS_ACP_PROXY_WS_URL
    assert _default_agents_acp_ws_url("https://api.dev.hypercli.com/agents") == DEV_AGENTS_ACP_PROXY_WS_URL
    assert (
        _default_agents_acp_ws_url("https://gateway.example.com/agents")
        == "wss://gateway.example.com/ws/acp"
    )
    assert (
        _default_agents_acp_ws_url("http://127.0.0.1:18080/agents")
        == "ws://127.0.0.1:18080/ws/acp"
    )


def test_agents_acp_proxy_ws_url_swaps_only_the_terminal_ws_suffix():
    assert agents_acp_proxy_ws_url("wss://api.example.com/ws") == "wss://api.example.com/ws/acp"
    assert agents_acp_proxy_ws_url("wss://api.example.com/custom/ws") == "wss://api.example.com/custom/ws/acp"
    with pytest.raises(ValueError):
        agents_acp_proxy_ws_url("wss://api.example.com/other")


def test_deployments_acp_ws_url_derives_from_configured_tunnel_url():
    deployments = _deployments()
    deployments._agents_ws_url = "wss://api.example.com/ws"

    assert deployments.acp_ws_url == "wss://api.example.com/ws/acp"
