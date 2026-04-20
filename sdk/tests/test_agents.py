"""Tests for HyperClaw agents SDK."""
from __future__ import annotations

import copy
import os
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest

from hypercli.agents import (
    Agent,
    DEFAULT_OPENCLAW_IMAGE,
    Deployments,
    OpenClawAgent,
    ExecResult,
    _build_agent_launch,
    build_openclaw_routes,
)
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


def test_agent_from_dict_hydrates_only_meta_ui():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "pending",
            "meta": {
                "ui": {
                    "avatar": {
                        "image": "data:image/png;base64,abc",
                        "icon_index": 4,
                    }
                },
                "internal": {
                    "ignored": True,
                },
            },
        }
    )

    assert agent.meta_ui == {
        "avatar": {
            "image": "data:image/png;base64,abc",
            "icon_index": 4,
        }
    }


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
    assert agent.desktop_url == "https://desktop-test.hypercli.com"
    assert agent.vnc_url == "https://desktop-test.hypercli.com"
    assert agent.shell_url is None
    assert agent.executor_url is None
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


def test_openclaw_agent_from_dict_falls_back_to_root_gateway_host():
    agent = OpenClawAgent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "test.hypercli.com",
        }
    )

    assert agent.gateway_url == "wss://test.hypercli.com"


def test_openclaw_agent_gateway_requires_url():
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
    )
    with pytest.raises(ValueError, match="OpenClaw gateway URL"):
        agent.gateway()

def test_openclaw_agent_gateway_allows_jwtless_when_route_auth_disabled():
    manager = Mock()
    manager._api_key = "sk-hyper-test123"
    manager._api_base = "https://api.test.hypercli.com"
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        routes={"openclaw": {"port": 18789, "auth": False}},
        _deployments=manager,
    )

    gw = agent.gateway()
    assert gw.url == "wss://openclaw-test.hypercli.com"
    assert gw.token is None
    assert gw.gateway_token == "gw123"


def test_openclaw_agent_gateway_ignores_jwt_and_uses_bound_tokens():
    manager = Mock()
    manager._api_key = "sk-hyper-test123"
    manager._api_base = "https://api.test.hypercli.com"
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        jwt_token="jwt123",
        routes={"openclaw": {"port": 18789, "auth": True}},
        _deployments=manager,
    )

    gw = agent.gateway()
    assert gw.url == "wss://openclaw-test.hypercli.com"
    assert gw.token is None
    assert gw.gateway_token == "gw123"
    assert gw.deployment_id == "agent-123"
    assert gw.api_key == "sk-hyper-test123"
    assert gw.api_base == "https://api.test.hypercli.com"


def test_agent_wait_running_delegates_to_deployments():
    manager = Mock()
    ready = Agent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-ready",
        pod_name="ready-pod",
        state="running",
        hostname="ready.hypercli.com",
    )
    ready._deployments = manager
    manager.wait_running.return_value = ready

    agent = Agent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-pending",
        pod_name="pending-pod",
        state="pending",
        _deployments=manager,
    )

    result = agent.wait_running(timeout=42, poll_interval=1.5)

    manager.wait_running.assert_called_once_with("agent-123", timeout=42, poll_interval=1.5)
    assert result is agent
    assert agent.state == "running"
    assert agent.pod_id == "pod-ready"
    assert agent.hostname == "ready.hypercli.com"


@pytest.mark.asyncio
async def test_openclaw_agent_wait_ready_uses_gateway_client():
    agent = OpenClawAgent(
        id="agent-ready",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        jwt_token="jwt123",
    )

    calls: list[tuple[float, float, str]] = []
    closed: list[bool] = []

    class FakeGateway:
        async def wait_ready(self, timeout: float, retry_interval: float, probe: str) -> dict:
            calls.append((timeout, retry_interval, probe))
            return {"gateway": {"mode": "local"}}

        async def close(self) -> None:
            closed.append(True)

    agent.gateway = Mock(return_value=FakeGateway())  # type: ignore[method-assign]

    result = await agent.wait_ready(timeout=90, retry_interval=1.5, probe="status")

    assert result["gateway"]["mode"] == "local"
    assert calls == [(90, 1.5, "status")]
    assert closed == [True]


