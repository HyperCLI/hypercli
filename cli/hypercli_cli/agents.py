"""HyperClaw deployments CLI."""
from __future__ import annotations

import json
import os
import shlex
import sys
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from hypercli.agents import Agent, Deployments, OpenClawAgent, DEFAULT_OPENCLAW_IMAGE

app = typer.Typer(help="Manage OpenClaw agent pods")
console = Console()
PROD_API_BASE = "https://api.hypercli.com"
DEV_API_BASE = "https://api.dev.hypercli.com"
_GLOBAL_DEV = False
_GLOBAL_AGENTS_WS_URL: str | None = None

# Config — uses HyperClaw API key (sk-...) for backend auth
AGENT_KEY_PATH = Path.home() / ".hypercli" / "agent-key.json"
STATE_DIR = Path.home() / ".hypercli"
AGENTS_STATE = STATE_DIR / "agents.json"


def _default_openclaw_image(image: str | None, config: dict | None = None) -> str:
    if image:
        return image
    configured = str((config or {}).get("image") or "").strip()
    return configured or DEFAULT_OPENCLAW_IMAGE


@app.callback()
def agents_root(
    dev: bool = typer.Option(False, "--dev", help="Use the dev HyperClaw agents API"),
    agents_ws_url: str = typer.Option(None, "--agents-ws-url", help="Direct agents WebSocket base URL"),
):
    """Global options for agents commands."""
    global _GLOBAL_DEV, _GLOBAL_AGENTS_WS_URL
    _GLOBAL_DEV = dev
    _GLOBAL_AGENTS_WS_URL = agents_ws_url


def _get_agent_api_key() -> str:
    """Resolve HyperClaw API key from env or saved key file."""
    key = os.environ.get("HYPER_AGENTS_API_KEY", "").strip()
    if key:
        return key
    key = os.environ.get("HYPER_API_KEY", "").strip()
    if key:
        return key
    if AGENT_KEY_PATH.exists():
        with open(AGENT_KEY_PATH) as f:
            data = json.load(f)
        key = data.get("key", "")
        if key:
            return key
    console.print("[red]❌ No HyperClaw API key found.[/red]")
    console.print("Set HYPER_AGENTS_API_KEY or HYPER_API_KEY, or subscribe: [bold]hyper agent subscribe 1aiu[/bold]")
    raise typer.Exit(1)


def _get_deployments_client(agents_ws_url: str | None = None) -> Deployments:
    """Create a Deployments client using the HyperClaw API key."""
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


