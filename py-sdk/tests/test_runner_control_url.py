from hypercli import DEFAULT_RUNNER_CONTROL_URL, default_runner_control_url
from hypercli.config import get_agents_api_base_url


def test_runner_control_uses_configured_agents_base(monkeypatch):
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", "http://127.0.0.1:8765/prefix/agents")
    monkeypatch.setenv("HYPER_API_BASE", "https://ignored.test")
    assert default_runner_control_url(get_agents_api_base_url()) == "ws://127.0.0.1:8765/prefix/ws/runners"


def test_runner_control_routes_preserve_explicit_origins_and_prefixes():
    assert DEFAULT_RUNNER_CONTROL_URL == "wss://api.agents.hypercli.com/ws/runners"
    for base, expected in [
        ("https://api.hypercli.com/agents", DEFAULT_RUNNER_CONTROL_URL),
        ("https://api.dev.hypercli.com/agents", "wss://api.agents.dev.hypercli.com/ws/runners"),
        ("https://api.agents.hypercli.com/agents", DEFAULT_RUNNER_CONTROL_URL),
        ("http://127.0.0.1:8765/prefix/agents/", "ws://127.0.0.1:8765/prefix/ws/runners"),
        ("https://custom.test/api", "wss://custom.test/ws/runners"),
    ]:
        assert default_runner_control_url(base) == expected
