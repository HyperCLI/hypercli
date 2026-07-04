import importlib
import json
from pathlib import Path


def test_agents_cli_prefers_agent_key_env(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli_cli.agents as agents

    importlib.reload(agents)

    assert agents._get_agent_api_key() == "hyper_api_agent"


def test_agents_cli_uses_config_without_legacy_agent_key(monkeypatch, tmp_path):
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.delenv("HYPERCLI_API_KEY", raising=False)
    monkeypatch.delenv("HYPER_AGENTS_API_KEY", raising=False)

    config_path = tmp_path / "config"
    config_path.write_text("HYPER_API_KEY=hyper_api_config\n")

    import hypercli.config as config
    import hypercli_cli.agents as agents

    importlib.reload(config)
    importlib.reload(agents)
    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    monkeypatch.setattr(agents, "AGENT_KEY_PATH", tmp_path / "missing-agent-key.json")

    assert agents._get_agent_api_key() == "hyper_api_config"


def test_agent_activate_uses_config_without_legacy_agent_key(monkeypatch, tmp_path):
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.delenv("HYPERCLI_API_KEY", raising=False)
    monkeypatch.delenv("HYPER_AGENTS_API_KEY", raising=False)

    config_path = tmp_path / "config"
    config_path.write_text("HYPER_API_KEY=hyper_api_config\n")

    import hypercli.config as config
    import hypercli_cli.agent as agent

    importlib.reload(config)
    importlib.reload(agent)
    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    monkeypatch.setattr(agent, "AGENT_KEY_PATH", tmp_path / "missing-agent-key.json")

    assert agent._resolve_agent_query_key() == "hyper_api_config"


def test_agents_cli_prefers_agent_base_env(monkeypatch):
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.agents.dev.hypercli.com")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli_cli.agents as agents

    importlib.reload(agents)

    client = agents._get_deployments_client()
    assert client._api_base == "https://api.dev.hypercli.com/agents"


def test_voice_cli_prefers_product_envs(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")
    monkeypatch.setenv("HYPER_API_BASE", "https://api.hypercli.com")
    monkeypatch.setenv("HYPERCLI_API_URL", "https://api.dev.hypercli.com")

    import hypercli_cli.voice as voice

    importlib.reload(voice)

    assert voice._get_api_key(None) == "hyper_api_product"
    assert voice._resolve_api_base(None) == "https://api.hypercli.com"


def test_voice_cli_uses_config_before_expired_agent_key(monkeypatch, tmp_path):
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.delenv("HYPERCLI_API_KEY", raising=False)
    monkeypatch.delenv("HYPER_AGENTS_API_KEY", raising=False)

    config_path = tmp_path / "config"
    config_path.write_text("HYPER_API_KEY=hyper_api_config\n")
    agent_key_path = tmp_path / "agent-key.json"
    agent_key_path.write_text(
        json.dumps(
            {
                "key": "hyper_api_expired",
                "expires_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )

    import hypercli.config as config
    import hypercli_cli.voice as voice

    importlib.reload(config)
    importlib.reload(voice)
    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    monkeypatch.setattr(voice, "AGENT_KEY_PATH", agent_key_path)

    assert voice._get_api_key(None) == "hyper_api_config"


def test_voice_cli_posts_to_agents_voice_prefix(monkeypatch, tmp_path):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    import hypercli_cli.voice as voice

    importlib.reload(voice)

    called = {}

    class _FakeVoice:
        def tts(self, **kwargs):
            called["kwargs"] = kwargs
            return b"audio"

    class _FakeHyperCLI:
        def __init__(self, *, api_key, api_url):
            called["api_key"] = api_key
            called["api_url"] = api_url
            self.voice = _FakeVoice()

    monkeypatch.setattr(voice, "HyperCLI", _FakeHyperCLI)

    out = tmp_path / "voice.wav"
    voice._post_voice("tts", "hyper_api_product", out, text="hello", voice="serena")

    assert called["api_url"] == "https://api.dev.hypercli.com"
    assert called["api_key"] == "hyper_api_product"
    assert called["kwargs"] == {"text": "hello", "voice": "serena"}
    assert out.read_bytes() == b"audio"
