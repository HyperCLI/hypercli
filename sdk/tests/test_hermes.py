from __future__ import annotations

from unittest.mock import MagicMock, Mock, patch

import httpx
import pytest

from hypercli.agents import (
    DEFAULT_HERMES_AGENT_IMAGE,
    Deployments,
    HermesAgent,
    build_agent_config,
    build_hermes_agent_routes,
)
from hypercli.hermes import HermesApiClient, HermesAPIError
from hypercli.http import HTTPClient


@pytest.fixture
def deployments() -> Deployments:
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_test"
    http.timeout = 30.0
    return Deployments(http, api_key="hyper_test", api_base="https://api.test/agents")


def _deployment_payload(state: str = "starting") -> dict:
    return {
        "id": "agent-123",
        "user_id": "user-456",
        "state": state,
        "runtime": "hermes-agent",
        "hostname": "hermes.example.test",
        "routes": build_hermes_agent_routes(),
    }


def _mock_response(payload: dict, status_code: int = 200) -> Mock:
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload
    response.text = ""
    response.content = b"{}"
    return response


def test_create_hermes_agent_injects_isolated_contract(deployments: Deployments) -> None:
    with patch("httpx.Client") as client_class, patch(
        "hypercli.agents.secrets.token_urlsafe", return_value="h" * 43
    ):
        client = MagicMock()
        client.post.return_value = _mock_response(_deployment_payload())
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client_class.return_value = client

        agent = deployments.create_hermes_agent(
            name="hermes",
            secrets={"CUSTOM_TOKEN": "create-secret"},
        )

    body = client.post.call_args.kwargs["json"]
    assert body["runtime"] == "hermes-agent"
    assert body["image"] == DEFAULT_HERMES_AGENT_IMAGE
    assert body["sync_root"] == "/opt/data"
    assert "sync_enabled" not in body
    assert "sync_include" not in body
    assert "sync_exclude" not in body
    assert body["sync_uid"] == 10000
    assert body["sync_gid"] == 10000
    assert body["routes"] == {
        "hermes": {"port": 8642, "auth": False, "prefix": ""}
    }
    assert body["env"] == {
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_KEY": "h" * 43,
    }
    assert "OPENCLAW_GATEWAY_TOKEN" not in body["env"]
    assert body["secrets"] == {"CUSTOM_TOKEN": "create-secret"}
    assert isinstance(agent, HermesAgent)
    assert agent.api_server_key == "h" * 43
    assert agent.api_url == "https://hermes.example.test"
    assert agent.openai_base_url == "https://hermes.example.test/v1"
    assert agent.launch_config is None


def test_start_hermes_agent_rotates_api_server_key(deployments: Deployments) -> None:
    with patch("httpx.Client") as client_class, patch(
        "hypercli.agents.secrets.token_urlsafe", return_value="s" * 43
    ):
        client = MagicMock()
        client.post.return_value = _mock_response(_deployment_payload())
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client_class.return_value = client

        agent = deployments.start_hermes_agent(
            "agent-123",
            secrets={"CUSTOM_TOKEN": "start-secret"},
        )

    body = client.post.call_args.kwargs["json"]
    assert "sync_include" not in body
    assert "sync_exclude" not in body
    assert body["env"]["API_SERVER_KEY"] == "s" * 43
    assert "OPENCLAW_GATEWAY_TOKEN" not in body["env"]
    assert body["secrets"] == {"CUSTOM_TOKEN": "start-secret"}
    assert "image" not in body
    assert agent.api_server_key == "s" * 43


def test_hermes_include_takes_precedence(deployments: Deployments) -> None:
    launch, _ = build_agent_config(
        sync_root="/opt/data",
        sync_include=["workspace"],
        sync_exclude=["tmp"],
        inject_gateway_token=False,
    )
    assert launch["sync_include"] == ["workspace"]
    assert "sync_exclude" not in launch


def test_hydrated_hermes_agent_never_recovers_api_key(deployments: Deployments) -> None:
    payload = _deployment_payload("running")
    payload["gateway_token"] = "not-a-hermes-key"
    payload["launch_config"] = {"env": {"API_SERVER_KEY": "server-secret"}}

    agent = deployments._hydrate_agent(payload)

    assert isinstance(agent, HermesAgent)
    assert agent.api_server_key is None
    assert "API_SERVER_KEY" not in agent.launch_config["env"]
    with pytest.raises(ValueError, match="API key is unavailable"):
        agent.api()


def test_hermes_agent_retains_key_across_bound_refresh(deployments: Deployments) -> None:
    agent = HermesAgent.from_dict(_deployment_payload())
    agent._deployments = deployments
    agent.api_server_key = "k" * 32
    deployments.wait_running = MagicMock(
        return_value=deployments._hydrate_agent(_deployment_payload("running"))
    )
    deployments.update = MagicMock(
        return_value=deployments._hydrate_agent({**_deployment_payload("running"), "name": "new"})
    )

    assert agent.wait_running().api_server_key == "k" * 32
    assert agent.update(name="new").api_server_key == "k" * 32


def test_short_hermes_api_key_is_rejected(deployments: Deployments) -> None:
    with pytest.raises(ValueError, match="at least 32"):
        deployments.create_hermes_agent(api_server_key="short")


def test_hermes_api_client_routes_and_openai_error_normalization(monkeypatch) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/capabilities":
            return httpx.Response(200, json={"platform": "hermes-agent"})
        return httpx.Response(
            409,
            json={
                "error": {
                    "message": "already exists",
                    "type": "invalid_request_error",
                    "code": "session_exists",
                    "param": "id",
                }
            },
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    api = HermesApiClient("https://hermes.test", "k" * 32)

    assert api.capabilities()["platform"] == "hermes-agent"
    with pytest.raises(HermesAPIError) as raised:
        api.create_session(id="same")

    assert raised.value.status_code == 409
    assert raised.value.detail == "already exists"
    assert raised.value.error_type == "invalid_request_error"
    assert raised.value.code == "session_exists"
    assert raised.value.param == "id"
    assert requests[0].headers["authorization"] == f"Bearer {'k' * 32}"


def test_hermes_sse_preserves_unknown_events_and_fields(monkeypatch) -> None:
    class StreamResponse:
        status_code = 200
        content = b""

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def iter_lines(self):
            return iter(
                [
                    "event: future.widget",
                    "id: evt-1",
                    "x-extension: kept",
                    'data: {"answer":42}',
                    "",
                    "data: [DONE]",
                    "",
                ]
            )

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return StreamResponse()

    monkeypatch.setattr(httpx, "Client", Client)
    events = list(HermesApiClient("https://hermes.test", "k" * 32).run_events("run/1"))

    assert events[0].event == "future.widget"
    assert events[0].data == {"answer": 42}
    assert events[0].id == "evt-1"
    assert ("x-extension", "kept") in events[0].fields
    assert events[1].data == "[DONE]"
