"""Tests for HyperClaw agents SDK."""
from __future__ import annotations

import copy
import asyncio
import json
import os
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

import pytest

from hypercli.agents import (
    AGENT_FILE_MAX_BYTES,
    AGENT_FILE_OPERATION_TIMEOUT_SECONDS,
    AGENT_FILE_TRANSFER_CHUNK_BYTES,
    Agent,
    AgentCapacity,
    AgentRoutes,
    DEFAULT_AGENT_RUNTIME_SCOPES,
    DEFAULT_OPENCLAW_IMAGE,
    DEFAULT_OPENCLAW_PRO_IMAGE,
    DeploymentEvent,
    Deployments,
    OpenClawAgent,
    OpenClawProAgent,
    ExecResult,
    _build_agent_launch,
    agent_config_has_desktop,
    build_openclaw_routes,
    flatten_launch_config,
    launch_config_has_desktop,
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
    assert agent.managed is None


def test_agent_from_dict_hydrates_transition_epochs_and_future_state():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": "FUTURE_STATE",
            "placement_epoch": 7,
            "runtime_generation": 4,
            "finalize_epoch": 2,
            "restore_state": "FUTURE_RESTORE",
        }
    )

    assert agent.state == "FUTURE_STATE"
    assert agent.placement_epoch == 7
    assert agent.runtime_generation == 4
    assert agent.finalize_epoch == 2
    assert agent.restore_state == "FUTURE_RESTORE"


def test_agent_from_dict_hydrates_downloading_runtime_status():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": "DOWNLOADING",
            "last_error": "ErrImagePull; unauthorized",
            "runtime_status": {
                "pod_phase": "Pending",
                "container_name": "reef",
                "state": "waiting",
                "reason": "ErrImagePull",
                "message": "unauthorized",
            },
        }
    )

    assert agent.state == "DOWNLOADING"
    assert agent.runtime_status == {
        "pod_phase": "Pending",
        "container_name": "reef",
        "state": "waiting",
        "reason": "ErrImagePull",
        "message": "unauthorized",
    }


