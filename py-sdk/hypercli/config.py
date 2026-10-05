"""Configuration handling"""
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

def _hyper_home() -> Path:
    # HYPER_HOME is used verbatim (no `~` expansion), matching ts-cli
    # `cliConfigDir` and rs-sdk `config_dir_from_home`.
    configured = os.getenv("HYPER_HOME", "").strip()
    return Path(configured) if configured else Path.home() / ".hypercli"


CONFIG_DIR = _hyper_home()
CONFIG_FILE = CONFIG_DIR / "config"
_DEFAULT_CONFIG_FILE = CONFIG_FILE


def _config_file() -> Path:
    if CONFIG_FILE != _DEFAULT_CONFIG_FILE:
        return CONFIG_FILE
    return _hyper_home() / "config"


def config_file() -> Path:
    """Return the active HyperCLI config file path."""
    return _config_file()

DEFAULT_API_URL = "https://api.hypercli.com"
DEFAULT_WS_URL = "wss://api.hypercli.com"
DEFAULT_AGENTS_API_BASE_URL = "https://api.hypercli.com/agents"
DEFAULT_AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE_URL = "https://api.dev.hypercli.com/agents"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"
DEFAULT_AGENTS_ADMIN_API_BASE_URL = "https://api.agents.hypercli.com"
DEV_AGENTS_ADMIN_API_BASE_URL = "https://api.agents.dev.hypercli.com"
WS_LOGS_PATH = "/orchestra/ws/logs"  # WebSocket path for job logs: {WS_URL}{WS_LOGS_PATH}/{job_key}

# GHCR images
GHCR_IMAGES = "ghcr.io/compute3ai/images"
COMFYUI_IMAGE = f"{GHCR_IMAGES}/comfyui"


def _load_config_file() -> dict:
    """Load config from the HyperCLI data directory."""
    config = {}
    config_file = _config_file()
    if config_file.exists():
        for line in config_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                normalized = line.removeprefix("export ").strip()
                key, value = normalized.split("=", 1)
                value = value.strip()
                if (value.startswith('"') and value.endswith('"')) or (
                    value.startswith("'") and value.endswith("'")
                ):
                    value = value[1:-1]
                config[key.strip()] = value
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
    env_key = os.getenv("HYPER_API_KEY", "").strip()
    if env_key:
        return env_key
    config = _load_config_file()
    return config.get("HYPER_API_KEY")


def get_agent_api_key() -> Optional[str]:
    """Get the user-selected key, falling back to the managed runtime key."""
    agent_env_key = os.getenv("HYPER_AGENTS_API_KEY", "").strip()
    return get_api_key() or agent_env_key or None


def get_api_url() -> str:
    """Get product API URL."""
    return get_config_value("HYPER_API_BASE") or DEFAULT_API_URL


_AGENTS_PROD_HOSTS = ("api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app")
_AGENTS_DEV_HOSTS = (
    "api.agents.dev.hypercli.com",
    "api.dev.hypercli.com",
    "api.dev.hyperclaw.app",
    "dev-api.hyperclaw.app",
)
_DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443}


def _normalized_netloc(parsed) -> str:
    """Lowercased host with the scheme-default port dropped, matching the
    JS `URL.host`/`.origin` and rust `url::Url` serialization the ts-sdk
    (agent-urls.ts) and rs-sdk (config.rs) LOCKSTEP layers emit."""
    host = (parsed.hostname or "").lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port is not None and port != _DEFAULT_PORTS.get(parsed.scheme or "https"):
        return f"{host}:{port}"
    return host


