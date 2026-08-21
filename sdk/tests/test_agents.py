"""Tests for HyperClaw agents SDK."""

from __future__ import annotations

import copy
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, call, patch

import pytest

from hypercli.agents import (
    AGENT_RUNTIME_INACTIVE_STATES,
    AGENT_TRANSITIONAL_STATES,
    CANONICAL_AGENT_STATES,
    AGENT_FILE_MAX_BYTES,
    AGENT_FILE_OPERATION_TIMEOUT_SECONDS,
    AGENT_FILE_WRITE_MAX_BYTES,
    AGENT_FILE_TRANSFER_CHUNK_BYTES,
    AGENTS_API_PREFIX,
    Agent,
    AgentCapacity,
    AgentLaunchValueMutation,
    AgentRoutes,
    DEFAULT_AGENT_RUNTIME_SCOPES,
    DEFAULT_OPENCLAW_IMAGE,
    DEFAULT_OPENCLAW_PRO_IMAGE,
    DEFAULT_OPENCLAW_SYNC_EXCLUDE,
    DeploymentEvent,
    Deployments,
    OpenClawAgent,
    OpenClawProAgent,
    ExecResult,
    _build_agent_launch,
    _copy_complete_launch_config,
    agent_config_has_desktop,
    build_agent_config,
    build_openclaw_routes,
    flatten_launch_config,
    launch_config_has_desktop,
    is_agent_runtime_inactive_state,
    is_agent_transitional_state,
)
from hypercli.http import APIError, HTTPClient


def test_vendored_agents_openapi_matches_canonical_data_plane_routes():
    schema_path = Path(__file__).resolve().parents[2] / "docs" / "agents-openapi.json"
    schema = json.loads(schema_path.read_text())
    paths = schema["paths"]
    prefix = "/agents/deployments/{agent_id}"

    assert f"{prefix}/exec" not in paths
    assert f"{prefix}/metrics" not in paths
    for purpose in ("files", "metrics", "exec", "logs", "shell"):
        assert "post" in paths[f"{prefix}/{purpose}/token"]

    shell_request = schema["components"]["schemas"]["AgentShellTokenRequest"]
    assert set(shell_request["properties"]) == {"shell"}
    assert shell_request.get("required") == ["shell"]


def test_agent_from_dict_minimal():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "pending",
        }
    )

    assert agent.id == "agent-123"
    assert agent.state == "pending"
    assert agent.cpu == 0
    assert agent.memory == 0
    assert agent.routes == {}
    assert agent.managed is None


def test_agent_from_dict_hydrates_meta_status_without_state_change():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "RUNNING",
            "meta": {
                "status": {
                    "status": "error",
                    "namespace": "prod-agent-example",
                    "observed_state": None,
                    "reason": "missing_bound_pvc",
                    "message": "bounded detail",
                    "observed_at": "2026-08-20T00:00:00Z",
                },
                "other": "preserved",
            },
        }
    )

    assert agent.state == "RUNNING"
    assert agent.meta is not None
    assert agent.meta["status"]["status"] == "error"
    assert agent.meta["status"]["reason"] == "missing_bound_pvc"
    assert agent.meta["other"] == "preserved"


def test_deployment_event_hydrates_import_status_fields():
    event = DeploymentEvent.from_dict(
        {
            "type": "deployment.import_status",
            "agent_id": "agent-123",
            "status": "error",
            "namespace": "prod-agent-example",
            "observed_state": None,
            "reason": "missing_bound_pvc",
            "message": "PVC is absent",
            "observed_at": "2026-08-20T00:00:00Z",
        }
    )

    assert event.type == "deployment.import_status"
    assert event.agent_id == "agent-123"
    assert event.status == "error"
    assert event.namespace == "prod-agent-example"
    assert event.reason == "missing_bound_pvc"
    assert event.observed_at == "2026-08-20T00:00:00Z"


def test_agent_from_dict_hydrates_launch_epoch_and_future_state():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": "FUTURE_STATE",
            "launch_epoch": 4,
        }
    )

    assert agent.state == "FUTURE_STATE"
    assert agent.launch_epoch == 4


def test_agent_from_dict_parses_requested_size_and_rejects_unknown_size():
    agent = Agent.from_dict({"id": "agent-123", "state": "RUNNING", "requested_size": "large"})

    assert agent.requested_size == "large"
    with pytest.raises(ValueError, match="small, medium, large"):
        Agent.from_dict({"id": "agent-123", "state": "RUNNING", "requested_size": "huge"})


