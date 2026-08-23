from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
LOCK = "/tmp/hypercli-dev-control-plane.lock"


def _jobs(path: str) -> dict:
    workflow = ROOT / ".github" / "workflows" / path
    return yaml.safe_load(workflow.read_text(encoding="utf-8"))["jobs"]


def _run(job: dict, step_name: str) -> str:
    for step in job["steps"]:
        if step.get("name") == step_name:
            return str(step.get("run") or "")
    raise AssertionError(f"missing workflow step: {step_name}")


def _assert_shared(script: str) -> None:
    assert f"exec 9>{LOCK}" in script
    assert "flock --shared 9" in script


def test_all_live_sdk_integration_phases_share_the_dev_rollout_lock() -> None:
    jobs = _jobs("sdk-integration-tests.yml")
    for job_name, test_step in (
        ("ts-sdk-integration", "Run TS SDK integration tests"),
        ("python-sdk-integration", "Run Python SDK integration tests"),
    ):
        job = jobs[job_name]
        for step in (
            "Bootstrap live integration credentials",
            test_step,
            "Cleanup bootstrapped credentials",
        ):
            _assert_shared(_run(job, step))


def test_frontend_live_agent_workflows_share_the_dev_rollout_lock() -> None:
    agent_job = _jobs("e2e-agents.yml")["playwright-agents"]
    for step in (
        "Bootstrap isolated agents test user",
        "Run dockerized Playwright tests",
        "Cleanup isolated agents test user",
    ):
        _assert_shared(_run(agent_job, step))

    agent_e2e = _run(agent_job, "Run dockerized Playwright tests")
    assert "--dns-search=." in agent_e2e
