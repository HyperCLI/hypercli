import base64
from types import SimpleNamespace
import sys
import types

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


def test_pick_default_vision_model_prefers_kimi_vision():
    payload = {
        "data": [
            {"id": "kimi-k2.5"},
            {"id": "kimi-k2.6"},
            {"id": "glm-5"},
        ]
    }

    from hypercli_cli.llm import _pick_default_vision_model

    assert _pick_default_vision_model(payload) == "kimi-k2.6"


def test_llm_image_sends_data_url_payload(tmp_path, monkeypatch):
    image_path = tmp_path / "fixture.jpg"
    image_bytes = b"synthetic-image-bytes"
    image_path.write_bytes(image_bytes)
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="A man with a beard appears in the image."),
                    )
                ]
            )

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        chat = FakeChat()

    monkeypatch.setattr("hypercli_cli.llm._resolve_api_key", lambda key: "hyper_api_test")
    monkeypatch.setattr("hypercli_cli.llm._resolve_api_base", lambda base: "https://api.hypercli.com")
    monkeypatch.setattr("hypercli_cli.llm._resolve_default_vision_model", lambda api_key, api_base: "kimi-k2.6")
    monkeypatch.setattr("hypercli_cli.llm._get_openai_client", lambda api_key, api_base: FakeOpenAI())

    result = runner.invoke(
        app,
        [
            "llm",
            "image",
            str(image_path),
            "--prompt",
            "Describe the fixture.",
            "--no-stream",
        ],
    )

    assert result.exit_code == 0
    assert "man with a beard" in result.stdout
    assert captured["model"] == "kimi-k2.6"
    assert captured["stream"] is False
    assert captured["messages"][0]["role"] == "user"
    content = captured["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "Describe the fixture."}
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"] == (
        "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode("ascii")
    )


def test_get_openai_client_sets_bounded_timeout(monkeypatch):
    captured = {}

    class FakeOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setenv("HYPER_LLM_TIMEOUT_SECONDS", "12.5")

    from hypercli_cli.llm import _get_openai_client

    _get_openai_client("hyper_api_test", "https://api.hypercli.com")

    assert captured["api_key"] == "hyper_api_test"
    assert str(captured["base_url"]) == "https://api.hypercli.com/v1"
    assert captured["timeout"] == 12.5
