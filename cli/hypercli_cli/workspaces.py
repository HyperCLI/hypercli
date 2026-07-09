"""Workspaces CLI commands."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from pathlib import PurePosixPath

import typer
from rich.console import Console
from rich.table import Table

from hypercli.config import get_agent_api_key, get_api_key
from hypercli.client import HyperCLI
from hypercli.workspaces import WorkspacesAPI

app = typer.Typer(help="Manage shared Workspaces")
console = Console()


def _get_workspaces():
    api_key = get_api_key() or get_agent_api_key()
    return WorkspacesAPI(api_key)


def _resolve_auth_subject(user_id: str | None, agent_id: str | None) -> tuple[str | None, str | None]:
    if user_id or agent_id:
        return user_id, agent_id
    auth_me = HyperCLI().user.auth_me()
    runtime_agent_id = getattr(auth_me, "runtime_agent_id", None)
    if runtime_agent_id:
        return None, runtime_agent_id
    resolved_user_id = str(getattr(auth_me, "user_id", "") or "").strip()
    return (resolved_user_id or None), None


def _print_json(value) -> None:
    typer.echo(json.dumps(value, indent=2, default=str))


def _parse_workspace_file_ref(value: str) -> tuple[str, str]:
    normalized = value.strip().strip("/")
    if "/" not in normalized:
        raise typer.BadParameter("Expected workspace/path")
    workspace, file_ref = normalized.split("/", 1)
    if not workspace or not file_ref:
        raise typer.BadParameter("Expected workspace/path")
    return workspace, file_ref


def _markdown_files_from_dir(directory: Path) -> list[Path]:
    if not directory.exists() or not directory.is_dir():
        raise typer.BadParameter(f"Not a directory: {directory}")
    files = sorted(path for path in directory.rglob("*.md") if path.is_file())
    if not files:
        raise typer.BadParameter(f"No Markdown files found in {directory}")
    return files


def _enrich_payload(address: str, md_files: list[Path], *, root: Path | None = None) -> dict:
    workspace, file_ref = _parse_workspace_file_ref(address)
    file_payloads = []
    for index, path in enumerate(md_files):
        relative_path = str(path.relative_to(root)) if root and path.is_relative_to(root) else path.name
        file_payloads.append(
            {
                "path": relative_path.replace(os.sep, "/"),
                "markdown_body": path.read_text(encoding="utf-8"),
                "primary": index == 0,
            }
        )
    return {
        "address": f"{workspace}/{file_ref}",
        "workspace": workspace,
        "path": file_ref,
        "files": file_payloads,
    }


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


@app.command("search")
def search_workspaces(
    query: str = typer.Argument(help="Search workspace names, file paths, filenames, and file metadata"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Search as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Search as a user subject"),
    vector: bool = typer.Option(True, "--vector/--no-vector", help="Use backend vector search in addition to exact search"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Search accessible workspaces."""
    workspaces = _get_workspaces().search(query, user_id=user_id, agent_id=agent_id, vector=vector)
    if output == "json":
        _print_json([workspace.__dict__ for workspace in workspaces])
        return
    table = Table(title=f"Workspace search: {query}")
    table.add_column("Slug")
    table.add_column("Name")
    table.add_column("ID", style="dim")
    for workspace in workspaces:
        table.add_row(workspace.slug, workspace.name, workspace.id)
    console.print(table)


