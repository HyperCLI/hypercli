from pathlib import Path

from hypercli_cli.agent import _config_openclaw, _merge_openclaw_config, _show_snippet


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

    assert set(providers) == {"hyperclaw"}
    assert providers["hyperclaw"]["authHeader"] is True
    assert [m["id"] for m in providers["hyperclaw"]["models"]] == ["kimi-k2.5", "glm-5"]

    defaults = config["agents"]["defaults"]
    assert defaults["model"]["primary"] == "hyperclaw/kimi-k2.5"
    assert defaults["memorySearch"]["provider"] == "openai"
    assert defaults["memorySearch"]["model"] == "qwen3-embedding-4b"
    assert defaults["memorySearch"]["remote"]["baseUrl"] == "https://api.agents.hypercli.com/v1"


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


def test_config_openclaw_supports_placeholder_api_key_env():
    config = _config_openclaw(
        "sk-real",
        [
            {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": True},
            {"id": "glm-5", "name": "GLM-5", "reasoning": True},
            {"id": "qwen3-embedding-4b", "name": "Qwen3 Embedding 4B", "mode": "embedding"},
        ],
        "https://api.agents.hypercli.com",
        placeholder_env="HYPER_API_KEY",
    )

    providers = config["models"]["providers"]
    assert providers["hyperclaw"]["apiKey"] == "${HYPER_API_KEY}"
    assert config["agents"]["defaults"]["memorySearch"]["remote"]["apiKey"] == "${HYPER_API_KEY}"


def test_merge_openclaw_config_replaces_stale_provider_sections():
    existing = {
        "models": {
            "providers": {
                "hyperclaw": {"models": [{"id": "glm-5"}]},
                "kimi-coding": {"models": [{"id": "kimi-k2.5"}]},
            }
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": "hyperclaw/glm-5",
                    "fallbacks": ["anthropic/claude-opus-4-6"],
                },
                "models": {
                    "kimi-coding/kimi-k2.5": {"alias": "kimi"},
                    "hyperclaw/glm-5": {"alias": "glm"},
                }
            }
        },
        "gateway": {"port": 18789},
    }
    snippet = {
        "models": {
            "providers": {
                "hyperclaw": {
                    "models": [{"id": "kimi-k2.5"}, {"id": "glm-5"}]
                }
            }
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": "hyperclaw/kimi-k2.5",
                },
                "models": {
                    "hyperclaw/kimi-k2.5": {"alias": "kimi"},
                    "hyperclaw/glm-5": {"alias": "glm"},
                }
            }
        },
    }

    merged = _merge_openclaw_config(existing, snippet)

    assert set(merged["models"]["providers"]) == {"hyperclaw"}
    assert set(merged["agents"]["defaults"]["models"]) == {
        "hyperclaw/kimi-k2.5",
        "hyperclaw/glm-5",
    }
    assert merged["agents"]["defaults"]["model"] == {
        "primary": "hyperclaw/kimi-k2.5",
    }
    assert merged["gateway"]["port"] == 18789


def test_show_snippet_openclaw_apply_regenerates_models_cache(monkeypatch, tmp_path):
    calls = []

    def fake_run(args, capture_output, text, timeout, check):
        calls.append(args)
        class Result:
            returncode = 0
        return Result()

    monkeypatch.setattr("hypercli_cli.agent.shutil.which", lambda name: "/usr/bin/openclaw")
    monkeypatch.setattr("hypercli_cli.agent.subprocess.run", fake_run)

    target = tmp_path / "openclaw.json"
    data = {
        "models": {
            "providers": {
                "hyperclaw": {
                    "baseUrl": "https://api.agents.hypercli.com",
                    "apiKey": "hyper_api_xxx",
                    "api": "anthropic-messages",
                    "authHeader": True,
                    "models": [{"id": "kimi-k2.5"}],
                }
            }
        },
        "agents": {
            "defaults": {
                "model": {"primary": "hyperclaw/kimi-k2.5"},
                "models": {"hyperclaw/kimi-k2.5": {"alias": "kimi"}},
            }
        },
    }

    _show_snippet("OpenClaw", str(Path("~/.openclaw/openclaw.json")), data, True, target)

    assert target.exists()
    assert calls == [["openclaw", "models", "list"]]
