from unittest.mock import Mock

import pytest

from hypercli.personas import PersonasAPI, canonical_soul
from hypercli.user import UserAPI
from hypercli.agents import Deployments


def test_live_reads_no_cache_and_no_failure_fallback():
    http = Mock()
    api = PersonasAPI(http)
    http.get.side_effect = [{"soul": "first"}, {"soul": "second"}, RuntimeError("unavailable")]
    assert api.resolve("agent")["soul"] == "first"
    assert api.resolve("agent")["soul"] == "second"
    with pytest.raises(RuntimeError, match="unavailable"):
        api.resolve("agent")
    http.get.assert_called_with("/personas/resolve", params={"agent_id": "agent"})


def test_catalog_and_exact_artifact_paths():
    http = Mock()
    api = PersonasAPI(http)
    api.list()
    http.get.assert_called_with("/personas")
    api.get("researcher")
    http.get.assert_called_with("/personas/researcher")
    for value in ["", "../x", "UPPER", "a" * 65]:
        with pytest.raises(ValueError):
            api.get(value)
    with pytest.raises(ValueError):
        api.resolve(" ")


def test_canonical_soul_does_not_resolve_persona_or_override_clear():
    assert canonical_soul({"soul": "stored", "persona": "researcher"}) == "stored"
    for value in [None, ""]:
        assert canonical_soul({"soul": value, "ui": {"soul": "legacy"}}) == ""
    assert canonical_soul({"ui": {"soul": "legacy"}}) == "legacy"


def test_profile_uses_agents_endpoint_not_product_or_files():
    product, backend = Mock(), Mock()
    api = UserAPI(product, profile_http=backend)
    api.get_profile()
    backend.get.assert_called_once_with("/users/profile")
    api.update_profile(None)
    backend.patch.assert_called_once_with("/users/profile", json={"profile": None})
    assert not product.mock_calls


def test_selector_update_preserves_omission_and_explicit_clear(monkeypatch):
    api = Deployments(Mock(), api_key="test", api_base="https://example.test/agents")
    patch = Mock(return_value={"id": "agent", "meta": {"soul": "stored"}})
    monkeypatch.setattr(api, "_patch", patch)
    monkeypatch.setattr(api, "resolve_agent_id", lambda value: value)
    for value in ["researcher", None]:
        agent = api.update("agent", persona=value)
        patch.assert_called_with("/deployments/agent", json={"persona": value})
        assert canonical_soul(agent.meta) == "stored"
    api.update("agent", soul="new")
    patch.assert_called_with("/deployments/agent", json={"soul": "new"})
