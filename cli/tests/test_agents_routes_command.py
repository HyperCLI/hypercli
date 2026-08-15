from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app
from hypercli_cli import agents as agents_module


runner = CliRunner()


def _routes_state(**overrides):
    values = {
        "agent_id": "agent-123",
        "routes": {"web": {"port": 3000, "auth": True, "prefix": "app"}},
        "route_statuses": {"web": {"url": "https://app-agent.hypercli.app"}},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_routes_group_uses_declarative_help_text():
    result = runner.invoke(app, ["agents", "routes", "--help"])

    assert result.exit_code == 0
    assert "Manage declarative agent routes" in result.stdout


def test_routes_list_passes_self_and_prints_json(monkeypatch):
    captured = {}

    class FakeDeployments:
        def get_routes(self, target):
            captured["target"] = target
            return _routes_state()

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "routes", "list", "self", "--output", "json"])

    assert result.exit_code == 0
    assert captured == {"target": "self"}
    assert '"agent_id": "agent-123"' in result.stdout
    assert "https://app-agent.hypercli.app" in result.stdout


def test_routes_add_mutates_one_named_root_route(monkeypatch):
    captured = {}

    class FakeDeployments:
        def set_route(self, target, name, route):
            captured.update(target=target, name=name, route=route)
            return _routes_state(routes={name: route})

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "routes",
            "add",
            "self",
            "web",
            "--port",
            "3000",
            "--no-auth",
            "--root",
            "--output",
            "json",
        ],
    )

    assert result.exit_code == 0
    assert captured == {
        "target": "self",
        "name": "web",
        "route": {"port": 3000, "auth": False, "prefix": ""},
    }


def test_routes_add_rejects_prefix_with_root(monkeypatch):
    monkeypatch.setattr(
        agents_module,
        "_get_deployments_client",
        lambda: (_ for _ in ()).throw(AssertionError("client must not be created")),
    )

    result = runner.invoke(
        app,
        ["agents", "routes", "add", "self", "web", "-p", "3000", "--root", "--prefix", "app"],
    )

    assert result.exit_code != 0
    assert "mutually exclusive" in (result.stdout + result.stderr)


def test_routes_remove_mutates_only_the_named_route(monkeypatch):
    captured = {}

    class FakeDeployments:
        def remove_route(self, target, name):
            captured.update(target=target, name=name)
            return _routes_state(routes={}, route_statuses={})

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        ["agents", "routes", "remove", "self", "web"],
    )

    assert result.exit_code == 0
    assert captured == {"target": "self", "name": "web"}


def test_routes_add_surfaces_backend_route_limit(monkeypatch):
    class FakeDeployments:
        def set_route(self, *_args, **_kwargs):
            raise RuntimeError("at most 10 routes are allowed")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "routes", "add", "agent-123", "extra", "-p", "3000"])

    assert result.exit_code == 1
    assert "at most 10 routes are allowed" in result.stdout


def test_status_and_stop_pass_self_without_local_resolution(monkeypatch):
    captured = []
    agent = SimpleNamespace(
        id="agent-123",
        name="self-agent",
        handle=None,
        display_name=None,
        avatar_url=None,
        runtime="opencode",
        runtime_key_alias="runtime-key-1",
        cpu=4,
        memory=16,
        state="running",
        vnc_url=None,
        shell_url=None,
        created_at=None,
        started_at=None,
        stopped_at=None,
        jwt_expires_at=None,
        error=None,
        is_running=False,
    )

    class FakeDeployments:
        def get(self, target):
            captured.append(("get", target))
            return agent

        def stop(self, target):
            captured.append(("stop", target))
            agent.state = "stopping"
            return agent

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    status_result = runner.invoke(app, ["agents", "status", "self"])
    stop_result = runner.invoke(app, ["agents", "stop", "self", "--force"])

    assert status_result.exit_code == 0
    assert stop_result.exit_code == 0
    assert captured == [("get", "self"), ("stop", "self")]


def _complete_launch_config():
    return {
        "config": {},
        "image": "example/runtime:latest",
        "env": {},
        "secrets": {"TOKEN": "secret"},
        "routes": {},
        "command": [],
        "entrypoint": [],
        "restart": False,
        "sync_root": "/workspace",
        "sync_uid": 1000,
        "sync_gid": 1000,
        "registry_url": None,
        "registry_auth": {},
        "runtime_scopes": ["agents:none"],
    }


