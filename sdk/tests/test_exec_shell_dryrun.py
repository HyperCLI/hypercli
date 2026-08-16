import json

import pytest

from hypercli.jobs import Jobs
from hypercli.agents import (
    AGENT_EXEC_OUTPUT_MAX_BYTES,
    AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES,
    Agent,
    Deployments,
)


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

    result = jobs.exec("job-1", ["echo", "ok"], timeout=15)

    assert result.exit_code == 0
    assert result.stdout == "ok\n"
    assert http.calls[0][1] == "/api/jobs/job-1/exec"
    assert http.calls[0][2] == {"command": ["echo", "ok"], "timeout": 15}


@pytest.mark.parametrize("timeout", [0, 301, 1.5, True])
def test_jobs_exec_rejects_invalid_timeout(timeout):
    http = DummyHTTP()
    jobs = Jobs(http)

    with pytest.raises(ValueError, match="integer from 1 through 300"):
        jobs.exec("job-1", ["true"], timeout=timeout)

    assert http.calls == []


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


def _closed(code=1000, reason=""):
    from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK
    from websockets.frames import Close

    close = Close(code, reason)
    cls = ConnectionClosedOK if code == 1000 else ConnectionClosedError
    return cls(close, close, True)


class FakeOneShotWebSocket:
    def __init__(self, frames, *, close_code=1000, close_reason=""):
        self.frames = list(frames)
        self.sent = []
        self.close_code = close_code
        self.close_reason = close_reason

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def send(self, frame):
        self.sent.append(frame)

    def recv(self, timeout=None):
        if self.frames:
            return self.frames.pop(0)
        raise _closed(self.close_code, self.close_reason)


def _agent_token(agent_id, purpose):
    return {
        "agent_id": agent_id,
        "jwt": f"jwt-{purpose}",
        "expires_at": "2026-08-15T00:05:00Z",
        "ws_url": f"wss://socket.example.test/product/ws/{purpose}/{agent_id}",
    }