@pytest.mark.asyncio
async def test_subscribe_connects_before_rest_snapshot(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    calls: list[str] = []
    stop = asyncio.Event()
    transition = {
        "type": "deployment.transition",
        "agent_id": "agent-123",
        "state": "ARCHIVING",
        "reason": "archive_request",
        "error": None,
        "message": "Agent archive is being finalized",
    }

    monkeypatch.setattr(
        deployments,
        "_post",
        lambda path: (
            calls.append(path) or {"token": "token", "ws_url": "wss://events.test/ws/deployments"}
        ),
    )

    class FakeSocket:
        def __init__(self):
            self.messages = iter((json.dumps({"type": "ready"}), json.dumps(transition)))

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

    await deployments.subscribe(
        handler,
        stop_event=stop,
        on_ready=lambda: calls.append("rest"),
    )

    assert calls[:3] == ["/deployments/events/token", "auth", "rest"]
    assert [event.type for event in received] == ["deployment.transition"]
    assert received[-1].agent_id == "agent-123"
    assert received[-1].state == "ARCHIVING"
    assert received[-1].reason == "archive_request"
    assert received[-1].error is None
    assert received[-1].message == "Agent archive is being finalized"


@pytest.mark.asyncio
async def test_subscribe_reconnects_after_clean_disconnect_and_resyncs_again(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    calls: list[str] = []
    connection_count = 0
    transition = {
        "type": "deployment.transition",
        "agent_id": "agent-123",
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
    monkeypatch.setattr(
        deployments,
        "_post",
        lambda path: (
            calls.append(path) or {"token": "token", "ws_url": "wss://events.test/ws/deployments"}
        ),
    )

    class FakeSocket:
        def __init__(self, ordinal):
            messages = [json.dumps({"type": "ready"})]
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

    await deployments.subscribe(
        handler,
        stop_event=stop,
        on_ready=lambda: calls.append("rest"),
    )

    assert connection_count == 2
    assert stop.waits == 1
    assert calls == [
        "/deployments/events/token",
        "auth",
        "rest",
        "/deployments/events/token",
        "auth",
        "rest",
    ]
    assert [event.type for event in received] == ["deployment.transition"]


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
    ["CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"],
)
async def test_wait_running_async_accepts_every_canonical_transitional_state(
    monkeypatch, boot_state
):
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

    async def subscribe(handler, **kwargs):
        handler(DeploymentEvent(type="deployment.transition", agent_id="agent-123"))
        await asyncio.Event().wait()

    monkeypatch.setattr(deployments, "subscribe", subscribe)

    agent = await deployments.wait_running_async("agent-123", timeout=1)

    assert agent.state == "RUNNING"


@pytest.mark.asyncio
async def test_wait_running_ignores_terminal_snapshot_from_older_runtime(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    snapshots = iter(
        (
            {"id": "agent-123", "state": "FAILED", "launch_epoch": 9},
            {"id": "agent-123", "state": "RUNNING", "launch_epoch": 10},
        )
    )
    monkeypatch.setattr(deployments, "resolve_agent_id", lambda _value: "agent-123")
    monkeypatch.setattr(
        deployments,
        "get",
        lambda _value: Agent.from_dict(next(snapshots)),
    )

    async def subscribe(handler, **kwargs):
        handler(DeploymentEvent(type="deployment.transition", agent_id="agent-123"))
        await asyncio.Event().wait()

    monkeypatch.setattr(deployments, "subscribe", subscribe)

    agent = await deployments.wait_running_async(
        "agent-123",
        timeout=1,
        minimum_launch_epoch=10,
    )

    assert agent.state == "RUNNING"
    assert agent.launch_epoch == 10


@pytest.mark.asyncio
async def test_wait_running_reconciles_when_transition_event_is_missed(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    snapshots = iter(
        (
            {"id": "agent-123", "state": "STARTING", "launch_epoch": 10},
            {"id": "agent-123", "state": "RUNNING", "launch_epoch": 10},
        )
    )
    monkeypatch.setattr(deployments, "resolve_agent_id", lambda _value: "agent-123")
    monkeypatch.setattr(
        deployments,
        "get",
        lambda _value: Agent.from_dict(next(snapshots)),
    )

    async def subscribe(_handler, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(deployments, "subscribe", subscribe)

    agent = await deployments.wait_running_async(
        "agent-123",
        timeout=0.2,
        poll_interval=0.01,
        minimum_launch_epoch=10,
    )

    assert agent.state == "RUNNING"
    assert agent.launch_epoch == 10


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


def test_routes_api_supports_declarative_and_named_updates_for_an_owned_agent():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    agent_id = "11111111-1111-4111-8111-111111111111"

    with patch.object(deployments, "_get", return_value=_routes_response()) as get_request:
        state = deployments.get_routes(agent_id)
    get_request.assert_called_once_with(f"/deployments/{agent_id}/routes")
    assert state.routes["web"]["port"] == 3000

    with patch.object(deployments, "_put", return_value=_routes_response()) as put_request:
        deployments.set_routes(agent_id, {"web": {"port": 3000, "auth": True}})
    put_request.assert_called_once_with(
        f"/deployments/{agent_id}/routes",
        {
            "routes": {"web": {"port": 3000, "auth": True}},
        },
    )

    with patch.object(deployments, "_put", return_value=_routes_response()) as put_request:
        deployments.set_route(agent_id, "web app", {"port": 3000, "auth": False, "prefix": ""})
    put_request.assert_called_once_with(
        f"/deployments/{agent_id}/routes/web%20app",
        {"port": 3000, "auth": False, "prefix": ""},
    )

    with patch.object(deployments, "_delete", return_value=_routes_response()) as delete_request:
        deployments.remove_route(agent_id, "web app")
    delete_request.assert_called_once_with(f"/deployments/{agent_id}/routes/web%20app")


def test_access_identity_surfaces_agent_id_for_a_runtime_key():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    agent_id = "11111111-1111-4111-8111-111111111111"
    payload = {
        "user_id": "user-456",
        "auth_type": "orchestra_key",
        "agent_id": agent_id,
        "tags": ["agents:none", "runtime=agent", f"runtime_agent={agent_id}"],
        "capabilities": ["agents:self"],
        "key_id": "key-1",
        "key_name": "runtime",
        "team_id": "team-1",
        "plan_id": "plan-1",
    }

    with patch.object(deployments, "_get", return_value=payload) as get_request:
        identity = deployments.access_identity()

    get_request.assert_called_once_with("/deployments/auth/me")
    assert identity.agent_id == agent_id
    assert identity.is_agent_runtime_key
    assert identity.user_id == "user-456"
    assert identity.auth_type == "orchestra_key"
    assert identity.key_name == "runtime"


def test_access_identity_has_no_agent_id_for_a_user_credential():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )

    with patch.object(
        deployments,
        "_get",
        return_value={"user_id": "user-456", "auth_type": "user", "team_id": "team-1"},
    ):
        identity = deployments.access_identity()

    assert identity.agent_id is None
    assert not identity.is_agent_runtime_key
    assert identity.tags == []


def test_routes_api_targets_the_self_endpoints():
    """An Agent manages its own routes through the dedicated self surface.

    Its runtime key is scoped agents:none and cannot reach the parameterised
    path, so `self` must not be resolved to an id here.
    """

    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    envelope = {"routes": {}, "route_statuses": {}}

    with patch.object(deployments, "_get", return_value=envelope) as get:
        deployments.get_routes("self")
    get.assert_called_once_with("/deployments/self/routes")

    with patch.object(deployments, "_put", return_value=envelope) as put:
        deployments.set_route("self", "public", {"port": 3000, "auth": False})
    put.assert_called_once_with(
        "/deployments/self/routes/public", {"port": 3000, "auth": False}
    )

    with patch.object(deployments, "_delete", return_value=envelope) as delete:
        deployments.remove_route("self", "public")
    delete.assert_called_once_with("/deployments/self/routes/public")

def test_self_selector_is_limited_to_status():
    """An Agent reads its own status. It does not drive its own lifecycle."""

    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    agent_id = "11111111-1111-4111-8111-111111111111"
    response = {"id": agent_id, "user_id": "user-456", "state": "running"}

    with patch.object(
        deployments, "_get_by_id", return_value=Agent.from_dict(response)
    ) as get_by_id:
        assert deployments.get("self").id == agent_id
    get_by_id.assert_called_once_with("self")

    launch_config = build_agent_config()
    for operation in (
        lambda: deployments.start("self", launch_config),
        lambda: deployments.start_openclaw("self", launch_config),
        lambda: deployments.stop("self"),
    ):
        with pytest.raises(ValueError, match="only supported for status"):
            operation()


def test_restore_posts_bodyless_and_returns_restoring(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    response = {
        "id": "11111111-1111-4111-8111-111111111111",
        "user_id": "user-456",
        "state": "RESTORING",
    }
    post = Mock(return_value=response)
    monkeypatch.setattr(deployments, "_post", post)

    restored = deployments.restore(response["id"])

    assert restored.state == "RESTORING"
    post.assert_called_once_with(f"/deployments/{response['id']}/restore")


def test_explicit_lifecycle_methods_use_distinct_endpoints_and_states(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    agent_id = "11111111-1111-4111-8111-111111111111"
    responses = iter(
        [
            {"id": agent_id, "user_id": "user-456", "state": "CREATING"},
            {"id": agent_id, "user_id": "user-456", "state": "STARTING"},
            {"id": agent_id, "user_id": "user-456", "state": "STOPPING"},
            {"id": agent_id, "user_id": "user-456", "state": "ARCHIVING"},
            {"id": agent_id, "user_id": "user-456", "state": "RESTORING"},
        ]
    )
    post = Mock(side_effect=lambda *_args, **_kwargs: next(responses))
    monkeypatch.setattr(deployments, "_post", post)

    assert deployments.create(name="matrix-agent").state == "CREATING"
    launch_config = build_agent_config()
    assert deployments.start(agent_id, launch_config).state == "STARTING"
    assert deployments.stop(agent_id).state == "STOPPING"
    assert deployments.archive(agent_id).state == "ARCHIVING"
    assert deployments.restore(agent_id).state == "RESTORING"
    assert post.call_args_list[0].args == ("/deployments",)
    assert post.call_args_list[0].kwargs["json"]["name"] == "matrix-agent"
    assert "start" not in post.call_args_list[0].kwargs["json"]
    assert post.call_args_list[1:] == [
        call(
            f"/deployments/{agent_id}/start",
            json={"launch_config": launch_config},
        ),
        call(f"/deployments/{agent_id}/stop"),
        call(f"/deployments/{agent_id}/archive"),
        call(f"/deployments/{agent_id}/restore"),
    ]


def test_start_rejects_partial_config_and_preserves_explicit_empty_maps():
    deployments = Deployments(
        MagicMock(spec=HTTPClient),
        api_key="hyper_api_test",
        api_base="https://api.test.hypercli.com/agents",
    )
    agent_id = "11111111-1111-4111-8111-111111111111"
    with pytest.raises(ValueError, match="launch_config is incomplete"):
        deployments.start(agent_id, {})

    launch_config = build_agent_config()
    with patch.object(
        deployments,
        "_post",
        return_value={"id": agent_id, "state": "STARTING"},
    ) as post:
        deployments.start(agent_id, launch_config)
    post.assert_called_once_with(
        f"/deployments/{agent_id}/start",
        json={"launch_config": launch_config},
    )
    assert launch_config["env"] == {}
    assert launch_config["secrets"] == {}


def test_bound_agent_exposes_archive_transitional_projection():
    deployments = MagicMock()
    archived = Agent.from_dict({"id": "agent-123", "user_id": "user-456", "state": "ARCHIVING"})
    archived._deployments = deployments
    deployments.archive.return_value = archived
    agent = Agent.from_dict({"id": "agent-123", "user_id": "user-456", "state": "STOPPED"})
    agent._deployments = deployments

    assert agent.archive().state == "ARCHIVING"
    deployments.archive.assert_called_once_with("agent-123")


def test_agent_from_dict_hydrates_new_api_fields_without_image_url_fallback():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
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
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )

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
        agent = deployments.create_external_agent(
            name="external-agent", display_name="External", handle="external"
        )

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

    with patch.object(
        deployments, "_post", return_value={"relay_key": {"api_key": "hyper_api_next"}}
    ) as post:
        assert deployments.rotate_external_agent_key("external-123") == {
            "relay_key": {"api_key": "hyper_api_next"}
        }

    post.assert_called_once_with("/external-agents/external-123/keys/rotate")


def test_update_external_agent_uses_exact_id_and_preserves_explicit_nulls():
    http = Mock(spec=HTTPClient)
    deployments = Deployments(
        http, api_key="hyper_api_test", api_base="https://api.test.hypercli.com/agents"
    )
    response = {
        "id": "backend-external-id",
        "user_id": "user-456",
        "state": "inactive",
        "name": "external-agent-renamed",
        "display_name": None,
        "managed": False,
        "runtime": "openclaw",
    }

    with (
        patch.object(deployments, "_patch", return_value=response) as patch_request,
        patch.object(
            deployments,
            "resolve_agent_id",
            side_effect=AssertionError("external agent IDs must not use managed resolution"),
        ) as resolve_agent_id,
    ):
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
    ["STOPPED", "ARCHIVED", "DELETED", "FAILED"],
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
                "state": failed_state,
                "error": "WorkspaceSyncFailed",
                "message": "workspace sync failed",
            }
        ),
    )

    async def subscribe(_handler, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(deployments, "subscribe", subscribe)

    with pytest.raises(RuntimeError, match=failed_state):
        deployments.wait_running("agent-123", timeout=1, poll_interval=0)


def test_sync_wait_does_not_chain_missing_loop_probe(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)

    async def fail_wait(*_args, **_kwargs):
        raise TimeoutError("authoritative timeout")

    monkeypatch.setattr(deployments, "wait_for_state_async", fail_wait)

    with pytest.raises(TimeoutError, match="authoritative timeout") as exc_info:
        deployments.wait_for_state("agent-123", {"stopped"}, timeout=1)

    assert exc_info.value.__context__ is None


@pytest.mark.asyncio
async def test_sync_wait_rejects_running_loop_without_creating_coroutine(monkeypatch):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "hyper_api_test"
    deployments = Deployments(http)
    wait_async = Mock(side_effect=AssertionError("async operation must not be created"))
    monkeypatch.setattr(deployments, "wait_for_state_async", wait_async)

    with pytest.raises(RuntimeError, match="use wait_for_state_async"):
        deployments.wait_for_state("agent-123", {"stopped"}, timeout=1)

    wait_async.assert_not_called()


def test_agent_from_dict_hydrates_only_meta_ui():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
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
    CANONICAL_AGENT_STATES,
)
def test_agent_hydrates_canonical_lifecycle_state(state):
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": state,
        }
    )

    assert agent.state == state


