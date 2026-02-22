"""HyperClaw Agents — Reef Pod Management CLI"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from hypercli.agents import Agents, ReefPod

app = typer.Typer(help="Manage OpenClaw agent pods (reef containers)")
console = Console()

# Config — uses HyperClaw API key (sk-...) for backend auth
CLAW_KEY_PATH = Path.home() / ".hypercli" / "claw-key.json"
STATE_DIR = Path.home() / ".hypercli"
AGENTS_STATE = STATE_DIR / "agents.json"


def _get_claw_api_key() -> str:
    """Resolve HyperClaw API key from env or saved key file."""
    key = os.environ.get("HYPERCLAW_API_KEY", "")
    if key:
        return key
    if CLAW_KEY_PATH.exists():
        with open(CLAW_KEY_PATH) as f:
            data = json.load(f)
        key = data.get("key", "")
        if key:
            return key
    console.print("[red]❌ No HyperClaw API key found.[/red]")
    console.print("Set HYPERCLAW_API_KEY or subscribe: [bold]hyper claw subscribe 1aiu[/bold]")
    raise typer.Exit(1)


def _get_agents_client() -> Agents:
    """Create an Agents client using the HyperClaw API key."""
    from hypercli.http import HTTPClient
    api_key = _get_claw_api_key()
    api_base = os.environ.get("HYPERCLAW_API_BASE", "https://api.hyperclaw.app")
    http = HTTPClient(api_base, api_key)
    return Agents(http, claw_api_key=api_key, claw_api_base=api_base)


def _save_pod_state(pod: ReefPod):
    """Save pod info locally for quick reference."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    state[pod.id] = {
        "id": pod.id,
        "pod_id": pod.pod_id,
        "pod_name": pod.pod_name,
        "user_id": pod.user_id,
        "hostname": pod.hostname,
        "jwt_token": pod.jwt_token,
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


def _get_pod_with_token(agent_id: str) -> ReefPod:
    """Get a ReefPod, filling JWT from local state if needed."""
    agents = _get_agents_client()
    pod = agents.get(agent_id)
    if not pod.jwt_token:
        state = _load_state()
        local = state.get(agent_id, {})
        if local.get("jwt_token"):
            pod.jwt_token = local["jwt_token"]
    return pod


@app.command("budget")
def budget():
    """Show your agent resource budget and usage."""
    agents = _get_agents_client()

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
    name: str = typer.Option("agent", "--name", "-n", help="Agent name"),
    size: str = typer.Option(None, "--size", "-s", help="Size preset: small, medium, large"),
    cpu: int = typer.Option(None, "--cpu", help="Custom CPU in cores"),
    memory: int = typer.Option(None, "--memory", help="Custom memory in GB"),
    no_start: bool = typer.Option(False, "--no-start", help="Create without starting"),
    wait: bool = typer.Option(True, "--wait/--no-wait", help="Wait for pod to be running"),
):
    """Create a new OpenClaw agent pod."""
    agents = _get_agents_client()

    console.print("\n[bold]Creating agent pod...[/bold]")

    try:
        pod = agents.create(name=name, size=size, cpu=cpu, memory=memory, start=not no_start)
    except Exception as e:
        console.print(f"[red]❌ Create failed: {e}[/red]")
        raise typer.Exit(1)

    _save_pod_state(pod)

    console.print(f"[green]✓[/green] Agent created: [bold]{pod.id[:12]}[/bold]")
    console.print(f"  Name:     {pod.name or pod.pod_name}")
    console.print(f"  Size:     {pod.cpu} CPU, {pod.memory} GB")
    console.print(f"  State:    {pod.state}")
    console.print(f"  Desktop:  {pod.vnc_url}")
    console.print(f"  Shell:    {pod.shell_url}")

    if wait:
        console.print("\n[dim]Waiting for pod to start...[/dim]")
        for i in range(60):
            time.sleep(5)
            try:
                pod = agents.get(pod.id)
                _save_pod_state(pod)
                if pod.is_running:
                    console.print(f"[green]✅ Agent is running![/green]")
                    break
                elif pod.state in ("failed", "stopped"):
                    console.print(f"[red]❌ Agent failed: {pod.state}[/red]")
                    if pod.last_error:
                        console.print(f"  Error: {pod.last_error}")
                    raise typer.Exit(1)
                else:
                    console.print(f"  [{i*5}s] State: {pod.state}")
            except typer.Exit:
                raise
            except Exception as e:
                console.print(f"  [{i*5}s] Checking... ({e})")
        else:
            console.print("[yellow]⚠ Timed out (5 min). Pod may still be starting.[/yellow]")

    console.print(f"\nExec:    [bold]hyper agents exec {pod.id[:8]} 'echo hello'[/bold]")
    console.print(f"Shell:   [bold]hyper agents shell {pod.id[:8]}[/bold]")
    console.print(f"Desktop: {pod.vnc_url}")


