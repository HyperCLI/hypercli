#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile


CUSTOM_INSTRUCTIONS_ENV = "HERMES_MEMORY_CUSTOM_INSTRUCTIONS"
AGENTS_API_BASE_ENV = "HYPER_AGENTS_API_BASE"


def _openai_base_url() -> str:
    """OSS LLM/embedder endpoint derived from the launch's agents API base.

    The baked mem0.json pins the prod agents host as the inert default.
    mem0's openai provider prefers the config's openai_base_url over the
    OPENAI_BASE_URL env var, so environment alone can never redirect a seeded
    config; rewrite the config here from the same agents base the model path
    uses (config.yaml's provider api + the entrypoint's HYPER_ACP_WS_URL
    derivation). <base>/v1/* hits litellm only at the host root, so a
    caller-supplied trailing /agents (the backend REST prefix) is stripped
    the same way run_acp_matrix.sh and the entrypoint strip it. Returns ""
    when no usable base is set: the baked value then stands.
    """
    base = os.environ.get(AGENTS_API_BASE_ENV, "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/agents"):
        base = base[: -len("/agents")].rstrip("/")
    if not base.lower().startswith(("http://", "https://")):
        return ""
    return f"{base}/v1"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: configure_mem0.py /path/to/mem0.json")

    path = Path(sys.argv[1])
    if not path.exists() or path.is_symlink():
        return

    instructions = os.environ.get(CUSTOM_INSTRUCTIONS_ENV, "").strip()
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        if instructions:
            raise
        return
    if not isinstance(config, dict):
        raise SystemExit(f"{path} must contain a JSON object")

    original = json.dumps(config, sort_keys=True)
    if instructions:
        oss = config.setdefault("oss", {})
        if not isinstance(oss, dict):
            raise SystemExit(f"{path} oss must be a JSON object")
        oss["custom_instructions"] = instructions
    else:
        oss = config.get("oss")
        if isinstance(oss, dict):
            oss.pop("custom_instructions", None)

    openai_base_url = _openai_base_url()
    if openai_base_url:
        oss = config.get("oss")
        if isinstance(oss, dict):
            for block_name in ("llm", "embedder"):
                block = oss.get(block_name)
                if not isinstance(block, dict):
                    continue
                if str(block.get("provider") or "").strip().lower() != "openai":
                    continue
                block_config = block.setdefault("config", {})
                if isinstance(block_config, dict):
                    block_config["openai_base_url"] = openai_base_url

    if json.dumps(config, sort_keys=True) == original:
        return

    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


if __name__ == "__main__":
    main()
