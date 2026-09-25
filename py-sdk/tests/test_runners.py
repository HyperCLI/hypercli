from datetime import datetime, timezone

from hypercli import Runner, RunnersAPI
from hypercli.runners import _derive_runners_base

RUNNER_PAYLOAD = {
    "runner_id": "ab72fe95-8821-40ab-978c-158890c162aa",
    "owner_user_id": "user-1",
    "name": "workstation",
    "tags": ["linux", "gpu"],
    "platform": {"os": "linux", "arch": "x86_64"},
    "version": "0.1.0",
    "created_at": "2026-09-01T10:00:00Z",
    "last_seen_at": "2026-09-02T11:00:00Z",
    "disconnected_at": None,
    "meta": {"ui": {"display_name": "Build box"}},
    "connected": True,
    "ready": False,
    "connection_scope": "current_backend_instance",
}


def test_runners_base_derives_from_agents_base(monkeypatch):
    monkeypatch.delenv("HYPER_RUNNERS_API_BASE", raising=False)

    assert (
        _derive_runners_base("https://api.hypercli.com/agents")
        == "https://api.hypercli.com/agents/runners"
    )
    assert (
        _derive_runners_base("https://api.hypercli.com/agents/runners")
        == "https://api.hypercli.com/agents/runners"
    )


def test_runners_base_uses_explicit_env(monkeypatch):
    monkeypatch.setenv("HYPER_RUNNERS_API_BASE", "http://127.0.0.1:18080/runners")

    assert _derive_runners_base("https://ignored.example/agents") == "http://127.0.0.1:18080/runners"


def test_runner_from_dict_carries_meta_ui_display_name():
    runner = Runner.from_dict(RUNNER_PAYLOAD)

    assert runner.runner_id == RUNNER_PAYLOAD["runner_id"]
    assert runner.owner_user_id == "user-1"
    assert runner.name == "workstation"
    assert runner.tags == ["linux", "gpu"]
    assert runner.platform == {"os": "linux", "arch": "x86_64"}
    assert runner.created_at == datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)
    assert runner.connected is True
    assert runner.ready is False
    assert runner.connection_scope == "current_backend_instance"
    assert runner.meta is not None
    assert runner.meta.ui is not None
    assert runner.meta.ui.display_name == "Build box"


def test_runner_from_dict_tolerates_missing_meta():
    runner = Runner.from_dict({**RUNNER_PAYLOAD, "meta": None})

    assert runner.meta is None

    bare = Runner.from_dict({key: value for key, value in RUNNER_PAYLOAD.items() if key != "meta"})
    assert bare.meta is None


def test_list_normalizes_items(monkeypatch):
    captured = {}

    def fake_request(method, url, *, api_key, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["api_key"] = api_key
        return [RUNNER_PAYLOAD]

    monkeypatch.setattr("hypercli.runners._request", fake_request)

    api = RunnersAPI("key", api_base="http://agents.test/agents/runners")
    runners = api.list()

    assert captured == {"method": "GET", "url": "http://agents.test/agents/runners", "api_key": "key"}
    assert len(runners) == 1
    assert runners[0].meta is not None and runners[0].meta.ui is not None
    assert runners[0].meta.ui.display_name == "Build box"


def test_update_patches_display_name_with_snake_case_body(monkeypatch):
    captured = {}

    def fake_request(method, url, *, api_key, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        return RUNNER_PAYLOAD

    monkeypatch.setattr("hypercli.runners._request", fake_request)

    api = RunnersAPI("key", api_base="http://agents.test/agents/runners")
    runner = api.update(RUNNER_PAYLOAD["runner_id"], display_name="Build box")

    assert captured["method"] == "PATCH"
    assert captured["url"] == f"http://agents.test/agents/runners/{RUNNER_PAYLOAD['runner_id']}"
    assert captured["json"] == {"ui": {"display_name": "Build box"}}
    assert runner.meta is not None and runner.meta.ui is not None
    assert runner.meta.ui.display_name == "Build box"


def test_update_clears_display_name_with_none(monkeypatch):
    captured = {}

    def fake_request(method, url, *, api_key, **kwargs):
        captured["json"] = kwargs.get("json")
        return {**RUNNER_PAYLOAD, "meta": {"ui": {"display_name": None}}}

    monkeypatch.setattr("hypercli.runners._request", fake_request)

    api = RunnersAPI("key", api_base="http://agents.test/agents/runners")
    runner = api.update(RUNNER_PAYLOAD["runner_id"], display_name=None)

    assert captured["json"] == {"ui": {"display_name": None}}
    assert runner.meta is not None and runner.meta.ui is not None
    assert runner.meta.ui.display_name is None


def test_update_omitted_display_name_sends_no_patch(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append(method)
        return RUNNER_PAYLOAD

    monkeypatch.setattr("hypercli.runners._request", fake_request)

    api = RunnersAPI("key", api_base="http://agents.test/agents/runners")
    runner = api.update(RUNNER_PAYLOAD["runner_id"])

    assert calls == ["GET"]
    assert runner.runner_id == RUNNER_PAYLOAD["runner_id"]
