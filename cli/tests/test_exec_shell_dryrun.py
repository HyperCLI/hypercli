from types import SimpleNamespace

from typer.testing import CliRunner

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


def test_claw_exec_alias(monkeypatch):
    called = {}

    def fake_exec_cmd(agent_id, command, timeout=30):
        called["agent_id"] = agent_id
        called["command"] = command
        called["timeout"] = timeout

    monkeypatch.setattr("hypercli_cli.agents.exec_cmd", fake_exec_cmd)

    result = runner.invoke(app, ["claw", "exec", "agent-1", "echo ok", "--timeout", "7"])

    assert result.exit_code == 0
    assert called == {"agent_id": "agent-1", "command": "echo ok", "timeout": 7}


def test_claw_shell_alias(monkeypatch):
    called = {}

    def fake_shell(agent_id):
        called["agent_id"] = agent_id

    monkeypatch.setattr("hypercli_cli.agents.shell", fake_shell)

    result = runner.invoke(app, ["claw", "shell", "agent-xyz"])

    assert result.exit_code == 0
    assert called["agent_id"] == "agent-xyz"