def _save_pod_state(pod: Agent):
    """Save pod info locally for quick reference."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    existing = state.get(pod.id, {})
    state[pod.id] = {
        "id": pod.id,
        "pod_id": pod.pod_id,
        "pod_name": pod.pod_name,
        "user_id": pod.user_id,
        "hostname": pod.hostname,
        "jwt_token": pod.jwt_token or existing.get("jwt_token"),
        "gateway_token": (
            pod.gateway_token if isinstance(pod, OpenClawAgent) else existing.get("gateway_token")
        ),
        "launch_config": pod.launch_config if pod.launch_config is not None else existing.get("launch_config"),
        "state": pod.state,
    }
    with open(AGENTS_STATE, "w") as f:
        json.dump(state, f, indent=2, default=str)


def _load_state() -> dict:
    if AGENTS_STATE.exists():
        with open(AGENTS_STATE) as f:
            return json.load(f)
    return {}


def _remove_pod_state(agent_id: str):
    state = _load_state()
    state.pop(agent_id, None)
    with open(AGENTS_STATE, "w") as f:
        json.dump(state, f, indent=2, default=str)


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
            console.print(f"  {m[:12]}  {s.get('pod_name', '')}  {s.get('state', '')}")
        raise typer.Exit(1)
    return agent_id


def _get_pod_with_token(agent_id: str) -> Agent:
    """Get an agent, filling JWT from local state if needed."""
    resolved_agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    pod = agents.get(resolved_agent_id)
    state = _load_state()
    local = state.get(resolved_agent_id, {})
    if not pod.jwt_token and local.get("jwt_token"):
        pod.jwt_token = local["jwt_token"]
    if isinstance(pod, OpenClawAgent) and not pod.gateway_token and local.get("gateway_token"):
        pod.gateway_token = local["gateway_token"]
    if pod.launch_config is None and local.get("launch_config") is not None:
        pod.launch_config = local["launch_config"]
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


def _parse_ports(values: list[str] | None) -> list[dict] | None:
    """Parse repeated --port PORT[:noauth] options."""
    if not values:
        return None
    ports: list[dict] = []
    for item in values:
        if ":" in item:
            port_text, suffix = item.split(":", 1)
            if suffix != "noauth":
                raise typer.BadParameter(
                    f"Invalid --port '{item}'. Expected PORT or PORT:noauth."
                )
            auth = False
        else:
            port_text = item
            auth = True

        try:
            port_num = int(port_text)
        except ValueError as e:
            raise typer.BadParameter(
                f"Invalid --port '{item}'. PORT must be an integer."
            ) from e

        if port_num < 1 or port_num > 65535:
            raise typer.BadParameter(
                f"Invalid --port '{item}'. PORT must be between 1 and 65535."
            )

        ports.append({"port": port_num, "auth": auth})
    return ports


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


def _port_url(pod: Agent, port: dict) -> str:
    if port.get("url"):
        return str(port["url"])
    hostname = pod.hostname or ""
    prefix = port.get("prefix")
    if hostname and prefix:
        return f"https://{prefix}-{hostname}"
    if hostname:
        return f"https://{hostname}"
    return ""


def _port_summary(port: dict) -> str:
    auth_text = "auth" if port.get("auth", True) else "noauth"
    return f"{port.get('port', '?')} ({auth_text})"


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

    console.print(f"\n[bold]Agent Resource Budget[/bold] ({data.get('plan_id', '')})")
    console.print(f"  Agents:  {u.get('agents', 0)}/{b.get('max_agents', 0)} ({a.get('agents', 0)} available)")
    console.print(f"  CPU:     {u.get('cpu', 0)}/{b.get('total_cpu', 0)} cores ({a.get('cpu', 0)} available)")
    console.print(f"  Memory:  {u.get('memory', 0)}/{b.get('total_memory', 0)} GB ({a.get('memory', 0)} available)")

    presets = data.get("size_presets", {})
    if presets:
        console.print("\n[bold]Size Presets:[/bold]")
        for name, spec in presets.items():
            console.print(f"  {name:8s} — {spec['cpu']} CPU, {spec['memory']} GB")
    console.print()


@app.command("create")
def create(
    name: str = typer.Option(None, "--name", "-n", help="Agent name (auto-generated if omitted, becomes {name}.hypercli.com)"),
    size: str = typer.Option(None, "--size", "-s", help="Size preset: small, medium, large"),
    env: list[str] = typer.Option(None, "--env", "-e", help="Environment variable (KEY=VALUE). Repeatable."),
    port: list[str] = typer.Option(None, "--port", help="Expose port as PORT or PORT:noauth. Repeatable."),
    command: str = typer.Option(None, "--command", help="Container args as a shell-style string"),
    entrypoint: str = typer.Option(None, "--entrypoint", help="Container entrypoint as a shell-style string"),
    image: str = typer.Option(None, "--image", help="Override the default OpenClaw image"),
    registry_url: str = typer.Option(None, "--registry-url", help="Container registry URL for private image pulls"),
    registry_username: str = typer.Option(None, "--registry-username", help="Registry username"),
    registry_password: str = typer.Option(None, "--registry-password", help="Registry password"),
    gateway_token: str = typer.Option(None, "--gateway-token", help="OpenClaw gateway token override"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate launch configuration without creating the agent or pod"),
    no_start: bool = typer.Option(False, "--no-start", help="Create without starting"),
    wait: bool = typer.Option(True, "--wait/--no-wait", help="Wait for pod to be running"),
):
    """Create a new OpenClaw agent pod."""
    agents = _get_deployments_client()
    env_dict = _parse_env_vars(env)
    ports_list = _parse_ports(port)
    command_argv = _parse_argv_option(command, "--command")
    entrypoint_argv = _parse_argv_option(entrypoint, "--entrypoint")
    registry_auth = _build_registry_auth(registry_username, registry_password)

    console.print("\n[bold]Creating agent pod...[/bold]")

    try:
        pod = agents.create(
            name=name,
            size=size,
            env=env_dict,
            ports=ports_list,
            command=command_argv,
            entrypoint=entrypoint_argv,
            image=_default_openclaw_image(image),
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
            dry_run=dry_run,
            start=not no_start,
        )
    except Exception as e:
        console.print(f"[red]❌ Create failed: {e}[/red]")
        raise typer.Exit(1)

    if not pod.dry_run:
        _save_pod_state(pod)

    console.print(f"[green]✓[/green] {'Agent launch validated' if pod.dry_run else 'Agent created'}: [bold]{pod.id[:12]}[/bold]")
    console.print(f"  Name:     {pod.name or pod.pod_name}")
    console.print(f"  Size:     {pod.cpu} CPU, {pod.memory} GB")
    console.print(f"  State:    {pod.state}")
    console.print(f"  Desktop:  {pod.vnc_url}")
    console.print(f"  Shell:    {'via hyper agents shell' if not pod.shell_url else pod.shell_url}")
    display_ports = pod.ports or ports_list or []
    for p in display_ports:
        auth_text = "auth" if p.get("auth", True) else "noauth"
        console.print(f"  Port {p.get('port')}:  {_port_url(pod, p)} ({auth_text})")

    if wait and not pod.dry_run:
        console.print("\n[dim]Waiting for pod to start...[/dim]")
        try:
            pod = agents.wait_running(pod.id, timeout=300, poll_interval=5)
            _save_pod_state(pod)
            console.print(f"[green]✅ Agent is running![/green]")
        except RuntimeError as e:
            console.print(f"[red]❌ Agent failed: {e}[/red]")
            raise typer.Exit(1)
        except TimeoutError:
            console.print("[yellow]⚠ Timed out (5 min). Pod may still be starting.[/yellow]")

    if pod.dry_run:
        console.print("\n[dim]Dry run only. No agent or pod was created.[/dim]")
    else:
        console.print(f"\nExec:    [bold]hyper agents exec {pod.id[:8]} 'echo hello'[/bold]")
        console.print(f"Shell:   [bold]hyper agents shell {pod.id[:8]}[/bold]")
        console.print(f"Desktop: {pod.vnc_url}")


@app.command("wait")
def wait_agent(
    agent_id: str = typer.Argument(None, help="Agent ID or name"),
    timeout: int = typer.Option(300, "--timeout", help="Seconds to wait for RUNNING"),
    poll_interval: float = typer.Option(5.0, "--poll-interval", help="Seconds between polls"),
):
    """Wait for an agent to reach RUNNING."""
    agents = _get_deployments_client()
    pod = _get_pod_with_token(agent_id)

    try:
        pod = agents.wait_running(pod.id, timeout=timeout, poll_interval=poll_interval)
    except RuntimeError as e:
        console.print(f"[red]❌ Agent failed: {e}[/red]")
        raise typer.Exit(1)
    except TimeoutError as e:
        console.print(f"[yellow]⚠ {e}[/yellow]")
        raise typer.Exit(1)

    _save_pod_state(pod)
    console.print(f"[green]✅ Agent is running:[/green] [bold]{pod.id[:12]}[/bold]")
    console.print(f"  Name:     {pod.name or pod.pod_name}")
    console.print(f"  State:    {pod.state}")
    console.print(f"  Desktop:  {pod.vnc_url}")
    console.print(f"  Shell:    {'via hyper agents shell' if not pod.shell_url else pod.shell_url}")


@app.command("list")
def list_agents(
    json_output: bool = typer.Option(False, "--json", help="JSON output"),
):
    """List all agent pods."""
    agents = _get_deployments_client()

    try:
        pods = agents.list()
    except Exception as e:
        console.print(f"[red]❌ Failed to list agents: {e}[/red]")
        raise typer.Exit(1)

    if json_output:
        console.print_json(json.dumps([{
            "id": p.id, "pod_name": p.pod_name, "state": p.state,
            "hostname": p.hostname, "vnc_url": p.vnc_url,
            "ports": p.ports,
        } for p in pods], indent=2, default=str))
        return

    if not pods:
        console.print("[dim]No agents found.[/dim]")
        console.print("Create one: [bold]hyper agents create[/bold]")
        return

    table = Table(title="Agents")
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Name", style="blue")
    table.add_column("Size")
    table.add_column("State")
    table.add_column("Desktop URL")
    has_ports = any(pod.ports for pod in pods)
    if has_ports:
        table.add_column("Ports")
    table.add_column("Created")

    for pod in pods:
        style = {"running": "green", "pending": "yellow", "starting": "yellow"}.get(pod.state, "red")
        created = pod.created_at.strftime("%Y-%m-%d %H:%M") if pod.created_at else ""
        size_str = f"{pod.cpu}c/{pod.memory}G" if pod.cpu else ""
        row = [
            pod.id[:12],
            pod.name or pod.pod_name or "",
            size_str,
            f"[{style}]{pod.state}[/{style}]",
            pod.vnc_url or "",
        ]
        if has_ports:
            ports_text = ", ".join(_port_summary(p) for p in pod.ports) if pod.ports else ""
            row.append(ports_text)
        row.append(created)
        table.add_row(*row)
        _save_pod_state(pod)

    console.print()
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

    _save_pod_state(pod)

    console.print(f"\n[bold]Agent {pod.id[:12]}[/bold]")
    console.print(f"  Name:       {pod.name or pod.pod_name}")
    console.print(f"  Pod:        {pod.pod_name}")
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
    if pod.last_error:
        console.print(f"  Error:      [red]{pod.last_error}[/red]")

    if pod.is_running and pod.executor_url:
        try:
            health = agents.health(pod)
            console.print(f"\n[bold]Executor:[/bold]")
            console.print(f"  Status:    {health.get('status', 'unknown')}")
            console.print(f"  Disk Free: {health.get('disk_free_mb', '?')} MB")
        except Exception as e:
            console.print(f"\n[dim]Executor not reachable: {e}[/dim]")


@app.command("start")
def start(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    env: list[str] = typer.Option(None, "--env", "-e", help="Environment variable override (KEY=VALUE). Repeatable."),
    port: list[str] = typer.Option(None, "--port", help="Expose port as PORT or PORT:noauth. Repeatable."),
    command: str = typer.Option(None, "--command", help="Container args as a shell-style string"),
    entrypoint: str = typer.Option(None, "--entrypoint", help="Container entrypoint as a shell-style string"),
    image: str = typer.Option(None, "--image", help="Override the default OpenClaw image"),
    registry_url: str = typer.Option(None, "--registry-url", help="Container registry URL for private image pulls"),
    registry_username: str = typer.Option(None, "--registry-username", help="Registry username"),
    registry_password: str = typer.Option(None, "--registry-password", help="Registry password"),
    gateway_token: str = typer.Option(None, "--gateway-token", help="OpenClaw gateway token override"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate launch configuration without starting the agent"),
):
    """Start a previously stopped agent."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()
    state = _load_state()
    local = state.get(agent_id, {})
    env_dict = _parse_env_vars(env)
    ports_list = _parse_ports(port)
    command_argv = _parse_argv_option(command, "--command")
    entrypoint_argv = _parse_argv_option(entrypoint, "--entrypoint")
    registry_auth = _build_registry_auth(registry_username, registry_password)
    launch_config = dict(local.get("launch_config") or {})
    effective_gateway_token = gateway_token or local.get("gateway_token")
    effective_image = _default_openclaw_image(image, launch_config)

    try:
        pod = agents.start(
            agent_id,
            config=launch_config,
            env=env_dict,
            ports=ports_list,
            command=command_argv,
            entrypoint=entrypoint_argv,
            image=effective_image,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=effective_gateway_token,
            dry_run=dry_run,
        )
    except Exception as e:
        console.print(f"[red]❌ Failed to start agent: {e}[/red]")
        raise typer.Exit(1)

    if not pod.dry_run:
        _save_pod_state(pod)
    console.print(f"[green]✓[/green] {'Agent start validated' if pod.dry_run else 'Agent starting'}: {pod.pod_name}")
    if pod.dry_run:
        console.print("  No pod was created.")
    else:
        console.print(f"  Desktop: {pod.vnc_url}")


