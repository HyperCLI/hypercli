"""API Key management CLI commands"""
from datetime import datetime, timezone
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="API key management")


def _fmt_ts(ts) -> str:
    """Format a timestamp (epoch float or ISO string) for display."""
    if not ts:
        return ""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
    return str(ts)[:16]
console = Console()


def _get_client():
    from hypercli import HyperCLI
    return HyperCLI()


@app.command("create")
def create_key(name: str = typer.Option("default", help="Key name")):
    """Create a new API key"""
    client = _get_client()
    key = client.keys.create(name=name)
    console.print(f"\n[bold green]API key created![/bold green]\n")
    console.print(f"  Key ID:  {key.key_id}")
    console.print(f"  Name:    {key.name}")
    console.print(f"  API Key: [bold]{key.api_key}[/bold]")
    console.print(f"\n[yellow]⚠ Save this key now — it won't be shown again.[/yellow]\n")


@app.command("list")
def list_keys():
    """List all API keys"""
    client = _get_client()
    keys = client.keys.list()

    if not keys:
        console.print("[dim]No API keys found.[/dim]")
        return

    table = Table(title="API Keys")
    table.add_column("Key ID", style="dim")
    table.add_column("Name")
    table.add_column("Key Preview")
    table.add_column("Active", justify="center")
    table.add_column("Created")
    table.add_column("Last Used")

    for key in keys:
        active = "✓" if key.is_active else "✗"
        active_style = "green" if key.is_active else "red"
        table.add_row(
            key.key_id[:8] + "...",
            key.name or "",
            key.api_key_preview or "",
            f"[{active_style}]{active}[/{active_style}]",
            _fmt_ts(key.created_at),
            _fmt_ts(key.last_used_at) or "never",
        )

    console.print(table)


@app.command("disable")
def disable_key(
    key_id: str = typer.Argument(help="Key ID to disable"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
):
    """Disable an API key (irreversible)"""
    if not yes:
        confirm = typer.confirm(f"Disable key {key_id[:8]}...? This cannot be undone")
        if not confirm:
            raise typer.Abort()

    client = _get_client()
    result = client.keys.disable(key_id)
    console.print(f"[red]Key {key_id[:8]}... disabled.[/red]")
