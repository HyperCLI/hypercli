"""Configuration handling"""
import os
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".hypercli"
CONFIG_FILE = CONFIG_DIR / "config"

DEFAULT_API_URL = "https://api.hypercli.com"
DEFAULT_WS_URL = "wss://api.hypercli.com"
DEFAULT_AGENTS_API_BASE_URL = "https://api.agents.hypercli.com/api"
DEFAULT_AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE_URL = "https://api.agents.dev.hypercli.com/api"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"
WS_LOGS_PATH = "/orchestra/ws/logs"  # WebSocket path for job logs: {WS_URL}{WS_LOGS_PATH}/{job_key}

# GHCR images
GHCR_IMAGES = "ghcr.io/compute3ai/images"
COMFYUI_IMAGE = f"{GHCR_IMAGES}/comfyui"


def _load_config_file() -> dict:
    """Load config from ~/.hypercli/config"""
    config = {}
    if CONFIG_FILE.exists():
        for line in CONFIG_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip()
    return config
def get_config_value(key: str, default: str = None) -> Optional[str]:
    """Get config value: env var > config file > default"""
    env_val = os.getenv(key)
    if env_val:
        return env_val
    config = _load_config_file()
    return config.get(key, default)


def get_api_key() -> Optional[str]:
    """Get API key from env or config file"""
    return get_config_value("HYPERCLI_API_KEY")


def get_api_url() -> str:
    """Get API URL"""
    return get_config_value("HYPERCLI_API_URL", DEFAULT_API_URL)


def get_ws_url() -> str:
    """Get WebSocket URL"""
    ws = get_config_value("HYPERCLI_WS_URL")
    if ws:
        return ws
    # Derive from API URL
    api = get_api_url()
    return api.replace("https://", "wss://").replace("http://", "ws://")


def get_agents_api_base_url(dev: bool = False) -> str:
    """Get HyperClaw agents API base URL."""
    default = DEV_AGENTS_API_BASE_URL if dev else DEFAULT_AGENTS_API_BASE_URL
    return get_config_value("AGENTS_API_BASE_URL", default)


def get_agents_ws_url(dev: bool = False) -> str:
    """Get HyperClaw agents WebSocket base URL."""
    ws = get_config_value("AGENTS_WS_URL")
    if ws:
        return ws
    return DEV_AGENTS_WS_URL if dev else DEFAULT_AGENTS_WS_URL


def configure(
    api_key: str,
    api_url: str = None,
    agents_api_base_url: str = None,
    agents_ws_url: str = None,
):
    """Save configuration to ~/.hypercli/config"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    config = _load_config_file()
    config["HYPERCLI_API_KEY"] = api_key
    if api_url:
        config["HYPERCLI_API_URL"] = api_url
    if agents_api_base_url:
        config["AGENTS_API_BASE_URL"] = agents_api_base_url
    if agents_ws_url:
        config["AGENTS_WS_URL"] = agents_ws_url

    lines = [f"{k}={v}" for k, v in config.items()]
    CONFIG_FILE.write_text("\n".join(lines) + "\n")
    CONFIG_FILE.chmod(0o600)