@pytest.mark.asyncio
async def test_openclaw_agent_helper_methods_mutate_config():
    agent = OpenClawAgent(
        id="agent-helpers",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        jwt_token="jwt123",
    )

    base_config = {
        "models": {
            "providers": {
                "hyperclaw": {
                    "api": "anthropic-messages",
                    "baseUrl": "https://api.example",
                    "models": [{"id": "kimi-k2.5", "name": "Kimi K2.5"}],
                }
            }
        },
        "agents": {"defaults": {}},
    }
    applied: list[dict] = []

    async def fake_config_get(**kwargs):
        return copy.deepcopy(base_config)

    async def fake_config_apply(config: dict, **kwargs):
        applied.append(copy.deepcopy(config))
        return config

    agent.config_get = fake_config_get  # type: ignore[method-assign]
    agent.config_apply = fake_config_apply  # type: ignore[method-assign]

    provider = await agent.provider_upsert(
        "moonshot",
        api="anthropic-messages",
        base_url="https://moonshot.example",
        api_key="moonshot-key",
        models=[{"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": True}],
    )
    assert provider["baseUrl"] == "https://moonshot.example"

    model = await agent.model_upsert(
        "moonshot",
        "kimi-k2.5",
        name="Kimi K2.5",
        reasoning=True,
        context_window=262144,
    )
    assert model["contextWindow"] == 262144

    primary = await agent.set_default_model("moonshot", "kimi-k2.5")
    assert primary == "moonshot/kimi-k2.5"

    memory_search = await agent.set_memory_search(
        provider="embeddings",
        model="qwen3-embedding",
        base_url="https://embed.example",
        api_key="embed-key",
    )
    assert memory_search["remote"]["baseUrl"] == "https://embed.example"

    telegram = await agent.telegram_upsert(
        {
            "botToken": "telegram-token",
            "allowFrom": ["123456"],
        }
    )
    assert telegram["botToken"] == "telegram-token"

    slack = await agent.slack_upsert(
        {
            "botToken": "xoxb-test",
            "channels": {"C123": {"enabled": True, "users": ["U123"]}},
        },
        account_id="work",
    )
    assert slack["botToken"] == "xoxb-test"

    discord = await agent.discord_upsert(
        {
            "token": "discord-token",
            "guilds": {"G123": {"enabled": True}},
        }
    )
    assert discord["token"] == "discord-token"

    assert len(applied) == 7
    assert applied[0]["models"]["providers"]["moonshot"]["apiKey"] == "moonshot-key"
    assert applied[1]["models"]["providers"]["moonshot"]["models"][0]["reasoning"] is True
    assert applied[2]["agents"]["defaults"]["model"]["primary"] == "moonshot/kimi-k2.5"
    assert applied[3]["agents"]["defaults"]["memorySearch"]["remote"]["apiKey"] == "embed-key"
    assert applied[4]["channels"]["telegram"]["allowFrom"] == ["123456"]
    assert applied[5]["channels"]["slack"]["accounts"]["work"]["channels"]["C123"]["users"] == ["U123"]
    assert applied[6]["channels"]["discord"]["guilds"]["G123"]["enabled"] is True


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


def test_build_agent_launch_includes_command_and_entrypoint():
    launch, gateway_token = _build_agent_launch(
        {"foo": "bar"},
        env={"FOO": "bar"},
        command=["echo", "hello"],
        entrypoint=["/bin/sh", "-c"],
        routes={"web": {"port": 80, "prefix": ""}},
        gateway_token="gw-token",
    )

    assert gateway_token == "gw-token"
    assert launch["config"] == {"foo": "bar"}
    assert launch["env"] == {"FOO": "bar", "OPENCLAW_GATEWAY_TOKEN": "gw-token"}
    assert launch["command"] == ["echo", "hello"]
    assert launch["entrypoint"] == ["/bin/sh", "-c"]
    assert launch["routes"] == {"web": {"port": 80, "prefix": ""}}


