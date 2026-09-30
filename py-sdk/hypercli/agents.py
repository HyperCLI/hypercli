"""
Deployments API — managed agent runtimes.

Client for the authenticated backend deployment endpoints that provision,
hydrate, and operate hosted agent runtimes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import asyncio
import base64
import binascii
import copy
import inspect
import json
import mimetypes
import re
import secrets
import shlex
import time
import warnings
from typing import (
    Awaitable,
    Callable,
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
from uuid import UUID

import httpx

from .config import get_agents_api_base_url, get_config_value
from .http import HTTPClient, APIError
from .sessions import SessionPage


AGENTS_API_BASE = "https://api.hypercli.com/agents"
AGENTS_API_PREFIX = "/deployments"
AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE = "https://api.dev.hypercli.com/agents"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"
AGENTS_ACP_PROXY_WS_URL = "wss://api.agents.hypercli.com/ws/acp"
DEV_AGENTS_ACP_PROXY_WS_URL = "wss://api.agents.dev.hypercli.com/ws/acp"
DEFAULT_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:prod"
DEFAULT_OPENCLAW_PRO_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-prod"
DEFAULT_HERMES_AGENT_IMAGE = "ghcr.io/hypercli/hypercli-hermes:latest"
DEFAULT_OPENCODE_IMAGE = "ghcr.io/hypercli/hypercli-opencode:latest"
DEFAULT_CODEX_IMAGE = "ghcr.io/hypercli/hypercli-codex:latest"
DEFAULT_CLAUDE_CODE_IMAGE = "ghcr.io/hypercli/hypercli-claude:latest"
DEFAULT_GOOSE_IMAGE = "ghcr.io/hypercli/hypercli-goose:latest"
DEFAULT_KIMI_CODE_IMAGE = "ghcr.io/hypercli/hypercli-kimi-code:latest"
DEFAULT_PI_IMAGE = "ghcr.io/hypercli/hypercli-pi:latest"
DEFAULT_PI_ENV = {"HYPER_RUNTIME_HOME": "/home/node/.pi/agent"}
DEFAULT_BUZZ_AGENT_IMAGE = "ghcr.io/hypercli/hypercli-buzz-agent:latest"
DEFAULT_BUZZ_OPENCODE_IMAGE = DEFAULT_OPENCODE_IMAGE
DEFAULT_BUZZ_CODEX_IMAGE = DEFAULT_CODEX_IMAGE
DEFAULT_BUZZ_CLAUDE_CODE_IMAGE = DEFAULT_CLAUDE_CODE_IMAGE
DEFAULT_BUZZ_GOOSE_IMAGE = DEFAULT_GOOSE_IMAGE
DEFAULT_BUZZ_KIMI_CODE_IMAGE = DEFAULT_KIMI_CODE_IMAGE
DEFAULT_BUZZ_PI_IMAGE = DEFAULT_PI_IMAGE


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
OPENCLAW_CRON_ENV_DEFAULTS = {
    "OPENCLAW_CRON_ENABLED": "1",
}
OPENCLAW_TRUSTED_PROXIES_ENV = "OPENCLAW_TRUSTED_PROXIES"
HERMES_CRON_ENV_DEFAULTS = {
    "HERMES_CRON_ENABLED": "1",
}
DEFAULT_OPENCLAW_MODEL_ENV = {
    "HYPER_MODELS": "default-anthropic",
    "HYPER_EMBEDDING_MODELS": "qwen3-embedding-4b",
}
DEFAULT_HERMES_MODEL_ENV = DEFAULT_OPENCLAW_MODEL_ENV
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
DEFAULT_HERMES_AGENT_SYNC_EXCLUDE = ("shared/**",)
LAUNCH_CONFIG_KEYS = frozenset(
    {
        "image",
        "env",
        "secrets",
        "routes",
        "cors",
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
        "executor",
        "docker",
    }
)
DEFAULT_HERMES_AGENT_SYNC_ROOT = "/home/hermes"
DEFAULT_HERMES_AGENT_SYNC_UID = 10000
DEFAULT_HERMES_AGENT_SYNC_GID = 10000
DEFAULT_CODING_AGENT_SYNC_ROOT = "/home/node"
AGENT_FILE_MAX_BYTES = 250 * 1024 * 1024
RUNNER_FILE_MAX_BYTES = 262_144
# Reef file writes traverse the Cloudflare-proxied agent hostname
# (https://<agent>.hypercli.app/_reef/...), whose edge rejects request bodies
# above 100 MB. Enforced client-side so oversized writes fail fast with a
# clear error instead of an opaque edge ``413 Payload Too Large``.
AGENT_FILE_WRITE_MAX_BYTES = 100 * 1024 * 1024
AGENT_FILE_TRANSFER_CHUNK_BYTES = 64 * 1024
AGENT_FILE_OPERATION_TIMEOUT_SECONDS = 300
AGENT_EXEC_OUTPUT_MAX_BYTES = 1_048_576
# Runner-docker bind-mount cap; matches the Backend wire model
# (AssignmentDockerOptions.volumes max_length).
MAX_DOCKER_VOLUMES = 64
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


# Canonical runtime labels only: the legacy wire spellings (``openclaw``,
# ``hermes-agent``) are folded to their *_acp successors by the Backend at
# create/patch (launch_contract.py LEGACY_RUNTIME_MIGRATIONS) and are
# deliberately not in this union (mirrors ts-sdk).
ManagedAgentRuntime = Literal[
    "generic",
    "openclaw-pro",
    "openclaw_acp",
    "hermes_acp",
    "buzz-agent",
    "opencode",
    "codex",
    "claude-code",
    "goose",
    "kimi-code",
    "pi",
]
AgentSize = Literal["small", "medium", "large"]
_AGENT_SIZES = frozenset({"small", "medium", "large"})


def _parse_agent_size(value: object, *, field_name: str) -> AgentSize:
    if not isinstance(value, str) or value not in _AGENT_SIZES:
        raise ValueError(f"{field_name} must be one of: small, medium, large")
    return cast(AgentSize, value)


CodingAgentRuntime = Literal["buzz-agent", "opencode", "codex", "claude-code", "goose", "kimi-code", "pi"]

DEFAULT_CODING_AGENT_IMAGES: dict[CodingAgentRuntime, str] = {
    "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
    "opencode": DEFAULT_OPENCODE_IMAGE,
    "codex": DEFAULT_CODEX_IMAGE,
    "claude-code": DEFAULT_CLAUDE_CODE_IMAGE,
    "goose": DEFAULT_GOOSE_IMAGE,
    "kimi-code": DEFAULT_KIMI_CODE_IMAGE,
    "pi": DEFAULT_PI_IMAGE,
}
DEFAULT_CODING_AGENT_SYNC_INCLUDES: dict[CodingAgentRuntime, tuple[str, ...] | None] = {
    "buzz-agent": None,
    "opencode": (
        ".hypercli/USER.md", ".hypercli/SOUL.md",
        ".config/opencode",
        ".local/share/opencode",
        ".local/state/opencode",
        ".cache/opencode",
    ),
    "codex": (".codex", ".hypercli/USER.md", ".hypercli/SOUL.md"),
    "claude-code": (".claude", ".claude.json", ".hypercli/USER.md", ".hypercli/SOUL.md"),
    "goose": (".goose", ".hypercli/USER.md", ".hypercli/SOUL.md"),
    "kimi-code": (".kimi-code", ".hypercli/USER.md", ".hypercli/SOUL.md"),
    "pi": (".pi", ".hypercli/USER.md", ".hypercli/SOUL.md"),
}
DEFAULT_BUZZ_CODING_AGENT_IMAGES: dict[CodingAgentRuntime, str] = {
    "buzz-agent": DEFAULT_BUZZ_AGENT_IMAGE,
    "opencode": DEFAULT_BUZZ_OPENCODE_IMAGE,
    "codex": DEFAULT_BUZZ_CODEX_IMAGE,
    "claude-code": DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
    "goose": DEFAULT_BUZZ_GOOSE_IMAGE,
    "kimi-code": DEFAULT_BUZZ_KIMI_CODE_IMAGE,
    "pi": DEFAULT_BUZZ_PI_IMAGE,
}

PermissionMode = Literal[
    "default",
    "auto",
    "bypass-permissions",
    "accept-edits",
    "plan",
    "dont-ask",
    "buzz-hosted",
]

# Canonical key order; the harness compares the serialized bytes
# (buzz-backend-provider pins the buzz-hosted preset byte-for-byte).
_PERMISSION_PRESETS: dict[str, dict[str, Any]] = {
    "default": {"*": "allow"},
    "auto": {"*": "allow"},
    "bypass-permissions": {"*": "allow"},
    "accept-edits": {
        "read": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "edit": "allow",
        "todowrite": "allow",
        "*": "ask",
    },
    "plan": {
        "read": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "lsp": "allow",
        "question": "allow",
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "external_directory": "deny",
        "skill": "deny",
        "webfetch": "deny",
        "websearch": "deny",
        "*": "deny",
    },
    "dont-ask": {
        "read": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "*": "deny",
    },
    "buzz-hosted": {
        "read": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "lsp": "allow",
        "todowrite": "allow",
        "question": "allow",
        "edit": "allow",
        "doom_loop": "deny",
        "external_directory": "allow",
        "bash": {
            "hyper *": "allow",
            "git *": "allow",
            "*": "deny",
        },
        "webfetch": "allow",
        "websearch": "allow",
        "skill": "allow",
        "task": "allow",
        "*": "deny",
    },
}


def build_permissions_json(mode: PermissionMode, overrides: dict | None = None) -> str:
    """Serialize the opencode ConfigPermissionV1 permission JSON for a preset
    mode, optionally layered with caller overrides. The output is what
    ``HYPER_ACP_PERMISSIONS`` carries in launch-config env; hyper-acp translates
    it to ``OPENCODE_PERMISSION`` at child spawn."""
    preset = _PERMISSION_PRESETS.get(str(mode)) or _PERMISSION_PRESETS["default"]
    merged = {**preset, **overrides} if overrides else preset
    return json.dumps(merged, separators=(",", ":"))


# Public file access uses backend discovery for Reef or native runner transport. S3 is reserved
# for archive/restore internals.
# Retained for callers that want to address the conventional OpenClaw workspace;
# the generic files API no longer applies this prefix implicitly.
OPENCLAW_WORKSPACE_PREFIX = ".openclaw/workspace"


def resolve_sync_root_file_path(path: str) -> str:
    """Normalize one path relative to the Agent's configured Reef sync root."""
    normalized = path.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[a-zA-Z]:", normalized) or "\0" in normalized:
        raise ValueError("agent file paths must be relative to the sync root")
    parts = normalized.split("/")
    if ".." in parts:
        raise ValueError("agent file paths must stay within the sync root")
    return "/".join(part for part in parts if part not in {"", "."})


