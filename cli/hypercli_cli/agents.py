"""HyperCLI deployments CLI."""
from __future__ import annotations

import copy
import json
import os
import shlex
import sys
from pathlib import Path

import typer
from hypercli.agents import (
    AGENT_FILE_MAX_BYTES,
    DEFAULT_AGENT_RUNTIME_SCOPES,
    DEFAULT_HERMES_AGENT_IMAGE,
    DEFAULT_OPENCLAW_IMAGE,
    DEFAULT_OPENCLAW_PRO_IMAGE,
    Agent,
    Deployments,
    HermesAgent,
    OpenClawAgent,
    build_openclaw_memory_index_env,
)
from hypercli.config import get_agent_api_key as get_config_agent_api_key
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="Manage agent deployments")
routes_app = typer.Typer(help="Manage declarative agent routes", no_args_is_help=True)
app.add_typer(routes_app, name="routes")
console = Console()
PROD_API_BASE = "https://api.hypercli.com"
DEV_API_BASE = "https://api.dev.hypercli.com"
_GLOBAL_DEV = False
_GLOBAL_AGENTS_WS_URL: str | None = None

# Config — uses HyperCLI API key (hyper_api_...) for backend auth
AGENT_KEY_PATH = Path.home() / ".hypercli" / "agent-key.json"
STATE_DIR = Path.home() / ".hypercli"
AGENTS_STATE = STATE_DIR / "agents.json"
LAUNCH_FIELD_KEYS = {
    "command",
    "entrypoint",
    "env",
    "image",
    "registry_auth",
    "registry_url",
    "restart",
    "routes",
    "runtime_scopes",
    "sync_exclude",
    "sync_gid",
    "sync_include",
    "sync_root",
    "sync_uid",
}


def _default_openclaw_image(image: str | None, config: dict | None = None) -> str:
    if image:
        return image
    configured = str((config or {}).get("image") or "").strip()
    return configured or DEFAULT_OPENCLAW_IMAGE


def _default_openclaw_pro_image(image: str | None, config: dict | None = None) -> str:
    if image:
        return image
    configured = str((config or {}).get("image") or "").strip()
    return configured or DEFAULT_OPENCLAW_PRO_IMAGE


def _default_hermes_agent_image(image: str | None, config: dict | None = None) -> str:
    if image:
        return image
    configured = str((config or {}).get("image") or "").strip()
    return configured or DEFAULT_HERMES_AGENT_IMAGE


def _managed_runtime(value: str) -> str:
    runtime = str(value or "").strip().lower()
    if runtime not in {"openclaw", "hermes-agent"}:
        raise typer.BadParameter("must be 'openclaw' or 'hermes-agent'", param_hint="--runtime")
    return runtime


def _reject_hermes_openclaw_options(**options: object) -> None:
    provided = [name for name, value in options.items() if value is not None]
    if provided:
        raise typer.BadParameter(
            "Hermes Agent does not support OpenClaw-only options: " + ", ".join(provided),
            param_hint="--runtime",
        )


def _truthy_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _falsey_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"0", "false", "no", "off", "disabled"}


def _desktop_enabled_from_launch(desktop: bool | None, env: dict | None = None, launch_config: dict | None = None) -> bool:
    if desktop is not None:
        return bool(desktop)
    env_value = (env or {}).get("OPENCLAW_DESKTOP_ENABLED")
    if _truthy_env(env_value):
        return True
    if _falsey_env(env_value):
        return False
    launch_env = (launch_config or {}).get("env")
    if isinstance(launch_env, dict):
        if _truthy_env(launch_env.get("OPENCLAW_DESKTOP_ENABLED")):
            return True
        if _falsey_env(launch_env.get("OPENCLAW_DESKTOP_ENABLED")):
            return False
    image = str((launch_config or {}).get("image") or "")
    return "hypercli-openclaw:pro" in image or image.endswith("-pro")


def _split_saved_launch_config(launch_config: dict | None) -> tuple[dict, dict]:
    if not isinstance(launch_config, dict):
        return {}, {}
    launch_fields = {key: value for key, value in launch_config.items() if key in LAUNCH_FIELD_KEYS}
    openclaw_config = launch_config.get("config")
    if isinstance(openclaw_config, dict):
        return launch_fields, dict(openclaw_config)
    return launch_fields, {
        key: value
        for key, value in launch_config.items()
        if key not in LAUNCH_FIELD_KEYS and key != "config"
    }


def _sync_policy_kwargs(
    sync_include: list[str] | None,
    sync_exclude: list[str] | None,
) -> dict[str, list[str]]:
    if sync_include is not None:
        return {"sync_include": list(sync_include)}
    if sync_exclude is not None:
        return {"sync_exclude": list(sync_exclude)}
    return {}


def _launch_epoch_wait_kwargs(agent: object) -> dict[str, int]:
    epoch = int(getattr(agent, "launch_epoch", 0) or 0)
    return {"minimum_launch_epoch": epoch} if epoch > 0 else {}


def _openclaw_env_with_desktop(env: dict | None, enabled: bool, *, force: bool = False) -> dict:
    env_dict = dict(env or {})
    if force or "OPENCLAW_DESKTOP_ENABLED" not in env_dict:
        env_dict["OPENCLAW_DESKTOP_ENABLED"] = "1" if enabled else "0"
    return env_dict


def _build_memory_index_options(
    *,
    memory_search: bool | None = None,
    index_on_session_start: bool | None = None,
    index_on_search: bool | None = None,
    index_watch: bool | None = None,
    index_watch_debounce_ms: int | None = None,
    index_interval_minutes: int | None = None,
) -> dict | None:
    options: dict[str, object] = {}
    if memory_search is not None:
        options["enabled"] = memory_search
    if index_on_session_start is not None:
        options["on_session_start"] = index_on_session_start
    if index_on_search is not None:
        options["on_search"] = index_on_search
    if index_watch is not None:
        options["watch"] = index_watch
    if index_watch_debounce_ms is not None:
        options["watch_debounce_ms"] = index_watch_debounce_ms
    if index_interval_minutes is not None:
        options["interval_minutes"] = index_interval_minutes
    if options:
        build_openclaw_memory_index_env(options)
    return options or None


@app.callback()
def agents_root(
    dev: bool = typer.Option(False, "--dev", help="Use the dev HyperCLI agents API"),
    agents_ws_url: str = typer.Option(None, "--agents-ws-url", help="Direct agents WebSocket base URL"),
):
    """Global options for agents commands."""
    global _GLOBAL_DEV, _GLOBAL_AGENTS_WS_URL
    _GLOBAL_DEV = dev
    _GLOBAL_AGENTS_WS_URL = agents_ws_url


def _get_agent_api_key() -> str:
    """Resolve HyperCLI API key from canonical config before legacy key file."""
    key = (get_config_agent_api_key() or "").strip()
    if key:
        return key
    if AGENT_KEY_PATH.exists():
        with open(AGENT_KEY_PATH) as f:
            data = json.load(f)
        key = data.get("key", "")
        if key:
            return key
    console.print("[red]❌ No HyperCLI API key found.[/red]")
    console.print("Set HYPER_AGENTS_API_KEY or HYPER_API_KEY, or subscribe: [bold]hyper agent subscribe solo[/bold]")
    raise typer.Exit(1)