def test_build_agent_launch_merges_heartbeat_defaults():
    launch, _gateway_token = _build_agent_launch(
        {"agents": {"defaults": {"model": "openai/gpt-5.4", "heartbeat": {"target": "last"}}}},
        heartbeat={"every": "0m", "includeSystemPromptSection": False},
        gateway_token="gw-token",
    )

    assert launch["config"] == {
        "agents": {
            "defaults": {
                "model": "openai/gpt-5.4",
                "heartbeat": {
                    "target": "last",
                    "every": "0m",
                    "includeSystemPromptSection": False,
                },
            }
        }
    }


def test_build_openclaw_routes_defaults():
    assert build_openclaw_routes() == {
        "openclaw": {"port": 18789, "auth": False, "prefix": ""},
        "desktop": {"port": 3000, "auth": True, "prefix": "desktop"},
    }


def test_build_openclaw_routes_allows_overrides():
    assert build_openclaw_routes(
        include_desktop=False,
        gateway_port=19999,
        gateway_auth=True,
        gateway_prefix="app",
    ) == {
        "openclaw": {"port": 19999, "auth": True, "prefix": "app"},
    }


def test_create_openclaw_defaults_routes_when_omitted(agents_client):
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
            "openclaw_url": "wss://test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(name="test-agent")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == DEFAULT_OPENCLAW_IMAGE
        assert posted_json["routes"] == {
            "openclaw": {"port": 18789, "auth": False, "prefix": ""},
            "desktop": {"port": 3000, "auth": True, "prefix": "desktop"},
        }


def test_create_openclaw_respects_explicit_empty_routes(agents_client):
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
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(name="test-agent", routes={})

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == DEFAULT_OPENCLAW_IMAGE
        assert posted_json["routes"] == {}


def test_create_openclaw_includes_heartbeat_when_requested(agents_client):
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
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(
            name="test-agent",
            heartbeat={"every": "0m", "includeSystemPromptSection": False},
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["config"]["agents"]["defaults"]["heartbeat"] == {
            "every": "0m",
            "includeSystemPromptSection": False,
        }

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
            meta_ui={
                "avatar": {
                    "image": "data:image/png;base64,xyz",
                    "icon_index": 7,
                }
            },
            env={"FOO": "bar"},
            ports=[{"port": 18789, "auth": False}],
            command=["nginx", "-g", "daemon off;"],
            entrypoint=["/docker-entrypoint.sh"],
            image="ghcr.io/hypercli/hypercli-openclaw:test",
            registry_url="ghcr.io",
            registry_auth={"username": "u", "password": "p"},
            start=True,
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"] == {
            "FOO": "bar",
            "OPENCLAW_GATEWAY_TOKEN": "gw-token-123",
        }
        assert posted_json["meta"] == {
            "ui": {
                "avatar": {
                    "image": "data:image/png;base64,xyz",
                    "icon_index": 7,
                }
            }
        }
        assert posted_json["command"] == ["nginx", "-g", "daemon off;"]
        assert posted_json["entrypoint"] == ["/docker-entrypoint.sh"]
        assert posted_json["image"] == "ghcr.io/hypercli/hypercli-openclaw:test"
        assert posted_json["registry_url"] == "ghcr.io"
        assert posted_json["registry_auth"] == {"username": "u", "password": "p"}
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token == "gw-token-123"
        assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
        assert agent.meta_ui is None
        assert agent._deployments is agents_client


def test_create_openclaw_defaults_sync_root(agents_client):
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
            "openclaw_url": "wss://openclaw-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(name="test-agent")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["sync_root"] == "/home/node"
        assert posted_json["sync_enabled"] is True
        assert "HOME" not in posted_json["env"]


