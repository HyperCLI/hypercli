#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


BACKEND_PATH = Path("/opt/hermes/plugins/memory/mem0/_backend.py")


def main() -> None:
    text = BACKEND_PATH.read_text(encoding="utf-8")
    if 'config["custom_instructions"] = custom_instructions' in text:
        return

    needle = """        config = {
            "vector_store": vector_store,
            "llm": _provider_block("llm"),
            "embedder": _provider_block("embedder"),
            "version": "v1.1",
        }
        self._memory = Memory.from_config(config)
"""
    replacement = """        config = {
            "vector_store": vector_store,
            "llm": _provider_block("llm"),
            "embedder": _provider_block("embedder"),
            "version": "v1.1",
        }
        custom_instructions = str(oss_config.get("custom_instructions") or "").strip()
        if custom_instructions:
            config["custom_instructions"] = custom_instructions
        self._memory = Memory.from_config(config)
"""
    if needle not in text:
        raise SystemExit(f"could not locate Mem0 OSSBackend config block in {BACKEND_PATH}")

    BACKEND_PATH.write_text(text.replace(needle, replacement), encoding="utf-8")


if __name__ == "__main__":
    main()
