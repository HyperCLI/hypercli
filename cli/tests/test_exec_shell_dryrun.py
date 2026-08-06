from types import SimpleNamespace

import pytest
from typer import BadParameter
from hypercli.agents import (
    AGENT_FILE_MAX_BYTES,
    DEFAULT_HERMES_AGENT_IMAGE,
    DEFAULT_OPENCLAW_PRO_IMAGE,
)
from typer.testing import CliRunner

from hypercli_cli import agents as agents_module
from hypercli_cli.cli import app

runner = CliRunner()
FULL_JOB_ID = "123e4567-e89b-12d3-a456-426614174000"


def test_jobs_exec_mock(monkeypatch):
    class FakeJobs:
        def exec(self, job_id, command, timeout=30):
            assert job_id == FULL_JOB_ID
            assert command == "echo hi"
            assert timeout == 9
            return SimpleNamespace(stdout="hi\n", stderr="", exit_code=0)

    fake_client = SimpleNamespace(jobs=FakeJobs())

    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)
    monkeypatch.setattr("hypercli_cli.jobs._resolve_job_id", lambda client, job_id: job_id)

    result = runner.invoke(app, ["jobs", "exec", FULL_JOB_ID, "echo hi", "--timeout", "9"])

    assert result.exit_code == 0
    assert "hi" in result.stdout


def test_jobs_get_shows_command_and_env(monkeypatch):
    class FakeJobs:
        def list(self):
            return [SimpleNamespace(job_id=FULL_JOB_ID)]

        def get(self, job_id):
            assert job_id == FULL_JOB_ID
            return SimpleNamespace(
                job_id=job_id,
                state="terminated",
                gpu_type="H200",
                gpu_count=8,
                region="oh",
                docker_image="vllm/vllm-openai:glm5",
                command="vllm serve zai-org/GLM-5-FP8 --host 0.0.0.0 --port 8000",
                env_vars={"LD_LIBRARY_PATH": "/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu"},
                runtime=3600,
            )

    fake_client = SimpleNamespace(jobs=FakeJobs())

    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(app, ["jobs", "get", FULL_JOB_ID])

    assert result.exit_code == 0
    assert "vllm serve zai-org/GLM-5-FP8" in result.stdout
    assert "LD_LIBRARY_PATH" in result.stdout


def test_instances_launch_dry_run_mock(monkeypatch):
    captured = {}

    class FakeJobs:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                job_id="job-dryrun",
                state="validated",
                gpu_type="l40s",
                gpu_count=1,
                region="oh",
                price_per_hour=1.23,
                runtime=300,
                cold_boot=False,
                hostname=None,
            )

    fake_client = SimpleNamespace(jobs=FakeJobs())
    monkeypatch.setattr("hypercli_cli.instances.get_client", lambda: fake_client)

    result = runner.invoke(
        app,
        [
            "instances",
            "launch",
            "nvidia/cuda:12.0-base-ubuntu22.04",
            "--dry-run",
            "--command",
            "echo hi",
            "--output",
            "json",
        ],
    )

    assert result.exit_code == 0
    assert captured["dry_run"] is True
    assert "job-dryrun" in result.stdout


def test_instances_launch_dry_run_includes_constraints(monkeypatch):
    captured = {}

    class FakeJobs:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                job_id="job-dryrun",
                state="validated",
                gpu_type="h200",
                gpu_count=8,
                region="br",
                constraints={"cpu_vendor": "amd"},
                price_per_hour=12.34,
                runtime=300,
                cold_boot=False,
                hostname=None,
            )

    fake_client = SimpleNamespace(jobs=FakeJobs())
    monkeypatch.setattr("hypercli_cli.instances.get_client", lambda: fake_client)

    result = runner.invoke(
        app,
        [
            "instances",
            "launch",
            "nvidia/cuda:12.0-base-ubuntu22.04",
            "--dry-run",
            "--gpu",
            "h200",
            "--count",
            "8",
            "--cpu-vendor",
            "amd",
            "--constraint",
            "stack=prod",
            "--output",
            "json",
        ],
    )

    assert result.exit_code == 0
    assert captured["constraints"] == {"cpu_vendor": "amd", "stack": "prod"}


