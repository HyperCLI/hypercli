import asyncio
import json
from types import SimpleNamespace

import pytest
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
            assert command == ["tool", "-f", "exact value"]
            assert timeout == 9
            return SimpleNamespace(stdout="hi\n", stderr="", exit_code=0)

    fake_client = SimpleNamespace(jobs=FakeJobs())

    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)
    monkeypatch.setattr("hypercli_cli.jobs._resolve_job_id", lambda client, job_id: job_id)

    result = runner.invoke(
        app,
        ["jobs", "exec", FULL_JOB_ID, "--timeout", "9", "tool", "--", "-f", "exact value"],
    )

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
                docker_image="vllm/vllm-openai:kimi-k3",
                command="vllm serve moonshotai/Kimi-K3 --host 0.0.0.0 --port 8000",
                env_vars={"LD_LIBRARY_PATH": "/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu"},
                runtime=3600,
            )

    fake_client = SimpleNamespace(jobs=FakeJobs())

    monkeypatch.setattr("hypercli_cli.jobs.get_client", lambda: fake_client)

    result = runner.invoke(app, ["jobs", "get", FULL_JOB_ID])

    assert result.exit_code == 0
    assert "vllm serve moonshotai/Kimi-K3" in result.stdout
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

    result = runner.invoke(
        app,
        ["agent", "exec", "agent-1", "echo", "ok", "--timeout", "7"],
    )

    assert result.exit_code == 0
    assert called == {"agent_id": "agent-1", "command": ["echo", "ok"], "timeout": 7}


def test_agent_exec_command_preserves_command_flags_after_separator(monkeypatch):
    called = {}

    def fake_exec_cmd(agent_id, command, timeout=30):
        called.update(agent_id=agent_id, command=command, timeout=timeout)

    monkeypatch.setattr("hypercli_cli.agents.exec_cmd", fake_exec_cmd)

    result = runner.invoke(
        app,
        ["agent", "exec", "agent-1", "tool", "--", "-f", "exact value"],
    )

    assert result.exit_code == 0
    assert called == {
        "agent_id": "agent-1",
        "command": ["tool", "-f", "exact value"],
        "timeout": 30,
    }


def test_agent_shell_command(monkeypatch):
    called = {}

    def fake_shell(agent_id):
        called["agent_id"] = agent_id

    monkeypatch.setattr("hypercli_cli.agents.shell", fake_shell)

    result = runner.invoke(app, ["agent", "shell", "agent-xyz"])

    assert result.exit_code == 0
    assert called["agent_id"] == "agent-xyz"


@pytest.mark.parametrize("code", [1001, 4401, 4403, 4404, 4409, 1008, 1011])
def test_agent_shell_output_surfaces_abnormal_close(code):
    class FakeWebSocket:
        close_code = code
        close_reason = "policy detail"

        def __aiter__(self):
            async def messages():
                if False:
                    yield ""

            return messages()

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(agents_module._read_agent_shell_output(FakeWebSocket()))
    assert str(exc_info.value) == f"Shell WebSocket closed with code {code}: policy detail"


def test_agent_shell_output_accepts_only_code_1000():
    class FakeWebSocket:
        close_code = 1000
        close_reason = ""

        def __aiter__(self):
            async def messages():
                if False:
                    yield ""

            return messages()

    asyncio.run(agents_module._read_agent_shell_output(FakeWebSocket()))


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


def test_agents_logs_defaults_to_tail_and_exits(monkeypatch):
    called = {}

    class FakeDeployments:
        async def logs_stream_ws(self, agent_id, tail_lines=100, follow=True):
            called.update(
                agent_id=agent_id,
                tail_lines=tail_lines,
                follow=follow,
            )
            yield "history line 1"
            yield "history line 2"

    monkeypatch.setattr("hypercli_cli.agents._resolve_agent", lambda _agent_id: "resolved-agent")
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    result = runner.invoke(app, ["agents", "logs", "fizz4"])

    assert result.exit_code == 0
    assert result.stdout == "history line 1\nhistory line 2\n"
    assert called == {
        "agent_id": "resolved-agent",
        "tail_lines": 100,
        "follow": False,
    }