def test_start_self_uses_complete_locally_saved_launch(monkeypatch):
    captured = {}
    launch_config = _complete_launch_config()
    started = SimpleNamespace(
        id="agent-123",
        name="self-agent",
        dry_run=False,
    )

    class FakeDeployments:
        def get(self, target):
            captured["get"] = target
            return SimpleNamespace(id="agent-123")

        def start(self, target, supplied_launch, *, dry_run=False):
            captured["start"] = (target, supplied_launch, dry_run)
            return started

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(
        agents_module,
        "_load_state",
        lambda: {"agent-123": {"launch_config": launch_config}},
    )
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    result = runner.invoke(app, ["agents", "start", "self"])

    assert result.exit_code == 0
    assert captured == {
        "get": "self",
        "start": ("agent-123", launch_config, False),
    }


def test_start_self_dry_run_uses_saved_launch_and_resolved_uuid_without_saving(monkeypatch):
    captured = {}
    launch_config = _complete_launch_config()

    class FakeDeployments:
        def get(self, target):
            captured["get"] = target
            return SimpleNamespace(id="agent-123")

        def start(self, target, supplied_launch, *, dry_run=False):
            captured["start"] = (target, supplied_launch, dry_run)
            return SimpleNamespace(
                id="agent-123",
                name="self-agent",
                dry_run=True,
            )

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(
        agents_module,
        "_load_state",
        lambda: {"agent-123": {"launch_config": launch_config}},
    )
    monkeypatch.setattr(
        agents_module,
        "_save_agent_state",
        lambda _agent: (_ for _ in ()).throw(AssertionError("dry run must not save")),
    )

    result = runner.invoke(app, ["agents", "start", "self", "--dry-run"])

    assert result.exit_code == 0
    assert captured == {
        "get": "self",
        "start": ("agent-123", launch_config, True),
    }


def test_create_saved_input_drives_self_start_without_redacted_overwrite(monkeypatch, tmp_path):
    state_dir = tmp_path / ".hypercli"
    monkeypatch.setattr(agents_module, "STATE_DIR", state_dir)
    monkeypatch.setattr(agents_module, "AGENTS_STATE", state_dir / "agents.json")
    captured = {}

    def agent(*, state, submitted_launch=None):
        value = SimpleNamespace(
            id="11111111-1111-4111-8111-111111111111",
            name="self-agent",
            user_id="user-1",
            hostname="self-agent.hypercli.com",
            jwt_token=None,
            runtime="openclaw",
            launch_config={"image": "redacted"},
            state=state,
            dry_run=False,
            cpu=2,
            memory=4,
            vnc_url=None,
            shell_url=None,
        )
        if submitted_launch is not None:
            value._submitted_launch_config = submitted_launch
        return value

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            complete = _complete_launch_config()
            complete.update(
                image=kwargs["image"],
                secrets={"OPENCLAW_GATEWAY_TOKEN": kwargs["gateway_token"]},
                registry_url=kwargs["registry_url"],
                registry_auth=kwargs["registry_auth"],
            )
            captured["created_launch"] = complete
            return agent(state="STOPPED", submitted_launch=complete)

        def get(self, target):
            captured["get"] = target
            return agent(state="STOPPED")

        def start(self, target, supplied_launch, *, dry_run=False):
            captured["start"] = (target, supplied_launch, dry_run)
            return agent(state="STARTING")

    fake = FakeDeployments()
    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: fake)

    create_result = runner.invoke(
        app,
        [
            "agents",
            "create",
            "--gateway-token",
            "gateway-secret",
            "--registry-url",
            "registry.example",
            "--registry-username",
            "registry-user",
            "--registry-password",
            "registry-secret",
        ],
    )
    assert create_result.exit_code == 0
    saved_after_create = agents_module._load_state()
    assert saved_after_create["11111111-1111-4111-8111-111111111111"]["launch_config"] == captured[
        "created_launch"
    ]

    start_result = runner.invoke(app, ["agents", "start", "self"])

    assert start_result.exit_code == 0
    assert captured["get"] == "self"
    assert captured["start"] == (
        "11111111-1111-4111-8111-111111111111",
        captured["created_launch"],
        False,
    )
    saved_after_start = agents_module._load_state()
    assert saved_after_start["11111111-1111-4111-8111-111111111111"]["launch_config"] == captured[
        "created_launch"
    ]


def test_start_self_rejects_launch_overrides_before_calling_backend(monkeypatch):
    class FakeDeployments:
        def start(self, _target):
            raise AssertionError("backend must not be called")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "start", "self", "--image", "example/override"])

    assert result.exit_code == 1
    assert "partial overrides" in result.stdout


def test_start_self_fails_without_complete_local_launch(monkeypatch):
    class FakeDeployments:
        def get(self, target):
            assert target == "self"
            return SimpleNamespace(id="agent-123")

        def start(self, *_args, **_kwargs):
            raise AssertionError("incomplete launch must not be sent")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(agents_module, "_load_state", lambda: {})

    result = runner.invoke(app, ["agents", "start", "self"])

    assert result.exit_code == 1
    assert "complete launch configuration" in result.stdout
    assert "protected local state" in result.stdout