def normalize_writable_backend_file_path(path: str) -> str:
    """Return a safe sync-root-relative path accepted by the public files API."""
    return resolve_sync_root_file_path(path)


def _native_file_path(path: str) -> str:
    if (not path or len(path.encode("utf-8")) > 4096
            or any(c in path for c in ("\\", ":", "\0"))
            or any(part in {"", ".", ".."} or part.endswith((" ", "."))
                   for part in path.split("/"))):
        raise ValueError("Runner file paths must be portable paths relative to the assignment root")
    return path


class AgentFiles:
    """Backend-discovered file access scoped to an agent's retained storage root."""

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


def build_openclaw_desktop_route(
    *,
    desktop_port: int = 3000,
    desktop_auth: bool = True,
    desktop_prefix: str = "desktop",
) -> dict[str, dict]:
    """Desktop leg route for openclaw-pro.

    There is no public gateway route anymore: the OpenClaw gateway binds
    loopback in-pod with auth mode ``none`` as an ACP hop only.
    """
    return {
        "desktop": {
            "port": int(desktop_port),
            "auth": bool(desktop_auth),
            "prefix": str(desktop_prefix),
        }
    }


def build_openclaw_trusted_proxies_env(trusted_proxies: list[str] | tuple[str, ...] | None) -> dict[str, str]:
    """Build the OpenClaw env that replaces ``gateway.trustedProxies``.

    Values are comma-separated and replace the configured list in OpenClaw;
    pass ``None`` or an empty iterable to leave the launch env unset.
    """
    proxies = [str(proxy).strip() for proxy in (trusted_proxies or ()) if str(proxy).strip()]
    if not proxies:
        return {}
    return {OPENCLAW_TRUSTED_PROXIES_ENV: ",".join(proxies)}


def _route_config_body(route: dict) -> dict:
    body = dict(route)
    if not body.get("remove_headers"):
        body.pop("remove_headers", None)
    return body


def _build_runner_target(runner: dict) -> dict:
    """Normalize self-hosted runner placement for POST /deployments.

    Shape: ``{"tags": [...], "runner_id": "..."}`` — tags match runner tags
    for the same owner; ``runner_id`` pins one runner (docs/future/RUNNER.md).
    """

    if not isinstance(runner, dict):
        raise TypeError("runner must be a dict like {'tags': [...], 'runner_id': '...'}")
    unknown = sorted(set(runner) - {"tags", "runner_id"})
    if unknown:
        raise ValueError("runner supports only tags and runner_id: " + ", ".join(unknown))
    tags = runner.get("tags")
    runner_id = runner.get("runner_id")
    body: dict[str, Any] = {}
    if tags is not None:
        body["tags"] = [str(tag) for tag in tags]
    if runner_id is not None:
        body["runner_id"] = str(runner_id)
    return body


def _routes_config_body(routes: dict | None) -> dict:
    return {str(name): _route_config_body(dict(route)) for name, route in (routes or {}).items()}


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


