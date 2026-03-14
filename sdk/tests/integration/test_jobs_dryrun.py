from __future__ import annotations


def test_list_jobs(client):
    jobs = client.jobs.list()
    assert isinstance(jobs, list)


def test_create_dry_run_job(client):
    job = client.jobs.create(
        image="nvidia/cuda:12.0-base-ubuntu22.04",
        gpu_type="l4",
        command="echo hello",
        runtime=60,
        dry_run=True,
    )

    assert job.job_id == "dry-run"
    assert job.job_key == "dry-run"
    assert job.state.lower() == "dry_run"
    assert job.gpu_type.lower() == "l4"
    assert job.runtime == 60
    assert job.price_per_hour > 0
