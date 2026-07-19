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
import json
import os
import re
import secrets
import time
from typing import TYPE_CHECKING, Callable, Literal, Optional, Any, AsyncIterator
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from contextlib import asynccontextmanager
from uuid import UUID

import httpx

from .config import get_agents_api_base_url, get_config_value
from .http import HTTPClient, APIError

if TYPE_CHECKING:
    from .openclaw.gateway import ChatEvent, GatewayClient


AGENTS_API_BASE = "https://api.hypercli.com/agents"
AGENTS_API_PREFIX = "/deployments"
AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_API_BASE = "https://api.dev.hypercli.com/agents"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"
DEFAULT_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:prod"
DEFAULT_OPENCLAW_PRO_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-prod"
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
    "HYPER_WORKSPACES_DIR": "/home/node/workspaces",
    "HYPER_WORKSPACES_SYNC_READY_ONLY": "1",
}
LAUNCH_CONFIG_KEYS = frozenset({"image", "env", "routes", "ports", "command", "entrypoint", "sync_root", "sync_enabled", "sync_uid", "sync_gid", "registry_url", "registry_auth"})
DEFAULT_OPENCLAW_SYNC_ROOT = "/home/node"
AGENT_FILE_MAX_BYTES = 50 * 1024 * 1024
AGENT_FILE_TRANSFER_CHUNK_BYTES = 64 * 1024
AGENT_FILE_OPERATION_TIMEOUT_SECONDS = 300

# The three file-access paths for an OpenClaw agent, each with its own root —
# the SDK owns the roots so a workspace-relative path (e.g. "AGENTS.md") hits the
# same file on all three:
# - `agent`  — the files API on the agent's live pod filesystem. Full access: a
#              workspace-relative path resolves under the workspace, and an
#              absolute `/…` path reaches anywhere on the pod. (wire `source=pod`)
# - `backup` — the S3 backup of the sync root (`/home/node`); served when the pod
#              is stopped. Scoped to the sync root. (wire `source=s3`)
# - `gateway`— the operator-WebSocket `agents.files.*` RPC; scoped to the
#              `.openclaw/workspace` (name-addressed; no delete). Works on any
#              gateway, self-hosted included.
# - `auto`   — backend default: the agent while running, else the backup.
#
# `pod`/`s3` are accepted as deprecated aliases of `agent`/`backup`.
AgentFileSource = Literal["auto", "agent", "backup", "gateway", "pod", "s3"]

# Deprecated alias of AgentFileSource; gateway is a base capability now.
OpenClawFileSource = AgentFileSource

# The backend (non-gateway) file sources — the deployment HTTP files store.
AgentFileBackendSource = Literal["auto", "agent", "backup", "pod", "s3"]

# The value the deployment HTTP API accepts on the wire (`source`/`destination`).
AgentFileWireSource = Literal["auto", "pod", "s3"]

# The agent's sync root and workspace, owned by the SDK so paths are unambiguous.
OPENCLAW_SYNC_ROOT = "/home/node"
OPENCLAW_WORKSPACE_PREFIX = ".openclaw/workspace"

_GATEWAY_FILE_SOURCES = frozenset({"gateway"})
_FULL_FS_FILE_SOURCES = frozenset({"agent", "pod"})


def to_wire_file_source(source: str) -> str:
    """Map the friendly `agent`/`backup` names to their wire `pod`/`s3` values."""
    if source == "agent":
        return "pod"
    if source == "backup":
        return "s3"
    return source  # 'auto' | 'pod' | 's3'


def strip_rel_prefix(path: str) -> str:
    """Strip leading `./` segments and slashes without eating a dotfile's dot."""
    return re.sub(r"^/+", "", re.sub(r"^(?:\./)+", "", path))


def resolve_backend_file_path(path: str, source: str) -> str:
    """
    Resolve a caller path to the deployment HTTP files path (sync-root relative).
    Workspace-relative by default (prefixed with the workspace); an absolute `/…`
    path is full-fs and only valid for the `agent` source.
    """
    if path.startswith("/"):
        if source not in _FULL_FS_FILE_SOURCES:
            scope = "the sync root" if source in {"backup", "s3"} else "the workspace"
            raise ValueError(
                "absolute paths need the 'agent' source (full pod filesystem); "
                f"'{source}' is scoped to {scope}."
            )
        return path  # full-fs path, passed through to source=pod
    rel = strip_rel_prefix(path)
    return f"{OPENCLAW_WORKSPACE_PREFIX}/{rel}" if rel else OPENCLAW_WORKSPACE_PREFIX


def resolve_gateway_file_name(path: str) -> str:
    """Strip a workspace prefix so gateway (name-addressed) sees the bare name."""
    if path.startswith("/"):
        raise ValueError(
            "absolute paths are not valid for the 'gateway' source (scoped to the workspace)."
        )
    rel = strip_rel_prefix(path)
    prefix = f"{OPENCLAW_WORKSPACE_PREFIX}/"
    return rel[len(prefix):] if rel.startswith(prefix) else rel


def _coerce_utf8_text(content: bytes | str) -> str:
    """Coerce write content to text for the gateway (text-only) file source."""
    if isinstance(content, str):
        return content
    return bytes(content).decode("utf-8")


@dataclass
class AgentFilesGatewayHooks:
    """Hooks an OpenClaw agent provides so AgentFiles can reach its gateway.

    `with_gateway` runs an async op inside a connected gateway session (the sync
    `_with_gateway` seam: opens `connect()`, runs the op, closes); `resolve_agent_id`
    is the async resolver for the in-gateway agent id.
    """
    with_gateway: Callable[[Callable[[Any], Any]], Any]
    resolve_agent_id: Callable[[Any], Any]


