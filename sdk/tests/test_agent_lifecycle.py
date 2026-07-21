from __future__ import annotations

from unittest.mock import Mock

import pytest

from hypercli.agents import Agent, Deployments


def make_deployments(monkeypatch):
    deployments = Deployments(Mock(), api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents")
    monkeypatch.setattr(
        deployments,
        "list",
        lambda: [
            Agent(
                id="11111111-1111-4111-8111-111111111111",
                user_id="user-456",
                pod_id="pod-789",
                pod_name="clear-window-works",
                name="clear-window-works",
                state="STOPPED",
            )
        ],
    )
    monkeypatch.setattr(
        deployments,
        "_get_by_id",
        lambda agent_id: Agent(
            id=agent_id,
            user_id="user-456",
            pod_id="pod-789",
            pod_name="clear-window-works",
            name="clear-window-works",
            state="STOPPED",
        ),
    )
    return deployments


def test_resolve_agent_id_accepts_unique_agent_name(monkeypatch):
    deployments = make_deployments(monkeypatch)

    assert deployments.resolve_agent_id("clear-window-works") == "11111111-1111-4111-8111-111111111111"


def test_attach_slack_relay_agent_resolves_name_and_posts_to_relay(monkeypatch):
    deployments = make_deployments(monkeypatch)
    calls: list[tuple[str, dict | None]] = []

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "connected": True,
                "agent_id": "11111111-1111-4111-8111-111111111111",
                "gateway_id": "agent:11111111-1111-4111-8111-111111111111",
                "restart_required": True,
            }

    class FakeClient:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def post(self, url, headers=None):
            calls.append((url, headers))
            return FakeResponse()

    monkeypatch.setattr("hypercli.agents.httpx.Client", FakeClient)

    result = deployments.attach_slack_relay_agent(
        "clear-window-works",
        relay_base_url="https://api.agents.hypercli.com/",
    )

    assert result["connected"] is True
    assert calls == [
        (
            "https://api.hypercli.com/slack/agents/11111111-1111-4111-8111-111111111111/relay",
            {"Authorization": "Bearer hyper_api_test", "Content-Type": "application/json"},
        )
    ]


def test_attach_slack_relay_agent_requires_relay_base_url(monkeypatch):
    deployments = make_deployments(monkeypatch)

    with pytest.raises(ValueError, match="relay_base_url is required"):
        deployments.attach_slack_relay_agent("clear-window-works", relay_base_url="")
