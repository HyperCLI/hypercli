import importlib


def test_agents_cli_prefers_agent_key_env(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "sk-product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "sk-agent")

    import hypercli_cli.agents as agents

    importlib.reload(agents)

    assert agents._get_agent_api_key() == "sk-agent"


def test_agents_cli_prefers_agent_base_env(monkeypatch):
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.agents.dev.hypercli.com")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "sk-agent")

    import hypercli_cli.agents as agents

    importlib.reload(agents)

    client = agents._get_deployments_client()
    assert client._api_base == "https://api.dev.hypercli.com/agents"


def test_voice_cli_prefers_product_envs(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "sk-product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "sk-agent")
    monkeypatch.setenv("HYPER_API_BASE", "https://api.hypercli.com")
    monkeypatch.setenv("HYPERCLI_API_URL", "https://api.dev.hypercli.com")

    import hypercli_cli.voice as voice

    importlib.reload(voice)

    assert voice._get_api_key(None) == "sk-product"
    assert voice._resolve_api_base(None) == "https://api.hypercli.com"
