"""Configuration handling"""
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

CONFIG_DIR = Path.home() / ".hypercli"
CONFIG_FILE = CONFIG_DIR / "config"

DEFAULT_API_URL = "https://api.hypercli.com"
DEFAULT_WS_URL = "wss://api.hypercli.com"
DEFAULT_AGENTS_API_BASE_URL = "https://api.hypercli.com/agents"
DEFAULT_AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE_URL = "https://api.dev.hypercli.com/agents"
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
    """Get product API key from env or config file."""
    return (
        get_config_value("HYPER_API_KEY")
        or get_config_value("HYPERCLI_API_KEY")
    )


def get_agent_api_key() -> Optional[str]:
    """Get agent-scoped API key, falling back to the full product key."""
    return (
        get_config_value("HYPER_AGENTS_API_KEY")
        or get_config_value("HYPER_API_KEY")
        or get_config_value("HYPERCLI_API_KEY")
    )


def get_api_url() -> str:
    """Get product API URL."""
    return (
        get_config_value("HYPER_API_BASE")
        or get_config_value("HYPERCLI_API_URL", DEFAULT_API_URL)
    )


def _normalize_agents_api_base(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return DEFAULT_AGENTS_API_BASE_URL
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    scheme = parsed.scheme or "https"
    normalized_path = parsed.path.rstrip("/")
    host = parsed.netloc.lower()
    if normalized_path.endswith("/agents"):
        return f"{scheme}://{parsed.netloc}{normalized_path}"
    if normalized_path.endswith("/api"):
        if host == "api.agents.hypercli.com":
            return DEFAULT_AGENTS_API_BASE_URL
        if host == "api.agents.dev.hypercli.com":
            return DEV_AGENTS_API_BASE_URL
        return f"{scheme}://{parsed.netloc}{normalized_path[:-4]}/agents"
    if host in {"api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app"}:
        return DEFAULT_AGENTS_API_BASE_URL
    if host in {
        "api.agents.dev.hypercli.com",
        "api.dev.hypercli.com",
        "api.dev.hyperclaw.app",
        "dev-api.hyperclaw.app",
    }:
        return DEV_AGENTS_API_BASE_URL
    normalized = raw.rstrip("/")
    return f"{normalized}/agents"


def _default_agents_ws_url(api_base: str) -> str:
    raw = _normalize_agents_api_base(api_base)
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower()
    if host in {"api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app"}:
        return DEFAULT_AGENTS_WS_URL
    if host in {
        "api.agents.dev.hypercli.com",
        "api.dev.hypercli.com",
        "api.dev.hyperclaw.app",
        "dev-api.hyperclaw.app",
    }:
        return DEV_AGENTS_WS_URL
    if raw.startswith("https://"):
        return f"wss://{raw[len('https://'):].rstrip('/')}/ws"
    if raw.startswith("http://"):
        return f"ws://{raw[len('http://'):].rstrip('/')}/ws"
    return f"{raw.rstrip('/')}/ws"


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
    configured = get_config_value("AGENTS_API_BASE_URL")
    if configured:
        return _normalize_agents_api_base(configured)
    if dev:
        return default
    product_base = get_config_value("HYPER_API_BASE") or get_config_value("HYPERCLI_API_URL")
    if product_base:
        return _normalize_agents_api_base(product_base)
    return default


def get_agents_api_base_url_from_product_base(product_base: str) -> str:
    """Derive the HyperClaw agents API base URL from an explicit product API base."""
    return _normalize_agents_api_base(product_base)


def get_agents_ws_url(dev: bool = False) -> str:
    """Get HyperClaw agents WebSocket base URL."""
    ws = get_config_value("AGENTS_WS_URL")
    if ws:
        return ws
    return _default_agents_ws_url(get_agents_api_base_url(dev))


def get_agents_ws_url_from_product_base(product_base: str) -> str:
    """Derive the HyperClaw agents WebSocket URL from an explicit product API base."""
    return _default_agents_ws_url(get_agents_api_base_url_from_product_base(product_base))


def configure(
    api_key: str,
    api_url: str = None,
    agents_api_base_url: str = None,
    agents_ws_url: str = None,
):
    """Save configuration to ~/.hypercli/config"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    config = _load_config_file()
    config["HYPER_API_KEY"] = api_key
    if api_url:
        config["HYPER_API_BASE"] = api_url
    if agents_api_base_url:
        config["AGENTS_API_BASE_URL"] = agents_api_base_url
    if agents_ws_url:
        config["AGENTS_WS_URL"] = agents_ws_url

    lines = [f"{k}={v}" for k, v in config.items()]
    CONFIG_FILE.write_text("\n".join(lines) + "\n")
    CONFIG_FILE.chmod(0o600)
