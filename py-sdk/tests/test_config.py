import importlib
from pathlib import Path


def test_agents_urls_default_to_agents_hosts(monkeypatch):
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.setenv("HOME", str(Path("/tmp/hypercli-sdk-test-home")))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"
    assert config.get_agents_api_base_url(dev=True) == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url(dev=True) == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_urls_ignore_legacy_override_envs(monkeypatch):
    """Strict derive-only: only HYPER_API_BASE steers resolution."""
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.dev.hypercli.com/agents")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")
    monkeypatch.setenv("HYPERCLI_API_URL", "https://api.dev.hypercli.com")
    monkeypatch.setenv("HYPERCLI_WS_URL", "wss://api.dev.hypercli.com")
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.setenv("HOME", str(Path("/tmp/hypercli-sdk-test-home")))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_url() == "https://api.hypercli.com"
    assert config.get_ws_url() == "wss://api.hypercli.com"
    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"


def test_agent_key_prefers_product_env_then_managed_agent_env(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agent_api_key() == "hyper_api_product"
    assert config.get_api_key() == "hyper_api_product"


def test_agent_key_prefers_product_config_before_managed_agent_env(
    monkeypatch, tmp_path
):
    config_path = tmp_path / "config"
    config_path.write_text("HYPER_API_KEY=hyper_api_configured\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli.config as config

    monkeypatch.setattr(config, "CONFIG_FILE", config_path)

    assert config.get_agent_api_key() == "hyper_api_configured"


def test_hyper_home_is_data_dir(monkeypatch, tmp_path):
    hyper_home = tmp_path / "hyper-data"
    hyper_home.mkdir()
    (hyper_home / "config").write_text("HYPER_API_KEY=hyper_api_home\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HYPER_HOME", str(hyper_home))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_key() == "hyper_api_home"


def test_hyper_home_missing_config_does_not_read_default_home(monkeypatch, tmp_path):
    fake_home = tmp_path / "home"
    default_dir = fake_home / ".hypercli"
    hyper_home = tmp_path / "custom-data"
    default_dir.mkdir(parents=True)
    hyper_home.mkdir()
    (default_dir / "config").write_text("HYPER_API_KEY=hyper_api_default\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("HYPER_HOME", str(hyper_home))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_key() is None


def test_agents_base_tracks_product_base(monkeypatch):
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_base_can_be_derived_from_explicit_product_base():
    import hypercli.config as config

    assert config.get_agents_api_base_url_from_product_base("https://api.dev.hypercli.com") == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url_from_product_base("https://api.dev.hypercli.com") == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_admin_base_derives_from_product_base():
    import hypercli.config as config

    assert config.get_agents_admin_api_base_url_from_product_base("") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.hypercli.com") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.hypercli.com/api") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.dev.hypercli.com") == "https://api.agents.dev.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.dev.hypercli.com/agents") == "https://api.agents.dev.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("http://127.0.0.1:8787") == "http://127.0.0.1:8787"
    assert config.get_agents_admin_api_base_url_from_product_base("http://127.0.0.1:8787/api") == "http://127.0.0.1:8787"