@pytest.mark.asyncio
async def test_subscribe_hydrates_rest_before_socket_and_resyncs_after_ready(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    calls: list[str] = []
    stop = asyncio.Event()
    transition = {
        "version": 1,
        "type": "deployment.transition",
        "deployment_id": "agent-123",
        "state": "RUNNING",
        "placement_epoch": 7,
        "runtime_generation": 4,
    }

    monkeypatch.setattr(deployments, "list", lambda: calls.append("rest") or [])
    monkeypatch.setattr(
        deployments,
        "_post",
        lambda path: calls.append(path) or {"token": "token", "ws_url": "wss://events.test/ws/deployments"},
    )

    class FakeSocket:
        def __init__(self):
            self.messages = iter((json.dumps({"version": 1, "type": "ready"}), json.dumps(transition)))

        async def send(self, payload):
            calls.append(json.loads(payload)["type"])

        async def recv(self):
            return next(self.messages)

    class FakeConnection:
        async def __aenter__(self):
            return FakeSocket()

        async def __aexit__(self, *_args):
            return None

    import websockets

    monkeypatch.setattr(websockets, "connect", lambda *_args, **_kwargs: FakeConnection())
    received: list[DeploymentEvent] = []

    def handler(event: DeploymentEvent):
        received.append(event)
        if event.type == "deployment.transition":
            stop.set()

    await deployments.subscribe(handler, stop_event=stop)

    assert calls[:4] == ["rest", "/deployments/events/token", "auth", "rest"]
    assert [event.type for event in received] == ["deployments.changed", "deployment.transition"]
    assert received[-1].runtime_generation == 4


@pytest.mark.asyncio
async def test_subscribe_reconnects_after_clean_disconnect_and_resyncs_again(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    calls: list[str] = []
    connection_count = 0
    transition = {
        "version": 1,
        "type": "deployment.transition",
        "deployment_id": "agent-123",
        "state": "RUNNING",
    }

    class FastStopEvent(asyncio.Event):
        def __init__(self):
            super().__init__()
            self.waits = 0

        async def wait(self):
            self.waits += 1
            raise asyncio.TimeoutError

    stop = FastStopEvent()
    monkeypatch.setattr(deployments, "list", lambda: calls.append("rest") or [])
    monkeypatch.setattr(
        deployments,
        "_post",
        lambda path: calls.append(path)
        or {"token": "token", "ws_url": "wss://events.test/ws/deployments"},
    )

    class FakeSocket:
        def __init__(self, ordinal):
            messages = [json.dumps({"version": 1, "type": "ready"})]
            if ordinal == 2:
                messages.append(json.dumps(transition))
            self.messages = iter(messages)

        async def send(self, payload):
            calls.append(json.loads(payload)["type"])

        async def recv(self):
            try:
                return next(self.messages)
            except StopIteration as exc:
                raise RuntimeError("socket closed") from exc

    class FakeConnection:
        async def __aenter__(self):
            nonlocal connection_count
            connection_count += 1
            return FakeSocket(connection_count)

        async def __aexit__(self, *_args):
            return None

    import websockets

    monkeypatch.setattr(websockets, "connect", lambda *_args, **_kwargs: FakeConnection())
    received: list[DeploymentEvent] = []

    def handler(event: DeploymentEvent):
        received.append(event)
        if event.type == "deployment.transition":
            stop.set()

    await deployments.subscribe(handler, stop_event=stop)

    assert connection_count == 2
    assert stop.waits == 1
    assert calls == [
        "rest",
        "/deployments/events/token",
        "auth",
        "rest",
        "/deployments/events/token",
        "auth",
        "rest",
    ]
    assert [event.type for event in received] == [
        "deployments.changed",
        "deployments.changed",
        "deployment.transition",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [401, 403])
async def test_subscribe_surfaces_permanent_auth_failure(monkeypatch, status_code):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    monkeypatch.setattr(deployments, "list", lambda: [])

    def reject_token(_path):
        raise APIError(status_code, "not authorized")

    monkeypatch.setattr(deployments, "_post", reject_token)

    with pytest.raises(APIError) as error:
        await deployments.subscribe(lambda _event: None)

    assert error.value.status_code == status_code


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boot_state",
    ["PENDING", "DOWNLOADING", "RESTORING", "SYNCING", "STOPPING"],
)
async def test_wait_running_async_accepts_every_canonical_boot_state(monkeypatch, boot_state):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    states = iter((boot_state, "RUNNING"))
    monkeypatch.setattr(deployments, "resolve_agent_id", lambda _value: "agent-123")
    monkeypatch.setattr(
        deployments,
        "get",
        lambda _value: Agent.from_dict({"id": "agent-123", "state": next(states)}),
    )

    async def subscribe(handler, **_kwargs):
        handler(DeploymentEvent(version=1, type="deployment.transition", deployment_id="agent-123"))
        await asyncio.Event().wait()

    monkeypatch.setattr(deployments, "subscribe", subscribe)

    agent = await deployments.wait_running_async("agent-123", timeout=1)

    assert agent.state == "RUNNING"


def _routes_response(**overrides):
    response = {
        "agent_id": "agent-123",
        "routes": {"web": {"port": 3000, "auth": True, "prefix": "app"}},
        "route_statuses": {"web": {"url": "https://app-agent.hypercli.app"}},
    }
    response.update(overrides)
    return response


def test_agent_routes_hydrates_declarative_and_status_fields():
    state = AgentRoutes.from_dict(_routes_response())

    assert state.agent_id == "agent-123"
    assert state.routes == {"web": {"port": 3000, "auth": True, "prefix": "app"}}
    assert state.route_statuses["web"]["url"] == "https://app-agent.hypercli.app"


def test_routes_api_supports_declarative_and_named_updates_with_self_passthrough():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents")

    with patch.object(deployments, "_get", return_value=_routes_response()) as get_request:
        state = deployments.get_routes("self")
    get_request.assert_called_once_with("/deployments/self/routes")
    assert state.routes["web"]["port"] == 3000

    with patch.object(deployments, "_put", return_value=_routes_response()) as put_request:
        deployments.set_routes("self", {"web": {"port": 3000, "auth": True}})
    put_request.assert_called_once_with(
        "/deployments/self/routes",
        {
            "routes": {"web": {"port": 3000, "auth": True}},
        },
    )

    with patch.object(deployments, "_put", return_value=_routes_response()) as put_request:
        deployments.set_route(
            "self", "web app", {"port": 3000, "auth": False, "prefix": ""}
        )
    put_request.assert_called_once_with(
        "/deployments/self/routes/web%20app",
        {"port": 3000, "auth": False, "prefix": ""},
    )

    with patch.object(deployments, "_delete", return_value=_routes_response()) as delete_request:
        deployments.remove_route("self", "web app")
    delete_request.assert_called_once_with("/deployments/self/routes/web%20app")


def test_self_selector_is_limited_to_status_lifecycle_and_routes():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents")
    response = {
        "id": "agent-123",
        "user_id": "user-456",
        "pod_id": "pod-789",
        "pod_name": "pod-789",
        "state": "running",
    }

    with patch.object(deployments, "_get_by_id", return_value=Agent.from_dict(response)) as get_by_id:
        assert deployments.get("self").id == "agent-123"
    get_by_id.assert_called_once_with("self")

    with patch.object(deployments, "_post", return_value=response) as post:
        deployments.start("self")
        deployments.stop("self")
    assert post.call_args_list[0].args == ("/deployments/self/start",)
    assert post.call_args_list[0].kwargs == {"json": {}}
    assert post.call_args_list[1].args == ("/deployments/self/stop",)

    with pytest.raises(ValueError, match="backend-stored launch configuration"):
        deployments.start("self", image="ghcr.io/example/override:latest")

    with pytest.raises(ValueError, match="sync_include"):
        deployments.start("self", sync_include=None)

    with pytest.raises(ValueError, match="backend-stored launch configuration"):
        deployments.start_openclaw("self")

    with pytest.raises(ValueError, match="only supported"):
        deployments.delete("self")


def test_agent_from_dict_hydrates_new_api_fields_without_image_url_fallback():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "external_ready",
            "name": "Legacy name",
            "handle": "claw",
            "display_name": "HyperClaw",
            "avatar_url": "https://cdn.example/avatar.png",
            "display_identity": {
                "display_name": "HyperClaw Coder",
                "avatar_url": "https://cdn.example/coder.png",
                "channel_overrides": {},
            },
            "image_url": "https://cdn.example/legacy.png",
            "runtime": "openclaw",
            "managed": True,
            "is_launchable": False,
            "launch_config": {"image": "ghcr.io/hypercli/hypercli-openclaw:prod"},
            "gateway_id": "gateway-123",
            "runtime_key_alias": "key-123",
            "relay_key": {"api_key": "hyper_api_secret", "key_id": "key-123"},
        }
    )

    assert agent.handle == "claw"
    assert agent.display_name == "HyperClaw"
    assert agent.avatar_url == "https://cdn.example/avatar.png"
    assert agent.display_identity == {
        "display_name": "HyperClaw Coder",
        "avatar_url": "https://cdn.example/coder.png",
        "channel_overrides": {},
    }
    assert agent.runtime == "openclaw"
    assert agent.managed is True
    assert agent.is_launchable is False
    assert agent.launch_config == {"image": "ghcr.io/hypercli/hypercli-openclaw:prod"}
    assert agent.gateway_id == "gateway-123"
    assert agent.runtime_key_alias == "key-123"
    assert agent.relay_key == {"api_key": "hyper_api_secret", "key_id": "key-123"}

    legacy = Agent.from_dict(
        {
            "id": "agent-456",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "external_ready",
            "image_url": "https://cdn.example/legacy.png",
            "managed": False,
        }
    )
    assert legacy.avatar_url is None
    assert legacy.managed is False
    assert legacy.is_launchable is False