def test_agents_exec_mints_token_sends_exact_ws_frame_and_waits_for_normal_close(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    pod = Agent(id="agent-1", user_id="u1", state="RUNNING")
    posts = []
    socket = FakeOneShotWebSocket([
        '{"event":"agent_exec_result","ok":true,"exit_code":7,"stdout":"done\\n","stderr":"warn\\n"}'
    ])

    def fake_post(path, json=None):
        posts.append((path, json))
        return _agent_token("agent-1", "exec")

    connected = {}

    def fake_connect(url, **kwargs):
        connected.update(url=url, kwargs=kwargs)
        return socket

    monkeypatch.setattr(agents, "_post", fake_post)
    monkeypatch.setattr("websockets.sync.client.connect", fake_connect)

    result = agents.exec(pod, ["ls", "  exact argument  "], timeout=10, dry_run=True)

    assert result.exit_code == 7
    assert result.stdout == "done\n"
    assert result.stderr == "warn\n"
    assert posts == [("/deployments/agent-1/exec/token", None)]
    assert connected["url"] == (
        "wss://socket.example.test/product/ws/exec/agent-1?jwt=jwt-exec"
    )
    assert connected["kwargs"]["max_size"] == AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES
    assert socket.sent == [
        '{"command":["ls","  exact argument  "],"timeout":10,"dry_run":true}'
    ]


@pytest.mark.parametrize(
    "command",
    ["pwd", [], [""], ["pwd", "bad\x00arg"], ["x" * 65_537]],
)
def test_agents_exec_rejects_noncanonical_argv_before_token_mint(monkeypatch, command):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    monkeypatch.setattr(
        agents,
        "_post",
        lambda *_args, **_kwargs: pytest.fail("invalid argv must not mint a token"),
    )

    with pytest.raises(ValueError, match="argv list"):
        agents.exec("agent-1", command)


def test_agents_exec_accepts_worst_case_escaped_near_limit_result(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    stdout = "\x01" * AGENT_EXEC_OUTPUT_MAX_BYTES
    frame = json.dumps(
        {
            "event": "agent_exec_result",
            "ok": True,
            "exit_code": 0,
            "stdout": stdout,
            "stderr": "",
        },
        separators=(",", ":"),
    )
    assert len(frame.encode()) > AGENT_EXEC_OUTPUT_MAX_BYTES
    assert len(frame.encode()) <= AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES
    socket = FakeOneShotWebSocket([frame])
    connected = {}
    monkeypatch.setattr(
        agents,
        "_post",
        lambda path, json=None: _agent_token("agent-1", "exec"),
    )

    def fake_connect(url, **kwargs):
        connected.update(kwargs)
        return socket

    monkeypatch.setattr("websockets.sync.client.connect", fake_connect)

    result = agents.exec("agent-1", ["printf", "output"])

    assert len(result.stdout) == AGENT_EXEC_OUTPUT_MAX_BYTES
    assert connected["max_size"] == AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES


def test_agents_metrics_mints_token_sends_no_frame_and_returns_exact_result(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    socket = FakeOneShotWebSocket([
        '{"event":"agent_metrics_result","ok":true,"cpu":"25m","memory":"128Mi","timestamp":7}'
    ])
    monkeypatch.setattr(
        agents,
        "_post",
        lambda path, json=None: _agent_token("agent-1", "metrics"),
    )
    monkeypatch.setattr("websockets.sync.client.connect", lambda url, **kwargs: socket)

    assert agents.metrics("agent-1") == {
        "event": "agent_metrics_result",
        "ok": True,
        "cpu": "25m",
        "memory": "128Mi",
        "timestamp": 7,
    }
    assert socket.sent == []


@pytest.mark.parametrize(
    ("frames", "close_code", "close_reason", "error"),
    [
        ([b"binary"], 1000, "", "non-text"),
        (["not-json"], 1000, "", "invalid JSON"),
        ([
            '{"event":"agent_metrics_result","ok":true,"cpu":"1m","memory":"1Mi","timestamp":1}',
            "{}",
        ], 1000, "", "more than one"),
        ([], 4409, "Agent is busy", "4409: Agent is busy"),
    ],
)
def test_agents_metrics_rejects_invalid_frames_and_close_codes(
    monkeypatch, frames, close_code, close_reason, error
):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    socket = FakeOneShotWebSocket(
        frames,
        close_code=close_code,
        close_reason=close_reason,
    )
    monkeypatch.setattr(
        agents,
        "_post",
        lambda path, json=None: _agent_token("agent-1", "metrics"),
    )
    monkeypatch.setattr("websockets.sync.client.connect", lambda url, **kwargs: socket)

    with pytest.raises(RuntimeError, match=error):
        agents.metrics("agent-1")


def test_agents_exec_surfaces_exact_error_result(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    socket = FakeOneShotWebSocket([
        '{"event":"agent_exec_result","ok":false,"error":"output limit exceeded"}'
    ])
    monkeypatch.setattr(
        agents,
        "_post",
        lambda path, json=None: _agent_token("agent-1", "exec"),
    )
    monkeypatch.setattr("websockets.sync.client.connect", lambda url, **kwargs: socket)

    with pytest.raises(RuntimeError, match="output limit exceeded"):
        agents.exec("agent-1", ["yes"])


def test_agents_rejects_noncanonical_operation_token_before_ws_connect(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    token = _agent_token("agent-1", "metrics")
    token["ws_url"] += "?jwt=already-present"
    monkeypatch.setattr(agents, "_post", lambda path, json=None: token)
    monkeypatch.setattr(
        "websockets.sync.client.connect",
        lambda url, **kwargs: pytest.fail("must not connect"),
    )

    with pytest.raises(ValueError, match="invalid Agent metrics token"):
        agents.metrics("agent-1")


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
            "agent_id": "agent-1",
            "jwt": "jwt-abc",
            "expires_at": "2026-08-15T00:05:00Z",
            "ws_url": "wss://socket.example.test/product/ws/shell/agent-1",
            "shell": "/bin/sh",
        }

    monkeypatch.setattr(agents, "_post", fake_post)
    captured = {}

    async def fake_connect(url, ping_interval=20, ping_timeout=20):
        captured["url"] = url
        return "agent-ws"

    monkeypatch.setattr("websockets.connect", fake_connect)

    ws = await agents.shell_connect("agent-1", shell="/bin/sh")
    assert ws == "agent-ws"
    assert captured["url"] == (
        "wss://socket.example.test/product/ws/shell/agent-1?jwt=jwt-abc&shell=%2Fbin%2Fsh"
    )
    assert captured_post["path"] == "/deployments/agent-1/shell/token"
    assert captured_post["json"] == {"shell": "/bin/sh"}


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

    assert captured["url"] == "wss://api.agents.dev.hypercli.com/ws/logs/agent-1?jwt=jwt-logs&container=reef&tail_lines=400"
    assert lines == ["hello"]


@pytest.mark.asyncio
async def test_agents_logs_stream_ws_stops_after_history_when_not_following(monkeypatch):
    agents = Deployments(DummyHTTP(), api_key="sk-hyper-test")
    monkeypatch.setattr(
        agents,
        "logs_token",
        lambda agent_id: {"jwt": "jwt-logs"},
    )

    class FakeWS:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def __aiter__(self):
            async def _iter():
                yield '{"event":"log","log":"first"}'
                yield '{"event":"history_end"}'
                yield '{"event":"log","log":"live"}'

            return _iter()

    monkeypatch.setattr("websockets.connect", lambda url: FakeWS())

    lines = [
        line
        async for line in agents.logs_stream_ws(
            "agent-1",
            tail_lines=10,
            follow=False,
        )
    ]

    assert lines == ["first"]