def _get_deployments_client(agents_ws_url: str | None = None) -> Deployments:
    """Create a Deployments client using the HyperCLI API key."""
    from hypercli.http import HTTPClient
    api_key = _get_agent_api_key()
    api_base = (
        os.environ.get("AGENTS_API_BASE_URL")
        or os.environ.get("HYPER_API_BASE")
        or os.environ.get("HYPERCLI_API_URL")
        or (DEV_API_BASE if _GLOBAL_DEV else PROD_API_BASE)
    )
    resolved_agents_ws_url = agents_ws_url or _GLOBAL_AGENTS_WS_URL or os.environ.get("AGENTS_WS_URL")
    http = HTTPClient(api_base, api_key)
    return Deployments(http, api_key=api_key, api_base=api_base, agents_ws_url=resolved_agents_ws_url)


def _save_agent_state(agent: Agent):
    """Save agent info locally for quick reference."""
    state = _load_state()
    existing = state.get(agent.id, {})
    submitted_launch = getattr(agent, "_submitted_launch_config", None)
    if isinstance(submitted_launch, dict):
        saved_launch = copy.deepcopy(submitted_launch)
    elif isinstance(existing.get("launch_config"), dict):
        saved_launch = existing["launch_config"]
    else:
        saved_launch = getattr(agent, "launch_config", None)
    state[agent.id] = {
        "id": agent.id,
        "name": agent.name,
        "user_id": agent.user_id,
        "hostname": agent.hostname,
        "jwt_token": agent.jwt_token or existing.get("jwt_token"),
        "api_server_key": (
            agent.api_server_key if isinstance(agent, HermesAgent) else existing.get("api_server_key")
        ),
        "runtime": agent.runtime or existing.get("runtime"),
        "launch_config": saved_launch,
        "state": agent.state,
    }
    _write_state(state)


def _load_state() -> dict:
    if AGENTS_STATE.exists():
        with open(AGENTS_STATE) as f:
            return json.load(f)
    return {}


def _load_complete_launch_config(agent_id: str) -> dict:
    launch_config = (_load_state().get(agent_id) or {}).get("launch_config")
    if not isinstance(launch_config, dict):
        raise ValueError(
            "start requires a complete launch configuration in protected local state"
        )
    return copy.deepcopy(launch_config)