def test_deployments_external_agent_helpers_call_expected_routes():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents")

    with patch.object(deployments, "_post") as post:
        post.return_value = {
            "id": "external-123",
            "user_id": "user-456",
            "state": "active",
            "managed": False,
            "runtime": "openclaw",
            "runtime_key_alias": "key-123",
            "relay_key": {"api_key": "hyper_api_secret", "key_id": "key-123"},
        }
        agent = deployments.create_external_agent(name="external-agent", display_name="External", handle="external")

    post.assert_called_once_with(
        "/external-agents",
        {
            "name": "external-agent",
            "runtime": "openclaw",
            "status": "active",
            "display_name": "External",
            "handle": "external",
        },
    )
    assert agent.is_launchable is False
    assert agent.relay_key == {"api_key": "hyper_api_secret", "key_id": "key-123"}

    with patch.object(deployments, "_post", return_value={"relay_key": {"api_key": "hyper_api_next"}}) as post:
        assert deployments.rotate_external_agent_key("external-123") == {"relay_key": {"api_key": "hyper_api_next"}}

    post.assert_called_once_with("/external-agents/external-123/keys/rotate")


def test_update_external_agent_uses_exact_id_and_preserves_explicit_nulls():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents")
    response = {
        "id": "backend-external-id",
        "user_id": "user-456",
        "state": "inactive",
        "name": "external-agent-renamed",
        "display_name": None,
        "managed": False,
        "runtime": "openclaw",
    }

    with patch.object(deployments, "_patch", return_value=response) as patch_request, patch.object(
        deployments,
        "resolve_agent_id",
        side_effect=AssertionError("external agent IDs must not use managed resolution"),
    ) as resolve_agent_id:
        agent = deployments.update_external_agent(
            "backend-external-id",
            name="external-agent-renamed",
            display_name=None,
            handle=None,
            runtime="openclaw",
            status="inactive",
            meta=None,
        )
        deployments.update_external_agent("backend-external-id", name="external-agent-renamed")

    assert patch_request.call_args_list[0].args == (
        "/external-agents/backend-external-id",
        {
            "name": "external-agent-renamed",
            "display_name": None,
            "handle": None,
            "runtime": "openclaw",
            "status": "inactive",
            "meta": None,
        },
    )
    assert patch_request.call_args_list[1].args == (
        "/external-agents/backend-external-id",
        {"name": "external-agent-renamed"},
    )
    resolve_agent_id.assert_not_called()
    assert agent.id == "backend-external-id"
    assert agent.managed is False


@pytest.mark.asyncio
async def test_openclaw_agent_configure_slack_relay_uses_gateway_id(monkeypatch):
    agent = OpenClawAgent(
        id="11111111-1111-1111-1111-111111111111",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="pod-789",
        state="running",
        gateway_id="agent:11111111-1111-1111-1111-111111111111",
    )
    seen = []

    class FakeGateway:
        async def configure_slack_relay(self, **kwargs):
            seen.append(kwargs)
            return {"ok": True}

    class FakeConnect:
        async def __aenter__(self):
            return FakeGateway()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr(agent, "connect", lambda **_kwargs: FakeConnect())

    result = await agent.configure_slack_relay(url="wss://api.dev.hypercli.com/slack/ws")

    assert result == {"ok": True}
    assert seen == [
        {
            "url": "wss://api.dev.hypercli.com/slack/ws",
            "gateway_id": "agent:11111111-1111-1111-1111-111111111111",
            "auth_token_env": "HYPER_AGENTS_API_KEY",
            "account_id": None,
            "bot_token": None,
            "config": None,
        }
    ]


@pytest.mark.asyncio
async def test_openclaw_agent_configure_slack_socket_delegates(monkeypatch):
    agent = OpenClawAgent(
        id="11111111-1111-1111-1111-111111111111",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="pod-789",
        state="running",
    )
    seen = []

    class FakeGateway:
        async def configure_slack_socket(self, **kwargs):
            seen.append(kwargs)
            return {"ok": True}

    class FakeConnect:
        async def __aenter__(self):
            return FakeGateway()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr(agent, "connect", lambda **_kwargs: FakeConnect())

    result = await agent.configure_slack_socket(
        bot_token="xoxb-test",
        app_token="xapp-test",
        socket_mode={"serverPingTimeout": 30},
        account_id="work",
        config={"requireMention": True},
    )

    assert result == {"ok": True}
    assert seen == [
        {
            "bot_token": "xoxb-test",
            "app_token": "xapp-test",
            "socket_mode": {"serverPingTimeout": 30},
            "account_id": "work",
            "config": {"requireMention": True},
        }
    ]


@pytest.mark.asyncio
async def test_openclaw_agent_configure_whatsapp_delegates(monkeypatch):
    agent = OpenClawAgent(
        id="11111111-1111-1111-1111-111111111111",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="pod-789",
        state="running",
    )
    seen = []

    class FakeGateway:
        async def configure_whatsapp(self, config=None, *, account_id=None):
            seen.append((config, account_id))
            return {"ok": True}

    class FakeConnect:
        async def __aenter__(self):
            return FakeGateway()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr(agent, "connect", lambda **_kwargs: FakeConnect())

    result = await agent.configure_whatsapp({"replyToMode": "all"}, account_id="personal")

    assert result == {"ok": True}
    assert seen == [({"replyToMode": "all"}, "personal")]


@pytest.mark.parametrize(
    "failed_state",
    ["STOPPED", "FAILED", "RESTORE_FAILED", "SYNC_FAILED"],
)
def test_wait_running_fails_on_terminal_states(monkeypatch, failed_state):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)

    monkeypatch.setattr(
        deployments,
        "get",
        lambda _agent_id: Agent.from_dict(
            {
                "id": "agent-123",
                "user_id": "user-456",
                "pod_id": "pod-789",
                "pod_name": "pod-789",
                "state": failed_state,
                "stage": "syncing",
                "error": "WorkspaceSyncFailed",
                "message": "workspace sync failed",
            }
        ),
    )

    with pytest.raises(RuntimeError, match=failed_state):
        deployments.wait_running("agent-123", timeout=1, poll_interval=0)


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
    assert (
        agent.browser_desktop_url(" jwt-123 ")
        == "https://desktop-test.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fresize%3Dscale"
    )
    assert agent.shell_url is None
    assert agent.executor_url is None
    assert agent.is_running is True


@pytest.mark.parametrize(
    ("state", "expected"),
    [("RUNNING", True), ("running", True), ("STOPPED", False), ("", False)],
)
def test_agent_running_state_is_case_insensitive(state, expected):
    agent = Agent.from_dict({"id": "agent-123", "state": state})

    assert agent.is_running is expected


