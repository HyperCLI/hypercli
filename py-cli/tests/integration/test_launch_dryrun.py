from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest


def _integration_env() -> dict[str, str]:
    env = os.environ.copy()
    api_key = env.get("HYPER_API_KEY") or env.get("TEST_API_KEY")
    api_base = env.get("HYPER_API_BASE") or env.get("TEST_API_BASE")
    if api_key:
        env["HYPER_API_KEY"] = api_key
    if api_base:
        env["HYPER_API_BASE"] = api_base
    return env


@pytest.mark.integration
@pytest.mark.parametrize(
    "launch_args",
    (
        ["launch"],
        ["instances", "launch"],
    ),
)
def test_hyper_launch_dry_run_uses_cli_against_live_backend(launch_args: list[str]) -> None:
    env = _integration_env()
    if not env.get("HYPER_API_KEY"):
        pytest.skip("HYPER_API_KEY or TEST_API_KEY is required")

    hyper = shutil.which("hyper")
    if not hyper:
        pytest.skip("hyper CLI is not installed")

    result = subprocess.run(
        [
            hyper,
            *launch_args,
            "nvidia/cuda:12.6.3-base-ubuntu22.04",
            "--gpu",
            "l40s",
            "--count",
            "1",
            "--region",
            "kr",
            "--runtime",
            "60",
            "--command",
            "nvidia-smi",
            "--dry-run",
            "--output",
            "json",
        ],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=90,
        check=False,
    )
    assert result.returncode == 0, result.stdout

    payload = json.loads(result.stdout)
    assert payload["job_id"] == "dry-run"
    assert payload["job_key"] == "dry-run"
    assert payload["state"].lower() == "dry_run"
    assert payload["gpu_type"].lower() == "l40s"
    assert payload["gpu_count"] == 1
    assert payload["runtime"] == 60
    assert payload["price_per_hour"] > 0
