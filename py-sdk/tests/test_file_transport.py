"""File contract exercised through httpx (no live hosts or credentials)."""
import base64
import json
from pathlib import Path

import httpx
import pytest

from hypercli.agents import RUNNER_FILE_MAX_BYTES, Agent, Deployments
from hypercli.http import APIError, HTTPClient

VECTORS = json.loads((Path(__file__).parents[2] / "rs-sdk/tests/fixtures/agent-file-contract.json").read_text())
NATIVE = {"transport": "runner", "executor": "process", "max_bytes": RUNNER_FILE_MAX_BYTES}
REEF = {"url": "https://reef.example.test/_reef", "token": "reef-secret", "expires_at": "2026-10-01T00:00:00Z"}


def setup(monkeypatch, handler):
    real_client = httpx.Client
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr("hypercli.agents.httpx.Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    return Deployments(HTTPClient("https://api.example.test", "api-secret"), api_base="https://api.example.test/agents")


@pytest.mark.parametrize("native", [False, True])
def test_identical_bound_methods_paths_bytes_and_text(monkeypatch, tmp_path, native):
    files, calls = {}, []

    def handle(request):
        calls.append(str(request.url))
        assert not request.url.query
        if request.url.host == "api.example.test":
            assert request.headers["authorization"] == "Bearer api-secret"
            if request.url.path.endswith("/files/token"):
                return httpx.Response(200, json=NATIVE if native else REEF)
            assert native
            body = json.loads(request.content)
            if request.url.path.endswith("/files/write"):
                files[body["path"]] = base64.b64decode(body["content_base64"])
                return httpx.Response(200, json={"ok": True})
            assert request.url.path.endswith("/files/read")
            return httpx.Response(200, json={"content_base64": base64.b64encode(files[body["path"]]).decode()})
        assert not native
        assert request.url.host == "reef.example.test"
        assert request.headers["authorization"] == "Bearer reef-secret"
        path = request.url.path.removeprefix("/_reef/files/")
        if request.method == "PUT":
            files[path] = request.content
            return httpx.Response(200, json={"status": "ok"})
        return httpx.Response(200, content=files[path], headers={"content-type": "application/json"})

    deployments = setup(monkeypatch, handle)
    agent = Agent(id="agent-contract", user_id="owner", state="STOPPED")
    agent._deployments = deployments
    for vector in VECTORS["paths"]:
        for hex_bytes in VECTORS["bytes_hex"]:
            content = bytes.fromhex(hex_bytes)
            agent.files.write_bytes(vector["input"], content)
            assert files[vector["normalized"]] == content
            assert agent.files.read_bytes(vector["input"]) == content
    for content in ["Hello 🌍", VECTORS["directory_shaped_json"]]:
        agent.files.write("text.json", content)
        assert agent.files.read("text.json") == content
    for vector in VECTORS["text"]:
        agent.files.write_bytes("encoding.txt", bytes.fromhex(vector["hex"]))
        assert agent.files.read("encoding.txt") == vector["decoded"]
        agent.files.write("encoding.txt", vector["decoded"])
        assert agent.files.read("encoding.txt") == vector["decoded"]
        assert agent.files.read_bytes("encoding.txt") == vector["decoded"].encode("utf-8")
    source, destination = tmp_path / "source", tmp_path / "nested/result"
    source.write_bytes(b"\0\xff\x80")
    agent.cp_to(source, "./copies//file.bin")
    agent.cp_from("copies/file.bin", destination)
    assert destination.read_bytes() == source.read_bytes()
    assert all("secret" not in url for url in calls)
    if not native:
        assert any(url.endswith("/a%252Fb") for url in calls)


@pytest.mark.parametrize("path", VECTORS["invalid_paths"])
def test_invalid_paths_never_dispatch(monkeypatch, path):
    def unexpected(request):
        pytest.fail("Invalid path must not send HTTP")
    deployments = setup(monkeypatch, unexpected)
    with pytest.raises(ValueError):
        deployments.file_read("agent-contract", path)
    with pytest.raises(ValueError):
        deployments.file_write("agent-contract", path, "x")


def test_response_lost_write_is_not_replayed(monkeypatch):
    writes, files = [], {}

    def handle(request):
        if request.url.path.endswith("/files/token"):
            return httpx.Response(200, json=NATIVE)
        writes.append(request)
        body = json.loads(request.content)
        files[body["path"]] = body["content_base64"]
        if len(writes) == 1:
            files[body["path"]] = "intervening user edit"
            raise httpx.ReadError("response lost", request=request)
        return httpx.Response(200, json={"ok": True})

    deployments = setup(monkeypatch, handle)
    with pytest.raises(httpx.ReadError, match="response lost"):
        deployments.file_write("agent-contract", "x", "original")
    assert len(writes) == 1
    assert files["x"] == "intervening user edit"


@pytest.mark.parametrize("payload", [None, [], {}, {**NATIVE, "executor": "docker"}, {**NATIVE, "max_bytes": 1}, {**NATIVE, "transport": "other"}, {**NATIVE, "extra": True}, {**REEF, "extra": True}])
def test_malformed_discovery_has_no_fallback(monkeypatch, payload):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=json.dumps(payload))
    deployments = setup(monkeypatch, handle)
    with pytest.raises(ValueError):
        deployments.file_read("agent-contract", "x")
    assert len(calls) == 1