def test_agent_hydrates_cluster_and_archive_timestamp():
    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "state": "ARCHIVED",
            "cluster_id": "cluster-current",
            "archived_at": "2026-08-09T12:00:00Z",
        }
    )

    assert agent.cluster_id == "cluster-current"
    assert agent.archived_at == datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)


def test_agent_lifecycle_state_classification_is_forward_open():
    assert CANONICAL_AGENT_STATES == (
        "CREATING",
        "STARTING",
        "RESTORING",
        "RUNNING",
        "STOPPING",
        "STOPPED",
        "ARCHIVING",
        "ARCHIVED",
        "FAILED",
        "DELETED",
    )
    assert AGENT_TRANSITIONAL_STATES == frozenset(
        {"CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"}
    )
    assert AGENT_RUNTIME_INACTIVE_STATES == frozenset(
        {"STOPPED", "ARCHIVING", "ARCHIVED", "FAILED", "DELETED"}
    )
    assert is_agent_transitional_state("archiving") is True
    assert is_agent_runtime_inactive_state("archived") is True
    assert is_agent_transitional_state("future_server_state") is False


@pytest.mark.parametrize(
    ("state", "is_transitioning", "is_archived", "is_deleted"),
    [
        ("ARCHIVING", True, False, False),
        ("ARCHIVED", False, True, False),
        ("DELETED", False, False, True),
    ],
)
def test_agent_exposes_archive_and_delete_state_semantics(
    state, is_transitioning, is_archived, is_deleted
):
    agent = Agent.from_dict({"id": "agent-123", "state": state})

    assert agent.is_transitioning is is_transitioning
    assert agent.is_archived is is_archived
    assert agent.is_deleted is is_deleted


def test_browser_desktop_url_preserves_redirect_query_and_forces_scale():
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        state="running",
        hostname="test.hypercli.com",
    )

    assert (
        agent.browser_desktop_url("jwt-123", redirect="vnc.html?autoconnect=1&resize=remote")
        == "https://desktop-test.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fautoconnect%3D1%26resize%3Dscale"
    )


def test_launch_config_desktop_detection_uses_explicit_config_not_pro_image():
    assert launch_config_has_desktop({"env": {"OPENCLAW_DESKTOP_ENABLED": "1"}}) is True
    assert (
        launch_config_has_desktop(
            {"routes": {"desktop": {"port": 3000, "auth": True, "prefix": "screen"}}}
        )
        is True
    )
    assert (
        launch_config_has_desktop(
            {"routes": {"browser": {"port": 3000, "auth": True, "prefix": "desktop"}}}
        )
        is True
    )
    assert launch_config_has_desktop({"image": DEFAULT_OPENCLAW_PRO_IMAGE}) is False
    assert (
        agent_config_has_desktop(
            {"routes": {"desktop": {"port": 3000, "auth": True, "prefix": "desktop"}}}
        )
        is True
    )


def test_flatten_launch_config_and_agent_has_desktop():
    launch_config = {
        "env": {"OPENCLAW_DESKTOP_ENABLED": "0"},
        "routes": {"openclaw": {"port": 18789, "prefix": ""}},
    }

    assert flatten_launch_config(launch_config)["env.OPENCLAW_DESKTOP_ENABLED"] == "0"
    assert flatten_launch_config(launch_config)["routes.openclaw.port"] == 18789

    agent = Agent.from_dict(
        {
            "id": "agent-123",
            "user_id": "user-456",
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
        }
    )

    assert agent.gateway_url is None
    assert agent.gateway_token is None
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
            "state": "running",
            "hostname": "test.hypercli.com",
            "gateway_token": "must-not-hydrate",
        }
    )

    assert agent.gateway_url is None
    assert agent.gateway_token is None


def test_openclaw_agent_gateway_requires_url():
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="running",
    )
    with pytest.raises(ValueError, match="gateway_token is required"):
        agent.gateway()


def test_openclaw_agent_gateway_allows_jwtless_when_route_auth_disabled():
    manager = Mock()
    manager._api_key = "sk-hyper-test123"
    manager._api_base = "https://api.test.hypercli.com"
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        routes={"openclaw": {"port": 18789, "auth": False}},
        _deployments=manager,
    )

    gw = agent.gateway(gateway_token="gw123")
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
        state="running",
        gateway_url="wss://openclaw-test.hypercli.com",
        gateway_token="gw123",
        jwt_token="jwt123",
        routes={"openclaw": {"port": 18789, "auth": True}},
        _deployments=manager,
    )

    gw = agent.gateway(gateway_token="gw123")
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
        state="running",
        hostname="ready.hypercli.com",
    )
    ready._deployments = manager
    manager.wait_running.return_value = ready

    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="starting",
        hostname="ready.hypercli.com",
        _deployments=manager,
    )
    agent.wait_for_gateway_context = Mock(
        side_effect=AssertionError("wait_for_gateway_context should not be used by wait_running")
    )

    result = agent.wait_running(timeout=42, poll_interval=1.5)

    manager.wait_running.assert_called_once_with("agent-123", timeout=42, poll_interval=1.5)
    agent.wait_for_gateway_context.assert_not_called()
    assert result is agent
    assert agent.state == "running"


def test_agent_wait_running_delegates_to_deployments():
    manager = Mock()
    ready = Agent(
        id="agent-123",
        user_id="user-456",
        state="running",
        hostname="ready.hypercli.com",
    )
    ready._deployments = manager
    manager.wait_running.return_value = ready

    agent = Agent(
        id="agent-123",
        user_id="user-456",
        state="STARTING",
        launch_epoch=10,
        _deployments=manager,
    )

    result = agent.wait_running(timeout=42, poll_interval=1.5)

    manager.wait_running.assert_called_once_with(
        "agent-123",
        timeout=42,
        poll_interval=1.5,
        minimum_launch_epoch=10,
    )
    assert result is agent
    assert agent.state == "running"
    assert agent.hostname == "ready.hypercli.com"


