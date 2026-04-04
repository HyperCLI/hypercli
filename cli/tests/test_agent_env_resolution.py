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

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url, json=None, headers=None):
            called["url"] = url
            called["json"] = json
            called["headers"] = headers

            class _Resp:
                status_code = 200
                content = b"audio"

            return _Resp()

    monkeypatch.setattr(voice.httpx, "Client", _FakeClient)

    out = tmp_path / "voice.wav"
    voice._post_voice("tts", {"text": "hello", "voice": "Chelsie"}, "sk-product", out)

    assert called["url"] == "https://api.dev.hypercli.com/agents/voice/tts"
    assert out.read_bytes() == b"audio"
