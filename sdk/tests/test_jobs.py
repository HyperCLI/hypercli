from hypercli.jobs import Job, JobListPage, Jobs


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
                    "tags": {"team": "ml", "env": "prod"},
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
            "tags": {"team": "ml"},
        }
    )

    assert job.tags == {"team": "ml"}


def test_jobs_list_sends_repeated_tag_filters():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.list(state="running", tags={"team": "ml", "env": "prod"})

    assert result[0].tags == {"team": "ml", "env": "prod"}
    assert http.calls[0] == (
        "get",
        "/api/jobs",
        {"state": "running", "tag": ["team:ml", "env:prod"]},
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
        {"state": "running", "tag": ["team:ml"], "page": 2, "page_size": 25},
    )


def test_jobs_create_includes_tags():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.create(
        image="nvidia/cuda:12.0",
        command="echo hi",
        tags={"team": "ml", "env": "prod"},
    )

    assert result.tags == {"team": "ml", "env": "prod"}
    assert http.calls[0][2]["tags"] == {"team": "ml", "env": "prod"}


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
