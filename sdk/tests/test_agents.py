"""Tests for HyperClaw Agents API client."""
from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch, AsyncMock

import pytest
import httpx

from hypercli.agents import Agents, ReefPod, ExecResult
from hypercli.http import HTTPClient, APIError


# ---------------------------------------------------------------------------
# ReefPod Model Tests
# ---------------------------------------------------------------------------

def test_reef_pod_from_dict():
    """Test ReefPod.from_dict with all fields."""
    data = {
        "id": "agent-123",
        "user_id": "user-456",
        "pod_id": "pod-789",
        "pod_name": "test-pod",
        "state": "running",
        "name": "My Agent",
        "cpu": 4,
        "memory": 16,
        "hostname": "test.hyperclaw.app",
        "openclaw_url": "wss://openclaw-test.hyperclaw.app",
        "jwt_token": "jwt123",
        "jwt_expires_at": "2026-03-01T12:00:00Z",
        "started_at": "2026-02-24T10:00:00Z",
        "stopped_at": None,
        "last_error": None,
        "created_at": "2026-02-24T09:00:00Z",
        "updated_at": "2026-02-24T10:00:00Z",
    }

    pod = ReefPod.from_dict(data)

    assert pod.id == "agent-123"
    assert pod.user_id == "user-456"
    assert pod.pod_id == "pod-789"
    assert pod.pod_name == "test-pod"
    assert pod.state == "running"
    assert pod.name == "My Agent"
    assert pod.cpu == 4
    assert pod.memory == 16
    assert pod.hostname == "test.hyperclaw.app"
    assert pod.openclaw_url == "wss://openclaw-test.hyperclaw.app"
    assert pod.jwt_token == "jwt123"
    assert isinstance(pod.jwt_expires_at, datetime)
    assert isinstance(pod.started_at, datetime)
    assert pod.stopped_at is None
    assert pod.last_error is None
    assert isinstance(pod.created_at, datetime)
    assert isinstance(pod.updated_at, datetime)


def test_reef_pod_from_dict_minimal():
    """Test ReefPod.from_dict with minimal required fields."""
    data = {
        "id": "agent-123",
        "user_id": "user-456",
        "pod_id": "pod-789",
        "pod_name": "test-pod",
        "state": "pending",
    }

    pod = ReefPod.from_dict(data)

    assert pod.id == "agent-123"
    assert pod.state == "pending"
    assert pod.name is None
    assert pod.cpu == 0
    assert pod.memory == 0


def test_reef_pod_urls():
    """Test vnc_url, shell_url, executor_url properties."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hyperclaw.app",
    )

    assert pod.vnc_url == "https://test.hyperclaw.app"
    assert pod.shell_url == "https://shell-test.hyperclaw.app"
    assert pod.executor_url == "https://shell-test.hyperclaw.app"


def test_reef_pod_urls_no_hostname():
    """Test URL properties return None when no hostname."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="pending",
    )

    assert pod.vnc_url is None
    assert pod.shell_url is None
    assert pod.executor_url is None


def test_reef_pod_is_running():
    """Test is_running property."""
    running_pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
    )
    assert running_pod.is_running is True

    pending_pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="pending",
    )
    assert pending_pod.is_running is False


def test_reef_pod_gateway():
    """Test gateway() method creates GatewayClient."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hyperclaw.app",
        jwt_token="jwt123",
    )

    gw = pod.gateway()
    assert gw is not None
    assert gw.url == "wss://openclaw-test.hyperclaw.app"
    assert gw.token == "jwt123"


def test_reef_pod_gateway_no_token():
    """Test gateway() raises when no JWT token."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hyperclaw.app",
    )

    with pytest.raises(ValueError, match="no JWT token"):
        pod.gateway()