def _normalize_agents_api_base(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return DEFAULT_AGENTS_API_BASE_URL
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    scheme = parsed.scheme or "https"
    normalized_path = parsed.path.rstrip("/")
    netloc = _normalized_netloc(parsed)
    if normalized_path.endswith("/agents"):
        return f"{scheme}://{netloc}{normalized_path}"
    if normalized_path.endswith("/api"):
        if netloc == "api.agents.hypercli.com":
            return DEFAULT_AGENTS_API_BASE_URL
        if netloc == "api.agents.dev.hypercli.com":
            return DEV_AGENTS_API_BASE_URL
        return f"{scheme}://{netloc}{normalized_path[:-4]}/agents"
    if netloc in _AGENTS_PROD_HOSTS:
        return DEFAULT_AGENTS_API_BASE_URL
    if netloc in _AGENTS_DEV_HOSTS:
        return DEV_AGENTS_API_BASE_URL
    normalized = raw.rstrip("/")
    return f"{normalized}/agents"


def _default_agents_ws_url(api_base: str) -> str:
    raw = _normalize_agents_api_base(api_base)
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    netloc = _normalized_netloc(parsed)
    if netloc in _AGENTS_PROD_HOSTS:
        return DEFAULT_AGENTS_WS_URL
    if netloc in _AGENTS_DEV_HOSTS:
        return DEV_AGENTS_WS_URL
    if raw.startswith("https://"):
        return f"wss://{raw[len('https://'):].rstrip('/')}/ws"
    if raw.startswith("http://"):
        return f"ws://{raw[len('http://'):].rstrip('/')}/ws"
    return f"{raw.rstrip('/')}/ws"


def get_ws_url() -> str:
    """Get WebSocket URL, derived from the product API URL."""
    api = get_api_url()
    return api.replace("https://", "wss://").replace("http://", "ws://")


def get_agents_api_base_url(dev: bool = False) -> str:
    """Get HyperClaw agents API base URL, derived from the product API base."""
    default = DEV_AGENTS_API_BASE_URL if dev else DEFAULT_AGENTS_API_BASE_URL
    if dev:
        return default
    product_base = get_config_value("HYPER_API_BASE")
    if product_base:
        return _normalize_agents_api_base(product_base)
    return default


def get_agents_api_base_url_from_product_base(product_base: str) -> str:
    """Derive the HyperClaw agents API base URL from an explicit product API base."""
    return _normalize_agents_api_base(product_base)


def get_agents_ws_url(dev: bool = False) -> str:
    """Get HyperClaw agents WebSocket base URL, derived from the agents API base."""
    return _default_agents_ws_url(get_agents_api_base_url(dev))


def get_agents_ws_url_from_product_base(product_base: str) -> str:
    """Derive the HyperClaw agents WebSocket URL from an explicit product API base."""
    return _default_agents_ws_url(get_agents_api_base_url_from_product_base(product_base))


_AGENTS_ADMIN_PROD_HOSTS = frozenset(_AGENTS_PROD_HOSTS)
_AGENTS_ADMIN_DEV_HOSTS = frozenset(_AGENTS_DEV_HOSTS)


def get_agents_admin_api_base_url_from_product_base(product_base: str) -> str:
    """Derive the agents admin API base (service-key surface) from a product API base."""
    raw = (product_base or "").strip()
    if not raw:
        return DEFAULT_AGENTS_ADMIN_API_BASE_URL
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    scheme = parsed.scheme or "https"
    netloc = _normalized_netloc(parsed)
    if netloc in _AGENTS_ADMIN_PROD_HOSTS:
        return DEFAULT_AGENTS_ADMIN_API_BASE_URL
    if netloc in _AGENTS_ADMIN_DEV_HOSTS:
        return DEV_AGENTS_ADMIN_API_BASE_URL
    path = parsed.path.rstrip("/")
    for suffix in ("/agents/admin", "/agents", "/admin", "/api"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    return urlunsplit((scheme, netloc, path, "", "")).rstrip("/")


# Legacy keys pruned on write so stale config-file values cannot shadow the
# derive-only resolution (mirrors the ts-cli `saveCliConfig` scrub).
_LEGACY_CONFIG_KEYS = (
    "HYPERCLI_API_KEY",
    "HYPERCLI_API_URL",
    "HYPERCLI_WS_URL",
    "AGENTS_API_BASE_URL",
    "AGENTS_WS_URL",
)


def configure(api_key: str, api_url: str = None):
    """Save configuration to ~/.hypercli/config"""
    config_file = _config_file()
    config_file.parent.mkdir(parents=True, exist_ok=True)

    config = _load_config_file()
    for legacy_key in _LEGACY_CONFIG_KEYS:
        config.pop(legacy_key, None)
    config["HYPER_API_KEY"] = api_key
    if api_url:
        config["HYPER_API_BASE"] = api_url

    lines = [f"{k}={v}" for k, v in config.items()]
    config_file.write_text("\n".join(lines) + "\n")
    config_file.chmod(0o600)