def test_agent_exec_command(monkeypatch):
    called = {}

    def fake_exec_cmd(agent_id, command, timeout=30):
        called["agent_id"] = agent_id
        called["command"] = command
        called["timeout"] = timeout

    monkeypatch.setattr("hypercli_cli.agents.exec_cmd", fake_exec_cmd)

    result = runner.invoke(app, ["agent", "exec", "agent-1", "echo ok", "--timeout", "7"])

    assert result.exit_code == 0
    assert called == {"agent_id": "agent-1", "command": "echo ok", "timeout": 7}


def test_agent_shell_command(monkeypatch):
    called = {}

    def fake_shell(agent_id):
        called["agent_id"] = agent_id

    monkeypatch.setattr("hypercli_cli.agents.shell", fake_shell)

    result = runner.invoke(app, ["agent", "shell", "agent-xyz"])

    assert result.exit_code == 0
    assert called["agent_id"] == "agent-xyz"


def test_agents_logs_defaults_to_websocket_and_forwards_no_follow(monkeypatch):
    called = {}

    class FakeDeployments:
        async def logs_stream_ws(self, agent_id, tail_lines=100, follow=True):
            called.update(
                agent_id=agent_id,
                tail_lines=tail_lines,
                follow=follow,
            )
            yield "decoded [log] line"

    monkeypatch.setattr("hypercli_cli.agents._resolve_agent", lambda _agent_id: "resolved-agent")
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(
        "hypercli_cli.agents._get_pod_with_token",
        lambda _agent_id: (_ for _ in ()).throw(AssertionError("legacy executor selected")),
    )

    result = runner.invoke(
        app,
        ["agents", "logs", "fizz4", "--no-follow", "--lines", "7"],
    )

    assert result.exit_code == 0
    assert result.stdout == "decoded [log] line\n"
    assert called == {
        "agent_id": "resolved-agent",
        "tail_lines": 7,
        "follow": False,
    }


def test_agents_logs_executor_selects_legacy_stream(monkeypatch):
    called = {}
    pod = SimpleNamespace(id="resolved-agent")

    class FakeDeployments:
        def logs_stream(self, selected_pod, lines=100, follow=True):
            called.update(
                pod=selected_pod,
                lines=lines,
                follow=follow,
            )
            yield "legacy line"

    monkeypatch.setattr("hypercli_cli.agents._resolve_agent", lambda _agent_id: "resolved-agent")
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr("hypercli_cli.agents._get_pod_with_token", lambda _agent_id: pod)

    result = runner.invoke(
        app,
        ["agents", "logs", "fizz4", "--executor", "--no-follow", "-n", "3"],
    )

    assert result.exit_code == 0
    assert "legacy line" in result.stdout
    assert called == {
        "pod": pod,
        "lines": 3,
        "follow": False,
    }


def test_agents_create_disables_desktop_by_default(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "create", "--dry-run", "--name", "demo"])

    assert result.exit_code == 0
    assert captured["env"]["OPENCLAW_DESKTOP_ENABLED"] == "0"
    assert captured["openclaw_route_options"] == {"include_desktop": False}
    assert "Desktop:  disabled" in result.stdout


def test_agents_create_desktop_uses_openclaw_pro(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw_pro(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url="https://desktop-demo.hypercli.app",
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "create", "--dry-run", "--desktop", "--name", "demo"])

    assert result.exit_code == 0
    assert captured["env"]["OPENCLAW_DESKTOP_ENABLED"] == "1"
    assert captured["openclaw_route_options"] == {"include_desktop": True}
    assert captured["image"] == DEFAULT_OPENCLAW_PRO_IMAGE
    assert "https://desktop-demo.hypercli.app" in result.stdout