@pytest.mark.parametrize("flag", ["-f", "--follow"])
def test_agents_logs_follow_streams_tail_then_live_lines(monkeypatch, flag):
    called = {}

    class FakeDeployments:
        async def logs_stream_ws(self, agent_id, tail_lines=100, follow=True):
            called.update(
                agent_id=agent_id,
                tail_lines=tail_lines,
                follow=follow,
            )
            yield "tail line"
            yield "live line"

    monkeypatch.setattr("hypercli_cli.agents._resolve_agent", lambda _agent_id: "resolved-agent")
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    result = runner.invoke(app, ["agents", "logs", "fizz4", flag])

    assert result.exit_code == 0
    assert result.stdout == "tail line\nlive line\n"
    assert called == {
        "agent_id": "resolved-agent",
        "tail_lines": 100,
        "follow": True,
    }


def test_agents_create_disables_desktop_by_default(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "create", "--dry-run", "--name", "demo"])

    assert result.exit_code == 0
    assert captured["env"]["OPENCLAW_DESKTOP_ENABLED"] == "0"
    assert captured["openclaw_route_options"] == {"include_desktop": False}
    assert "start" not in captured
    assert "Desktop:  disabled" in result.stdout


def test_agents_archive_is_an_explicit_non_launching_command(monkeypatch):
    calls = []

    class FakeDeployments:
        def archive(self, agent_id):
            calls.append(agent_id)
            return SimpleNamespace(id=agent_id, name="demo", state="ARCHIVING")

    monkeypatch.setattr("hypercli_cli.agents._resolve_agent", lambda value: value)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr("hypercli_cli.agents._save_agent_state", lambda _agent: None)

    result = runner.invoke(app, ["agents", "archive", "agent-123"])

    assert result.exit_code == 0
    assert calls == ["agent-123"]
    assert "Agent archiving: demo" in result.stdout