def test_start_openclaw_defaults_sync_root(agents_client):
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
            "openclaw_url": "wss://openclaw-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.start_openclaw("agent-123")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["sync_root"] == "/home/node"
        assert posted_json["sync_enabled"] is True
        assert "HOME" not in posted_json["env"]


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
        def __init__(self, status_code=200, json_data=None, text="", content=b"", headers=None):
            self.status_code = status_code
            self._json_data = json_data or {}
            self.text = text
            self.content = content
            self.headers = headers or {}

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
            if url.endswith("/deployments/agent-123/files/workspace"):
                assert params is None
                return FakeResponse(json_data={"directories": [{"name": "dir", "type": "directory"}], "files": [{"name": "a.txt", "type": "file"}]})
            if url.endswith("/deployments/agent-123/files/workspace/a.txt"):
                return FakeResponse(content=b"hello")
            if url.endswith("/deployments/agent-123/files/.openclaw"):
                return FakeResponse(
                    json_data={
                        "type": "directory",
                        "prefix": ".openclaw/",
                        "directories": [{"name": "workspace", "type": "directory"}],
                        "files": [{"name": "openclaw.json", "type": "file"}],
                    },
                    content=b'{"type":"directory","directories":[],"files":[]}',
                    headers={"content-type": "application/json"},
                )
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
        hidden_entries = agents_client.files_list(agent, ".openclaw")
        assert entries == [{"name": "dir", "type": "directory"}, {"name": "a.txt", "type": "file"}]
        assert hidden_entries == [{"name": "workspace", "type": "directory"}, {"name": "openclaw.json", "type": "file"}]
        assert agents_client.file_read(agent, "workspace/a.txt") == "hello"
        assert agents_client.file_write_bytes(agent, "workspace/a.txt", b"payload") == {"status": "ok"}
        assert agents_client.file_delete(agent, "workspace/a.txt") == {"status": "ok"}
        with pytest.raises(ValueError, match=r"Path is a directory: \.openclaw"):
            agents_client.file_read(agent, ".openclaw")


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
            image="ghcr.io/hypercli/hypercli-openclaw:test",
            command=["echo", "hello"],
            entrypoint=["/bin/sh", "-c"],
        )
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token == "gw-token-456"
        assert mock_client.post.call_args[1]["json"] == {
            "image": "ghcr.io/hypercli/hypercli-openclaw:test",
            "command": ["echo", "hello"],
            "entrypoint": ["/bin/sh", "-c"],
            "env": {"OPENCLAW_GATEWAY_TOKEN": "gw-token-456"},
        }

        mock_response.json.return_value["state"] = "stopping"
        stopped = agents_client.stop("agent-123")
        assert stopped.state == "stopping"

        delete_response = Mock()
        delete_response.status_code = 200
        delete_response.json.return_value = {"status": "deleted"}
        mock_client.delete.return_value = delete_response
        assert agents_client.delete("agent-123") == {"status": "deleted"}


def test_agents_update_and_resize(agents_client):
    patch_calls = []

    def fake_patch(path, json=None):
        patch_calls.append((path, json))
        return {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": None,
            "pod_name": None,
            "state": "stopped",
            "cpu": 4,
            "memory": 4,
        }

    agents_client._http.patch = fake_patch

    updated = agents_client.update("agent-123", size="large", refresh_from_lagoon=True)
    assert updated.id == "agent-123"
    assert patch_calls[0] == (
        "/deployments/agent-123",
        {"size": "large", "refresh_from_lagoon": True},
    )

    resized = agents_client.resize("agent-123", size="large")
    assert resized.id == "agent-123"
    assert patch_calls[1] == ("/deployments/agent-123", {"size": "large"})


def test_bound_agent_resize_delegates_to_deployments(agents_client):
    patch_calls = []

    def fake_patch(path, json=None):
        patch_calls.append((path, json))
        return {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": None,
            "pod_name": None,
            "state": "stopped",
            "cpu": 4,
            "memory": 4,
        }

    agents_client._http.patch = fake_patch

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        get_response = Mock()
        get_response.status_code = 200
        get_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": None,
            "pod_name": None,
            "state": "stopped",
            "cpu": 2,
            "memory": 2,
        }
        mock_client.get.return_value = get_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.get("agent-123")
        resized = agent.resize(size="large")

        assert resized.cpu == 4
        assert patch_calls == [("/deployments/agent-123", {"size": "large"})]