def test_agent_reads_environment_and_exact_secrets_through_bound_deployments():
    manager = Mock()
    manager.env.return_value = {
        "agent_id": "agent-123",
        "env": {"MODE": "prod"},
        "launch_epoch": 10,
    }
    manager.secret_names.return_value = {
        "agent_id": "agent-123",
        "names": ["API_TOKEN"],
        "launch_epoch": 10,
    }
    manager.secret.return_value = {
        "agent_id": "agent-123",
        "key": "API_TOKEN",
        "value": "secret-value",
        "launch_epoch": 10,
    }
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        state="running",
        launch_epoch=10,
        _deployments=manager,
    )

    assert agent.env() == {"MODE": "prod"}
    assert agent.secret_names() == ["API_TOKEN"]
    assert agent.secret("API_TOKEN") == "secret-value"
    manager.env.assert_called_once_with("agent-123")
    manager.secret_names.assert_called_once_with("agent-123")
    manager.secret.assert_called_once_with("agent-123", "API_TOKEN")


def test_agent_mutates_environment_and_secrets_through_bound_deployments():
    manager = Mock()
    mutation = AgentLaunchValueMutation(
        agent_id="agent-123",
        key="API_TOKEN",
        present=True,
        launch_epoch=10,
    )
    manager.set_env.return_value = mutation
    manager.delete_env.return_value = mutation
    manager.set_secret.return_value = mutation
    manager.delete_secret.return_value = mutation
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        state="stopped",
        launch_epoch=10,
        _deployments=manager,
    )

    assert agent.set_env("MODE", "prod") is mutation
    assert agent.delete_env("MODE") is mutation
    assert agent.set_secret("API_TOKEN", "secret-value") is mutation
    assert agent.delete_secret("API_TOKEN") is mutation
    manager.set_env.assert_called_once_with("agent-123", "MODE", "prod")
    manager.delete_env.assert_called_once_with("agent-123", "MODE")
    manager.set_secret.assert_called_once_with("agent-123", "API_TOKEN", "secret-value")
    manager.delete_secret.assert_called_once_with("agent-123", "API_TOKEN")


def test_agent_rejects_secret_from_older_launch_epoch():
    manager = Mock()
    manager.secret.return_value = {"value": "stale", "launch_epoch": 9}
    agent = Agent(
        id="agent-123",
        user_id="user-456",
        state="running",
        launch_epoch=10,
        _deployments=manager,
    )

    with pytest.raises(RuntimeError, match="older launch epoch"):
        agent.secret("API_TOKEN")


@pytest.mark.asyncio
async def test_openclaw_agent_wait_ready_uses_gateway_client():
    agent = OpenClawAgent(
        id="agent-ready",
        user_id="user-456",
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
    assert applied[5]["channels"]["slack"]["accounts"]["work"]["channels"]["C123"]["users"] == [
        "U123"
    ]
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
        state="running",
        _deployments=manager,
    )

    assert agent.exec(["ls"]).stdout == "done"
    manager.exec.assert_called_once_with(agent, ["ls"], timeout=30, dry_run=False)

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
    launch = _build_agent_launch(
        {"foo": "bar"},
        env={"FOO": "bar"},
        secrets={"APP_TOKEN": "opaque"},
        command=["echo", "hello"],
        entrypoint=["/bin/sh", "-c"],
        routes={"web": {"port": 80, "prefix": ""}},
        restart=False,
        runtime_scopes=["models:*", "workspaces:*"],
    )

    assert launch["config"] == {"foo": "bar"}
    assert launch["env"] == {"FOO": "bar"}
    assert launch["secrets"] == {"APP_TOKEN": "opaque"}
    assert launch["command"] == ["echo", "hello"]
    assert launch["entrypoint"] == ["/bin/sh", "-c"]
    assert launch["routes"] == {"web": {"port": 80, "prefix": ""}}
    assert launch["restart"] is False
    assert launch["runtime_scopes"] == ["models:*", "workspaces:*"]


def test_build_agent_launch_rejects_env_secret_collisions():
    with pytest.raises(ValueError, match="both env and secrets"):
        _build_agent_launch({}, env={"TOKEN": "public"}, secrets={"TOKEN": "secret"})


def test_build_agent_launch_is_name_blind_for_application_keys():
    launch = _build_agent_launch(
        {},
        env={"OPENCLAW_GATEWAY_TOKEN": "opaque-env"},
        secrets={"API_SERVER_KEY": "opaque-secret"},
    )
    assert launch["env"] == {"OPENCLAW_GATEWAY_TOKEN": "opaque-env"}
    assert launch["secrets"] == {"API_SERVER_KEY": "opaque-secret"}