@app.command("stop")
def stop(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation"),
):
    """Stop an agent (keeps DB record, destroys pod)."""
    agent_id = _resolve_agent(agent_id)

    if not force:
        confirm = typer.confirm(f"Stop agent {agent_id[:12]}?")
        if not confirm:
            raise typer.Exit(0)

    agents = _get_deployments_client()

    try:
        pod = agents.stop(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to stop agent: {e}[/red]")
        raise typer.Exit(1)

    _save_pod_state(pod)
    console.print(f"[green]✅ Agent stopped[/green]")
    console.print(f"Restart with: [bold]hyper agents start {agent_id[:8]}[/bold]")


@app.command("delete")
def delete(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation"),
):
    """Delete an agent entirely (pod + record)."""
    agent_id = _resolve_agent(agent_id)

    if not force:
        confirm = typer.confirm(f"Permanently delete agent {agent_id[:12]}?")
        if not confirm:
            raise typer.Exit(0)

    agents = _get_deployments_client()

    try:
        agents.delete(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to delete agent: {e}[/red]")
        raise typer.Exit(1)

    _remove_pod_state(agent_id)
    console.print(f"[green]✅ Agent {agent_id[:12]} deleted[/green]")


@app.command("exec")
def exec_cmd(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    command: str = typer.Argument(..., help="Command to execute"),
    timeout: int = typer.Option(30, "--timeout", "-t", help="Command timeout (seconds)"),
):
    """Execute a command on an agent pod."""
    agent_id = _resolve_agent(agent_id)

    try:
        pod = _get_pod_with_token(agent_id)
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
            pod = _get_pod_with_token(dst_agent_id)
            agents.cp_to(pod, src_path, dst_path)
            console.print(f"[green]✓[/green] Copied [bold]{src_path}[/bold] to [bold]{dst_agent_id[:12]}:{dst_path}[/bold]")
        else:
            pod = _get_pod_with_token(src_agent_id)
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
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
):
    """Open an interactive shell on an agent pod (WebSocket PTY).

    Connects via the HyperClaw backend WebSocket proxy. Press Ctrl+] to disconnect.
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

                async def read_ws():
                    try:
                        async for msg in ws:
                            if isinstance(msg, str):
                                sys.stdout.write(msg)
                                sys.stdout.flush()
                            elif isinstance(msg, bytes):
                                sys.stdout.buffer.write(msg)
                                sys.stdout.buffer.flush()
                    except Exception:
                        pass

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
                    [asyncio.create_task(read_ws()), asyncio.create_task(read_stdin())],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()
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
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    lines: int = typer.Option(100, "-n", "--lines", help="Number of lines to show"),
    follow: bool = typer.Option(True, "-f/--no-follow", help="Follow log output"),
    ws: bool = typer.Option(False, "--ws", help="Use WebSocket instead of SSE (via backend)"),
):
    """Stream logs from an agent pod."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    if ws:
        # WebSocket mode via backend
        import asyncio

        async def _stream_ws():
            try:
                async for line in agents.logs_stream_ws(agent_id, tail_lines=lines):
                    console.print(line)
            except KeyboardInterrupt:
                pass
            except Exception as e:
                console.print(f"[red]❌ Logs failed: {e}[/red]")
                raise typer.Exit(1)

        try:
            asyncio.run(_stream_ws())
        except KeyboardInterrupt:
            pass
    else:
        # SSE mode via executor (legacy)
        try:
            pod = _get_pod_with_token(agent_id)
        except Exception as e:
            console.print(f"[red]❌ Failed to get agent: {e}[/red]")
            raise typer.Exit(1)

        try:
            for line in agents.logs_stream(pod, lines=lines, follow=follow):
                console.print(line)
        except KeyboardInterrupt:
            pass
        except Exception as e:
            console.print(f"[red]❌ Logs failed: {e}[/red]")
            raise typer.Exit(1)


@app.command("chat")
def chat(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    model: str = typer.Option("hyperclaw/kimi-k2.5", "--model", "-m", help="Model to use"),
):
    """Interactive chat with an agent's OpenClaw instance.

    Connects to the OpenClaw gateway running inside the agent pod.
    Type your messages, get streaming responses. Ctrl+C or 'exit' to quit.
    """
    agent_id = _resolve_agent(agent_id)

    try:
        pod = _get_pod_with_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)

    agents = _get_deployments_client()
    messages = []

    console.print(f"\n[bold]Chat with agent {pod.pod_name}[/bold] (model: {model})")
    console.print("[dim]Type your message. 'exit' or Ctrl+C to quit.[/dim]\n")

    while True:
        try:
            user_input = console.input("[bold cyan]> [/bold cyan]")
        except (EOFError, KeyboardInterrupt):
            console.print("\n[dim]Bye.[/dim]")
            break

        user_input = user_input.strip()
        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "/exit", "/quit"):
            console.print("[dim]Bye.[/dim]")
            break

        messages.append({"role": "user", "content": user_input})

        try:
            full_response = ""
            for chunk in agents.chat_stream(pod, messages, model=model):
                sys.stdout.write(chunk)
                sys.stdout.flush()
                full_response += chunk
            sys.stdout.write("\n\n")
            sys.stdout.flush()

            messages.append({"role": "assistant", "content": full_response})
        except KeyboardInterrupt:
            sys.stdout.write("\n")
            continue
        except Exception as e:
            console.print(f"\n[red]Error: {e}[/red]\n")
            # Remove failed user message
            messages.pop()


@app.command("token")
def token(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
):
    """Refresh the JWT token for an agent."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_deployments_client()

    try:
        result = agents.refresh_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to refresh token: {e}[/red]")
        raise typer.Exit(1)

    state = _load_state()
    if agent_id in state:
        state[agent_id]["jwt_token"] = result.get("token", "")
        with open(AGENTS_STATE, "w") as f:
            json.dump(state, f, indent=2, default=str)

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))
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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))
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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
    pod = _require_openclaw_agent(_get_pod_with_token(agent_id))

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