@pytest.mark.parametrize(
    "state",
    [
        "PENDING",
        "DOWNLOADING",
        "RESTORING",
        "SYNCING",
        "RUNNING",
        "STOPPING",
        "STOPPED",
        "FAILED",
    ],
)
def test_agent_hydrates_canonical_lifecycle_diagnostics(state):
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": state,
            "stage": state.lower(),
            "error": "ExampleError" if state == "FAILED" else None,
            "message": f"Lifecycle state is {state}",
        }
    )

    assert agent.state == state
    assert agent.stage == state.lower()
    assert agent.error == ("ExampleError" if state == "FAILED" else None)
    assert agent.message == f"Lifecycle state is {state}"


def test_browser_desktop_url_preserves_redirect_query_and_forces_scale():
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        hostname="test.hypercli.com",
    )

    assert (
        agent.browser_desktop_url("jwt-123", redirect="vnc.html?autoconnect=1&resize=remote")
        == "https://desktop-test.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fautoconnect%3D1%26resize%3Dscale"
    )


def test_launch_config_desktop_detection_uses_explicit_config_not_pro_image():
    assert launch_config_has_desktop({"env": {"OPENCLAW_DESKTOP_ENABLED": "1"}}) is True
    assert launch_config_has_desktop({"routes": {"desktop": {"port": 3000, "auth": True, "prefix": "screen"}}}) is True
    assert launch_config_has_desktop({"routes": {"browser": {"port": 3000, "auth": True, "prefix": "desktop"}}}) is True
    assert launch_config_has_desktop({"ports": [{"port": 3000, "auth": True}]}) is True
    assert launch_config_has_desktop({"image": DEFAULT_OPENCLAW_PRO_IMAGE}) is False
    assert agent_config_has_desktop({"routes": {"desktop": {"port": 3000, "auth": True, "prefix": "desktop"}}}) is True


def test_flatten_launch_config_and_agent_has_desktop():
    launch_config = {
        "env": {"OPENCLAW_DESKTOP_ENABLED": "0"},
        "routes": {"openclaw": {"port": 18789, "prefix": ""}},
        "ports": [{"port": 3000, "auth": True}],
    }

    assert flatten_launch_config(launch_config)["env.OPENCLAW_DESKTOP_ENABLED"] == "0"
    assert flatten_launch_config(launch_config)["routes.openclaw.port"] == 18789
    assert flatten_launch_config(launch_config)["ports[0].port"] == 3000

    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "agent.hypercli.com",
            "routes": {"desktop": {"port": 3000, "auth": True, "prefix": "screen"}},
        }
    )

    assert agent.has_desktop is True
    assert agent.desktop_url == "https://screen-agent.hypercli.com"


def test_openclaw_agent_from_dict():
    agent = OpenClawAgent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "test.hypercli.com",
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

    assert agent.gateway_url is None
    assert agent.gateway_token == "gw123"
    assert agent.jwt_token == "jwt123"
    assert isinstance(agent.jwt_expires_at, datetime)
    assert isinstance(agent.started_at, datetime)
    assert isinstance(agent.created_at, datetime)
    assert isinstance(agent.updated_at, datetime)
    assert agent.command == ["sleep", "3600"]
    assert agent.entrypoint == ["/bin/sh", "-c"]


def test_openclaw_agent_from_dict_does_not_guess_gateway_url_from_hostname():
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

    assert agent.gateway_url is None


def test_openclaw_agent_gateway_requires_url():
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
    )
    with pytest.raises(ValueError, match="Deployments client"):
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


def test_openclaw_agent_wait_running_still_delegates_to_deployments():
    manager = Mock()
    ready = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-ready",
        pod_name="ready-pod",
        state="running",
        hostname="ready.hypercli.com",
    )
    ready._deployments = manager
    manager.wait_running.return_value = ready

    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-pending",
        pod_name="pending-pod",
        state="starting",
        hostname="ready.hypercli.com",
        _deployments=manager,
    )
    agent.wait_for_gateway_context = Mock(side_effect=AssertionError("wait_for_gateway_context should not be used by wait_running"))

    result = agent.wait_running(timeout=42, poll_interval=1.5)

    manager.wait_running.assert_called_once_with("agent-123", timeout=42, poll_interval=1.5)
    agent.wait_for_gateway_context.assert_not_called()
    assert result is agent
    assert agent.state == "running"
    assert agent.pod_id == "pod-ready"


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
    manager.file_read_bytes_with_metadata.return_value = {
        "content": b"downloaded",
        "mime_type": "text/plain",
    }

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
        restart=False,
        runtime_scopes=["models:*", "workspaces:*"],
        gateway_token="gw-token",
    )

    assert gateway_token == "gw-token"
    assert launch["config"] == {"foo": "bar"}
    assert launch["env"] == {"FOO": "bar", "OPENCLAW_GATEWAY_TOKEN": "gw-token"}
    assert launch["command"] == ["echo", "hello"]
    assert launch["entrypoint"] == ["/bin/sh", "-c"]
    assert launch["routes"] == {"web": {"port": 80, "prefix": ""}}
    assert launch["restart"] is False
    assert launch["runtime_scopes"] == ["models:*", "workspaces:*"]


def test_build_agent_launch_omits_unspecified_restart():
    launch, _gateway_token = _build_agent_launch({}, inject_gateway_token=False)

    assert "restart" not in launch


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({}, {"sync_enabled": False}),
        ({"sync_include": None}, {"sync_enabled": False, "sync_include": None}),
        ({"sync_exclude": None}, {"sync_enabled": False, "sync_exclude": None}),
        ({"sync_include": []}, {"sync_enabled": False, "sync_include": []}),
        (
            {"sync_include": ["workspace"], "sync_exclude": ["workspace/tmp"]},
            {"sync_enabled": False, "sync_include": ["workspace"]},
        ),
    ],
)
def test_build_agent_launch_preserves_sync_policy_presence(kwargs, expected):
    launch, _gateway_token = _build_agent_launch(
        {},
        inject_gateway_token=False,
        **kwargs,
    )

    assert {key: value for key, value in launch.items() if key.startswith("sync_")} == expected


