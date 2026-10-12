import json
from pathlib import Path

import pytest

from hypercli import DEFAULT_RUNNER_CONTROL_URL, default_runner_control_url
from hypercli.config import get_agents_api_base_url, get_agents_ws_url, get_agents_ws_url_from_product_base


URL_VECTORS = json.loads(
    (Path(__file__).parents[2] / "rs-sdk/tests/fixtures/runner_control_urls.json").read_text()
)


def test_runner_control_uses_configured_agents_base(monkeypatch):
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", "http://127.0.0.1:8765/prefix/agents")
    monkeypatch.setenv("HYPER_API_BASE", "https://ignored.test")
    assert default_runner_control_url(get_agents_api_base_url()) == "ws://127.0.0.1:8765/prefix/ws/runners"


@pytest.mark.parametrize("base,expected", URL_VECTORS)
def test_runner_control_routes_preserve_explicit_origins_and_prefixes(base, expected, monkeypatch):
    assert DEFAULT_RUNNER_CONTROL_URL == "wss://api.agents.hypercli.com/ws/runners"
    assert default_runner_control_url(base) == expected
    ws_url = expected.removesuffix("/runners")
    assert get_agents_ws_url_from_product_base(base) == ws_url
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", base)
    assert get_agents_ws_url() == ws_url