def test_build_agent_launch_defaults_restart_to_false():
    launch = _build_agent_launch({})

    assert launch["restart"] is False


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({}, {}),
        ({"sync_include": None}, {"sync_include": None}),
        ({"sync_exclude": None}, {"sync_exclude": None}),
        ({"sync_include": []}, {"sync_include": []}),
        (
            {"sync_include": ["workspace"], "sync_exclude": ["workspace/tmp"]},
            {"sync_include": ["workspace"]},
        ),
    ],
)
def test_build_agent_launch_preserves_sync_policy_presence(kwargs, expected):
    launch = _build_agent_launch({}, **kwargs)

    assert {key: value for key, value in launch.items() if key.startswith("sync_")} == expected


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
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
        assert "HYPER_API_BASE" not in posted_json["env"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["sync_exclude"] == list(DEFAULT_OPENCLAW_SYNC_EXCLUDE)
        assert posted_json["routes"] == {
            "openclaw": {"port": 18789, "auth": False, "prefix": ""},
        }


def test_create_openclaw_respects_explicit_empty_routes(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
        assert "HYPER_API_BASE" not in posted_json["env"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["sync_exclude"] == list(DEFAULT_OPENCLAW_SYNC_EXCLUDE)
        assert posted_json["env"]["OPENCLAW_DESKTOP_ENABLED"] == "1"
        assert "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START" not in posted_json["env"]
        assert posted_json["routes"] == {
            "openclaw": {"port": 18789, "auth": False, "prefix": ""},
            "desktop": {"port": 3000, "auth": True, "prefix": "desktop"},
        }
        assert posted_json["runtime_scopes"] == DEFAULT_AGENT_RUNTIME_SCOPES
        assert isinstance(agent, OpenClawProAgent)


def test_create_openclaw_allows_hyper_api_base_override(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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


def test_create_openclaw_allows_workspaces_directory_override(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch(
            "hypercli.agents.secrets.token_hex",
            return_value="gw-token-123",
        ),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "starting",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(
            name="test-agent",
            env={"HYPER_WORKSPACES_DIR": "/home/node/custom-shared"},
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/custom-shared"


def test_create_openclaw_accepts_memory_index_options(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH"] == "1"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS"] == "60000"
        assert posted_json["env"]["OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES"] == "120"


def test_create_openclaw_accepts_workspaces_sync_options(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "starting",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        agents_client.create_openclaw(
            name="test-agent",
            workspaces_sync={
                "ready_only": False,
                "workspace": "team-knowledge",
            },
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
        assert posted_json["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_READY_ONLY"] == "0"
        assert posted_json["env"]["HYPER_WORKSPACES_SYNC_WORKSPACE"] == "team-knowledge"


def test_create_openclaw_rejects_workspaces_directory_in_typed_options(agents_client):
    with pytest.raises(ValueError, match="Set HYPER_WORKSPACES_DIR in env"):
        agents_client.create_openclaw(
            name="test-agent",
            workspaces_sync={"output_dir": "/home/node/CustomWorkspaces"},
        )


def test_create_openclaw_can_disable_workspaces_sync(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
    return Deployments(
        http=mock_http, api_key="sk-hyper-test123", api_base="https://api.test.hypercli.com"
    )


def test_create_omits_start_and_returns_creating_admission(mock_http):
    deployments = Deployments(
        http=mock_http,
        api_key="sk-hyper-test123",
        api_base="https://api.test.hypercli.com",
    )
    created = {
        "id": "agent-created",
        "user_id": "user-456",
        "state": "CREATING",
        "launch_epoch": 4,
    }
    with (
        patch.object(deployments, "_post", return_value=created) as post,
        patch.object(deployments, "wait_for_state") as wait,
    ):
        result = deployments.create(name="provisioned")

    assert result.state == "CREATING"
    body = post.call_args.kwargs["json"]
    assert "start" not in body
    wait.assert_not_called()


def test_agents_create_returns_openclaw_agent(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
            command=["nginx", "-g", "daemon off;"],
            entrypoint=["/docker-entrypoint.sh"],
            image="ghcr.io/hypercli/hypercli-openclaw:test",
            registry_url="ghcr.io",
            registry_auth={"username": "u", "password": "p"},
        )

        posted_json = mock_client.post.call_args[1]["json"]
        assert posted_json["env"] == {"FOO": "bar"}
        assert "secrets" not in posted_json
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
        assert "start" not in posted_json
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token is None
        assert agent.gateway_url is None
        assert agent.meta_ui is None
        assert agent._deployments is agents_client
        assert agent._submitted_launch_config == build_agent_config(
            env={"FOO": "bar"},
            command=["nginx", "-g", "daemon off;"],
            entrypoint=["/docker-entrypoint.sh"],
            image="ghcr.io/hypercli/hypercli-openclaw:test",
            registry_url="ghcr.io",
            registry_auth={"username": "u", "password": "p"},
        )
        assert "_submitted_launch_config" not in repr(agent)


def test_create_openclaw_defaults_sync_root(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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
        assert "sync_enabled" not in posted_json
        assert "HYPER_API_BASE" not in posted_json["env"]
        assert "HOME" not in posted_json["env"]


def test_start_openclaw_sends_complete_launch_config_wholesale(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-123"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "starting",
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        launch_config = build_agent_config()
        agents_client.start_openclaw("agent-123", launch_config)

        assert mock_client.post.call_args[1]["json"] == {"launch_config": launch_config}


def test_start_openclaw_preserves_restart_policy(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "starting",
            "hostname": "buzz-test.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        launch_config = build_agent_config(
            image="ghcr.io/hypercli/hypercli-buzz-opencode:latest",
            command=["/usr/local/bin/buzz-acp"],
            routes={},
            restart=False,
            runtime_scopes=["models:*"],
        )
        agents_client.start_openclaw("agent-123", launch_config)

        posted_json = mock_client.post.call_args[1]["json"]["launch_config"]
        assert posted_json["image"] == "ghcr.io/hypercli/hypercli-buzz-opencode:latest"
        assert posted_json["command"] == ["/usr/local/bin/buzz-acp"]
        assert posted_json["routes"] == {}
        assert posted_json["restart"] is False
        assert posted_json["runtime_scopes"] == ["models:*"]


def test_start_openclaw_pro_requires_complete_launch_config(agents_client):
    posted: dict = {}

    def fake_post(_path, json=None):
        posted.update(json or {})
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "state": "starting",
            "runtime": "openclaw-pro",
        }

    agents_client._post = fake_post
    launch_config = build_agent_config()
    agents_client.start_openclaw_pro("11111111-1111-4111-8111-111111111111", launch_config)

    assert posted == {"launch_config": launch_config}


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
    agents_client._post = lambda _path, json=None: (
        posted.update(json or {})
        or {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
            "state": "starting",
            "runtime": "openclaw",
        }
    )
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
            "state": "STARTING",
            "runtime": "openclaw",
        }

    agents_client._post = fake_post
    agent_id = "11111111-1111-4111-8111-111111111111"
    agents_client.start_openclaw(agent_id, build_agent_config())
    agents_client.start_openclaw(agent_id, build_agent_config(sync_include=None))

    assert "sync_include" not in posted[0]["launch_config"]
    assert posted[1]["launch_config"]["sync_include"] is None
    assert "sync_exclude" not in posted[1]["launch_config"]


_STORED_AGENT_ID = "11111111-1111-4111-8111-111111111111"


def _install_stored_projection(
    agents_client,
    launch_config: dict,
    *,
    secrets: dict[str, str] | None = None,
    launch_epoch: int = 3,
) -> list[str]:
    """Serve one stored agent projection plus its redacted-secret endpoints."""
    secret_values = dict(secrets or {})
    calls: list[str] = []

    def fake_get(path, params=None):
        calls.append(path)
        if path == f"{AGENTS_API_PREFIX}/{_STORED_AGENT_ID}":
            return {
                "id": _STORED_AGENT_ID,
                "user_id": "user-456",
                "state": "STOPPED",
                "launch_epoch": launch_epoch,
                "launch_config": copy.deepcopy(launch_config),
            }
        if path == f"{AGENTS_API_PREFIX}/{_STORED_AGENT_ID}/secrets":
            return {"names": sorted(secret_values), "launch_epoch": launch_epoch}
        for name, value in secret_values.items():
            if path == f"{AGENTS_API_PREFIX}/{_STORED_AGENT_ID}/secrets/{name}":
                return {"key": name, "value": value, "launch_epoch": launch_epoch}
        raise AssertionError(f"Unexpected GET {path}")

    agents_client._get = fake_get
    return calls


def test_start_rehydrates_redacted_projection_round_trip(agents_client):
    """get() -> start() must work even though the projection redacts two keys."""
    stored = build_agent_config(env={"MODE": "prod"})
    stored.pop("secrets")  # owner-facing projection redacts secret values
    stored.pop("registry_auth", None)  # ...and caller-held registry credentials
    _install_stored_projection(agents_client, stored, secrets={"API_TOKEN": "tok"})
    posted: dict = {}

    def fake_post(path, json=None):
        posted["path"] = path
        posted["json"] = json
        return {"id": _STORED_AGENT_ID, "user_id": "user-456", "state": "STARTING"}

    agents_client._post = fake_post
    agent = agents_client.start(_STORED_AGENT_ID, stored)

    assert agent.state == "STARTING"
    sent = posted["json"]["launch_config"]
    assert sent["secrets"] == {"API_TOKEN": "tok"}
    assert sent["registry_auth"] == {}
    assert sent["env"] == {"MODE": "prod"}
    assert "secrets" not in stored  # the caller's object is never mutated


def test_start_honours_explicitly_empty_redactable_keys(agents_client):
    """An explicit empty dict is not the same as an absent, redacted key."""
    stored = build_agent_config()
    assert stored["secrets"] == {}
    calls = _install_stored_projection(agents_client, stored, secrets={"API_TOKEN": "tok"})
    agents_client._post = lambda path, json=None: {
        "id": _STORED_AGENT_ID,
        "user_id": "user-456",
        "state": "STARTING",
    }

    agents_client.start(_STORED_AGENT_ID, stored)

    # No secret read-back happened: the caller said "no secrets" and meant it.
    assert not any(path.endswith("/secrets") for path in calls)


def test_start_refuses_to_invent_registry_auth_for_private_registry(agents_client):
    stored = build_agent_config(
        image="git.nedos.co/hypercli/private:sha",
        registry_url="git.nedos.co",
    )
    stored.pop("secrets")
    stored.pop("registry_auth", None)
    _install_stored_projection(agents_client, stored, secrets={"API_TOKEN": "tok"})

    with pytest.raises(ValueError, match="registry_auth is caller-held and write-only"):
        agents_client.start(_STORED_AGENT_ID, stored)


def test_start_openclaw_rehydrates_redacted_projection(agents_client):
    stored = build_agent_config(image="ghcr.io/hypercli/hypercli-openclaw:test")
    stored.pop("secrets")
    stored.pop("registry_auth", None)
    _install_stored_projection(
        agents_client, stored, secrets={"OPENCLAW_GATEWAY_TOKEN": "gw-token"}
    )
    posted: dict = {}

    def fake_post(path, json=None):
        posted["json"] = json
        return {"id": _STORED_AGENT_ID, "user_id": "user-456", "state": "STARTING"}

    agents_client._post = fake_post
    agents_client.start_openclaw(_STORED_AGENT_ID, stored)

    sent = posted["json"]["launch_config"]
    assert sent["secrets"]["OPENCLAW_GATEWAY_TOKEN"] == "gw-token"
    assert sent["registry_auth"] == {}


def test_start_hermes_agent_rehydrates_redacted_projection(agents_client):
    """The same redaction round-trip must hold for the Hermes helper.

    `get()` redacts `secrets` and `registry_auth`, so feeding that projection
    straight back to `start_hermes_agent` used to fail validation before it
    ever reached the Backend.
    """
    from hypercli.agents import HermesAgent, build_hermes_agent_routes

    stored = build_agent_config(image="ghcr.io/hypercli/hermes-agent:test")
    stored.pop("secrets")
    stored.pop("registry_auth", None)
    _install_stored_projection(
        agents_client, stored, secrets={"API_SERVER_KEY": "h" * 43}
    )
    posted: dict = {}

    def fake_post(path, json=None):
        posted["json"] = json
        return {
            "id": _STORED_AGENT_ID,
            "user_id": "user-456",
            "state": "STARTING",
            "runtime": "hermes-agent",
            "hostname": "hermes.example.test",
            "routes": build_hermes_agent_routes(),
        }

    agents_client._post = fake_post
    agent = agents_client.start_hermes_agent(_STORED_AGENT_ID, stored)

    sent = posted["json"]["launch_config"]
    assert sent["secrets"]["API_SERVER_KEY"] == "h" * 43
    assert sent["registry_auth"] == {}
    assert isinstance(agent, HermesAgent)
    # The recovered key is returned rather than silently rotated.
    assert agent.api_server_key == "h" * 43
    assert "secrets" not in stored  # the caller's object is never mutated


def test_agents_get_returns_generic_agent_without_gateway_metadata(agents_client):
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
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


def test_agents_file_ops_mint_fresh_tokens_then_call_reef_directly(agents_client):
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

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.content

        def iter_bytes(self, chunk_size=None):
            assert chunk_size == AGENT_FILE_TRANSFER_CHUNK_BYTES
            yield self.content

    token_calls = []
    reef_calls = []

    class FakeClient:
        def __init__(self, timeout=None):
            assert timeout in (AGENT_FILE_OPERATION_TIMEOUT_SECONDS, 30.0, 10)
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers=None, params=None, follow_redirects=None):
            assert params is None
            assert headers == {"Authorization": "Bearer reef-token"}
            assert follow_redirects is False
            reef_calls.append(("GET", url))
            if url == "https://agent.example.test/_reef/directories":
                return FakeResponse(
                    json_data={
                        "type": "directory",
                        "directories": [
                            {"name": ".openclaw", "path": ".openclaw/", "type": "directory"},
                            {"name": "workspace", "path": "workspace/", "type": "directory"},
                        ],
                        "files": [{"name": "AGENTS.md", "path": "AGENTS.md", "type": "file"}],
                    }
                )
            if url == "https://agent.example.test/_reef/directories/workspace":
                return FakeResponse(
                    json_data={
                        "type": "directory",
                        "directories": [
                            {
                                "name": "dir",
                                "path": "workspace/dir/",
                                "type": "directory",
                            }
                        ],
                        "files": [
                            {
                                "name": "a.txt",
                                "path": "workspace/a.txt",
                                "type": "file",
                            }
                        ],
                    }
                )
            if url == "https://agent.example.test/_reef/files/workspace/a.txt":
                return FakeResponse(content=b"hello", headers={"content-type": "text/plain"})
            if url == "https://agent.example.test/_reef/directories/.openclaw":
                return FakeResponse(
                    json_data={
                        "type": "directory",
                        "prefix": ".openclaw/",
                        "directories": [{"name": "workspace", "type": "directory"}],
                        "files": [{"name": "openclaw.json", "type": "file"}],
                    },
                )
            if url == "https://agent.example.test/_reef/files/.openclaw":
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

        def stream(self, method, url, headers=None, follow_redirects=None):
            assert method == "GET"
            return self.get(url, headers=headers, follow_redirects=follow_redirects)

        def post(self, url, headers=None, params=None, content=None, json=None):
            if url.endswith("/deployments/agent-123/files/token"):
                assert headers["Authorization"] == "Bearer sk-hyper-test123"
                assert json is None
                token_calls.append(url)
                return FakeResponse(
                    json_data={
                        "url": "https://agent.example.test/_reef",
                        "token": "reef-token",
                        "expires_at": "2026-08-15T00:05:00Z",
                    }
                )
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
            raise AssertionError(url)

        def put(self, url, headers=None, content=None, follow_redirects=None):
            assert url == "https://agent.example.test/_reef/files/workspace/a.txt"
            assert headers == {
                "Authorization": "Bearer reef-token",
                "Content-Type": "application/octet-stream",
            }
            assert content == b"payload"
            assert follow_redirects is False
            reef_calls.append(("PUT", url))
            return FakeResponse(json_data={"status": "ok"})

        def delete(self, url, headers=None, params=None, follow_redirects=None):
            assert url == "https://agent.example.test/_reef/files/workspace/a.txt"
            assert headers == {"Authorization": "Bearer reef-token"}
            assert params is None
            assert follow_redirects is False
            reef_calls.append(("DELETE", url))
            return FakeResponse(json_data={"status": "ok"})

    with patch("hypercli.agents.httpx.Client", FakeClient):
        agent = Agent(id="agent-123", user_id="user-456", state="RUNNING")

        root_entries = agents_client.files_list(agent)
        entries = agents_client.files_list(agent, "workspace")
        hidden_entries = agents_client.files_list(agent, ".openclaw")
        assert root_entries == [
            {"name": ".openclaw", "path": ".openclaw/", "type": "directory"},
            {"name": "workspace", "path": "workspace/", "type": "directory"},
            {"name": "AGENTS.md", "path": "AGENTS.md", "type": "file"},
        ]
        assert entries == [
            {"name": "dir", "path": "workspace/dir/", "type": "directory"},
            {"name": "a.txt", "path": "workspace/a.txt", "type": "file"},
        ]
        assert hidden_entries == [
            {"name": "workspace", "type": "directory"},
            {"name": "openclaw.json", "type": "file"},
        ]
        assert agents_client.file_read(agent, "workspace/a.txt") == "hello"
        assert agents_client.file_read_bytes_with_metadata(agent, "workspace/a.txt") == {
            "content": b"hello",
            "mime_type": "text/plain",
        }
        assert agents_client.file_write_bytes(agent, "workspace/a.txt", b"payload") == {
            "status": "ok"
        }
        assert agents_client.file_delete(agent, "workspace/a.txt") == {"status": "ok"}
        assert agents_client.upload_profile_image("agent-123", b"png") == {
            "id": "agent-123",
            "avatar_url": "https://cdn.example.test/prod/user-456/agent-123.png",
            "s3_key": "prod/user-456/agent-123.png",
        }
        with pytest.raises(ValueError, match=r"Path is a directory: \.openclaw"):
            agents_client.file_read(agent, ".openclaw")
        with pytest.raises(ValueError, match="sync root"):
            agents_client.files_list(agent, "/")
        with pytest.raises(ValueError, match="sync root"):
            agents_client.file_write(agent, "/etc/hosts", "blocked")
        with pytest.raises(ValueError, match="sync root"):
            agents_client.file_delete(agent, "/etc/hosts")

    assert len(token_calls) == 8
    assert all("/deployments/agent-123/files/" not in url for _, url in reef_calls)


@pytest.mark.parametrize(
    "url",
    [
        "http://agent.example.test/_reef",
        "https://agent.example.test/_reef" + "-sync",
        "https://agent.example.test/_reef" + "_sync",
    ],
)
def test_agents_file_ops_reject_invalid_reef_locator(agents_client, url):
    agents_client._post = lambda *_args, **_kwargs: {
        "url": url,
        "token": "reef-token",
        "expires_at": "2026-08-15T00:05:00Z",
    }

    with pytest.raises(ValueError, match="invalid Agent file token"):
        agents_client.files_list("agent-123")


def test_agents_file_ops_preserve_reef_error_detail(agents_client):
    agents_client._post = lambda *_args, **_kwargs: {
        "url": "https://agent.example.test/_reef",
        "token": "reef-token",
        "expires_at": "2026-08-15T00:05:00Z",
    }
    response = Mock(status_code=403, text='{"detail":"forbidden"}')
    response.json.return_value = {"detail": "forbidden"}
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    response.read.return_value = b'{"detail":"forbidden"}'
    stream = MagicMock()
    stream.__enter__.return_value = response
    stream.__exit__.return_value = False
    client.stream.return_value = stream

    with patch("hypercli.agents.httpx.Client", return_value=client):
        with pytest.raises(APIError) as exc_info:
            agents_client.file_read("agent-123", "workspace/private.txt")

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "forbidden"


def test_agents_file_read_stops_at_limit_plus_one_without_buffering_rest(
    agents_client, monkeypatch
):
    agents_client._post = lambda *_args, **_kwargs: {
        "url": "https://agent.example.test/_reef",
        "token": "reef-token",
        "expires_at": "2026-08-15T00:05:00Z",
    }
    monkeypatch.setattr("hypercli.agents.AGENT_FILE_MAX_BYTES", 4)
    consumed = []

    class StreamingResponse:
        status_code = 200
        headers = {"content-type": "application/octet-stream"}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def iter_bytes(self, chunk_size=None):
            assert chunk_size == AGENT_FILE_TRANSFER_CHUNK_BYTES
            for chunk in (b"abcd", b"efgh", b"must-not-be-read"):
                consumed.append(chunk)
                yield chunk

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.stream.return_value = StreamingResponse()

    with patch("hypercli.agents.httpx.Client", return_value=client):
        with pytest.raises(ValueError) as exc_info:
            agents_client.file_read_bytes("agent-123", "workspace/large.bin")

    assert consumed == [b"abcd", b"efgh"]
    assert "Agent file reads are limited" in str(exc_info.value)


def test_agents_file_read_rejects_redirect_without_consuming_body(agents_client):
    agents_client._post = lambda *_args, **_kwargs: {
        "url": "https://agent.example.test/_reef",
        "token": "reef-token",
        "expires_at": "2026-08-15T00:05:00Z",
    }

    class RedirectResponse:
        status_code = 302
        headers = {"location": "https://elsewhere.example.test/file"}
        text = "redirect rejected"

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b"redirect rejected"

        def json(self):
            raise ValueError("not json")

        def iter_bytes(self, chunk_size=None):
            pytest.fail("redirect response body must not be streamed as file content")

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.stream.return_value = RedirectResponse()

    with patch("hypercli.agents.httpx.Client", return_value=client):
        with pytest.raises(APIError) as exc_info:
            agents_client.file_read_bytes("agent-123", "workspace/redirect.bin")

    assert exc_info.value.status_code == 302
    assert exc_info.value.detail == "redirect rejected"


@pytest.mark.parametrize("status_code", [301, 302, 307, 308])
def test_agents_file_list_rejects_redirects(agents_client, status_code):
    agents_client._post = lambda *_args, **_kwargs: {
        "url": "https://agent.example.test/_reef",
        "token": "reef-token",
        "expires_at": "2026-08-15T00:05:00Z",
    }
    response = Mock(status_code=status_code, text="redirect rejected")
    response.json.side_effect = ValueError("not json")
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.return_value = response

    with patch("hypercli.agents.httpx.Client", return_value=client):
        with pytest.raises(APIError) as exc_info:
            agents_client.files_list("agent-123")

    assert exc_info.value.status_code == status_code
    assert exc_info.value.detail == "redirect rejected"


def test_agent_file_write_rejects_content_above_sdk_limit(agents_client):
    # Cloudflare's edge caps request bodies on the agent hostname at 100 MB,
    # so writes must fail fast client-side before any HTTP traffic.
    assert AGENT_FILE_WRITE_MAX_BYTES == 100 * 1024 * 1024
    with patch("hypercli.agents.httpx.Client") as mock_client_class:
        with pytest.raises(ValueError, match="100 MiB"):
            agents_client.file_write_bytes(
                "agent-123", "too-large.bin", b"x" * (AGENT_FILE_WRITE_MAX_BYTES + 1)
            )
    mock_client_class.assert_not_called()


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
                    "state": "running",
                },
                {
                    "id": "agent-2",
                    "user_id": "user-456",
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


def test_agents_capacity_fallback_excludes_archive_and_delete_states(agents_client):
    payload = {
        "items": [
            {"id": "running", "state": "RUNNING"},
            {"id": "archiving", "state": "ARCHIVING"},
            {"id": "archived", "state": "ARCHIVED"},
            {"id": "deleted", "state": "DELETED"},
        ]
    }
    with patch("httpx.Client") as client_cls:
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = payload
        client_cls.return_value.__enter__.return_value.get.return_value = response

        capacity = agents_client.list_with_capacity()

    assert capacity.running_agents == 1


def test_agents_list_passes_filters(agents_client):
    with patch.object(agents_client, "_get", return_value={"items": []}) as get:
        assert (
            agents_client.list(
                state="RUNNING",
                handle="coder",
                name="coder-agent",
                query="code",
                include_deleted=True,
            )
            == []
        )

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
    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-123",
            "user_id": "user-456",
            "state": "starting",
            "hostname": "openclaw-test.hypercli.com",
            "routes": {"openclaw": {"port": 18789, "auth": False, "prefix": ""}},
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        launch_config = build_agent_config(
            image="ghcr.io/hypercli/hypercli-openclaw:test",
            command=["echo", "hello"],
            entrypoint=["/bin/sh", "-c"],
        )
        agent = agents_client.start("agent-123", launch_config)
        assert isinstance(agent, OpenClawAgent)
        assert agent.gateway_token is None
        assert mock_client.post.call_args[1]["json"] == {"launch_config": launch_config}

        mock_response.json.return_value["state"] = "stopping"
        stopped = agents_client.stop("agent-123")
        assert stopped.state == "stopping"

        delete_response = Mock()
        delete_response.status_code = 200
        delete_response.json.return_value = {
            "id": "agent-123",
            "state": "STOPPED",
            "deleted_at": "2026-08-14T12:00:00Z",
        }
        mock_client.delete.return_value = delete_response
        assert agents_client.delete("agent-123") == delete_response.json.return_value


def test_agents_update_and_resize(agents_client):
    patch_calls = []

    def fake_patch(path, json=None):
        patch_calls.append((path, json))
        return {
            "id": "agent-123",
            "user_id": "user-456",
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
    with (
        patch("httpx.Client") as mock_client_class,
        patch("hypercli.agents.secrets.token_hex", return_value="gw-token-generic"),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "agent-456",
            "user_id": "user-456",
            "state": "starting",
            "hostname": "generic.hypercli.com",
        }
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client_class.return_value = mock_client

        launch_config = build_agent_config(
            image="python:3.12-alpine",
            command=["sh", "-c", "python -m http.server 80"],
            routes={"web": {"port": 80, "auth": False, "prefix": ""}},
            sync_root="/workspace",
            sync_uid=2000,
            sync_gid=2001,
            restart=False,
        )
        agent = agents_client.start("agent-456", launch_config)

        assert isinstance(agent, Agent)
        posted_json = mock_client.post.call_args[1]["json"]["launch_config"]
        assert posted_json["image"] == "python:3.12-alpine"
        assert posted_json["command"] == ["sh", "-c", "python -m http.server 80"]
        assert posted_json["routes"] == {"web": {"port": 80, "auth": False, "prefix": ""}}
        assert posted_json["sync_root"] == "/workspace"
        assert "sync_enabled" not in posted_json
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
            "state": "STARTING",
        }

    agents_client._post = fake_post
    launch_config = build_agent_config(**kwargs)
    agents_client.start("11111111-1111-4111-8111-111111111111", launch_config)

    actual = {
        key: value
        for key, value in posted["launch_config"].items()
        if key in {"sync_include", "sync_exclude"}
    }
    assert actual == expected


def test_agents_start_retains_backend_hydrated_launch_config(agents_client):
    with (
        patch("httpx.Client") as mock_client_class,
        patch(
            "hypercli.agents.secrets.token_hex",
            return_value="unused-start-token",
        ),
    ):
        mock_client = MagicMock()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "user-456",
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

        submitted_launch = build_agent_config(restart=False)
        agent = agents_client.start(
            "11111111-1111-4111-8111-111111111111",
            submitted_launch,
        )

        assert agent.launch_config == {
            "image": "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
            "command": ["/usr/local/bin/buzz-acp"],
            "env": {"BUZZ_RELAY_URL": "wss://buzz.example.test"},
            "restart": False,
        }
        assert agent._submitted_launch_config == submitted_launch


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
        mock_response.json.return_value = {
            "web": {"results": [{"title": "HyperCLI", "url": "https://hypercli.com"}]}
        }
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

        result = agents_client.purchase_entitlement_from_balance(
            "basic", duration=3600, tags=["customer=acme"]
        )

        assert result["grant"]["type"] == "BALANCE"
        assert mock_client.post.call_args[0][0].endswith("/billing/balance/basic")
        assert mock_client.post.call_args[1]["json"] == {
            "duration": 3600,
            "tags": ["customer=acme"],
        }


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
        assert mock_client.post.call_args[1]["json"] == {
            "code": "promo-123",
            "extend_existing": True,
        }


def _openclaw_snapshot(*, hostname="openclaw-test.hypercli.com", launch_epoch=3):
    return OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="running",
        hostname=hostname,
        launch_epoch=launch_epoch,
    )


def test_deployments_environment_and_secret_routes(agents_client):
    agents_client.resolve_agent_id = Mock(return_value="agent-123")
    agents_client._get = Mock(
        side_effect=[{"env": {"FOO": "bar"}}, {"names": ["TOKEN"]}, {"value": "secret"}]
    )

    assert agents_client.env("openclaw-test") == {"env": {"FOO": "bar"}}
    assert agents_client.secret_names("openclaw-test") == {"names": ["TOKEN"]}
    assert agents_client.secret("openclaw-test", "A/B") == {"value": "secret"}
    assert agents_client._get.call_args_list == [
        call(f"{AGENTS_API_PREFIX}/agent-123/env"),
        call(f"{AGENTS_API_PREFIX}/agent-123/secrets"),
        call(f"{AGENTS_API_PREFIX}/agent-123/secrets/A%2FB"),
    ]


def test_deployments_environment_and_secret_mutation_routes(agents_client):
    agents_client.resolve_agent_id = Mock(return_value="agent-123")
    agents_client._patch = Mock(
        side_effect=[
            {"agent_id": "agent-123", "key": "A/B", "present": True, "launch_epoch": 4},
            {"agent_id": "agent-123", "key": "SECRET/KEY", "present": True, "launch_epoch": 4},
        ]
    )
    agents_client._delete = Mock(
        side_effect=[
            {"agent_id": "agent-123", "key": "A/B", "present": False, "launch_epoch": 4},
            {"agent_id": "agent-123", "key": "SECRET/KEY", "present": False, "launch_epoch": 4},
        ]
    )

    env_set = agents_client.set_env("openclaw-test", "A/B", "value")
    env_deleted = agents_client.delete_env("openclaw-test", "A/B")
    secret_set = agents_client.set_secret("openclaw-test", "SECRET/KEY", "secret-value")
    secret_deleted = agents_client.delete_secret("openclaw-test", "SECRET/KEY")

    assert env_set == AgentLaunchValueMutation("agent-123", "A/B", True, 4)
    assert env_deleted == AgentLaunchValueMutation("agent-123", "A/B", False, 4)
    assert secret_set == AgentLaunchValueMutation("agent-123", "SECRET/KEY", True, 4)
    assert secret_deleted == AgentLaunchValueMutation("agent-123", "SECRET/KEY", False, 4)
    assert not hasattr(secret_set, "value")
    assert agents_client._patch.call_args_list == [
        call(f"{AGENTS_API_PREFIX}/agent-123/env/A%2FB", json={"value": "value"}),
        call(
            f"{AGENTS_API_PREFIX}/agent-123/secrets/SECRET%2FKEY",
            json={"value": "secret-value"},
        ),
    ]
    assert agents_client._delete.call_args_list == [
        call(f"{AGENTS_API_PREFIX}/agent-123/env/A%2FB"),
        call(f"{AGENTS_API_PREFIX}/agent-123/secrets/SECRET%2FKEY"),
    ]


def test_openclaw_agent_gateway_resolves_url_from_refreshed_hostname():
    manager = Mock()
    manager._api_key = "sk-hyper-test123"
    manager._api_base = "https://api.test.hypercli.com"
    manager.get.return_value = _openclaw_snapshot()
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="running",
        gateway_token="gw-inline",
        _deployments=manager,
    )

    gw = agent.gateway()

    assert gw.url == "wss://openclaw-test.hypercli.com"
    assert agent.gateway_url == "wss://openclaw-test.hypercli.com"
    assert agent.gateway_token == "gw-inline"
    assert manager.get.call_count == 2
    manager.get.assert_called_with("agent-123")
    manager.secret.assert_not_called()


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

    agent = agents.create(name="test-integration", size="small")
    assert agent.id is not None
    agents.wait_for_state(agent.id, {"stopped"}, timeout=330)
    agents.start(agent.id, build_agent_config())

    try:
        for _ in range(24):
            time.sleep(5)
            agent = agents.get(agent.id)
            if agent.is_running:
                break
            if agent.state in ("failed", "stopped"):
                pytest.fail(f"Agent failed to start: {agent.state}")
        else:
            pytest.fail("Agent did not start within 2 minutes")

        result = agent.exec(["echo", "integration test"], timeout=10)
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


# --- wait_for_file_api_ready ------------------------------------------------
#
# The Agent domain is a wildcard, so a host with no route still resolves and
# the edge answers a plain-text 404 that is byte-identical to a route which has
# not converged yet. A probe that cannot tell those apart burns its whole
# deadline against an Agent that was never going to serve, and a probe that
# returns after one success hands the caller a route the edge is still settling.


class _FakeClock:
    """Advance monotonic time only when the code under test sleeps."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _install_file_api_probe(
    agents_client,
    monkeypatch,
    *,
    states,
    list_results,
):
    """Serve scripted get()/files_list() answers and a clock that only sleeps."""
    clock = _FakeClock()
    monkeypatch.setattr("hypercli.agents.time", clock)
    calls: list[str] = []
    state_queue = list(states)
    result_queue = list(list_results)

    def fake_get(_agent_id):
        calls.append("get")
        state = state_queue.pop(0) if len(state_queue) > 1 else state_queue[0]
        return Agent(id="agent-1", user_id="user-1", state=state)

    def fake_files_list(_agent_id, _path):
        calls.append("files_list")
        result = result_queue.pop(0) if len(result_queue) > 1 else result_queue[0]
        if isinstance(result, Exception):
            raise result
        return result

    agents_client.get = fake_get
    agents_client.files_list = fake_files_list
    return clock, calls


def test_wait_for_file_api_ready_returns_after_consecutive_successful_reads(
    agents_client, monkeypatch
):
    clock, calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=["RUNNING"],
        list_results=[[], [], []],
    )

    agents_client.wait_for_file_api_ready("agent-1", consecutive=2)

    assert calls.count("files_list") == 2
    assert clock.sleeps == [1.0]


def test_wait_for_file_api_ready_does_not_return_after_a_single_success(
    agents_client, monkeypatch
):
    """One success only proves the route answered once; the next can still 404."""
    clock, calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=["RUNNING"],
        list_results=[[], APIError(404, "page not found"), [], []],
    )

    agents_client.wait_for_file_api_ready("agent-1", consecutive=2)

    # Success, failure, success, success: the streak reset and had to rebuild.
    assert calls.count("files_list") == 4


def test_wait_for_file_api_ready_requires_the_full_streak_for_higher_counts(
    agents_client, monkeypatch
):
    _clock, calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=["RUNNING"],
        list_results=[[], [], [], []],
    )

    agents_client.wait_for_file_api_ready("agent-1", consecutive=3)

    assert calls.count("files_list") == 3


@pytest.mark.parametrize("dead_state", ["DELETED", "FAILED", "deleted", "failed"])
def test_wait_for_file_api_ready_fails_immediately_for_a_dead_agent(
    agents_client, monkeypatch, dead_state
):
    """Waiting longer cannot help, so do not spend the deadline discovering that."""
    _clock, calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=[dead_state],
        list_results=[[]],
    )

    with pytest.raises(RuntimeError) as exc_info:
        agents_client.wait_for_file_api_ready("agent-1", timeout=90.0)

    message = str(exc_info.value)
    assert dead_state.upper() in message
    assert "agent-1" in message
    assert "files_list" not in calls
    assert not isinstance(exc_info.value, TimeoutError)


def test_wait_for_file_api_ready_recovers_when_a_dead_state_was_only_transient(
    agents_client, monkeypatch
):
    """State is re-read every poll, so a STARTING Agent is never prejudged."""
    _clock, calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=["STARTING", "RUNNING"],
        list_results=[APIError(404, "page not found"), [], []],
    )

    agents_client.wait_for_file_api_ready("agent-1", consecutive=2)

    assert calls.count("get") >= 2


def test_wait_for_file_api_ready_timeout_names_the_state_and_last_error(
    agents_client, monkeypatch
):
    _clock, _calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=["RUNNING"],
        list_results=[APIError(404, "page not found")],
    )

    with pytest.raises(TimeoutError) as exc_info:
        agents_client.wait_for_file_api_ready(
            "agent-1", timeout=5.0, consecutive=2, poll_seconds=1.0
        )

    message = str(exc_info.value)
    assert "agent-1" in message
    assert "2 " in message and "consecutive" in message
    assert "5s" in message
    assert "state=RUNNING" in message
    assert "page not found" in message


def test_wait_for_file_api_ready_timeout_reports_unknown_state_without_an_error(
    agents_client, monkeypatch
):
    """A streak that keeps resetting on a stateless Agent still names why."""
    _clock, _calls = _install_file_api_probe(
        agents_client,
        monkeypatch,
        states=[""],
        list_results=[[], APIError(503, "upstream not ready")],
    )

    with pytest.raises(TimeoutError) as exc_info:
        agents_client.wait_for_file_api_ready(
            "agent-1", timeout=3.0, consecutive=2, poll_seconds=1.0
        )

    assert "state=unknown" in str(exc_info.value)
    assert "upstream not ready" in str(exc_info.value)
