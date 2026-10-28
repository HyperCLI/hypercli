from hypercli.renders import Renders
from hypercli.http import APIError
from hypercli.http import HTTPClient
import httpx
import pytest


def test_catalog_transport_and_submission_preserve_upstream_input_names():
    for subscription in (False, True):
        class HTTP:
            calls = []

            def get(self, path):
                self.calls.append(("GET", path))
                if path == "/agents/flow/access":
                    return {"render": subscription}
                return {"qwen21": {"templates": {"sample": {"inputs": {}}}}}

            def post(self, path, json, *, retries):
                assert retries == 1
                self.calls.append(("POST", path, json))
                return {"id": "render-1", "state": "pending"}

        http = HTTP()
        renders = Renders(http)
        assert "qwen21" in renders.catalog()
        assert http.calls == [("GET", "/agents/flow/catalog")]
        values = {"seed": 0, "switch": False, "images.image_5_1": {"file_id": "owned"}}
        renders.submit("qwen21", "sample", values)
        _, path, payload = http.calls[-1]
        assert path == ("/agents/flow/catalog" if subscription else "/api/renders")
        assert (payload if subscription else payload["params"]) == {"family": "qwen21", "template": "sample", "inputs": values}


@pytest.mark.parametrize("reply", [APIError(403, "denied"), APIError(404, "missing"), {}, {"render": "true"}])
def test_failed_entitlement_discovery_never_submits_paid(reply):
    class HTTP:
        def get(self, path):
            assert path == "/agents/flow/access"
            if isinstance(reply, Exception):
                raise reply
            return reply
        def post(self, *args, **kwargs):
            pytest.fail("discovery failure must not submit any render")
    with pytest.raises((APIError, ValueError)):
        Renders(HTTP()).submit("qwen21", "sample")


@pytest.mark.parametrize("included", [False, True])
def test_real_transport_submissions_are_attempted_once(monkeypatch, included):
    posts = []
    monkeypatch.setattr(httpx.Client, "get", lambda self, url, **kwargs: httpx.Response(200, json={"render": included}))
    def post(self, url, **kwargs):
        posts.append(url)
        raise httpx.ReadTimeout("response lost after acceptance")
    monkeypatch.setattr(httpx.Client, "post", post)
    http = HTTPClient("https://unit.invalid", "unit")
    try:
        renders = Renders(http)
        for submit in (lambda: renders.submit("qwen21", "sample"),
                       lambda: renders.create_flow("text-to-image", prompt="42"),
                       lambda: renders.create({})):
            with pytest.raises(httpx.ReadTimeout):
                submit()
        assert posts == [
            "https://unit.invalid" + ("/agents/flow/catalog" if included else "/api/renders"),
            "https://unit.invalid" + ("/agents/flow" if included else "/api/flow") + "/text-to-image",
            "https://unit.invalid/api/renders",
        ]
    finally:
        http.close()


def test_real_transport_get_still_retries(monkeypatch):
    calls = []
    def get(self, url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ConnectError("transient")
        return httpx.Response(200, json={"render": False} if url.endswith("/access") else {})
    monkeypatch.setattr(httpx.Client, "get", get)
    monkeypatch.setattr("hypercli.http.time.sleep", lambda _: None)
    http = HTTPClient("https://unit.invalid", "unit")
    try:
        assert Renders(http).catalog() == {}
        assert calls == ["https://unit.invalid/agents/flow/catalog"] * 2
    finally:
        http.close()
