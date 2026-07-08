"""Workspaces API client."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from urllib.parse import urlsplit

import httpx

from .config import get_agents_api_base_url, get_config_value
from .http import _handle_response


def _derive_workspaces_base(agents_api_base: str | None = None) -> str:
    configured = get_config_value("HYPER_WORKSPACES_API_BASE")
    if configured:
        raw = configured.strip().rstrip("/")
    else:
        raw = (agents_api_base or get_agents_api_base_url()).strip().rstrip("/")
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    path = parsed.path.rstrip("/")
    if path.endswith("/workspaces"):
        return f"{parsed.scheme}://{parsed.netloc}{path}"
    if path.endswith("/agents"):
        path = path[: -len("/agents")]
    return f"{parsed.scheme}://{parsed.netloc}{path}/workspaces"


def _headers(
    api_key: str,
    *,
    user_id: str | None = None,
    agent_id: str | None = None,
    content_type: str | None = "application/json",
) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if user_id:
        headers["X-User-Id"] = user_id
    if agent_id:
        headers["X-Agent-Id"] = agent_id
    return headers


def _request(method: str, url: str, *, api_key: str, user_id: str | None = None, agent_id: str | None = None, **kwargs):
    with httpx.Client(timeout=30) as client:
        response = client.request(method, url, headers=_headers(api_key, user_id=user_id, agent_id=agent_id), **kwargs)
    return _handle_response(response)


@dataclass
class Workspace:
    id: str
    name: str
    slug: str
    description: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Workspace":
        return cls(
            id=str(data.get("id", "")),
            name=data.get("name", ""),
            slug=data.get("slug", ""),
            description=data.get("description"),
        )


@dataclass
class WorkspaceFile:
    id: str
    workspace_id: str
    path: str
    display_name: str
    current_version_id: str | None = None
    file_state: str = ""
    upload_status: str | None = None
    projection_status: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceFile":
        return cls(
            id=str(data.get("id", "")),
            workspace_id=str(data.get("workspace_id", "")),
            path=data.get("path", ""),
            display_name=data.get("display_name", ""),
            current_version_id=str(data["current_version_id"]) if data.get("current_version_id") else None,
            file_state=data.get("file_state", ""),
            upload_status=data.get("upload_status"),
            projection_status=data.get("projection_status"),
        )


@dataclass
class WorkspaceGrant:
    id: str
    workspace_id: str
    subject_type: str
    subject_id: str
    role: str

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceGrant":
        return cls(
            id=str(data.get("id", "")),
            workspace_id=str(data.get("workspace_id", "")),
            subject_type=data.get("subject_type", ""),
            subject_id=data.get("subject_id", ""),
            role=data.get("role", ""),
        )


@dataclass
class WorkspaceManifest:
    workspace_id: str
    workspace_name: str
    workspace_slug: str
    snapshot_id: str
    base_path: str
    projections: list[dict] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceManifest":
        return cls(
            workspace_id=str(data.get("workspace_id", "")),
            workspace_name=data.get("workspace_name", ""),
            workspace_slug=data.get("workspace_slug", ""),
            snapshot_id=data.get("snapshot_id", ""),
            base_path=data.get("base_path", ""),
            projections=list(data.get("projections") or []),
        )


@dataclass
class DownloadUrl:
    file_id: str
    file_version_id: str
    source_path: str
    source_s3_key: str
    s3_bucket: str
    s3_endpoint: str
    url: str | None
    download_command: str

    @classmethod
    def from_dict(cls, data: dict) -> "DownloadUrl":
        return cls(
            file_id=str(data.get("file_id", "")),
            file_version_id=str(data.get("file_version_id", "")),
            source_path=data.get("source_path", ""),
            source_s3_key=data.get("source_s3_key", ""),
            s3_bucket=data.get("s3_bucket", ""),
            s3_endpoint=data.get("s3_endpoint", ""),
            url=data.get("url"),
            download_command=data.get("download_command", ""),
        )


class WorkspacesAPI:
    """Client for the Workspaces service mounted at /workspaces."""

    def __init__(self, api_key: str, api_base: str | None = None, agents_api_base: str | None = None):
        if not api_key:
            raise ValueError("API key required for Workspaces API")
        self.api_key = api_key
        self.api_base = (api_base or _derive_workspaces_base(agents_api_base)).rstrip("/")

    def list(self, *, user_id: str | None = None, agent_id: str | None = None) -> list[Workspace]:
        data = _request("GET", self.api_base, api_key=self.api_key, user_id=user_id, agent_id=agent_id)
        return [Workspace.from_dict(item) for item in data]

    def create(self, *, name: str, slug: str | None = None, description: str | None = None, user_id: str | None = None) -> Workspace:
        payload = {"name": name}
        if slug:
            payload["slug"] = slug
        if description:
            payload["description"] = description
        data = _request("POST", self.api_base, api_key=self.api_key, user_id=user_id, json=payload)
        return Workspace.from_dict(data)

    def grant(
        self,
        workspace_ref: str,
        *,
        subject_type: str,
        subject_id: str,
        role: str = "viewer",
        user_id: str | None = None,
    ) -> WorkspaceGrant:
        payload = {"subject_type": subject_type, "subject_id": subject_id, "role": role}
        data = _request("POST", f"{self.api_base}/{workspace_ref}/grants", api_key=self.api_key, user_id=user_id, json=payload)
        return WorkspaceGrant.from_dict(data)

    def register_file(
        self,
        workspace_ref: str,
        *,
        path: str,
        source_filename: str | None = None,
        source_content_type: str | None = None,
        source_size_bytes: int | None = None,
        source_sha256: str | None = None,
        source_etag: str | None = None,
        user_id: str | None = None,
    ) -> WorkspaceFile:
        payload = {"path": path}
        if source_filename:
            payload["source_filename"] = source_filename
        if source_content_type:
            payload["source_content_type"] = source_content_type
        if source_size_bytes is not None:
            payload["source_size_bytes"] = source_size_bytes
        if source_sha256:
            payload["source_sha256"] = source_sha256
        if source_etag:
            payload["source_etag"] = source_etag
        data = _request("POST", f"{self.api_base}/{workspace_ref}/files", api_key=self.api_key, user_id=user_id, json=payload)
        return WorkspaceFile.from_dict(data)

    def upload(
        self,
        workspace_ref: str,
        file_path: str,
        *,
        workspace_path: str | None = None,
        user_id: str | None = None,
    ) -> WorkspaceFile:
        filename = os.path.basename(file_path)
        data = {}
        if workspace_path:
            data["path"] = workspace_path
        with open(file_path, "rb") as handle:
            files = {"file": (filename, handle, "application/octet-stream")}
            with httpx.Client(timeout=120) as client:
                response = client.post(
                    f"{self.api_base}/{workspace_ref}/upload",
                    headers=_headers(self.api_key, user_id=user_id, content_type=None),
                    data=data,
                    files=files,
                )
        return WorkspaceFile.from_dict(_handle_response(response))

    def manifest(self, workspace_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> WorkspaceManifest:
        data = _request("GET", f"{self.api_base}/{workspace_ref}/manifest", api_key=self.api_key, user_id=user_id, agent_id=agent_id)
        return WorkspaceManifest.from_dict(data)

    def download_url(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> DownloadUrl:
        data = _request(
            "GET",
            f"{self.api_base}/{workspace_ref}/files/{file_ref}/download-url",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        return DownloadUrl.from_dict(data)

    def delete_file(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None) -> dict:
        return _request("DELETE", f"{self.api_base}/{workspace_ref}/files/{file_ref}", api_key=self.api_key, user_id=user_id)

    def sync_manifest(
        self,
        workspace_ref: str,
        output_dir: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
        ready_only: bool = False,
    ) -> list[str]:
        manifest = self.manifest(workspace_ref, user_id=user_id, agent_id=agent_id)
        workspace_root = os.path.join(output_dir, manifest.workspace_slug)
        written: list[str] = []
        for projection in manifest.projections:
            if ready_only and projection.get("status") != "ready":
                continue
            projection_path = PurePosixPath(projection["projection_path"])
            target = os.path.abspath(os.path.join(workspace_root, *projection_path.parts))
            root_abs = os.path.abspath(workspace_root)
            if not target.startswith(root_abs + os.sep):
                raise ValueError(f"Unsafe projection path: {projection_path}")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            body = _projection_markdown(manifest, projection)
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(body)
            written.append(target)
        return written

    def sync_all(
        self,
        output_dir: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
        ready_only: bool = False,
    ) -> dict[str, list[str]]:
        synced: dict[str, list[str]] = {}
        for workspace in self.list(user_id=user_id, agent_id=agent_id):
            synced[workspace.slug] = self.sync_manifest(
                workspace.slug,
                output_dir,
                user_id=user_id,
                agent_id=agent_id,
                ready_only=ready_only,
            )
        return synced


def _projection_markdown(manifest: WorkspaceManifest, projection: dict) -> str:
    source_path = projection.get("source_path", "")
    status = projection.get("status", "")
    download_command = projection.get("download_command") or f"hyper workspaces download {manifest.workspace_slug} {source_path}"
    return (
        "---\n"
        f"workspace_id: {manifest.workspace_id}\n"
        f"workspace_slug: {manifest.workspace_slug}\n"
        f"snapshot_id: {manifest.snapshot_id}\n"
        f"file_id: {projection.get('file_id', '')}\n"
        f"projection_id: {projection.get('projection_id', '')}\n"
        f"source_path: {source_path}\n"
        f"projection_path: {projection.get('projection_path', '')}\n"
        f"source_sha256: {projection.get('source_sha256') or ''}\n"
        f"markdown_sha256: {projection.get('markdown_sha256') or ''}\n"
        f"status: {status}\n"
        f"download_command: {download_command}\n"
        "---\n\n"
    )
