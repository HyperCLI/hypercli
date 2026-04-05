from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_llm_chat_uses_default_model(monkeypatch):
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="hello from kimi"),
                    )
                ]
            )

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        chat = FakeChat()

    monkeypatch.setattr("hypercli_cli.llm._resolve_api_key", lambda key: "hyper_api_test")
    monkeypatch.setattr("hypercli_cli.llm._resolve_api_base", lambda base: "https://api.hypercli.com")
    monkeypatch.setattr("hypercli_cli.llm._resolve_default_model", lambda api_key, api_base: "kimi-k2.5")
    monkeypatch.setattr(
        "hypercli_cli.llm._get_openai_client",
        lambda api_key, api_base: captured.update(
            {"api_key": api_key, "base_url": f"{api_base}/v1"}
        ) or FakeOpenAI(),
    )

    result = runner.invoke(app, ["llm", "chat", "Say hello", "--no-stream"])

    assert result.exit_code == 0
    assert "hello from kimi" in result.stdout
    assert captured["api_key"] == "hyper_api_test"
    assert captured["base_url"] == "https://api.hypercli.com/v1"
    assert captured["model"] == "kimi-k2.5"
    assert captured["messages"] == [{"role": "user", "content": "Say hello"}]
    assert captured["stream"] is False


def test_pick_default_model_prefers_kimi():
    payload = {
        "data": [
            {"id": "qwen3-embedding-4b"},
            {"id": "kimi-k2.5"},
            {"id": "glm-5"},
        ]
    }

    from hypercli_cli.llm import _pick_default_model

    assert _pick_default_model(payload) == "kimi-k2.5"
