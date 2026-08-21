"""
HyperClaw Deployments API — runtime management for OpenClaw agent containers.

Client for HyperClaw backend deployment endpoints. Manages the
`hypercli-openclaw` container image and arbitrary agent runtimes via the
authenticated backend API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import asyncio
import copy
import inspect
import json
import mimetypes
import os
import re
import secrets
import shlex
import time
from typing import (
    TYPE_CHECKING,
    Awaitable,
    Callable,
    ClassVar,
    Literal,
    Optional,
    Any,
    AsyncIterator,
    NotRequired,
    TypeVar,
    TypedDict,
    cast,
)
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from contextlib import asynccontextmanager
from uuid import UUID

import httpx

from .config import get_agents_api_base_url, get_config_value
from .http import HTTPClient, APIError
from .openclaw.gateway import create_openclaw_sdk_session_key

if TYPE_CHECKING:
    from .hermes import HermesApiClient
    from .openclaw.gateway import ChatEvent, GatewayClient


AGENTS_API_BASE = "https://api.hypercli.com/agents"
AGENTS_API_PREFIX = "/deployments"
AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE = "https://api.dev.hypercli.com/agents"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"
DEFAULT_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-latest"
DEFAULT_OPENCLAW_PRO_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-latest"
DEFAULT_HERMES_AGENT_IMAGE = "ghcr.io/hypercli/hypercli-hermes-agent:latest"
DEFAULT_OPENCODE_IMAGE = "ghcr.io/hypercli/hypercli-opencode:latest"
DEFAULT_CODEX_IMAGE = "ghcr.io/hypercli/hypercli-codex:latest"
DEFAULT_CLAUDE_CODE_IMAGE = "ghcr.io/hypercli/hypercli-claude-code:latest"
DEFAULT_GOOSE_IMAGE = "ghcr.io/hypercli/hypercli-goose:latest"
DEFAULT_KIMI_CODE_IMAGE = "ghcr.io/hypercli/hypercli-kimi-code:latest"
DEFAULT_BUZZ_AGENT_IMAGE = "ghcr.io/hypercli/hypercli-buzz-agent:latest"
DEFAULT_BUZZ_OPENCODE_IMAGE = "ghcr.io/hypercli/hypercli-buzz-opencode:latest"
DEFAULT_BUZZ_CODEX_IMAGE = "ghcr.io/hypercli/hypercli-buzz-codex:latest"
DEFAULT_BUZZ_CLAUDE_CODE_IMAGE = "ghcr.io/hypercli/hypercli-buzz-claude:latest"
DEFAULT_BUZZ_GOOSE_IMAGE = "ghcr.io/hypercli/hypercli-buzz-goose:latest"
DEFAULT_BUZZ_KIMI_CODE_IMAGE = "ghcr.io/hypercli/hypercli-buzz-kimi-code:latest"


def _new_application_secret() -> str:
    return secrets.token_hex(32)


DEFAULT_AGENT_RUNTIME_SCOPES = [
    "agents:none",
    "files:*",
    "flows:*",
    "models:*",
    "voice:*",
    "web:*",
    "workspaces:*",
]
OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS = {
    "OPENCLAW_MEMORY_SEARCH_ENABLED": "1",
    "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START": "0",
    "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH": "0",
    "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH": "0",
    "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS": "30000",
    "OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES": "0",
}
OPENCLAW_WORKSPACES_ENV_DEFAULTS = {
    "HYPER_WORKSPACES_BOOT_SYNC": "1",
    "HYPER_WORKSPACES_DIR": "/home/node/shared",
    "HYPER_WORKSPACES_SYNC_READY_ONLY": "1",
}
DEFAULT_OPENCLAW_SYNC_EXCLUDE = (
    "shared/**",
    ".openclaw/npm/**/node_modules/**",
    ".openclaw/agents/**/agent/*.sqlite.memory-reindex-*",
    ".openclaw/agents/**/agent/*.sqlite.reindex-lock.sqlite*",
    ".openclaw/browser/**/Code Cache/**",
    ".openclaw/browser/**/GPUCache/**",
    ".openclaw/browser/**/ShaderCache/**",
    ".openclaw/browser/**/GrShaderCache/**",
    ".openclaw/browser/**/optimization_guide_model_store/**",
)
LAUNCH_CONFIG_KEYS = frozenset(
    {
        "image",
        "env",
        "secrets",
        "routes",
        "command",
        "entrypoint",
        "sync_root",
        "sync_include",
        "sync_exclude",
        "sync_uid",
        "sync_gid",
        "registry_url",
        "registry_auth",
        "restart",
        "runtime_scopes",
    }
)
DEFAULT_OPENCLAW_SYNC_ROOT = "/home/node"
DEFAULT_HERMES_AGENT_SYNC_ROOT = "/opt/data"
DEFAULT_CODING_AGENT_SYNC_ROOT = "/home/node"
AGENT_FILE_MAX_BYTES = 250 * 1024 * 1024
# Reef file writes traverse the Cloudflare-proxied agent hostname
# (https://<agent>.hypercli.app/_reef/...), whose edge rejects request bodies
# above 100 MB. Enforced client-side so oversized writes fail fast with a
# clear error instead of an opaque edge ``413 Payload Too Large``.
AGENT_FILE_WRITE_MAX_BYTES = 100 * 1024 * 1024
AGENT_FILE_TRANSFER_CHUNK_BYTES = 64 * 1024
AGENT_FILE_OPERATION_TIMEOUT_SECONDS = 300
AGENT_EXEC_OUTPUT_MAX_BYTES = 1_048_576
# Every valid raw output byte can become a six-byte ``\u00xx`` JSON escape.
AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES = (6 * AGENT_EXEC_OUTPUT_MAX_BYTES) + 4096
_UNSET = object()
_T = TypeVar("_T")


# Public lifecycle values remain strings so newer server states continue to
# round-trip through older clients. These collections only classify the
# canonical states the SDK understands today; they are not a client-side FSM.
CANONICAL_AGENT_STATES: tuple[str, ...] = (
    "CREATING",
    "STARTING",
    "RESTORING",
    "RUNNING",
    "STOPPING",
    "STOPPED",
    "ARCHIVING",
    "ARCHIVED",
    "FAILED",
    "DELETED",
)
AGENT_TRANSITIONAL_STATES = frozenset(
    {
        "CREATING",
        "STARTING",
        "RESTORING",
        "STOPPING",
        "ARCHIVING",
    }
)
AGENT_RUNTIME_INACTIVE_STATES = frozenset({"STOPPED", "ARCHIVING", "ARCHIVED", "DELETED", "FAILED"})
AGENT_WAIT_RUNNING_FAILURE_STATES = frozenset({"STOPPED", "ARCHIVED", "DELETED", "FAILED"})


def is_agent_transitional_state(state: str) -> bool:
    """Return whether a known public state represents work in progress."""

    return str(state or "").upper() in AGENT_TRANSITIONAL_STATES


def is_agent_runtime_inactive_state(state: str) -> bool:
    """Return whether a known public state has no live runtime slot."""

    return str(state or "").upper() in AGENT_RUNTIME_INACTIVE_STATES


def _run_sync(
    operation: Callable[[], Awaitable[_T]],
    *,
    running_loop_error: str,
) -> _T:
    """Run an async operation from sync code without leaking loop probes."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError(running_loop_error)

    return asyncio.run(operation())


ManagedAgentRuntime = Literal[
    "generic",
    "openclaw",
    "openclaw-pro",
    "hermes-agent",
    "buzz-agent",
    "opencode",
    "codex",
    "claude-code",
    "goose",
    "kimi-code",
]
AgentSize = Literal["small", "medium", "large"]
_AGENT_SIZES = frozenset({"small", "medium", "large"})


def _parse_agent_size(value: object, *, field_name: str) -> AgentSize:
    if not isinstance(value, str) or value not in _AGENT_SIZES:
        raise ValueError(f"{field_name} must be one of: small, medium, large")
    return cast(AgentSize, value)


CodingAgentRuntime = Literal["buzz-agent", "opencode", "codex", "claude-code", "goose", "kimi-code"]

DEFAULT_CODING_AGENT_IMAGES: dict[CodingAgentRuntime, str] = {
    "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
    "opencode": DEFAULT_OPENCODE_IMAGE,
    "codex": DEFAULT_CODEX_IMAGE,
    "claude-code": DEFAULT_CLAUDE_CODE_IMAGE,
    "goose": DEFAULT_GOOSE_IMAGE,
    "kimi-code": DEFAULT_KIMI_CODE_IMAGE,
}
DEFAULT_CODING_AGENT_SYNC_INCLUDES: dict[CodingAgentRuntime, tuple[str, ...] | None] = {
    "buzz-agent": None,
    "opencode": (
        ".config/opencode",
        ".local/share/opencode",
        ".local/state/opencode",
        ".cache/opencode",
    ),
    "codex": (".codex",),
    "claude-code": (".claude", ".claude.json"),
    "goose": (".goose",),
    "kimi-code": (".kimi-code",),
}
DEFAULT_BUZZ_CODING_AGENT_IMAGES: dict[CodingAgentRuntime, str] = {
    "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
    "opencode": DEFAULT_BUZZ_OPENCODE_IMAGE,
    "codex": DEFAULT_BUZZ_CODEX_IMAGE,
    "claude-code": DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
    "goose": DEFAULT_BUZZ_GOOSE_IMAGE,
    "kimi-code": DEFAULT_BUZZ_KIMI_CODE_IMAGE,
}

_BUZZ_RUNTIME_COMMANDS: dict[CodingAgentRuntime, tuple[str, list[str], str]] = {
    "buzz-agent": ("/usr/local/bin/buzz-agent", [], "/usr/local/bin/buzz-dev-mcp"),
    "opencode": ("/usr/local/bin/opencode", ["acp"], ""),
    "codex": ("/usr/local/bin/codex-acp", [], "/usr/local/bin/buzz-dev-mcp"),
    "claude-code": ("/usr/local/bin/claude-agent-acp", [], ""),
    "goose": ("/usr/local/bin/goose", ["acp"], ""),
    "kimi-code": ("/usr/local/bin/kimi", ["acp"], ""),
}
DEFAULT_BUZZ_RUST_LOG = "buzz_acp=info,hypercli_buzz_acp=info,pool::prompt=info,acp::stream=off"
BUZZ_RESERVED_ENV_KEYS = frozenset(
    {
        "BUZZ_PRIVATE_KEY",
        "NOSTR_PRIVATE_KEY",
        "BUZZ_AUTH_TAG",
        "BUZZ_API_TOKEN",
        "BUZZ_ACP_PRIVATE_KEY",
        "BUZZ_ACP_API_TOKEN",
        "BUZZ_RELAY_URL",
        "BUZZ_ACP_AGENT_OWNER",
        "BUZZ_ACP_AGENT_COMMAND",
        "BUZZ_ACP_AGENT_ARGS",
        "BUZZ_ACP_MCP_COMMAND",
        "BUZZ_ACP_LAZY_POOL",
        "BUZZ_ACP_RELAY_OBSERVER",
        "BUZZ_ACP_DISPLAY_NAME",
        "BUZZ_ACP_TEXT_MENTIONS",
        "BUZZ_ACP_REQUIRE_REPLY",
        "CLAUDE_CODE_EXECUTABLE",
        "BUZZ_ACP_SESSION_TITLE",
        "BUZZ_ACP_SYSTEM_PROMPT",
        "BUZZ_ACP_MODEL",
        "BUZZ_ACP_IDLE_TIMEOUT",
        "BUZZ_ACP_MAX_TURN_DURATION",
        "BUZZ_ACP_AGENTS",
        "BUZZ_ACP_RESPOND_TO",
        "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
        "BUZZ_ACP_MULTIPLE_EVENT_HANDLING",
        "BUZZ_ACP_DEDUP",
        "BUZZ_ACP_SETUP_PAYLOAD",
        "BUZZ_MANAGED_AGENT",
        # No longer minted by the SDK; kept listed so caller-supplied values are stripped.
        "BUZZ_MANAGED_AGENT_START_NONCE",
    }
)


@dataclass(repr=False)
class BuzzLaunchConfig:
    """Typed Buzz ACP launch settings for a hosted coding runtime.

    The private key is intentionally excluded from ``repr``. Buzz-owned
    launch values are rendered last so generic ``env`` and ``secrets``
    mappings cannot replace identity or harness configuration.
    """

    private_key_nsec: str
    relay_url: str
    auth_tag: str | None = None
    system_prompt: str | None = None
    model: str | None = None
    idle_timeout_seconds: int | None = None
    max_turn_duration_seconds: int | None = None
    parallelism: int = 1
    respond_to: str | None = None
    respond_to_allowlist: list[str] = field(default_factory=list)
    display_name: str | None = None
    text_mentions: bool = False
    require_reply: bool = False
    session_title: str | None = None
    rust_log: str | None = None

    def environment(
        self,
        runtime: CodingAgentRuntime,
        *,
        default_session_title: str | None = None,
    ) -> dict[str, str]:
        if not self.private_key_nsec.strip():
            raise ValueError("buzz.private_key_nsec is required")
        if not self.relay_url.strip():
            raise ValueError("buzz.relay_url is required")
        if not 1 <= self.parallelism <= 32:
            raise ValueError("buzz.parallelism must be between 1 and 32")

        default_command, default_args, default_mcp = _BUZZ_RUNTIME_COMMANDS[runtime]
        env = {
            "BUZZ_RELAY_URL": self.relay_url,
            "BUZZ_ACP_AGENT_COMMAND": default_command,
            "BUZZ_ACP_AGENT_ARGS": ",".join(default_args),
            "BUZZ_ACP_MCP_COMMAND": default_mcp,
            "BUZZ_ACP_LAZY_POOL": "true",
            "BUZZ_ACP_RELAY_OBSERVER": "true",
            "BUZZ_ACP_AGENTS": str(self.parallelism),
            "BUZZ_ACP_MULTIPLE_EVENT_HANDLING": "steer",
            "BUZZ_ACP_DEDUP": "queue",
        }
        if runtime == "claude-code":
            env["CLAUDE_CODE_EXECUTABLE"] = "/usr/local/bin/claude"
        optional = {
            "BUZZ_AUTH_TAG": self.auth_tag,
            "BUZZ_ACP_DISPLAY_NAME": self.display_name,
            "BUZZ_ACP_SESSION_TITLE": self.session_title or default_session_title,
            "BUZZ_ACP_SYSTEM_PROMPT": self.system_prompt,
            "BUZZ_ACP_MODEL": self.model,
            "BUZZ_ACP_IDLE_TIMEOUT": (
                str(self.idle_timeout_seconds) if self.idle_timeout_seconds is not None else None
            ),
            "BUZZ_ACP_MAX_TURN_DURATION": (
                str(self.max_turn_duration_seconds)
                if self.max_turn_duration_seconds is not None
                else None
            ),
            "BUZZ_ACP_RESPOND_TO": self.respond_to,
            "BUZZ_ACP_RESPOND_TO_ALLOWLIST": (
                ",".join(self.respond_to_allowlist) if self.respond_to_allowlist else None
            ),
        }
        env.update({key: value for key, value in optional.items() if value})
        if self.text_mentions:
            env["BUZZ_ACP_TEXT_MENTIONS"] = "true"
        if self.require_reply:
            env["BUZZ_ACP_REQUIRE_REPLY"] = "true"
        if self.rust_log:
            env["RUST_LOG"] = self.rust_log
        return env

    def secrets(self) -> dict[str, str]:
        if not self.private_key_nsec.strip():
            raise ValueError("buzz.private_key_nsec is required")
        return {
            "BUZZ_PRIVATE_KEY": self.private_key_nsec,
            "NOSTR_PRIVATE_KEY": self.private_key_nsec,
        }


# Public file access is one Reef-backed, sync-root-relative API. S3 is reserved
# for archive/restore internals and gateway RPCs remain available through the
# explicit gateway client instead of being multiplexed into these methods.
OPENCLAW_SYNC_ROOT = "/home/node"
# Retained for callers that want to address the conventional OpenClaw workspace;
# the generic files API no longer applies this prefix implicitly.
OPENCLAW_WORKSPACE_PREFIX = ".openclaw/workspace"


def strip_rel_prefix(path: str) -> str:
    """Strip leading `./` segments and slashes without eating a dotfile's dot."""
    return re.sub(r"^/+", "", re.sub(r"^(?:\./)+", "", path))


def resolve_sync_root_file_path(path: str) -> str:
    """Normalize one path relative to the Agent's configured Reef sync root."""
    normalized = path.replace("\\", "/")
    if normalized.startswith("/"):
        raise ValueError("agent file paths must be relative to the sync root")
    rel = strip_rel_prefix(normalized)
    if ".." in rel.replace("\\", "/").split("/"):
        raise ValueError("agent file paths must stay within the sync root")
    return "" if rel == "." else rel


def normalize_writable_backend_file_path(path: str) -> str:
    """Return a safe sync-root-relative path accepted by the public files API."""
    return resolve_sync_root_file_path(path)


class AgentFiles:
    """Reef-backed file access scoped to an agent's configured sync root."""

    def __init__(
        self,
        agent: "Agent",
        deployments: "Deployments",
    ):
        self._agent = agent
        self._deployments = deployments

    def list(self, path: str = "") -> list[dict]:
        return self._deployments.files_list(self._agent, path)

    def read_bytes(self, path: str) -> bytes:
        return self._deployments.file_read_bytes(self._agent, path)

    def read_bytes_with_metadata(self, path: str) -> dict[str, Any]:
        return self._deployments.file_read_bytes_with_metadata(self._agent, path)

    def read(self, path: str) -> str:
        return self._deployments.file_read(self._agent, path)

    def write_bytes(self, path: str, content: bytes) -> dict:
        return self._deployments.file_write_bytes(self._agent, path, content)

    def write(self, path: str, content: str) -> dict:
        return self._deployments.file_write(self._agent, path, content)

    def delete(self, path: str, recursive: bool = False) -> dict:
        return self._deployments.file_delete(self._agent, path, recursive=recursive)


def _is_directory_listing_payload(value: object) -> bool:
    return (
        isinstance(value, dict)
        and value.get("type") == "directory"
        and isinstance(value.get("directories"), list)
        and isinstance(value.get("files"), list)
    )


def build_openclaw_routes(
    *,
    include_gateway: bool = True,
    include_desktop: bool = False,
    gateway_port: int = 18789,
    desktop_port: int = 3000,
    gateway_auth: bool = False,
    desktop_auth: bool = True,
    gateway_prefix: str = "",
    desktop_prefix: str = "desktop",
) -> dict[str, dict]:
    routes: dict[str, dict] = {}
    if include_gateway:
        routes["openclaw"] = {
            "port": int(gateway_port),
            "auth": bool(gateway_auth),
            "prefix": str(gateway_prefix),
        }
    if include_desktop:
        routes["desktop"] = {
            "port": int(desktop_port),
            "auth": bool(desktop_auth),
            "prefix": str(desktop_prefix),
        }
    return routes


def build_hermes_agent_routes(
    *,
    port: int = 8642,
    auth: bool = False,
    prefix: str = "",
) -> dict[str, dict]:
    """Build the public route for Hermes' bearer-authenticated API Server."""
    return {
        "hermes": {
            "port": int(port),
            "auth": bool(auth),
            "prefix": str(prefix),
        }
    }


def _resolve_hermes_agent_routes(
    routes: dict | None,
    *,
    hermes_routes: dict | None = None,
    hermes_route_options: dict | None = None,
) -> dict:
    if routes is not None:
        return routes
    if hermes_routes is not None:
        return hermes_routes
    return build_hermes_agent_routes(**dict(hermes_route_options or {}))


