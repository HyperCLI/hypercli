import json

import httpx
import pytest
import typer

from hypercli_cli import agent, onboard
from hypercli_cli.agent import _config_openclaw, _merge_openclaw_config, fetch_models


def test_config_openclaw_uses_catalog_order_and_modes_without_name_allowlist():
    api_key = "hyper_api_test"
    api_base = "https://api.agents.hypercli.com"
    models = [
        {"id": "coding-anthropic", "name": "coding", "reasoning": True},
        {"id": "default-anthropic", "name": "default", "reasoning": True},
        {"id": "kimi-k3-anthropic", "name": "Kimi K3", "reasoning": True},
        {
            "id": "qwen3-embedding-4b",
            "name": "Qwen3 Embedding 4B",
            "reasoning": False,
            "mode": "embedding",
        },
        {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "reasoning": False},
        {"id": "minimax-m2.5", "name": "MiniMax M2.5", "reasoning": False},
        {"id": "glm-5", "name": "glm-5", "mode": "chat", "contextWindow": 1048576},
        {"id": "image-generator", "name": "image-generator", "mode": "image_generation"},
    ]

    config = _config_openclaw(api_key, models, api_base)
    providers = config["models"]["providers"]

    assert set(providers) == {"hypercli"}
    assert providers["hypercli"]["authHeader"] is True
    assert [m["id"] for m in providers["hypercli"]["models"]] == [
        "coding-anthropic",
        "default-anthropic",
        "kimi-k3-anthropic",
        "claude-sonnet-4",
        "minimax-m2.5",
        "glm-5",
    ]
    assert providers["hypercli"]["models"][-1] == {
        "id": "glm-5", "name": "glm-5", "contextWindow": 1048576,
    }

    defaults = config["agents"]["defaults"]
    assert defaults["model"]["primary"] == "hypercli/coding-anthropic"
    assert "memorySearch" not in defaults
    memory_search = config["memory"]["search"]
    assert memory_search["provider"] == "openai"
    assert memory_search["model"] == "qwen3-embedding-4b"
    assert memory_search["remote"]["baseUrl"] == "https://api.agents.hypercli.com/v1"


def test_config_openclaw_uses_first_embedding_model_for_memory_search():
    config = _config_openclaw(
        "hyper_api_test",
        [
            {"id": "kimi-k3", "name": "Kimi K3", "reasoning": True},
            {"id": "text-embedding-3-large", "name": "Text Embedding 3 Large", "mode": "embedding"},
        ],
        "https://api.agents.hypercli.com",
    )

    assert config["memory"]["search"]["model"] == "text-embedding-3-large"


def test_config_openclaw_supports_placeholder_api_key_env():
    config = _config_openclaw(
        "hyper_api_real",
        [
            {"id": "coding-anthropic", "name": "coding", "reasoning": True},
            {"id": "kimi-k3-anthropic", "name": "Kimi K3", "reasoning": True},
            {"id": "qwen3-embedding-4b", "name": "Qwen3 Embedding 4B", "mode": "embedding"},
        ],
        "https://api.agents.hypercli.com",
        placeholder_env="HYPER_API_KEY",
    )

    providers = config["models"]["providers"]
    assert providers["hypercli"]["apiKey"] == "${HYPER_API_KEY}"
    assert config["memory"]["search"]["remote"]["apiKey"] == "${HYPER_API_KEY}"