class AgentFiles:
    """
    ONE client wrapping all three agent file-access paths behind a single `source`
    switch (`agent` | `backup` | `gateway`, plus `auto`). The SDK owns the roots,
    so a workspace-relative path is the same file on every source; `agent` also
    takes absolute `/…` paths for full-fs access. The underlying APIs are left
    as-is — this only wraps them.
    """

    def __init__(
        self,
        agent: "Agent",
        deployments: "Deployments",
        gateway_hooks: AgentFilesGatewayHooks | None = None,
    ):
        self._agent = agent
        self._deployments = deployments
        self._gateway_hooks = gateway_hooks

    def _require_gateway(self) -> AgentFilesGatewayHooks:
        if self._gateway_hooks is None:
            raise ValueError(
                "gateway file source requires an OpenClaw agent with a gateway URL/token."
            )
        return self._gateway_hooks

    def list(self, path: str = "", source: str = "auto") -> list[dict]:
        if source not in _GATEWAY_FILE_SOURCES:
            return self._deployments.files_list(
                self._agent,
                resolve_backend_file_path(path, source),
                source=to_wire_file_source(source),
            )
        gw = self._require_gateway()
        name = resolve_gateway_file_name(path)

        async def _op(c):
            return await c.files_list(await gw.resolve_agent_id(c))

        files = gw.with_gateway(_op) or []
        prefix = name if name.endswith("/") else f"{name}/"
        return [
            entry
            for entry in (
                {"name": f.get("name"), "path": f.get("name"), "type": "file", "size": f.get("size")}
                for f in files
            )
            if not name or entry["name"] == name or str(entry["name"]).startswith(prefix)
        ]

    def read_bytes(self, path: str, source: str = "auto") -> bytes:
        if source not in _GATEWAY_FILE_SOURCES:
            return self._deployments.file_read_bytes(
                self._agent,
                resolve_backend_file_path(path, source),
                source=to_wire_file_source(source),
            )
        return self.read(path, source).encode("utf-8")

    def read(self, path: str, source: str = "auto") -> str:
        if source not in _GATEWAY_FILE_SOURCES:
            return self._deployments.file_read(
                self._agent,
                resolve_backend_file_path(path, source),
                source=to_wire_file_source(source),
            )
        gw = self._require_gateway()
        name = resolve_gateway_file_name(path)

        async def _op(c):
            return await c.file_get(await gw.resolve_agent_id(c), name)

        return gw.with_gateway(_op)

    def write_bytes(self, path: str, content: bytes, source: str = "auto") -> dict:
        if source not in _GATEWAY_FILE_SOURCES:
            return self._deployments.file_write_bytes(
                self._agent,
                resolve_backend_file_path(path, source),
                content,
                destination=to_wire_file_source(source),
            )
        return self.write(path, _coerce_utf8_text(content), source)

    def write(self, path: str, content: str, source: str = "auto") -> dict:
        if source not in _GATEWAY_FILE_SOURCES:
            return self._deployments.file_write(
                self._agent,
                resolve_backend_file_path(path, source),
                content,
                destination=to_wire_file_source(source),
            )
        gw = self._require_gateway()
        name = resolve_gateway_file_name(path)

        async def _op(c):
            aid = await gw.resolve_agent_id(c)
            await c.file_set(aid, name, content)
            return aid

        agent_id = gw.with_gateway(_op)
        return {"name": name, "source": "gateway", "agentId": agent_id}

    def delete(self, path: str, recursive: bool = False, source: str = "auto") -> dict:
        if source in _GATEWAY_FILE_SOURCES:
            raise ValueError(
                "delete is not supported over the gateway file source; use the agent/backup source."
            )
        return self._deployments.file_delete(
            self._agent, resolve_backend_file_path(path, source), recursive
        )


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
        env["OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START"] = _env_bool(memory_index["on_session_start"])
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


def build_openclaw_workspaces_sync_env(workspaces_sync: dict | bool | None = None) -> dict[str, str]:
    """Build OpenClaw Workspaces boot-sync environment variables.

    Workspaces sync defaults on for OpenClaw launch helpers, but callers can
    pass False or {"enabled": False} to disable it, or override the output
    directory, ready-only behavior, and single-workspace target.
    """
    if workspaces_sync is False:
        return {"HYPER_WORKSPACES_BOOT_SYNC": "0"}
    options = {} if workspaces_sync is None or workspaces_sync is True else dict(workspaces_sync or {})
    if options.get("enabled") is False:
        return {"HYPER_WORKSPACES_BOOT_SYNC": "0"}
    env = dict(OPENCLAW_WORKSPACES_ENV_DEFAULTS)
    if options.get("enabled") is not None:
        env["HYPER_WORKSPACES_BOOT_SYNC"] = _env_bool(options["enabled"])
    output_dir = options.get("output_dir") or options.get("dir")
    if output_dir is not None:
        env["HYPER_WORKSPACES_DIR"] = str(output_dir)
    if options.get("ready_only") is not None:
        env["HYPER_WORKSPACES_SYNC_READY_ONLY"] = _env_bool(options["ready_only"])
    workspace = options.get("workspace") or options.get("workspace_ref")
    if workspace:
        env["HYPER_WORKSPACES_SYNC_WORKSPACE"] = str(workspace)
    return env