def test_agents_start_preserves_generic_launch_fields(agents_client):
    with patch("httpx.Client") as mock_client_class, patch("hypercli.agents.secrets.token_hex", return_value="gw-token-generic"):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-456",
            "user_id": "user-456",
            "pod_id": "pod-456",
            "pod_name": "generic-pod",
            "state": "starting",
            "hostname": "generic.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.start(
            "agent-456",
            image="python:3.12-alpine",
            command=["sh", "-c", "python -m http.server 80"],
            routes={"web": {"port": 80, "auth": False, "prefix": ""}},
            sync_root="/workspace",
            sync_enabled=True,
        )

        assert isinstance(agent, Agent)
        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == "python:3.12-alpine"
        assert posted_json["command"] == ["sh", "-c", "python -m http.server 80"]
        assert posted_json["routes"] == {"web": {"port": 80, "auth": False, "prefix": ""}}
        assert posted_json["sync_root"] == "/workspace"
        assert posted_json["sync_enabled"] is True


def test_build_agent_launch_rejects_nested_launch_fields():
    with pytest.raises(ValueError, match="Launch settings must be top-level fields"):
        _build_agent_launch(
            {"env": {"FOO": "bar"}},
        )


def test_agents_budget(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "plan_id": "basic",
            "budget": {"max_agents": 5, "total_cpu": 20, "total_memory": 80},
            "used": {"agents": 2, "cpu": 8, "memory": 32},
            "available": {"agents": 3, "cpu": 12, "memory": 48},
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        budget = agents_client.budget()
        assert budget["plan_id"] == "basic"
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


def test_agents_inference_token(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "agent_id": "agent-123",
            "openclaw_url": "wss://openclaw-test.hypercli.com",
            "gateway_token": "gw-inference",
        }
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        result = agents_client.inference_token("agent-123")

        assert result["gateway_token"] == "gw-inference"
        assert mock_client.get.call_args[0][0].endswith("/deployments/agent-123/inference/token")


def test_agents_create_scoped_key(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "key_id": "key-123",
            "name": "agent-client",
            "api_key": "hyper_api_scoped",
            "tags": ["agent:agent-123"],
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        result = agents_client.create_scoped_key("agent-123", name="agent-client")

        assert result["api_key"] == "hyper_api_scoped"
        assert mock_client.post.call_args[0][0].endswith("/deployments/agent-123/keys")
        assert mock_client.post.call_args[1]["json"] == {"name": "agent-client"}


def test_agents_purchase_entitlement_from_balance(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "grant": {"id": "grant-1", "type": "BALANCE", "duration": 3600},
            "entitlement": {"id": "ent-1", "plan_id": "basic"},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        result = agents_client.purchase_entitlement_from_balance("basic", duration=3600, tags=["customer=acme"])

        assert result["grant"]["type"] == "BALANCE"
        assert mock_client.post.call_args[0][0].endswith("/billing/balance/basic")
        assert mock_client.post.call_args[1]["json"] == {"duration": 3600, "tags": ["customer=acme"]}


def test_agents_redeem_grant_code(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": "promo-123"},
            "entitlement": {"id": "ent-1", "plan_id": "basic"},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        result = agents_client.redeem_grant_code("promo-123")

        assert result["grant"]["code"] == "promo-123"
        assert mock_client.post.call_args[0][0].endswith("/billing/grants/redeem")
        assert mock_client.post.call_args[1]["json"] == {"code": "promo-123"}


def test_openclaw_agent_resolve_gateway_token_uses_inference_endpoint():
    manager = Mock()
    manager.inference_token.return_value = {
        "openclaw_url": "wss://openclaw-test.hypercli.com",
        "gateway_token": "gw-fetched",
    }
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        _deployments=manager,
    )

    token = agent.resolve_gateway_token()

    assert token == "gw-fetched"
    assert agent.gateway_token == "gw-fetched"
    assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
    manager.inference_token.assert_called_once_with("agent-123")


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
    api_key = os.environ.get("HYPER_API_KEY")
    if not api_key:
        pytest.skip("HYPER_API_KEY not set")

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
