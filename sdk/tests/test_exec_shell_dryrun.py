import pytest

from hypercli.jobs import Jobs
from hypercli.agents import Agent, Deployments


class DummyHTTP:
    def __init__(self):
        self.api_key = "hyper_api_test_key"
        self.base_url = "https://api.hypercli.com"
        self.calls = []

    def post(self, path, json=None, timeout=None):
        self.calls.append(("post", path, json, timeout))
        if path.endswith("/exec"):
            return {"job_id": "job-1", "stdout": "ok\n", "stderr": "", "exit_code": 0}
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
            "command": "ZWNobyBoaQ==",
            "env_vars": {"FOO": "bar"},
            "runtime": 120,
            "cold_boot": False,
        }

    def get(self, path, params=None):
        if path == "/api/jobs/job-1":
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
                "command": "ZWNobyBoaQ==",
                "env_vars": {"FOO": "bar"},
                "runtime": 120,
            }
        return {}


def test_jobs_create_dry_run_payload():
    http = DummyHTTP()
    jobs = Jobs(http)

    jobs.create(image="nvidia/cuda:12.0", command="echo hi", dry_run=True)

    _, path, payload, _ = http.calls[0]
    assert path == "/api/jobs"
    assert payload["dry_run"] is True
    assert "command" in payload


def test_jobs_exec():
    http = DummyHTTP()
    jobs = Jobs(http)

    result = jobs.exec("job-1", "echo ok", timeout=15)

    assert result.exit_code == 0
    assert result.stdout == "ok\n"
    assert http.calls[0][1] == "/api/jobs/job-1/exec"


def test_jobs_get_decodes_command_and_preserves_env():
    http = DummyHTTP()
    jobs = Jobs(http)

    job = jobs.get("job-1")

    assert job.command == "echo hi"
    assert job.env_vars == {"FOO": "bar"}


@pytest.mark.asyncio
async def test_jobs_shell_connect(monkeypatch):
    http = DummyHTTP()
    jobs = Jobs(http)
    captured = {}

    async def fake_connect(url, ping_interval=20, ping_timeout=20):
        captured["url"] = url
        return "ws-conn"

    monkeypatch.setattr("websockets.connect", fake_connect)

    ws = await jobs.shell_connect("job-1", shell="/bin/sh")

    assert ws == "ws-conn"
    assert captured["url"] == "wss://api.hypercli.com/orchestra/ws/shell/job-1?token=job-key-123&shell=/bin/sh"


def test_agents_exec(monkeypatch):
    seen = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"exit_code": 0, "stdout": "done", "stderr": ""}

    class FakeClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url, headers=None, json=None):
            seen["json"] = json
            assert url.endswith("/deployments/agent-1/exec")
            assert json["command"] == "ls"
            return FakeResponse()

    monkeypatch.setattr("hypercli.agents.httpx.Client", FakeClient)

    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    pod = Agent(id="agent-1", user_id="u1", pod_id="p1", pod_name="pod", state="running")

    result = agents.exec(pod, "ls", timeout=10, dry_run=True)
    assert result.exit_code == 0
    assert result.stdout == "done"
    assert seen["json"]["dry_run"] is True


def test_deployments_normalize_generic_api_host_to_agents_base():
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test", api_base="https://api.dev.hypercli.com")
    assert agents._api_base == "https://api.dev.hypercli.com/agents"


@pytest.mark.asyncio
async def test_agents_shell_connect(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    captured_post = {}

    def fake_post(path, json=None):
        captured_post["path"] = path
        captured_post["json"] = json
        return {
            "jwt": "jwt-abc",
            "ws_url": "wss://api.agents.hypercli.com/ws/shell/agent-1?jwt=jwt-abc&shell=/bin/sh",
        }

    monkeypatch.setattr(agents, "_post", fake_post)
    monkeypatch.setattr(agents, "_detect_shell", lambda agent_id: "/bin/sh")
    captured = {}

    async def fake_connect(url, ping_interval=20, ping_timeout=20):
        captured["url"] = url
        return "agent-ws"

    monkeypatch.setattr("websockets.connect", fake_connect)

    ws = await agents.shell_connect("agent-1", dry_run=True)
    assert ws == "agent-ws"
    assert captured["url"] == "wss://api.agents.hypercli.com/ws/shell/agent-1?jwt=jwt-abc&shell=%2Fbin%2Fsh"
    assert captured_post["path"] == "/deployments/agent-1/shell/token"
    assert captured_post["json"] == {"shell": "/bin/sh", "dry_run": True}


@pytest.mark.asyncio
async def test_agents_logs_stream_ws_uses_agents_ws_url(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test", api_base="https://api.dev.hypercli.com")

    monkeypatch.setattr(
        agents,
        "logs_token",
        lambda agent_id: {"jwt": "jwt-logs", "ws_url": "wss://wrong-host.example/ws/logs/agent-1?jwt=jwt-logs"},
    )

    captured = {}

    class FakeWS:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def __aiter__(self):
            async def _iter():
                yield '{"event":"log","log":"hello"}'
            return _iter()

    def fake_connect(url):
        captured["url"] = url
        return FakeWS()

    monkeypatch.setattr("websockets.connect", fake_connect)

    lines = []
    async for line in agents.logs_stream_ws("agent-1", tail_lines=400):
        lines.append(line)
        break

    assert captured["url"] == "wss://api.agents.dev.hypercli.com/ws/logs/agent-1?jwt=jwt-logs&container=reef&tail_lines=400"
    assert lines == ['{"event":"log","log":"hello"}']


def test_agents_detect_shell_prefers_bash(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    monkeypatch.setattr(
        agents,
        "exec",
        lambda pod, command, timeout=15: type("R", (), {"stdout": "/bin/bash", "stderr": "", "exit_code": 0})(),
    )
    assert agents._detect_shell("agent-1") == "/bin/bash"
