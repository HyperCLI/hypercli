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


def test_routes_list_passes_the_agent_id_and_prints_json(monkeypatch):
    captured = {}

    class FakeDeployments:
        def get_routes(self, target):
            captured["target"] = target
            return _routes_state()

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "routes", "list", "agent-123", "--output", "json"])

    assert result.exit_code == 0
    assert captured == {"target": "agent-123"}
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
            "agent-123",
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
        "target": "agent-123",
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
        ["agents", "routes", "add", "agent-123", "web", "-p", "3000", "--root", "--prefix", "app"],
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
        ["agents", "routes", "remove", "agent-123", "web"],
    )

    assert result.exit_code == 0
    assert captured == {"target": "agent-123", "name": "web"}


def test_routes_add_surfaces_backend_route_limit(monkeypatch):
    class FakeDeployments:
        def set_route(self, *_args, **_kwargs):
            raise RuntimeError("at most 10 routes are allowed")

    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "routes", "add", "agent-123", "extra", "-p", "3000"])

    assert result.exit_code == 1
    assert "at most 10 routes are allowed" in result.stdout


def test_status_passes_self_without_local_resolution(monkeypatch):
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

    assert status_result.exit_code == 0
    assert captured == [("get", "self")]


def test_self_is_refused_for_stop_and_route_mutation(monkeypatch):
    """An Agent reads its own status; it does not stop itself or edit its routes."""
    monkeypatch.setattr(
        agents_module,
        "_get_deployments_client",
        lambda: (_ for _ in ()).throw(AssertionError("client must not be created")),
    )

    for argv in (
        ["agents", "stop", "self", "--force"],
        ["agents", "routes", "list", "self"],
        ["agents", "routes", "add", "self", "web", "-p", "3000"],
        ["agents", "routes", "remove", "self", "web"],
    ):
        result = runner.invoke(app, argv)
        assert result.exit_code == 1, argv
        assert "is not supported" in (result.stdout + result.stderr), argv


def test_start_rejects_the_self_target():
    """An Agent does not start itself; the owner drives lifecycle.

    `hyper agents status self` still works -- reading your own status is the
    one self operation that survives.
    """

    result = runner.invoke(app, ["agents", "start", "self"])
    assert result.exit_code != 0
    assert "self" in (result.output or "").lower()
