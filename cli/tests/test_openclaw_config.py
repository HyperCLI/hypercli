from hypercli_cli.agent import _config_openclaw


def test_config_openclaw_limits_runtime_models_to_supported_set():
    api_key = "sk-test"
    api_base = "https://api.agents.hypercli.com"
    models = [
        {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": True},
        {"id": "glm-5", "name": "GLM-5", "reasoning": True},
        {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "reasoning": False},
        {"id": "minimax-m2.5", "name": "MiniMax M2.5", "reasoning": False},
    ]

    config = _config_openclaw(api_key, models, api_base)
    providers = config["models"]["providers"]

    assert set(providers) == {"hyperclaw", "kimi-coding"}
    assert [m["id"] for m in providers["hyperclaw"]["models"]] == ["glm-5"]
    assert [m["id"] for m in providers["kimi-coding"]["models"]] == ["kimi-k2.5"]

    defaults = config["agents"]["defaults"]
    assert defaults["model"]["primary"] == "kimi-coding/kimi-k2.5"
    assert "memorySearch" not in defaults
