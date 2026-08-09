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
        last_error=None,
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


def test_start_self_uses_only_the_stored_backend_launch(monkeypatch):
    captured = {}
    started = SimpleNamespace(
        id="agent-123",
    )

    class FakeDeployments:
        def start(self, target):
            captured["start"] = target
            return started

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    result = runner.invoke(app, ["agents", "start", "self"])

    assert result.exit_code == 0
    assert captured == {"start": "self"}


def test_start_self_rejects_launch_overrides_before_calling_backend(monkeypatch):
    class FakeDeployments:
        def start(self, _target):
            raise AssertionError("backend must not be called")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "start", "self", "--image", "example/override"])

    assert result.exit_code == 1
    assert "backend-stored launch configuration" in result.stdout