def _inject_hermes_api_server_key(
    env: dict | None,
    secret_env: dict | None,
    api_server_key: str | None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    env_map: dict[str, Any] = dict(env or {})
    secret_map: dict[str, Any] = dict(secret_env or {})
    public_key = env_map.pop("API_SERVER_KEY", None)
    stored_key = secret_map.get("API_SERVER_KEY")
    supplied_keys = {
        str(value).strip()
        for value in (api_server_key, stored_key, public_key)
        if value is not None and str(value).strip()
    }
    if len(supplied_keys) > 1:
        raise ValueError("Hermes API_SERVER_KEY conflicts between inputs")
    effective_key = next(iter(supplied_keys), "")
    if not effective_key:
        effective_key = secrets.token_urlsafe(32)
    secret_map["API_SERVER_KEY"] = effective_key
    return env_map, secret_map, effective_key


def _inject_openclaw_gateway_token(
    env: dict | None,
    secret_env: dict | None,
    gateway_token: str | None,
    *,
    generate: bool,
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    env_map: dict[str, Any] = dict(env or {})
    secret_map: dict[str, Any] = dict(secret_env or {})
    if "OPENCLAW_GATEWAY_TOKEN" in env_map:
        raise ValueError("OPENCLAW_GATEWAY_TOKEN must be supplied through secrets or gateway_token")
    stored_token = str(secret_map.get("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    explicit_token = str(gateway_token).strip() if gateway_token is not None else ""
    if gateway_token is not None and not explicit_token:
        raise ValueError("gateway_token must not be blank")
    if explicit_token and stored_token and explicit_token != stored_token:
        raise ValueError("gateway_token conflicts with secrets.OPENCLAW_GATEWAY_TOKEN")
    effective_token = explicit_token or stored_token
    if not effective_token and generate:
        effective_token = _new_application_secret()
    if effective_token:
        secret_map["OPENCLAW_GATEWAY_TOKEN"] = effective_token
    return env_map, secret_map, effective_token or None


def _build_openclaw_runtime_config(
    config: dict | None,
    heartbeat: dict | None,
) -> dict:
    prepared = copy.deepcopy(config or {})
    if heartbeat:
        agents_config = dict(prepared.get("agents") or {})
        defaults_config = dict(agents_config.get("defaults") or {})
        heartbeat_config = dict(defaults_config.get("heartbeat") or {})
        heartbeat_config.update(dict(heartbeat))
        defaults_config["heartbeat"] = heartbeat_config
        agents_config["defaults"] = defaults_config
        prepared["agents"] = agents_config
    return prepared


def _resolve_openclaw_routes(
    routes: dict | None,
    *,
    openclaw_routes: dict | None = None,
    openclaw_route_options: dict | None = None,
) -> dict | None:
    if routes is not None:
        return routes
    if openclaw_routes is not None:
        return openclaw_routes
    return build_openclaw_routes(**dict(openclaw_route_options or {}))


def _env_bool(value: object) -> str:
    return "1" if bool(value) else "0"


def _env_non_negative_int(name: str, value: object) -> str:
    integer = int(value)
    if integer < 0:
        raise ValueError(f"{name} must be non-negative")
    return str(integer)


def build_openclaw_memory_index_env(memory_index: dict | None = None) -> dict[str, str]:
    """Build OpenClaw memory-search indexing environment variables.

    No env vars are emitted unless memory_index is provided; the image config
    carries the no-auto-indexing defaults. Passing an empty dict explicitly
    emits the default env block.
    """
    if memory_index is None:
        return {}
    env = dict(OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS)
    if memory_index.get("enabled") is not None:
        env["OPENCLAW_MEMORY_SEARCH_ENABLED"] = _env_bool(memory_index["enabled"])
    if memory_index.get("on_session_start") is not None:
        env["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START"] = _env_bool(
            memory_index["on_session_start"]
        )
    if memory_index.get("on_search") is not None:
        env["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH"] = _env_bool(memory_index["on_search"])
    if memory_index.get("watch") is not None:
        env["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH"] = _env_bool(memory_index["watch"])
    if memory_index.get("watch_debounce_ms") is not None:
        env["OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS"] = _env_non_negative_int(
            "watch_debounce_ms",
            memory_index["watch_debounce_ms"],
        )
    if memory_index.get("interval_minutes") is not None:
        env["OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES"] = _env_non_negative_int(
            "interval_minutes",
            memory_index["interval_minutes"],
        )
    return env


def build_openclaw_workspaces_sync_env(
    workspaces_sync: dict | bool | None = None,
) -> dict[str, str]:
    """Build OpenClaw Workspaces boot-sync environment variables.

    Shared knowledge sync defaults on for OpenClaw launch helpers. Callers can
    pass False or {"enabled": False} to disable it, tune ready-only behavior or
    the single-Workspace target here, and override the output directory with
    ``HYPER_WORKSPACES_DIR`` in the launch environment.
    """
    if workspaces_sync is False:
        return {"HYPER_WORKSPACES_BOOT_SYNC": "0"}
    options = (
        {} if workspaces_sync is None or workspaces_sync is True else dict(workspaces_sync or {})
    )
    if options.get("enabled") is False:
        return {"HYPER_WORKSPACES_BOOT_SYNC": "0"}
    if options.get("output_dir") is not None or options.get("dir") is not None:
        raise ValueError("Set HYPER_WORKSPACES_DIR in env to override the Workspaces directory")
    env = dict(OPENCLAW_WORKSPACES_ENV_DEFAULTS)
    if options.get("enabled") is not None:
        env["HYPER_WORKSPACES_BOOT_SYNC"] = _env_bool(options["enabled"])
    if options.get("ready_only") is not None:
        env["HYPER_WORKSPACES_SYNC_READY_ONLY"] = _env_bool(options["ready_only"])
    workspace = options.get("workspace") or options.get("workspace_ref")
    if workspace:
        env["HYPER_WORKSPACES_SYNC_WORKSPACE"] = str(workspace)
    return env


def _default_gateway_timeout() -> float | None:
    raw = (
        os.environ.get("HYPERCLI_GATEWAY_TIMEOUT") or os.environ.get("AGENT_GATEWAY_TIMEOUT") or ""
    ).strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _default_gateway_chat_timeout() -> float | None:
    raw = (
        os.environ.get("HYPERCLI_GATEWAY_CHAT_TIMEOUT")
        or os.environ.get("AGENT_GATEWAY_CHAT_TIMEOUT")
        or ""
    ).strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _to_ws_base_url(base_url: str) -> str:
    base = (base_url or "").rstrip("/")
    if not base:
        return ""
    if base.startswith("https://"):
        return f"wss://{base[len('https://') :]}"
    if base.startswith("http://"):
        return f"ws://{base[len('http://') :]}"
    return base


def _normalize_agents_ws_url(url: str) -> str:
    base = _to_ws_base_url(url)
    if not base:
        return ""
    return base if base.endswith("/ws") else f"{base}/ws"


def _normalize_slack_relay_base_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("relay_base_url is required")
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("relay_base_url must use http or https")
    host = parsed.netloc.lower()
    netloc = parsed.netloc
    if host == "api.agents.hypercli.com":
        netloc = "api.hypercli.com"
    elif host == "api.agents.dev.hypercli.com":
        netloc = "api.dev.hypercli.com"
    return urlunsplit((parsed.scheme or "https", netloc, "", "", "")).rstrip("/")


def _normalize_agents_api_base(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return AGENTS_API_BASE
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    scheme = parsed.scheme or "https"
    normalized_path = parsed.path.rstrip("/")
    host = parsed.netloc.lower()
    if normalized_path.endswith("/agents"):
        return f"{scheme}://{parsed.netloc}{normalized_path}"
    if normalized_path.endswith("/api"):
        if host == "api.agents.hypercli.com":
            return AGENTS_API_BASE
        if host == "api.agents.dev.hypercli.com":
            return DEV_AGENTS_API_BASE
        return f"{scheme}://{parsed.netloc}{normalized_path[:-4]}/agents"
    if host in {"api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app"}:
        return AGENTS_API_BASE
    if host in {
        "api.agents.dev.hypercli.com",
        "api.dev.hypercli.com",
        "api.dev.hyperclaw.app",
        "dev-api.hyperclaw.app",
    }:
        return DEV_AGENTS_API_BASE
    normalized = raw.rstrip("/")
    return f"{normalized}/agents"


def _default_agents_ws_url(api_base: str) -> str:
    raw = _normalize_agents_api_base(api_base)
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower()
    if host in {"api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app"}:
        return AGENTS_WS_URL
    if host in {
        "api.agents.dev.hypercli.com",
        "api.dev.hypercli.com",
        "api.dev.hyperclaw.app",
        "dev-api.hyperclaw.app",
    }:
        return DEV_AGENTS_WS_URL
    return _normalize_agents_ws_url(raw)


MAX_SYNC_OWNER_ID = 4_294_967_294
REQUIRED_START_LAUNCH_CONFIG_KEYS = frozenset(
    {
        "config",
        "image",
        "env",
        "secrets",
        "routes",
        "command",
        "entrypoint",
        "restart",
        "sync_root",
        "sync_uid",
        "sync_gid",
        "registry_url",
        "registry_auth",
        "runtime_scopes",
    }
)


def _copy_complete_launch_config(value: dict) -> dict:
    if not isinstance(value, dict):
        raise TypeError("launch_config must be a complete object")
    missing = sorted(REQUIRED_START_LAUNCH_CONFIG_KEYS - value.keys())
    if missing:
        raise ValueError("launch_config is incomplete; missing: " + ", ".join(missing))
    if {"sync_include", "sync_exclude"}.issubset(value):
        raise ValueError("launch_config cannot carry both sync policies")
    if value.get("sync_include") == []:
        raise ValueError("sync_include must contain at least one path; omit it to sync all")
    if value.get("sync_exclude") is not None and {"*", "**"} & set(
        value.get("sync_exclude") or []
    ):
        raise ValueError("sync_exclude cannot exclude the entire sync root; omit it to sync all")
    if type(value["restart"]) is not bool:
        raise ValueError("launch_config restart must be a boolean")
    return copy.deepcopy(value)


def _normalize_sync_owner(value: int | None, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= MAX_SYNC_OWNER_ID:
        raise ValueError(f"{field} must be an integer between 0 and {MAX_SYNC_OWNER_ID}")
    return value


def _build_agent_launch(
    config: dict | None = None,
    *,
    env: dict | None = None,
    secrets: dict | None = None,
    routes: dict | None = None,
    command: list[str] | None = None,
    entrypoint: list[str] | None = None,
    image: str | None = None,
    sync_root: str | None = None,
    sync_include: list[str] | None | object = _UNSET,
    sync_exclude: list[str] | None | object = _UNSET,
    sync_uid: int | None = None,
    sync_gid: int | None = None,
    registry_url: str | None = None,
    registry_auth: dict | None = None,
    restart: bool = False,
    runtime_scopes: list[str] | None = None,
    _complete: bool = False,
) -> dict:
    prepared_config = copy.deepcopy(config or {})
    nested_launch_keys = sorted(LAUNCH_CONFIG_KEYS.intersection(prepared_config.keys()))
    if nested_launch_keys:
        raise ValueError(
            "Launch settings must be top-level fields, not nested under config: "
            + ", ".join(nested_launch_keys)
        )
    env_map = dict(env or {})
    secret_map = dict(secrets) if secrets is not None else None

    collisions = sorted(set(env_map).intersection(secret_map or {}))
    if collisions:
        raise ValueError(
            "Launch keys cannot appear in both env and secrets: " + ", ".join(collisions)
        )

    complete_launch: dict[str, Any] = {
        "config": prepared_config,
        "image": image,
        "env": env_map,
        "secrets": secret_map or {},
        "routes": copy.deepcopy(routes or {}),
        "command": list(command or []),
        "entrypoint": list(entrypoint or []),
        "restart": restart,
        "sync_root": sync_root,
        "sync_uid": _normalize_sync_owner(sync_uid, "sync_uid"),
        "sync_gid": _normalize_sync_owner(sync_gid, "sync_gid"),
        "registry_url": registry_url,
        "registry_auth": copy.deepcopy(registry_auth or {}),
        "runtime_scopes": list(
            DEFAULT_AGENT_RUNTIME_SCOPES if runtime_scopes is None else runtime_scopes
        ),
    }
    if sync_include is not _UNSET:
        if sync_include == []:
            raise ValueError("sync_include must contain at least one path; omit it to sync all")
        complete_launch["sync_include"] = None if sync_include is None else list(sync_include)
    if sync_include is _UNSET and sync_exclude is not _UNSET:
        if sync_exclude is not None and {"*", "**"} & set(sync_exclude):
            raise ValueError("sync_exclude cannot exclude the entire sync root; omit it to sync all")
        complete_launch["sync_exclude"] = None if sync_exclude is None else list(sync_exclude)
    if _complete:
        return complete_launch

    launch: dict[str, Any] = {}
    if prepared_config:
        launch["config"] = prepared_config
    if env_map:
        launch["env"] = env_map
    if secret_map:
        launch["secrets"] = secret_map
    for key, value, provided in (
        ("routes", routes, routes is not None),
        ("command", command, command is not None),
        ("entrypoint", entrypoint, entrypoint is not None),
        ("image", image, image is not None),
        ("sync_root", sync_root, sync_root is not None),
        ("sync_uid", complete_launch["sync_uid"], sync_uid is not None),
        ("sync_gid", complete_launch["sync_gid"], sync_gid is not None),
        ("registry_url", registry_url, registry_url is not None),
        ("registry_auth", registry_auth, registry_auth is not None),
        ("restart", restart, restart is not None),
        ("runtime_scopes", complete_launch["runtime_scopes"], runtime_scopes is not None),
    ):
        if provided:
            launch[key] = copy.deepcopy(value)
    if "sync_include" in complete_launch:
        launch["sync_include"] = complete_launch["sync_include"]
    elif "sync_exclude" in complete_launch:
        launch["sync_exclude"] = complete_launch["sync_exclude"]
    return launch


def build_agent_config(
    config: dict | None = None,
    *,
    env: dict | None = None,
    secrets: dict | None = None,
    routes: dict | None = None,
    command: list[str] | None = None,
    entrypoint: list[str] | None = None,
    image: str | None = None,
    sync_root: str | None = None,
    sync_include: list[str] | None | object = _UNSET,
    sync_exclude: list[str] | None | object = _UNSET,
    sync_uid: int | None = None,
    sync_gid: int | None = None,
    registry_url: str | None = None,
    registry_auth: dict | None = None,
    restart: bool = False,
    runtime_scopes: list[str] | None = None,
) -> dict:
    """Build an agent launch config payload (mirrors ts-sdk buildAgentConfig).

    A nonblank ``sync_root`` enables retained storage. In a create payload,
    leaving both policy arguments unset (or explicitly clearing one with
    ``None``) selects the whole root; ``sync_exclude=[]`` also excludes
    nothing, while ``sync_include=[]`` is invalid.
    Includes win when both modes are supplied. Paths are relative to
    ``sync_root``. START callers must send the resulting complete object;
    omitted fields are never inherited from the prior Agent snapshot.

    Reef steadily uploads allowed PVC changes without propagating ordinary
    filesystem deletions. Remote data is copied back only by explicit cold
    restore; public file operations mint a short-lived credential and call the
    retained Reef server directly.
    """
    return _build_agent_launch(
        config,
        env=env,
        secrets=secrets,
        routes=routes,
        command=command,
        entrypoint=entrypoint,
        image=image,
        sync_root=sync_root,
        sync_include=sync_include,
        sync_exclude=sync_exclude,
        sync_uid=sync_uid,
        sync_gid=sync_gid,
        registry_url=registry_url,
        registry_auth=registry_auth,
        restart=restart,
        runtime_scopes=runtime_scopes,
        _complete=True,
    )


def _default_openclaw_image(image: str | None) -> str | None:
    if image is not None:
        return image
    return DEFAULT_OPENCLAW_IMAGE


def _resolve_coding_agent_sync_policy(
    runtime: CodingAgentRuntime,
    *,
    sync_include: list[str] | None | object,
    sync_exclude: list[str] | None | object,
) -> tuple[list[str] | object, list[str] | object]:
    if sync_include is not _UNSET and sync_include is not None:
        return list(sync_include), _UNSET
    if sync_exclude is not _UNSET:
        if sync_exclude is None:
            return _UNSET, _UNSET
        return _UNSET, list(sync_exclude)
    if sync_include is None:
        return _UNSET, _UNSET
    default_include = _CODING_AGENT_CLASSES[runtime].default_sync_include
    if default_include:
        return list(default_include), _UNSET
    return _UNSET, []


def _resolve_openclaw_sync_policy(
    *,
    sync_include: list[str] | None | object,
    sync_exclude: list[str] | None | object,
) -> tuple[list[str] | None | object, list[str] | None | object]:
    if sync_include is not _UNSET:
        return (None if sync_include is None else list(sync_include)), _UNSET
    if sync_exclude is not _UNSET:
        return _UNSET, (None if sync_exclude is None else list(sync_exclude))
    return _UNSET, list(DEFAULT_OPENCLAW_SYNC_EXCLUDE)


def _default_openclaw_pro_image(image: str | None) -> str | None:
    if image is not None:
        return image
    return DEFAULT_OPENCLAW_PRO_IMAGE


def _truthy_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _flatten_config_value(value: object, prefix: str, out: dict[str, Any]) -> None:
    if not prefix:
        if isinstance(value, dict):
            for key, child in value.items():
                _flatten_config_value(child, str(key), out)
            return
        out[""] = value
        return

    out[prefix] = value
    if isinstance(value, list):
        for index, child in enumerate(value):
            _flatten_config_value(child, f"{prefix}[{index}]", out)
        return
    if isinstance(value, dict):
        for key, child in value.items():
            _flatten_config_value(child, f"{prefix}.{key}", out)


def flatten_launch_config(launch_config: object) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    if not isinstance(launch_config, dict):
        return flat
    _flatten_config_value(launch_config, "", flat)
    return flat


def _path_parts(path: str | list[str | int] | tuple[str | int, ...]) -> list[str | int]:
    if isinstance(path, (list, tuple)):
        return list(path)
    normalized = re.sub(r"\[(\d+)\]", r".\1", path)
    parts: list[str | int] = []
    for part in normalized.split("."):
        if not part:
            continue
        parts.append(int(part) if part.isdigit() else part)
    return parts


def get_launch_config_value(
    launch_config: object, path: str | list[str | int] | tuple[str | int, ...]
) -> Any:
    current: Any = launch_config
    for part in _path_parts(path):
        if isinstance(part, int):
            if not isinstance(current, list) or part >= len(current):
                return None
            current = current[part]
            continue
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def routes_have_desktop(routes: object) -> bool:
    if not isinstance(routes, dict):
        return False
    if isinstance(routes.get("desktop"), dict):
        return True
    return any(
        isinstance(route, dict) and route.get("prefix") == "desktop" for route in routes.values()
    )


def launch_config_has_desktop(launch_config: object) -> bool:
    if not isinstance(launch_config, dict):
        return False
    if _truthy_env(get_launch_config_value(launch_config, "env.OPENCLAW_DESKTOP_ENABLED")):
        return True
    return routes_have_desktop(get_launch_config_value(launch_config, "routes"))


def agent_config_has_desktop(source: object) -> bool:
    if not isinstance(source, dict):
        return False
    return launch_config_has_desktop(
        source.get("launch_config") or source.get("launchConfig")
    ) or routes_have_desktop(source.get("routes"))


def _browser_desktop_redirect_path(
    redirect: str | None = None,
    *,
    resize: str | None = "scale",
) -> str:
    target = (redirect or "vnc.html").strip() or "vnc.html"
    if "\\" in target:
        raise ValueError("Desktop redirect must be a relative path")

    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        raise ValueError("Desktop redirect must be a relative path")

    path = (parsed.path or "vnc.html").lstrip("/") or "vnc.html"
    query_items = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != "resize"
    ]
    if resize is not None and resize.strip():
        query_items.append(("resize", resize))
    query = urlencode(query_items)
    return urlunsplit(("", "", path, query, parsed.fragment))


def build_browser_desktop_url(
    desktop_base_url: str,
    token: str,
    *,
    redirect: str | None = None,
    resize: str | None = "scale",
) -> str:
    jwt = token.strip()
    if not jwt:
        raise ValueError("Desktop token is required")

    query = urlencode(
        {
            "jwt": jwt,
            "redirect": _browser_desktop_redirect_path(redirect, resize=resize),
        }
    )
    return f"{desktop_base_url.rstrip('/')}/_jwt_auth?{query}"


def _parse_dt(val):
    if isinstance(val, str) and val:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    return None


def _deep_merge_config(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_config(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def _agent_kwargs_from_dict(data: dict) -> dict[str, Any]:
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    launch_config = (
        copy.deepcopy(data["launch_config"])
        if isinstance(data.get("launch_config"), dict)
        else None
    )
    if launch_config is not None:
        launch_config.pop("secrets", None)
    is_launchable = data.get("is_launchable")
    if is_launchable is None:
        is_launchable = data.get("managed", True) is not False
    return {
        "id": data.get("id", ""),
        "user_id": data.get("user_id", ""),
        "state": data.get("state", "unknown"),
        "name": data.get("name"),
        "handle": data.get("handle"),
        "display_name": data.get("display_name") or data.get("name"),
        "avatar_url": data.get("avatar_url"),
        "display_identity": copy.deepcopy(data.get("display_identity"))
        if isinstance(data.get("display_identity"), dict)
        else None,
        "runtime": data.get("runtime"),
        "managed": data.get("managed"),
        "is_launchable": bool(is_launchable),
        "gateway_id": data.get("gateway_id"),
        "runtime_key_alias": data.get("runtime_key_alias"),
        "relay_key": data.get("relay_key") if isinstance(data.get("relay_key"), dict) else None,
        "cpu": data.get("cpu", 0),
        "memory": data.get("memory", 0),
        "requested_size": (
            _parse_agent_size(data.get("requested_size"), field_name="Agent requested_size")
            if data.get("requested_size") is not None
            else None
        ),
        "hostname": data.get("hostname"),
        "tags": list(data.get("tags") or []),
        "jwt_token": data.get("jwt_token"),
        "jwt_expires_at": _parse_dt(data.get("jwt_expires_at")),
        "started_at": _parse_dt(data.get("started_at")),
        "stopped_at": _parse_dt(data.get("stopped_at")),
        "archived_at": _parse_dt(data.get("archived_at")),
        # Independently nullable from archived_at: SPEC has a new Agent with
        # neither, an ARCHIVED Agent with both, and a restored Agent with a
        # path but no archived_at. Dropping it made that tri-state unreadable.
        "archive_path": data.get("archive_path"),
        "deleted_at": _parse_dt(data.get("deleted_at")),
        "disconnected_at": _parse_dt(data.get("disconnected_at")),
        "agent_slot_id": data.get("agent_slot_id"),
        "cluster_id": data.get("cluster_id"),
        "launch_epoch": int(data.get("launch_epoch", 0) or 0),
        "created_at": _parse_dt(data.get("created_at")),
        "updated_at": _parse_dt(data.get("updated_at")),
        "launch_config": launch_config,
        "meta": copy.deepcopy(meta) if meta else None,
        "meta_ui": copy.deepcopy(meta.get("ui")) if isinstance(meta.get("ui"), dict) else None,
        "routes": data.get("routes") or (launch_config or {}).get("routes") or {},
        "command": data.get("command") or (launch_config or {}).get("command") or [],
        "entrypoint": data.get("entrypoint") or (launch_config or {}).get("entrypoint") or [],
        "dry_run": bool(data.get("dry_run")),
    }


def _is_openclaw_agent_data(data: dict) -> bool:
    routes = data.get("routes")
    if isinstance(routes, dict) and routes.get("openclaw"):
        return True
    launch_config = data.get("launch_config")
    if isinstance(launch_config, dict):
        launch_routes = launch_config.get("routes")
        if isinstance(launch_routes, dict) and launch_routes.get("openclaw"):
            return True
    return False


def _is_hermes_agent_data(data: dict) -> bool:
    routes = data.get("routes")
    if isinstance(routes, dict) and routes.get("hermes"):
        return True
    launch_config = data.get("launch_config")
    if isinstance(launch_config, dict):
        launch_routes = launch_config.get("routes")
        if isinstance(launch_routes, dict) and launch_routes.get("hermes"):
            return True
    return False


def _is_direct_agent_id_ref(value: str) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    try:
        UUID(raw)
        return True
    except ValueError:
        pass
    return bool(
        re.fullmatch(r"[0-9a-fA-F]{6,}", raw) or re.match(r"^(agent|external)[-_:]", raw, re.I)
    )


def _is_self_agent_ref(value: str) -> bool:
    """Return whether *value* is the reserved authenticated-agent selector."""
    return str(value or "").strip().lower() == "self"


def _is_openclaw_pro_agent_data(data: dict) -> bool:
    launch_config = data.get("launch_config")
    if not isinstance(launch_config, dict):
        return False
    if launch_config_has_desktop(launch_config):
        return True
    image = str(launch_config.get("image") or "")
    return "hypercli-openclaw:pro" in image or image.endswith("-pro")


_ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
_AUTH_URL_RE = re.compile(r"https?://[^\s<>\"']+(?=[\s<>\"'])")
_AUTH_CODE_RE = re.compile(
    r"(?i)\b(?:user|device|verification|one[- ]time)\s+code\b"
    r"\s*(?:is|:)?\s*(?:\([^\r\n)]*\)\s*)*"
    r"((?!authorization\b)[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)"
    r"(?=[\s.,;:)\]])"
)


def _clean_terminal_output(value: str) -> str:
    return _ANSI_ESCAPE_RE.sub("", str(value or "")).replace("\r", "")


@dataclass(frozen=True)
class RuntimeAuthMethod:
    """Authentication method advertised by a hosted coding runtime."""

    id: str
    name: str
    description: str = ""
    kind: str = "native"
    command: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeAuthStatus:
    """Normalized authentication status for a hosted coding runtime."""

    authenticated: bool
    provider: str | None = None
    account: str | None = None
    method: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)


class RuntimeLoginSession:
    """Live, JWT-authenticated PTY session for browser/device login."""

    def __init__(
        self,
        auth: "RuntimeAuthClient",
        websocket: Any,
        command: tuple[str, ...],
        *,
        requires_device_challenge: bool = False,
    ):
        self._auth = auth
        self._websocket = websocket
        self._requires_device_challenge = requires_device_challenge
        self.command = command
        self.verification_url: str | None = None
        self.user_code: str | None = None
        self.instructions: str = ""
        self.interactive_required = False
        self._raw_output = ""
        self.output = ""
        self.exit_code: int | None = None
        self._ready = asyncio.Event()
        self._completed = asyncio.Event()
        self._marker = f"__HYPERCLI_AUTH_EXIT_{secrets.token_hex(8)}__"
        self._reader_task: asyncio.Task | None = None

    @classmethod
    async def start(
        cls,
        auth: "RuntimeAuthClient",
        command: tuple[str, ...],
        *,
        challenge_timeout: float = 45.0,
        requires_device_challenge: bool = False,
    ) -> "RuntimeLoginSession":
        websocket = await auth.agent.shell_connect()
        session = cls(
            auth,
            websocket,
            command,
            requires_device_challenge=requires_device_challenge,
        )
        session._reader_task = asyncio.create_task(session._read_loop())
        shell_command = shlex.join(command)
        wrapped = (
            f"{shell_command}; _hypercli_auth_rc=$?; "
            f"printf '\\n{session._marker}=%s\\n' \"$_hypercli_auth_rc\"\n"
        )
        await websocket.send(wrapped)
        try:
            await asyncio.wait_for(session._ready.wait(), timeout=challenge_timeout)
        except asyncio.TimeoutError:
            await session.cancel()
            raise TimeoutError(f"Timed out waiting for {auth.runtime} login instructions") from None
        return session

    def _consume(self, value: str) -> None:
        self._raw_output += str(value)
        self.output = _clean_terminal_output(self._raw_output)
        marker_match = re.search(re.escape(self._marker) + r"=(\d+)", self.output)
        if marker_match:
            self.exit_code = int(marker_match.group(1))
            self._completed.set()
            self._ready.set()
        if self.verification_url is None:
            urls = _AUTH_URL_RE.findall(self.output)
            if urls:
                self.verification_url = urls[0].rstrip(".,);]")
        if self.user_code is None:
            code_match = _AUTH_CODE_RE.search(self.output)
            if code_match:
                self.user_code = code_match.group(1)
        lowered = self.output.lower()
        if any(token in lowered for token in ("select", "choose", "provider", "login method")):
            self.interactive_required = True
        challenge_ready = bool(self.verification_url and self.user_code)
        if not self._requires_device_challenge:
            challenge_ready = bool(self.verification_url or self.user_code)
        if challenge_ready or self.interactive_required:
            self.instructions = self.output.replace(self._marker, "").strip()
            self._ready.set()

    async def _read_loop(self) -> None:
        try:
            async for message in self._websocket:
                self._consume(str(message))
                if self._completed.is_set():
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.output += f"\n[login stream closed: {exc}]"
        finally:
            self._completed.set()
            self._ready.set()

    async def send(self, text: str) -> None:
        await self._websocket.send(text if text.endswith("\n") else f"{text}\n")

    async def wait(self, timeout: float = 600.0) -> RuntimeAuthStatus:
        try:
            await asyncio.wait_for(self._completed.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            await self.cancel()
            raise TimeoutError(f"Timed out waiting for {self._auth.runtime} login") from None
        if self.exit_code not in {None, 0}:
            raise RuntimeError(f"{self._auth.runtime} login exited with status {self.exit_code}")
        return await asyncio.to_thread(self._auth.status)

    async def cancel(self) -> None:
        try:
            await self._websocket.send("\x03")
        except Exception:
            pass
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
        try:
            await self._websocket.close()
        except Exception:
            pass
        self._completed.set()
        self._ready.set()

    async def __aenter__(self) -> "RuntimeLoginSession":
        return self

    async def __aexit__(self, _exc_type, _exc, _tb) -> None:
        await self.cancel()


class RuntimeAuthClient:
    """Runtime-specific authentication over the existing protected exec/shell API."""

    _COMMANDS: dict[str, dict[str, Any]] = {
        "buzz-agent": {
            "agent": ("buzz-agent",),
            "status": (
                "buzz-acp",
                "models",
                "--agent-command",
                "buzz-agent",
                "--json",
            ),
            "logout": None,
        },
        "opencode": {
            "agent": ("opencode", "acp"),
            "status": (
                "buzz-acp",
                "models",
                "--agent-command",
                "opencode",
                "--agent-args",
                "acp",
                "--json",
            ),
            "logout": ("opencode", "auth", "logout"),
        },
        "codex": {
            "agent": ("codex-acp",),
            "status": ("codex", "login", "status"),
            "logout": ("codex", "logout"),
            "native_methods": (
                RuntimeAuthMethod(
                    id="device",
                    name="ChatGPT device login",
                    description="Open a verification URL and enter the displayed device code.",
                    kind="device",
                    command=("codex", "login", "--device-auth"),
                ),
            ),
        },
        "claude-code": {
            "agent": ("claude-agent-acp",),
            "status": ("claude", "auth", "status", "--json"),
            "logout": ("claude", "auth", "logout"),
            "native_methods": (
                RuntimeAuthMethod(
                    id="claude-ai",
                    name="Claude subscription",
                    kind="browser",
                    command=("claude", "auth", "login", "--claudeai"),
                ),
                RuntimeAuthMethod(
                    id="console",
                    name="Anthropic Console",
                    kind="browser",
                    command=("claude", "auth", "login", "--console"),
                ),
                RuntimeAuthMethod(
                    id="sso",
                    name="Claude SSO",
                    kind="browser",
                    command=("claude", "auth", "login", "--sso"),
                ),
            ),
        },
        "goose": {
            "agent": ("goose", "acp"),
            "status": (
                "buzz-acp",
                "models",
                "--agent-command",
                "goose",
                "--agent-args",
                "acp",
                "--json",
            ),
            "logout": None,
        },
        "kimi-code": {
            "agent": ("kimi", "acp"),
            "status": (
                "buzz-acp",
                "models",
                "--agent-command",
                "kimi",
                "--agent-args",
                "acp",
                "--json",
            ),
            "logout": None,
        },
    }

    def __init__(self, agent: "CodingAgent"):
        self.agent = agent
        self.runtime = str(agent.runtime or "")
        if self.runtime not in self._COMMANDS:
            raise ValueError(f"Unsupported coding-agent runtime: {self.runtime}")

    @property
    def _config(self) -> dict[str, Any]:
        return self._COMMANDS[self.runtime]

    def _exec(self, command: tuple[str, ...], *, timeout: int = 30) -> "ExecResult":
        return self.agent.exec(list(command), timeout=timeout)

    def methods(self) -> list[RuntimeAuthMethod]:
        agent_command = tuple(self._config["agent"])
        argv = ["buzz-acp", "auth-methods", "--agent-command", agent_command[0]]
        if len(agent_command) > 1:
            argv.extend(["--agent-args", ",".join(agent_command[1:])])
        argv.append("--json")
        discovered: list[RuntimeAuthMethod] = []
        result = self._exec(tuple(argv))
        if result.exit_code == 0:
            try:
                payload = json.loads(result.stdout or "{}")
            except json.JSONDecodeError:
                payload = {}
            for item in payload.get("methods", []):
                if not isinstance(item, dict):
                    continue
                raw_metadata = item.get("_meta")
                metadata = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
                terminal = metadata.get("terminal-auth")
                command: tuple[str, ...] = ()
                if isinstance(terminal, dict) and terminal.get("command"):
                    raw_command = terminal["command"]
                    if isinstance(raw_command, list):
                        command = tuple(str(value) for value in raw_command)
                    else:
                        command = (
                            str(raw_command),
                            *(str(value) for value in (terminal.get("args") or [])),
                        )
                    if item.get("id") == "claude-login":
                        command = (*command, "auth", "login")
                elif item.get("command"):
                    raw_command = item["command"]
                    if isinstance(raw_command, list):
                        command = tuple(str(value) for value in raw_command)
                    else:
                        command = (
                            str(raw_command),
                            *(str(value) for value in (item.get("args") or [])),
                        )
                discovered.append(
                    RuntimeAuthMethod(
                        id=str(item.get("id") or ""),
                        name=str(item.get("name") or item.get("id") or ""),
                        description=str(item.get("description") or ""),
                        kind=str(item.get("type") or ("terminal" if command else "acp")),
                        command=command,
                        metadata=metadata,
                    )
                )
        by_id = {method.id: method for method in discovered if method.id}
        for method in self._config.get("native_methods", ()):
            by_id.setdefault(method.id, method)
        if self.runtime == "opencode":
            by_id.setdefault(
                "provider",
                RuntimeAuthMethod(
                    id="provider",
                    name="Provider login",
                    description="Choose an OpenCode provider and login method interactively.",
                    kind="interactive",
                    command=("opencode", "auth", "login"),
                ),
            )
        return list(by_id.values())

    def status(self) -> RuntimeAuthStatus:
        result = self._exec(tuple(self._config["status"]))
        raw = _clean_terminal_output((result.stdout or "") + (result.stderr or "")).strip()
        detail: dict[str, Any] = {"exit_code": result.exit_code, "output": raw}
        if self.runtime == "claude-code":
            try:
                parsed = json.loads(result.stdout or "{}")
            except json.JSONDecodeError:
                parsed = {}
            if isinstance(parsed, dict):
                detail.update(parsed)
                auth_method = parsed.get("loginMethod") or parsed.get("authMethod")
                authenticated = bool(
                    parsed.get("loggedIn")
                    or parsed.get("authenticated")
                    or (auth_method and str(auth_method).lower() != "none")
                )
                return RuntimeAuthStatus(
                    authenticated=authenticated,
                    provider=(
                        parsed.get("subscriptionType")
                        or parsed.get("provider")
                        or parsed.get("apiProvider")
                    ),
                    account=parsed.get("email"),
                    method=auth_method,
                    detail=detail,
                )
        lowered = raw.lower()
        authenticated = result.exit_code == 0 and not any(
            token in lowered
            for token in (
                "not logged",
                "not authenticated",
                "unauthenticated",
                "no credentials",
                "0 credentials",
            )
        )
        return RuntimeAuthStatus(authenticated=authenticated, detail=detail)

    async def login(
        self,
        method: str | None = None,
        *,
        provider: str | None = None,
        provider_method: str | None = None,
        email: str | None = None,
        challenge_timeout: float = 45.0,
    ) -> RuntimeLoginSession:
        methods = self.methods()
        selected = next((candidate for candidate in methods if candidate.id == method), None)
        if selected is None:
            if method is not None:
                raise ValueError(f"Unsupported {self.runtime} auth method: {method}")
            selected = next((candidate for candidate in methods if candidate.command), None)
            if selected is None:
                selected = next(iter(methods), None)
        if selected is None:
            raise ValueError(f"{self.runtime} did not advertise a runnable login method")
        if selected.command:
            command = list(selected.command)
        else:
            agent_command = tuple(self._config["agent"])
            command = [
                "buzz-acp",
                "authenticate",
                "--agent-command",
                agent_command[0],
            ]
            if len(agent_command) > 1:
                command.extend(["--agent-args", ",".join(agent_command[1:])])
            command.extend(["--method-id", selected.id])
        if self.runtime == "opencode":
            if provider:
                command.extend(["--provider", provider])
            if provider_method:
                command.extend(["--method", provider_method])
        elif self.runtime == "claude-code" and email:
            command.extend(["--email", email])
        return await RuntimeLoginSession.start(
            self,
            tuple(command),
            challenge_timeout=challenge_timeout,
            requires_device_challenge=(
                selected.kind == "device"
                or selected.id == "device"
                or any("device-auth" in part.lower() for part in command)
            ),
        )

    def logout(self, provider: str | None = None) -> RuntimeAuthStatus:
        logout_command = self._config["logout"]
        if logout_command is None:
            if self.runtime == "goose":
                reason = "uses its injected deployment credential"
            else:
                reason = "does not expose a noninteractive logout command"
            raise RuntimeError(f"{self.runtime} {reason} and cannot log out")
        command = list(logout_command)
        if self.runtime == "opencode" and provider:
            command.append(provider)
        result = self._exec(tuple(command))
        if result.exit_code != 0:
            raise RuntimeError(
                f"{self.runtime} logout failed: "
                f"{_clean_terminal_output(result.stderr or result.stdout).strip()}"
            )
        return self.status()


class AgentRouteConfig(TypedDict):
    """Reusable desired configuration for one HTTPS route."""

    port: int
    auth: NotRequired[bool]
    prefix: NotRequired[str]


@dataclass(frozen=True)
class AgentRoutes:
    """Declarative routes and their live status for one agent."""

    agent_id: str
    routes: dict[str, AgentRouteConfig] = field(default_factory=dict)
    route_statuses: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "AgentRoutes":
        return cls(
            agent_id=str(data.get("agent_id") or ""),
            routes={str(name): dict(config) for name, config in (data.get("routes") or {}).items()},
            route_statuses={
                str(name): dict(status)
                for name, status in (data.get("route_statuses") or {}).items()
            },
        )


@dataclass(frozen=True)
class AgentAccessIdentity:
    """What the presented credential is, as the Backend resolves it.

    ``agent_id`` is set only for an Agent runtime key, which speaks for exactly
    one Agent; it is ``None`` for an owner user credential or any other key.
    """

    user_id: str
    auth_type: str
    agent_id: str | None = None
    tags: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    key_id: str | None = None
    key_name: str | None = None
    team_id: str | None = None
    plan_id: str | None = None

    @property
    def is_agent_runtime_key(self) -> bool:
        """True when this credential is one Agent's own runtime key."""
        return bool(self.agent_id)

    @classmethod
    def from_dict(cls, data: dict) -> "AgentAccessIdentity":
        payload = data or {}
        return cls(
            user_id=str(payload.get("user_id") or ""),
            auth_type=str(payload.get("auth_type") or ""),
            agent_id=str(payload["agent_id"]) if payload.get("agent_id") else None,
            tags=[str(tag) for tag in (payload.get("tags") or [])],
            capabilities=[str(item) for item in (payload.get("capabilities") or [])],
            key_id=str(payload["key_id"]) if payload.get("key_id") else None,
            key_name=str(payload["key_name"]) if payload.get("key_name") else None,
            team_id=str(payload["team_id"]) if payload.get("team_id") else None,
            plan_id=str(payload["plan_id"]) if payload.get("plan_id") else None,
        )


@dataclass(frozen=True)
class AgentSlotInventory:
    """Aggregate capacity for one agent size."""

    granted: int = 0
    used: int = 0
    available: int = 0

    @classmethod
    def from_dict(cls, data: dict | None) -> "AgentSlotInventory":
        payload = data or {}
        return cls(
            granted=int(payload.get("granted", 0) or 0),
            used=int(payload.get("used", payload.get("occupied", 0)) or 0),
            available=int(payload.get("available", 0) or 0),
        )


@dataclass(frozen=True)
class AgentSlot:
    """One concrete launch slot granted by a main plan entitlement."""

    id: str
    entitlement_id: str | None
    plan_id: str
    size: AgentSize
    agent_id: str | None
    occupied: bool
    expires_at: datetime | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "AgentSlot":
        agent_id = data.get("agent_id")
        return cls(
            id=str(data.get("id") or ""),
            entitlement_id=str(data["entitlement_id"]) if data.get("entitlement_id") else None,
            plan_id=str(data.get("plan_id") or ""),
            size=_parse_agent_size(data.get("size"), field_name="Agent slot size"),
            agent_id=str(agent_id) if agent_id else None,
            occupied=bool(data.get("occupied", agent_id is not None)),
            expires_at=_parse_dt(data.get("expires_at")),
        )


@dataclass(frozen=True)
class DeploymentEvent:
    """One user-facing deployment event received from Backend."""

    type: str
    agent_id: str
    state: str | None = None
    status: str | None = None
    namespace: str | None = None
    observed_state: str | None = None
    reason: str | None = None
    error: str | None = None
    message: str | None = None
    observed_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeploymentEvent":
        return cls(
            type=str(data.get("type") or ""),
            agent_id=str(data.get("agent_id") or ""),
            state=str(data["state"]) if data.get("state") else None,
            status=str(data["status"]) if data.get("status") else None,
            namespace=str(data["namespace"]) if data.get("namespace") else None,
            observed_state=(
                str(data["observed_state"]) if data.get("observed_state") else None
            ),
            reason=str(data["reason"]) if data.get("reason") else None,
            error=str(data["error"]) if data.get("error") else None,
            message=str(data["message"]) if data.get("message") else None,
            observed_at=str(data["observed_at"]) if data.get("observed_at") else None,
        )


@dataclass(frozen=True)
class AgentLaunchValueMutation:
    """Result of setting or deleting one persisted launch environment value."""

    agent_id: str
    key: str
    present: bool
    launch_epoch: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentLaunchValueMutation":
        return cls(
            agent_id=str(data.get("agent_id") or ""),
            key=str(data.get("key") or ""),
            present=bool(data.get("present", False)),
            launch_epoch=int(data.get("launch_epoch") or 0),
        )


@dataclass
class AgentCapacity:
    """Typed deployment-list envelope including stored and running capacity."""

    items: list["Agent"]
    total_agents: int
    max_agents_per_account: int
    running_agents: int
    slots: dict[str, AgentSlotInventory] = field(default_factory=dict)
    agent_slots: list[AgentSlot] = field(default_factory=list)
    pooled_tpd: int = 0

    @property
    def agents(self) -> list["Agent"]:
        """Readable alias for the wire-compatible ``items`` field."""
        return self.items


@dataclass
class Agent:
    """Generic agent returned by the HyperClaw backend."""

    id: str  # Agent UUID from backend
    user_id: str
    state: str
    name: Optional[str] = None
    handle: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    display_identity: Optional[dict] = None
    runtime: Optional[str] = None
    managed: Optional[bool] = None
    is_launchable: bool = True
    gateway_id: Optional[str] = None
    runtime_key_alias: Optional[str] = None
    relay_key: Optional[dict] = None
    cpu: int = 0  # cores
    memory: int = 0  # GB
    requested_size: AgentSize | None = None
    hostname: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    jwt_token: Optional[str] = None
    jwt_expires_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    archive_path: Optional[str] = None
    deleted_at: Optional[datetime] = None
    disconnected_at: Optional[datetime] = None
    agent_slot_id: Optional[str] = None
    cluster_id: Optional[str] = None
    launch_epoch: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    launch_config: Optional[dict] = None
    meta: Optional[dict] = None
    meta_ui: Optional[dict] = None
    routes: dict[str, dict] = field(default_factory=dict)
    command: list[str] = field(default_factory=list)
    entrypoint: list[str] = field(default_factory=list)
    dry_run: bool = False
    _deployments: Any = field(default=None, repr=False, compare=False)

    @classmethod
    def from_dict(cls, data: dict) -> "Agent":
        return cls(**_agent_kwargs_from_dict(data))

    @property
    def public_url(self) -> Optional[str]:
        if self.hostname:
            return f"https://{self.hostname}"
        return None

    def _route_prefix(self, route_name: str, default_prefix: str | None = None) -> str | None:
        route = self.routes.get(route_name) or {}
        prefix = route.get("prefix")
        if prefix is None:
            return default_prefix
        return str(prefix)

    def route_url(self, route_name: str, default_prefix: str | None = None) -> Optional[str]:
        if not self.hostname:
            return None
        prefix = self._route_prefix(route_name, default_prefix)
        if prefix is None:
            return None
        if prefix == "":
            return f"https://{self.hostname}"
        return f"https://{prefix}-{self.hostname}"

    @property
    def desktop_url(self) -> Optional[str]:
        return self.route_url("desktop", default_prefix="desktop")

    @property
    def vnc_url(self) -> Optional[str]:
        return self.desktop_url

    def browser_desktop_url(
        self,
        token: str,
        *,
        redirect: str | None = None,
        resize: str | None = "scale",
    ) -> Optional[str]:
        if not self.desktop_url:
            return None
        return build_browser_desktop_url(self.desktop_url, token, redirect=redirect, resize=resize)

    @property
    def shell_url(self) -> Optional[str]:
        return self.route_url("shell")

    @property
    def is_running(self) -> bool:
        return str(self.state or "").lower() == "running"

    @property
    def is_transitioning(self) -> bool:
        return is_agent_transitional_state(self.state)

    @property
    def is_archived(self) -> bool:
        """Whether this agent is cold-restorable from its verified archive."""

        return str(self.state or "").upper() == "ARCHIVED"

    @property
    def is_deleted(self) -> bool:
        """Whether an explicitly included tombstone reports deletion."""

        return str(self.state or "").upper() == "DELETED"

    @property
    def has_desktop(self) -> bool:
        return agent_config_has_desktop(
            {
                "launch_config": self.launch_config,
                "routes": self.routes,
            }
        )

    def _require_deployments(self) -> "Deployments":
        if self._deployments is None:
            raise ValueError("Agent is not bound to a Deployments client")
        return self._deployments

    def route_requires_auth(self, route_name: str, default: bool = True) -> bool:
        route = self.routes.get(route_name) or {}
        if "auth" not in route:
            return default
        return bool(route.get("auth", default))

    def refresh_token(self) -> dict:
        data = self._require_deployments().refresh_token(self.id)
        self.jwt_token = data.get("token") or data.get("jwt")
        self.jwt_expires_at = _parse_dt(data.get("expires_at"))
        return data

    def env(self) -> dict[str, str]:
        """Return the deployment's persisted non-secret environment."""
        data = self._require_deployments().env(self.id)
        if int(data.get("launch_epoch") or 0) < self.launch_epoch:
            raise RuntimeError("agent env belongs to an older launch epoch")
        return dict(data.get("env") or {})

    def set_env(self, key: str, value: str) -> AgentLaunchValueMutation:
        """Set one persisted non-secret launch environment value while stopped."""
        return self._require_deployments().set_env(self.id, key, value)

    def delete_env(self, key: str) -> AgentLaunchValueMutation:
        """Delete one persisted non-secret launch environment value while stopped."""
        return self._require_deployments().delete_env(self.id, key)

    def secret_names(self) -> list[str]:
        """Return names of deployment secrets without revealing their values."""
        data = self._require_deployments().secret_names(self.id)
        if int(data.get("launch_epoch") or 0) < self.launch_epoch:
            raise RuntimeError("agent secret names belong to an older launch epoch")
        return [str(name) for name in data.get("names") or []]

    def secret(self, key: str) -> str:
        """Reveal one deployment secret by exact key."""
        data = self._require_deployments().secret(self.id, key)
        if int(data.get("launch_epoch") or 0) < self.launch_epoch:
            raise RuntimeError("agent secret belongs to an older launch epoch")
        return str(data.get("value") or "")

    def set_secret(self, key: str, value: str) -> AgentLaunchValueMutation:
        """Set one persisted launch secret while stopped without echoing its value."""
        return self._require_deployments().set_secret(self.id, key, value)

    def delete_secret(self, key: str) -> AgentLaunchValueMutation:
        """Delete one persisted launch secret while stopped."""
        return self._require_deployments().delete_secret(self.id, key)

    def wait_running(self, timeout: float = 300.0, poll_interval: float = 5.0) -> "Agent":
        wait_kwargs: dict[str, int] = {}
        if self.launch_epoch > 0:
            wait_kwargs["minimum_launch_epoch"] = self.launch_epoch
        agent = self._require_deployments().wait_running(
            self.id,
            timeout=timeout,
            poll_interval=poll_interval,
            **wait_kwargs,
        )
        self.__dict__.update(agent.__dict__)
        self._deployments = agent._deployments
        return self

    def update(
        self,
        *,
        name: str | None = None,
        size: str | None = None,
        launch_config: dict | None = None,
        refresh_from_lagoon: bool | None = None,
        error: str | None = None,
        handle: str | None = None,
    ) -> "Agent":
        agent = self._require_deployments().update(
            self.id,
            name=name,
            size=size,
            launch_config=launch_config,
            refresh_from_lagoon=refresh_from_lagoon,
            error=error,
            handle=handle,
        )
        self.__dict__.update(agent.__dict__)
        self._deployments = agent._deployments
        return self

    def resize(self, *, size: str | None = None) -> "Agent":
        return self.update(size=size)

    def archive(self) -> "Agent":
        """Accept background archival and return its transitional snapshot."""
        agent = self._require_deployments().archive(self.id)
        self.__dict__.update(agent.__dict__)
        self._deployments = agent._deployments
        return self

    def exec(
        self, command: list[str], timeout: int = 30, dry_run: bool = False
    ) -> "ExecResult":
        return self._require_deployments().exec(self, command, timeout=timeout, dry_run=dry_run)

    @property
    def files(self) -> AgentFiles:
        """Reef-backed files scoped to this agent's configured sync root."""
        return AgentFiles(self, self._require_deployments())

    def files_list(self, path: str = "") -> list[dict]:
        return self.files.list(path)

    def file_read_bytes(self, path: str) -> bytes:
        return self.files.read_bytes(path)

    def file_read_bytes_with_metadata(self, path: str) -> dict[str, Any]:
        return self.files.read_bytes_with_metadata(path)

    def file_read(self, path: str) -> str:
        return self.files.read(path)

    def file_write_bytes(self, path: str, content: bytes) -> dict:
        return self.files.write_bytes(path, content)

    def file_write(self, path: str, content: str) -> dict:
        return self.files.write(path, content)

    def file_delete(self, path: str, recursive: bool = False) -> dict:
        return self.files.delete(path, recursive)

    def cp_to(self, local_path: str | Path, remote_path: str) -> dict:
        return self._require_deployments().cp_to(self, local_path, remote_path)

    def cp_from(self, remote_path: str, local_path: str | Path) -> Path:
        return self._require_deployments().cp_from(self, remote_path, local_path)

    async def logs_stream_ws(
        self,
        tail_lines: int = 100,
        container: str = "reef",
        follow: bool = True,
    ) -> AsyncIterator[str]:
        async for line in self._require_deployments().logs_stream_ws(
            self.id,
            tail_lines=tail_lines,
            container=container,
            follow=follow,
        ):
            yield line

    async def shell_connect(self, shell: str | None = None):
        return await self._require_deployments().shell_connect(self.id, shell=shell)


@dataclass
class CodingAgent(Agent):
    """Canonical hosted coding runtime with native authentication helpers."""

    default_sync_include: ClassVar[tuple[str, ...] | None] = None

    @property
    def auth(self) -> RuntimeAuthClient:
        return RuntimeAuthClient(self)


@dataclass
class BuzzAgent(CodingAgent):
    """Native Buzz ACP runtime with the bundled developer MCP tools."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["buzz-agent"]


@dataclass
class OpenCodeAgent(CodingAgent):
    """OpenCode runtime hosted behind Buzz ACP."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["opencode"]


@dataclass
class CodexAgent(CodingAgent):
    """Codex runtime hosted behind the Codex ACP adapter."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["codex"]


@dataclass
class ClaudeCodeAgent(CodingAgent):
    """Claude Code runtime hosted behind the Claude ACP adapter."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["claude-code"]


@dataclass
class GooseAgent(CodingAgent):
    """Goose native ACP runtime using the hosted Anthropic-compatible route."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["goose"]


@dataclass
class KimiCodeAgent(CodingAgent):
    """Kimi Code native ACP runtime using Moonshot's upstream authentication."""

    default_sync_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES["kimi-code"]


_CODING_AGENT_CLASSES: dict[CodingAgentRuntime, type[CodingAgent]] = {
    "buzz-agent": BuzzAgent,
    "opencode": OpenCodeAgent,
    "codex": CodexAgent,
    "claude-code": ClaudeCodeAgent,
    "goose": GooseAgent,
    "kimi-code": KimiCodeAgent,
}


@dataclass
class HermesAgent(Agent):
    """Hermes-backed agent with access to its stable API Server surface."""

    api_server_key: Optional[str] = field(default=None, repr=False, compare=False)

    @classmethod
    def from_dict(cls, data: dict) -> "HermesAgent":
        # API_SERVER_KEY is write-only launch material. It is retained only on
        # the instance returned by create/start, never hydrated from API data.
        kwargs = _agent_kwargs_from_dict(data)
        launch_config = kwargs.get("launch_config")
        if isinstance(launch_config, dict):
            launch_config = copy.deepcopy(launch_config)
            if isinstance(launch_config.get("env"), dict):
                launch_config["env"].pop("API_SERVER_KEY", None)
            kwargs["launch_config"] = launch_config
        return cls(**kwargs, api_server_key=None)

    @property
    def api_url(self) -> Optional[str]:
        return self.route_url("hermes", default_prefix="")

    @property
    def openai_base_url(self) -> Optional[str]:
        return f"{self.api_url.rstrip('/')}/v1" if self.api_url else None

    def api(self, **kwargs: Any) -> "HermesApiClient":
        """Create a client for this Hermes agent's API Server."""
        from .hermes import HermesApiClient

        if not self.api_url:
            raise ValueError("Agent has no Hermes API URL")
        if not self.api_server_key:
            raise ValueError(
                "Hermes API key is unavailable; use the HermesAgent returned by "
                "create_hermes_agent() or start_hermes_agent()"
            )
        return HermesApiClient(self.api_url, self.api_server_key, **kwargs)

    def wait_running(
        self,
        timeout: float = 300.0,
        poll_interval: float = 5.0,
    ) -> "HermesAgent":
        api_server_key = self.api_server_key
        super().wait_running(timeout=timeout, poll_interval=poll_interval)
        self.api_server_key = api_server_key
        return self

    def update(
        self,
        *,
        name: str | None = None,
        size: str | None = None,
        launch_config: dict | None = None,
        refresh_from_lagoon: bool | None = None,
        error: str | None = None,
        handle: str | None = None,
    ) -> "HermesAgent":
        api_server_key = self.api_server_key
        super().update(
            name=name,
            size=size,
            launch_config=launch_config,
            refresh_from_lagoon=refresh_from_lagoon,
            error=error,
            handle=handle,
        )
        self.api_server_key = api_server_key
        return self


@dataclass
class OpenClawAgent(Agent):
    """OpenClaw-backed agent with Gateway connection helpers."""

    gateway_url: Optional[str] = None
    gateway_token: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "OpenClawAgent":
        return cls(
            **_agent_kwargs_from_dict(data),
            gateway_url=None,
            gateway_token=None,
        )

    def wait_for_gateway_context(
        self, timeout: float = 30.0, retry_interval: float = 1.0
    ) -> dict[str, Any]:
        """Wait for RUNNING while retaining only caller-known gateway material."""
        if not self.gateway_token:
            raise ValueError(
                "OpenClaw gateway token is unavailable; retain the object returned "
                "by create_openclaw or pass gateway_token explicitly"
            )
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while True:
            try:
                deployments = self._require_deployments()
                current = deployments.get(self.id)
                if int(current.launch_epoch or 0) < int(self.launch_epoch or 0):
                    raise RuntimeError("agent snapshot belongs to an older launch epoch")
                if str(current.state or "").upper() != "RUNNING":
                    raise RuntimeError("agent gateway is not running")
                hostname = str(current.hostname or "").strip()
                confirmed = deployments.get(self.id)
                if (
                    int(confirmed.launch_epoch or 0) != int(current.launch_epoch or 0)
                    or str(confirmed.state or "").upper() != "RUNNING"
                ):
                    raise RuntimeError("gateway context changed while it was resolved")
                if hostname:
                    gateway_url = f"wss://{hostname}"
                    confirmed.gateway_url = gateway_url
                    confirmed.gateway_token = self.gateway_token
                    confirmed._deployments = deployments
                    self.__dict__.update(confirmed.__dict__)
                    self.gateway_url = gateway_url
                    return {
                        "agent_id": self.id,
                        "gateway_url": gateway_url,
                        "gateway_token": self.gateway_token,
                        "launch_epoch": self.launch_epoch,
                    }
                else:
                    last_error = RuntimeError("missing gateway context")
            except Exception as exc:
                last_error = exc
            if time.monotonic() >= deadline:
                if last_error is not None:
                    raise last_error
                raise RuntimeError("Timed out waiting for OpenClaw gateway context")
            time.sleep(retry_interval)

    def gateway(self, **kwargs) -> "GatewayClient":
        """Create a GatewayClient for this OpenClaw agent."""
        from .gateway import GatewayClient

        if "gateway_token" not in kwargs:
            if not self.gateway_token:
                raise ValueError("gateway_token is required on hydrated OpenClaw agents")
            kwargs["gateway_token"] = self.gateway_token
        if not self.gateway_url:
            self.wait_for_gateway_context()
        if not self.gateway_url:
            raise ValueError("Agent has no OpenClaw gateway URL")
        deployments = self._require_deployments()
        kwargs.setdefault("deployment_id", self.id)
        kwargs.setdefault("api_key", deployments._api_key)
        kwargs.setdefault("api_base", deployments._api_base)
        kwargs.setdefault("auto_approve_pairing", True)
        timeout = _default_gateway_timeout()
        if timeout is not None:
            kwargs.setdefault("timeout", timeout)
        chat_timeout = _default_gateway_chat_timeout()
        if chat_timeout is not None:
            kwargs.setdefault("chat_timeout", chat_timeout)
        return GatewayClient(url=self.gateway_url, token=None, **kwargs)

    @asynccontextmanager
    async def connect(self, **kwargs):
        """Open a temporary OpenClaw gateway session."""
        gw = self.gateway(**kwargs)
        async with gw:
            yield gw

    def _with_gateway(self, op: Callable[["GatewayClient"], Any]) -> Any:
        """Run an async gateway op from the sync file API (connect → op → close)."""

        async def _invoke() -> Any:
            async with self.connect() as gw:
                return await op(gw)

        return _run_sync(
            _invoke,
            running_loop_error=(
                "gateway file operations are synchronous and cannot run inside an "
                "active event loop; call them from sync code or use the async "
                "file_get/file_set/workspace_files helpers."
            ),
        )

    # The in-gateway agent id for `agents.files.*` — NOT the deployment id. A
    # deployment's gateway hosts an agent named "main" (or a named agent);
    # matches the existing file_get/file_set/workspace_files convention.
    async def gateway_status(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.status()

    async def wait_ready(
        self,
        timeout: float = 300.0,
        retry_interval: float = 5.0,
        probe: str = "config",
        **kwargs,
    ) -> dict:
        gw = self.gateway(**kwargs)
        try:
            return await gw.wait_ready(timeout=timeout, retry_interval=retry_interval, probe=probe)
        finally:
            await gw.close()

    async def config_get(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_get()

    async def config_schema(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_schema()

    async def config_patch(self, patch: dict, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_patch(patch)

    async def configure_slack_relay(
        self,
        *,
        url: str,
        gateway_id: str | None = None,
        auth_token_env: str = "HYPER_AGENTS_API_KEY",
        account_id: str | None = None,
        bot_token: Any | None = None,
        config: dict[str, Any] | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.configure_slack_relay(
                url=url,
                gateway_id=gateway_id or self.gateway_id or f"agent:{self.id}",
                auth_token_env=auth_token_env,
                account_id=account_id,
                bot_token=bot_token,
                config=config,
            )

    async def configure_slack_socket(
        self,
        *,
        bot_token: Any,
        app_token: Any,
        socket_mode: dict[str, Any] | None = None,
        account_id: str | None = None,
        config: dict[str, Any] | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.configure_slack_socket(
                bot_token=bot_token,
                app_token=app_token,
                socket_mode=socket_mode,
                account_id=account_id,
                config=config,
            )

    async def configure_whatsapp(
        self,
        config: dict[str, Any] | None = None,
        *,
        account_id: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.configure_whatsapp(config, account_id=account_id)

    async def config_apply(self, config: dict, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_apply(config)

    async def models_list(self, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.models_list()

    async def channels_status(
        self,
        *,
        probe: bool = False,
        timeout_ms: int | None = None,
        channel: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.channels_status(probe=probe, timeout_ms=timeout_ms, channel=channel)

    async def channels_start(
        self,
        channel: str,
        *,
        account_id: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.channels_start(channel, account_id=account_id)

    async def channels_stop(
        self,
        channel: str,
        *,
        account_id: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.channels_stop(channel, account_id=account_id)

    async def channels_logout(
        self,
        channel: str,
        *,
        account_id: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.channels_logout(channel, account_id=account_id)

    async def web_login_start(
        self,
        *,
        force: bool = False,
        timeout_ms: int | None = None,
        verbose: bool = False,
        account_id: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.web_login_start(
                force=force,
                timeout_ms=timeout_ms,
                verbose=verbose,
                account_id=account_id,
            )

    async def web_login_wait(
        self,
        *,
        timeout_ms: int | None = None,
        account_id: str | None = None,
        current_qr_data_url: str | None = None,
        **kwargs,
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.web_login_wait(
                timeout_ms=timeout_ms,
                account_id=account_id,
                current_qr_data_url=current_qr_data_url,
            )

    async def workspace_files(self, **kwargs) -> tuple[str, list[dict]]:
        async with self.connect(**kwargs) as gw:
            agents = await gw.agents_list()
            agent_id = agents[0]["id"] if agents else "main"
            files = await gw.files_list(agent_id)
            return agent_id, files

    async def file_get(self, name: str, agent_id: str | None = None, **kwargs) -> str:
        async with self.connect(**kwargs) as gw:
            resolved_agent_id = agent_id
            if resolved_agent_id is None:
                agents = await gw.agents_list()
                resolved_agent_id = agents[0]["id"] if agents else "main"
            return await gw.file_get(resolved_agent_id, name)

    async def file_set(
        self, name: str, content: str, agent_id: str | None = None, **kwargs
    ) -> dict:
        async with self.connect(**kwargs) as gw:
            resolved_agent_id = agent_id
            if resolved_agent_id is None:
                agents = await gw.agents_list()
                resolved_agent_id = agents[0]["id"] if agents else "main"
            return await gw.file_set(resolved_agent_id, name, content)

    async def sessions_list(self, limit: int = 20, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.sessions_list(limit=limit)

    async def cron_list(self, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.cron_list()

    async def cron_add(self, job: dict, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.cron_add(job)

    async def cron_remove(self, job_id: str, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.cron_remove(job_id)

    async def cron_run(self, job_id: str, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.cron_run(job_id)

    async def chat_history(
        self,
        session_key: str | None = None,
        limit: int = 50,
        **kwargs,
    ) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.chat_history(session_key=session_key, limit=limit)

    async def chat_send_message(
        self,
        message: str,
        *,
        session_key: str | None = None,
        agent_id: str | None = None,
        idempotency_key: str | None = None,
        timeout: float = 30,
        **kwargs,
    ) -> dict:
        params: dict[str, Any] = {"message": message}
        params["sessionKey"] = session_key or create_openclaw_sdk_session_key()
        if agent_id:
            params["agentId"] = agent_id
        if idempotency_key:
            params["idempotencyKey"] = idempotency_key
        async with self.connect(**kwargs) as gw:
            return await gw.call("chat.send", params, timeout=timeout)

    async def chat_send(
        self,
        message: str,
        *,
        session_key: str | None = None,
        agent_id: str | None = None,
        **kwargs,
    ) -> AsyncIterator["ChatEvent"]:
        async with self.connect(**kwargs) as gw:
            async for event in gw.chat_send(message, session_key=session_key, agent_id=agent_id):
                yield event

    async def _config_with_mutation(self, mutator, **kwargs) -> dict:
        config = copy.deepcopy(await self.config_get(**kwargs))
        mutator(config)
        await self.config_apply(config, **kwargs)
        return config

    async def provider_upsert(
        self,
        provider_id: str,
        *,
        api: str,
        base_url: str,
        api_key: str | None = None,
        models: list[dict] | None = None,
        **extra: Any,
    ) -> dict:
        def mutate(config: dict) -> None:
            models_cfg = config.setdefault("models", {})
            providers = models_cfg.setdefault("providers", {})
            provider = dict(providers.get(provider_id) or {})
            provider["api"] = api
            provider["baseUrl"] = base_url
            if api_key is not None:
                provider["apiKey"] = api_key
            if models is not None:
                provider["models"] = copy.deepcopy(models)
            provider.update(extra)
            providers[provider_id] = provider

        config = await self._config_with_mutation(mutate)
        return ((config.get("models") or {}).get("providers") or {}).get(provider_id, {})

    async def provider_remove(self, provider_id: str) -> dict:
        def mutate(config: dict) -> None:
            providers = (config.setdefault("models", {})).setdefault("providers", {})
            providers.pop(provider_id, None)

        config = await self._config_with_mutation(mutate)
        return (config.get("models") or {}).get("providers") or {}

    async def model_upsert(
        self,
        provider_id: str,
        model_id: str,
        *,
        name: str | None = None,
        reasoning: bool | None = None,
        context_window: int | None = None,
        max_tokens: int | None = None,
        input_types: list[str] | None = None,
        **extra: Any,
    ) -> dict:
        def mutate(config: dict) -> None:
            providers = (config.setdefault("models", {})).setdefault("providers", {})
            provider = dict(providers.get(provider_id) or {})
            models = [dict(model) for model in provider.get("models") or []]
            next_model = next((model for model in models if model.get("id") == model_id), None)
            if next_model is None:
                next_model = {"id": model_id}
                models.append(next_model)
            if name is not None:
                next_model["name"] = name
            if reasoning is not None:
                next_model["reasoning"] = reasoning
            if context_window is not None:
                next_model["contextWindow"] = context_window
            if max_tokens is not None:
                next_model["maxTokens"] = max_tokens
            if input_types is not None:
                next_model["input"] = list(input_types)
            next_model.update(extra)
            provider["models"] = models
            providers[provider_id] = provider

        config = await self._config_with_mutation(mutate)
        models = (((config.get("models") or {}).get("providers") or {}).get(provider_id) or {}).get(
            "models"
        ) or []
        return next((model for model in models if model.get("id") == model_id), {})

    async def model_remove(self, provider_id: str, model_id: str) -> list[dict]:
        def mutate(config: dict) -> None:
            providers = (config.setdefault("models", {})).setdefault("providers", {})
            provider = dict(providers.get(provider_id) or {})
            provider["models"] = [
                dict(model) for model in provider.get("models") or [] if model.get("id") != model_id
            ]
            providers[provider_id] = provider

        config = await self._config_with_mutation(mutate)
        return (((config.get("models") or {}).get("providers") or {}).get(provider_id) or {}).get(
            "models"
        ) or []

    async def set_default_model(self, provider_id: str, model_id: str) -> str:
        primary = f"{provider_id}/{model_id}"

        def mutate(config: dict) -> None:
            defaults = (config.setdefault("agents", {})).setdefault("defaults", {})
            model_cfg = defaults.setdefault("model", {})
            model_cfg["primary"] = primary

        await self._config_with_mutation(mutate)
        return primary

    async def set_memory_search(
        self,
        *,
        provider: str,
        model: str,
        base_url: str | None = None,
        api_key: str | None = None,
        **extra: Any,
    ) -> dict:
        def mutate(config: dict) -> None:
            defaults = (config.setdefault("agents", {})).setdefault("defaults", {})
            memory_search = dict(defaults.get("memorySearch") or {})
            memory_search["provider"] = provider
            memory_search["model"] = model
            remote = dict(memory_search.get("remote") or {})
            if base_url is not None:
                remote["baseUrl"] = base_url
            if api_key is not None:
                remote["apiKey"] = api_key
            if remote:
                memory_search["remote"] = remote
            memory_search.update(extra)
            defaults["memorySearch"] = memory_search

        config = await self._config_with_mutation(mutate)
        return ((config.get("agents") or {}).get("defaults") or {}).get("memorySearch") or {}

    async def channel_upsert(
        self,
        channel_id: str,
        channel_config: dict[str, Any],
        *,
        account_id: str | None = None,
    ) -> dict:
        def mutate(config: dict) -> None:
            channels = config.setdefault("channels", {})
            current = dict(channels.get(channel_id) or {})
            if account_id:
                accounts = dict(current.get("accounts") or {})
                current_account = dict(accounts.get(account_id) or {})
                accounts[account_id] = _deep_merge_config(current_account, channel_config)
                current["accounts"] = accounts
                channels[channel_id] = current
                return
            channels[channel_id] = _deep_merge_config(current, channel_config)

        config = await self._config_with_mutation(mutate)
        channel = (config.get("channels") or {}).get(channel_id) or {}
        if account_id:
            return (channel.get("accounts") or {}).get(account_id) or {}
        return channel

    async def channel_patch(
        self,
        channel_id: str,
        patch: dict,
        *,
        account_id: str | None = None,
    ) -> dict:
        return await self.channel_upsert(channel_id, patch, account_id=account_id)

    async def telegram_upsert(
        self,
        channel_config: dict[str, Any],
        *,
        account_id: str | None = None,
    ) -> dict:
        return await self.channel_upsert("telegram", channel_config, account_id=account_id)

    async def slack_upsert(
        self,
        channel_config: dict[str, Any],
        *,
        account_id: str | None = None,
    ) -> dict:
        return await self.channel_upsert("slack", channel_config, account_id=account_id)

    async def discord_upsert(
        self,
        channel_config: dict[str, Any],
        *,
        account_id: str | None = None,
    ) -> dict:
        return await self.channel_upsert("discord", channel_config, account_id=account_id)


@dataclass
class OpenClawProAgent(OpenClawAgent):
    """OpenClaw agent launched with the pro desktop/browser preset."""


@dataclass
class ExecResult:
    """Result of a one-shot command execution."""

    exit_code: int
    stdout: str
    stderr: str

    @classmethod
    def from_dict(cls, data: dict) -> ExecResult:
        return cls(
            exit_code=data.get("exit_code", -1),
            stdout=data.get("stdout", ""),
            stderr=data.get("stderr", ""),
        )


def _validate_agent_ws_token(
    data: object,
    *,
    agent_id: str,
    purpose: Literal["metrics", "exec", "shell"],
    shell: str | None = None,
) -> tuple[str, str, str | None]:
    expected_keys = {"agent_id", "jwt", "expires_at", "ws_url"}
    if purpose == "shell":
        expected_keys.add("shell")
    if not isinstance(data, dict) or set(data) != expected_keys:
        raise ValueError(f"Backend returned an invalid Agent {purpose} token response")

    token_agent_id = data.get("agent_id")
    jwt = data.get("jwt")
    expires_at = data.get("expires_at")
    ws_url = data.get("ws_url")
    resolved_shell = data.get("shell") if purpose == "shell" else None
    if (
        token_agent_id != agent_id
        or not isinstance(jwt, str)
        or not jwt
        or not isinstance(expires_at, str)
        or not expires_at
        or not isinstance(ws_url, str)
        or not ws_url
        or (purpose == "shell" and resolved_shell != shell)
    ):
        raise ValueError(f"Backend returned an invalid Agent {purpose} token response")

    parsed = urlsplit(ws_url)
    expected_suffix = f"/ws/{purpose}/{agent_id}"
    if (
        parsed.scheme not in {"ws", "wss"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith(expected_suffix)
    ):
        raise ValueError(f"Backend returned an invalid Agent {purpose} token response")
    return ws_url, jwt, cast(str | None, resolved_shell)


def _validate_metrics_result(data: object) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("event") != "agent_metrics_result":
        raise RuntimeError("Agent metrics WebSocket returned an invalid result frame")
    if data.get("ok") is True:
        if (
            set(data) != {"event", "ok", "cpu", "memory", "timestamp"}
            or not isinstance(data.get("cpu"), str)
            or not isinstance(data.get("memory"), str)
            or isinstance(data.get("timestamp"), bool)
            or not isinstance(data.get("timestamp"), int)
        ):
            raise RuntimeError("Agent metrics WebSocket returned an invalid result frame")
        return data
    if (
        data.get("ok") is False
        and set(data) == {"event", "ok", "error"}
        and isinstance(data.get("error"), str)
        and data.get("error")
    ):
        raise RuntimeError(str(data["error"]))
    raise RuntimeError("Agent metrics WebSocket returned an invalid result frame")


def _validate_exec_result(data: object) -> ExecResult:
    if not isinstance(data, dict) or data.get("event") != "agent_exec_result":
        raise RuntimeError("Agent exec WebSocket returned an invalid result frame")
    if data.get("ok") is True:
        if (
            set(data) != {"event", "ok", "exit_code", "stdout", "stderr"}
            or isinstance(data.get("exit_code"), bool)
            or not isinstance(data.get("exit_code"), int)
            or not isinstance(data.get("stdout"), str)
            or not isinstance(data.get("stderr"), str)
        ):
            raise RuntimeError("Agent exec WebSocket returned an invalid result frame")
        return ExecResult.from_dict(data)
    if (
        data.get("ok") is False
        and set(data) == {"event", "ok", "error"}
        and isinstance(data.get("error"), str)
        and data.get("error")
    ):
        raise RuntimeError(str(data["error"]))
    raise RuntimeError("Agent exec WebSocket returned an invalid result frame")


class Deployments:
    """
    HyperClaw deployments API — manage agent runtimes.

    Usage:
        from hypercli import HyperCLI
        client = HyperCLI(api_key="...", agent_api_key="sk-...")

        # Launch
        pod = client.deployments.create()
        print(f"Desktop: {pod.vnc_url}")

        # Execute a command
        result = client.deployments.exec(pod, ["echo", "hello"])

        # List
        pods = client.deployments.list()

        # Stop
        client.deployments.stop(pod.id)
    """

    def __init__(
        self,
        http: HTTPClient,
        api_key: str = None,
        api_base: str = None,
        agents_ws_url: str = None,
        timeout: float = None,
    ):
        self._http = http
        self._api_key = api_key or http.api_key
        self._timeout = timeout if timeout is not None else getattr(http, "timeout", 30.0)
        self._api_base = _normalize_agents_api_base(api_base or get_agents_api_base_url()).rstrip(
            "/"
        )
        resolved_agents_ws_url = agents_ws_url or get_config_value("AGENTS_WS_URL")
        self._agents_ws_url = (
            _normalize_agents_ws_url(resolved_agents_ws_url)
            if resolved_agents_ws_url
            else _default_agents_ws_url(self._api_base)
        )

    def _hydrate_agent(self, data: dict) -> Agent:
        runtime = str(data.get("runtime") or "").strip().lower()
        if runtime == "buzz-agent":
            agent = BuzzAgent.from_dict(data)
        elif runtime == "opencode":
            agent = OpenCodeAgent.from_dict(data)
        elif runtime == "codex":
            agent = CodexAgent.from_dict(data)
        elif runtime == "claude-code":
            agent = ClaudeCodeAgent.from_dict(data)
        elif runtime == "goose":
            agent = GooseAgent.from_dict(data)
        elif runtime == "kimi-code":
            agent = KimiCodeAgent.from_dict(data)
        elif runtime == "hermes-agent" or _is_hermes_agent_data(data):
            agent = HermesAgent.from_dict(data)
        elif runtime == "openclaw-pro" or _is_openclaw_pro_agent_data(data):
            agent = OpenClawProAgent.from_dict(data)
        elif runtime == "openclaw" or _is_openclaw_agent_data(data):
            agent = OpenClawAgent.from_dict(data)
        else:
            agent = Agent.from_dict(data)
        agent._deployments = self
        return agent

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: dict = None) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.get(f"{self._api_base}{path}", headers=self._headers, params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _post(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(f"{self._api_base}{path}", headers=self._headers, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def bootstrap_inference(
        self,
        messages: list[dict[str, str]],
        *,
        response_format: dict[str, Any] | None = None,
        timeout: float = 330.0,
    ) -> dict:
        """Run the JWT-authenticated onboarding inference endpoint."""
        body = {
            "messages": messages,
            "response_format": response_format or {"type": "json_object"},
        }
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{self._api_base}/bootstrap",
                headers=self._headers,
                json=body,
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _patch(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.patch(f"{self._api_base}{path}", headers=self._headers, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _put(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.put(f"{self._api_base}{path}", headers=self._headers, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _delete(self, path: str) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.delete(f"{self._api_base}{path}", headers=self._headers)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _agent_id_for_target(self, target: Agent | str) -> str:
        if isinstance(target, Agent):
            return target.id
        return self.resolve_agent_id(str(target))

    def _get_by_id(self, agent_id: str) -> Agent:
        data = self._get(f"{AGENTS_API_PREFIX}/{agent_id}")
        return self._hydrate_agent(data)

    def resolve_agent(self, agent_id_or_name: str) -> Agent:
        """Resolve an agent UUID, unique name, handle, or hostname to an Agent."""
        raw = str(agent_id_or_name or "").strip()
        if not raw:
            raise ValueError("agent_id_or_name is required")
        try:
            return self._get_by_id(str(UUID(raw)))
        except ValueError:
            pass

        matches: list[Agent] = []
        for agent in self.list():
            values = [agent.id, agent.name, agent.handle, agent.hostname]
            if any(str(value or "") == raw for value in values):
                matches.append(agent)
                continue
            if any(str(value or "").startswith(raw) for value in values):
                matches.append(agent)

        if not matches:
            raise ValueError(f"Agent not found: {raw}")
        if len(matches) > 1:
            refs = ", ".join(agent.id for agent in matches[:5])
            raise ValueError(f"Agent reference is ambiguous: {raw} ({refs})")
        return self._get_by_id(matches[0].id)

    def resolve_agent_id(self, agent_id_or_name: str) -> str:
        raw = str(agent_id_or_name or "").strip()
        if not raw:
            raise ValueError("agent_id_or_name is required")
        if _is_self_agent_ref(raw):
            # An Agent reads its own status and manages its own routes -- it
            # is the only party that knows the port it just bound. It does not
            # start or stop itself; that is the owner's. Both self operations
            # are served by dedicated /self endpoints, so nothing resolves a
            # self reference to an id here.
            raise ValueError("self is only supported for status and routes")
        if _is_direct_agent_id_ref(raw):
            return raw
        return self.resolve_agent(raw).id

    def _file_headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _encode_file_path(self, path: str) -> str:
        return quote(path.lstrip("/"), safe="/")

    def wait_for_file_api_ready(
        self,
        agent_id: str,
        *,
        timeout: float = 90.0,
        consecutive: int = 2,
        poll_seconds: float = 1.0,
    ) -> None:
        """Wait until an Agent's Reef file API is actually serving.

        Probing the Agent hostname alone cannot answer this. The Agent domain is
        a wildcard, so a host with no route still resolves and the edge answers a
        plain-text ``404 page not found`` -- byte for byte what a route that has
        not converged yet returns. A caller polling the hostname therefore cannot
        tell "not ready" from "never will be", and will happily retry until its
        deadline against a host that was never going to work.

        So ask the API for the authoritative Agent state first: a deleted or
        failed Agent fails immediately with that state rather than timing out.
        Then require consecutive successful reads, because one success only
        proves the route answered once -- the next request can still 404 while
        the edge settles.
        """

        deadline = time.monotonic() + timeout
        streak = 0
        last_error: Exception | None = None
        last_state = ""
        while True:
            agent = self.get(agent_id)
            last_state = str(getattr(agent, "state", "") or "").upper()
            if last_state in {"DELETED", "FAILED"}:
                raise RuntimeError(
                    f"Agent {agent_id} is {last_state}; its Reef file API will "
                    "not serve. Waiting longer cannot help."
                )
            try:
                self.files_list(agent_id, "")
            except Exception as exc:  # noqa: BLE001 - any read failure resets the streak
                last_error = exc
                streak = 0
            else:
                streak += 1
                if streak >= consecutive:
                    return
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Agent {agent_id} Reef file API did not serve {consecutive} "
                    f"consecutive reads within {timeout:.0f}s "
                    f"(agent state={last_state or 'unknown'}, "
                    f"last error={last_error})"
                )
            time.sleep(poll_seconds)

    def _reef_file_access(self, agent_id: str) -> tuple[str, str]:
        """Mint one fresh file credential and validate its direct Reef locator."""
        payload = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/token")
        if not isinstance(payload, dict):
            raise ValueError("Backend returned an invalid Agent file token response")
        url = str(payload.get("url") or "").rstrip("/")
        token = str(payload.get("token") or "").strip()
        expires_at = str(payload.get("expires_at") or "").strip()
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path != "/_reef"
            or not token
            or not expires_at
        ):
            raise ValueError("Backend returned an invalid Agent file token response")
        return url, token

    @staticmethod
    def _reef_headers(token: str, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {token}"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    @staticmethod
    def _raise_reef_error(response: httpx.Response) -> None:
        try:
            payload = response.json()
            detail = payload.get("detail", response.text) if isinstance(payload, dict) else response.text
        except Exception:
            detail = response.text
        raise APIError(response.status_code, str(detail))

    def _one_shot_ws_result(
        self,
        *,
        agent_id: str,
        purpose: Literal["metrics", "exec"],
        request: dict[str, Any] | None = None,
        timeout: float,
    ) -> object:
        from websockets.exceptions import ConnectionClosed, WebSocketException
        from websockets.sync.client import connect

        token_data = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/{purpose}/token")
        ws_url, jwt, _ = _validate_agent_ws_token(
            token_data,
            agent_id=agent_id,
            purpose=purpose,
        )
        separator = "&" if "?" in ws_url else "?"
        url = f"{ws_url}{separator}jwt={quote(jwt, safe='')}"

        try:
            with connect(
                url,
                open_timeout=min(timeout, 10),
                close_timeout=10,
                max_size=AGENT_EXEC_RESULT_MAX_MESSAGE_BYTES,
            ) as ws:
                if request is not None:
                    ws.send(json.dumps(request, separators=(",", ":")))
                message = ws.recv(timeout=timeout)
                if not isinstance(message, str):
                    raise RuntimeError(
                        f"Agent {purpose} WebSocket returned a non-text result frame"
                    )
                try:
                    result = json.loads(message)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(
                        f"Agent {purpose} WebSocket returned invalid JSON"
                    ) from exc
                try:
                    ws.recv(timeout=10)
                except ConnectionClosed as exc:
                    code = exc.rcvd.code if exc.rcvd is not None else None
                    if code != 1000:
                        reason = exc.rcvd.reason if exc.rcvd is not None else ""
                        suffix = f": {reason}" if reason else ""
                        raise RuntimeError(
                            f"Agent {purpose} WebSocket closed with code {code}{suffix}"
                        ) from exc
                else:
                    raise RuntimeError(
                        f"Agent {purpose} WebSocket returned more than one result frame"
                    )
                return result
        except ConnectionClosed as exc:
            code = exc.rcvd.code if exc.rcvd is not None else None
            reason = exc.rcvd.reason if exc.rcvd is not None else ""
            suffix = f": {reason}" if reason else ""
            raise RuntimeError(
                f"Agent {purpose} WebSocket closed before its result with code {code}{suffix}"
            ) from exc
        except (TimeoutError, OSError, WebSocketException) as exc:
            raise RuntimeError(
                f"Agent {purpose} WebSocket connection failed: {exc}"
            ) from exc

    # -----------------------------------------------------------------------
    # Agent lifecycle (HyperClaw backend → Lagoon)
    # -----------------------------------------------------------------------

    def create(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        runtime: ManagedAgentRuntime | None = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        secrets: dict = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_include: list[str] | None | object = _UNSET,
        sync_exclude: list[str] | None | object = _UNSET,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        restart: bool = False,
        runtime_scopes: list[str] | None = None,
        meta_ui: dict = None,
        dry_run: bool = False,
    ) -> Agent:
        """Submit provisioning for a new agent and return its admission snapshot.

        Args:
            name: Agent name.
            size: Size preset (small/medium/large). When omitted, the backend defaults to small.
            config: Optional config overrides.
            env: Optional environment variables to pass through to the pod.
            secrets: Optional secret environment variables to pass through to the pod.
            sync_root: Absolute runtime mount path for retained PVC storage.
            sync_include: Relative paths to upload/restore. Must contain at
                least one path when supplied; ``None`` selects the whole root.
            sync_exclude: Relative patterns omitted from whole-root mode. An
                empty list excludes nothing. Ignored when an include is active.
        Returns:
            Agent, normally in ``CREATING``. Wait for ``STOPPED`` before file
            access or calling :meth:`start`.

        Steady Reef synchronization is PVC-to-object-storage upload/overwrite,
        not a continuous two-way mirror. Ordinary filesystem deletes are not
        propagated; Files API deletes are. Remote-to-PVC copying occurs only
        during explicit cold restore.
        """
        launch_options: dict[str, Any] = {
            "env": env,
            "secrets": secrets,
            "routes": routes,
            "command": command,
            "entrypoint": entrypoint,
            "image": image,
            "sync_root": sync_root,
            "sync_include": sync_include,
            "sync_exclude": sync_exclude,
            "sync_uid": sync_uid,
            "sync_gid": sync_gid,
            "registry_url": registry_url,
            "registry_auth": registry_auth,
            "restart": restart,
            "runtime_scopes": runtime_scopes,
        }
        launch_payload = _build_agent_launch(config, **launch_options)
        complete_launch = _build_agent_launch(config, _complete=True, **launch_options)
        body: dict = {**launch_payload}
        if dry_run:
            body["dry_run"] = True
        if name:
            body["name"] = name
        if handle is not None:
            body["handle"] = handle
        if size:
            body["size"] = size
        if runtime is not None:
            body["runtime"] = runtime
        if meta_ui:
            body["meta"] = {"ui": copy.deepcopy(meta_ui)}
        if tags:
            body["tags"] = list(tags)
        data = self._post(AGENTS_API_PREFIX, json=body)
        agent = self._hydrate_agent(data)
        agent.__dict__["_submitted_launch_config"] = complete_launch
        return agent

    def create_openclaw(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        secrets: dict = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_include: list[str] | None | object = _UNSET,
        sync_exclude: list[str] | None | object = _UNSET,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        runtime_scopes: list[str] | None = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        openclaw_routes: dict | None = None,
        openclaw_route_options: dict | None = None,
        memory_index: dict | None = None,
        workspaces_sync: dict | bool | None = None,
        runtime: ManagedAgentRuntime = "openclaw",
    ) -> Agent:
        """Create OpenClaw with retained ``/home/node`` and cache exclusions.

        Unlike generic create, omitted sync policy arguments select the
        OpenClaw cache/Workspace exclusion policy. Pass ``sync_include=None``
        or ``sync_exclude=None`` to request whole-root persistence explicitly.
        """
        effective_sync_include, effective_sync_exclude = _resolve_openclaw_sync_policy(
            sync_include=sync_include,
            sync_exclude=sync_exclude,
        )
        effective_env, secret_map, effective_gateway_token = _inject_openclaw_gateway_token(
            env,
            secrets,
            gateway_token,
            generate=True,
        )
        effective_env = {
            **build_openclaw_workspaces_sync_env(workspaces_sync),
            **build_openclaw_memory_index_env(memory_index),
            **effective_env,
        }
        agent = self.create(
            name=name,
            handle=handle,
            size=size,
            runtime=runtime,
            config=_build_openclaw_runtime_config(config, heartbeat),
            tags=tags,
            env=effective_env,
            secrets=secret_map,
            routes=_resolve_openclaw_routes(
                routes,
                openclaw_routes=openclaw_routes,
                openclaw_route_options=openclaw_route_options,
            ),
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_image(image),
            sync_root=sync_root if sync_root is not None else DEFAULT_OPENCLAW_SYNC_ROOT,
            sync_include=effective_sync_include,
            sync_exclude=effective_sync_exclude,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            runtime_scopes=runtime_scopes,
            meta_ui=meta_ui,
            dry_run=dry_run,
        )
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        return agent

    def create_hermes_agent(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        secrets: dict = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_include: list[str] | None | object = _UNSET,
        sync_exclude: list[str] | None | object = _UNSET,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        restart: bool = False,
        runtime_scopes: list[str] | None = None,
        api_server_key: str = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        hermes_routes: dict | None = None,
        hermes_route_options: dict | None = None,
    ) -> HermesAgent:
        """Create a first-class Hermes Agent runtime."""
        effective_env, effective_secrets, effective_key = _inject_hermes_api_server_key(
            env,
            secrets,
            api_server_key,
        )
        agent = self.create(
            name=name,
            handle=handle,
            size=size,
            runtime="hermes-agent",
            config=config,
            tags=tags,
            env=effective_env,
            secrets=effective_secrets,
            routes=_resolve_hermes_agent_routes(
                routes,
                hermes_routes=hermes_routes,
                hermes_route_options=hermes_route_options,
            ),
            command=command,
            entrypoint=entrypoint,
            image=DEFAULT_HERMES_AGENT_IMAGE if image is None else image,
            sync_root=sync_root if sync_root is not None else DEFAULT_HERMES_AGENT_SYNC_ROOT,
            sync_include=sync_include,
            sync_exclude=sync_exclude,
            sync_uid=10000 if sync_uid is None else sync_uid,
            sync_gid=10000 if sync_gid is None else sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            restart=restart,
            runtime_scopes=runtime_scopes,
            meta_ui=meta_ui,
            dry_run=dry_run,
        )
        if not isinstance(agent, HermesAgent):
            raise TypeError("backend did not return a HermesAgent deployment")
        agent.api_server_key = effective_key
        return agent

    def create_openclaw_pro(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        secrets: dict = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_include: list[str] | None | object = _UNSET,
        sync_exclude: list[str] | None | object = _UNSET,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        runtime_scopes: list[str] | None = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        openclaw_routes: dict | None = None,
        openclaw_route_options: dict | None = None,
        memory_index: dict | None = None,
        workspaces_sync: dict | bool | None = None,
    ) -> Agent:
        effective_env = {"OPENCLAW_DESKTOP_ENABLED": "1", **dict(env or {})}
        effective_route_options = {"include_desktop": True, **dict(openclaw_route_options or {})}
        return self.create_openclaw(
            name=name,
            handle=handle,
            size=size,
            config=config,
            tags=tags,
            env=effective_env,
            secrets=secrets,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_pro_image(image),
            sync_root=sync_root,
            sync_include=sync_include,
            sync_exclude=sync_exclude,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            runtime_scopes=(
                list(DEFAULT_AGENT_RUNTIME_SCOPES) if runtime_scopes is None else runtime_scopes
            ),
            gateway_token=gateway_token,
            heartbeat=heartbeat,
            meta_ui=meta_ui,
            dry_run=dry_run,
            openclaw_routes=openclaw_routes,
            openclaw_route_options=effective_route_options,
            memory_index=memory_index,
            workspaces_sync=workspaces_sync,
            runtime="openclaw-pro",
        )

    def _create_coding_agent(
        self,
        *,
        runtime: CodingAgentRuntime,
        name: str | None = None,
        handle: str | None = None,
        size: str | None = None,
        config: dict | None = None,
        tags: list[str] | None = None,
        env: dict | None = None,
        secrets: dict | None = None,
        routes: dict | None = None,
        command: list[str] | None = None,
        entrypoint: list[str] | None = None,
        image: str | None = None,
        sync_root: str | None = None,
        sync_include: list[str] | None | object = _UNSET,
        sync_exclude: list[str] | None | object = _UNSET,
        sync_uid: int | None = None,
        sync_gid: int | None = None,
        registry_url: str | None = None,
        registry_auth: dict | None = None,
        restart: bool = False,
        runtime_scopes: list[str] | None = None,
        meta_ui: dict | None = None,
        dry_run: bool = False,
        workspaces_sync: dict | bool | None = None,
        buzz_enabled: bool = False,
        buzz: BuzzLaunchConfig | None = None,
    ) -> Agent:
        """Create a coding runtime with its runtime-specific include default.

        An explicit nullable sync policy opts out of that helper default and
        selects whole-root persistence. ``sync_include=[]`` is invalid.
        """
        if buzz_enabled and buzz is not None:
            raise ValueError("buzz_enabled cannot be combined with buzz")
        if (buzz_enabled or buzz is not None) and command is not None:
            raise ValueError("Buzz launch cannot be combined with an explicit command")
        buzz_launch = buzz_enabled or buzz is not None
        if buzz_launch and size not in (None, "large"):
            raise ValueError("Buzz coding agents require size='large'")
        effective_env = {
            **build_openclaw_workspaces_sync_env(workspaces_sync),
            **dict(env or {}),
        }
        effective_secrets = dict(secrets or {})
        for key in ("BUZZ_PRIVATE_KEY", "NOSTR_PRIVATE_KEY"):
            value = effective_env.pop(key, None)
            if value is not None:
                existing = effective_secrets.get(key)
                if existing is not None and existing != value:
                    raise ValueError(f"{key} conflicts between env and secrets")
                effective_secrets[key] = value
        if buzz is not None:
            for key in BUZZ_RESERVED_ENV_KEYS:
                effective_env.pop(key, None)
            effective_env.update(buzz.environment(runtime, default_session_title=name))
            effective_secrets.update(buzz.secrets())
        if buzz_launch:
            effective_env.setdefault("RUST_LOG", DEFAULT_BUZZ_RUST_LOG)
        (
            effective_sync_include,
            effective_sync_exclude,
        ) = _resolve_coding_agent_sync_policy(
            runtime,
            sync_include=sync_include,
            sync_exclude=sync_exclude,
        )
        # Hosted Buzz shutdown is process-driven. Never let a generic coding
        # launch override resurrect the adapter after `!shutdown`.
        effective_restart = False if buzz_launch else restart
        return self.create(
            name=name,
            handle=handle,
            size="large" if buzz_launch else size,
            runtime=runtime,
            config=config,
            tags=tags,
            env=effective_env,
            secrets=effective_secrets,
            routes={} if routes is None else routes,
            command=(["/usr/local/bin/buzz-acp"] if buzz_enabled or buzz is not None else command),
            entrypoint=entrypoint,
            image=image
            or (
                DEFAULT_BUZZ_CODING_AGENT_IMAGES[runtime]
                if buzz_launch
                else DEFAULT_CODING_AGENT_IMAGES[runtime]
            ),
            sync_root=sync_root if sync_root is not None else DEFAULT_CODING_AGENT_SYNC_ROOT,
            sync_include=effective_sync_include,
            sync_exclude=effective_sync_exclude,
            sync_uid=1000 if sync_uid is None else sync_uid,
            sync_gid=1000 if sync_gid is None else sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            restart=effective_restart,
            runtime_scopes=(
                list(DEFAULT_AGENT_RUNTIME_SCOPES) if runtime_scopes is None else runtime_scopes
            ),
            meta_ui=meta_ui,
            dry_run=dry_run,
        )

    def create_opencode(self, **kwargs: Any) -> OpenCodeAgent:
        """Create a hosted OpenCode ACP runtime with workspace boot sync."""
        return self._create_coding_agent(
            runtime="opencode",
            **kwargs,
        )  # type: ignore[return-value]

    def create_buzz_agent(self, **kwargs: Any) -> BuzzAgent:
        """Create the native Buzz ACP runtime with workspace boot sync."""
        return self._create_coding_agent(
            runtime="buzz-agent",
            **kwargs,
        )  # type: ignore[return-value]

    def create_codex(self, **kwargs: Any) -> CodexAgent:
        """Create a hosted Codex ACP runtime with workspace boot sync."""
        return self._create_coding_agent(
            runtime="codex",
            **kwargs,
        )  # type: ignore[return-value]

    def create_claude_code(self, **kwargs: Any) -> ClaudeCodeAgent:
        """Create a hosted Claude Code ACP runtime with workspace boot sync."""
        return self._create_coding_agent(
            runtime="claude-code",
            **kwargs,
        )  # type: ignore[return-value]

    def create_goose(self, **kwargs: Any) -> GooseAgent:
        """Create a hosted Goose native ACP runtime with workspace boot sync."""
        return self._create_coding_agent(
            runtime="goose",
            **kwargs,
        )  # type: ignore[return-value]

    def create_kimi_code(self, **kwargs: Any) -> KimiCodeAgent:
        """Create a hosted Kimi Code ACP runtime using Moonshot upstream."""
        return self._create_coding_agent(
            runtime="kimi-code",
            **kwargs,
        )  # type: ignore[return-value]

    def budget(self) -> dict:
        """Get the user's current agent resource budget and usage.

        Returns:
            Dict with budget, used, available (all in cores/GB).
        """
        return self._get(f"{AGENTS_API_PREFIX}/budget")

    def metrics(self, agent_id_or_name: str) -> dict:
        """Get one live CPU/memory sample through the Backend WebSocket facade.

        Args:
            agent_id: Agent UUID.

        Returns:
            Exact successful ``agent_metrics_result`` frame for the Reef runtime.
        """
        agent_id = self.resolve_agent_id(agent_id_or_name)
        result = self._one_shot_ws_result(
            agent_id=agent_id,
            purpose="metrics",
            timeout=max(self._timeout, 35),
        )
        return _validate_metrics_result(result)

    def list(
        self,
        *,
        state: str | None = None,
        handle: str | None = None,
        name: str | None = None,
        query: str | None = None,
        include_deleted: bool | None = None,
    ) -> list[Agent]:
        """List all agents for the authenticated user.

        Returns:
            List of Agent objects.
        """
        return self.list_with_capacity(
            state=state,
            handle=handle,
            name=name,
            query=query,
            include_deleted=include_deleted,
        ).items

    def list_with_capacity(
        self,
        *,
        state: str | None = None,
        handle: str | None = None,
        name: str | None = None,
        query: str | None = None,
        include_deleted: bool | None = None,
    ) -> AgentCapacity:
        """List agents without discarding the account capacity envelope."""
        params = {
            "state": state,
            "handle": handle,
            "name": name,
            "q": query,
            "include_deleted": include_deleted,
        }
        data = self._get(
            AGENTS_API_PREFIX,
            params={key: value for key, value in params.items() if value is not None},
        )
        payload = data if isinstance(data, dict) else {"items": data}
        items = [self._hydrate_agent(item) for item in payload.get("items", [])]
        running_fallback = sum(not is_agent_runtime_inactive_state(agent.state) for agent in items)
        return AgentCapacity(
            items=items,
            total_agents=int(payload.get("total_agents", len(items)) or 0),
            max_agents_per_account=int(payload.get("max_agents_per_account", 0) or 0),
            running_agents=int(payload.get("running_agents", running_fallback) or 0),
            slots={
                str(size): AgentSlotInventory.from_dict(inventory)
                for size, inventory in (payload.get("slots") or {}).items()
            },
            agent_slots=[AgentSlot.from_dict(slot) for slot in payload.get("agent_slots", [])],
            pooled_tpd=int(payload.get("pooled_tpd", 0) or 0),
        )

    def get(self, agent_id_or_name: str) -> Agent:
        """Get agent details by UUID or unique name.

        Args:
            agent_id_or_name: Agent UUID, unique name, handle, or hostname.

        Returns:
            Agent with current status.
        """
        raw = str(agent_id_or_name or "").strip()
        if not raw:
            raise ValueError("agent_id_or_name is required")
        if _is_self_agent_ref(raw):
            return self._get_by_id("self")
        if not _is_direct_agent_id_ref(raw):
            return self.resolve_agent(raw)
        try:
            return self._get_by_id(raw)
        except APIError as exc:
            if exc.status_code not in {404, 422}:
                raise
            try:
                UUID(raw)
            except ValueError:
                return self.resolve_agent(raw)
            raise

    def access_identity(self) -> AgentAccessIdentity:
        """Resolve who the presented credential is, per the Backend.

        Answers the three questions a credential should be able to ask about
        itself: which Agent it is (``agent_id``, set only for an Agent runtime
        key), which account owns it (``user_id``, ``team_id``, ``plan_id``), and
        what it may do (``tags``, ``capabilities``). It returns only what the
        credential already carries, so it is unscoped and safe for any caller.

        Returns:
            AgentAccessIdentity for the credential this client authenticates
            with. ``is_agent_runtime_key`` is True when it belongs to one Agent.
        """
        return AgentAccessIdentity.from_dict(self._get(f"{AGENTS_API_PREFIX}/auth/me"))

    def create_external_agent(
        self,
        *,
        name: str,
        display_name: str | None = None,
        handle: str | None = None,
        runtime: str = "openclaw",
        status: str = "active",
        meta: dict | None = None,
    ) -> Agent:
        """Register a customer-hosted external agent and return its show-once relay key."""
        body: dict[str, Any] = {
            "name": name,
            "runtime": runtime,
            "status": status,
        }
        if display_name is not None:
            body["display_name"] = display_name
        if handle is not None:
            body["handle"] = handle
        if meta is not None:
            body["meta"] = meta
        return self._hydrate_agent(self._post("/external-agents", body))

    def update_external_agent(
        self,
        external_agent_id: str,
        *,
        name: str | None | object = _UNSET,
        display_name: str | None | object = _UNSET,
        handle: str | None | object = _UNSET,
        runtime: Literal["openclaw"] | None | object = _UNSET,
        status: Literal["active", "inactive", "error"] | None | object = _UNSET,
        meta: dict | None | object = _UNSET,
    ) -> Agent:
        """Update a customer-hosted external agent by its exact backend ID."""
        body: dict[str, Any] = {}
        if name is not _UNSET:
            body["name"] = name
        if display_name is not _UNSET:
            body["display_name"] = display_name
        if handle is not _UNSET:
            body["handle"] = handle
        if runtime is not _UNSET:
            body["runtime"] = runtime
        if status is not _UNSET:
            body["status"] = status
        if meta is not _UNSET:
            body["meta"] = meta
        data = self._patch(f"/external-agents/{external_agent_id}", body)
        return self._hydrate_agent(data)

    def rotate_external_agent_key(self, agent_id_or_name: str) -> dict:
        """Rotate an external agent relay key and return the new plaintext key once."""
        agent_id = self.resolve_agent_id(agent_id_or_name)
        return self._post(f"/external-agents/{agent_id}/keys/rotate")

    def attach_slack_relay_agent(
        self,
        agent_id_or_name: str,
        *,
        relay_base_url: str,
        token: str | None = None,
        allowed_channel_id: str | None = None,
        allowed_user_id: str | None = None,
    ) -> dict:
        """Attach an agent to the hosted HyperCLI Slack relay.

        The relay verifies the caller's Slack install and persists the OpenClaw
        Slack relay launch config on the backend. Running agents still need a
        restart before OpenClaw reads the updated channel config.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id_or_name)
        relay_base = _normalize_slack_relay_base_url(relay_base_url)
        auth_token = token or self._api_key
        headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
        body: dict[str, str] = {}
        if allowed_channel_id:
            body["allowed_channel_id"] = allowed_channel_id
        if allowed_user_id:
            body["allowed_user_id"] = allowed_user_id
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{relay_base}/slack/agents/{resolved_agent_id}/relay", headers=headers, json=body
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def list_slack_directory_conversations(
        self,
        *,
        relay_base_url: str,
        token: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        types: str | None = None,
    ) -> dict:
        """List sanitized Slack conversations visible to the hosted relay install."""
        relay_base = _normalize_slack_relay_base_url(relay_base_url)
        auth_token = token or self._api_key
        headers = {"Authorization": f"Bearer {auth_token}"}
        params: dict[str, Any] = {}
        if cursor:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = int(limit)
        if types:
            params["types"] = types
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{relay_base}/slack/directory/conversations", headers=headers, params=params
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def list_slack_directory_users(
        self,
        *,
        relay_base_url: str,
        token: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict:
        """List sanitized Slack users visible to the hosted relay install."""
        relay_base = _normalize_slack_relay_base_url(relay_base_url)
        auth_token = token or self._api_key
        headers = {"Authorization": f"Bearer {auth_token}"}
        params: dict[str, Any] = {}
        if cursor:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = int(limit)
        with httpx.Client(timeout=30) as client:
            resp = client.get(f"{relay_base}/slack/directory/users", headers=headers, params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    async def subscribe(
        self,
        handler: Callable[[DeploymentEvent], Any],
        *,
        stop_event: asyncio.Event | None = None,
        on_ready: Callable[[], Any] | None = None,
    ) -> None:
        """Subscribe to persisted deployment transitions until cancelled."""
        import websockets

        retry_delay = 0.25
        while stop_event is None or not stop_event.is_set():
            try:
                token_data = await asyncio.to_thread(
                    self._post, f"{AGENTS_API_PREFIX}/events/token"
                )
                ws_url = str(token_data.get("ws_url") or "").strip()
                token = str(token_data.get("token") or "").strip()
                if not ws_url or not token:
                    raise RuntimeError("Deployment event token response is incomplete")
                async with websockets.connect(
                    ws_url, ping_interval=20, ping_timeout=20
                ) as websocket:
                    await websocket.send(json.dumps({"type": "auth", "token": token}))
                    ready = json.loads(await asyncio.wait_for(websocket.recv(), timeout=10))
                    if ready != {"type": "ready"}:
                        raise RuntimeError("Deployment event socket did not send ready")
                    if on_ready is not None:
                        result = on_ready()
                        if inspect.isawaitable(result):
                            await result
                    retry_delay = 0.25
                    while stop_event is None or not stop_event.is_set():
                        try:
                            raw = await asyncio.wait_for(
                                websocket.recv(), timeout=0.5 if stop_event is not None else None
                            )
                        except asyncio.TimeoutError:
                            continue
                        event = DeploymentEvent.from_dict(json.loads(raw))
                        if (
                            event.type
                            not in {"deployment.transition", "deployment.import_status"}
                            or not event.agent_id
                        ):
                            continue
                        result = handler(event)
                        if inspect.isawaitable(result):
                            await result
            except asyncio.CancelledError:
                raise
            except APIError as exc:
                if exc.status_code in {401, 403}:
                    raise
                if stop_event is None:
                    await asyncio.sleep(retry_delay)
                else:
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=retry_delay)
                    except asyncio.TimeoutError:
                        pass
                retry_delay = min(retry_delay * 2, 5.0)
            except Exception:
                if stop_event is None:
                    await asyncio.sleep(retry_delay)
                else:
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=retry_delay)
                    except asyncio.TimeoutError:
                        pass
                retry_delay = min(retry_delay * 2, 5.0)

    async def wait_for_state_async(
        self,
        agent_id_or_name: str,
        states: set[str],
        *,
        timeout: float = 300.0,
        poll_interval: float = 5.0,
        failure_states: set[str] | None = None,
        minimum_launch_epoch: int | None = None,
    ) -> Agent:
        """Wait for one state in the requested runtime incarnation."""
        agent_id = await asyncio.to_thread(self.resolve_agent_id, agent_id_or_name)
        deadline = asyncio.get_running_loop().time() + timeout
        wake = asyncio.Event()
        last_agent: Agent | None = None
        desired = {state.lower() for state in states}
        failures = {state.lower() for state in (failure_states or set())}
        effective_poll_interval = max(float(poll_interval), 0.001)
        if not desired:
            raise ValueError("states must not be empty")
        if minimum_launch_epoch is not None and minimum_launch_epoch < 0:
            raise ValueError("minimum_launch_epoch must be non-negative")

        def check(agent: Agent) -> Agent | None:
            nonlocal last_agent
            last_agent = agent
            if (
                minimum_launch_epoch is not None
                and int(agent.launch_epoch or 0) < minimum_launch_epoch
            ):
                return None
            state = str(agent.state or "")
            if state.lower() in desired:
                return agent
            if state.lower() in failures:
                raise RuntimeError(
                    f"Agent entered {state} while waiting for {', '.join(sorted(states))}"
                )
            return None

        def on_event(event: DeploymentEvent) -> None:
            if event.agent_id == agent_id:
                wake.set()

        subscription = asyncio.create_task(self.subscribe(on_event))
        try:
            while (remaining := deadline - asyncio.get_running_loop().time()) > 0:
                current = check(await asyncio.to_thread(self.get, agent_id))
                if current is not None:
                    return current
                waiter = asyncio.create_task(wake.wait())
                waiters = {waiter}
                if not subscription.done():
                    waiters.add(subscription)
                done, _ = await asyncio.wait(
                    waiters,
                    timeout=min(remaining, effective_poll_interval),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if waiter not in done:
                    waiter.cancel()
                    await asyncio.gather(waiter, return_exceptions=True)
                    if asyncio.get_running_loop().time() >= deadline:
                        break
                else:
                    wake.clear()
        finally:
            subscription.cancel()
            await asyncio.gather(subscription, return_exceptions=True)

        final = check(await asyncio.to_thread(self.get, agent_id))
        if final is not None:
            return final
        last_state = str(last_agent.state or "") if last_agent is not None else "unknown"
        raise TimeoutError(
            f"Timed out waiting for agent {agent_id} to reach "
            f"{', '.join(sorted(states))} (last={last_state})"
        )

    async def wait_running_async(
        self,
        agent_id_or_name: str,
        timeout: float = 300.0,
        *,
        poll_interval: float = 5.0,
        minimum_launch_epoch: int | None = None,
    ) -> Agent:
        """Wait for RUNNING using WebSocket wakeups and REST confirmation."""
        return await self.wait_for_state_async(
            agent_id_or_name,
            {"running"},
            timeout=timeout,
            poll_interval=poll_interval,
            # Stable runtime-free states cannot satisfy this invocation's goal.
            failure_states=set(AGENT_WAIT_RUNNING_FAILURE_STATES),
            minimum_launch_epoch=minimum_launch_epoch,
        )

    def wait_for_state(
        self,
        agent_id_or_name: str,
        states: set[str],
        *,
        timeout: float = 300.0,
        poll_interval: float = 5.0,
        failure_states: set[str] | None = None,
        minimum_launch_epoch: int | None = None,
    ) -> Agent:
        """Synchronous event-assisted state wait; use the async variant in an event loop."""
        return _run_sync(
            lambda: self.wait_for_state_async(
                agent_id_or_name,
                states,
                timeout=timeout,
                poll_interval=poll_interval,
                failure_states=failure_states,
                minimum_launch_epoch=minimum_launch_epoch,
            ),
            running_loop_error=(
                "wait_for_state() cannot run inside an event loop; use wait_for_state_async()"
            ),
        )

    def wait_running(
        self,
        agent_id_or_name: str,
        timeout: float = 300.0,
        poll_interval: float = 5.0,
        *,
        minimum_launch_epoch: int | None = None,
    ) -> Agent:
        """Wait for RUNNING via deployment events and REST reconciliation."""
        return _run_sync(
            lambda: self.wait_running_async(
                agent_id_or_name,
                timeout=timeout,
                poll_interval=poll_interval,
                minimum_launch_epoch=minimum_launch_epoch,
            ),
            running_loop_error=(
                "wait_running() cannot run inside an event loop; use wait_running_async()"
            ),
        )

    def _recover_redacted_secrets(self, agent_id: str, launch_epoch: int) -> dict[str, str]:
        """Read back every launch secret value the projection refuses to return.

        Agent projections list secret *names* and expose values only through
        the per-secret retrieval endpoint, so a complete ``secrets`` mapping
        has to be reassembled one key at a time. Every response is checked
        against *launch_epoch* so a rebuild never silently mixes values from
        an older launch generation into a new one.
        """
        names_data = self.secret_names(agent_id)
        if int(names_data.get("launch_epoch") or 0) < launch_epoch:
            raise RuntimeError("agent secret names belong to an older launch epoch")
        secrets: dict[str, str] = {}
        for name in names_data.get("names") or []:
            secret_data = self.secret(agent_id, str(name))
            if int(secret_data.get("launch_epoch") or 0) < launch_epoch:
                raise RuntimeError("agent secret belongs to an older launch epoch")
            secrets[str(name)] = str(secret_data.get("value") or "")
        return secrets

    def _rehydrate_redacted_launch_config(
        self,
        resolved_agent_id: str,
        launch_config: dict,
    ) -> dict:
        """Restore the two launch_config keys an Agent projection redacts.

        WHY THIS EXISTS -- do not delete it as redundant validation sugar.
        The Backend's owner-facing Agent projection deliberately strips
        ``secrets`` and ``registry_auth`` before returning an Agent to a
        user-scoped caller (``hydrate_managed_agent`` in the Backend's
        ``unified_agents`` module pops both). START, by contrast, is a *full
        replacement* and demands every key in
        ``REQUIRED_START_LAUNCH_CONFIG_KEYS``. Without this step the obvious
        round-trip can never succeed, because the read side is structurally
        incapable of returning what the write side requires::

            agent = client.deployments.get(agent_id)
            client.deployments.start(agent_id, agent.launch_config)
            # ValueError: launch_config is incomplete; missing:
            #             registry_auth, secrets

        The fix is to complete the object honestly, never to weaken the
        completeness contract -- START must stay a replacement, not a merge.

        Only keys that are genuinely ABSENT are rebuilt. A caller-supplied
        ``secrets`` or ``registry_auth`` is honoured verbatim, including an
        explicit empty dict, so "redacted by the projection" and "deliberately
        empty" remain distinguishable.

        ``secrets`` is recoverable because values can be read back one name at
        a time. ``registry_auth`` is NOT: it is caller-held, write-only, and
        never stored server-side. It therefore defaults to ``{}`` only when
        the configuration pulls from no ``registry_url``; when a registry is
        configured an empty credential would silently break the image pull, so
        the caller is told to supply it instead.
        """
        if not isinstance(launch_config, dict):
            raise TypeError("launch_config must be a complete object")
        absent = REQUIRED_START_LAUNCH_CONFIG_KEYS - launch_config.keys()
        # Nothing missing, or missing more than the projection ever redacts:
        # in both cases hand the object straight to the validator. Only a
        # config whose *sole* gaps are the two redacted keys is a projection
        # round-trip worth spending API calls to repair.
        if not absent or absent - {"secrets", "registry_auth"}:
            return launch_config

        prepared = copy.deepcopy(launch_config)
        if "secrets" in absent:
            agent = self._get_by_id(resolved_agent_id)
            prepared["secrets"] = self._recover_redacted_secrets(
                resolved_agent_id, agent.launch_epoch
            )
        if "registry_auth" in absent:
            registry_url = str(prepared.get("registry_url") or "").strip()
            if registry_url:
                raise ValueError(
                    f"Agent {resolved_agent_id} pulls from registry_url "
                    f"{registry_url!r} but launch_config carries no registry_auth; "
                    "registry_auth is caller-held and write-only, so the owner-facing "
                    "projection can never return it and the SDK will not substitute an "
                    "empty credential that would break the private-registry pull -- "
                    "pass registry_auth explicitly to START"
                )
            prepared["registry_auth"] = {}
        return prepared

    def start(
        self,
        agent_id: str,
        launch_config: dict,
        *,
        dry_run: bool = False,
    ) -> Agent:
        """Start with one complete replacement launch configuration.

        ``launch_config`` is sent wholesale. The SDK never merges it with the
        prior Agent snapshot or asks the Backend to inherit omitted fields.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        body: dict[str, Any] = {
            "launch_config": _copy_complete_launch_config(
                self._rehydrate_redacted_launch_config(resolved_agent_id, launch_config)
            )
        }
        if dry_run:
            body["dry_run"] = True
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/start", json=body)
        agent = self._hydrate_agent(data)
        agent.__dict__["_submitted_launch_config"] = copy.deepcopy(body["launch_config"])
        return agent

    def start_hermes_agent(
        self,
        agent_id: str,
        launch_config: dict,
        *,
        api_server_key: str = None,
        dry_run: bool = False,
    ) -> HermesAgent:
        """Start Hermes without silently rotating its application gateway key."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        prepared = _copy_complete_launch_config(
            self._rehydrate_redacted_launch_config(resolved_agent_id, launch_config)
        )
        supplied_key = (
            api_server_key
            or (prepared.get("secrets") or {}).get("API_SERVER_KEY")
            or (prepared.get("env") or {}).get("API_SERVER_KEY")
        )
        effective_key: str | None = None
        if supplied_key is not None:
            effective_env, effective_secrets, effective_key = _inject_hermes_api_server_key(
                prepared.get("env"),
                prepared.get("secrets"),
                api_server_key,
            )
            prepared["env"] = effective_env
            prepared["secrets"] = effective_secrets
        agent = self.start(
            resolved_agent_id,
            prepared,
            dry_run=dry_run,
        )
        if not isinstance(agent, HermesAgent):
            raise TypeError("backend did not return a HermesAgent deployment")
        agent.api_server_key = effective_key
        return agent

    def start_openclaw(
        self,
        agent_id: str,
        launch_config: dict,
        *,
        gateway_token: str = None,
        dry_run: bool = False,
    ) -> Agent:
        resolved_agent_id = self.resolve_agent_id(agent_id)
        prepared = _copy_complete_launch_config(
            self._rehydrate_redacted_launch_config(resolved_agent_id, launch_config)
        )
        effective_env, effective_secrets, effective_gateway_token = _inject_openclaw_gateway_token(
            prepared.get("env"),
            prepared.get("secrets"),
            gateway_token,
            generate=False,
        )
        prepared["env"] = effective_env
        prepared["secrets"] = effective_secrets
        agent = self.start(
            resolved_agent_id,
            prepared,
            dry_run=dry_run,
        )
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        return agent

    def start_openclaw_pro(
        self,
        agent_id: str,
        launch_config: dict,
        *,
        gateway_token: str = None,
        dry_run: bool = False,
    ) -> Agent:
        return self.start_openclaw(
            agent_id,
            launch_config,
            gateway_token=gateway_token,
            dry_run=dry_run,
        )

    def update(
        self,
        agent_id: str,
        *,
        name: str | None = None,
        size: str | None = None,
        launch_config: dict | None = None,
        refresh_from_lagoon: bool | None = None,
        error: str | None = None,
        handle: str | None = None,
    ) -> Agent:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if handle is not None:
            body["handle"] = handle
        if size is not None:
            body["size"] = size
        if launch_config is not None:
            body["launch_config"] = launch_config
        if refresh_from_lagoon is not None:
            body["refresh_from_lagoon"] = refresh_from_lagoon
        if error is not None:
            body["error"] = error
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._http.patch(f"{AGENTS_API_PREFIX}/{resolved_agent_id}", json=body)
        return self._hydrate_agent(data)

    def resize(
        self,
        agent_id: str,
        *,
        size: str | None = None,
    ) -> Agent:
        return self.update(agent_id, size=size)

    def stop(self, agent_id: str) -> Agent:
        """Stop an agent (tears down pod, keeps DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            Agent in ``stopping`` state while runtime cleanup is in progress.
            Use ``wait_for_state(agent_id, {"stopped"})`` to wait through the
            deployment event stream before treating the slot as released.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/stop")
        return self._hydrate_agent(data)

    def archive(self, agent_id: str) -> Agent:
        """Archive durable storage for a stopped agent without launching it."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/archive")
        return self._hydrate_agent(data)

    def restore(self, agent_id: str) -> Agent:
        """Restore durable storage for a stopped or archived agent."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/restore")
        return self._hydrate_agent(data)

    def _routes_target(self, agent_id: str) -> str:
        """Return the path segment for route calls, honouring ``self``.

        An Agent manages its own routes -- it is the only party that knows the
        port it just bound. A runtime key is authorised on the parameterised
        path for its own agent, so ``self`` is passed through to the
        /deployments/self/routes alias, which resolves the caller's id server
        side. Resolving it here via access_identity() would reach the same
        handler at the cost of an extra round trip.
        """

        if _is_self_agent_ref(agent_id):
            return "self"
        return self.resolve_agent_id(agent_id)

    def get_routes(self, agent_id: str) -> AgentRoutes:
        """Return the desired routes and live reconciliation state for an agent."""
        resolved_agent_id = self._routes_target(agent_id)
        data = self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/routes")
        return AgentRoutes.from_dict(data)

    def set_routes(
        self,
        agent_id: str,
        routes: dict[str, AgentRouteConfig],
    ) -> AgentRoutes:
        """Atomically replace the complete declarative route map."""
        resolved_agent_id = self._routes_target(agent_id)
        body: dict[str, Any] = {
            "routes": {str(name): dict(config) for name, config in routes.items()},
        }
        data = self._put(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/routes", body)
        return AgentRoutes.from_dict(data)

    def set_route(
        self,
        agent_id: str,
        name: str,
        route: AgentRouteConfig,
    ) -> AgentRoutes:
        """Atomically create or replace one named route."""
        resolved_agent_id = self._routes_target(agent_id)
        body = dict(route)
        encoded_name = quote(str(name), safe="")
        data = self._put(
            f"{AGENTS_API_PREFIX}/{resolved_agent_id}/routes/{encoded_name}",
            body,
        )
        return AgentRoutes.from_dict(data)

    def remove_route(
        self,
        agent_id: str,
        name: str,
    ) -> AgentRoutes:
        """Atomically remove one named route."""
        resolved_agent_id = self._routes_target(agent_id)
        encoded_name = quote(str(name), safe="")
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}/routes/{encoded_name}"
        return AgentRoutes.from_dict(self._delete(path))

    def delete(self, agent_id: str) -> dict:
        """Accept a durable soft delete and background local cleanup.

        Args:
            agent_id: Agent UUID.

        Returns:
            The Backend's HTTP 200 accepted projection. Runtime storage cleanup
            continues in the background; the response is not proof of cleanup.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._delete(f"{AGENTS_API_PREFIX}/{resolved_agent_id}")

    def refresh_token(self, agent_id: str) -> dict:
        """Refresh the JWT token for an agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with agent_id, token, expires_at, and launch epoch.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/token")

    def create_scoped_key(self, agent_id: str, name: str | None = None) -> dict:
        payload = {"name": name} if name is not None else {}
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/keys", json=payload or None)

    def upload_profile_image(
        self,
        agent_id: str,
        content: bytes | bytearray | memoryview | str | Path,
        *,
        content_type: str | None = None,
    ) -> dict:
        """Upload an agent avatar/profile image through the deployments API."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        guessed_content_type = content_type
        if isinstance(content, (str, Path)):
            path = Path(content)
            payload = path.read_bytes()
            guessed_content_type = guessed_content_type or mimetypes.guess_type(path.name)[0]
        else:
            payload = bytes(content)

        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.post(
                f"{self._api_base}{AGENTS_API_PREFIX}/{resolved_agent_id}/profile-image",
                headers=self._file_headers(content_type=guessed_content_type or "image/png"),
                content=payload,
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def web_search(self, query: str, *, count: int = 5, **params: Any) -> dict:
        """Run Brave web search through the HyperClaw agents API proxy.

        Returns the raw Brave-compatible JSON payload. The request uses the
        agent API key as `X-Subscription-Token`; the backend substitutes its
        configured Brave API key upstream.
        """
        search_params: dict[str, Any] = {"q": query, "count": int(count)}
        for key, value in params.items():
            if value is not None:
                search_params[key] = value
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{self._api_base}/brave/res/v1/web/search",
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": self._api_key,
                },
                params=search_params,
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def purchase_entitlement_from_balance(
        self,
        plan_id: str,
        *,
        duration: int,
        tags: list[str] | None = None,
        extend_existing: bool | None = None,
    ) -> dict:
        payload: dict[str, Any] = {"duration": int(duration)}
        if tags is not None:
            payload["tags"] = list(tags)
        if extend_existing is not None:
            payload["extend_existing"] = bool(extend_existing)
        return self._post(f"/billing/balance/{quote(str(plan_id), safe='')}", json=payload)

    def redeem_grant_code(self, code: str, *, extend_existing: bool | None = None) -> dict:
        payload: dict[str, Any] = {"code": str(code)}
        if extend_existing is not None:
            payload["extend_existing"] = bool(extend_existing)
        return self._post("/billing/grants/redeem", json=payload)

    def logs_token(self, agent_id: str) -> dict:
        """Mint a short-lived JWT token for backend log streaming."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/logs/token")

    def env(self, agent_id: str) -> dict[str, Any]:
        """Fetch the deployment's non-secret environment."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/env")

    def set_env(self, agent_id: str, key: str, value: str) -> AgentLaunchValueMutation:
        """Set one non-secret launch environment value while the agent is stopped."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        resolved_key = quote(str(key), safe="")
        data = self._patch(
            f"{AGENTS_API_PREFIX}/{resolved_agent_id}/env/{resolved_key}",
            json={"value": str(value)},
        )
        return AgentLaunchValueMutation.from_dict(data)

    def delete_env(self, agent_id: str, key: str) -> AgentLaunchValueMutation:
        """Delete one non-secret launch environment value while the agent is stopped."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        resolved_key = quote(str(key), safe="")
        data = self._delete(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/env/{resolved_key}")
        return AgentLaunchValueMutation.from_dict(data)

    def secret_names(self, agent_id: str) -> dict[str, Any]:
        """List the deployment's secret names without exposing their values."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/secrets")

    def secret(self, agent_id: str, key: str) -> dict[str, Any]:
        """Fetch one deployment secret by its exact environment key."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        resolved_key = quote(str(key), safe="")
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/secrets/{resolved_key}")

    def set_secret(self, agent_id: str, key: str, value: str) -> AgentLaunchValueMutation:
        """Set one launch secret while stopped without expecting its value back."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        resolved_key = quote(str(key), safe="")
        data = self._patch(
            f"{AGENTS_API_PREFIX}/{resolved_agent_id}/secrets/{resolved_key}",
            json={"value": str(value)},
        )
        return AgentLaunchValueMutation.from_dict(data)

    def delete_secret(self, agent_id: str, key: str) -> AgentLaunchValueMutation:
        """Delete one launch secret while the agent is stopped."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        resolved_key = quote(str(key), safe="")
        data = self._delete(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/secrets/{resolved_key}")
        return AgentLaunchValueMutation.from_dict(data)

    def exec(
        self,
        pod: Agent | str,
        command: list[str],
        timeout: int = 30,
        dry_run: bool = False,
    ) -> ExecResult:
        """Execute a one-shot command through the Backend WebSocket facade.

        Args:
            pod: Agent to execute on.
            command: Exact executable and argument vector to run.
            timeout: Command timeout in seconds.

        Returns:
            ExecResult with exit_code, stdout, stderr.
        """
        if (
            not isinstance(command, list)
            or not command
            or any(not isinstance(argument, str) for argument in command)
            or not command[0]
            or any("\x00" in argument for argument in command)
            or sum(len(argument.encode("utf-8")) for argument in command) > 65_536
        ):
            raise ValueError(
                "command must be a nonempty argv list of strings with a nonempty "
                "executable, at most 65536 UTF-8 bytes, and no NUL"
            )
        command = list(command)
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 300:
            raise ValueError("timeout must be an integer from 1 through 300")

        agent_id = self._agent_id_for_target(pod)
        result = self._one_shot_ws_result(
            agent_id=agent_id,
            purpose="exec",
            request={"command": command, "timeout": timeout, "dry_run": bool(dry_run)},
            timeout=timeout + 10,
        )
        return _validate_exec_result(result)

    def files_list(self, pod: Agent | str, path: str = "") -> list[dict]:
        """List a path directly through the Agent's retained Reef server."""
        agent_id = self._agent_id_for_target(pod)
        resolved_path = resolve_sync_root_file_path(path)
        reef_url, token = self._reef_file_access(agent_id)
        suffix = f"/{self._encode_file_path(resolved_path)}" if resolved_path else ""
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.get(
                f"{reef_url}/directories{suffix}",
                headers=self._reef_headers(token),
                follow_redirects=False,
            )
        if not 200 <= resp.status_code < 300:
            self._raise_reef_error(resp)
        payload = resp.json()
        if not _is_directory_listing_payload(payload):
            raise ValueError("Reef returned an invalid directory listing")
        return [
            *(payload.get("directories") or []),
            *(payload.get("files") or []),
        ]

    def file_read_bytes_with_metadata(self, pod: Agent | str, path: str) -> dict[str, Any]:
        """Read a sync-root-relative file directly from Reef."""
        agent_id = self._agent_id_for_target(pod)
        resolved_path = resolve_sync_root_file_path(path)
        if not resolved_path:
            raise ValueError("agent file path is required")
        reef_url, token = self._reef_file_access(agent_id)
        content = bytearray()
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            with client.stream(
                "GET",
                f"{reef_url}/files/{self._encode_file_path(resolved_path)}",
                headers=self._reef_headers(token),
                follow_redirects=False,
            ) as resp:
                if not 200 <= resp.status_code < 300:
                    resp.read()
                    self._raise_reef_error(resp)
                content_type = resp.headers.get("content-type", "")
                for chunk in resp.iter_bytes(chunk_size=AGENT_FILE_TRANSFER_CHUNK_BYTES):
                    remaining = (AGENT_FILE_MAX_BYTES + 1) - len(content)
                    content.extend(chunk[:remaining])
                    if len(content) > AGENT_FILE_MAX_BYTES:
                        raise ValueError(
                            "Agent file reads are limited to "
                            f"{AGENT_FILE_MAX_BYTES // 1024 // 1024} MiB"
                        )
        content_bytes = bytes(content)
        if "application/json" in content_type.lower():
            try:
                payload = json.loads(content_bytes.decode(errors="replace"))
            except Exception:
                payload = None
            if _is_directory_listing_payload(payload):
                raise ValueError(f"Path is a directory: {path}. Use files_list(path) instead.")
        return {"content": content_bytes, "mime_type": content_type or None}

    def file_read_bytes(self, pod: Agent | str, path: str) -> bytes:
        """Read a sync-root-relative file through the Reef file API."""
        return self.file_read_bytes_with_metadata(pod, path).get("content", b"")

    def file_read(self, pod: Agent | str, path: str) -> str:
        """Read a UTF-8 text file from an agent."""
        return self.file_read_bytes(pod, path).decode(errors="replace")

    def file_write_bytes(self, pod: Agent | str, path: str, content: bytes) -> dict:
        """Write bytes directly to a sync-root-relative path through Reef.

        Per-file writes are limited to 100 MiB (``AGENT_FILE_WRITE_MAX_BYTES``,
        the Cloudflare edge request-body cap on the agent hostname). Larger
        data should be split across files or synced via the agent's own
        tooling.
        """
        path = normalize_writable_backend_file_path(path)
        if not path:
            raise ValueError("agent file path is required")
        if len(content) > AGENT_FILE_WRITE_MAX_BYTES:
            raise ValueError(
                "Agent file writes are limited to "
                f"{AGENT_FILE_WRITE_MAX_BYTES // 1024 // 1024} MiB "
                "(Cloudflare request-body cap on the agent hostname); "
                "split larger data or sync it via the agent's own tooling"
            )
        agent_id = self._agent_id_for_target(pod)
        reef_url, token = self._reef_file_access(agent_id)
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.put(
                f"{reef_url}/files/{self._encode_file_path(path)}",
                headers=self._reef_headers(token, content_type="application/octet-stream"),
                content=content,
                follow_redirects=False,
            )
        if not 200 <= resp.status_code < 300:
            self._raise_reef_error(resp)
        return resp.json()

    def file_write(self, pod: Agent | str, path: str, content: str) -> dict:
        """Write a UTF-8 text file to an agent.

        Subject to the 100 MiB per-file write limit; see ``file_write_bytes``.
        """
        return self.file_write_bytes(pod, path, content.encode())

    def file_delete(
        self,
        pod: Agent | str,
        path: str,
        recursive: bool = False,
    ) -> dict:
        """Delete a sync-root-relative file or directory directly through Reef."""
        path = normalize_writable_backend_file_path(path)
        if not path:
            raise ValueError("agent file path is required")
        agent_id = self._agent_id_for_target(pod)
        reef_url, token = self._reef_file_access(agent_id)
        with httpx.Client(timeout=10) as client:
            resp = client.delete(
                f"{reef_url}/files/{self._encode_file_path(path)}",
                headers=self._reef_headers(token),
                params={"recursive": "true"} if recursive else None,
                follow_redirects=False,
            )
        if not 200 <= resp.status_code < 300:
            self._raise_reef_error(resp)
        return resp.json()

    def cp_to(self, pod: Agent | str, local_path: str | Path, remote_path: str) -> dict:
        """Copy a local file to an agent.

        Subject to the 100 MiB per-file write limit; see ``file_write_bytes``.
        """
        source = Path(local_path)
        return self.file_write_bytes(pod, remote_path, source.read_bytes())

    def cp_from(self, pod: Agent | str, remote_path: str, local_path: str | Path) -> Path:
        """Copy a file from an agent to the local filesystem."""
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.file_read_bytes(pod, remote_path))
        return dest

    # -----------------------------------------------------------------------
    # WebSocket API (via HyperClaw backend)
    # -----------------------------------------------------------------------

    async def logs_stream_ws(
        self,
        agent_id: str,
        tail_lines: int = 100,
        container: str = "reef",
        follow: bool = True,
    ) -> AsyncIterator[str]:
        """Stream logs via backend WebSocket.

        Connects to the HyperClaw backend WebSocket endpoint which proxies
        to the lagoon log buffer.

        Args:
            agent_id: Agent UUID.
            tail_lines: Number of historical lines to fetch first.
            container: Container name (default: reef).
            follow: Keep streaming after buffered history.

        Yields:
            Log lines as they arrive.
        """
        import websockets

        # Get JWT token
        resolved_agent_id = self.resolve_agent_id(agent_id)
        token_data = self.logs_token(resolved_agent_id)
        jwt = token_data["jwt"]

        url = (
            f"{self._agents_ws_url}/logs/{resolved_agent_id}"
            f"?jwt={quote(jwt, safe='')}"
            f"&container={quote(container, safe='')}"
            f"&tail_lines={tail_lines}"
        )

        async with websockets.connect(url) as ws:
            async for msg in ws:
                try:
                    payload = json.loads(msg)
                except (TypeError, json.JSONDecodeError):
                    yield str(msg)
                    continue
                if not isinstance(payload, dict):
                    continue
                event = payload.get("event")
                if event == "log":
                    yield str(payload.get("log") or "")
                elif event == "history_end" and not follow:
                    return
                elif event == "error":
                    raise RuntimeError(str(payload.get("detail") or "Log stream failed"))

    async def shell_connect(self, agent_id: str, shell: str | None = None):
        """Connect to agent shell via backend WebSocket proxy.

        Connects to the HyperClaw backend shell WebSocket which proxies
        to lagoon → k8s exec for bidirectional PTY access.

        Args:
            agent_id: Agent UUID.

        Returns:
            WebSocket connection for bidirectional shell I/O.
        """
        import websockets

        resolved_agent_id = self.resolve_agent_id(agent_id)
        selected_shell = shell or "/bin/bash"

        token_data = self._post(
            f"{AGENTS_API_PREFIX}/{resolved_agent_id}/shell/token",
            json={"shell": selected_shell},
        )
        ws_url, jwt, resolved_shell = _validate_agent_ws_token(
            token_data,
            agent_id=resolved_agent_id,
            purpose="shell",
            shell=selected_shell,
        )
        separator = "&" if "?" in ws_url else "?"
        url = (
            f"{ws_url}{separator}jwt={quote(jwt, safe='')}"
            f"&shell={quote(resolved_shell, safe='')}"
        )

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
