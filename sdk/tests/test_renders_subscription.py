from hypercli.http import APIError
from hypercli.renders import Renders
from hypercli.http import APIError


class DummyHTTP:
    def __init__(self):
        self.calls = []
        self.fail_once = {}

    def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/api/auth/me":
            return self.auth_me
        if path.endswith("/status"):
            render_id = path.split("/")[-2]
            return {"id": render_id, "state": "running", "progress": 0.5}
        render_id = path.split("/")[-1]
        return {"id": render_id, "state": "queued"}

    def post(self, path, json=None):
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
    assert http.calls[0] == ("get", "/api/auth/me", None)
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})


def test_create_flow_falls_back_to_paid_route_on_subscription_rejection():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["flows:*"],
        "has_active_subscription": True,
    }
    http.fail_once["/agents/flow/text-to-image"] = APIError(403, "Active paid subscription required")
    renders = Renders(http)

    render = renders.create_flow("text-to-image", prompt="hello")

    assert render.render_id == "render-123"
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})
    assert http.calls[2] == ("post", "/api/flow/text-to-image", {"prompt": "hello"})


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


def test_flow_only_keys_fallback_to_api_flow_render_routes_when_auth_me_is_denied():
    calls = []

    class FlowHTTP:
        def get(self, path, params=None):
            calls.append(("get", path, params))
            if path == "/api/auth/me":
                raise APIError(status_code=403, detail="Access denied", response_text='{"detail":"Access denied"}')
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
    assert ("get", "/api/flow/renders/render-123", None) in calls
    assert ("get", "/api/flow/renders/render-123/status", None) in calls
    assert ("delete", "/api/flow/renders/render-123", None) in calls


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
        if path == "/api/auth/me":
            return http.auth_me
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
        if path == "/api/auth/me":
            return http.auth_me
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
