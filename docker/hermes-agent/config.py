#!/usr/bin/env python3
import subprocess
import sys
import os
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def owner_id(*names: str) -> int:
    for name in names:
        raw = os.environ.get(name, "").strip()
        if raw.isdigit():
            value = int(raw, 10)
            if 1 <= value <= 65534:
                return value
    return 10000


def main() -> int:
    managed_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/run/hypercli-hermes-managed")
    managed_dir.mkdir(parents=True, exist_ok=True)
    env_path = managed_dir / ".env"
    run(sys.executable, str(SCRIPT_DIR / "env.py"), str(env_path))
    os.chown(env_path, owner_id("HERMES_UID", "PUID"), owner_id("HERMES_GID", "PGID"))
    run(sys.executable, str(SCRIPT_DIR / "models.py"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