def test_agents_create_desktop_uses_openclaw_pro(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw_pro(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url="https://desktop-demo.hypercli.app",
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
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url="https://desktop-demo.hypercli.app",
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
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
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
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
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


def test_agents_create_include_takes_precedence():
    assert agents_module._sync_policy_kwargs(["workspace"], ["tmp"]) == {
        "sync_include": ["workspace"]
    }


def test_agents_create_rejects_removed_sync_all_option(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_openclaw(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-dryrun",
                name="agent-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                vnc_url=None,
                dry_run=True,
                shell_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "create", "--dry-run", "--sync-all"])

    assert result.exit_code != 0
    assert captured == {}


def test_agents_create_hermes_uses_first_class_runtime(monkeypatch):
    captured = {}

    class FakeDeployments:
        def create_hermes_agent(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                id="agent-hermes-dryrun",
                name="agent-hermes-dryrun",
                cpu=2,
                memory=2,
                state="validated",
                api_url="https://hermes-demo.hypercli.app",
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
        ],
    )

    assert result.exit_code == 0
    assert captured["image"] == DEFAULT_HERMES_AGENT_IMAGE
    assert captured["env"] is None
    assert captured["api_server_key"] is None
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured
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
            "launch_config": {
                "config": {"agents": {"defaults": {"mode": "normal"}}},
                "env": {
                    "HYPER_WORKSPACES_BOOT_SYNC": "1",
                    "HYPER_WORKSPACES_DIR": "/home/node/shared",
                    "OPENCLAW_DESKTOP_ENABLED": "0",
                },
                "image": "git.nedos.co/hypercli/hypercli-openclaw:untested",
                "routes": {"openclaw": {"port": 4096, "auth": True, "prefix": ""}},
                "restart": False,
                "runtime_scopes": ["agents:none", "models:*"],
                "sync_root": ".openclaw",
                "sync_include": ["workspace"],
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
    assert captured["env"]["HYPER_WORKSPACES_DIR"] == "/home/node/shared"
    assert captured["env"]["HYPER_WORKSPACES_SYNC_WORKSPACE"] == "docs"
    assert captured["image"] == "git.nedos.co/hypercli/hypercli-openclaw:untested"
    assert captured["routes"] == {"openclaw": {"port": 4096, "auth": True, "prefix": ""}}
    assert captured["restart"] is False
    assert captured["runtime_scopes"] == ["agents:none", "models:*"]
    assert captured["sync_root"] == ".openclaw"
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured
    assert captured["gateway_token"] is None


def test_agents_start_without_overrides_uses_protected_complete_launch(monkeypatch):
    calls: list[tuple[str, object]] = []
    launch_config = {
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

    def start(agent_id, supplied_launch):
        calls.append(("start", (agent_id, supplied_launch)))
        return SimpleNamespace(
            id=agent_id,
            name="steady-orbit-engine",
            state="STARTING",
        )

    def get(agent_id):
        calls.append(("get", agent_id))
        return SimpleNamespace(id="agent-123")

    monkeypatch.setattr(agents_module, "_resolve_agent", lambda _agent: "agent-123")
    monkeypatch.setattr(
        agents_module,
        "_get_deployments_client",
        lambda: SimpleNamespace(start=start, get=get),
    )
    monkeypatch.setattr(
        agents_module,
        "_load_state",
        lambda: {"agent-123": {"launch_config": launch_config}},
    )
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    result = runner.invoke(app, ["agents", "start", "steady-orbit-engine"])

    assert result.exit_code == 0
    assert calls == [
        ("get", "agent-123"),
        ("start", ("agent-123", launch_config)),
    ]
    assert "Agent starting: steady-orbit-engine" in result.output


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


def test_agents_start_omits_policy_to_inherit_saved_selective_policy(monkeypatch):
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
                dry_run=True,
                vnc_url=None,
            )

    monkeypatch.setattr("hypercli_cli.agents._load_state", dict)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(
        app,
        ["agents", "start", agent_id, "--dry-run"],
    )

    assert result.exit_code == 0
    assert "sync_include" not in captured
    assert "sync_exclude" not in captured


def test_agents_start_by_name_reuses_canonical_saved_launch_fields(monkeypatch):
    captured = {}
    canonical_id = "11111111-1111-4111-8111-111111111111"
    saved_state = {
        canonical_id: {
            "id": canonical_id,
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
            return SimpleNamespace(id=agent_id_arg, name="agent", dry_run=True, vnc_url=None)

    monkeypatch.setattr("hypercli_cli.agents._load_state", lambda: saved_state)
    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())

    result = runner.invoke(app, ["agents", "start", "clear-window-works", "--dry-run"])

    assert result.exit_code == 0
    assert captured["agent_id"] == canonical_id
    assert captured["env"]["SAVED"] == "1"
    assert captured["image"] == "git.nedos.co/hypercli/hypercli-openclaw:saved"
    assert captured["gateway_token"] is None


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
                "sync_root": "/home/hermes",
                "sync_exclude": ["shared/**"],
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

        def start_hermes_agent(self, agent_id_arg, launch_config, **kwargs):
            captured["agent_id"] = agent_id_arg
            captured["launch_config"] = launch_config
            captured.update(launch_config)
            captured.update(kwargs)
            return SimpleNamespace(id=agent_id_arg, name="hermes", dry_run=True, api_url=None)

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
        ],
    )

    assert result.exit_code == 0
    assert captured["agent_id"] == agent_id
    assert captured["api_server_key"] == "saved-api-server-key"
    assert captured["config"] == {"model": {"default": "hyper/model"}}
    assert captured["env"] == {"SAVED": "1", "NEW": "2"}
    assert captured["sync_root"] == "/home/hermes"
    assert captured["sync_exclude"] == ["shared/**"]
    assert captured["sync_uid"] == 10000
    assert captured["sync_gid"] == 10000
    assert "models:*" in captured["runtime_scopes"]
    assert "workspaces:*" in captured["runtime_scopes"]
    assert captured["dry_run"] is True
    assert "sync_include" not in captured


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

    monkeypatch.setattr(
        "hypercli_cli.agents._write_state",
        lambda value: saved.update(state=value),
    )

    result = runner.invoke(app, ["agents", "delete", "clear-window-works", "--force"])

    assert result.exit_code == 0
    assert deleted["agent_id"] == "canonical-id"
    assert "canonical-id" not in saved["state"]


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

    monkeypatch.setattr(
        "hypercli_cli.agents._write_state",
        lambda value: saved.update(state=value),
    )

    result = runner.invoke(app, ["agents", "token", "clear-window-works"])

    assert result.exit_code == 0
    assert saved["state"]["canonical-id"]["jwt_token"] == "new-token"


def test_agent_state_is_persisted_with_owner_only_permissions(monkeypatch, tmp_path):
    state_dir = tmp_path / ".hypercli"
    state_path = state_dir / "agents.json"
    state_dir.mkdir(mode=0o755)
    state_path.write_text("{}")
    state_path.chmod(0o644)
    monkeypatch.setattr(agents_module, "STATE_DIR", state_dir)
    monkeypatch.setattr(agents_module, "AGENTS_STATE", state_path)

    agents_module._write_state({"agent-1": {"api_server_key": "secret"}})

    assert state_dir.stat().st_mode & 0o777 == 0o700
    assert state_path.stat().st_mode & 0o777 == 0o600
    assert json.loads(state_path.read_text()) == {
        "agent-1": {"api_server_key": "secret"}
    }


def test_agents_cp_reports_directory_path_error(monkeypatch, tmp_path):
    class FakeDeployments:
        def cp_from(self, _pod, src_path, dst_path):
            assert src_path == ".openclaw"
            assert str(dst_path).endswith("download")
            raise ValueError("Path is a directory: .openclaw. Use files_list(path) instead.")

    monkeypatch.setattr("hypercli_cli.agents._get_deployments_client", lambda: FakeDeployments())
    monkeypatch.setattr("hypercli_cli.agents._get_agent_with_token", lambda agent_id: SimpleNamespace(id=agent_id))

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
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

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
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    result = runner.invoke(
        app,
        ["agents", "stop", "agent-123", "--force", "--wait"],
    )

    assert result.exit_code == 0
    assert calls == ["stop:agent-123", "wait:agent-123"]
    assert "Agent stopped" in result.output


def test_agents_restore_posts_bodyless_via_sdk(monkeypatch):
    calls: list[str] = []

    def restore(agent_id):
        calls.append(agent_id)
        return SimpleNamespace(id=agent_id, name="steady-orbit-engine", state="RESTORING")

    monkeypatch.setattr(agents_module, "_resolve_agent", lambda _agent: "agent-123")
    monkeypatch.setattr(
        agents_module,
        "_get_deployments_client",
        lambda: SimpleNamespace(restore=restore),
    )
    monkeypatch.setattr(agents_module, "_save_agent_state", lambda _agent: None)

    result = runner.invoke(app, ["agents", "restore", "steady-orbit-engine"])

    assert result.exit_code == 0
    assert calls == ["agent-123"]
    assert "Agent restoring: steady-orbit-engine" in result.output


def test_agents_list_uses_transitional_and_terminal_state_colors():
    assert agents_module._agent_state_style("CREATING") == "yellow"
    assert agents_module._agent_state_style("RESTORING") == "yellow"
    assert agents_module._agent_state_style("STOPPING") == "yellow"
    assert agents_module._agent_state_style("ARCHIVING") == "yellow"
    assert agents_module._agent_state_style("STOPPED") == "dim"
    assert agents_module._agent_state_style("ARCHIVED") == "dim"
    assert agents_module._agent_state_style("FAILED") == "red"
