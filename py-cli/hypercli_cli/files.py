"""File management CLI commands"""
import os
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="Upload, inspect, and delete files on the platform")
console = Console()


def _get_client():
    from hypercli import HyperCLI
    return HyperCLI()


def _fmt_size(size: int) -> str:
    """Format file size for display."""
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


@app.command("upload")
def upload_file(
    file_path: str = typer.Argument(..., help="Path to local file to upload"),
    wait: bool = typer.Option(True, "--wait/--no-wait", help="Wait for upload to complete"),
):
    """Upload a file for use in flows and renders."""
    if not os.path.isfile(file_path):
        console.print(f"[red]File not found: {file_path}[/red]")
        raise typer.Exit(1)

    client = _get_client()
    console.print(f"Uploading [cyan]{os.path.basename(file_path)}[/cyan] ({_fmt_size(os.path.getsize(file_path))})...")
    f = client.files.upload(file_path)
    console.print(f"[green]Uploaded[/green]  ID: [bold]{f.id}[/bold]")

    if wait and f.state == "processing":
        console.print("Waiting for processing...", end="")
        f = client.files.wait_ready(f.id)
        console.print(f" [green]done[/green]")

    console.print(f"  Filename:  {f.filename}")
    console.print(f"  Type:      {f.content_type}")
    console.print(f"  Size:      {_fmt_size(f.file_size)}")
    console.print(f"  State:     {f.state or 'ready'}")
    console.print(f"  URL:       [dim]{f.url}[/dim]")


@app.command("upload-url")
def upload_url(
    url: str = typer.Argument(..., help="URL to download and upload"),
    wait: bool = typer.Option(True, "--wait/--no-wait", help="Wait for upload to complete"),
):
    """Upload a file from a URL."""
    client = _get_client()
    console.print(f"Uploading from URL...")
    f = client.files.upload_url(url)
    console.print(f"[green]Queued[/green]  ID: [bold]{f.id}[/bold]")

    if wait and f.state == "processing":
        console.print("Waiting for processing...", end="")
        f = client.files.wait_ready(f.id)
        console.print(f" [green]done[/green]")

    console.print(f"  Filename:  {f.filename}")
    console.print(f"  State:     {f.state or 'ready'}")


@app.command("get")
def get_file(
    file_id: str = typer.Argument(..., help="File ID"),
):
    """Get file info and status."""
    client = _get_client()
    f = client.files.get(file_id)

    table = Table(title=f"File {f.id[:12]}...")
    table.add_column("Field", style="dim")
    table.add_column("Value")

    table.add_row("ID", f.id)
    table.add_row("Filename", f.filename)
    table.add_row("Type", f.content_type)
    table.add_row("Size", _fmt_size(f.file_size))
    table.add_row("State", f.state or "ready")
    table.add_row("URL", f.url)
    if f.error:
        table.add_row("Error", f"[red]{f.error}[/red]")
    if f.created_at:
        table.add_row("Created", str(f.created_at))

    console.print(table)


@app.command("delete")
def delete_file(
    file_id: str = typer.Argument(..., help="File ID to delete"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
):
    """Delete an uploaded file."""
    if not yes:
        confirm = typer.confirm(f"Delete file {file_id[:12]}...?")
        if not confirm:
            raise typer.Abort()

    client = _get_client()
    client.files.delete(file_id)
    console.print(f"[green]File {file_id[:12]}... deleted[/green]")