def test_agents_create_desktop_can_be_enabled_by_env(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw_pro(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url="https://desktop-demo.hypercli.app",
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        ["agents", "create", "--dry-run", "--env", "OPENCLAW_DESKTOP_ENABLED=True"],
    )

    assert result.exit_code == 0
    assert captured["env"]["OPENCLAW_DESKTOP_ENABLED"] == "True"
    assert captured["openclaw_route_options"] == {"include_desktop": True}


def test_agents_create_accepts_memory_index_flags(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "create",
            "--dry-run",
            "--index-on-session-start",
            "--index-on-search",
            "--index-watch",
            "--index-watch-debounce-ms",
            "60000",
            "--index-interval-minutes",
            "120",
        ],
    )

    assert result.exit_code == 0
    assert captured["memory_index"] == {
        "on_session_start": True,
        "on_search": True,
        "watch": True,
        "watch_debounce_ms": 60000,
        "interval_minutes": 120,
    }


def test_agents_create_sync_include_is_repeatable_and_wins_over_exclude(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "create",
            "--dry-run",
            "--sync-include",
            "workspace",
            "--sync-include",
            ".config/opencode",
            "--sync-exclude",
            "workspace/tmp",
        ],
    )

    assert result.exit_code == 0
    assert captured["sync_include"] == ["workspace", ".config/opencode"]
    assert "sync_exclude" not in captured


def test_agents_create_sync_all_rejects_selective_policy(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    with pytest.raises(BadParameter) as conflict:
        agents_module._sync_policy_kwargs(["workspace"], None, sync_all=True)
    assert str(conflict.value) == (
        "--sync-all cannot be combined with --sync-include or --sync-exclude"
    )

    result = runner.invoke(
        app,
        ["agents", "create", "--dry-run", "--sync-all", "--sync-include", "workspace"],
    )

    assert result.exit_code != 0
    assert captured == {}


def test_agents_create_sync_all_clears_saved_selective_policy(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                pod_name="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "create", "--dry-run", "--sync-all"])

    assert result.exit_code == 0
    assert captured["sync_all"] is True
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured


def test_agents_create_hermes_uses_first_class_runtime(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_hermes_agent(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-hermes-dryrun",
                pod_name="agent-hermes-dryrun",
                name="agent-hermes-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                api_url="https://hermes-demo.hypercli.app",
                ports=[],
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "create",
            "--runtime",
            "hermes-agent",
            "--dry-run",
            "--name",
            "demo",
            "--sync-all",
        ],
    )

    assert result.exit_code == 0
    assert captured["image"] == DEFAULT_HERMES_AGENT_IMAGE
    assert captured["env"] is None
    assert captured["api_server_key"] is None
    assert captured["sync_all"] is True
    assert "https://hermes-demo.hypercli.app" in result.stdout
    assert "Desktop" not in result.stdout


def test_agents_create_hermes_rejects_openclaw_only_flags(monkeypatch):
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: SimpleNamespace())

    result = runner.invoke(
        app,
        ["agents", "create", "--runtime", "hermes-agent", "--dry-run", "--desktop"],
    )

    assert result.exit_code != 0
    assert "Hermes Agent does not support OpenClaw-only" in result.stderr
    assert "options: desktop" in result.stderr


def test_agents_start_reuses_saved_launch_fields_but_inherits_backend_sync_policy(monkeypatch):
    captured = {}
    agent_id = "agent-123456789"

    saved_state = {
        agent_id: {
            "id": agent_id,
            "gateway_token": "saved-gateway-token",
            "launch_config": {
                "config": {"agents": {"defaults": {"mode": "normal"}}},
                "env": {
                    "HYPER_WORKSPACES_BOOT_SYNC": "1",
                    "HYPER_WORKSPACES_DIR": "/home/node/workspaces",
                    "OPENCLAW_DESKTOP_ENABLED": "0",
                },
                "image": "git.nedos.co/hypercli/hypercli-openclaw:untested",
                "routes": {"openclaw": {"port": 4096, "auth": True, "prefix": ""}},
                "restart": False,
                "runtime_scopes": ["agents:none", "models:*"],
                "sync_root": ".openclaw",
                "sync_enabled": True,
                "sync_include": [],
                "sync_exclude": ["ignored-because-include-wins"],
            },
        }
    }

    class FakeDeployments:
        def get(self, agent_ref):
            assert agent_ref == agent_id
            return SimpleNamespace(id=agent_id, launch_config=None, gateway_token=None)

        def start_openclaw(self, agent_id_arg, **kwargs):
            captured["agent_id"] = agent_id_arg
            captured.update(kwargs)
            return SimpleNamespace(
                id=agent_id_arg,
                pod_name="agent-pod",
                dry_run=True,
                vnc_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: saved_state)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        ["agents", "start", "agent-123", "--dry-run", "--env", "HYPER_WORKSPACES_SYNC_WORKSPACE=docs"],
    )

    assert result.exit_code == 0
    assert captured["agent_id"] == agent_id
    assert captured["config"] == {"agents": {"defaults": {"mode": "normal"}}}
    assert captured["env"]["HYPER_WORKSPACES_BOOT_SYNC"] == "1"
    assert captured["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/workspaces"
    assert captured["env"]["HYPER_WORKSPACES_SYNC_WORKSPACE"] == "docs"
    assert captured["image"] == "git.nedos.co/hypercli/hypercli-openclaw:untested"
    assert captured["routes"] == {"openclaw": {"port": 4096, "auth": True, "prefix": ""}}
    assert captured["restart"] is False
    assert captured["runtime_scopes"] == ["agents:none", "models:*"]
    assert captured["sync_root"] == ".openclaw"
    assert captured["sync_enabled"] is True
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured
    assert captured["gateway_token"] == "saved-gateway-token"


def test_agents_start_explicit_exclude_overrides_saved_include(monkeypatch):
    captured = {}
    agent_id = "agent-123456789"

    class FakeDeployments:
        def get(self, agent_ref):
            assert agent_ref == agent_id
            return SimpleNamespace(
                id=agent_id,
                gateway_token=None,
                launch_config={
                    "env": {"OPENCLAW_DESKTOP_ENABLED": "0"},
                    "sync_include": ["workspace"],
                },
            )

        def start_openclaw(self, agent_id_arg, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id=agent_id_arg,
                pod_name="agent-pod",
                dry_run=True,
                vnc_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._load_state", dict)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "start",
            agent_id,
            "--dry-run",
            "--sync-exclude",
            "workspace/tmp",
            "--sync-exclude",
            "workspace/cache",
        ],
    )

    assert result.exit_code == 0
    assert captured["sync_exclude"] == ["workspace/tmp", "workspace/cache"]
    assert "sync_include" not in captured


