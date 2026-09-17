#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


keys = (
    "API_SERVER_CORS_ORIGINS",
    "API_SERVER_ENABLED",
    "API_SERVER_HOST",
    "API_SERVER_KEY",
    "API_SERVER_MODEL_NAME",
    "API_SERVER_PORT",
    "HYPER_AGENTS_API_BASE",
    "HYPER_AGENTS_API_KEY",
    "HYPER_EMBEDDING_MODELS",
    "HYPER_MODELS",
    "OPENAI_API_KEY",
)

target = Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
temporary = target.with_suffix(".tmp")
temporary.write_text(
    "".join(f"{key}={json.dumps(os.environ[key])}\n" for key in keys if key in os.environ),
    encoding="utf-8",
)
os.chmod(temporary, 0o600)
os.replace(temporary, target)