def test_merge_openclaw_config_preserves_other_providers_and_user_defaults():
    legacy_provider = "hyper" + "claw"
    existing = {
        "models": {
            "providers": {
                legacy_provider: {"models": [{"id": "old-model"}]},
                "kimi-coding": {"models": [{"id": "kimi-k2.6"}]},
            }
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": f"{legacy_provider}/old-model",
                    "fallbacks": ["anthropic/claude-opus-4-6"],
                },
                "models": {
                    "kimi-coding/kimi-k2.6": {"alias": "kimi"},
                    f"{legacy_provider}/old-model": {"alias": "old"},
                }
            }
        },
        "gateway": {"port": 18789},
    }
    snippet = {
        "models": {
            "providers": {
                "hypercli": {
                    "models": [{"id": "coding-anthropic"}, {"id": "kimi-k3-anthropic"}]
                }
            }
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": "hypercli/coding-anthropic",
                },
                "models": {
                    "hypercli/coding-anthropic": {"alias": "coding"},
                    "hypercli/kimi-k3-anthropic": {"alias": "kimi"},
                }
            }
        },
    }

    merged = _merge_openclaw_config(existing, snippet)

    assert set(merged["models"]["providers"]) == {"hypercli", legacy_provider, "kimi-coding"}
    assert set(merged["agents"]["defaults"]["models"]) == {
        "hypercli/coding-anthropic",
        "hypercli/kimi-k3-anthropic",
        "kimi-coding/kimi-k2.6",
        f"{legacy_provider}/old-model",
    }
    assert merged["agents"]["defaults"]["model"] == {
        "primary": "hypercli/coding-anthropic",
        "fallbacks": ["anthropic/claude-opus-4-6"],
    }
    assert merged["gateway"]["port"] == 18789
    assert "hypercli" not in existing["models"]["providers"]


def test_merge_openclaw_config_drops_legacy_memory_search_keys():
    existing = {
        "agents": {
            "defaults": {
                "memorySearch": {
                    "provider": "openai",
                    "model": "qwen3-embedding-4b",
                }
            }
        },
        "memorySearch": {"enabled": True},
    }
    snippet = {
        "memory": {
            "search": {
                "provider": "openai",
                "model": "qwen3-embedding-4b",
            }
        }
    }

    merged = _merge_openclaw_config(existing, snippet)

    assert merged["memory"]["search"]["model"] == "qwen3-embedding-4b"
    assert "memorySearch" not in merged["agents"]["defaults"]
    assert "memorySearch" not in merged


def mock_catalog(monkeypatch, payload, status=200):
    def get(url, **kwargs):
        assert url == "https://gateway.test/v1/models"
        assert kwargs["headers"] == {"Authorization": "Bearer test-key"}
        return httpx.Response(status, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)


def test_fetch_models_maps_gateway_token_limits_without_alias_guesses(monkeypatch, capsys):
    mock_catalog(monkeypatch, {"data": [
        {"id": "default-anthropic", "mode": "chat", "max_input_tokens": 1048576,
         "max_output_tokens": 8192, "metadata": {"fallbacks": ["other"]}},
        {"id": "kimi-k2.6", "max_input_tokens": 123456, "max_output_tokens": 4096},
        {"id": "vector-model", "mode": "embedding", "max_input_tokens": 32768},
    ]})
    models = fetch_models("test-key", "https://gateway.test/")
    assert models == [
        {"id": "default-anthropic", "name": "default-anthropic", "mode": "chat",
         "contextWindow": 1048576, "maxTokens": 8192},
        {"id": "kimi-k2.6", "name": "kimi-k2.6", "contextWindow": 123456, "maxTokens": 4096},
        {"id": "vector-model", "name": "vector-model", "mode": "embedding", "contextWindow": 32768},
    ]
    assert "does not expose reasoning or input" in capsys.readouterr().out


@pytest.mark.parametrize("limit", [None, 0, -1, True, "1048576", 1.5])
def test_fetch_models_omits_missing_or_invalid_limits(monkeypatch, capsys, limit):
    mock_catalog(monkeypatch, {"data": [
        {"id": "kimi-k2.6", "max_input_tokens": limit, "max_output_tokens": limit},
    ]})
    assert fetch_models("test-key", "https://gateway.test") == [
        {"id": "kimi-k2.6", "name": "kimi-k2.6"},
    ]
    assert "Missing token limits" in capsys.readouterr().out


