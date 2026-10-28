import pytest
from hypercli.http import APIError
from hypercli.renders import Renders


class DummyHTTP:
    def __init__(self):
        self.calls = []
        self.fail_once = {}

    def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/agents/flow/access":
            if path in self.fail_once:
                raise self.fail_once.pop(path)
            return {"render": True}
        if path.endswith("/status"):
            render_id = path.split("/")[-2]
            return {"id": render_id, "state": "running", "progress": 0.5}
        render_id = path.split("/")[-1]
        return {"id": render_id, "state": "queued"}

    def post(self, path, json=None, *, retries):
        assert retries == 1
        self.calls.append(("post", path, json))
        if self.fail_once.get(path):
            error = self.fail_once.pop(path)
            raise error
        return {"id": "render-123", "state": "queued"}

    def delete(self, path):
        self.calls.append(("delete", path, None))
        if self.fail_once.get(path):
            error = self.fail_once.pop(path)
            raise error
        return {"status": "cancelled"}


class Clock:
    def __init__(self):
        self.now = 0.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def test_create_flow_uses_subscription_route_when_available():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["flows:*"],
        "has_active_subscription": True,
    }
    renders = Renders(http)

    render = renders.create_flow("text-to-image", prompt="hello")

    assert render.render_id == "render-123"
    assert http.calls[0] == ("get", "/agents/flow/access", None)
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})


def test_create_flow_uses_subscription_route_for_scoped_runtime_key_without_orchestra_subscription():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "api_key",
        "capabilities": ["agents:none", "flows:*", "models:*", "runtime=agent"],
        "has_active_subscription": False,
    }
    renders = Renders(http)

    render = renders.create_flow("text-to-image", prompt="hello")

    assert render.render_id == "render-123"
    assert http.calls[0] == ("get", "/agents/flow/access", None)
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})


@pytest.mark.parametrize("status", [403, 404, 503])
def test_create_flow_never_retries_paid_route_on_subscription_rejection(status):
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["flows:*"],
        "has_active_subscription": True,
    }
    http.fail_once["/agents/flow/text-to-image"] = APIError(status, "Rejected")
    renders = Renders(http)

    with pytest.raises(APIError):
        renders.create_flow("text-to-image", prompt="hello")
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})
    assert len(http.calls) == 2


def test_get_status_and_cancel_prefer_subscription_render_routes():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "user",
        "capabilities": [],
        "has_active_subscription": True,
    }
    renders = Renders(http)

    render = renders.get("render-123")
    status = renders.status("render-123")
    cancelled = renders.cancel("render-123")

    assert render.render_id == "render-123"
    assert status.progress == 0.5
    assert cancelled["status"] == "cancelled"
    assert ("get", "/agents/flow/renders/render-123", None) in http.calls
    assert ("get", "/agents/flow/renders/render-123/status", None) in http.calls
    assert ("delete", "/agents/flow/renders/render-123", None) in http.calls


def test_flow_only_keys_use_fresh_entitlement_without_auth_me():
    calls = []

    class FlowHTTP:
        def get(self, path, params=None):
            calls.append(("get", path, params))
            if path == "/api/auth/me":
                raise APIError(status_code=403, detail="Access denied", response_text='{"detail":"Access denied"}')
            if path == "/agents/flow/access":
                return {"render": True}
            return {"id": "render-123", "state": "queued"}

        def delete(self, path):
            calls.append(("delete", path, None))
            return {"status": "cancelled"}

    renders = Renders(FlowHTTP())

    render = renders.get("render-123")
    status = renders.status("render-123")
    cancelled = renders.cancel("render-123")

    assert render.render_id == "render-123"
    assert status.render_id == "render-123"
    assert cancelled["status"] == "cancelled"
    assert ("get", "/agents/flow/renders/render-123", None) in calls
    assert ("get", "/agents/flow/renders/render-123/status", None) in calls
    assert ("delete", "/agents/flow/renders/render-123", None) in calls


def test_wait_allows_queue_grace(monkeypatch):
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "user",
        "capabilities": [],
        "has_active_subscription": True,
    }
    clock = Clock()
    calls = {"count": 0}

    def fake_get(path, params=None):
        http.calls.append(("get", path, params))
        if path == "/agents/flow/access":
            return {"render": True}
        calls["count"] += 1
        if calls["count"] <= 3:
            return {"id": "render-123", "state": "running", "started_at": None}
        return {"id": "render-123", "state": "completed", "started_at": "1970-01-01T00:00:15+00:00"}

    monkeypatch.setattr(http, "get", fake_get)
    monkeypatch.setattr("hypercli.renders.time.time", clock.time)
    monkeypatch.setattr("hypercli.renders.time.sleep", clock.sleep)
    renders = Renders(http)

    render = renders.wait("render-123", timeout=10, poll_interval=5, queue_grace=10, active_grace=5)

    assert render.state == "completed"
    assert clock.time() == 15


def test_wait_allows_recent_active_grace(monkeypatch):
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "user",
        "capabilities": [],
        "has_active_subscription": True,
    }
    clock = Clock()
    calls = {"count": 0}

    def fake_get(path, params=None):
        http.calls.append(("get", path, params))
        if path == "/agents/flow/access":
            return {"render": True}
        calls["count"] += 1
        if calls["count"] == 1:
            return {"id": "render-123", "state": "running", "started_at": None}
        if calls["count"] == 2:
            return {"id": "render-123", "state": "running", "started_at": "1970-01-01T00:00:04+00:00"}
        return {"id": "render-123", "state": "completed", "started_at": "1970-01-01T00:00:04+00:00"}

    monkeypatch.setattr(http, "get", fake_get)
    monkeypatch.setattr("hypercli.renders.time.time", clock.time)
    monkeypatch.setattr("hypercli.renders.time.sleep", clock.sleep)
    renders = Renders(http)

    render = renders.wait("render-123", timeout=5, poll_interval=5, queue_grace=5, active_grace=6)

    assert render.state == "completed"
    assert clock.time() == 10