def test_agents_start_sync_all_clears_saved_selective_policy(monkeypatch):
    captured = {}
    agent_id = "agent-123456789"

    class FakeDeployments:
        def get(self, agent_ref):
            assert agent_ref == agent_id
            return SimpleNamespace(
                id=agent_id,
                gateway_token=None,
                launch_config={
                    "env": {"OPENCLAW_DESKTOP_ENABLED": "0"},
                    "sync_include": ["workspace"],
                },
            )

        def start_openclaw(self, agent_id_arg, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id=agent_id_arg,
                pod_name="agent-pod",
                dry_run=True,
                vnc_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._load_state", dict)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        ["agents", "start", agent_id, "--dry-run", "--sync-all"],
    )

    assert result.exit_code == 0
    assert captured["sync_all"] is True
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured


def test_agents_start_by_name_reuses_canonical_saved_launch_fields(monkeypatch):
    captured = {}
    canonical_id = "11111111-1111-4111-8111-111111111111"
    saved_state = {
        canonical_id: {
            "id": canonical_id,
            "gateway_token": "saved-gateway-token",
            "launch_config": {
                "env": {"OPENCLAW_DESKTOP_ENABLED": "0", "SAVED": "1"},
                "image": "git.nedos.co/hypercli/hypercli-openclaw:saved",
            },
        }
    }

    class FakeDeployments:
        def get(self, agent_ref):
            assert agent_ref == "clear-window-works"
            return SimpleNamespace(id=canonical_id, launch_config=None, gateway_token=None)

        def start_openclaw(self, agent_id_arg, **kwargs):
            captured["agent_id"] = agent_id_arg
            captured.update(kwargs)
            return SimpleNamespace(id=agent_id_arg, pod_name="agent-pod", dry_run=True, vnc_url=None)

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: saved_state)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "start", "clear-window-works", "--dry-run"])

    assert result.exit_code == 0
    assert captured["agent_id"] == canonical_id
    assert captured["env"]["SAVED"] == "1"
    assert captured["image"] == "git.nedos.co/hypercli/hypercli-openclaw:saved"
    assert captured["gateway_token"] == "saved-gateway-token"