@pytest.mark.parametrize("payload,status", [
    ({"error": "denied"}, 403), ({}, 200), ({"data": []}, 200),
    ({"data": [{"name": "no id"}]}, 200), ({"data": {}}, 200),
])
@pytest.mark.parametrize("entrypoint", ["setup", "onboard"])
def test_unavailable_catalog_does_not_write_config(monkeypatch, tmp_path, payload, status, entrypoint):
    mock_catalog(monkeypatch, payload, status)
    config_path = tmp_path / "openclaw.json"
    original = '{"agents":{"defaults":{"contextTokens":98765}}}\n'
    config_path.write_text(original)
    key_path = tmp_path / "key.json"
    key_path.write_text('{"key":"test-key"}')
    monkeypatch.setattr(agent, "OPENCLAW_CONFIG_PATH", config_path)
    monkeypatch.setattr(agent, "AGENT_KEY_PATH", key_path)
    monkeypatch.setattr(agent, "_resolve_api_base", lambda: "https://gateway.test")
    monkeypatch.setattr(onboard, "OPENCLAW_CONFIG_PATH", config_path)
    with pytest.raises(typer.Exit) as exc:
        if entrypoint == "setup":
            agent.openclaw_setup(default=False)
        else:
            onboard.step_configure({"steps": {"subscribe": {"key": "test-key"}}}, True,
                                   "https://gateway.test")
    assert exc.value.exit_code == 1
    assert config_path.read_text() == original


@pytest.mark.parametrize("entrypoint", ["setup", "onboard"])
def test_generation_preserves_explicit_settings(monkeypatch, tmp_path, entrypoint):
    mock_catalog(monkeypatch, {"data": [
        {"id": "glm-5", "mode": "chat", "max_input_tokens": 1048576, "max_output_tokens": 8192},
        {"id": "new-chat", "mode": "chat", "max_input_tokens": 555555, "max_output_tokens": 4096},
        {"id": "vector-model", "mode": "embedding", "max_input_tokens": 32768},
    ]})
    custom_model = {"id": "glm-5", "name": "My model", "contextWindow": 777777,
                    "contextTokens": 123456, "maxTokens": 1024, "reasoning": True,
                    "input": ["text", "image"]}
    original = {
        "models": {"providers": {"hypercli": {"models": [custom_model]},
                                  "other": {"models": [{"id": "mine", "name": "Mine"}]}}},
        "agents": {"defaults": {"model": {"primary": "other/mine", "fallbacks": ["other/backup"]},
                                "models": {"hypercli/glm-5": {"alias": "custom"}},
                                "contextTokens": 98765}},
        "memory": {"search": {"provider": "local"}},
    }
    config_path = tmp_path / "openclaw.json"
    config_path.write_text(json.dumps(original))
    key_path = tmp_path / "key.json"
    key_path.write_text('{"key":"test-key"}')
    monkeypatch.setattr(agent, "OPENCLAW_CONFIG_PATH", config_path)
    monkeypatch.setattr(agent, "AGENT_KEY_PATH", key_path)
    monkeypatch.setattr(agent, "_resolve_api_base", lambda: "https://gateway.test")
    monkeypatch.setattr(onboard, "OPENCLAW_CONFIG_PATH", config_path)
    monkeypatch.setattr(onboard, "ONBOARD_DIR", tmp_path)
    monkeypatch.setattr(onboard, "STATE_PATH", tmp_path / "state.json")
    if entrypoint == "setup":
        agent.openclaw_setup(default=False)
    else:
        onboard.step_configure({"steps": {"subscribe": {"key": "test-key"}}}, True,
                               "https://gateway.test")
    result = json.loads(config_path.read_text())
    assert result["models"]["providers"]["hypercli"]["models"] == [custom_model, {
        "id": "new-chat", "name": "new-chat", "contextWindow": 555555, "maxTokens": 4096,
    }]
    assert result["models"]["providers"]["other"] == original["models"]["providers"]["other"]
    assert result["agents"]["defaults"]["model"] == original["agents"]["defaults"]["model"]
    assert result["agents"]["defaults"]["models"]["hypercli/glm-5"] == {"alias": "custom"}
    assert result["agents"]["defaults"]["contextTokens"] == 98765
    assert result["memory"] == original["memory"]
