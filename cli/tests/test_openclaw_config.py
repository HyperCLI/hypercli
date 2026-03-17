from hypercli_cli.agent import _config_openclaw


def test_config_openclaw_limits_runtime_models_to_supported_set():
    api_key = "sk-test"
    api_base = "https://api.agents.hypercli.com"
    models = [
        {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": True},
        {"id": "glm-5", "name": "GLM-5", "reasoning": True},
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

    assert set(providers) == {"hyperclaw", "kimi-coding", "hyperclaw-embed"}
    assert [m["id"] for m in providers["hyperclaw"]["models"]] == ["glm-5"]
    assert [m["id"] for m in providers["kimi-coding"]["models"]] == ["kimi-k2.5"]
    assert [m["id"] for m in providers["hyperclaw-embed"]["models"]] == ["qwen3-embedding-4b"]

    defaults = config["agents"]["defaults"]
    assert defaults["model"]["primary"] == "kimi-coding/kimi-k2.5"
    assert defaults["memorySearch"]["provider"] == "openai"
    assert defaults["memorySearch"]["model"] == "qwen3-embedding-4b"
    assert defaults["memorySearch"]["remote"]["baseUrl"] == "https://api.agents.hypercli.com/v1/"


def test_config_openclaw_uses_first_embedding_model_for_memory_search():
    config = _config_openclaw(
        "sk-test",
        [
            {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": True},
            {"id": "text-embedding-3-large", "name": "Text Embedding 3 Large", "mode": "embedding"},
        ],
        "https://api.agents.hypercli.com",
    )

    defaults = config["agents"]["defaults"]
    assert defaults["memorySearch"]["model"] == "text-embedding-3-large"