def test_agents_start_hermes_reuses_saved_key_and_launch_fields(monkeypatch):
    captured = {}
    agent_id = "22222222-2222-4222-8222-222222222222"
    saved_state = {
        agent_id: {
            "id": agent_id,
            "runtime": "hermes-agent",
            "api_server_key": "saved-api-server-key",
            "launch_config": {
                "config": {"model": {"default": "hyper/model"}},
                "env": {"SAVED": "1"},
                "image": "ghcr.io/hypercli/hypercli-hermes-agent:saved",
                "routes": {"hermes-agent": {"port": 8642, "auth": False, "prefix": ""}},
                "sync_root": "/opt/data",
                "sync_uid": 10000,
                "sync_gid": 10000,
            },
        }
    }

    class FakeDeployments:
        def get(self, agent_ref):
            assert agent_ref == "hermes-demo"
            return SimpleNamespace(
                id=agent_id,
                runtime="hermes-agent",
                launch_config=None,
                api_server_key=None,
            )

        def start_hermes_agent(self, agent_id_arg, **kwargs):
            captured["agent_id"] = agent_id_arg
            captured.update(kwargs)
            return SimpleNamespace(id=agent_id_arg, pod_name="hermes-pod", dry_run=True, api_url=None)

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: saved_state)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        [
            "agents",
            "start",
            "hermes-demo",
            "--dry-run",
            "--env",
            "NEW=2",
            "--sync-all",
        ],
    )

    assert result.exit_code == 0
    assert captured["agent_id"] == agent_id
    assert captured["api_server_key"] == "saved-api-server-key"
    assert captured["config"] == {"model": {"default": "hyper/model"}}
    assert captured["env"] == {"SAVED": "1", "NEW": "2"}
    assert captured["sync_root"] == "/opt/data"
    assert captured["sync_uid"] == 10000
    assert captured["sync_gid"] == 10000
    assert captured["sync_all"] is True


def test_agents_delete_by_name_removes_canonical_state(monkeypatch):
    state = {"canonical-id": {"id": "canonical-id"}, "clear-window-works": {"id": "wrong"}}
    saved = {}
    deleted = {}

    class FakeDeployments:
        def resolve_agent_id(self, agent_ref):
            assert agent_ref == "clear-window-works"
            return "canonical-id"

        def delete(self, agent_id):
            deleted["agent_id"] = agent_id
            return {"status": "deleted"}

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: dict(state))
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    class FakeStateFile:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def write(self, payload):
            saved["payload"] = saved.get("payload", "") + payload

    monkeypatch.setattr(
        "builtins.open",
        lambda *args, **kwargs: FakeStateFile(),
    )

    result = runner.invoke(app, ["agents", "delete", "clear-window-works", "--force"])

    assert result.exit_code == 0
    assert deleted["agent_id"] == "canonical-id"
    assert '"canonical-id"' not in saved["payload"]