def build_openclaw_cron_env(enabled: bool | None = None) -> dict[str, str]:
    """Build OpenClaw cron environment variables.

    Hosted OpenClaw launch helpers default cron on. Pass False to disable it for
    the next boot, or override ``OPENCLAW_CRON_ENABLED`` directly in env.
    """
    env = dict(OPENCLAW_CRON_ENV_DEFAULTS)
    if enabled is not None:
        env["OPENCLAW_CRON_ENABLED"] = _env_bool(enabled)
    return env


def build_hermes_cron_env(enabled: bool | None = None) -> dict[str, str]:
    """Build Hermes cron environment variables.

    Hosted Hermes launch helpers default cron on. Pass False to disable it for
    the next boot, or override ``HERMES_CRON_ENABLED`` directly in env.
    """
    env = dict(HERMES_CRON_ENV_DEFAULTS)
    if enabled is not None:
        env["HERMES_CRON_ENABLED"] = _env_bool(enabled)
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


def agents_acp_proxy_ws_url(agents_ws_url: str) -> str:
    """Client-facing ACP session proxy (sessions/README §14) next to the
    agent-keyed ``/ws`` tunnel — the same host, with the path suffixed to
    ``/ws/acp``. Mirrors ts-sdk agent-urls.ts."""
    base = (agents_ws_url or "").strip()
    suffix = "/ws"
    if not base.endswith(suffix):
        raise ValueError(f"agents ws url must end with /ws: {agents_ws_url!r}")
    return f"{base[: -len(suffix)]}/ws/acp"


def _default_agents_acp_ws_url(api_base: str) -> str:
    raw = _normalize_agents_api_base(api_base)
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower()
    if host in {"api.agents.hypercli.com", "api.hypercli.com", "api.hyperclaw.app"}:
        return AGENTS_ACP_PROXY_WS_URL
    if host in {
        "api.agents.dev.hypercli.com",
        "api.dev.hypercli.com",
        "api.dev.hyperclaw.app",
        "dev-api.hyperclaw.app",
    }:
        return DEV_AGENTS_ACP_PROXY_WS_URL
    # _normalize_agents_api_base always returns a URL ending in /agents.
    return agents_acp_proxy_ws_url(_normalize_agents_ws_url(raw.removesuffix("/agents")))


def _agents_admin_base(api_base: str) -> str:
    """Service-key admin surface (``/admin/...``); same origin as the agents API."""
    base = (api_base or "").rstrip("/")
    suffix = "/agents"
    if not base.endswith(suffix):
        raise ValueError(f"agents api base must end with /agents: {api_base!r}")
    return f"{base[: -len(suffix)]}/admin"