def _write_state(state: dict) -> None:
    """Persist credential-bearing agent state with owner-only permissions."""
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATE_DIR.chmod(0o700)
    fd = os.open(AGENTS_STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            fd = -1
            json.dump(state, f, indent=2, default=str)
    finally:
        if fd >= 0:
            os.close(fd)


def _remove_agent_state(agent_id: str):
    state = _load_state()
    state.pop(agent_id, None)
    _write_state(state)


def _reject_self_target(agent_id: str, operation: str) -> None:
    """Refuse the ``self`` selector for operations an Agent may not run on itself.

    A runtime key resolves its own identity and status, but it does not stop
    itself or edit its own routes; the Backend has no self endpoint for either.
    """
    if str(agent_id or "").strip().lower() == "self":
        console.print(
            f"[red]❌ '{operation} self' is not supported. An Agent cannot {operation} "
            "itself; run this against the Agent id with an owner credential.[/red]"
        )
        raise typer.Exit(1)


def _resolve_agent(agent_id: str) -> str:
    """Resolve agent_id with prefix matching from local state."""
    state = _load_state()
    if agent_id in state:
        return agent_id
    matches = [k for k in state if k.startswith(agent_id)]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        console.print(f"[yellow]Ambiguous ID prefix '{agent_id}'. Matches:[/yellow]")
        for m in matches:
            s = state[m]
            console.print(f"  {m[:12]}  {s.get('name', '')}  {s.get('state', '')}")
        raise typer.Exit(1)
    return agent_id


def _get_agent_with_token(agent_id: str) -> Agent:
    """Get an agent, filling JWT from local state if needed."""
    resolved_agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    pod = agents.get(resolved_agent_id)
    state = _load_state()
    local = state.get(pod.id, {}) or state.get(resolved_agent_id, {})
    if not pod.jwt_token and local.get("jwt_token"):
        pod.jwt_token = local["jwt_token"]
    if isinstance(pod, HermesAgent) and not pod.api_server_key and local.get("api_server_key"):
        pod.api_server_key = local["api_server_key"]
    if pod.launch_config is None and local.get("launch_config") is not None:
        pod.launch_config = local["launch_config"]
    if isinstance(pod, OpenClawAgent) and not pod.gateway_token:
        # Gateway tokens are caller-held and never ride projections; when no
        # local state holds one (fresh machines, CI), recover it through the
        # explicit secret retrieval endpoint.
        try:
            pod.gateway_token = pod.secret("OPENCLAW_GATEWAY_TOKEN") or None
        except Exception:
            pass
    return pod


def _require_openclaw_agent(agent: Agent) -> OpenClawAgent:
    if isinstance(agent, OpenClawAgent):
        return agent
    console.print("[red]❌ Agent is not an OpenClaw-backed agent.[/red]")
    raise typer.Exit(1)


def _parse_env_vars(values: list[str] | None) -> dict | None:
    """Parse repeated --env KEY=VALUE options into a dict."""
    if not values:
        return None
    env: dict[str, str] = {}
    for item in values:
        if "=" not in item:
            raise typer.BadParameter(f"Invalid --env '{item}'. Expected KEY=VALUE.")
        key, value = item.split("=", 1)
        if not key:
            raise typer.BadParameter(f"Invalid --env '{item}'. KEY cannot be empty.")
        env[key] = value
    return env


def _build_registry_auth(username: str | None, password: str | None) -> dict | None:
    if not username and not password:
        return None
    if not username or not password:
        raise typer.BadParameter("Both --registry-username and --registry-password are required together.")
    return {"username": username, "password": password}


def _parse_argv_option(value: str | None, option_name: str) -> list[str] | None:
    if value is None:
        return None
    try:
        return shlex.split(value)
    except ValueError as e:
        raise typer.BadParameter(f"Invalid {option_name}: {e}") from e


def _parse_cp_target(value: str) -> tuple[str | None, str]:
    if ":" not in value:
        return None, value
    agent_id, remote_path = value.split(":", 1)
    if not agent_id or not remote_path:
        raise typer.BadParameter("Remote paths must use AGENT_ID:PATH")
    return _resolve_agent(agent_id), remote_path


def _routes_json_payload(state) -> dict:
    return {
        "agent_id": state.agent_id,
        "routes": state.routes,
        "route_statuses": state.route_statuses,
    }


def _print_routes(state, output_format: str) -> None:
    if output_format not in {"table", "json"}:
        raise typer.BadParameter("--output must be table or json")
    if output_format == "json":
        console.print_json(json.dumps(_routes_json_payload(state), indent=2, default=str))
        return

    table = Table(title=f"Agent routes — {state.agent_id}")
    table.add_column("Name", style="cyan")
    table.add_column("Port", justify="right")
    table.add_column("Auth")
    table.add_column("Prefix")
    table.add_column("URL")
    for name, route in sorted(state.routes.items()):
        status = state.route_statuses.get(name) or {}
        prefix = route.get("prefix")
        table.add_row(
            name,
            str(route.get("port") or ""),
            "yes" if route.get("auth", True) else "no",
            "<root>" if prefix == "" else str(prefix or ""),
            str(status.get("url") or ""),
        )
    console.print(table)


@routes_app.command("list")
def routes_list(
    agent_id: str = typer.Argument(..., help="Agent ID, name, or prefix"),
    output_format: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """List desired routes and their live status."""
    agents = _get_deployments_client()
    try:
        state = agents.get_routes(_resolve_agent(agent_id))
        _print_routes(state, output_format)
    except typer.BadParameter:
        raise
    except Exception as e:
        console.print(f"[red]❌ Failed to list routes: {e}[/red]")
        raise typer.Exit(1)


@routes_app.command("add")
def routes_add(
    agent_id: str = typer.Argument(..., help="Agent ID, name, or prefix"),
    name: str = typer.Argument(..., help="Stable route name"),
    port: int = typer.Option(..., "--port", "-p", min=1, max=65535, help="Container port"),
    auth: bool = typer.Option(True, "--auth/--no-auth", help="Require HyperCLI authentication"),
    prefix: str = typer.Option(None, "--prefix", help="Hostname prefix; defaults to the route name"),
    root: bool = typer.Option(False, "--root", help="Route the agent's root hostname"),
    output_format: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Create or replace exactly one named route."""
    if root and prefix is not None:
        raise typer.BadParameter("--prefix and --root are mutually exclusive")
    route = {"port": port, "auth": auth}
    if root:
        route["prefix"] = ""
    elif prefix is not None:
        route["prefix"] = prefix
    agents = _get_deployments_client()
    try:
        state = agents.set_route(_resolve_agent(agent_id), name, route)
        _print_routes(state, output_format)
    except typer.BadParameter:
        raise
    except Exception as e:
        console.print(f"[red]❌ Failed to add route: {e}[/red]")
        raise typer.Exit(1)


@routes_app.command("remove")
def routes_remove(
    agent_id: str = typer.Argument(..., help="Agent ID, name, or prefix"),
    name: str = typer.Argument(..., help="Route name"),
    output_format: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Remove exactly one named route."""
    agents = _get_deployments_client()
    try:
        state = agents.remove_route(_resolve_agent(agent_id), name)
        _print_routes(state, output_format)
    except typer.BadParameter:
        raise
    except Exception as e:
        console.print(f"[red]❌ Failed to remove route: {e}[/red]")
        raise typer.Exit(1)


@app.command("budget")
def budget():
    """Show your agent resource budget and usage."""
    agents = _get_deployments_client()

    try:
        data = agents.budget()
    except Exception as e:
        console.print(f"[red]❌ Failed to get budget: {e}[/red]")
        raise typer.Exit(1)

    b = data.get("budget", {})
    u = data.get("used", {})
    a = data.get("available", {})
    slots = data.get("slots") or {}
    if slots:
        b = {
            **b,
            "max_agents": b.get("max_agents", sum(int(slot.get("granted") or 0) for slot in slots.values())),
        }
        u = {
            **u,
            "agents": u.get("agents", sum(int(slot.get("used") or 0) for slot in slots.values())),
        }
        a = {
            **a,
            "agents": a.get("agents", sum(int(slot.get("available") or 0) for slot in slots.values())),
        }

    console.print(f"\n[bold]Agent Capacity[/bold] ({data.get('plan_id', '')})")
    console.print(f"  Agents:  {u.get('agents', 0)}/{b.get('max_agents', 0)} ({a.get('agents', 0)} available)")
    if data.get("pooled_tpd") is not None:
        console.print(f"  Tokens:  {int(data['pooled_tpd']):,} TPD")

    presets = data.get("size_presets", {})
    if presets:
        console.print("\n[bold]Size Presets:[/bold]")
        for name, spec in presets.items():
            console.print(f"  {name:8s} — {spec['cpu']} CPU, {spec['memory']} GB")
    console.print()


@app.command("create")
def create(
    runtime: str = typer.Option("openclaw", "--runtime", help="Managed runtime: openclaw or hermes-agent"),
    name: str = typer.Option(None, "--name", "-n", help="Agent name (auto-generated if omitted, becomes {name}.hypercli.com)"),
    size: str = typer.Option(None, "--size", "-s", help="Size preset: small, medium, large"),
    env: list[str] = typer.Option(None, "--env", "-e", help="Environment variable (KEY=VALUE). Repeatable."),
    command: str = typer.Option(None, "--command", help="Container args as a shell-style string"),
    entrypoint: str = typer.Option(None, "--entrypoint", help="Container entrypoint as a shell-style string"),
    image: str = typer.Option(None, "--image", help="Override the managed runtime image"),
    desktop: bool | None = typer.Option(None, "--desktop/--no-desktop", help="Use the pro desktop/browser image and protected noVNC route"),
    memory_search: bool | None = typer.Option(None, "--memory-search/--no-memory-search", help="Enable or disable OpenClaw memory search"),
    index_on_session_start: bool | None = typer.Option(None, "--index-on-session-start/--no-index-on-session-start", help="Sync the memory index when a session starts"),
    index_on_search: bool | None = typer.Option(None, "--index-on-search/--no-index-on-search", help="Sync the memory index when memory search runs"),
    index_watch: bool | None = typer.Option(None, "--index-watch/--no-index-watch", help="Watch memory files and sync after changes"),
    index_watch_debounce_ms: int = typer.Option(None, "--index-watch-debounce-ms", min=0, help="Milliseconds of quiet time before watched memory files sync"),
    index_interval_minutes: int = typer.Option(None, "--index-interval-minutes", min=0, help="Periodic memory index sync interval in minutes; 0 disables it"),
    registry_url: str = typer.Option(None, "--registry-url", help="Container registry URL for private image pulls"),
    registry_username: str = typer.Option(None, "--registry-username", help="Registry username"),
    registry_password: str = typer.Option(None, "--registry-password", help="Registry password"),
    sync_include: list[str] = typer.Option(
        None,
        "--sync-include",
        help="Path under the sync root to include. Repeatable; takes precedence over excludes.",
    ),
    sync_exclude: list[str] = typer.Option(
        None,
        "--sync-exclude",
        help="Path under the sync root to exclude. Repeatable.",
    ),
    sync_uid: int = typer.Option(None, "--sync-uid", min=0, max=4_294_967_294, help="UID for synced files; Lagoon defaults to 1000"),
    sync_gid: int = typer.Option(None, "--sync-gid", min=0, max=4_294_967_294, help="GID for synced files; Lagoon defaults to 1000"),
    gateway_token: str = typer.Option(None, "--gateway-token", help="OpenClaw gateway token override"),
    api_server_key: str = typer.Option(None, "--api-server-key", help="Hermes API Server bearer key override"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate launch configuration without creating the agent"),
):
    """Provision a new managed agent in STOPPED state."""
    runtime = _managed_runtime(runtime)
    agents = _get_deployments_client()
    env_dict = _parse_env_vars(env)
    command_argv = _parse_argv_option(command, "--command")
    entrypoint_argv = _parse_argv_option(entrypoint, "--entrypoint")
    registry_auth = _build_registry_auth(registry_username, registry_password)
    sync_policy = _sync_policy_kwargs(sync_include, sync_exclude)
    if runtime == "hermes-agent":
        _reject_hermes_openclaw_options(
            desktop=desktop,
            memory_search=memory_search,
            index_on_session_start=index_on_session_start,
            index_on_search=index_on_search,
            index_watch=index_watch,
            index_watch_debounce_ms=index_watch_debounce_ms,
            index_interval_minutes=index_interval_minutes,
            gateway_token=gateway_token,
        )
        desktop_enabled = False
        effective_env = env_dict
        memory_index = None
    else:
        if api_server_key is not None:
            raise typer.BadParameter(
                "--api-server-key is only valid with --runtime hermes-agent",
                param_hint="--api-server-key",
            )
        desktop_enabled = _desktop_enabled_from_launch(desktop, env_dict)
        effective_env = _openclaw_env_with_desktop(env_dict, desktop_enabled, force=desktop is not None)
        memory_index = _build_memory_index_options(
            memory_search=memory_search,
            index_on_session_start=index_on_session_start,
            index_on_search=index_on_search,
            index_watch=index_watch,
            index_watch_debounce_ms=index_watch_debounce_ms,
            index_interval_minutes=index_interval_minutes,
        )

    console.print("\n[bold]Creating agent...[/bold]")

    try:
        common = {
            "name": name,
            "size": size,
            "env": effective_env,
            "command": command_argv,
            "entrypoint": entrypoint_argv,
            "registry_url": registry_url,
            "registry_auth": registry_auth,
            "sync_uid": sync_uid,
            "sync_gid": sync_gid,
            "dry_run": dry_run,
            **sync_policy,
        }
        if runtime == "hermes-agent":
            pod = agents.create_hermes_agent(
                **common,
                image=_default_hermes_agent_image(image),
                api_server_key=api_server_key,
            )
        else:
            create_func = agents.create_openclaw_pro if desktop_enabled else agents.create_openclaw
            pod = create_func(
                **common,
                image=_default_openclaw_pro_image(image) if desktop_enabled else _default_openclaw_image(image),
                gateway_token=gateway_token,
                openclaw_route_options={"include_desktop": desktop_enabled},
                memory_index=memory_index,
            )
    except Exception as e:
        console.print(f"[red]❌ Create failed: {e}[/red]")
        raise typer.Exit(1)

    if not pod.dry_run:
        _save_agent_state(pod)

    console.print(f"[green]✓[/green] {'Agent launch validated' if pod.dry_run else 'Agent created'}: [bold]{pod.id[:12]}[/bold]")
    console.print(f"  Name:     {getattr(pod, 'name', None) or pod.id}")
    console.print(f"  Size:     {pod.cpu} CPU, {pod.memory} GB")
    console.print(f"  State:    {pod.state}")
    if runtime == "hermes-agent":
        console.print(f"  API:      {pod.api_url or 'pending route assignment'}")
    else:
        console.print(f"  Desktop:  {pod.vnc_url or ('disabled' if not desktop_enabled else '')}")
    console.print(f"  Shell:    {'via hyper agents shell' if not pod.shell_url else pod.shell_url}")

    if pod.dry_run:
        console.print("\n[dim]Dry run only. No agent was created.[/dim]")
    else:
        console.print(f"\nExec:    [bold]hyper agents exec {pod.id[:8]} 'echo hello'[/bold]")
        console.print(f"Shell:   [bold]hyper agents shell {pod.id[:8]}[/bold]")
        console.print(f"Start:   [bold]hyper agents start {pod.id[:8]}[/bold]")
        if runtime == "hermes-agent":
            console.print(f"API:     {pod.api_url or 'pending route assignment'}")
        elif desktop_enabled:
            console.print(f"Desktop: {pod.vnc_url}")
        else:
            console.print("Desktop: disabled (launch with --desktop to enable)")


@app.command("wait")
def wait_agent(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    timeout: int = typer.Option(300, "--timeout", help="Seconds to wait for RUNNING"),
    poll_interval: float = typer.Option(
        5.0, "--poll-interval", help="Deprecated; retained for compatibility"
    ),
):
    """Wait for an agent to reach RUNNING."""
    agents = _get_deployments_client()
    pod = _get_agent_with_token(agent_id)

    try:
        pod = agents.wait_running(pod.id, timeout=timeout, poll_interval=poll_interval)
    except RuntimeError as e:
        console.print(f"[red]❌ Agent failed: {e}[/red]")
        raise typer.Exit(1)
    except TimeoutError as e:
        console.print(f"[yellow]⚠ {e}[/yellow]")
        raise typer.Exit(1)

    _save_agent_state(pod)
    console.print(f"[green]✅ Agent is running:[/green] [bold]{pod.id[:12]}[/bold]")
    console.print(f"  Name:     {getattr(pod, 'name', None) or pod.id}")
    console.print(f"  State:    {pod.state}")
    console.print(f"  Desktop:  {pod.vnc_url}")
    console.print(f"  Shell:    {'via hyper agents shell' if not pod.shell_url else pod.shell_url}")


def _agent_state_style(state: object) -> str:
    normalized_state = str(state or "").lower()
    return {
        "creating": "yellow",
        "starting": "yellow",
        "restoring": "yellow",
        "running": "green",
        "stopping": "yellow",
        "archiving": "yellow",
        "stopped": "dim",
        "archived": "dim",
        "failed": "red",
        "deleted": "dim",
    }.get(normalized_state, "white")


@app.command("ls")
@app.command("list")
def list_agents(
    json_output: bool = typer.Option(False, "--json", help="JSON output"),
    state: str | None = typer.Option(None, "--state", "-s", help="Filter by lifecycle state"),
    handle: str | None = typer.Option(None, "--handle", help="Filter by exact agent handle"),
    name: str | None = typer.Option(None, "--name", "-n", help="Filter by exact agent name"),
    query: str | None = typer.Option(None, "--query", "-q", help="Search IDs, names, handles, and hostnames"),
    include_deleted: bool = typer.Option(False, "--include-deleted", help="Include deleted agents"),
):
    """List all agents."""
    agents = _get_deployments_client()

    try:
        pods = agents.list(
            state=state,
            handle=handle,
            name=name,
            query=query,
            include_deleted=include_deleted,
        )
    except Exception as e:
        console.print(f"[red]❌ Failed to list agents: {e}[/red]")
        raise typer.Exit(1)

    if json_output:
        console.print_json(json.dumps([{
            "id": p.id, "handle": getattr(p, "handle", None),
            "display_name": getattr(p, "display_name", None), "avatar_url": getattr(p, "avatar_url", None),
            "runtime": getattr(p, "runtime", None), "is_launchable": getattr(p, "is_launchable", True),
            "launch_config": getattr(p, "launch_config", None), "gateway_id": getattr(p, "gateway_id", None),
            "name": p.name, "state": p.state,
            "hostname": p.hostname, "vnc_url": p.vnc_url,
        } for p in pods], indent=2, default=str))
        return

    if not pods:
        console.print("[dim]No agents found.[/dim]")
        console.print("Create one: [bold]hyper agents create[/bold]")
        return

    table = Table(title="Agents")
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Name", style="blue")
    table.add_column("Handle")
    table.add_column("Size")
    table.add_column("State")
    table.add_column("Desktop URL")
    table.add_column("Created")

    for pod in pods:
        style = _agent_state_style(pod.state)
        created = pod.created_at.strftime("%Y-%m-%d %H:%M") if pod.created_at else ""
        size_str = f"{pod.cpu}c/{pod.memory}G" if pod.cpu else ""
        row = [
            pod.id[:12],
            getattr(pod, "display_name", None) or getattr(pod, "name", None) or pod.id,
            getattr(pod, "handle", None) or "",
            size_str,
            f"[{style}]{pod.state}[/{style}]",
            pod.vnc_url or "",
        ]
        row.append(created)
        table.add_row(*row)
        _save_agent_state(pod)

    console.print()
    console.print(table)


@app.command("web-search")
def web_search_cmd(
    query: str = typer.Argument(..., help="Search query"),
    count: int = typer.Option(5, "--count", "-n", min=1, max=20, help="Number of Brave results to request"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """Search the web through the HyperCLI Brave proxy."""
    agents = _get_deployments_client()
    try:
        payload = agents.web_search(query, count=count)
    except Exception as e:
        console.print(f"[red]❌ Web search failed: {e}[/red]")
        raise typer.Exit(1)

    if json_output:
        console.print(json.dumps(payload, indent=2))
        return

    web = payload.get("web") if isinstance(payload, dict) else None
    results = web.get("results") if isinstance(web, dict) else []
    table = Table(title="Web Search")
    table.add_column("Title")
    table.add_column("URL")
    for item in results or []:
        if not isinstance(item, dict):
            continue
        table.add_row(str(item.get("title") or ""), str(item.get("url") or ""))
    console.print(table)
    console.print()


@app.command("status")
def status(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
):
    """Get detailed status of an agent."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    try:
        pod = agents.get(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)

    _save_agent_state(pod)

    console.print(f"\n[bold]Agent {pod.id[:12]}[/bold]")
    console.print(f"  Name:       {getattr(pod, 'name', None) or pod.id}")
    if getattr(pod, "handle", None):
        console.print(f"  Handle:     @{pod.handle}")
    if getattr(pod, "display_name", None):
        console.print(f"  Display:    {pod.display_name}")
    if getattr(pod, "avatar_url", None):
        console.print(f"  Avatar:     {pod.avatar_url}")
    if getattr(pod, "runtime", None):
        console.print(f"  Runtime:    {pod.runtime}")
    console.print(f"  Size:       {pod.cpu} CPU, {pod.memory} GB")
    console.print(f"  State:      {pod.state}")
    console.print(f"  Desktop:    {pod.vnc_url}")
    console.print(f"  Shell:      {'via hyper agents shell' if not pod.shell_url else pod.shell_url}")
    console.print(f"  Created:    {pod.created_at}")
    if pod.started_at:
        console.print(f"  Started:    {pod.started_at}")
    if pod.stopped_at:
        console.print(f"  Stopped:    {pod.stopped_at}")
    if pod.jwt_expires_at:
        console.print(f"  JWT Expires: {pod.jwt_expires_at}")
def _print_agent_metrics(data: dict) -> None:
    timestamp_value = data.get("timestamp")
    timestamp = "" if timestamp_value is None else str(timestamp_value)
    table = Table(title="Agent Metrics")
    table.add_column("Container", style="cyan")
    table.add_column("CPU Usage")
    table.add_column("Memory Usage")
    table.add_row("reef", str(data.get("cpu") or "0"), str(data.get("memory") or "0"))

    console.print()
    console.print(table)
    if timestamp:
        console.print(f"[dim]Timestamp: {timestamp}[/dim]")


@app.command("metrics")
def metrics(
    agent_id: str = typer.Argument(..., help="Agent ID, name, handle, hostname, or prefix"),
    json_output: bool = typer.Option(False, "--json", help="JSON output"),
):
    """Get one live Reef CPU and memory sample over Backend WebSocket."""
    agents = _get_deployments_client()
    agent_id = _resolve_agent(agent_id)

    try:
        data = agents.metrics(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent metrics: {e}[/red]")
        raise typer.Exit(1)

    if json_output:
        console.print_json(json.dumps(data, indent=2, default=str))

    if not json_output:
        _print_agent_metrics(data)


@app.command("start")
def start(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
    env: list[str] = typer.Option(None, "--env", "-e", help="Environment variable override (KEY=VALUE). Repeatable."),
    command: str = typer.Option(None, "--command", help="Container args as a shell-style string"),
    entrypoint: str = typer.Option(None, "--entrypoint", help="Container entrypoint as a shell-style string"),
    image: str = typer.Option(None, "--image", help="Override the managed runtime image"),
    desktop: bool | None = typer.Option(None, "--desktop/--no-desktop", help="Use the pro desktop/browser image and protected noVNC route"),
    memory_search: bool | None = typer.Option(None, "--memory-search/--no-memory-search", help="Enable or disable OpenClaw memory search"),
    index_on_session_start: bool | None = typer.Option(None, "--index-on-session-start/--no-index-on-session-start", help="Sync the memory index when a session starts"),
    index_on_search: bool | None = typer.Option(None, "--index-on-search/--no-index-on-search", help="Sync the memory index when memory search runs"),
    index_watch: bool | None = typer.Option(None, "--index-watch/--no-index-watch", help="Watch memory files and sync after changes"),
    index_watch_debounce_ms: int = typer.Option(None, "--index-watch-debounce-ms", min=0, help="Milliseconds of quiet time before watched memory files sync"),
    index_interval_minutes: int = typer.Option(None, "--index-interval-minutes", min=0, help="Periodic memory index sync interval in minutes; 0 disables it"),
    registry_url: str = typer.Option(None, "--registry-url", help="Container registry URL for private image pulls"),
    registry_username: str = typer.Option(None, "--registry-username", help="Registry username"),
    registry_password: str = typer.Option(None, "--registry-password", help="Registry password"),
    sync_include: list[str] = typer.Option(
        None,
        "--sync-include",
        help="Path under the sync root to include. Repeatable; takes precedence over excludes.",
    ),
    sync_exclude: list[str] = typer.Option(
        None,
        "--sync-exclude",
        help="Path under the sync root to exclude. Repeatable.",
    ),
    sync_uid: int = typer.Option(None, "--sync-uid", min=0, max=4_294_967_294, help="UID for synced files; Lagoon defaults to 1000"),
    sync_gid: int = typer.Option(None, "--sync-gid", min=0, max=4_294_967_294, help="GID for synced files; Lagoon defaults to 1000"),
    gateway_token: str = typer.Option(None, "--gateway-token", help="OpenClaw gateway token override"),
    api_server_key: str = typer.Option(None, "--api-server-key", help="Hermes API Server bearer key override"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate launch configuration without starting the agent"),
):
    """Start a previously stopped agent."""
    _reject_self_target(agent_id, "start")
    agent_id = _resolve_agent(agent_id)
    requested_agent_id = "self" if agent_id.strip().lower() == "self" else agent_id
    agents = _get_deployments_client()
    override_names = [
        name
        for name, value in {
            "env": env or None,
            "command": command,
            "entrypoint": entrypoint,
            "image": image,
            "desktop": desktop,
            "memory_search": memory_search,
            "index_on_session_start": index_on_session_start,
            "index_on_search": index_on_search,
            "index_watch": index_watch,
            "index_watch_debounce_ms": index_watch_debounce_ms,
            "index_interval_minutes": index_interval_minutes,
            "registry_url": registry_url,
            "registry_username": registry_username,
            "registry_password": registry_password,
            "sync_include": sync_include,
            "sync_exclude": sync_exclude,
            "sync_uid": sync_uid,
            "sync_gid": sync_gid,
            "gateway_token": gateway_token,
            "api_server_key": api_server_key,
            "dry_run": True if dry_run else None,
        }.items()
        if value is not None
    ]

    if requested_agent_id == "self":
        launch_overrides = [name for name in override_names if name != "dry_run"]
        if launch_overrides:
            console.print(
                "[red]❌ start self requires one complete locally saved launch "
                "configuration and does not accept partial overrides: "
                f"{', '.join(launch_overrides)}[/red]"
            )
            raise typer.Exit(1)
        try:
            current = agents.get("self")
            local_launch = _load_complete_launch_config(current.id)
            pod = agents.start(current.id, local_launch, dry_run=dry_run)
        except Exception as e:
            console.print(f"[red]❌ Failed to start agent: {e}[/red]")
            raise typer.Exit(1)
        if not pod.dry_run:
            _save_agent_state(pod)
        console.print(
            f"[green]✓[/green] {'Agent start validated' if pod.dry_run else 'Agent starting'}: "
            f"{getattr(pod, 'name', None) or pod.id}"
        )
        return

    if not override_names:
        try:
            current = agents.get(requested_agent_id)
            local_launch = _load_complete_launch_config(current.id)
            pod = agents.start(current.id, local_launch)
        except Exception as e:
            console.print(f"[red]❌ Failed to start agent: {e}[/red]")
            raise typer.Exit(1)
        _save_agent_state(pod)
        console.print(f"[green]✓[/green] Agent starting: {getattr(pod, 'name', None) or pod.id}")
        return

    try:
        existing_pod = agents.get(agent_id)
        agent_id = existing_pod.id
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)
    state = _load_state()
    local = state.get(agent_id, {})
    if not local and getattr(existing_pod, "launch_config", None) is not None:
        local = {
            "api_server_key": getattr(existing_pod, "api_server_key", None),
            "runtime": getattr(existing_pod, "runtime", None),
            "launch_config": existing_pod.launch_config,
        }
    env_dict = _parse_env_vars(env)
    command_argv = _parse_argv_option(command, "--command")
    entrypoint_argv = _parse_argv_option(entrypoint, "--entrypoint")
    registry_auth = _build_registry_auth(registry_username, registry_password)
    saved_launch_fields, saved_runtime_config = _split_saved_launch_config(local.get("launch_config"))
    # A normal start inherits the backend's authoritative stored policy. The
    # local state file is only a convenience cache and may be stale after an
    # edit from Desktop or another SDK client; replay policy only when the
    # caller explicitly supplied a sync flag.
    sync_policy = _sync_policy_kwargs(sync_include, sync_exclude)
    runtime = str(getattr(existing_pod, "runtime", None) or local.get("runtime") or "openclaw").strip().lower()
    is_hermes = runtime == "hermes-agent"
    effective_gateway_token = gateway_token
    effective_api_server_key = api_server_key or local.get("api_server_key") or getattr(
        existing_pod, "api_server_key", None
    )
    saved_env = saved_launch_fields.get("env") if isinstance(saved_launch_fields.get("env"), dict) else {}
    merged_env = {**dict(saved_env or {}), **dict(env_dict or {})}
    if is_hermes:
        _reject_hermes_openclaw_options(
            desktop=desktop,
            memory_search=memory_search,
            index_on_session_start=index_on_session_start,
            index_on_search=index_on_search,
            index_watch=index_watch,
            index_watch_debounce_ms=index_watch_debounce_ms,
            index_interval_minutes=index_interval_minutes,
            gateway_token=gateway_token,
        )
        desktop_enabled = False
        effective_env = merged_env
        effective_image = _default_hermes_agent_image(image, saved_launch_fields)
    else:
        if api_server_key is not None:
            raise typer.BadParameter(
                "--api-server-key is only valid for a Hermes Agent",
                param_hint="--api-server-key",
            )
        desktop_enabled = _desktop_enabled_from_launch(desktop, merged_env, saved_launch_fields)
        effective_env = _openclaw_env_with_desktop(merged_env, desktop_enabled, force=desktop is not None)
        effective_image = (
            _default_openclaw_pro_image(image, saved_launch_fields)
            if desktop_enabled
            else _default_openclaw_image(image, saved_launch_fields)
        )
    effective_command = command_argv if command_argv is not None else saved_launch_fields.get("command")
    effective_entrypoint = entrypoint_argv if entrypoint_argv is not None else saved_launch_fields.get("entrypoint")
    effective_registry_url = registry_url if registry_url is not None else saved_launch_fields.get("registry_url")
    effective_registry_auth = registry_auth if registry_auth is not None else saved_launch_fields.get("registry_auth")
    effective_sync_uid = sync_uid if sync_uid is not None else saved_launch_fields.get("sync_uid")
    effective_sync_gid = sync_gid if sync_gid is not None else saved_launch_fields.get("sync_gid")
    memory_index = None if is_hermes else _build_memory_index_options(
        memory_search=memory_search,
        index_on_session_start=index_on_session_start,
        index_on_search=index_on_search,
        index_watch=index_watch,
        index_watch_debounce_ms=index_watch_debounce_ms,
        index_interval_minutes=index_interval_minutes,
    )

    try:
        common = {
            "config": saved_runtime_config,
            "env": effective_env,
            "routes": saved_launch_fields.get("routes"),
            "command": effective_command,
            "entrypoint": effective_entrypoint,
            "image": effective_image,
            "registry_url": effective_registry_url,
            "registry_auth": effective_registry_auth,
            "restart": saved_launch_fields.get("restart"),
            "runtime_scopes": saved_launch_fields.get("runtime_scopes"),
            "sync_root": saved_launch_fields.get("sync_root"),
            "sync_uid": effective_sync_uid,
            "sync_gid": effective_sync_gid,
            "dry_run": dry_run,
            **sync_policy,
        }
        if is_hermes:
            hermes_launch_config = {
                key: copy.deepcopy(value)
                for key, value in common.items()
                if key != "dry_run"
            }
            hermes_launch_config["secrets"] = copy.deepcopy(saved_launch_fields.get("secrets") or {})
            hermes_launch_config["routes"] = copy.deepcopy(hermes_launch_config.get("routes") or {})
            hermes_launch_config["command"] = list(hermes_launch_config.get("command") or [])
            hermes_launch_config["entrypoint"] = list(hermes_launch_config.get("entrypoint") or [])
            hermes_launch_config["restart"] = bool(hermes_launch_config.get("restart") or False)
            hermes_launch_config["registry_auth"] = copy.deepcopy(hermes_launch_config.get("registry_auth") or {})
            hermes_launch_config["runtime_scopes"] = list(
                hermes_launch_config.get("runtime_scopes") or DEFAULT_AGENT_RUNTIME_SCOPES
            )
            if not sync_policy:
                if "sync_include" in saved_launch_fields:
                    hermes_launch_config["sync_include"] = copy.deepcopy(saved_launch_fields.get("sync_include"))
                elif "sync_exclude" in saved_launch_fields:
                    hermes_launch_config["sync_exclude"] = copy.deepcopy(saved_launch_fields.get("sync_exclude"))
            pod = agents.start_hermes_agent(
                requested_agent_id if requested_agent_id == "self" else agent_id,
                hermes_launch_config,
                api_server_key=effective_api_server_key,
                dry_run=dry_run,
            )
        else:
            start_func = agents.start_openclaw_pro if desktop_enabled else agents.start_openclaw
            pod = start_func(
                requested_agent_id if requested_agent_id == "self" else agent_id,
                **common,
                gateway_token=effective_gateway_token,
                openclaw_route_options={"include_desktop": desktop_enabled},
                memory_index=memory_index,
            )
    except Exception as e:
        console.print(f"[red]❌ Failed to start agent: {e}[/red]")
        raise typer.Exit(1)

    if not pod.dry_run:
        _save_agent_state(pod)
    console.print(f"[green]✓[/green] {'Agent start validated' if pod.dry_run else 'Agent starting'}: {getattr(pod, 'name', None) or pod.id}")
    if pod.dry_run:
        console.print("  No agent was created.")
    else:
        if is_hermes:
            console.print(f"  API: {pod.api_url or 'pending route assignment'}")
        else:
            console.print(f"  Desktop: {pod.vnc_url or ('disabled' if not desktop_enabled else '')}")


@app.command("stop")
def stop(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation"),
    wait: bool = typer.Option(False, "--wait", help="Wait for cleanup to finish and state to become STOPPED"),
    timeout: float = typer.Option(900.0, "--timeout", min=1.0, help="Wait timeout in seconds"),
):
    """Stop an agent (keeps DB record, destroys pod)."""
    _reject_self_target(agent_id, "stop")
    agent_id = _resolve_agent(agent_id)

    if not force:
        confirm = typer.confirm(f"Stop agent {agent_id[:12]}?")
        if not confirm:
            raise typer.Exit(0)

    agents = _get_deployments_client()

    try:
        pod = agents.stop(agent_id)
        if wait:
            pod = agents.wait_for_state(agent_id, {"stopped"}, timeout=timeout)
    except Exception as e:
        console.print(f"[red]❌ Failed to stop agent: {e}[/red]")
        raise typer.Exit(1)

    _save_agent_state(pod)
    if str(pod.state or "").lower() == "stopped":
        console.print("[green]✅ Agent stopped[/green]")
        console.print(f"Restart with: [bold]hyper agents start {agent_id[:8]}[/bold]")
    else:
        console.print("[yellow]✓ Agent stopping; runtime cleanup is still in progress.[/yellow]")
        console.print(f"Wait for completion: [bold]hyper agents stop {agent_id[:8]} --force --wait[/bold]")


@app.command("restore")
def restore(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
):
    """Restore a stopped agent from its archived state."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    try:
        pod = agents.restore(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to restore agent: {e}[/red]")
        raise typer.Exit(1)

    _save_agent_state(pod)
    console.print(f"[green]✓[/green] Agent restoring: {getattr(pod, 'name', None) or pod.id}")


@app.command("archive")
def archive(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
):
    """Archive a stopped agent's durable workspace without launching it."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    try:
        pod = agents.archive(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to archive agent: {e}[/red]")
        raise typer.Exit(1)

    _save_agent_state(pod)
    console.print(f"[green]✓[/green] Agent archiving: {getattr(pod, 'name', None) or pod.id}")


@app.command("delete")
def delete(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation"),
):
    """Delete an agent entirely (pod + record)."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    try:
        agent_id = agents.resolve_agent_id(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to resolve agent: {e}[/red]")
        raise typer.Exit(1)

    if not force:
        confirm = typer.confirm(f"Permanently delete agent {agent_id[:12]}?")
        if not confirm:
            raise typer.Exit(0)

    try:
        agents.delete(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to delete agent: {e}[/red]")
        raise typer.Exit(1)

    _remove_agent_state(agent_id)
    console.print(f"[green]✅ Agent {agent_id[:12]} deleted[/green]")


@app.command("exec")
def exec_cmd(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
    command: list[str] = typer.Argument(..., help="Executable followed by arguments"),
    timeout: int = typer.Option(30, "--timeout", "-t", help="Command timeout (seconds)"),
):
    """Execute a command through the Backend one-shot WebSocket."""
    agent_id = _resolve_agent(agent_id)

    try:
        pod = _get_agent_with_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)

    agents = _get_deployments_client()

    try:
        result = agents.exec(pod, command, timeout=timeout)
    except Exception as e:
        console.print(f"[red]❌ Exec failed: {e}[/red]")
        raise typer.Exit(1)

    if result.stdout:
        sys.stdout.write(result.stdout)
        if not result.stdout.endswith("\n"):
            sys.stdout.write("\n")
    if result.stderr:
        sys.stderr.write(result.stderr)
        if not result.stderr.endswith("\n"):
            sys.stderr.write("\n")

    raise typer.Exit(result.exit_code)


async def _read_agent_shell_output(ws) -> None:
    async for msg in ws:
        if isinstance(msg, str):
            sys.stdout.write(msg)
            sys.stdout.flush()
        elif isinstance(msg, bytes):
            sys.stdout.buffer.write(msg)
            sys.stdout.buffer.flush()

    close_code = getattr(ws, "close_code", None)
    if close_code != 1000:
        close_reason = str(getattr(ws, "close_reason", "") or "")
        suffix = f": {close_reason}" if close_reason else ""
        raise RuntimeError(f"Shell WebSocket closed with code {close_code}{suffix}")


@app.command("cp")
def cp(
    source: str = typer.Argument(..., help="Local path or AGENT_ID:remote_path"),
    destination: str = typer.Argument(..., help="Local path or AGENT_ID:remote_path"),
):
    """Copy files to or from an agent."""
    src_agent_id, src_path = _parse_cp_target(source)
    dst_agent_id, dst_path = _parse_cp_target(destination)

    if bool(src_agent_id) == bool(dst_agent_id):
        raise typer.BadParameter("Exactly one side must be remote (AGENT_ID:PATH).")

    agents = _get_deployments_client()

    try:
        if dst_agent_id:
            local_size = Path(src_path).stat().st_size
            if local_size > AGENT_FILE_MAX_BYTES:
                raise ValueError(f"Agent file writes are limited to {AGENT_FILE_MAX_BYTES // 1024 // 1024} MiB")
            pod = _get_agent_with_token(dst_agent_id)
            agents.cp_to(pod, src_path, dst_path)
            console.print(f"[green]✓[/green] Copied [bold]{src_path}[/bold] to [bold]{dst_agent_id[:12]}:{dst_path}[/bold]")
        else:
            pod = _get_agent_with_token(src_agent_id)
            local_path = agents.cp_from(pod, src_path, dst_path)
            console.print(f"[green]✓[/green] Copied [bold]{src_agent_id[:12]}:{src_path}[/bold] to [bold]{local_path}[/bold]")
    except Exception as e:
        message = str(e)
        if message.startswith("Path is a directory:"):
            message = f"{message} Copy expects a file path, not a directory."
        console.print(f"[red]❌ Copy failed: {message}[/red]")
        raise typer.Exit(1)


@app.command("shell")
def shell(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
):
    """Open an interactive shell on an agent pod (WebSocket PTY).

    Connects via the HyperCLI backend WebSocket proxy. Press Ctrl+] to disconnect.
    """
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    console.print(f"[dim]Connecting to shell...[/dim]")

    try:
        import asyncio
        import termios
        import tty
    except ImportError:
        console.print("[red]❌ TTY libraries required[/red]")
        raise typer.Exit(1)

    async def _run_shell():
        # Connect via backend WebSocket
        ws = await agents.shell_connect(agent_id)

        try:
            console.print("[green]Connected.[/green] Ctrl+] to disconnect.\n")

            old_settings = termios.tcgetattr(sys.stdin)
            try:
                tty.setraw(sys.stdin.fileno())

                import shutil
                cols, rows = shutil.get_terminal_size()
                await ws.send(f"\x1b[8;{rows};{cols}t")

                async def read_stdin():
                    loop = asyncio.get_event_loop()
                    try:
                        while True:
                            data = await loop.run_in_executor(None, lambda: os.read(sys.stdin.fileno(), 1024))
                            if not data:
                                break
                            if b"\x1d" in data:  # Ctrl+]
                                break
                            await ws.send(data.decode(errors="replace"))
                    except Exception:
                        pass

                done, pending = await asyncio.wait(
                    [
                        asyncio.create_task(_read_agent_shell_output(ws)),
                        asyncio.create_task(read_stdin()),
                    ],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    task.result()
            finally:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                console.print("\n[dim]Disconnected.[/dim]")
        finally:
            await ws.close()

    try:
        asyncio.run(_run_shell())
    except KeyboardInterrupt:
        console.print("\n[dim]Disconnected.[/dim]")
    except Exception as e:
        console.print(f"[red]❌ Shell failed: {e}[/red]")
        raise typer.Exit(1)


@app.command("logs")
def logs(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
    lines: int = typer.Option(100, "-n", "--lines", help="Number of lines to show"),
    follow: bool = typer.Option(
        False,
        "--follow/--no-follow",
        "-f",
        help="Follow log output (default: print recent logs and exit)",
    ),
):
    """Show recent logs from an agent (use -f to follow the stream)."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    import asyncio

    async def _stream_ws():
        try:
            async for line in agents.logs_stream_ws(
                agent_id,
                tail_lines=lines,
                follow=follow,
            ):
                console.print(line, markup=False, highlight=False, soft_wrap=True)
        except KeyboardInterrupt:
            pass
        except Exception as e:
            console.print(f"[red]❌ Logs failed: {e}[/red]")
            raise typer.Exit(1)

    try:
        asyncio.run(_stream_ws())
    except KeyboardInterrupt:
        pass


@app.command("token")
def token(
    agent_id: str = typer.Argument(..., help="Agent ID, unique name, handle, hostname, or prefix"),
):
    """Refresh the JWT token for an agent."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    try:
        agent_id = agents.resolve_agent_id(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to resolve agent: {e}[/red]")
        raise typer.Exit(1)

    try:
        result = agents.refresh_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to refresh token: {e}[/red]")
        raise typer.Exit(1)

    state = _load_state()
    if agent_id in state:
        state[agent_id]["jwt_token"] = result.get("token", "")
        _write_state(state)

    console.print(f"[green]✅ Token refreshed[/green]")
    console.print(f"  Expires: {result.get('expires_at', 'unknown')}")


# ---------------------------------------------------------------------------
# Gateway commands (OpenClaw Gateway RPC via WebSocket)
# ---------------------------------------------------------------------------

def _run_async(coro):
    """Run an async coroutine from sync CLI."""
    import asyncio
    return asyncio.run(coro)


@app.command("config")
def gateway_config(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    schema: bool = typer.Option(False, "--schema", help="Show config schema instead of current config"),
):
    """Get the OpenClaw gateway config for an agent."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        result = await (pod.config_schema() if schema else pod.config_get())
        console.print_json(json.dumps(result, default=str))

    _run_async(_run())


@app.command("config-patch")
def gateway_config_patch(
    agent_id: str = typer.Argument(..., help="Agent ID or name"),
    patch: str = typer.Argument(..., help="JSON patch to apply"),
):
    """Patch the OpenClaw gateway config (merges with existing). Restarts gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))
    patch_data = json.loads(patch)

    async def _run():
        await pod.config_patch(patch_data)
        console.print("[green]✅ Config patched. Gateway restarting.[/green]")

    _run_async(_run())


@app.command("models")
def gateway_models(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
):
    """List available models on an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        models = await pod.models_list()
        if not models:
            console.print("[dim]No models configured[/dim]")
            return
        for m in models:
            ctx = m.get("contextWindow", "?")
            console.print(f"  {m['provider']}/{m['name']}  (ctx={ctx})")

    _run_async(_run())


@app.command("files")
def gateway_files(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    get: str = typer.Option(None, "--get", help="Read a specific file"),
    set_file: str = typer.Option(None, "--set", help="Write a file (name=content)"),
):
    """List or read/write workspace files on an agent via Gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        if get:
            content = await pod.file_get(get)
            console.print(content)
        elif set_file:
            name, _, content = set_file.partition("=")
            if not content:
                console.print("[red]Usage: --set 'SOUL.md=# My Agent'[/red]")
                raise typer.Exit(1)
            await pod.file_set(name, content)
            console.print(f"[green]✅ Written {name}[/green]")
        else:
            _, files = await pod.workspace_files()
            if not files:
                console.print("[dim]No workspace files[/dim]")
                return
            for f in files:
                icon = "📄" if not f.get("missing") else "❌"
                size = f.get("size", 0)
                console.print(f"  {icon} {f['name']:30s} {size:>8,} bytes")

    _run_async(_run())


@app.command("sessions")
def gateway_sessions(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    limit: int = typer.Option(20, "--limit", "-n"),
):
    """List chat sessions on an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        sessions = await pod.sessions_list(limit=limit)
        if not sessions:
            console.print("[dim]No sessions[/dim]")
            return
        for s in sessions:
            console.print(f"  {s.get('key','?'):20s}  {s.get('status','?'):10s}  {s.get('lastActivity','')}")

    _run_async(_run())


@app.command("cron")
def gateway_cron(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
):
    """List cron jobs on an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        jobs = await pod.cron_list()
        if not jobs:
            console.print("[dim]No cron jobs[/dim]")
            return
        for j in jobs:
            enabled = "✅" if j.get("enabled", True) else "⏸️"
            console.print(f"  {enabled} {j.get('id','?'):20s}  {j.get('name','unnamed'):20s}  {j.get('schedule','')}")

    _run_async(_run())


@app.command("cron-add")
def gateway_cron_add(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    job_json: str = typer.Argument(..., help='Cron job JSON, e.g. \'{"name":"backup","schedule":"0 * * * *","command":"echo hi"}\''),
):
    """Add a cron job to an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))
    try:
        job_data = json.loads(job_json)
    except json.JSONDecodeError as e:
        console.print(f"[red]Invalid JSON: {e}[/red]")
        raise typer.Exit(1)

    async def _run():
        result = await pod.cron_add(job_data)
        console.print(f"[green]Cron job added[/green]")
        console.print_json(json.dumps(result, default=str))

    _run_async(_run())


@app.command("cron-remove")
def gateway_cron_remove(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    job_id: str = typer.Argument(..., help="Cron job ID to remove"),
):
    """Remove a cron job from an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        await pod.cron_remove(job_id)
        console.print(f"[green]Cron job {job_id} removed[/green]")

    _run_async(_run())


@app.command("cron-run")
def gateway_cron_run(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    job_id: str = typer.Argument(..., help="Cron job ID to trigger"),
):
    """Manually trigger a cron job on an agent's gateway."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        result = await pod.cron_run(job_id)
        console.print(f"[green]Cron job {job_id} triggered[/green]")
        if result:
            console.print_json(json.dumps(result, default=str))

    _run_async(_run())


@app.command("gateway-chat")
def gateway_chat(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    message: str = typer.Argument(..., help="Message to send"),
    session_key: str = typer.Option("main", "--session-key", help="Gateway chat session key"),
):
    """Send a chat message to an agent via the Gateway and stream the response."""
    pod = _require_openclaw_agent(_get_agent_with_token(agent_id))

    async def _run():
        async for event in pod.chat_send(message, session_key=session_key):
            if event.type == "content":
                print(event.text, end="", flush=True)
            elif event.type == "thinking":
                console.print(f"[dim]{event.text}[/dim]", end="")
            elif event.type == "tool_call":
                console.print(f"\n[yellow]🔧 {event.data}[/yellow]")
            elif event.type == "tool_result":
                console.print(f"\n[cyan]📤 {event.data}[/cyan]")
            elif event.type == "error":
                console.print(f"\n[red]❌ {event.text}[/red]")
            elif event.type == "done":
                print()
        print()

    _run_async(_run())
