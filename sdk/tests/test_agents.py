"""Tests for HyperClaw agents SDK."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest

from hypercli.agents import Agent, Deployments, OpenClawAgent, ExecResult, _build_agent_config
from hypercli.http import APIError, HTTPClient


def test_agent_from_dict_minimal():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "pending",
        }
    )

    assert agent.id == "agent-123"
    assert agent.state == "pending"
    assert agent.cpu == 0
    assert agent.memory == 0
    assert agent.routes == {}
    assert agent.ports == []


def test_agent_urls_and_running_state():
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hypercli.com",
    )

    assert agent.public_url == "https://test.hypercli.com"
    assert agent.vnc_url == "https://test.hypercli.com"
    assert agent.shell_url == "https://shell-test.hypercli.com"
    assert agent.executor_url == "https://shell-test.hypercli.com"
    assert agent.is_running is True


def test_openclaw_agent_from_dict():
    agent = OpenClawAgent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "test.hypercli.com",
            "openclaw_url": "wss://openclaw-test.hypercli.com",
            "gateway_token": "gw123",
            "jwt_token": "jwt123",
            "jwt_expires_at": "2026-03-01T12:00:00Z",
            "started_at": "2026-02-24T10:00:00Z",
            "created_at": "2026-02-24T09:00:00Z",
            "updated_at": "2026-02-24T10:00:00Z",
            "routes": {"openclaw": {"port": 18789, "auth": False}},
            "command": ["sleep", "3600"],
            "entrypoint": ["/bin/sh", "-c"],
            "ports": [{"port": 18789, "auth": False}],
        }
    )

    assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
    assert agent.gateway_token == "gw123"
    assert agent.jwt_token == "jwt123"
    assert isinstance(agent.jwt_expires_at, datetime)
    assert isinstance(agent.started_at, datetime)
    assert isinstance(agent.created_at, datetime)
    assert isinstance(agent.updated_at, datetime)
    assert agent.command == ["sleep", "3600"]
    assert agent.entrypoint == ["/bin/sh", "-c"]


def test_openclaw_agent_gateway_requires_url_and_jwt():
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
    )
    with pytest.raises(ValueError, match="OpenClaw gateway URL"):
        agent.gateway()

    agent.gateway_url = "wss://openclaw-test.hypercli.com"
    with pytest.raises(ValueError, match="JWT token"):
        agent.gateway()


def test_openclaw_agent_gateway_uses_bound_tokens():
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        jwt_token="jwt123",
    )

    gw = agent.gateway()
    assert gw.url == "wss://openclaw-test.hypercli.com"
    assert gw.token == "jwt123"
    assert gw.gateway_token == "gw123"


def test_bound_agent_methods_delegate_to_agents(tmp_path):
    local_source = tmp_path / "source.txt"
    local_source.write_text("hello")
    local_dest = tmp_path / "dest.txt"
    manager = Mock()
    manager.exec.return_value = ExecResult(exit_code=0, stdout="done", stderr="")
    manager.refresh_token.return_value = {
        "token": "jwt-new",
        "expires_at": "2026-03-01T12:00:00Z",
    }
    manager.file_read_bytes.return_value = b"downloaded"

    agent = Agent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        _deployments=manager,
    )

    assert agent.exec("ls").stdout == "done"
    manager.exec.assert_called_once_with(agent, "ls", timeout=30, dry_run=False)

    token_data = agent.refresh_token()
    assert token_data["token"] == "jwt-new"
    assert agent.jwt_token == "jwt-new"
    assert isinstance(agent.jwt_expires_at, datetime)

    agent.cp_to(local_source, "workspace/source.txt")
    manager.cp_to.assert_called_once_with(agent, local_source, "workspace/source.txt")

    manager.cp_from.return_value = local_dest
    assert agent.cp_from("workspace/remote.txt", local_dest) == local_dest
    manager.cp_from.assert_called_once_with(agent, "workspace/remote.txt", local_dest)


def test_build_agent_config_includes_command_and_entrypoint():
    config, gateway_token = _build_agent_config(
        {"env": {"FOO": "bar"}},
        command=["echo", "hello"],
        entrypoint=["/bin/sh", "-c"],
        routes={"web": {"port": 80, "prefix": ""}},
        gateway_token="gw-token",
    )

    assert gateway_token == "gw-token"
    assert config["env"] == {"FOO": "bar", "OPENCLAW_GATEWAY_TOKEN": "gw-token"}
    assert config["command"] == ["echo", "hello"]
    assert config["entrypoint"] == ["/bin/sh", "-c"]
    assert config["routes"] == {"web": {"port": 80, "prefix": ""}}


@pytest.fixture
def mock_http():
    http = Mock(spec=HTTPClient)
    http.api_key = "test-key"
    return http


@pytest.fixture
def agents_client(mock_http):
    return Deployments(http=mock_http, api_key="sk-hyper-test123", api_base="https://api.test.hypercli.com")


def test_agents_create_returns_openclaw_agent(agents_client):
    with patch("httpx.Client") as mock_client_class, patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "starting",
            "cpu": 2,
            "memory": 8,
            "openclaw_url": "wss://openclaw-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.create(
            name="test-agent",
            size="medium",
            cpu=4,
            memory=16,
            env={"FOO": "bar"},
            ports=[{"port": 18789, "auth": False}],
            command=["nginx", "-g", "daemon off;"],
            entrypoint=["/docker-entrypoint.sh"],
            image="ghcr.io/acme/reef:test",
            registry_url="ghcr.io",
            registry_auth={"username": "u", "password": "p"},
            start=True,
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["config"]["env"] == {
            "FOO": "bar",
            "OPENCLAW_GATEWAY_TOKEN": "gw-token-123",
        }
        assert posted_json["config"]["command"] == ["nginx", "-g", "daemon off;"]
        assert posted_json["config"]["entrypoint"] == ["/docker-entrypoint.sh"]
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token == "gw-token-123"
        assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
        assert agent._deployments is agents_client


def test_agents_get_returns_generic_agent_without_gateway_metadata(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "test.hypercli.com",
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.get("agent-123")
        assert isinstance(agent, Agent)
        assert not isinstance(agent, OpenClawAgent)
        assert agent._deployments is agents_client


def test_agents_file_ops_use_backend_file_api(agents_client):
    class FakeResponse:
        def __init__(self, status_code=200, json_data=None, text="", content=b""):
            self.status_code = status_code
            self._json_data = json_data or {}
            self.text = text
            self.content = content

        def json(self):
            return self._json_data

    class FakeClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers=None, params=None, follow_redirects=None):
            if url.endswith("/deployments/agent-123/files"):
                assert params is None
                return FakeResponse(json_data={"directories": [{"name": "dir", "type": "directory"}], "files": [{"name": "a.txt", "type": "file"}]})
            if url.endswith("/deployments/agent-123/files/workspace/a.txt"):
                return FakeResponse(content=b"hello")
            raise AssertionError(url)

        def put(self, url, headers=None, content=None):
            assert url.endswith("/deployments/agent-123/files/workspace/a.txt")
            assert content == b"payload"
            return FakeResponse(json_data={"status": "ok"})

        def delete(self, url, headers=None, params=None):
            assert url.endswith("/deployments/agent-123/files/workspace/a.txt")
            assert params is None
            return FakeResponse(json_data={"status": "ok"})

    with patch("hypercli.agents.httpx.Client", FakeClient):
        agent = Agent(id="agent-123", user_id="user-456", pod_id="pod-789", pod_name="pod", state="running")

        entries = agents_client.files_list(agent, "workspace")
        assert entries == [{"name": "dir", "type": "directory"}, {"name": "a.txt", "type": "file"}]
        assert agents_client.file_read(agent, "workspace/a.txt") == "hello"
        assert agents_client.file_write_bytes(agent, "workspace/a.txt", b"payload") == {"status": "ok"}
        assert agents_client.file_delete(agent, "workspace/a.txt") == {"status": "ok"}


def test_agents_list(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "items": [
                {
                    "id": "agent-1",
                    "user_id": "user-456",
                    "pod_id": "pod-1",
                    "pod_name": "pod-1",
                    "state": "running",
                },
                {
                    "id": "agent-2",
                    "user_id": "user-456",
                    "pod_id": "pod-2",
                    "pod_name": "pod-2",
                    "state": "stopped",
                },
            ]
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents = agents_client.list()

        assert len(agents) == 2
        assert agents[0].id == "agent-1"
        assert agents[1].state == "stopped"
        assert all(agent._deployments is agents_client for agent in agents)


def test_agents_start_stop_delete(agents_client):
    with patch("httpx.Client") as mock_client_class, patch("hypercli.agents.secrets.token_hex", return_value="gw-token-456"):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "starting",
            "openclaw_url": "wss://openclaw-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.start(
            "agent-123",
            config={"image": "ghcr.io/acme/reef:test"},
            command=["echo", "hello"],
            entrypoint=["/bin/sh", "-c"],
        )
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token == "gw-token-456"
        assert mock_client.post.call_args[1]["json"] == {
            "config": {
                "image": "ghcr.io/acme/reef:test",
                "command": ["echo", "hello"],
                "entrypoint": ["/bin/sh", "-c"],
                "env": {"OPENCLAW_GATEWAY_TOKEN": "gw-token-456"},
            }
        }

        mock_response.json.return_value["state"] = "stopping"
        stopped = agents_client.stop("agent-123")
        assert stopped.state == "stopping"

        delete_response = Mock()
        delete_response.status_code = 200
        delete_response.json.return_value = {"status": "deleted"}
        mock_client.delete.return_value = delete_response
        assert agents_client.delete("agent-123") == {"status": "deleted"}


def test_agents_budget(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "plan_id": "1aiu",
            "budget": {"max_agents": 5, "total_cpu": 20, "total_memory": 80},
            "used": {"agents": 2, "cpu": 8, "memory": 32},
            "available": {"agents": 3, "cpu": 12, "memory": 48},
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        budget = agents_client.budget()
        assert budget["plan_id"] == "1aiu"
        assert budget["available"]["cpu"] == 12


def test_agents_refresh_token(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "agent_id": "agent-123",
            "pod_id": "pod-789",
            "token": "jwt-new-token",
            "expires_at": "2026-03-01T12:00:00Z",
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        result = agents_client.refresh_token("agent-123")
        assert result["token"] == "jwt-new-token"


def test_agents_api_error(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.json.return_value = {"detail": "Agent not found"}
        mock_response.text = "Agent not found"
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        with pytest.raises(APIError) as exc_info:
            agents_client.get("nonexistent")

        assert exc_info.value.status_code == 404
        assert "Agent not found" in str(exc_info.value)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agents_integration_lifecycle():
    api_key = os.environ.get("HYPERCLAW_API_KEY")
    if not api_key:
        pytest.skip("HYPERCLAW_API_KEY not set")

    from hypercli.http import HTTPClient
    import time

    http = HTTPClient(api_base="https://api.dev.hypercli.com", api_key=api_key)
    agents = Deployments(http, api_key=api_key, api_base="https://api.dev.hypercli.com")

    agent = agents.create(name="test-integration", size="small", start=True)
    assert agent.id is not None

    try:
        for _ in range(24):
            time.sleep(5)
            agent = agents.get(agent.id)
            if agent.is_running:
                break
            if agent.state in ("failed", "stopped"):
                pytest.fail(f"Agent failed to start: {agent.state} - {agent.last_error}")
        else:
            pytest.fail("Agent did not start within 2 minutes")

        result = agent.exec("echo 'integration test'", timeout=10)
        assert result.exit_code == 0
        assert "integration test" in result.stdout

        log_count = 0
        async for _ in agent.logs_stream_ws(tail_lines=10):
            log_count += 1
            if log_count >= 5:
                break
        assert log_count > 0
    finally:
        agents.delete(agent.id)
