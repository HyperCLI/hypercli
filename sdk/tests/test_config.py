import importlib
from pathlib import Path


def test_agents_urls_default_to_agents_hosts(monkeypatch):
    monkeypatch.delenv("AGENTS_API_BASE_URL", raising=False)
    monkeypatch.delenv("AGENTS_WS_URL", raising=False)
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.delenv("HYPERCLI_API_URL", raising=False)
    monkeypatch.setenv("HOME", str(Path("/tmp/hypercli-sdk-test-home")))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"
    assert config.get_agents_api_base_url(dev=True) == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url(dev=True) == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_urls_use_env_overrides(monkeypatch):
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.dev.hypercli.com/agents")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.delenv("HYPERCLI_API_URL", raising=False)

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.dev.hypercli.com/ws"


def test_agent_key_prefers_agent_env_then_product_env(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "sk-product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "sk-agent")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agent_api_key() == "sk-agent"
    assert config.get_api_key() == "sk-product"


def test_agents_base_prefers_direct_agents_base(monkeypatch):
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.dev.hypercli.com/agents")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"


def test_agents_base_tracks_product_base_when_agents_base_missing(monkeypatch):
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.dev.hypercli.com/ws"