def test_build_agent_launch_merges_heartbeat_defaults():
    launch, _gateway_token = _build_agent_launch(
        {"agents": {"defaults": {"model": "openai/gpt-5.4", "heartbeat": {"target": "last"}}}},
        heartbeat={"every": "1h", "target": "last"},
        gateway_token="gw-token",
    )

    assert launch["config"] == {
        "agents": {
            "defaults": {
                "model": "openai/gpt-5.4",
                "heartbeat": {
                    "target": "last",
                    "every": "1h",
                },
            }
        }
    }


def test_build_openclaw_routes_defaults():
    assert build_openclaw_routes() == {
        "openclaw": {"port": 18789, "auth": False, "prefix": ""},
    }


def test_build_openclaw_routes_allows_overrides():
    assert build_openclaw_routes(
        include_desktop=True,
        gateway_port=19999,
        gateway_auth=True,
        gateway_prefix="app",
    ) == {
        "openclaw": {"port": 19999, "auth": True, "prefix": "app"},
        "desktop": {"port": 3000, "auth": True, "prefix": "desktop"},
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
            "hostname": "test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(name="test-agent")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == DEFAULT_OPENCLAW_IMAGE
        assert posted_json["env"]["HYPER_API_BASE"] == "https://api.test.hypercli.com"
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/workspaces"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["routes"] == {
            "openclaw": {"port": 18789, "auth": False, "prefix": ""},
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


def test_create_openclaw_pro_defaults_desktop_image_env_and_routes(agents_client):
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
            "launch_config": {
                "image": DEFAULT_OPENCLAW_PRO_IMAGE,
                "env": {"OPENCLAW_DESKTOP_ENABLED": "1"},
                "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
            },
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.create_openclaw_pro(name="test-agent")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["runtime"] == "openclaw-pro"
        assert posted_json["image"] == DEFAULT_OPENCLAW_PRO_IMAGE
        assert posted_json["env"]["HYPER_API_BASE"] == "https://api.test.hypercli.com"
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/workspaces"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["env"]["OPENCLAW_DESKTOP_ENABLED"] == "1"
        assert "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START" not in posted_json["env"]
        assert posted_json["routes"] == {
            "openclaw": {"port": 18789, "auth": False, "prefix": ""},
            "desktop": {"port": 3000, "auth": True, "prefix": "desktop"},
        }
        assert posted_json["runtime_scopes"] == DEFAULT_AGENT_RUNTIME_SCOPES
        assert isinstance(agent, OpenClawProAgent)


def test_create_openclaw_allows_hyper_api_base_override(agents_client):
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
            env={"HYPER_API_BASE": "https://api.override.test"},
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_API_BASE"] == "https://api.override.test"


def test_create_openclaw_accepts_memory_index_options(agents_client):
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
            "launch_config": {
                "env": {},
                "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
            },
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(
            name="test-agent",
            memory_index={
                "on_session_start": True,
                "on_search": True,
                "watch": True,
                "watch_debounce_ms": 60000,
                "interval_minutes": 120,
            },
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/workspaces"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS"] == "60000"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES"] == "120"


def test_create_openclaw_accepts_workspaces_sync_options(agents_client):
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
            workspaces_sync={
                "output_dir": "/home/node/CustomWorkspaces",
                "ready_only": False,
                "workspace": "team-knowledge",
            },
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/CustomWorkspaces"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "0"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_WORKSPACE"] == "team-knowledge"


def test_create_openclaw_can_disable_workspaces_sync(agents_client):
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

        agents_client.create_openclaw(name="test-agent", workspaces_sync=False)

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "0"
        assert "HYPER_WORKSPACES_DIR" not in posted_json["env"]
        assert "HYPER_WORKSPACES_SYNC_READY_ONLY" not in posted_json["env"]


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
            heartbeat={"every": "1h", "target": "last"},
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["config"]["agents"]["defaults"]["heartbeat"] == {
            "every": "1h",
            "target": "last",
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
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
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
        assert agent.gateway_url is None
        assert agent.meta_ui is None
        assert agent._deployments is agents_client


def test_agents_create_preserves_backend_contract_on_idempotent_replay(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-replayed",
            "user_id": "user-456",
            "state": "stopped",
            "runtime": "openclaw",
            "creation_replayed": True,
            "launch_config": {
                "env": {"OPENCLAW_GATEWAY_TOKEN": "original-token"},
                "command": ["original-command"],
                "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
                "sync_enabled": True,
            },
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.create_openclaw(
            name="replayed-agent",
            start=False,
            env={"OPENCLAW_GATEWAY_TOKEN": "retry-token"},
            command=["retry-command"],
            meta_ui={"creation_id": "setup-123"},
        )

        assert agent.creation_replayed is True
        assert agent.launch_config["env"]["OPENCLAW_GATEWAY_TOKEN"] == "original-token"
        assert "sync_enabled" not in agent.launch_config
        assert agent.command == ["original-command"]


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
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(name="test-agent")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["sync_root"] == "/home/node"
        assert posted_json["sync_enabled"] is True
        assert posted_json["env"]["HYPER_API_BASE"] == "https://api.test.hypercli.com"
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
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.start_openclaw("agent-123")

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["sync_root"] == "/home/node"
        assert posted_json["sync_enabled"] is True
        assert posted_json["env"]["HYPER_API_BASE"] == "https://api.test.hypercli.com"
        assert "HOME" not in posted_json["env"]


def test_start_openclaw_preserves_restart_policy(agents_client):
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
            "hostname": "buzz-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.start_openclaw(
            "agent-123",
            image="ghcr.io/hypercli/hypercli-buzz-opencode:latest",
            command=["/usr/local/bin/buzz-acp"],
            routes={},
            restart=False,
            runtime_scopes=["models:*"],
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == "ghcr.io/hypercli/hypercli-buzz-opencode:latest"
        assert posted_json["command"] == ["/usr/local/bin/buzz-acp"]
        assert posted_json["routes"] == {}
        assert posted_json["restart"] is False
        assert posted_json["runtime_scopes"] == ["models:*"]


def test_start_openclaw_pro_defaults_runtime_scopes(agents_client):
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "starting",
            "runtime": "openclaw-pro",
        }

    agents_client._post = fake_post
    agents_client.start_openclaw_pro("11111111-1111-4111-8111-111111111111")

    assert posted["runtime_scopes"] == DEFAULT_AGENT_RUNTIME_SCOPES


@pytest.mark.parametrize(
    ("method_name", "args", "kwargs", "expected_include", "expected_exclude"),
    [
        (
            "create_openclaw",
            (),
            {"sync_include": ["workspace"], "sync_exclude": ["workspace/tmp"]},
            ["workspace"],
            None,
        ),
        ("create_openclaw_pro", (), {"sync_include": []}, [], None),
        (
            "start_openclaw",
            ("11111111-1111-4111-8111-111111111111",),
            {"sync_exclude": ["workspace/tmp"]},
            None,
            ["workspace/tmp"],
        ),
        (
            "start_openclaw_pro",
            ("11111111-1111-4111-8111-111111111111",),
            {"sync_include": None},
            None,
            None,
        ),
    ],
)
def test_openclaw_wrappers_forward_sync_policy(
    agents_client,
    method_name,
    args,
    kwargs,
    expected_include,
    expected_exclude,
):
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "state": "starting",
            "runtime": "openclaw-pro" if method_name.endswith("_pro") else "openclaw",
        }

    agents_client._post = fake_post
    getattr(agents_client, method_name)(*args, **kwargs)

    if "sync_include" in kwargs:
        assert posted["sync_include"] == expected_include
    elif expected_include is None:
        assert "sync_include" not in posted
    else:
        assert posted["sync_include"] == expected_include
    if expected_exclude is None:
        assert "sync_exclude" not in posted
    else:
        assert posted["sync_exclude"] == expected_exclude


