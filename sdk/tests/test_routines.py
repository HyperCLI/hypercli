from datetime import datetime, timezone

import pytest

from hypercli import Routine, RoutinesAPI
from hypercli.routines import _derive_routines_base


ROUTINE_PAYLOAD = {
    "id": "routine-1",
    "user_id": "user-1",
    "agent_id": "agent-1",
    "cron": "0 * * * *",
    "prompt": "Run the hourly check",
    "enabled": True,
    "next_run_at": "2026-09-08T13:00:00Z",
    "created_at": "2026-09-01T10:00:00Z",
    "updated_at": "2026-09-02T11:00:00Z",
}


def test_routines_base_derives_from_agents_base(monkeypatch):
    monkeypatch.delenv("HYPER_ROUTINES_API_BASE", raising=False)

    assert (
        _derive_routines_base("https://api.agents.dev.hypercli.com/agents")
        == "https://api.agents.dev.hypercli.com/routines"
    )


def test_routines_base_uses_explicit_env(monkeypatch):
    monkeypatch.setenv("HYPER_ROUTINES_API_BASE", "http://127.0.0.1:18080/routines")

    assert _derive_routines_base("https://ignored.example/agents") == "http://127.0.0.1:18080/routines"


def test_routine_from_dict_parses_datetimes():
    routine = Routine.from_dict(ROUTINE_PAYLOAD)

    assert routine.id == "routine-1"
    assert routine.user_id == "user-1"
    assert routine.agent_id == "agent-1"
    assert routine.cron == "0 * * * *"
    assert routine.prompt == "Run the hourly check"
    assert routine.enabled is True
    assert routine.next_run_at == datetime(2026, 9, 8, 13, 0, 0, tzinfo=timezone.utc)
    assert routine.created_at == datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)
    assert routine.updated_at == datetime(2026, 9, 2, 11, 0, 0, tzinfo=timezone.utc)


def test_routine_from_dict_allows_null_next_run_at():
    payload = {**ROUTINE_PAYLOAD, "next_run_at": None}

    routine = Routine.from_dict(payload)

    assert routine.next_run_at is None


def test_list_passes_agent_id_query_param(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return [ROUTINE_PAYLOAD]

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    routines = api.list(agent_id="agent-1")

    assert len(routines) == 1
    assert routines[0].id == "routine-1"
    assert calls == [
        (
            "GET",
            "http://routines.test/routines",
            "key",
            {"params": {"agent_id": "agent-1"}},
        )
    ]


def test_list_without_agent_id_omits_query_param(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return []

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    assert api.list() == []
    assert calls[0][3] == {"params": None}


def test_create_posts_payload_and_parses_response(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return ROUTINE_PAYLOAD

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    routine = api.create(agent_id="agent-1", cron="0 * * * *", prompt="Run the hourly check")

    assert routine.id == "routine-1"
    assert calls == [
        (
            "POST",
            "http://routines.test/routines",
            "key",
            {
                "json": {
                    "agent_id": "agent-1",
                    "cron": "0 * * * *",
                    "prompt": "Run the hourly check",
                    "enabled": True,
                }
            },
        )
    ]


def test_get_encodes_routine_id(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return ROUTINE_PAYLOAD

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    routine = api.get("routine 1")

    assert routine.id == "routine-1"
    assert calls[0][0] == "GET"
    assert calls[0][1] == "http://routines.test/routines/routine%201"


def test_update_sends_only_provided_fields(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return {**ROUTINE_PAYLOAD, "enabled": False, "cron": "*/5 * * * *"}

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    routine = api.update("routine-1", cron="*/5 * * * *", enabled=False)

    assert routine.enabled is False
    assert calls == [
        (
            "PATCH",
            "http://routines.test/routines/routine-1",
            "key",
            {"json": {"cron": "*/5 * * * *", "enabled": False}},
        )
    ]


def test_delete_uses_delete_method(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, **kwargs):
        calls.append((method, url, api_key, kwargs))
        return {}

    monkeypatch.setattr("hypercli.routines._request", fake_request)
    api = RoutinesAPI("key", api_base="http://routines.test/routines")

    api.delete("routine-1")

    assert calls == [("DELETE", "http://routines.test/routines/routine-1", "key", {})]


def test_routines_api_requires_api_key():
    with pytest.raises(ValueError):
        RoutinesAPI("", api_base="http://routines.test/routines")


def test_client_wires_routines_namespace():
    from hypercli import HyperCLI

    client = HyperCLI(
        api_key="key",
        api_url="https://api.hypercli.com",
        agents_api_base_url="https://api.hypercli.com/agents",
    )

    assert isinstance(client.routines, RoutinesAPI)
    assert client.routines.api_base == "https://api.hypercli.com/routines"
