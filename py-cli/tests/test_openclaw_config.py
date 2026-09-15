from hypercli_cli.agent import _config_openclaw, _merge_openclaw_config


def test_config_openclaw_limits_runtime_models_to_supported_set():
    api_key = "hyper_api_test"
    api_base = "https://api.agents.hypercli.com"
    models = [
        {"id": "coding-anthropic", "name": "coding", "reasoning": True},
        {"id": "kimi-k3-anthropic", "name": "Kimi K3", "reasoning": True},
        {
            "id": "qwen3-embedding-4b",
            "name": "Qwen3 Embedding 4B",
            "reasoning": False,
            "mode": "embedding",
        },
        {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "reasoning": False},
        {"id": "minimax-m2.5", "name": "MiniMax M2.5", "reasoning": False},
    ]

    config = _config_openclaw(api_key, models, api_base)
    providers = config["models"]["providers"]

    assert set(providers) == {"hypercli"}
    assert providers["hypercli"]["authHeader"] is True
    assert [m["id"] for m in providers["hypercli"]["models"]] == [
        "coding-anthropic",
        "kimi-k3-anthropic",
    ]

    defaults = config["agents"]["defaults"]
    assert defaults["model"]["primary"] == "hypercli/coding-anthropic"
    assert defaults["memorySearch"]["provider"] == "openai"
    assert defaults["memorySearch"]["model"] == "qwen3-embedding-4b"
    assert defaults["memorySearch"]["remote"]["baseUrl"] == "https://api.agents.hypercli.com/v1"


def test_config_openclaw_uses_first_embedding_model_for_memory_search():
    config = _config_openclaw(
        "hyper_api_test",
        [
            {"id": "kimi-k3", "name": "Kimi K3", "reasoning": True},
            {"id": "text-embedding-3-large", "name": "Text Embedding 3 Large", "mode": "embedding"},
        ],
        "https://api.agents.hypercli.com",
    )

    defaults = config["agents"]["defaults"]
    assert defaults["memorySearch"]["model"] == "text-embedding-3-large"


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
    assert config["agents"]["defaults"]["memorySearch"]["remote"]["apiKey"] == "${HYPER_API_KEY}"


def test_merge_openclaw_config_replaces_stale_provider_sections():
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

    assert set(merged["models"]["providers"]) == {"hypercli"}
    assert set(merged["agents"]["defaults"]["models"]) == {
        "hypercli/coding-anthropic",
        "hypercli/kimi-k3-anthropic",
    }
    assert merged["agents"]["defaults"]["model"] == {
        "primary": "hypercli/coding-anthropic",
    }
    assert merged["gateway"]["port"] == 18789
