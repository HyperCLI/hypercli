#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile


CUSTOM_INSTRUCTIONS_ENV = "HERMES_MEMORY_CUSTOM_INSTRUCTIONS"


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
