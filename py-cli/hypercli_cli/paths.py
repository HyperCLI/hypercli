"""Shared HyperCLI CLI filesystem paths."""
import os
from pathlib import Path


def hyper_home() -> Path:
    configured = os.getenv("HYPER_HOME", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".hypercli"