def test_agents_token_by_name_updates_canonical_state(monkeypatch):
    state = {"canonical-id": {"id": "canonical-id", "jwt_token": "old"}}
    saved = {}

    class FakeDeployments:
        def resolve_agent_id(self, agent_ref):
            assert agent_ref == "clear-window-works"
            return "canonical-id"

        def refresh_token(self, agent_id):
            assert agent_id == "canonical-id"
            return {"token": "new-token", "expires_at": "later"}

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: dict(state))
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    class FakeStateFile:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def write(self, payload):
            saved["payload"] = saved.get("payload", "") + payload

    monkeypatch.setattr(
        "builtins.open",
        lambda *args, **kwargs: FakeStateFile(),
    )

    result = runner.invoke(app, ["agents", "token", "clear-window-works"])

    assert result.exit_code == 0
    assert '"jwt_token": "new-token"' in saved["payload"]


def test_agents_cp_reports_directory_path_error(monkeypatch, tmp_path):
    class FakeDeployments:
        def cp_from(self, _pod, src_path, dst_path):
            assert src_path == ".openclaw"
            assert str(dst_path).endswith("download")
            raise ValueError("Path is a directory: .openclaw. Use files_list(path) instead.")

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr("hypercli_cli.agents._get_pod_with_token", lambda agent_id: SimpleNamespace(id=agent_id))

    result = runner.invoke(app, ["agents", "cp", "agent-xyz:.openclaw", str(tmp_path / "download")])

    assert result.exit_code == 1
    assert "Path is a directory: .openclaw." in result.stdout
    assert "Copy expects a file path, not a directory." in result.stdout


def test_agents_cp_rejects_oversized_local_file(monkeypatch, tmp_path):
    source = tmp_path / "big.bin"
    with source.open("wb") as f:
        f.truncate(AGENT_FILE_MAX_BYTES + 1)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: SimpleNamespace())

    result = runner.invoke(app, ["agents", "cp", str(source), "agent-xyz:workspace/big.bin"])

    assert result.exit_code == 1
    assert "Agent file writes are limited to 250 MiB" in result.stdout


def test_agents_web_search_command(monkeypatch):
    class FakeDeployments:
        def web_search(self, query, count=5):
            assert query == "hypercli"
            assert count == 1
            return {"web": {"results": [{"title": "HyperCLI", "url": "https://hypercli.com"}]}}

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "web-search", "hypercli", "--count", "1", "--json"])

    assert result.exit_code == 0
    assert '"HyperCLI"' in result.stdout


def test_agents_stop_reports_cleanup_in_progress(monkeypatch):
    class FakeDeployments:
        def stop(self, agent_id):
            assert agent_id == "agent-123"
            return SimpleNamespace(id=agent_id, state="stopping")

    monkeypatch.setattr(agents_module, "_resolve_agent", lambda _agent: "agent-123")
    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(agents_module, "_save_pod_state", lambda _pod: None)

    result = runner.invoke(app, ["agents", "stop", "agent-123", "--force"])

    assert result.exit_code == 0
    assert "Agent stopping" in result.output
    assert "Agent stopped" not in result.output


def test_agents_stop_waits_for_stopped(monkeypatch):
    calls: list[str] = []

    class FakeDeployments:
        def stop(self, agent_id):
            calls.append(f"stop:{agent_id}")
            return SimpleNamespace(id=agent_id, state="stopping")

        def wait_for_state(self, agent_id, states, *, timeout):
            assert states == {"stopped"}
            assert timeout == 900.0
            calls.append(f"wait:{agent_id}")
            return SimpleNamespace(id=agent_id, state="stopped")

    monkeypatch.setattr(agents_module, "_resolve_agent", lambda _agent: "agent-123")
    monkeypatch.setattr(agents_module, "_get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr(agents_module, "_save_pod_state", lambda _pod: None)
    monkeypatch.setattr(agents_module.time, "sleep", lambda _seconds: None)

    result = runner.invoke(
        app,
        ["agents", "stop", "agent-123", "--force", "--wait"],
    )

    assert result.exit_code == 0
    assert calls == ["stop:agent-123", "wait:agent-123"]
    assert "Agent stopped" in result.output


def test_agents_list_uses_transitional_and_terminal_state_colors():
    assert agents_module._agent_state_style("STOPPING") == "yellow"
    assert agents_module._agent_state_style("STOPPED") == "dim"
    assert agents_module._agent_state_style("FAILED") == "red"