def test_reef_pod_gateway_no_hostname():
    """Test gateway() raises when no hostname."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="pending",
        jwt_token="jwt123",
    )

    with pytest.raises(ValueError, match="no openclaw_url or hostname"):
        pod.gateway()


def test_reef_pod_gateway_uses_openclaw_url():
    """Test gateway() prefers openclaw_url over hostname."""
    pod = ReefPod(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hyperclaw.app",
        openclaw_url="wss://custom-openclaw.hyperclaw.app",
        jwt_token="jwt123",
    )

    gw = pod.gateway()
    assert gw.url == "wss://custom-openclaw.hyperclaw.app"


def test_exec_result_from_dict():
    """Test ExecResult.from_dict."""
    data = {
        "exit_code": 0,
        "stdout": "hello\n",
        "stderr": "",
    }

    result = ExecResult.from_dict(data)

    assert result.exit_code == 0
    assert result.stdout == "hello\n"
    assert result.stderr == ""


def test_exec_result_from_dict_defaults():
    """Test ExecResult.from_dict with missing fields."""
    data = {}

    result = ExecResult.from_dict(data)

    assert result.exit_code == -1
    assert result.stdout == ""
    assert result.stderr == ""


# ---------------------------------------------------------------------------
# Agents Client Tests (Mocked HTTP)
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_http():
    """Mock HTTPClient."""
    http = Mock(spec=HTTPClient)
    http.api_key = "test-key"
    return http


@pytest.fixture
def agents_client(mock_http):
    """Agents client with mock HTTP."""
    return Agents(http=mock_http, claw_api_key="sk-test123", claw_api_base="https://api.test.hyperclaw.app")


def test_agents_create(agents_client):
    """Test agents.create() sends correct POST body."""
    with patch("httpx.Client") as mock_client_class:
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
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        pod = agents_client.create(
            name="test-agent",
            size="medium",
            cpu=4,
            memory=16,
            start=True,
        )

        # Verify POST call
        assert mock_client.post.called
        call_args = mock_client.post.call_args
        assert call_args[0][0] == "https://api.test.hyperclaw.app/api/agents"
        
        posted_json = call_args[1]["json"]
        assert posted_json["name"] == "test-agent"
        assert posted_json["size"] == "medium"
        assert posted_json["cpu"] == 4
        assert posted_json["memory"] == 16
        assert posted_json["start"] is True

        # Verify response parsing
        assert pod.id == "agent-123"
        assert pod.state == "starting"


def test_agents_list(agents_client):
    """Test agents.list() parses response correctly."""
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

        pods = agents_client.list()

        assert len(pods) == 2
        assert pods[0].id == "agent-1"
        assert pods[0].state == "running"
        assert pods[1].id == "agent-2"
        assert pods[1].state == "stopped"


def test_agents_start_stop_delete(agents_client):
    """Test agents start, stop, and delete methods."""
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        
        # Test start
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "starting",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        pod = agents_client.start("agent-123")
        assert pod.state == "starting"
        assert mock_client.post.call_args[0][0] == "https://api.test.hyperclaw.app/api/agents/agent-123/start"

        # Test stop
        mock_response.json.return_value["state"] = "stopping"
        pod = agents_client.stop("agent-123")
        assert pod.state == "stopping"
        assert mock_client.post.call_args[0][0] == "https://api.test.hyperclaw.app/api/agents/agent-123/stop"

        # Test delete
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "deleted"}
        mock_client.delete.return_value = mock_response
        
        result = agents_client.delete("agent-123")
        assert result["status"] == "deleted"
        assert mock_client.delete.call_args[0][0] == "https://api.test.hyperclaw.app/api/agents/agent-123"


def test_agents_budget(agents_client):
    """Test agents.budget() method."""
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "plan_id": "1aiu",
            "budget": {
                "max_agents": 5,
                "total_cpu": 20,
                "total_memory": 80,
            },
            "used": {
                "agents": 2,
                "cpu": 8,
                "memory": 32,
            },
            "available": {
                "agents": 3,
                "cpu": 12,
                "memory": 48,
            },
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        budget = agents_client.budget()

        assert budget["plan_id"] == "1aiu"
        assert budget["budget"]["max_agents"] == 5
        assert budget["used"]["agents"] == 2
        assert budget["available"]["cpu"] == 12


def test_agents_refresh_token(agents_client):
    """Test agents.refresh_token() method."""
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
        assert result["agent_id"] == "agent-123"
        assert mock_client.get.call_args[0][0] == "https://api.test.hyperclaw.app/api/agents/agent-123/token"


def test_agents_api_error(agents_client):
    """Test that API errors are raised correctly."""
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


# ---------------------------------------------------------------------------
# Integration Tests (requires HYPERCLAW_API_KEY)
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.asyncio
async def test_agents_integration_lifecycle():
    """Integration test: create agent, verify running, exec command, delete.

    Requires HYPERCLAW_API_KEY environment variable to be set.
    Connects to https://api.dev.hyperclaw.app
    """
    api_key = os.environ.get("HYPERCLAW_API_KEY")
    if not api_key:
        pytest.skip("HYPERCLAW_API_KEY not set")

    from hypercli.http import HTTPClient
    import time

    # Create client
    http = HTTPClient(api_base="https://api.dev.hyperclaw.app", api_key=api_key)
    agents = Agents(http, claw_api_key=api_key, claw_api_base="https://api.dev.hyperclaw.app")

    # Create agent
    print("\n[Integration] Creating agent...")
    pod = agents.create(name="test-integration", size="small", start=True)
    assert pod.id is not None
    print(f"[Integration] Created agent {pod.id[:12]} - {pod.state}")

    try:
        # Wait for running state
        print("[Integration] Waiting for agent to start...")
        max_wait = 120  # 2 minutes
        for i in range(max_wait // 5):
            time.sleep(5)
            pod = agents.get(pod.id)
            print(f"[Integration] [{i*5}s] State: {pod.state}")
            if pod.is_running:
                break
            if pod.state in ("failed", "stopped"):
                pytest.fail(f"Agent failed to start: {pod.state} - {pod.last_error}")
        else:
            pytest.fail("Agent did not start within 2 minutes")

        assert pod.is_running
        print(f"[Integration] Agent is running! Desktop: {pod.vnc_url}")

        # Wait a bit more for executor to be ready
        time.sleep(10)

        # Execute a command
        print("[Integration] Executing test command...")
        result = agents.exec(pod, "echo 'integration test'", timeout=10)
        assert result.exit_code == 0
        assert "integration test" in result.stdout
        print(f"[Integration] Exec result: {result.stdout.strip()}")

        # Test WebSocket log streaming
        print("[Integration] Testing WebSocket log streaming...")
        log_count = 0
        async for log_line in agents.logs_stream_ws(pod.id, tail_lines=10):
            print(f"[Integration] Log: {log_line[:80]}")
            log_count += 1
            if log_count >= 5:
                break
        assert log_count > 0
        print(f"[Integration] Received {log_count} log lines via WebSocket")

    finally:
        # Cleanup
        print(f"[Integration] Deleting agent {pod.id[:12]}...")
        agents.delete(pod.id)
        print("[Integration] Agent deleted")


if __name__ == "__main__":
    # Run with: pytest sdk/tests/test_agents.py -v
    # Run integration tests: HYPERCLAW_API_KEY=sk-... pytest sdk/tests/test_agents.py -v -m integration
    pytest.main([__file__, "-v"])
