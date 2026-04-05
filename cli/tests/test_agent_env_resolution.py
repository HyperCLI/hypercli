import importlib
from pathlib import Path


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


def test_voice_cli_posts_to_agents_voice_prefix(monkeypatch, tmp_path):
    monkeypatch.setenv("HYPER_API_KEY", "sk-product")
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
    voice._post_voice("tts", "sk-product", out, text="hello", voice="Chelsie")

    assert called["api_url"] == "https://api.dev.hypercli.com"
    assert called["api_key"] == "sk-product"
    assert called["kwargs"] == {"text": "hello", "voice": "Chelsie"}
    assert out.read_bytes() == b"audio"
