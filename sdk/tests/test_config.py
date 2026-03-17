import importlib


def test_agents_urls_default_to_agents_hosts(monkeypatch):
    monkeypatch.delenv("AGENTS_API_BASE_URL", raising=False)
    monkeypatch.delenv("AGENTS_WS_URL", raising=False)

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"
    assert config.get_agents_api_base_url(dev=True) == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url(dev=True) == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_urls_use_env_overrides(monkeypatch):
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.dev.hypercli.com/agents")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.dev.hypercli.com/ws"