@app.command("search-files")
def search_files(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    query: str = typer.Argument(help="Search file paths, filenames, keywords, and summaries"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Search as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Search as a user subject"),
    vector: bool = typer.Option(True, "--vector/--no-vector", help="Use backend vector search in addition to exact search"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Search files in a workspace."""
    files = _get_workspaces().search_files(workspace, query, user_id=user_id, agent_id=agent_id, vector=vector)
    if output == "json":
        _print_json([item.__dict__ for item in files])
        return
    table = Table(title=f"Workspace file search: {workspace} / {query}")
    table.add_column("Path")
    table.add_column("State")
    table.add_column("Score", justify="right")
    table.add_column("Reasons")
    for item in files:
        table.add_row(item.path, item.file_state, f"{item.score:.3f}", ", ".join(item.match_reasons))
    console.print(table)


@app.command("update")
def update_workspace(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    name: str | None = typer.Option(None, "--name", help="New workspace display name"),
    slug: str | None = typer.Option(None, "--slug", help="New unique human-readable slug"),
    description: str | None = typer.Option(None, "--description", help="New description"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Update a workspace."""
    if name is None and slug is None and description is None:
        raise typer.BadParameter("Pass at least one of --name, --slug, or --description")
    updated = _get_workspaces().update(
        workspace,
        name=name,
        slug=slug,
        description=description,
        user_id=user_id,
    )
    if output == "json":
        _print_json(updated.__dict__)
        return
    console.print(f"[green]Updated workspace[/green] {updated.slug} ({updated.id})")


@app.command("delete")
def delete_workspace(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
):
    """Soft-delete a workspace."""
    _get_workspaces().delete_workspace(workspace, user_id=user_id)
    console.print(f"[red]Deleted workspace[/red] {workspace}")


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


@app.command("grants")
def list_workspace_grants(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """List workspace access grants."""
    grants = _get_workspaces().list_grants(workspace, user_id=user_id)
    if output == "json":
        _print_json([grant.__dict__ for grant in grants])
        return
    table = Table(title=f"Workspace grants: {workspace}")
    table.add_column("ID", style="dim")
    table.add_column("Subject")
    table.add_column("Role")
    table.add_column("Revoked")
    for grant in grants:
        table.add_row(grant.id, f"{grant.subject_type}:{grant.subject_id}", grant.role, grant.revoked_at or "")
    console.print(table)


@app.command("revoke-grant")
def revoke_workspace_grant(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    grant_id: str = typer.Argument(help="Grant ID to revoke"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
):
    """Revoke a workspace grant."""
    _get_workspaces().revoke_grant(workspace, grant_id, user_id=user_id)
    console.print(f"[red]Revoked grant[/red] {grant_id}")


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
    console.print(f"[green]Uploaded[/green] {item.path} ({item.file_state}, processing {item.processing_state})")


@app.command("manifest")
def manifest(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
):
    """Print a workspace Markdown manifest."""
    value = _get_workspaces().manifest(workspace, user_id=user_id, agent_id=agent_id)
    _print_json(value.__dict__)


@app.command("wait-until-processed")
def wait_until_processed(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Poll as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Poll as a user subject"),
    timeout: float = typer.Option(300.0, "--timeout", help="Maximum seconds to wait"),
    poll_interval: float = typer.Option(2.0, "--poll-interval", help="Seconds between polls"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Poll a workspace file until its Markdown processing is finished."""
    item = _get_workspaces().wait_until_processed(
        workspace,
        file_ref,
        user_id=user_id,
        agent_id=agent_id,
        timeout=timeout,
        poll_interval=poll_interval,
    )
    if output == "json":
        _print_json(item.__dict__)
        return
    console.print(f"[green]Processed[/green] {item.path} ({item.file_state}, processing {item.processing_state})")


@app.command("sync")
def sync(
    workspace: str | None = typer.Argument(None, help="Workspace slug or ID"),
    output_dir: Path = typer.Option(Path.home() / "workspaces", "--output-dir", "--output", "-o", help="Local Workspaces root"),
    all_workspaces: bool = typer.Option(False, "--all", help="Sync every workspace accessible to the subject"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Sync as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Sync as a user subject"),
    ready_only: bool = typer.Option(False, "--ready-only", help="Only write ready Markdown files"),
    json_output: bool = typer.Option(False, "--json", help="Print JSON output"),
):
    """Sync workspace Markdown files to a local Workspaces directory."""
    user_id, agent_id = _resolve_auth_subject(user_id, agent_id)
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
        console.print(f"[green]Synced[/green] {total} Markdown file(s) from {len(synced)} workspace(s) to {output_dir}")
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
    console.print(f"[green]Synced[/green] {len(written)} Markdown file(s) to {output_dir}")
    for path in written:
        console.print(f"  {path}")


@app.command("download")
def download(
    workspace: str | None = typer.Argument(None, help="Workspace slug or ID, or omit to read workspace/path from stdin"),
    file_ref: str | None = typer.Argument(None, help="Workspace-relative source path or file ID"),
    output_path: Path | None = typer.Option(None, "--output", "-o", help="Output file path"),
    raw: bool = typer.Option(False, "--raw", help="Download the original source file instead of Markdown"),
    md: bool = typer.Option(False, "--md", help="Download the Markdown file"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
    json_output: bool = typer.Option(False, "--json", help="Download the file and print machine-readable metadata"),
):
    """Download Markdown by default, or the original source with --raw."""
    if workspace is None:
        workspace, file_ref = _parse_workspace_file_ref(sys.stdin.read())
    elif file_ref is None and "/" in workspace.strip().strip("/"):
        workspace, file_ref = _parse_workspace_file_ref(workspace)
    if workspace is None or file_ref is None:
        raise typer.BadParameter("Pass workspace and file_ref, or pipe workspace/path on stdin")
    if raw and md:
        raise typer.BadParameter("Pass either --raw or --md, not both")
    workspaces = _get_workspaces()
    body = workspaces.download(workspace, file_ref, raw=raw, user_id=user_id, agent_id=agent_id)
    if output_path is not None:
        target = output_path
    elif json_output and raw:
        suffix = PurePosixPath(file_ref).suffix or ".bin"
        handle = tempfile.NamedTemporaryFile(prefix="hyper-workspace-", suffix=suffix, delete=False)
        handle.close()
        target = Path(handle.name)
    elif raw:
        target = Path(os.path.basename(file_ref))
    else:
        target = Path(f"{PurePosixPath(file_ref).name}.md")
    target.parent.mkdir(parents=True, exist_ok=True)
    if raw:
        target.write_bytes(body)
    else:
        target.write_text(body.decode("utf-8"), encoding="utf-8")
    if json_output:
        _print_json(
            {
                "address": f"{workspace}/{file_ref}",
                "workspace": workspace,
                "path": file_ref,
                "local_path": str(target),
                "raw": raw,
            }
        )
        return
    console.print(f"[green]Downloaded[/green] {file_ref} -> {target}")


@app.command("download-url")
def download_url(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    agent_id: str | None = typer.Option(None, "--agent-id", help="Fetch as an agent subject"),
    user_id: str | None = typer.Option(None, "--user-id", help="Fetch as a user subject"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Return a signed download URL for the original source file."""
    value = _get_workspaces().download_url(workspace, file_ref, user_id=user_id, agent_id=agent_id)
    if output == "json":
        _print_json(value.__dict__)
        return
    console.print(value.url or "")


@app.command("enrich")
def enrich(
    address: str | None = typer.Argument(None, help="Workspace file address: workspace/path, or omit to read stdin"),
    directory: Path = typer.Option(..., "--dir", help="Directory containing generated Markdown files"),
    json_output: bool = typer.Option(False, "--json", help="Print machine-readable enrichment payload"),
):
    """Build a Workspaces enrichment payload from generated Markdown files."""
    resolved_address = address or sys.stdin.read().strip()
    if not resolved_address:
        raise typer.BadParameter("Pass workspace/path or pipe it on stdin")
    payload = _enrich_payload(resolved_address, _markdown_files_from_dir(directory), root=directory)
    if json_output:
        _print_json(payload)
        return
    console.print(f"[green]Prepared enrichment[/green] {payload['address']} ({len(payload['files'])} Markdown file(s))")


@app.command("regenerate")
def regenerate(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Queue Markdown regeneration for a workspace file."""
    item = _get_workspaces().regenerate_file(workspace, file_ref, user_id=user_id)
    if output == "json":
        _print_json(item.__dict__)
        return
    console.print(f"[green]Queued regeneration[/green] {item.path} ({item.file_state}, processing {item.processing_state})")


@app.command("delete-file")
def delete_file(
    workspace: str = typer.Argument(help="Workspace slug or ID"),
    file_ref: str = typer.Argument(help="Workspace-relative source path or file ID"),
    user_id: str | None = typer.Option(None, "--user-id", help="Explicit acting user subject for local/dev testing"),
):
    """Soft-delete a workspace file."""
    _get_workspaces().delete_file(workspace, file_ref, user_id=user_id)
    console.print(f"[red]Deleted[/red] {file_ref}")