@app.command("list")
def list_agents(
    json_output: bool = typer.Option(False, "--json", help="JSON output"),
):
    """List all agent pods."""
    agents = _get_agents_client()

    try:
        pods = agents.list()
    except Exception as e:
        console.print(f"[red]❌ Failed to list agents: {e}[/red]")
        raise typer.Exit(1)

    if json_output:
        console.print_json(json.dumps([{
            "id": p.id, "pod_name": p.pod_name, "state": p.state,
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
    table.add_column("Size")
    table.add_column("State")
    table.add_column("Desktop URL")
    table.add_column("Created")

    for pod in pods:
        style = {"running": "green", "pending": "yellow", "starting": "yellow"}.get(pod.state, "red")
        created = pod.created_at.strftime("%Y-%m-%d %H:%M") if pod.created_at else ""
        size_str = f"{pod.cpu}c/{pod.memory}G" if pod.cpu else ""
        table.add_row(
            pod.id[:12],
            pod.name or pod.pod_name or "",
            size_str,
            f"[{style}]{pod.state}[/{style}]",
            pod.vnc_url or "",
            created,
        )
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
    agents = _get_agents_client()

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
    console.print(f"  Shell:      {pod.shell_url}")
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
):
    """Start a previously stopped agent."""
    agent_id = _resolve_agent(agent_id)
    agents = _get_agents_client()

    try:
        pod = agents.start(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to start agent: {e}[/red]")
        raise typer.Exit(1)

    _save_pod_state(pod)
    console.print(f"[green]✓[/green] Agent starting: {pod.pod_name}")
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

    agents = _get_agents_client()

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

    agents = _get_agents_client()

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

    agents = _get_agents_client()

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


@app.command("shell")
def shell(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
):
    """Open an interactive shell on an agent pod (WebSocket PTY).

    Connects to the executor's /shell endpoint. Press Ctrl+] to disconnect.
    """
    agent_id = _resolve_agent(agent_id)

    try:
        pod = _get_pod_with_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)

    if not pod.executor_url:
        console.print("[red]❌ Agent has no executor URL[/red]")
        raise typer.Exit(1)

    ws_url = pod.executor_url.replace("https://", "wss://").replace("http://", "ws://")
    ws_url = f"{ws_url}/shell"

    console.print(f"[dim]Connecting to {ws_url}...[/dim]")

    try:
        import websockets
        import asyncio
        import termios
        import tty
    except ImportError:
        console.print("[red]❌ 'websockets' required: pip install websockets[/red]")
        raise typer.Exit(1)

    async def _run_shell():
        headers = {}
        if pod.jwt_token:
            headers["Authorization"] = f"Bearer {pod.jwt_token}"
            headers["Cookie"] = f"{pod.pod_name}-token={pod.jwt_token}"

        async with websockets.connect(ws_url, additional_headers=headers) as ws:
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
                    except websockets.ConnectionClosed:
                        pass

                async def read_stdin():
                    loop = asyncio.get_event_loop()
                    try:
                        while True:
                            data = await loop.run_in_executor(None, lambda: os.read(sys.stdin.fileno(), 1024))
                            if not data:
                                break
                            if b"\x1d" in data:
                                break
                            await ws.send(data.decode(errors="replace"))
                    except (websockets.ConnectionClosed, OSError):
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
):
    """Stream logs from an agent pod."""
    agent_id = _resolve_agent(agent_id)

    try:
        pod = _get_pod_with_token(agent_id)
    except Exception as e:
        console.print(f"[red]❌ Failed to get agent: {e}[/red]")
        raise typer.Exit(1)

    agents = _get_agents_client()

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

    agents = _get_agents_client()
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
    agents = _get_agents_client()

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
