from __future__ import annotations


def test_list_jobs(client):
    jobs = client.jobs.list()
    assert isinstance(jobs, list)


def test_create_dry_run_job(client):
    types = client.instances.types(refresh=True)
    first_type = next(iter(types.values()))

    job = client.jobs.create(
        image="nvidia/cuda:12.0-base-ubuntu22.04",
        gpu_type=first_type.id,
        command="echo hello",
        runtime=60,
        dry_run=True,
    )

    assert job.job_id == "dry-run"
    assert job.job_key == "dry-run"
    assert job.state.lower() == "dry_run"
    assert job.gpu_type.lower() == first_type.id.lower()
    assert job.runtime == 60
    assert job.price_per_hour > 0


def test_create_dry_run_job_with_constraints(client):
    types = client.instances.types(refresh=True)
    constrained_type = next(
        (
            gpu
            for gpu in types.values()
            if any(config.constraints for config in gpu.configs)
        ),
        None,
    )

    if constrained_type is None:
        return

    constrained_config = next(config for config in constrained_type.configs if config.constraints)

    job = client.jobs.create(
        image="nvidia/cuda:12.0-base-ubuntu22.04",
        gpu_type=constrained_type.id,
        gpu_count=constrained_config.gpu_count,
        region=(constrained_config.regions or [None])[0],
        constraints=constrained_config.constraints,
        command="echo hello",
        runtime=60,
        dry_run=True,
    )

    assert job.job_id == "dry-run"
    assert job.constraints == constrained_config.constraints
