"""Workspaces CLI commands."""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import typer
from rich.console import Console
from rich.table import Table

from hypercli import HyperCLI

app = typer.Typer(help="Manage shared Workspaces")
console = Console()


def _get_workspaces():
    return HyperCLI().workspaces


def _print_json(value) -> None:
    typer.echo(json.dumps(value, indent=2, default=str))


@app.command("create")
def create_workspace(
    name: str = typer.Argument(help="Workspace display name"),
    slug: str | None = typer.Option(None, "--slug", help="Optional unique human-readable slug"),
    description: str | None = typer.Option(None, "--description", help="Optional description"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Create a workspace."""
    workspace = _get_workspaces().create(name=name, slug=slug, description=description, user_id=user_id)
    if output == "json":
        _print_json(workspace.__dict__)
        return
    console.print(f"[green]Created workspace[/green] {workspace.slug} ({workspace.id})")


@app.command("list")
def list_workspaces(
    agent_id: str | None = typer.Option(None, "--agent-id", help="List as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="List as a user subject"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """List accessible workspaces."""
    workspaces = _get_workspaces().list(user_id=user_id, agent_id=agent_id)
    if output == "json":
        _print_json([workspace.__dict__ for workspace in workspaces])
        return
    table = Table(title="Workspaces")
    table.add_column("Slug")
    table.add_column("Name")
    table.add_column("ID", style="dim")
    for workspace in workspaces:
        table.add_row(workspace.slug, workspace.name, workspace.id)
    console.print(table)


@app.command("grant")
def grant_workspace(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Grant an agent subject"),
    user_subject_id: str | None = typer.Option(None, "--user-subject-id", help="Grant a user subject"),
    role: str = typer.Option("viewer", "--role", help="viewer|contributor|admin"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Grant workspace access to an agent or user."""
    if bool(agent_id) == bool(user_subject_id):
        raise typer.BadParameter("Pass exactly one of --agent-id or --user-subject-id")
    subject_type = "agent" if agent_id else "user"
    subject_id = agent_id or user_subject_id
    grant = _get_workspaces().grant(workspace, subject_type=subject_type, subject_id=subject_id, role=role, user_id=user_id)
    if output == "json":
        _print_json(grant.__dict__)
        return
    console.print(f"[green]Granted[/green] {role} on {workspace} to {subject_type}:{subject_id}")


@app.command("register-file")
def register_file(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    path: str = typer.Argument(help="Workspace-relative source file path"),
    filename: str | None = typer.Option(None, "--filename", help="Original filename"),
    content_type: str | None = typer.Option(None, "--content-type", help="Source content type"),
    size: int | None = typer.Option(None, "--size", help="Source file size in bytes"),
    sha256: str | None = typer.Option(None, "--sha256", help="Source SHA-256"),
    etag: str | None = typer.Option(None, "--etag", help="Source storage ETag"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Register a workspace file and queue its Markdown projection."""
    item = _get_workspaces().register_file(
        workspace,
        path=path,
        source_filename=filename,
        source_content_type=content_type,
        source_size_bytes=size,
        source_sha256=sha256,
        source_etag=etag,
        user_id=user_id,
    )
    if output == "json":
        _print_json(item.__dict__)
        return
    console.print(f"[green]Registered[/green] {item.path} ({item.file_state}, projection {item.projection_status})")


@app.command("upload")
def upload(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_path: Path = typer.Argument(help="Local file to upload"),
    path: str | None = typer.Option(None, "--path", help="Workspace-relative destination path"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Upload a local source file into a workspace."""
    item = _get_workspaces().upload(
        workspace,
        str(file_path),
        workspace_path=path,
        user_id=user_id,
    )
    if output == "json":
        _print_json(item.__dict__)
        return
    console.print(f"[green]Uploaded[/green] {item.path} ({item.file_state}, projection {item.projection_status})")


@app.command("manifest")
def manifest(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
):
    """Print a workspace Markdown projection manifest."""
    value = _get_workspaces().manifest(workspace, user_id=user_id, agent_id=agent_id)
    _print_json(value.__dict__)


@app.command("sync")
def sync(
    workspace: str | None = typer.Argument(None, help="Workspace slug or ID"),
    output_dir: Path = typer.Option(Path.home() / "Workspaces", "--output-dir", "--output", "-o", help="Local Workspaces root"),
    all_workspaces: bool = typer.Option(False, "--all", help="Sync every workspace accessible to the subject"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Sync as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Sync as a user subject"),
    ready_only: bool = typer.Option(False, "--ready-only", help="Only write ready projections"),
    json_output: bool = typer.Option(False, "--json", help="Print JSON output"),
):
    """Sync workspace Markdown projections to a local Workspaces directory."""
    if all_workspaces:
        if workspace:
            raise typer.BadParameter("Pass either a workspace argument or --all, not both")
        synced = _get_workspaces().sync_all(
            str(output_dir),
            user_id=user_id,
            agent_id=agent_id,
            ready_only=ready_only,
        )
        if json_output:
            _print_json({"synced": synced})
            return
        total = sum(len(paths) for paths in synced.values())
        console.print(f"[green]Synced[/green] {total} projection(s) from {len(synced)} workspace(s) to {output_dir}")
        for slug, paths in synced.items():
            console.print(f"  {slug}: {len(paths)}")
        return
    if not workspace:
        raise typer.BadParameter("Pass a workspace argument or --all")
    written = _get_workspaces().sync_manifest(
        workspace,
        str(output_dir),
        user_id=user_id,
        agent_id=agent_id,
        ready_only=ready_only,
    )
    if json_output:
        _print_json({"written": written})
        return
    console.print(f"[green]Synced[/green] {len(written)} projection(s) to {output_dir}")
    for path in written:
        console.print(f"  {path}")


@app.command("download-url")
def download_url(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Print a presigned URL for the original source file."""
    value = _get_workspaces().download_url(workspace, file_ref, user_id=user_id, agent_id=agent_id)
    if output == "json":
        _print_json(value.__dict__)
        return
    console.print(value.url or "")


@app.command("download")
def download(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    output_path: Path | None = typer.Option(None, "--output", "-o", help="Output file path"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
):
    """Download the original source file through the Workspaces API."""
    value = _get_workspaces().download_url(workspace, file_ref, user_id=user_id, agent_id=agent_id)
    if not value.url:
        raise typer.BadParameter("Workspaces API did not return a download URL")
    target = output_path or Path(os.path.basename(value.source_path))
    with httpx.Client(timeout=120) as client:
        response = client.get(value.url)
        response.raise_for_status()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    console.print(f"[green]Downloaded[/green] {value.source_path} -> {target}")


@app.command("delete-file")
def delete_file(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
):
    """Soft-delete a workspace file."""
    _get_workspaces().delete_file(workspace, file_ref, user_id=user_id)
    console.print(f"[red]Deleted[/red] {file_ref}")
