#!/usr/bin/env python3
import json
import os
from pathlib import Path

import yaml


def csv(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    values = [part.strip() for part in raw.split(",") if part.strip()]
    return list(dict.fromkeys(values))


models = csv("HYPER_MODELS")
embedding_models = csv("HYPER_EMBEDDING_MODELS")

if models:
    path = Path(os.environ["CONFIG_PATH"])
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    config.setdefault("model", {})["default"] = models[0]
    extra = config.setdefault("gateway", {}).setdefault("platforms", {}).setdefault("api_server", {}).setdefault("extra", {})
    extra["model_name"] = models[0]
    extra["model_routes"] = {model: {"provider": "custom:hypercli", "model": model} for model in models}
    path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

if models or embedding_models:
    path = Path(os.environ["MEM0_CONFIG_PATH"])
    if path.exists():
        config = json.loads(path.read_text(encoding="utf-8"))
        oss = config.setdefault("oss", {})
        if models:
            oss.setdefault("llm", {}).setdefault("config", {})["model"] = models[0]
        if embedding_models:
            embedder = oss.setdefault("embedder", {}).setdefault("config", {})
            embedder["model"] = embedding_models[0]
            embedder["models"] = embedding_models
        path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