def test_openclaw_include_takes_precedence(agents_client):
    posted: dict = {}
    agents_client._post = lambda _path, json=None: posted.update(json or {}) or {
        "id": "11111111-1111-4111-8111-111111111111",
        "user_id": "user-456",
        "state": "starting",
        "runtime": "openclaw",
    }
    agents_client.create_openclaw(sync_include=["workspace"], sync_exclude=["tmp"])
    assert posted["sync_include"] == ["workspace"]
    assert "sync_exclude" not in posted


def test_start_openclaw_distinguishes_omitted_and_explicit_null_sync_policy(agents_client):
    posted: list[dict] = []

    def fake_post(_path, json=None):
        posted.append(dict(json or {}))
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "state": "PENDING",
            "runtime": "openclaw",
        }

    agents_client._post = fake_post
    agent_id = "11111111-1111-4111-8111-111111111111"
    agents_client.start_openclaw(agent_id)
    agents_client.start_openclaw(agent_id, sync_include=None)

    assert "sync_include" not in posted[0]
    assert "sync_exclude" not in posted[0]
    assert posted[1]["sync_include"] is None
    assert "sync_exclude" not in posted[1]


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
    assert AGENT_FILE_MAX_BYTES == 250 * 1024 * 1024
    assert AGENT_FILE_TRANSFER_CHUNK_BYTES == 64 * 1024

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
            assert timeout in (AGENT_FILE_OPERATION_TIMEOUT_SECONDS, 10)
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers=None, params=None, follow_redirects=None):
            if url.endswith("/deployments/agent-123/files") and params == {
                "source": "pod",
                "absolute_path": "/",
            }:
                return FakeResponse(
                    json_data={
                        "directories": [{"name": "home", "path": "/home/", "type": "directory"}],
                        "files": [],
                    }
                )
            if url.endswith("/deployments/agent-123/files") and params == {
                "source": "pod",
                "absolute_path": "/etc/hosts",
            }:
                return FakeResponse(content=b"127.0.0.1 localhost", headers={"content-type": "text/plain"})
            if url.endswith("/deployments/agent-123/files"):
                assert params == {"source": "auto"}
                return FakeResponse(json_data={"directories": [{"name": "dir", "type": "directory"}], "files": [{"name": "a.txt", "type": "file"}]})
            if url.endswith("/deployments/agent-123/files/workspace"):
                assert params == {"source": "auto"}
                return FakeResponse(json_data={"directories": [{"name": "dir", "type": "directory"}], "files": [{"name": "a.txt", "type": "file"}]})
            if url.endswith("/deployments/agent-123/files/workspace/a.txt"):
                assert params == {"source": "auto"}
                return FakeResponse(content=b"hello", headers={"content-type": "text/plain"})
            if url.endswith("/deployments/agent-123/files/.openclaw"):
                assert params == {"source": "auto"}
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

        def post(self, url, headers=None, params=None, content=None):
            if url.endswith("/deployments/agent-123/profile-image"):
                assert headers["Authorization"] == "Bearer sk-hyper-test123"
                assert headers["Content-Type"] == "image/png"
                assert content == b"png"
                return FakeResponse(
                    json_data={
                        "id": "agent-123",
                        "avatar_url": "https://cdn.example.test/prod/user-456/agent-123.png",
                        "s3_key": "prod/user-456/agent-123.png",
                    }
                )
            assert url.endswith((
                "/deployments/agent-123/files/workspace/a.txt",
                "/deployments/agent-123/files/AGENTS.md",
            ))
            assert params == {"destination": "auto"}
            assert content in {b"payload", b"instructions"}
            return FakeResponse(json_data={"status": "ok"})

        def delete(self, url, headers=None, params=None):
            assert url.endswith((
                "/deployments/agent-123/files/workspace/a.txt",
                "/deployments/agent-123/files/workspace/backup.txt",
            ))
            if url.endswith("/backup.txt"):
                assert params == {"source": "s3"}
            else:
                assert params is None
            return FakeResponse(json_data={"status": "ok"})

    with patch("hypercli.agents.httpx.Client", FakeClient):
        agent = Agent(id="agent-123", user_id="user-456", pod_id="pod-789", pod_name="pod", state="running")

        entries = agents_client.files_list(agent, "workspace")
        hidden_entries = agents_client.files_list(agent, ".openclaw")
        root_entries = agents_client.files_list(agent, "/", source="pod")
        assert entries == [{"name": "dir", "type": "directory"}, {"name": "a.txt", "type": "file"}]
        assert hidden_entries == [{"name": "workspace", "type": "directory"}, {"name": "openclaw.json", "type": "file"}]
        assert root_entries == [{"name": "home", "path": "/home/", "type": "directory"}]
        assert agents_client.file_read(agent, "workspace/a.txt") == "hello"
        assert agents_client.file_read_bytes_with_metadata(agent, "workspace/a.txt") == {
            "content": b"hello",
            "mime_type": "text/plain",
        }
        assert agents_client.file_read(agent, "/etc/hosts", source="pod") == "127.0.0.1 localhost"
        assert agents_client.file_write_bytes(agent, "workspace/a.txt", b"payload") == {"status": "ok"}
        assert agents_client.file_write_bytes(
            agent, "/home/node/AGENTS.md", b"instructions"
        ) == {"status": "ok"}
        assert agents_client.file_delete(agent, "workspace/a.txt") == {"status": "ok"}
        assert agents_client.file_delete(
            agent,
            "workspace/backup.txt",
            source="s3",
        ) == {"status": "ok"}
        assert agents_client.upload_profile_image("agent-123", b"png") == {
            "id": "agent-123",
            "avatar_url": "https://cdn.example.test/prod/user-456/agent-123.png",
            "s3_key": "prod/user-456/agent-123.png",
        }
        with pytest.raises(ValueError, match=r"Path is a directory: \.openclaw"):
            agents_client.file_read(agent, ".openclaw")
        with pytest.raises(ValueError, match="source='pod'"):
            agents_client.files_list(agent, "/")
        with pytest.raises(ValueError, match="sync root"):
            agents_client.file_write(agent, "/etc/hosts", "blocked", destination="pod")
        with pytest.raises(ValueError, match="sync root"):
            agents_client.file_delete(agent, "/etc/hosts")


