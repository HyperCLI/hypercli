"""Shared HyperCLI CLI filesystem paths."""
import os
from pathlib import Path


def hyper_home() -> Path:
    # HYPER_HOME is used verbatim (no `~` expansion), matching ts-cli
    # `cliConfigDir` and rs-sdk `config_dir_from_home`.
    configured = os.getenv("HYPER_HOME", "").strip()
    return Path(configured) if configured else Path.home() / ".hypercli"
