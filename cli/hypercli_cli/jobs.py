"""hyper jobs commands"""
import typer
from typing import Optional
from hypercli import HyperCLI
from .output import output, console, success, spinner

app = typer.Typer(help="Manage running jobs")


def get_client() -> HyperCLI:
    return HyperCLI()


def _resolve_job_id(client: HyperCLI, job_id: str) -> str:
    """Resolve a partial job ID prefix to a full UUID."""
    if len(job_id) == 36:
        return job_id
    jobs = client.jobs.list()
    matches = [j.job_id for j in jobs if j.job_id.startswith(job_id)]
    if len(matches) == 1:
        return matches[0]
    elif len(matches) == 0:
        console.print(f"[red]Error:[/red] No job matching '{job_id}' in recent jobs. Try the full UUID.")
        raise typer.Exit(1)
    else:
        console.print(f"[red]Error:[/red] Ambiguous prefix '{job_id}' — {len(matches)} matches:")
        for m in matches[:5]:
            console.print(f"  {m}")
        raise typer.Exit(1)


@app.command("list")
def list_jobs(
    state: Optional[str] = typer.Option(None, "--state", "-s", help="Filter by state"),
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """List all jobs"""
    client = get_client()
    with spinner("Fetching jobs..."):
        jobs = client.jobs.list(state=state)

    if fmt == "json":
        output(jobs, "json")
    else:
        if not jobs:
            console.print("[dim]No jobs found[/dim]")
            return
        output(jobs, "table", ["job_id", "state", "gpu_type", "gpu_count", "region", "hostname"])


@app.command("get")
def get_job(
    job_id: str = typer.Argument(..., help="Job ID"),
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Get job details"""
    client = get_client()
    job_id = _resolve_job_id(client, job_id)
    with spinner("Fetching job..."):
        job = client.jobs.get(job_id)
    output(job, fmt)


@app.command("logs")
def logs(
    job_id: str = typer.Argument(..., help="Job ID"),
    follow: bool = typer.Option(False, "--follow", "-f", help="Stream logs via WebSocket"),
    tail: int = typer.Option(None, "--tail", "-n", help="Show last N lines"),
    tui: bool = typer.Option(False, "--tui", help="Interactive TUI with metrics"),
    cancel_on_exit: bool = typer.Option(False, "--cancel-on-exit", help="Cancel job when exiting with Ctrl+C (with --tui)"),
):
    """Get job logs"""
    client = get_client()
    job_id = _resolve_job_id(client, job_id)

    if tui:
        _follow_job(job_id, cancel_on_exit=cancel_on_exit)
    elif follow:
        _stream_logs(job_id)
    else:
        logs_str = client.jobs.logs(job_id)
        if not logs_str:
            print("(no logs)")
            return
        lines = logs_str.rstrip("\n").split("\n")
        if tail:
            lines = lines[-tail:]
        for line in lines:
            print(line)


@app.command("metrics")
def metrics(
    job_id: str = typer.Argument(..., help="Job ID"),
    watch: bool = typer.Option(False, "--watch", "-w", help="Watch metrics live"),
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Get job GPU metrics"""
    client = get_client()
    job_id = _resolve_job_id(client, job_id)

    if watch:
        _watch_metrics(job_id)
    else:
        with spinner("Fetching metrics..."):
            m = client.jobs.metrics(job_id)
        if fmt == "json":
            output(m, "json")
        else:
            _print_metrics(m)


@app.command("cancel")
def cancel(
    job_id: str = typer.Argument(..., help="Job ID"),
):
    """Cancel a running job"""
    client = get_client()
    job_id = _resolve_job_id(client, job_id)
    with spinner("Cancelling job..."):
        client.jobs.cancel(job_id)
    success(f"Job {job_id} cancelled")


@app.command("extend")
def extend(
    job_id: str = typer.Argument(..., help="Job ID"),
    runtime: int = typer.Argument(..., help="New runtime in seconds"),
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Extend job runtime"""
    client = get_client()
    job_id = _resolve_job_id(client, job_id)
    with spinner("Extending runtime..."):
        job = client.jobs.extend(job_id, runtime)
    if fmt == "json":
        output(job, "json")
    else:
        success(f"Job extended to {runtime}s runtime")


def _print_metrics(m):
    """Print GPU metrics"""
    from rich.panel import Panel
    from rich.table import Table

    # System metrics (CPU/RAM)
    if m.system:
        sys_table = Table(show_header=False, box=None, padding=(0, 2))
        sys_table.add_column("Metric", style="cyan")
        sys_table.add_column("Value")
        sys_table.add_column("Bar", width=30)

        cpu_bar = _make_bar(m.system.cpu_percent, 100)
        mem_pct = (m.system.memory_used / m.system.memory_limit * 100) if m.system.memory_limit else 0
        mem_bar = _make_bar(mem_pct, 100)

        sys_table.add_row("CPU", f"{m.system.cpu_percent:5.1f}%", cpu_bar)
        sys_table.add_row("RAM", f"{m.system.memory_used/1024:.1f}/{m.system.memory_limit/1024:.1f} GB", mem_bar)

        console.print(Panel(sys_table, title="[bold]System[/bold]"))

    if not m.gpus:
        console.print("[dim]No GPU metrics available[/dim]")
        return

    for gpu in m.gpus:
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column("Metric", style="cyan")
        table.add_column("Value")
        table.add_column("Bar", width=30)

        util_bar = _make_bar(gpu.utilization, 100)
        mem_pct = (gpu.memory_used / gpu.memory_total * 100) if gpu.memory_total else 0
        mem_bar = _make_bar(mem_pct, 100)
        temp_bar = _make_bar(gpu.temperature, 100, warn=70, crit=85)

        table.add_row("GPU", f"{gpu.utilization:5.1f}%", util_bar)
        table.add_row("VRAM", f"{gpu.memory_used/1024:.1f}/{gpu.memory_total/1024:.1f} GB", mem_bar)
        table.add_row("Temp", f"{gpu.temperature}°C", temp_bar)
        table.add_row("Power", f"{gpu.power_draw:.0f}W", "")

        title = f"[bold]GPU {gpu.index}: {gpu.name}[/bold]" if gpu.name else f"[bold]GPU {gpu.index}[/bold]"
        console.print(Panel(table, title=title))


def _make_bar(value: float, max_val: float, warn: float = None, crit: float = None) -> str:
    """Create a colored progress bar"""
    pct = min(value / max_val, 1.0) if max_val else 0
    width = 25
    filled = int(pct * width)

    if crit and value >= crit:
        color = "red"
    elif warn and value >= warn:
        color = "yellow"
    else:
        color = "green"

    bar = "█" * filled + "░" * (width - filled)
    return f"[{color}]{bar}[/{color}]"


def _stream_logs(job_id: str):
    """Stream logs via WebSocket (like tail -f)"""
    import asyncio
    from hypercli import stream_logs

    client = get_client()

    async def _run():
        try:
            await stream_logs(
                client,
                job_id,
                on_line=lambda line: print(line),
                fetch_initial=True,
                fetch_final=True,
            )
        except KeyboardInterrupt:
            pass

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


def _follow_job(job_id: str, cancel_on_exit: bool = False):
    """Follow job with TUI"""
    from .tui.job_monitor import run_job_monitor
    run_job_monitor(job_id, cancel_on_exit=cancel_on_exit)


def _watch_metrics(job_id: str):
    """Watch metrics live"""
    import time
    from rich.live import Live

    client = get_client()

    with Live(console=console, refresh_per_second=2) as live:
        while True:
            try:
                m = client.jobs.metrics(job_id)
                live.update(_render_metrics(m))
                time.sleep(1)
            except KeyboardInterrupt:
                break
            except Exception as e:
                console.print(f"[red]Error: {e}[/red]")
                break


def _render_metrics(m):
    """Render metrics as Rich panel"""
    from rich.panel import Panel
    from rich.table import Table
    from rich.console import Group

    panels = []

    # System metrics
    if m.system:
        sys_table = Table(show_header=False, box=None)
        sys_table.add_column("Metric", style="cyan")
        sys_table.add_column("Value")
        cpu_bar = _make_bar(m.system.cpu_percent, 100)
        mem_pct = (m.system.memory_used / m.system.memory_limit * 100) if m.system.memory_limit else 0
        mem_bar = _make_bar(mem_pct, 100)
        sys_table.add_row("CPU", f"{m.system.cpu_percent:5.1f}% {cpu_bar}")
        sys_table.add_row("RAM", f"{m.system.memory_used/1024:.1f}/{m.system.memory_limit/1024:.1f}GB {mem_bar}")
        panels.append(Panel(sys_table, title="[bold]System[/bold]", border_style="blue"))

    if not m.gpus:
        panels.append(Panel("[dim]No GPU metrics[/dim]"))
        return Group(*panels)

    table = Table(show_header=True, header_style="bold cyan", box=None)
    table.add_column("GPU")
    table.add_column("Util")
    table.add_column("VRAM")
    table.add_column("Temp")
    table.add_column("Power")

    for gpu in m.gpus:
        util_bar = _make_bar(gpu.utilization, 100)
        name = f"{gpu.index}: {gpu.name}" if gpu.name else str(gpu.index)
        table.add_row(
            f"[bold]{name}[/bold]",
            f"{gpu.utilization:5.1f}% {util_bar}",
            f"{gpu.memory_used/1024:.1f}/{gpu.memory_total/1024:.1f}GB",
            f"{gpu.temperature}°C",
            f"{gpu.power_draw:.0f}W"
        )

    panels.append(Panel(table, title="[bold]GPU Metrics[/bold]", border_style="green"))
    return Group(*panels)