@pytest.mark.parametrize("status", VECTORS["error_statuses"])
def test_status_preserved_without_fallback(monkeypatch, status):
    deployments = setup(monkeypatch, lambda _: httpx.Response(status, json={"detail": "file unavailable"}))
    with pytest.raises(APIError) as error:
        deployments.file_read("agent-contract", "x")
    assert error.value.status_code == status


def test_native_limits_unsupported_and_malformed_bytes(monkeypatch):
    calls = []
    def handle(request):
        calls.append(request.url.path)
        return httpx.Response(200, json=NATIVE if request.url.path.endswith("/files/token") else {"content_base64": "?"})
    deployments = setup(monkeypatch, handle)
    for operation in [lambda: deployments.files_list("agent-contract"), lambda: deployments.file_delete("agent-contract", "x")]:
        with pytest.raises(APIError) as error:
            operation()
        assert error.value.status_code == 501
    with pytest.raises(ValueError, match="limited"):
        deployments.file_write_bytes("agent-contract", "x", b"x" * (RUNNER_FILE_MAX_BYTES + 1))
    assert all(path.endswith("/files/token") for path in calls)
    with pytest.raises(ValueError, match="Invalid runner file response"):
        deployments.file_read("agent-contract", "x")


def test_native_readiness_uses_discovery_without_placement_field(monkeypatch):
    def handle(request):
        if request.url.path.endswith("/files/token"):
            return httpx.Response(200, json=NATIVE)
        if request.url.path.endswith("/files/read"):
            return httpx.Response(404, json={"detail": "Runner file not_found"})
        return httpx.Response(200, json={"id": "agent-contract", "state": "STOPPED"})
    setup(monkeypatch, handle).wait_for_file_api_ready("agent-contract", timeout=0, consecutive=1)


@pytest.mark.parametrize("persistent", [False, True])
def test_native_readiness_streak_and_polling_after_transient_read_errors(monkeypatch, persistent):
    clock, sleeps, reads = [0.0], [], []
    outcomes = [200, 503, 200, 200, 404]

    def sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr("hypercli.agents.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("hypercli.agents.time.sleep", sleep)

    def handle(request):
        if request.url.path.endswith("/files/token"):
            return httpx.Response(200, json=NATIVE)
        if request.url.path.endswith("/files/read"):
            status = 503 if persistent else outcomes[len(reads)]
            reads.append(status)
            if status == 200:
                return httpx.Response(200, json={"content_base64": ""})
            return httpx.Response(status, json={"detail": "Runner file not_found" if status == 404 else "Runner is offline"})
        return httpx.Response(200, json={"id": "agent-contract", "state": "STOPPED"})

    deployments = setup(monkeypatch, handle)
    if persistent:
        with pytest.raises(TimeoutError, match="3 consecutive reads.*503"):
            deployments.wait_for_file_api_ready("agent-contract", timeout=2.5, poll_seconds=1, consecutive=3)
        assert reads == [503] * 4
        assert sleeps == [1] * 3
    else:
        deployments.wait_for_file_api_ready("agent-contract", timeout=10, poll_seconds=1, consecutive=3)
        assert reads == outcomes
        assert sleeps == [1] * 4


@pytest.mark.parametrize("operation", ["read", "write"])
@pytest.mark.parametrize("status", VECTORS["error_statuses"])
def test_native_operation_errors_after_discovery(monkeypatch, operation, status):
    calls = []

    def handle(request):
        calls.append(request.url.path)
        return httpx.Response(200, json=NATIVE) if request.url.path.endswith("/files/token") else httpx.Response(status, json={"detail": "operation rejected"})

    deployments = setup(monkeypatch, handle)
    with pytest.raises(APIError) as error:
        if operation == "read":
            deployments.file_read("agent-contract", "x")
        else:
            deployments.file_write("agent-contract", "x", "content")
    assert error.value.status_code == status
    assert error.value.detail == "operation rejected"
    assert calls == ["/agents/deployments/agent-contract/files/token", f"/agents/deployments/agent-contract/files/{operation}"]


def test_native_maximum_and_metadata(monkeypatch):
    content = b"\xff" * RUNNER_FILE_MAX_BYTES
    def handle(request):
        if request.url.path.endswith("/files/token"):
            return httpx.Response(200, json=NATIVE)
        if request.url.path.endswith("/files/write"):
            assert base64.b64decode(json.loads(request.content)["content_base64"]) == content
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(200, json={"content_base64": base64.b64encode(content).decode()})
    deployments = setup(monkeypatch, handle)
    assert deployments.file_write_bytes("agent-contract", "max", content) == {"ok": True}
    assert deployments.file_read_bytes_with_metadata("agent-contract", "max") == {"content": content, "mime_type": None}