MAX_SYNC_OWNER_ID = 4_294_967_294
REQUIRED_START_LAUNCH_CONFIG_KEYS = frozenset(
    {
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
    executor = value.get("executor")
    if executor is not None and executor not in ("process", "docker"):
        raise ValueError("launch_config executor must be 'process' or 'docker'")
    if executor == "process" and value.get("docker") is not None:
        raise ValueError("docker launch options require the docker executor")
    return copy.deepcopy(value)


def _normalize_sync_owner(value: int | None, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= MAX_SYNC_OWNER_ID:
        raise ValueError(f"{field} must be an integer between 0 and {MAX_SYNC_OWNER_ID}")
    return value


def _normalize_docker_launch(docker: dict | None) -> dict | None:
    """Validate optional runner-docker options (Compose-shape bind volumes)."""
    if docker is None:
        return None
    if not isinstance(docker, dict) or not set(docker) <= {"volumes"}:
        raise ValueError("docker accepts only a volumes list")
    volumes = docker.get("volumes") or []
    if not isinstance(volumes, list) or not all(isinstance(volume, str) for volume in volumes):
        raise ValueError("docker volumes must be a list of strings")
    if len(volumes) > MAX_DOCKER_VOLUMES:
        raise ValueError(f"docker volumes accept at most {MAX_DOCKER_VOLUMES} entries")
    for volume in volumes:
        segments = volume.split(":")
        if len(segments) not in (2, 3):
            raise ValueError(f"docker volume must be source:target[:ro]: {volume!r}")
        source, target = segments[0], segments[1]
        if not source or not target or "\0" in volume:
            raise ValueError(f"docker volume paths must be non-empty and NUL-free: {volume!r}")
        if not source.startswith("/") or not target.startswith("/"):
            raise ValueError(f"docker volume source and target must be absolute: {volume!r}")
        if len(segments) == 3 and segments[2] != "ro":
            raise ValueError(f"docker volume mode must be ro or omitted: {volume!r}")
    # An empty volumes list declares no extra mounts: normalization to None
    # clears stored options in a replacement contract (_build_agent_launch).
    if not volumes:
        return None
    return {"volumes": list(volumes)}


def _normalize_executor(executor: str | None) -> str | None:
    """Validate the optional runner executor; absent stays absent (the Backend
    treats pre-existing runner rows without one as docker)."""
    if executor is None:
        return None
    if executor not in ("process", "docker"):
        raise ValueError("executor must be 'process' or 'docker'")
    return executor


def _resolve_coding_agent_sync_policy(
    runtime: CodingAgentRuntime,
    *,
    sync_include: list[str] | None | object,
    sync_exclude: list[str] | None | object,
) -> tuple[list[str] | None | object, list[str] | None | object]:
    """Mirror ts createCodingAgent: an explicit include wins, an explicit
    nullable policy opts out of the helper default into whole-root
    persistence, and an omitted policy selects the runtime's preset include
    (``[]`` exclude — exclude nothing — when the runtime retains the root)."""
    if sync_include is not _UNSET and sync_include is not None:
        return list(sync_include), _UNSET
    if sync_exclude is not _UNSET:
        if sync_exclude is None:
            return _UNSET, _UNSET
        return _UNSET, list(sync_exclude)
    if sync_include is None:
        return _UNSET, _UNSET
    default_include = DEFAULT_CODING_AGENT_SYNC_INCLUDES[runtime]
    if default_include:
        return list(default_include), _UNSET
    return _UNSET, []


def _build_agent_launch(
    config: dict | None = None,
    *,
    env: dict | None = None,
    secrets: dict | None = None,
    routes: dict | None = None,
    cors: AgentCorsConfig | dict | None | object = _UNSET,
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
    docker: dict | None | object = _UNSET,
    executor: str | None = None,
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
        "image": image,
        "env": env_map,
        "secrets": secret_map or {},
        "routes": _routes_config_body(routes),
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
    if cors is not _UNSET:
        complete_launch["cors"] = None if cors is None else copy.deepcopy(dict(cors))
    normalized_docker = None if docker is _UNSET else _normalize_docker_launch(docker)
    normalized_executor = _normalize_executor(executor)
    if normalized_executor == "process" and normalized_docker is not None:
        raise ValueError("docker launch options require the docker executor")
    if normalized_docker is not None:
        complete_launch["docker"] = copy.deepcopy(normalized_docker)
    elif docker is not _UNSET:
        # Explicit None (or an empty volumes list) clears stored runner docker
        # options in a replacement contract: the Backend treats provided-but-
        # empty docker as absent.
        complete_launch["docker"] = None
    if normalized_executor is not None:
        complete_launch["executor"] = normalized_executor
    if _complete:
        return complete_launch

    launch: dict[str, Any] = {}
    if prepared_config:
        launch["config"] = prepared_config
    if env_map:
        launch["env"] = env_map
    if secret_map:
        launch["secrets"] = secret_map
    if cors is not _UNSET and cors is not None:
        launch["cors"] = copy.deepcopy(dict(cors))
    for key, value, provided in (
        ("routes", complete_launch["routes"], routes is not None),
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
    if normalized_docker is not None:
        launch["docker"] = copy.deepcopy(normalized_docker)
    if normalized_executor is not None:
        launch["executor"] = normalized_executor
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
    docker: dict | None | object = _UNSET,
    executor: str | None = None,
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
        docker=docker,
        executor=executor,
        _complete=True,
    )


def _truthy_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _falsey_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"0", "false", "no", "off", "disabled"}


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
    desktop_enabled = get_launch_config_value(launch_config, "env.HYPER_DESKTOP_ENABLED")
    if _falsey_env(desktop_enabled):
        return False
    if _truthy_env(desktop_enabled):
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
        # prefix but no archived_at. Dropping it made that tri-state unreadable.
        "archive_prefix": data.get("archive_prefix"),
        "deleted_at": _parse_dt(data.get("deleted_at")),
        "disconnected_at": _parse_dt(data.get("disconnected_at")),
        "agent_slot_id": data.get("agent_slot_id"),
        "cluster_id": data.get("cluster_id"),
        "runner": copy.deepcopy(data.get("runner"))
        if isinstance(data.get("runner"), dict)
        else None,
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
    """Live, token-authenticated PTY session for browser/device login."""

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
    """Runtime-specific authentication over the existing protected exec/shell API.

    OpenClaw/hermes pods have no in-pod login flow and carry no ``_COMMANDS``
    entry; constructing one for an unlisted runtime raises ``ValueError`` —
    the gate mirrors ts-sdk ``RUNTIME_AUTH_CONFIG``.
    """

    _COMMANDS: dict[str, dict[str, Any]] = {
        "buzz-agent": {
            "agent": ("buzz-agent",),
            "status": (
                "hyper-acp",
                "plugin",
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
                "hyper-acp",
                "plugin",
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
                    kind="native",
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
                    kind="native",
                    command=("claude", "auth", "login", "--claudeai"),
                ),
                RuntimeAuthMethod(
                    id="console",
                    name="Anthropic Console",
                    kind="native",
                    command=("claude", "auth", "login", "--console"),
                ),
                RuntimeAuthMethod(
                    id="sso",
                    name="Claude SSO",
                    kind="native",
                    command=("claude", "auth", "login", "--sso"),
                ),
            ),
        },
        "goose": {
            "agent": ("goose", "acp"),
            "status": (
                "hyper-acp",
                "plugin",
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
                "hyper-acp",
                "plugin",
                "models",
                "--agent-command",
                "kimi",
                "--agent-args",
                "acp",
                "--json",
            ),
            "logout": None,
        },
        "pi": {
            "agent": ("pi-acp",),
            "status": (
                "hyper-acp", "plugin", "models", "--agent-command", "pi-acp", "--json",
            ),
            "logout": None,
        },
    }

    def __init__(self, agent: "Agent"):
        self.agent = agent
        self.runtime = str(agent.runtime or "")
        if self.runtime not in self._COMMANDS:
            raise ValueError(
                "Runtime authentication is not available for runtime "
                f"'{self.runtime or 'generic'}'"
            )

    @property
    def _config(self) -> dict[str, Any]:
        return self._COMMANDS[self.runtime]

    def _exec(self, command: tuple[str, ...], *, timeout: int = 30) -> "ExecResult":
        return self.agent.exec(list(command), timeout=timeout)

    def methods(self) -> list[RuntimeAuthMethod]:
        agent_command = tuple(self._config["agent"])
        argv = ["hyper-acp", "plugin", "auth-methods", "--agent-command", agent_command[0]]
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
                "hyper-acp",
                "plugin",
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
    remove_headers: NotRequired[list[str]]


class AgentCorsConfig(TypedDict):
    """Product-level browser CORS policy for runtime routes."""

    allowed_origins: list[str]
    allow_credentials: NotRequired[bool]
    allowed_headers: NotRequired[list[str]]
    allowed_methods: NotRequired[list[str]]
    max_age: NotRequired[int]


@dataclass(frozen=True)
class AgentRoutes:
    """Declarative routes and their live status for one agent."""

    agent_id: str
    routes: dict[str, AgentRouteConfig] = field(default_factory=dict)
    cors: AgentCorsConfig | None = None
    route_statuses: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "AgentRoutes":
        raw_cors = data.get("cors")
        return cls(
            agent_id=str(data.get("agent_id") or ""),
            routes={str(name): dict(config) for name, config in (data.get("routes") or {}).items()},
            cors=dict(raw_cors) if isinstance(raw_cors, dict) else None,
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
    archive_prefix: Optional[str] = None
    deleted_at: Optional[datetime] = None
    disconnected_at: Optional[datetime] = None
    agent_slot_id: Optional[str] = None
    cluster_id: Optional[str] = None
    runner: Optional[dict] = None
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

    @property
    def auth(self) -> RuntimeAuthClient:
        """Runtime auth flows for this agent's pod (coding runtimes only).

        Raises ``ValueError`` when the runtime carries no auth config entry,
        mirroring the ts-sdk ``RuntimeAuthClient`` construction gate.
        """
        return RuntimeAuthClient(self)

    def route_requires_auth(self, route_name: str, default: bool = True) -> bool:
        route = self.routes.get(route_name) or {}
        if "auth" not in route:
            return default
        return bool(route.get("auth", default))

    def refresh_token(self) -> dict:
        data = self._require_deployments().refresh_token(self.id)
        self.jwt_token = data.get("token")
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
        handle: str | None = None,
        runtime: ManagedAgentRuntime | None = None,
        reset_image: bool | None = None,
    ) -> "Agent":
        agent = self._require_deployments().update(
            self.id,
            name=name,
            size=size,
            launch_config=launch_config,
            handle=handle,
            runtime=runtime,
            reset_image=reset_image,
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


# Every managed runtime — openclaw_acp, openclaw-pro, hermes_acp, and the
# coding-agent runtimes — boots its pod behind hyper-acp, so runtime auth
# rides the same exec/shell surface; the runtimes differ only in the
# ``runtime`` label plus launch-config data (images, sync roots/uid/gid,
# harness env). There is no per-runtime facade class: ``Agent`` carries the
# auth member directly and gates it at call time through the ``_COMMANDS``
# table, not by hydration class.
#
# .. deprecated:: every deployment hydrates to the single flat :class:`Agent`;
#    use ``Agent`` in place of ``CodingAgent``. Kept importable as a pure
#    alias, mirroring ts-sdk ``export type CodingAgent = Agent``.
CodingAgent = Agent


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
    base_keys = {"agent_id", "expires_at", "ws_url"}
    if purpose == "shell":
        base_keys.add("shell")
    if (
        not isinstance(data, dict)
        or set(data) != {*base_keys, "token"}
    ):
        raise ValueError(f"Backend returned an invalid Agent {purpose} token response")

    token_agent_id = data.get("agent_id")
    token = data.get("token")
    expires_at = data.get("expires_at")
    ws_url = data.get("ws_url")
    resolved_shell = data.get("shell") if purpose == "shell" else None
    if (
        token_agent_id != agent_id
        or not isinstance(token, str)
        or not token
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
    return ws_url, token, cast(str | None, resolved_shell)


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
        # One flat Agent for every runtime: capability gates at call time
        # (Agent.auth and the RuntimeAuthClient table), not by hydration class.
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
        """Run the authenticated onboarding inference endpoint."""
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

    def _delete(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=self._timeout) as client:
            if json is None:
                resp = client.delete(f"{self._api_base}{path}", headers=self._headers)
            else:
                resp = client.request(
                    "DELETE",
                    f"{self._api_base}{path}",
                    headers=self._headers,
                    json=json,
                )
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
            except APIError as exc:
                if exc.status_code == 501:
                    raise
                last_error = exc
                streak = 0
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

    def _file_access(self, agent_id: str) -> tuple[str, str] | Literal["runner"]:
        """Resolve the authoritative transport; never infer it from placement or DNS."""
        payload = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/token")
        if not isinstance(payload, dict):
            raise ValueError("Backend returned an invalid Agent file token response")
        fields = {"transport", "executor", "max_bytes"} if "transport" in payload else {"url", "token", "expires_at"}
        if set(payload) != fields:
            raise ValueError("Backend returned an invalid Agent file token response")
        if "transport" in payload:
            if (payload.get("transport") != "runner" or payload.get("executor") not in ("process", "docker")
                    or type(payload.get("max_bytes")) is not int
                    or payload["max_bytes"] != RUNNER_FILE_MAX_BYTES):
                raise ValueError("Backend returned an invalid runner file transport")
            return "runner"
        if any(not isinstance(payload.get(key), str) for key in ("url", "token", "expires_at")):
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
        ws_url, token, _ = _validate_agent_ws_token(
            token_data,
            agent_id=agent_id,
            purpose=purpose,
        )
        separator = "&" if "?" in ws_url else "?"
        url = f"{ws_url}{separator}token={quote(token, safe='')}"

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
        cors: AgentCorsConfig | dict | None | object = _UNSET,
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
        docker: dict | None | object = _UNSET,
        executor: str | None = None,
        meta_ui: dict = None,
        runner: dict = None,
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
            "cors": cors,
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
            "docker": docker,
            "executor": executor,
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
        if runner is not None:
            body["runner"] = _build_runner_target(runner)
        data = self._post(AGENTS_API_PREFIX, json=body)
        agent = self._hydrate_agent(data)
        agent.__dict__["_submitted_launch_config"] = complete_launch
        return agent


    def create_agent(
        self,
        runtime: ManagedAgentRuntime,
        *,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        secrets: dict = None,
        routes: dict = None,
        cors: AgentCorsConfig | dict | None | object = _UNSET,
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
        docker: dict | None | object = _UNSET,
        executor: str | None = None,
        meta_ui: dict = None,
        runner: dict = None,
        dry_run: bool = False,
        workspaces_sync: dict | bool | None = None,
        permission_mode: PermissionMode | None = None,
        cron_enabled: bool | None = None,
        memory_index: dict | None = None,
        trusted_proxies: list[str] | tuple[str, ...] | None = None,
    ) -> Agent:
        """Create a managed agent for a runtime in one call.

        ``runtime`` selects the per-runtime launch defaults (image, sync root
        and include/exclude presets, uid/gid, env presets, routes, boot
        command) from the SDK's data tables; the folded options read the knobs
        each runtime family understands and ignore the rest. ``create()``
        stays the raw generic entry; ``create_agent`` is the typed one
        (mirrors ts-sdk ``Deployments.createAgent``).

        - ``openclaw_acp``/``openclaw-pro``: OpenClaw ACP launch
          with cron/memory/workspaces defaults (the pro variant adds the
          desktop route and leg).
        - ``hermes_acp``: Hermes ACP launch with the hermes
          image, sync-root, and cron defaults.
        - ``buzz-agent``/``opencode``/``codex``/``claude-code``/``goose``/
          ``kimi-code``/``pi``: the shared ACP coding-agent launch contract.

        The typed Buzz launch contract (``BuzzLaunchConfig``) is ts-sdk-only:
        this surface does not accept the keyword, so passing it raises
        ``TypeError``. Hosted Slack has no launch knob to set: the relay
        attaches and routes outside the pod.
        """
        launch = {
            "name": name,
            "handle": handle,
            "size": size,
            "config": config,
            "tags": tags,
            "env": env,
            "secrets": secrets,
            "routes": routes,
            "cors": cors,
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
            "docker": docker,
            "executor": executor,
            "meta_ui": meta_ui,
            "runner": runner,
            "dry_run": dry_run,
        }
        if runtime == "generic":
            return self.create(**launch)
        if runtime in ("openclaw-pro", "openclaw_acp"):
            return self._create_openclaw_agent(
                runtime,
                workspaces_sync=workspaces_sync,
                cron_enabled=cron_enabled,
                memory_index=memory_index,
                trusted_proxies=trusted_proxies,
                launch=launch,
            )
        if runtime == "hermes_acp":
            return self._create_hermes_agent_deployment(
                runtime,
                cron_enabled=cron_enabled,
                launch=launch,
            )
        return self._create_coding_agent_deployment(
            runtime,
            workspaces_sync=workspaces_sync,
            permission_mode=permission_mode,
            launch=launch,
        )

    def _create_openclaw_agent(self, runtime: str, *, launch: dict, **knobs: Any) -> Agent:
        pro = runtime == "openclaw-pro"
        # The openclaw launch family rejects nested config: launch settings are
        # top-level fields only.
        launch.pop("config")
        launch["env"] = {
            **({"HYPER_DESKTOP_ENABLED": "1"} if pro else {}),
            **build_openclaw_workspaces_sync_env(knobs["workspaces_sync"]),
            **build_openclaw_cron_env(knobs["cron_enabled"]),
            **build_openclaw_memory_index_env(knobs["memory_index"]),
            **DEFAULT_OPENCLAW_MODEL_ENV,
            **dict(launch["env"] or {}),
            # OpenClaw treats this env as a full replace for
            # gateway.controlUi.allowedOrigins, and every HyperCLI surface
            # (desktop, console) drives the control UI from dynamic origins.
            # The only value that lands reliably is the wildcard — always
            # write it.
            "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN": "*",
            **build_openclaw_trusted_proxies_env(knobs["trusted_proxies"]),
        }
        if launch["routes"] is None:
            launch["routes"] = build_openclaw_desktop_route() if pro else {}
        launch["image"] = launch["image"] or (
            DEFAULT_OPENCLAW_PRO_IMAGE if pro else DEFAULT_OPENCLAW_IMAGE
        )
        if launch["sync_root"] is None:
            launch["sync_root"] = DEFAULT_CODING_AGENT_SYNC_ROOT
        # An explicit None include/exclude opts out of the default into
        # whole-root persistence, the same as ts's explicit null.
        if launch["sync_include"] is _UNSET and launch["sync_exclude"] is _UNSET:
            launch["sync_exclude"] = list(DEFAULT_OPENCLAW_SYNC_EXCLUDE)
        if pro and launch["runtime_scopes"] is None:
            launch["runtime_scopes"] = list(DEFAULT_AGENT_RUNTIME_SCOPES)
        return self.create(runtime=runtime, **launch)

    def _create_hermes_agent_deployment(self, runtime: str, *, launch: dict, **knobs: Any) -> Agent:
        launch["env"] = {
            **build_hermes_cron_env(knobs["cron_enabled"]),
            **DEFAULT_HERMES_MODEL_ENV,
            **dict(launch["env"] or {}),
        }
        launch["image"] = launch["image"] or DEFAULT_HERMES_AGENT_IMAGE
        if launch["sync_root"] is None:
            launch["sync_root"] = DEFAULT_HERMES_AGENT_SYNC_ROOT
        if launch["sync_include"] is _UNSET and launch["sync_exclude"] is _UNSET:
            launch["sync_exclude"] = list(DEFAULT_HERMES_AGENT_SYNC_EXCLUDE)
        if launch["sync_uid"] is None:
            launch["sync_uid"] = DEFAULT_HERMES_AGENT_SYNC_UID
        if launch["sync_gid"] is None:
            launch["sync_gid"] = DEFAULT_HERMES_AGENT_SYNC_GID
        if launch["runtime_scopes"] is None:
            launch["runtime_scopes"] = list(DEFAULT_AGENT_RUNTIME_SCOPES)
        agent = self.create(runtime=runtime, **launch)
        if agent.runtime != "hermes_acp":
            raise TypeError("Hermes deployment response did not identify runtime 'hermes_acp'")
        return agent

    def _create_coding_agent_deployment(self, runtime: str, *, launch: dict, **knobs: Any) -> Agent:
        """Launch the shared ACP coding-agent contract: Workspaces boot sync
        env defaults on, launch env always carries ``HYPER_ACP_PERMISSIONS``
        (built from ``permission_mode``, caller ``env`` wins), and
        ``BUZZ_PRIVATE_KEY`` / ``NOSTR_PRIVATE_KEY`` in ``env`` are promoted
        to launch secrets."""
        if runtime not in DEFAULT_CODING_AGENT_IMAGES:
            raise ValueError(
                "runtime must be one of: " + ", ".join(DEFAULT_CODING_AGENT_IMAGES)
            )
        effective_env = {
            **build_openclaw_workspaces_sync_env(knobs["workspaces_sync"]),
            **(dict(DEFAULT_PI_ENV) if runtime == "pi" else {}),
            **dict(launch["env"] or {}),
        }
        effective_env.setdefault(
            "HYPER_ACP_PERMISSIONS",
            build_permissions_json(knobs["permission_mode"] or "default"),
        )
        if knobs["permission_mode"] is not None:
            # Transition: legacy hyper-acp builds only read the mode var, so keep
            # emitting it alongside the JSON when the caller chose a mode. A
            # caller-supplied HYPER_ACP_PERMISSION_MODE in env passes through.
            effective_env.setdefault("HYPER_ACP_PERMISSION_MODE", knobs["permission_mode"])
        effective_secrets = dict(launch["secrets"] or {})
        for key in ("BUZZ_PRIVATE_KEY", "NOSTR_PRIVATE_KEY"):
            value = effective_env.pop(key, None)
            if value is None:
                continue
            existing = effective_secrets.get(key)
            if existing is not None and existing != value:
                raise ValueError(f"{key} conflicts between env and secrets")
            effective_secrets[key] = value
        launch["sync_include"], launch["sync_exclude"] = _resolve_coding_agent_sync_policy(
            runtime,
            sync_include=launch["sync_include"],
            sync_exclude=launch["sync_exclude"],
        )
        launch["env"] = effective_env
        launch["secrets"] = effective_secrets
        launch["routes"] = {} if launch["routes"] is None else launch["routes"]
        launch["command"] = (
            list(launch["command"])
            if launch["command"] is not None
            else ["/usr/local/bin/hyper-acp"]
        )
        launch["image"] = launch["image"] or DEFAULT_CODING_AGENT_IMAGES[runtime]
        if launch["sync_root"] is None:
            launch["sync_root"] = DEFAULT_CODING_AGENT_SYNC_ROOT
        if launch["sync_uid"] is None:
            launch["sync_uid"] = 1000
        if launch["sync_gid"] is None:
            launch["sync_gid"] = 1000
        if launch["runtime_scopes"] is None:
            launch["runtime_scopes"] = list(DEFAULT_AGENT_RUNTIME_SCOPES)
        agent = self.create(runtime=runtime, **launch)
        if agent.runtime != runtime:
            raise TypeError(f"Deployment response did not identify runtime {runtime!r}")
        return agent

    def create_coding_agent(self, runtime: CodingAgentRuntime, **options: Any) -> Agent:
        """Create an ACP-fronted coding agent. All coding runtimes share one
        launch contract; ``runtime`` selects the default image, sync includes,
        and harness env (``pi`` gets ``HYPER_RUNTIME_HOME``), nothing else.

        .. deprecated:: use :meth:`create_agent` with the runtime label; the
            folded entry takes the same options.
        """
        warnings.warn(
            "create_coding_agent() is deprecated: use create_agent(runtime, **options).",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.create_agent(runtime, **options)


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

        The relay verifies the caller's Slack install and persists the
        optional channel/user allowlist in the agent's stored launch config;
        the enable toggle lives in ``meta.integrations.slack.enabled``.
        Nothing pod-side reads them: the relay enforces the scope and submits
        turns through the Backend ACP proxy, so a running agent needs no
        restart.
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
        result = resp.json()
        if isinstance(result, dict):
            result.pop("config", None)
        return result

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
                if not isinstance(token_data, dict) or set(token_data) != {"token", "ws_url"}:
                    raise RuntimeError("Deployment event token response is incomplete")
                ws_url = str(token_data.get("ws_url") or "").strip()
                token = str(token_data.get("token") or "").strip()
                if not ws_url or not token:
                    raise RuntimeError("Deployment event token response is incomplete")
                parsed = urlsplit(ws_url)
                if parsed.scheme not in {"ws", "wss"} or not parsed.hostname or parsed.query or parsed.fragment:
                    raise RuntimeError("Deployment event token response is incomplete")
                query = urlencode({"token": token})
                authed_ws_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, ""))
                async with websockets.connect(
                    authed_ws_url, ping_interval=20, ping_timeout=20
                ) as websocket:
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
            except RuntimeError as exc:
                if str(exc) == "Deployment event token response is incomplete":
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
        ``unified_agents`` module pops both). Updating a complete launch config
        is a *full replacement* and demands every key in
        ``REQUIRED_START_LAUNCH_CONFIG_KEYS``. Without this step the obvious
        round-trip can never succeed, because the read side is structurally
        incapable of returning what the write side requires::

            agent = client.deployments.get(agent_id)
            client.deployments.update(agent_id, launch_config=agent.launch_config)
            # ValueError: launch_config is incomplete; missing:
            #             registry_auth, secrets

        The fix is to complete the object honestly before update, never to weaken the
        completeness contract -- the persisted launch_config update remains a
        replacement, not a merge.

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
                    "pass registry_auth explicitly before updating launch_config"
                )
            prepared["registry_auth"] = {}
        return prepared

    def stored_launch_config(
        self,
        agent_id: str,
    ) -> dict:
        """Return the server-stored launch configuration, rehydrated for update.

        Reads the owner-facing Agent projection and rehydrates the two keys
        the projection redacts (secrets, registry_auth). Unlike the CLI's
        protected local cache, this reflects every mutation other clients
        made since the last local save (routes API, Desktop toggle, Claw
        settings), so a no-override relaunch cannot clobber them.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        agent = self._get_by_id(resolved_agent_id)
        launch_config = agent.launch_config
        if not isinstance(launch_config, dict):
            raise ValueError(
                f"Agent {resolved_agent_id} has no stored launch configuration"
            )
        return self._rehydrate_redacted_launch_config(
            resolved_agent_id, copy.deepcopy(launch_config)
        )

    def start(
        self,
        agent_id: str,
        *,
        dry_run: bool = False,
    ) -> Agent:
        """Start the server-stored launch configuration."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        body: dict[str, Any] = {}
        if dry_run:
            body["dry_run"] = True
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}/start"
        data = self._post(path, json=body) if body else self._post(path)
        return self._hydrate_agent(data)


    def update(
        self,
        agent_id: str,
        *,
        name: str | None = None,
        size: str | None = None,
        launch_config: dict | None = None,
        handle: str | None = None,
        runtime: ManagedAgentRuntime | None = None,
        reset_image: bool | None = None,
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
        if runtime is not None:
            body["runtime"] = runtime
        if reset_image is not None:
            body["reset_image"] = bool(reset_image)
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._patch(f"{AGENTS_API_PREFIX}/{resolved_agent_id}", json=body)
        return self._hydrate_agent(data)

    def resize(
        self,
        agent_id: str,
        *,
        size: str | None = None,
    ) -> Agent:
        return self.update(agent_id, size=size)

    def stop(self, agent_id: str, *, dry_run: bool = False) -> Agent:
        """Stop an agent (tears down pod, keeps DB record).

        Args:
            agent_id: Agent UUID.
            dry_run: When True, returns the current agent dict with no mutation.

        Returns:
            Agent in ``stopping`` state while runtime cleanup is in progress.
            Use ``wait_for_state(agent_id, {"stopped"})`` to wait through the
            deployment event stream before treating the slot as released.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}/stop"
        data = self._post(path, json={"dry_run": True}) if dry_run else self._post(path)
        return self._hydrate_agent(data)

    def archive(self, agent_id: str, *, dry_run: bool = False) -> Agent:
        """Archive durable storage for a stopped agent without launching it.

        When ``dry_run`` is True, returns the current agent dict with no
        mutation.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}/archive"
        data = self._post(path, json={"dry_run": True}) if dry_run else self._post(path)
        return self._hydrate_agent(data)

    def restore(self, agent_id: str, *, dry_run: bool = False) -> Agent:
        """Restore durable storage for a stopped or archived agent.

        When ``dry_run`` is True, returns the current agent dict with no
        mutation.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}/restore"
        data = self._post(path, json={"dry_run": True}) if dry_run else self._post(path)
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
        *,
        cors: AgentCorsConfig | dict | None | object = _UNSET,
    ) -> AgentRoutes:
        """Atomically replace the complete declarative route map."""
        resolved_agent_id = self._routes_target(agent_id)
        body: dict[str, Any] = {
            "routes": {str(name): _route_config_body(config) for name, config in routes.items()},
        }
        if cors is not _UNSET:
            body["cors"] = None if cors is None else dict(cors)
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
        body = _route_config_body(route)
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

    def delete(self, agent_id: str, *, dry_run: bool = False) -> dict:
        """Accept a durable soft delete and background local cleanup.

        Args:
            agent_id: Agent UUID.
            dry_run: When True, returns the current agent dict with no mutation.

        Returns:
            The Backend's HTTP 200 accepted projection. Runtime storage cleanup
            continues in the background; the response is not proof of cleanup.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        path = f"{AGENTS_API_PREFIX}/{resolved_agent_id}"
        if dry_run:
            return self._delete(path, json={"dry_run": True})
        return self._delete(path)

    def refresh_token(self, agent_id: str) -> dict:
        """Refresh the access token for an agent.

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

    def delete_profile_image(self, agent_id: str) -> dict:
        """Remove an agent's avatar/profile image through the deployments API."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._delete(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/profile-image")

    def get_account_profile_image(self) -> dict:
        """Return the authenticated account's profile image projection."""
        return self._get("/users/profile-image")

    def upload_account_profile_image(
        self,
        content: bytes | bytearray | memoryview | str | Path,
        *,
        content_type: str | None = None,
    ) -> dict:
        """Upload the authenticated account's profile image."""
        guessed_content_type = content_type
        if isinstance(content, (str, Path)):
            path = Path(content)
            payload = path.read_bytes()
            guessed_content_type = guessed_content_type or mimetypes.guess_type(path.name)[0]
        else:
            payload = bytes(content)

        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.post(
                f"{self._api_base}/users/profile-image",
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

    def delete_account_profile_image(self) -> dict:
        """Remove the authenticated account's profile image."""
        return self._delete("/users/profile-image")

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


    @property
    def acp_ws_url(self) -> str:
        """Client-facing ACP session proxy URL derived from the agents WS tunnel URL."""
        return agents_acp_proxy_ws_url(self._agents_ws_url)

    def list_sessions(
        self, *, agent_id: str | None = None, cursor: str | None = None, limit: int = 50,
    ) -> SessionPage:
        """Caller-scoped REST catalog, including nullable creation source.

        Feed next_cursor back unchanged. Service-key auth is not a user reader;
        this endpoint requires the existing user/runtime-key read scope.
        """
        params: dict[str, Any] = {"limit": limit}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if cursor is not None:
            params["cursor"] = cursor
        return SessionPage.from_dict(self._get("/sessions", params=params))

    def acp_ws_token(self, agent_id: str) -> dict:
        """Mint a very short-lived (~60s), agent-scoped ticket for the ACP session
        proxy (``/ws/acp``). Pass the returned ``token`` as the ``token`` query
        param on the dial instead of a raw account credential.

        Call shape mirrors ts-sdk ``Deployments.mintAcpWsToken`` but posts
        through the service-key admin surface — this credential path exists
        for backend consumers (the routines executor) holding the backend key.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(
                f"{_agents_admin_base(self._api_base)}/agents/{resolved_agent_id}/acp-ws-token",
                headers={**self._headers, "X-BACKEND-API-KEY": self._api_key},
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:  # noqa: BLE001 - match _post's detail fallback
                detail = resp.text
            raise APIError(resp.status_code, detail)
        data = resp.json()
        if (
            not isinstance(data, dict)
            or set(data) != {"token", "expires_at"}
            or not isinstance(data.get("token"), str)
            or not data["token"]
            or not isinstance(data.get("expires_at"), str)
            or not data["expires_at"]
        ):
            raise ValueError("Backend returned an invalid Agent ACP WS token response")
        return data

    def redeem_grant_code(self, code: str, *, extend_existing: bool | None = None) -> dict:
        """Redeem a promo/activation grant code via POST /billing/grants/redeem.

        Returns the applied grant plus the resulting entitlement. Codes create
        new entitlements by default; pass ``extend_existing=True`` only for
        renewal/extension behavior.
        """
        payload: dict[str, Any] = {"code": str(code)}
        if extend_existing is not None:
            payload["extend_existing"] = bool(extend_existing)
        return self._post("/billing/grants/redeem", json=payload)

    def logs_token(self, agent_id: str) -> dict:
        """Mint a short-lived token for backend log streaming."""
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
        """List one directory level through the backend-discovered file transport."""
        agent_id = self._agent_id_for_target(pod)
        resolved_path = resolve_sync_root_file_path(path)
        access = self._file_access(agent_id)
        if access == "runner":
            payload = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/list", json={
                # The empty path names the assignment root itself.
                "path": _native_file_path(resolved_path) if resolved_path else "",
            })
        else:
            reef_url, token = access
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
        """Read a root-relative file through the backend-selected transport."""
        agent_id = self._agent_id_for_target(pod)
        resolved_path = resolve_sync_root_file_path(path)
        if not resolved_path:
            raise ValueError("agent file path is required")
        access = self._file_access(agent_id)
        if access == "runner":
            payload = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/read", json={
                "path": _native_file_path(resolved_path), "max_bytes": RUNNER_FILE_MAX_BYTES,
            })
            encoded = payload.get("content_base64") if isinstance(payload, dict) else None
            if not isinstance(encoded, str) or len(encoded) > 4 * ((RUNNER_FILE_MAX_BYTES + 2) // 3):
                raise ValueError("Invalid runner file response")
            try:
                content_bytes = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                raise ValueError("Invalid runner file response") from None
            if len(content_bytes) > RUNNER_FILE_MAX_BYTES:
                raise ValueError("Invalid runner file response")
            return {"content": content_bytes, "mime_type": None}
        reef_url, token = access
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
        return {"content": content_bytes, "mime_type": content_type or None}

    def file_read_bytes(self, pod: Agent | str, path: str) -> bytes:
        """Read exact bytes through the backend-selected retained-storage transport."""
        return self.file_read_bytes_with_metadata(pod, path).get("content", b"")

    def file_read(self, pod: Agent | str, path: str) -> str:
        """Read a UTF-8 text file from an agent."""
        return self.file_read_bytes(pod, path).decode(errors="replace")

    def file_write_bytes(self, pod: Agent | str, path: str, content: bytes) -> dict:
        """Write bytes to a root-relative path through the discovered transport.

        Per-file writes are limited to 100 MiB (``AGENT_FILE_WRITE_MAX_BYTES``,
        the Cloudflare edge request-body cap on the agent hostname). Larger
        data should be split across files or synced via the agent's own
        tooling. Native runner writes are limited to 256 KiB.
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
        access = self._file_access(agent_id)
        if access == "runner":
            if len(content) > RUNNER_FILE_MAX_BYTES:
                raise ValueError(f"Runner files are limited to {RUNNER_FILE_MAX_BYTES} bytes")
            # _post performs exactly one HTTP attempt; an uncertain write is never replayed.
            receipt = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/write", json={
                "path": _native_file_path(path), "content_base64": base64.b64encode(content).decode("ascii"),
            })
            if not isinstance(receipt, dict) or receipt.get("ok") is not True:
                raise ValueError("Invalid runner file receipt")
            return receipt
        reef_url, token = access
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
        """Delete a sync-root-relative file or directory.

        Hosted agents delete directly through their retained Reef server;
        native runner assignments delete regular files through the backend.
        """
        path = normalize_writable_backend_file_path(path)
        if not path:
            raise ValueError("agent file path is required")
        agent_id = self._agent_id_for_target(pod)
        access = self._file_access(agent_id)
        if access == "runner":
            if recursive:
                raise ValueError("Runner file deletion is never recursive")
            # _post performs exactly one HTTP attempt; an uncertain delete is never replayed.
            payload = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/files/delete", json={
                "path": _native_file_path(path),
            })
            if not isinstance(payload, dict) or payload.get("status") != "deleted" or payload.get("path") != path:
                raise ValueError("Invalid runner file receipt")
            return payload
        reef_url, token = access
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

        # Get stream token
        resolved_agent_id = self.resolve_agent_id(agent_id)
        token_data = self.logs_token(resolved_agent_id)
        if not isinstance(token_data, dict):
            raise ValueError("Backend returned an invalid Agent logs token response")
        token = token_data.get("token")
        if set(token_data) != {"agent_id", "token", "expires_at", "ws_url"} or not isinstance(token, str) or not token:
            raise ValueError("Backend returned an invalid Agent logs token response")

        url = (
            f"{self._agents_ws_url}/logs/{resolved_agent_id}"
            f"?token={quote(token, safe='')}"
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
        ws_url, token, resolved_shell = _validate_agent_ws_token(
            token_data,
            agent_id=resolved_agent_id,
            purpose="shell",
            shell=selected_shell,
        )
        separator = "&" if "?" in ws_url else "?"
        url = (
            f"{ws_url}{separator}token={quote(token, safe='')}"
            f"&shell={quote(resolved_shell, safe='')}"
        )

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