def _default_gateway_timeout() -> float | None:
    raw = (
        os.environ.get("HYPERCLI_GATEWAY_TIMEOUT")
        or os.environ.get("AGENT_GATEWAY_TIMEOUT")
        or ""
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
        return f"wss://{base[len('https://'):]}"
    if base.startswith("http://"):
        return f"ws://{base[len('http://'):]}"
    return base


def _normalize_agents_ws_url(url: str) -> str:
    base = _to_ws_base_url(url)
    if not base:
        return ""
    return base if base.endswith("/ws") else f"{base}/ws"


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


def _build_agent_launch(
    config: dict | None = None,
    *,
    env: dict | None = None,
    ports: list | None = None,
    routes: dict | None = None,
    command: list[str] | None = None,
    entrypoint: list[str] | None = None,
    image: str | None = None,
    sync_root: str | None = None,
    sync_enabled: bool | None = None,
    sync_uid: int | None = None,
    sync_gid: int | None = None,
    registry_url: str | None = None,
    registry_auth: dict | None = None,
    gateway_token: str | None = None,
    heartbeat: dict | None = None,
) -> tuple[dict, str]:
    prepared_config = copy.deepcopy(config or {})
    nested_launch_keys = sorted(LAUNCH_CONFIG_KEYS.intersection(prepared_config.keys()))
    if nested_launch_keys:
        raise ValueError(
            "Launch settings must be top-level fields, not nested under config: "
            + ", ".join(nested_launch_keys)
        )
    if heartbeat:
        agents_cfg = dict(prepared_config.get("agents") or {})
        defaults_cfg = dict(agents_cfg.get("defaults") or {})
        heartbeat_cfg = dict(defaults_cfg.get("heartbeat") or {})
        heartbeat_cfg.update(dict(heartbeat))
        defaults_cfg["heartbeat"] = heartbeat_cfg
        agents_cfg["defaults"] = defaults_cfg
        prepared_config["agents"] = agents_cfg
    env_map = dict(env or {})
    if env:
        env_map.update(env)

    effective_gateway_token = gateway_token or str(env_map.get("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    if not effective_gateway_token:
        effective_gateway_token = secrets.token_hex(32)
    env_map["OPENCLAW_GATEWAY_TOKEN"] = effective_gateway_token

    launch: dict[str, Any] = {}
    if prepared_config:
        launch["config"] = prepared_config
    if env_map:
        launch["env"] = env_map
    if ports is not None:
        launch["ports"] = ports
    if routes is not None:
        launch["routes"] = routes
    if command is not None:
        launch["command"] = command
    if entrypoint is not None:
        launch["entrypoint"] = entrypoint
    if image is not None:
        launch["image"] = image
    if sync_root is not None:
        launch["sync_root"] = sync_root
    if sync_enabled is not None:
        launch["sync_enabled"] = sync_enabled
    if sync_uid is not None:
        launch["sync_uid"] = int(sync_uid)
    if sync_gid is not None:
        launch["sync_gid"] = int(sync_gid)
    if registry_url is not None:
        launch["registry_url"] = registry_url
    if registry_auth is not None:
        launch["registry_auth"] = registry_auth

    return launch, effective_gateway_token


def _default_openclaw_image(image: str | None) -> str | None:
    if image is not None:
        return image
    return DEFAULT_OPENCLAW_IMAGE


def _default_openclaw_pro_image(image: str | None) -> str | None:
    if image is not None:
        return image
    return DEFAULT_OPENCLAW_PRO_IMAGE


def _product_api_base_from_agents_api_base(api_base: str) -> str:
    normalized = _normalize_agents_api_base(api_base).rstrip("/")
    suffix = "/agents"
    return normalized[: -len(suffix)] if normalized.endswith(suffix) else normalized


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


def get_launch_config_value(launch_config: object, path: str | list[str | int] | tuple[str | int, ...]) -> Any:
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
    return any(isinstance(route, dict) and route.get("prefix") == "desktop" for route in routes.values())


def ports_have_desktop(ports: object) -> bool:
    if not isinstance(ports, list):
        return False
    for port in ports:
        if not isinstance(port, dict):
            continue
        try:
            if int(port.get("port") or 0) == 3000:
                return True
        except (TypeError, ValueError):
            continue
    return False


def launch_config_has_desktop(launch_config: object) -> bool:
    if not isinstance(launch_config, dict):
        return False
    if _truthy_env(get_launch_config_value(launch_config, "env.OPENCLAW_DESKTOP_ENABLED")):
        return True
    if routes_have_desktop(get_launch_config_value(launch_config, "routes")):
        return True
    return ports_have_desktop(get_launch_config_value(launch_config, "ports"))


def agent_config_has_desktop(source: object) -> bool:
    if not isinstance(source, dict):
        return False
    return (
        launch_config_has_desktop(source.get("launch_config") or source.get("launchConfig"))
        or routes_have_desktop(source.get("routes"))
        or ports_have_desktop(source.get("ports"))
    )


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
    query_items = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "resize"]
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
    is_launchable = data.get("is_launchable")
    if is_launchable is None:
        is_launchable = data.get("managed", True) is not False
    return {
        "id": data.get("id", ""),
        "user_id": data.get("user_id", ""),
        "pod_id": data.get("pod_id", ""),
        "pod_name": data.get("pod_name", ""),
        "state": data.get("state", "unknown"),
        "name": data.get("name"),
        "handle": data.get("handle"),
        "display_name": data.get("display_name") or data.get("name"),
        "avatar_url": data.get("avatar_url"),
        "display_identity": copy.deepcopy(data.get("display_identity")) if isinstance(data.get("display_identity"), dict) else None,
        "runtime": data.get("runtime"),
        "is_launchable": bool(is_launchable),
        "gateway_id": data.get("gateway_id"),
        "runtime_key_alias": data.get("runtime_key_alias"),
        "relay_key": data.get("relay_key") if isinstance(data.get("relay_key"), dict) else None,
        "cpu": data.get("cpu", 0),
        "memory": data.get("memory", 0),
        "hostname": data.get("hostname"),
        "tags": list(data.get("tags") or []),
        "jwt_token": data.get("jwt_token"),
        "jwt_expires_at": _parse_dt(data.get("jwt_expires_at")),
        "started_at": _parse_dt(data.get("started_at")),
        "stopped_at": _parse_dt(data.get("stopped_at")),
        "last_error": data.get("last_error"),
        "created_at": _parse_dt(data.get("created_at")),
        "updated_at": _parse_dt(data.get("updated_at")),
        "launch_config": data.get("launch_config"),
        "meta_ui": copy.deepcopy(meta.get("ui")) if isinstance(meta.get("ui"), dict) else None,
        "routes": data.get("routes") or {},
        "command": data.get("command") or [],
        "entrypoint": data.get("entrypoint") or [],
        "ports": data.get("ports") or [],
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


def _is_openclaw_pro_agent_data(data: dict) -> bool:
    launch_config = data.get("launch_config")
    if not isinstance(launch_config, dict):
        return False
    if launch_config_has_desktop(launch_config):
        return True
    image = str(launch_config.get("image") or "")
    return "hypercli-openclaw:pro" in image or image.endswith("-pro")


@dataclass
class Agent:
    """Generic agent returned by the HyperClaw backend."""
    id: str  # Agent UUID from backend
    user_id: str
    pod_id: str
    pod_name: str
    state: str
    name: Optional[str] = None
    handle: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    display_identity: Optional[dict] = None
    runtime: Optional[str] = None
    is_launchable: bool = True
    gateway_id: Optional[str] = None
    runtime_key_alias: Optional[str] = None
    relay_key: Optional[dict] = None
    cpu: int = 0              # cores
    memory: int = 0           # GB
    hostname: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    jwt_token: Optional[str] = None
    jwt_expires_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    launch_config: Optional[dict] = None
    meta_ui: Optional[dict] = None
    routes: dict[str, dict] = field(default_factory=dict)
    command: list[str] = field(default_factory=list)
    entrypoint: list[str] = field(default_factory=list)
    ports: list[dict] = field(default_factory=list)
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
    def executor_url(self) -> Optional[str]:
        return self.shell_url

    @property
    def is_running(self) -> bool:
        return self.state == "running"

    @property
    def has_desktop(self) -> bool:
        return agent_config_has_desktop(
            {
                "launch_config": self.launch_config,
                "routes": self.routes,
                "ports": self.ports,
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

    def wait_running(self, timeout: float = 300.0, poll_interval: float = 5.0) -> "Agent":
        agent = self._require_deployments().wait_running(self.id, timeout=timeout, poll_interval=poll_interval)
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
        last_error: str | None = None,
        handle: str | None = None,
    ) -> "Agent":
        agent = self._require_deployments().update(
            self.id,
            name=name,
            size=size,
            launch_config=launch_config,
            refresh_from_lagoon=refresh_from_lagoon,
            last_error=last_error,
            handle=handle,
        )
        self.__dict__.update(agent.__dict__)
        self._deployments = agent._deployments
        return self

    def resize(self, *, size: str | None = None) -> "Agent":
        return self.update(size=size)

    def env(self) -> dict[str, str]:
        """Fetch runtime environment from the pod's K8s secret."""
        data = self._require_deployments().env(self.id)
        return data.get("env", {})

    def exec(self, command: str, timeout: int = 30, dry_run: bool = False) -> "ExecResult":
        return self._require_deployments().exec(self, command, timeout=timeout, dry_run=dry_run)

    def health(self) -> dict:
        return self._require_deployments().health(self)

    def _gateway_file_hooks(self) -> AgentFilesGatewayHooks | None:
        """
        The gateway hooks a subclass supplies — the seam that enables the
        `gateway` source. The base agent has none (gateway calls raise); an agent
        type that speaks a gateway file protocol (e.g. OpenClaw's `agents.files.*`)
        overrides this. Kept on the base so the *calling* is standardized through
        the superclass even though each agent's gateway differs.
        """
        return None

    @property
    def files(self) -> AgentFiles:
        """
        The single file client for this agent — one `source` switch (`agent` |
        `backup` | `gateway`) routes to the three underlying APIs (pod sidecar / S3
        backup / gateway), with the SDK owning the roots. One implementation; a
        subclass only supplies its gateway via `_gateway_file_hooks`.
        """
        return AgentFiles(self, self._require_deployments(), self._gateway_file_hooks())

    def files_list(self, path: str = "", source: AgentFileSource = "auto") -> list[dict]:
        return self.files.list(path, source)

    def file_read_bytes(self, path: str, source: AgentFileSource = "auto") -> bytes:
        return self.files.read_bytes(path, source)

    def file_read(self, path: str, source: AgentFileSource = "auto") -> str:
        return self.files.read(path, source)

    def file_write_bytes(self, path: str, content: bytes, destination: AgentFileSource = "auto") -> dict:
        return self.files.write_bytes(path, content, destination)

    def file_write(self, path: str, content: str, destination: AgentFileSource = "auto") -> dict:
        return self.files.write(path, content, destination)

    def file_delete(self, path: str, recursive: bool = False, source: AgentFileSource = "auto") -> dict:
        return self.files.delete(path, recursive, source)

    def cp_to(self, local_path: str | Path, remote_path: str) -> dict:
        return self._require_deployments().cp_to(self, local_path, remote_path)

    def cp_from(self, remote_path: str, local_path: str | Path) -> Path:
        return self._require_deployments().cp_from(self, remote_path, local_path)

    def logs_stream(self, lines: int = 100, follow: bool = True):
        return self._require_deployments().logs_stream(self, lines=lines, follow=follow)

    async def logs_stream_ws(self, tail_lines: int = 100, container: str = "reef") -> AsyncIterator[str]:
        async for line in self._require_deployments().logs_stream_ws(self.id, tail_lines=tail_lines, container=container):
            yield line

    async def shell_connect(self, shell: str | None = None):
        return await self._require_deployments().shell_connect(self.id, shell=shell)


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
            gateway_token=data.get("gateway_token"),
        )

    @staticmethod
    def _gateway_url_from_hostname(hostname: str | None) -> str | None:
        value = str(hostname or "").strip()
        return f"wss://{value}" if value else None

    def _current_gateway_hostname(self) -> str | None:
        if self.hostname:
            return self.hostname
        if not self.gateway_url:
            return None
        raw = str(self.gateway_url).strip().replace("wss://", "").replace("ws://", "")
        return raw.split("/", 1)[0] or None

    def wait_for_gateway_context(self, timeout: float = 30.0, retry_interval: float = 1.0) -> dict[str, Any]:
        """
        Resolve gateway context through the deployment record plus `/env`.

        Agent startup is eventually consistent: the deployment record can lag
        behind hostname attachment, and runtime env can lag behind both. The
        SDK derives the gateway URL from the attached hostname and reads the
        gateway token from `OPENCLAW_GATEWAY_TOKEN` in the env route.
        """
        if self.gateway_token and self.gateway_url:
            return {
                "agent_id": self.id,
                "hostname": self._current_gateway_hostname(),
                "gateway_token": self.gateway_token,
            }
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while True:
            try:
                refreshed = self._require_deployments().get(self.id)
                hostname = getattr(refreshed, "hostname", None)
                gateway_url = self._gateway_url_from_hostname(hostname)
                env_data = self._require_deployments().env(self.id)
                gateway_token = (
                    (env_data.get("env") or {}).get("OPENCLAW_GATEWAY_TOKEN", "").strip()
                    if isinstance(env_data, dict)
                    else None
                )
                if gateway_token and gateway_url:
                    self.gateway_token = gateway_token
                    self.gateway_url = gateway_url
                    return {
                        "agent_id": self.id,
                        "hostname": hostname,
                        "gateway_token": gateway_token,
                    }
                last_error = RuntimeError("missing gateway context")
            except Exception as exc:
                last_error = exc
            if time.monotonic() >= deadline:
                if last_error is not None:
                    raise last_error
                raise RuntimeError("Timed out waiting for OpenClaw gateway context")
            time.sleep(retry_interval)

    def resolve_gateway_token(self) -> str | None:
        """Resolve the gateway token through the deployment env route."""
        token_data = self.wait_for_gateway_context()
        self.gateway_token = token_data.get("gateway_token")
        return self.gateway_token

    def gateway(self, **kwargs) -> "GatewayClient":
        """Create a GatewayClient for this OpenClaw agent."""
        from .gateway import GatewayClient
        if not self.gateway_url:
            self.wait_for_gateway_context()
        if not self.gateway_url:
            raise ValueError("Agent has no OpenClaw gateway URL")
        deployments = self._require_deployments()
        if "gateway_token" not in kwargs:
            if not self.gateway_token:
                self.wait_for_gateway_context()
            if self.gateway_token:
                kwargs["gateway_token"] = self.gateway_token
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
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise RuntimeError(
                "gateway file operations are synchronous and cannot run inside an "
                "active event loop; call them from sync code or use the async "
                "file_get/file_set/workspace_files helpers."
            )

        async def _invoke() -> Any:
            async with self.connect() as gw:
                return await op(gw)

        return asyncio.run(_invoke())

    # The in-gateway agent id for `agents.files.*` — NOT the deployment id. A
    # deployment's gateway hosts an agent named "main" (or a named agent);
    # matches the existing file_get/file_set/workspace_files convention.
    _gateway_agent_id: str | None = None

    async def _resolve_gateway_agent_id(self, gw: "GatewayClient") -> str:
        if self._gateway_agent_id:
            return self._gateway_agent_id
        try:
            agents = await gw.agents_list()
        except Exception:
            agents = []
        self._gateway_agent_id = agents[0]["id"] if agents else "main"
        return self._gateway_agent_id

    def _gateway_file_hooks(self) -> AgentFilesGatewayHooks:
        """
        Override the base gateway seam with OpenClaw's `agents.files.*` — the real
        OpenClaw gateway file methods. The base `files`/`file_*` calling surface is
        inherited unchanged; only the gateway hooks are supplied here. `with_gateway`
        is the sync `_with_gateway` seam (connect → op → close); `resolve_agent_id`
        resolves the in-gateway agent id (NOT the deployment id).
        """
        return AgentFilesGatewayHooks(
            with_gateway=self._with_gateway,
            resolve_agent_id=self._resolve_gateway_agent_id,
        )

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
        if not self.gateway_url or ("gateway_token" not in kwargs and not self.gateway_token):
            self.wait_for_gateway_context()
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
        auth_token_env: str = "HYPER_API_KEY",
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

    async def file_set(self, name: str, content: str, agent_id: str | None = None, **kwargs) -> dict:
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
        if session_key:
            params["sessionKey"] = session_key
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
            providers = ((config.setdefault("models", {})).setdefault("providers", {}))
            providers.pop(provider_id, None)

        config = await self._config_with_mutation(mutate)
        return ((config.get("models") or {}).get("providers") or {})

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
            providers = ((config.setdefault("models", {})).setdefault("providers", {}))
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
        models = ((((config.get("models") or {}).get("providers") or {}).get(provider_id) or {}).get("models") or [])
        return next((model for model in models if model.get("id") == model_id), {})

    async def model_remove(self, provider_id: str, model_id: str) -> list[dict]:
        def mutate(config: dict) -> None:
            providers = ((config.setdefault("models", {})).setdefault("providers", {}))
            provider = dict(providers.get(provider_id) or {})
            provider["models"] = [
                dict(model)
                for model in provider.get("models") or []
                if model.get("id") != model_id
            ]
            providers[provider_id] = provider

        config = await self._config_with_mutation(mutate)
        return ((((config.get("models") or {}).get("providers") or {}).get(provider_id) or {}).get("models") or [])

    async def set_default_model(self, provider_id: str, model_id: str) -> str:
        primary = f"{provider_id}/{model_id}"

        def mutate(config: dict) -> None:
            defaults = ((config.setdefault("agents", {})).setdefault("defaults", {}))
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
            defaults = ((config.setdefault("agents", {})).setdefault("defaults", {}))
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
        return (((config.get("agents") or {}).get("defaults") or {}).get("memorySearch") or {})

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
        channel = ((config.get("channels") or {}).get(channel_id) or {})
        if account_id:
            return ((channel.get("accounts") or {}).get(account_id) or {})
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
        result = client.deployments.exec(pod, "echo hello")

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
    ):
        self._http = http
        self._api_key = api_key or http.api_key
        self._api_base = _normalize_agents_api_base(api_base or get_agents_api_base_url()).rstrip("/")
        resolved_agents_ws_url = agents_ws_url or get_config_value("AGENTS_WS_URL")
        self._agents_ws_url = (
            _normalize_agents_ws_url(resolved_agents_ws_url)
            if resolved_agents_ws_url
            else _default_agents_ws_url(self._api_base)
        )

    def _hydrate_agent(self, data: dict) -> Agent:
        if _is_openclaw_pro_agent_data(data):
            agent = OpenClawProAgent.from_dict(data)
        elif _is_openclaw_agent_data(data):
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
        with httpx.Client(timeout=30) as client:
            resp = client.get(f"{self._api_base}{path}", headers=self._headers, params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _post(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{self._api_base}{path}", headers=self._headers, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _delete(self, path: str) -> Any:
        with httpx.Client(timeout=30) as client:
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
        """Resolve an agent UUID, unique name, pod name, or hostname to an Agent."""
        raw = str(agent_id_or_name or "").strip()
        if not raw:
            raise ValueError("agent_id_or_name is required")
        try:
            return self._get_by_id(str(UUID(raw)))
        except ValueError:
            pass

        matches: list[Agent] = []
        for agent in self.list():
            values = [agent.id, agent.name, agent.pod_name, agent.hostname]
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
        return raw

    def _file_headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _encode_file_path(self, path: str) -> str:
        return quote(path.lstrip("/"), safe="/")

    def _detect_shell(self, agent_id: str) -> str:
        probe = "if command -v bash >/dev/null 2>&1; then printf /bin/bash; else printf /bin/sh; fi"
        try:
            result = self.exec(Agent(id=agent_id, user_id="", pod_id="", pod_name="", state="running"), probe, timeout=15)
        except Exception:
            return "/bin/sh"
        shell = (result.stdout or "").strip()
        return shell if shell in {"/bin/bash", "/bin/sh"} else "/bin/sh"

    # -----------------------------------------------------------------------
    # Agent lifecycle (HyperClaw backend → Lagoon)
    # -----------------------------------------------------------------------

    def create(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        start: bool = True,
    ) -> Agent:
        """Create a new agent (provisions an agent pod via the backend).

        Args:
            name: Agent name.
            size: Size preset (small/medium/large). Default: medium.
            config: Optional config overrides.
            env: Optional environment variables to pass through to the pod.
            ports: Optional exposed ports config.
            start: Start the agent immediately (default: True).

        Returns:
            Agent with connection details.
        """
        launch_payload, effective_gateway_token = _build_agent_launch(
            config,
            env=env,
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=image,
            sync_root=sync_root,
            sync_enabled=sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
        )
        body: dict = {**launch_payload, "start": start}
        if dry_run:
            body["dry_run"] = True
        if name:
            body["name"] = name
        if handle is not None:
            body["handle"] = handle
        if size:
            body["size"] = size
        if meta_ui:
            body["meta"] = {"ui": copy.deepcopy(meta_ui)}
        if tags:
            body["tags"] = list(tags)
        data = self._post(AGENTS_API_PREFIX, json=body)
        agent = self._hydrate_agent(data)
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        agent.launch_config = launch_payload
        agent.command = list(launch_payload.get("command") or [])
        agent.entrypoint = list(launch_payload.get("entrypoint") or [])
        return agent

    def create_openclaw(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        start: bool = True,
        openclaw_routes: dict | None = None,
        openclaw_route_options: dict | None = None,
        memory_index: dict | None = None,
        workspaces_sync: dict | bool | None = None,
    ) -> Agent:
        effective_env = {
            "HYPER_API_BASE": _product_api_base_from_agents_api_base(self._api_base),
            **build_openclaw_workspaces_sync_env(workspaces_sync),
            **build_openclaw_memory_index_env(memory_index),
            **dict(env or {}),
        }
        return self.create(
            name=name,
            handle=handle,
            size=size,
            config=config,
            tags=tags,
            env=effective_env,
            ports=ports,
            routes=_resolve_openclaw_routes(
                routes,
                openclaw_routes=openclaw_routes,
                openclaw_route_options=openclaw_route_options,
            ),
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_image(image),
            sync_root=sync_root if sync_root is not None else DEFAULT_OPENCLAW_SYNC_ROOT,
            sync_enabled=True if sync_enabled is None else sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
            meta_ui=meta_ui,
            dry_run=dry_run,
            start=start,
        )

    def create_openclaw_pro(
        self,
        name: str = None,
        handle: str = None,
        size: str = None,
        config: dict = None,
        tags: list[str] = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        meta_ui: dict = None,
        dry_run: bool = False,
        start: bool = True,
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
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_pro_image(image),
            sync_root=sync_root,
            sync_enabled=sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
            meta_ui=meta_ui,
            dry_run=dry_run,
            start=start,
            openclaw_routes=openclaw_routes,
            openclaw_route_options=effective_route_options,
            memory_index=memory_index,
            workspaces_sync=workspaces_sync,
        )

    def budget(self) -> dict:
        """Get the user's current agent resource budget and usage.

        Returns:
            Dict with budget, used, available (all in cores/GB).
        """
        return self._get(f"{AGENTS_API_PREFIX}/budget")

    def metrics(self, agent_id_or_name: str) -> dict:
        """Get live CPU/memory metrics for a running agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with container metrics from k8s metrics-server.
        """
        agent_id = self.resolve_agent_id(agent_id_or_name)
        return self._get(f"{AGENTS_API_PREFIX}/{agent_id}/metrics")

    def list(self) -> list[Agent]:
        """List all agents for the authenticated user.

        Returns:
            List of Agent objects.
        """
        data = self._get(AGENTS_API_PREFIX)
        items = data.get("items", data) if isinstance(data, dict) else data
        return [self._hydrate_agent(p) for p in items]

    def get(self, agent_id_or_name: str) -> Agent:
        """Get agent details by UUID or unique name.

        Args:
            agent_id_or_name: Agent UUID, unique name, pod name, or hostname.

        Returns:
            Agent with current status.
        """
        raw = str(agent_id_or_name or "").strip()
        if not raw:
            raise ValueError("agent_id_or_name is required")
        try:
            return self._get_by_id(raw)
        except APIError as exc:
            if exc.status_code != 404:
                raise
            try:
                UUID(raw)
            except ValueError:
                return self.resolve_agent(raw)
            raise

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

    def rotate_external_agent_key(self, agent_id_or_name: str) -> dict:
        """Rotate an external agent relay key and return the new plaintext key once."""
        agent_id = self.resolve_agent_id(agent_id_or_name)
        return self._post(f"/external-agents/{agent_id}/keys/rotate")

    def wait_running(self, agent_id_or_name: str, timeout: float = 300.0, poll_interval: float = 5.0) -> Agent:
        """Poll until an agent reaches RUNNING and return a refreshed agent."""
        agent_id = self.resolve_agent_id(agent_id_or_name)
        deadline = time.time() + timeout
        last_state = None
        while time.time() < deadline:
            agent = self.get(agent_id)
            last_state = str(agent.state or "")
            if last_state.lower() == "running":
                return agent
            if last_state.lower() in {"failed", "error", "restore_failed", "sync_failed"}:
                raise RuntimeError(f"Agent entered {last_state} while waiting for RUNNING")
            time.sleep(poll_interval)
        raise TimeoutError(f"Timed out waiting for agent {agent_id} to reach RUNNING (last={last_state})")

    def start(
        self,
        agent_id: str,
        config: dict = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        dry_run: bool = False,
    ) -> Agent:
        """Start a previously stopped agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Agent with new pod details.
        """
        launch_payload, effective_gateway_token = _build_agent_launch(
            config,
            env=env,
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=image,
            sync_root=sync_root,
            sync_enabled=sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
        )
        body: dict[str, Any] = dict(launch_payload)
        if dry_run:
            body["dry_run"] = True
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/start", json=body)
        agent = self._hydrate_agent(data)
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        agent.launch_config = launch_payload
        agent.command = list(launch_payload.get("command") or [])
        agent.entrypoint = list(launch_payload.get("entrypoint") or [])
        return agent

    def start_openclaw(
        self,
        agent_id: str,
        config: dict = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        dry_run: bool = False,
        openclaw_routes: dict | None = None,
        openclaw_route_options: dict | None = None,
        memory_index: dict | None = None,
        workspaces_sync: dict | bool | None = None,
    ) -> Agent:
        effective_env = {
            "HYPER_API_BASE": _product_api_base_from_agents_api_base(self._api_base),
            **build_openclaw_workspaces_sync_env(workspaces_sync),
            **build_openclaw_memory_index_env(memory_index),
            **dict(env or {}),
        }
        return self.start(
            agent_id,
            config=config,
            env=effective_env,
            ports=ports,
            routes=_resolve_openclaw_routes(
                routes,
                openclaw_routes=openclaw_routes,
                openclaw_route_options=openclaw_route_options,
            ),
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_image(image),
            sync_root=sync_root if sync_root is not None else DEFAULT_OPENCLAW_SYNC_ROOT,
            sync_enabled=True if sync_enabled is None else sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
            dry_run=dry_run,
        )

    def start_openclaw_pro(
        self,
        agent_id: str,
        config: dict = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        sync_root: str = None,
        sync_enabled: bool = None,
        sync_uid: int = None,
        sync_gid: int = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        heartbeat: dict = None,
        dry_run: bool = False,
        openclaw_routes: dict | None = None,
        openclaw_route_options: dict | None = None,
        memory_index: dict | None = None,
        workspaces_sync: dict | bool | None = None,
    ) -> Agent:
        effective_env = {"OPENCLAW_DESKTOP_ENABLED": "1", **dict(env or {})}
        effective_route_options = {"include_desktop": True, **dict(openclaw_route_options or {})}
        return self.start_openclaw(
            agent_id,
            config=config,
            env=effective_env,
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=_default_openclaw_pro_image(image),
            sync_root=sync_root,
            sync_enabled=sync_enabled,
            sync_uid=sync_uid,
            sync_gid=sync_gid,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            heartbeat=heartbeat,
            dry_run=dry_run,
            openclaw_routes=openclaw_routes,
            openclaw_route_options=effective_route_options,
            memory_index=memory_index,
            workspaces_sync=workspaces_sync,
        )

    def update(
        self,
        agent_id: str,
        *,
        name: str | None = None,
        size: str | None = None,
        launch_config: dict | None = None,
        refresh_from_lagoon: bool | None = None,
        last_error: str | None = None,
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
        if last_error is not None:
            body["last_error"] = last_error
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
            Agent in stopped state.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/stop")
        return self._hydrate_agent(data)

    def delete(self, agent_id: str) -> dict:
        """Delete an agent entirely (pod + DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            Deletion status dict.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._delete(f"{AGENTS_API_PREFIX}/{resolved_agent_id}")

    def refresh_token(self, agent_id: str) -> dict:
        """Refresh the JWT token for an agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with agent_id, pod_id, token, expires_at.
        """
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/token")

    def create_scoped_key(self, agent_id: str, name: str | None = None) -> dict:
        payload = {"name": name} if name is not None else {}
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/keys", json=payload or None)

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

    def env(self, agent_id: str) -> dict:
        """Fetch runtime environment from the pod's K8s secret."""
        resolved_agent_id = self.resolve_agent_id(agent_id)
        return self._get(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/env")

    # -----------------------------------------------------------------------
    # Legacy direct executor API helpers. Current shell/exec flows are backend-mediated.
    # -----------------------------------------------------------------------

    def _executor_headers(self, pod: Agent) -> dict:
        h = {}
        if pod.jwt_token:
            h["Authorization"] = f"Bearer {pod.jwt_token}"
            h["Cookie"] = f"{pod.pod_name}-token={pod.jwt_token}"
        return h

    def exec(self, pod: Agent | str, command: str, timeout: int = 30, dry_run: bool = False) -> ExecResult:
        """Execute a one-shot command on a running agent via the backend exec API.

        Args:
            pod: Agent to execute on.
            command: Shell command to run.
            timeout: Command timeout in seconds.

        Returns:
            ExecResult with exit_code, stdout, stderr.
        """
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=max(timeout + 10, 35)) as client:
            resp = client.post(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/exec",
                headers=self._headers,
                json={"command": command, "timeout": timeout, **({"dry_run": True} if dry_run else {})},
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return ExecResult.from_dict(resp.json())

    def health(self, pod: Agent) -> dict:
        """Check executor health on a pod."""
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{pod.executor_url}/health",
                headers=self._executor_headers(pod),
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def files_list(self, pod: Agent | str, path: str = "", source: str = "auto") -> list[dict]:
        """List files on an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.get(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/{self._encode_file_path(path)}"
                if path
                else f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files",
                headers=self._file_headers(),
                params={"source": source},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        payload = resp.json()
        return [*(payload.get("directories") or []), *(payload.get("files") or [])]

    def file_read_bytes(self, pod: Agent | str, path: str, source: str = "auto") -> bytes:
        """Read a file from an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.get(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/{self._encode_file_path(path)}",
                headers=self._file_headers(),
                params={"source": source},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type.lower():
            try:
                payload = json.loads(resp.content.decode(errors="replace"))
            except Exception:
                payload = None
            if _is_directory_listing_payload(payload):
                raise ValueError(f"Path is a directory: {path}. Use files_list(path) instead.")
        return resp.content

    def file_read(self, pod: Agent | str, path: str, source: str = "auto") -> str:
        """Read a UTF-8 text file from an agent."""
        return self.file_read_bytes(pod, path, source=source).decode(errors="replace")

    def file_write_bytes(self, pod: Agent | str, path: str, content: bytes, destination: str = "auto") -> dict:
        """Write raw bytes to an agent via the backend file API."""
        if len(content) > AGENT_FILE_MAX_BYTES:
            raise ValueError(f"Agent file writes are limited to {AGENT_FILE_MAX_BYTES // 1024 // 1024} MiB")
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=AGENT_FILE_OPERATION_TIMEOUT_SECONDS) as client:
            resp = client.post(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/{self._encode_file_path(path)}",
                headers=self._file_headers(content_type="application/octet-stream"),
                params={"destination": destination},
                content=content,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def file_write(self, pod: Agent | str, path: str, content: str, destination: str = "auto") -> dict:
        """Write a UTF-8 text file to an agent."""
        return self.file_write_bytes(pod, path, content.encode(), destination=destination)

    def file_delete(self, pod: Agent | str, path: str, recursive: bool = False) -> dict:
        """Delete a file or directory from an agent."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.delete(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/{self._encode_file_path(path)}",
                headers=self._file_headers(),
                params={"recursive": "true"} if recursive else None,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def cp_to(self, pod: Agent | str, local_path: str | Path, remote_path: str) -> dict:
        """Copy a local file to an agent."""
        source = Path(local_path)
        return self.file_write_bytes(pod, remote_path, source.read_bytes())

    def cp_from(self, pod: Agent | str, remote_path: str, local_path: str | Path) -> Path:
        """Copy a file from an agent to the local filesystem."""
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.file_read_bytes(pod, remote_path))
        return dest

    def chat_stream(self, pod: OpenClawAgent, messages: list[dict], model: str = "hyperclaw/kimi-k2.5"):
        """Stream chat completions from the pod's OpenClaw gateway via executor proxy.

        Yields content delta strings as they arrive.
        """
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")

        body = {
            "model": model,
            "messages": messages,
            "stream": True,
        }

        with httpx.Client(timeout=300) as client:
            with client.stream(
                "POST",
                f"{pod.executor_url}/chat",
                headers=self._executor_headers(pod),
                json=body,
            ) as resp:
                if resp.status_code >= 400:
                    raise APIError(resp.status_code, resp.read().decode())
                for line in resp.iter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        import json
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

    def logs_stream(self, pod: Agent, lines: int = 100, follow: bool = True):
        """Stream logs from the pod via executor SSE.

        Yields log lines as they arrive.
        """
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")

        params = {"lines": lines, "follow": "true" if follow else "false"}

        with httpx.Client(timeout=None) as client:
            with client.stream(
                "GET",
                f"{pod.executor_url}/logs",
                headers=self._executor_headers(pod),
                params=params,
            ) as resp:
                if resp.status_code >= 400:
                    raise APIError(resp.status_code, resp.read().decode())
                for line in resp.iter_lines():
                    line = line.strip()
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[keepalive]":
                            continue
                        yield data

    # -----------------------------------------------------------------------
    # WebSocket API (via HyperClaw backend)
    # -----------------------------------------------------------------------

    async def logs_stream_ws(self, agent_id: str, tail_lines: int = 100, container: str = "reef") -> AsyncIterator[str]:
        """Stream logs via backend WebSocket.

        Connects to the HyperClaw backend WebSocket endpoint which proxies
        to the lagoon log buffer.

        Args:
            agent_id: Agent UUID.
            tail_lines: Number of historical lines to fetch first.
            container: Container name (default: reef).

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
                yield msg

    async def shell_connect(self, agent_id: str, shell: str | None = None, dry_run: bool = False):
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
        selected_shell = shell or self._detect_shell(resolved_agent_id)

        # Get shell token
        payload: dict[str, Any] = {"shell": selected_shell}
        if dry_run:
            payload["dry_run"] = True
        token_data = self._post(f"{AGENTS_API_PREFIX}/{resolved_agent_id}/shell/token", json=payload)
        jwt = token_data["jwt"]
        resolved_shell = token_data.get("shell") or selected_shell
        url = (
            f"{self._agents_ws_url}/shell/{resolved_agent_id}"
            f"?jwt={quote(jwt, safe='')}"
            f"&shell={quote(resolved_shell, safe='')}"
        )

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
