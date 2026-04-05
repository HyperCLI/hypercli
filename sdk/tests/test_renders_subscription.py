from hypercli.http import APIError
from hypercli.renders import Renders


class DummyHTTP:
    def __init__(self):
        self.calls = []
        self.fail_once = {}

    def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/auth/me":
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


def test_create_flow_uses_subscription_route_when_available():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["renders:*"],
        "has_active_subscription": True,
    }
    renders = Renders(http, auth_http=http)

    render = renders.create_flow("text-to-image", prompt="hello")

    assert render.render_id == "render-123"
    assert http.calls[0] == ("get", "/auth/me", None)
    assert http.calls[1] == ("post", "/agents/flow/text-to-image", {"prompt": "hello"})


def test_create_flow_falls_back_to_paid_route_on_subscription_rejection():
    http = DummyHTTP()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["renders:*"],
        "has_active_subscription": True,
    }
    http.fail_once["/agents/flow/text-to-image"] = APIError(403, "Active paid subscription required")
    renders = Renders(http, auth_http=http)

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
    renders = Renders(http, auth_http=http)

    render = renders.get("render-123")
    status = renders.status("render-123")
    cancelled = renders.cancel("render-123")

    assert render.render_id == "render-123"
    assert status.progress == 0.5
    assert cancelled["status"] == "cancelled"
    assert ("get", "/agents/flow/renders/render-123", None) in http.calls
    assert ("get", "/agents/flow/renders/render-123/status", None) in http.calls
    assert ("delete", "/agents/flow/renders/render-123", None) in http.calls
