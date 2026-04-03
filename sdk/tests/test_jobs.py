from datetime import datetime, timedelta, timezone

from hypercli.jobs import Job, JobListPage, Jobs, get_job_tags, job_has_tags, normalize_job_tags


class DummyHTTP:
    def __init__(self):
        self.calls = []

    def get(self, path, params=None):
        self.calls.append(("get", path, params))
        return {
            "jobs": [
                {
                    "job_id": "job-1",
                    "job_key": "job-key-123",
                    "state": "running",
                    "gpu_type": "l40s",
                    "gpu_count": 1,
                    "region": "oh",
                    "interruptible": True,
                    "price_per_hour": 1.2,
                    "price_per_second": 0.0003,
                    "docker_image": "nvidia/cuda",
                    "runtime": 120,
                    "tags": ["team=ml", "env=prod"],
                }
            ]
        }

    def post(self, path, json=None, timeout=None):
        self.calls.append(("post", path, json, timeout))
        return {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 120,
            "tags": json.get("tags"),
        }


def test_job_from_dict_preserves_tags():
    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 120,
            "tags": ["team=ml"],
        }
    )

    assert job.tags == ["team=ml"]
    assert job.tag_map == {"team": "ml"}


def test_jobs_list_sends_repeated_tag_filters():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.list(state="running", tags={"team": "ml", "env": "prod"})

    assert result[0].tags == ["team=ml", "env=prod"]
    assert http.calls[0] == (
        "get",
        "/api/jobs",
        {"state": "running", "tag": ["team=ml", "env=prod"]},
    )


def test_jobs_list_page_sends_backend_pagination():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.list_page(state="running", tags={"team": "ml"}, page=2, page_size=25)

    assert isinstance(result, JobListPage)
    assert result.jobs[0].job_id == "job-1"
    assert http.calls[0] == (
        "get",
        "/api/jobs",
        {"state": "running", "tag": ["team=ml"], "page": 2, "page_size": 25},
    )


def test_jobs_create_includes_tags():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.create(
        image="nvidia/cuda:12.0",
        command="echo hi",
        tags={"team": "ml", "env": "prod"},
    )

    assert result.tags == ["team=ml", "env=prod"]
    assert http.calls[0][2]["tags"] == ["team=ml", "env=prod"]


def test_job_from_dict_preserves_constraints():
    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "h200",
            "gpu_count": 8,
            "region": "br",
            "constraints": {"cpu_vendor": "amd"},
            "interruptible": True,
            "price_per_hour": 10.0,
            "price_per_second": 10.0 / 3600,
            "docker_image": "vllm/vllm-openai",
            "runtime": 120,
        }
    )

    assert job.constraints == {"cpu_vendor": "amd"}


def test_jobs_create_includes_constraints():
    http = DummyHTTP()
    jobs = Jobs(http)

    jobs.create(
        image="nvidia/cuda:12.0",
        command="echo hi",
        constraints={"cpu_vendor": "intel"},
    )

    assert http.calls[0][2]["constraints"] == {"cpu_vendor": "intel"}


def test_job_from_dict_derives_runtime_fields_from_started_at():
    started_at = datetime.now(timezone.utc) - timedelta(seconds=30)

    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 120,
            "elapsed": 0,
            "time_left": 0,
            "created_at": datetime.now(timezone.utc).timestamp(),
            "started_at": started_at.timestamp(),
        }
    )

    assert 25 <= job.elapsed <= 35
    assert 85 <= job.time_left <= 95


def test_job_from_dict_falls_back_to_created_at_for_running_jobs():
    created_at = datetime.now(timezone.utc) - timedelta(seconds=45)

    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 300,
            "created_at": created_at.timestamp(),
            "started_at": None,
        }
    )

    assert 40 <= job.elapsed <= 50
    assert 250 <= job.time_left <= 260


def test_normalize_job_tags_supports_dict_and_list():
    assert normalize_job_tags({"team": "ml", "env": "prod"}) == {"team": "ml", "env": "prod"}
    assert normalize_job_tags(["team=ml", "env=prod"]) == {"team": "ml", "env": "prod"}


def test_get_job_tags_supports_job_and_dict_payloads():
    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 120,
            "tags": ["team=ml", "env=prod"],
        }
    )

    assert get_job_tags(job) == {"team": "ml", "env": "prod"}
    assert get_job_tags({"tags": ["team=ml", "env=prod"]}) == {"team": "ml", "env": "prod"}


def test_job_has_tags_matches_required_subset():
    job = Job.from_dict(
        {
            "job_id": "job-1",
            "job_key": "job-key-123",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 1,
            "region": "oh",
            "interruptible": True,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda",
            "runtime": 120,
            "tags": ["team=ml", "env=prod"],
        }
    )

    assert job.has_tags({"team": "ml"})
    assert job_has_tags(job, ["team=ml", "env=prod"])
    assert not job_has_tags(job, {"team": "ops"})