def test_agent_file_write_rejects_content_above_sdk_limit(agents_client):
    with pytest.raises(ValueError, match="250 MiB"):
        agents_client.file_write_bytes("agent-123", "too-large.bin", b"x" * (AGENT_FILE_MAX_BYTES + 1))


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


def test_agents_list_with_capacity_preserves_envelope(agents_client):
    payload = {
        "items": [
            {
                "id": "agent-1",
                "user_id": "user-456",
                "pod_id": "pod-1",
                "pod_name": "pod-1",
                "state": "RUNNING",
            }
        ],
        "total_agents": 1,
        "max_agents_per_account": 10,
        "running_agents": 1,
        "slots": {"large": {"granted": 3, "used": 1, "available": 2}},
        "agent_slots": [
            {
                "id": "slot-1",
                "entitlement_id": "ent-1",
                "plan_id": "pro",
                "size": "large",
                "agent_id": "agent-1",
                "occupied": True,
                "expires_at": "2026-09-01T00:00:00Z",
            }
        ],
        "pooled_tpd": 100_000_000,
    }
    with patch.object(agents_client, "_get", return_value=payload):
        capacity = agents_client.list_with_capacity()

    assert isinstance(capacity, AgentCapacity)
    assert capacity.items[0].id == "agent-1"
    assert capacity.max_agents_per_account == 10
    assert capacity.running_agents == 1
    assert capacity.slots["large"].available == 2
    assert capacity.agent_slots[0].plan_id == "pro"
    assert capacity.agent_slots[0].expires_at is not None
    assert capacity.pooled_tpd == 100_000_000


def test_agents_list_passes_filters(agents_client):
    with patch.object(agents_client, "_get", return_value={"items": []}) as get:
        assert agents_client.list(
            state="RUNNING",
            handle="coder",
            name="coder-agent",
            query="code",
            include_deleted=True,
        ) == []

    get.assert_called_once_with(
        "/deployments",
        params={
            "state": "RUNNING",
            "handle": "coder",
            "name": "coder-agent",
            "q": "code",
            "include_deleted": True,
        },
    )


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
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
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
            "sync_enabled": False,
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

    updated = agents_client.update(
        "agent-123",
        size="large",
        launch_config={
            "image": "ghcr.io/hypercli/hypercli-openclaw:custom",
            "env": {"FOO": "bar"},
        },
        refresh_from_lagoon=True,
    )
    assert updated.id == "agent-123"
    assert patch_calls[0] == (
        "/deployments/agent-123",
        {
            "size": "large",
            "launch_config": {
                "image": "ghcr.io/hypercli/hypercli-openclaw:custom",
                "env": {"FOO": "bar"},
            },
            "refresh_from_lagoon": True,
        },
    )
    assert "display_name" not in patch_calls[0][1]

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
            sync_uid=2000,
            sync_gid=2001,
            restart=False,
        )

        assert isinstance(agent, Agent)
        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["image"] == "python:3.12-alpine"
        assert posted_json["command"] == ["sh", "-c", "python -m http.server 80"]
        assert posted_json["routes"] == {"web": {"port": 80, "auth": False, "prefix": ""}}
        assert posted_json["sync_root"] == "/workspace"
        assert posted_json["sync_enabled"] is True
        assert posted_json["sync_uid"] == 2000
        assert posted_json["sync_gid"] == 2001
        assert posted_json["restart"] is False


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({}, {}),
        ({"sync_include": None}, {"sync_include": None}),
        ({"sync_exclude": None}, {"sync_exclude": None}),
        ({"sync_include": []}, {"sync_include": []}),
    ],
)
def test_agents_start_preserves_sync_policy_presence(agents_client, kwargs, expected):
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "state": "PENDING",
        }

    agents_client._post = fake_post
    agents_client.start("11111111-1111-4111-8111-111111111111", **kwargs)

    actual = {key: value for key, value in posted.items() if key in {"sync_include", "sync_exclude"}}
    assert actual == expected


def test_agents_start_retains_backend_hydrated_launch_config(agents_client):
    with patch("httpx.Client") as mock_client_class, patch(
        "hypercli.agents.secrets.token_hex",
        return_value="unused-start-token",
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "buzz-agent",
            "state": "starting",
            "runtime": "opencode",
            "launch_config": {
                "image": "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
                "command": ["/usr/local/bin/buzz-acp"],
                "env": {"BUZZ_RELAY_URL": "wss://buzz.example.test"},
                "restart": False,
            },
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agent = agents_client.start(
            "11111111-1111-4111-8111-111111111111",
            restart=False,
        )

        assert agent.launch_config == {
            "image": "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
            "command": ["/usr/local/bin/buzz-acp"],
            "env": {"BUZZ_RELAY_URL": "wss://buzz.example.test"},
            "restart": False,
        }


def test_build_agent_launch_rejects_nested_launch_fields():
    with pytest.raises(ValueError, match="Launch settings must be top-level fields"):
        _build_agent_launch(
            {"env": {"FOO": "bar"}},
        )

    with pytest.raises(ValueError, match="Launch settings must be top-level fields"):
        _build_agent_launch(
            {"restart": False},
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


def test_agents_web_search_uses_subscription_token_header(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"web": {"results": [{"title": "HyperCLI", "url": "https://hypercli.com"}]}}
        mock_client.get.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        payload = agents_client.web_search("hypercli", count=1)

        assert payload["web"]["results"][0]["title"] == "HyperCLI"
        url = mock_client.get.call_args[0][0]
        kwargs = mock_client.get.call_args[1]
        assert url == "https://api.test.hypercli.com/agents/brave/res/v1/web/search"
        assert kwargs["headers"]["X-Subscription-Token"] == "sk-hyper-test123"
        assert kwargs["params"] == {"q": "hypercli", "count": 1}


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


def test_agents_purchase_entitlement_from_balance_can_extend_existing(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "grant": {"id": "grant-1", "type": "BALANCE"},
            "entitlement": {"id": "ent-1", "plan_id": "basic"},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.purchase_entitlement_from_balance(
            "basic",
            duration=3600,
            tags=["customer=acme"],
            extend_existing=True,
        )

        assert mock_client.post.call_args[0][0].endswith("/billing/balance/basic")
        assert mock_client.post.call_args[1]["json"] == {
            "duration": 3600,
            "tags": ["customer=acme"],
            "extend_existing": True,
        }


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


def test_agents_redeem_grant_code_can_request_extension(agents_client):
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

        agents_client.redeem_grant_code("promo-123", extend_existing=True)

        assert mock_client.post.call_args[0][0].endswith("/billing/grants/redeem")
        assert mock_client.post.call_args[1]["json"] == {"code": "promo-123", "extend_existing": True}


def test_openclaw_agent_resolve_gateway_token_uses_env_route():
    manager = Mock()
    manager.get.return_value = OpenClawAgent.from_dict({
        "id": "agent-123",
        "user_id": "user-456",
        "pod_id": "pod-789",
        "pod_name": "test-pod",
        "state": "running",
        "hostname": "openclaw-test.hypercli.com",
        "routes": {"openclaw": {"port": 18789, "auth": False}},
    })
    manager.env.return_value = {"env": {"OPENCLAW_GATEWAY_TOKEN": "gw-fetched"}}
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
    manager.get.assert_called_once_with("agent-123")
    manager.env.assert_called_once_with("agent-123")


def test_openclaw_agent_wait_for_gateway_context_retries_until_ready(monkeypatch):
    manager = Mock()
    manager.get.side_effect = [
        OpenClawAgent.from_dict({
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": None,
            "routes": {"openclaw": {"port": 18789, "auth": False}},
        }),
        OpenClawAgent.from_dict({
            "id": "agent-123",
            "user_id": "user-456",
            "pod_id": "pod-789",
            "pod_name": "test-pod",
            "state": "running",
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False}},
        }),
    ]
    manager.env.side_effect = [
        {"env": {"OPENCLAW_GATEWAY_TOKEN": "gw-fetched"}},
        {"env": {"OPENCLAW_GATEWAY_TOKEN": "gw-fetched"}},
    ]
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        _deployments=manager,
    )
    monkeypatch.setattr("hypercli.agents.time.sleep", lambda _seconds: None)

    context = agent.wait_for_gateway_context(timeout=0.1, retry_interval=0)

    assert context["gateway_token"] == "gw-fetched"
    assert context["hostname"] == "openclaw-test.hypercli.com"
    assert agent.gateway_token == "gw-fetched"
    assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
    assert manager.get.call_count == 2
    assert manager.env.call_count == 2


def test_openclaw_agent_gateway_resolves_missing_url_via_env_route():
    manager = Mock()
    manager._api_key = "sk-hyper-test123"
    manager._api_base = "https://api.test.hypercli.com"
    manager.get.return_value = OpenClawAgent.from_dict({
        "id": "agent-123",
        "user_id": "user-456",
        "pod_id": "pod-789",
        "pod_name": "test-pod",
        "state": "running",
        "hostname": "openclaw-test.hypercli.com",
        "routes": {"openclaw": {"port": 18789, "auth": False}},
    })
    manager.env.return_value = {"env": {"OPENCLAW_GATEWAY_TOKEN": "gw-fetched"}}
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_token="gw-inline",
        _deployments=manager,
    )

    gw = agent.gateway()

    assert gw.url == "wss://openclaw-test.hypercli.com"
    assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
    assert agent.gateway_token == "gw-fetched"
    manager.get.assert_called_once_with("agent-123")
    manager.env.assert_called_once_with("agent-123")


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


def test_bootstrap_inference_uses_agents_api_and_caller_timeout(agents_client):
    messages = [
        {"role": "system", "content": "Return JSON."},
        {"role": "user", "content": "Create the pack."},
    ]

    with patch("hypercli.agents.httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "model": "kimi-k2.6",
            "content": '{"files":[]}',
            "finish_reason": "stop",
            "usage": {"total_tokens": 10},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        payload = agents_client.bootstrap_inference(
            messages,
            response_format={"type": "json_object"},
            timeout=120.0,
        )

    mock_client_class.assert_called_once_with(timeout=120.0)
    mock_client.post.assert_called_once_with(
        f"{agents_client._api_base}/bootstrap",
        headers=agents_client._headers,
        json={
            "messages": messages,
            "response_format": {"type": "json_object"},
        },
    )
    assert payload["model"] == "kimi-k2.6"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agents_integration_lifecycle():
    api_key = os.environ.get("HYPER_API_KEY")
    if not api_key:
        pytest.skip("HYPER_API_KEY not set")

    from hypercli.http import HTTPClient
    import time

    http = HTTPClient(base_url="https://api.dev.hypercli.com", api_key=api_key)
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
