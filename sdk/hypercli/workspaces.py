"""Shared knowledge API client."""
from __future__ import annotations

import mimetypes
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx

from .config import get_agents_api_base_url, get_config_value
from .http import APIError, _handle_bytes_response, _handle_response


_UNSET = object()


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


def _encode_ref(value: str) -> str:
    return quote(value, safe="")


def _encode_file_ref(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = normalized.strip("/")
    return "/".join(quote(part, safe="") for part in normalized.split("/"))


def _headers(
    api_key: str,
    *,
    user_id: str | None = None,
    agent_id: str | None = None,
    backend_api_key: str | None = None,
    content_type: str | None = "application/json",
) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if backend_api_key:
        headers["X-BACKEND-API-KEY"] = backend_api_key
    return headers


def _request(
    method: str,
    url: str,
    *,
    api_key: str,
    user_id: str | None = None,
    agent_id: str | None = None,
    backend_api_key: str | None = None,
    **kwargs,
):
    with httpx.Client(timeout=30) as client:
        response = client.request(
            method,
            url,
            headers=_headers(api_key, user_id=user_id, agent_id=agent_id, backend_api_key=backend_api_key),
            **kwargs,
        )
    return _handle_response(response)


def _request_bytes(
    method: str,
    url: str,
    *,
    api_key: str,
    user_id: str | None = None,
    agent_id: str | None = None,
    backend_api_key: str | None = None,
    log_errors: bool = True,
    **kwargs,
) -> bytes:
    with httpx.Client(timeout=120) as client:
        response = client.request(
            method,
            url,
            headers=_headers(api_key, user_id=user_id, agent_id=agent_id, backend_api_key=backend_api_key),
            **kwargs,
        )
    return _handle_bytes_response(response, log_errors=log_errors)


@dataclass
class Workspace:
    id: str
    name: str
    slug: str
    description: str | None = None
    display_name: str | None = None
    display_slug: str | None = None
    role: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Workspace":
        return cls(
            id=str(data.get("id", "")),
            name=data.get("name", ""),
            slug=data.get("slug", ""),
            description=data.get("description"),
            display_name=data.get("display_name"),
            display_slug=data.get("display_slug"),
            role=(
                data.get("role")
                if data.get("role") is not None
                else data.get("current_role")
            ),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


@dataclass
class WorkspaceAgentAssociation:
    workspace_id: str
    agent_id: str
    role: str
    expires_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceAgentAssociation":
        return cls(
            workspace_id=str(data.get("workspace_id", "")),
            agent_id=str(data.get("agent_id", "")),
            role=data.get("role", ""),
            expires_at=data.get("expires_at"),
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
    processing_state: str | None = None
    keywords: list[str] = field(default_factory=list)
    summary: str | None = None

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
            processing_state=data.get("processing_state"),
            keywords=list(data.get("keywords") or []),
            summary=data.get("summary"),
        )


@dataclass
class WorkspaceFileSearchResult(WorkspaceFile):
    match_reasons: list[str] = field(default_factory=list)
    keyword_score: float = 0.0
    vector_score: float | None = None
    score: float = 0.0

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceFileSearchResult":
        base = WorkspaceFile.from_dict(data)
        return cls(
            **base.__dict__,
            match_reasons=list(data.get("match_reasons") or []),
            keyword_score=float(data.get("keyword_score") or 0.0),
            vector_score=float(data["vector_score"]) if data.get("vector_score") is not None else None,
            score=float(data.get("score") or 0.0),
        )


@dataclass
class WorkspaceGrant:
    id: str
    workspace_id: str
    subject_type: str
    subject_id: str
    role: str
    expires_at: str | None = None
    revoked_at: str | None = None
    display_name: str | None = None
    display_slug: str | None = None
    is_owner: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceGrant":
        return cls(
            id=str(data.get("id", "")),
            workspace_id=str(data.get("workspace_id", "")),
            subject_type=data.get("subject_type", ""),
            subject_id=data.get("subject_id", ""),
            role=data.get("role", ""),
            display_name=data.get("display_name"),
            display_slug=data.get("display_slug"),
            is_owner=bool(data.get("is_owner", False)),
            expires_at=data.get("expires_at"),
            revoked_at=data.get("revoked_at"),
        )


WorkspaceAccessVisibility = Literal["all-direct-access", "current-access-only"]


@dataclass
class WorkspaceAccessEntry:
    workspace_id: str
    subject_type: str
    subject_id: str
    role: str
    display_name: str | None
    display_slug: str | None
    grants: list[WorkspaceGrant]


@dataclass
class WorkspaceAccessSnapshot:
    workspace: Workspace
    current_role: str | None
    visibility: WorkspaceAccessVisibility
    captured_at: str
    entries: list[WorkspaceAccessEntry] | None
    grants: list[WorkspaceGrant] | None


_WORKSPACE_ROLE_STRENGTH = {
    "viewer": 1,
    "contributor": 2,
    "admin": 3,
}


def _grant_expiration_timestamp(grant: WorkspaceGrant) -> datetime | None:
    if grant.expires_at is None:
        return None
    if not isinstance(grant.expires_at, str):
        raise ValueError(
            f"Invalid expiration timestamp for workspace grant {grant.id or '<unknown>'}: "
            f"{grant.expires_at}"
        )
    try:
        timestamp = datetime.fromisoformat(grant.expires_at.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(
            f"Invalid expiration timestamp for workspace grant {grant.id or '<unknown>'}: "
            f"{grant.expires_at}"
        ) from None
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def _strongest_workspace_role(grants: list[WorkspaceGrant]) -> str:
    return min(
        (grant.role for grant in grants),
        key=lambda role: (-_WORKSPACE_ROLE_STRENGTH.get(role, 0), role),
    )


def _agreed_non_empty_value(values: list[str | None]) -> str | None:
    non_empty = {value for value in values if isinstance(value, str) and value}
    return next(iter(non_empty)) if len(non_empty) == 1 else None


def _workspace_access_entries(
    grants: list[WorkspaceGrant],
    captured_at: datetime,
) -> list[WorkspaceAccessEntry]:
    grouped: dict[tuple[str, str, str], list[WorkspaceGrant]] = {}
    for grant in grants:
        expires_at = _grant_expiration_timestamp(grant)
        if grant.revoked_at is not None or (expires_at is not None and expires_at <= captured_at):
            continue
        key = (grant.workspace_id, grant.subject_type, grant.subject_id)
        grouped.setdefault(key, []).append(grant)

    entries = [
        WorkspaceAccessEntry(
            workspace_id=workspace_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=_strongest_workspace_role(group_grants),
            display_name=_agreed_non_empty_value(
                [grant.display_name for grant in group_grants]
            ),
            display_slug=_agreed_non_empty_value(
                [grant.display_slug for grant in group_grants]
            ),
            grants=group_grants,
        )
        for (workspace_id, subject_type, subject_id), group_grants in grouped.items()
    ]
    return sorted(
        entries,
        key=lambda entry: (entry.subject_type, entry.subject_id, entry.workspace_id),
    )


def _latest_grant_expiration(grants: list[WorkspaceGrant]) -> str | None:
    if any(grant.expires_at is None for grant in grants):
        return None
    return max(
        grants,
        key=lambda grant: (_grant_expiration_timestamp(grant), grant.expires_at),
    ).expires_at


@dataclass
class WorkspaceManifest:
    workspace_id: str
    workspace_name: str
    workspace_slug: str
    snapshot_id: str
    base_path: str
    markdown_files: list[dict] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceManifest":
        return cls(
            workspace_id=str(data.get("workspace_id", "")),
            workspace_name=data.get("workspace_name", ""),
            workspace_slug=data.get("workspace_slug", ""),
            snapshot_id=data.get("snapshot_id", ""),
            base_path=data.get("base_path", ""),
            markdown_files=list(data.get("markdown_files") or []),
        )


@dataclass
class DownloadUrl:
    file_id: str
    path: str
    version: int
    url: str | None
    download_command: str

    @classmethod
    def from_dict(cls, data: dict) -> "DownloadUrl":
        return cls(
            file_id=str(data.get("file_id", "")),
            path=data.get("path", ""),
            version=int(data.get("version") or 0),
            url=data.get("url"),
            download_command=data.get("download_command", ""),
        )


class WorkspacesAPI:
    """Client for the shared knowledge service mounted at /workspaces."""

    def __init__(self, api_key: str, api_base: str | None = None, agents_api_base: str | None = None):
        if not api_key:
            raise ValueError("API key required for shared knowledge")
        self.api_key = api_key
        self.api_base = (api_base or _derive_workspaces_base(agents_api_base)).rstrip("/")

    def list(self, *, user_id: str | None = None, agent_id: str | None = None) -> list[Workspace]:
        data = _request("GET", self.api_base, api_key=self.api_key, user_id=user_id, agent_id=agent_id)
        return [Workspace.from_dict(item) for item in data]

    def get(
        self,
        workspace_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> Workspace:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        return Workspace.from_dict(data)

    def access_snapshot(
        self,
        workspace_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> WorkspaceAccessSnapshot:
        workspace = self.get(workspace_ref, user_id=user_id, agent_id=agent_id)
        captured_time = datetime.now(timezone.utc)
        captured_at = captured_time.isoformat().replace("+00:00", "Z")
        current_role = workspace.role

        if current_role != "admin":
            return WorkspaceAccessSnapshot(
                workspace=workspace,
                current_role=current_role,
                visibility="current-access-only",
                captured_at=captured_at,
                entries=None,
                grants=None,
            )

        grants = self.list_grants(
            workspace_ref,
            user_id=user_id,
            agent_id=agent_id,
        )
        return WorkspaceAccessSnapshot(
            workspace=workspace,
            current_role=current_role,
            visibility="all-direct-access",
            captured_at=captured_at,
            entries=_workspace_access_entries(grants, captured_time),
            grants=grants,
        )

    def list_agents(
        self,
        workspace_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[WorkspaceAgentAssociation]:
        """Deprecated compatibility projection; use access_snapshot for grant details."""
        snapshot = self.access_snapshot(
            workspace_ref,
            user_id=user_id,
            agent_id=agent_id,
        )
        if snapshot.visibility != "all-direct-access" or snapshot.entries is None:
            raise ValueError(
                "Workspace agent associations are available only to Workspace admins."
            )
        return [
            WorkspaceAgentAssociation(
                workspace_id=entry.workspace_id,
                agent_id=entry.subject_id,
                role=entry.role,
                expires_at=_latest_grant_expiration(entry.grants),
            )
            for entry in snapshot.entries
            if entry.subject_type == "agent"
        ]

    def search(
        self,
        query: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
        vector: bool = True,
    ) -> list[Workspace]:
        data = _request(
            "GET",
            f"{self.api_base}/search",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            params={"q": query, "vector": str(vector).lower()},
        )
        return [Workspace.from_dict(item) for item in data]

    def create(self, *, name: str, slug: str | None = None, description: str | None = None, user_id: str | None = None) -> Workspace:
        payload = {"name": name}
        if slug:
            payload["slug"] = slug
        if description:
            payload["description"] = description
        data = _request("POST", self.api_base, api_key=self.api_key, user_id=user_id, json=payload)
        return Workspace.from_dict(data)

    def update(
        self,
        workspace_ref: str,
        *,
        name: str | None = None,
        slug: str | None = None,
        description: str | None = None,
        user_id: str | None = None,
    ) -> Workspace:
        payload = {}
        if name is not None:
            payload["name"] = name
        if slug is not None:
            payload["slug"] = slug
        if description is not None:
            payload["description"] = description
        data = _request(
            "PATCH",
            f"{self.api_base}/{_encode_ref(workspace_ref)}",
            api_key=self.api_key,
            user_id=user_id,
            json=payload,
        )
        return Workspace.from_dict(data)

    def delete_workspace(self, workspace_ref: str, *, user_id: str | None = None) -> dict:
        return _request(
            "DELETE",
            f"{self.api_base}/{_encode_ref(workspace_ref)}",
            api_key=self.api_key,
            user_id=user_id,
        )

    def grant(
        self,
        workspace_ref: str,
        *,
        subject_type: str,
        subject_id: str,
        role: str = "viewer",
        display_name: str | None = None,
        display_slug: str | None = None,
        expires_at: str | None = None,
        user_id: str | None = None,
    ) -> WorkspaceGrant:
        payload = {"subject_type": subject_type, "subject_id": subject_id, "role": role}
        if display_name is not None:
            payload["display_name"] = display_name
        if display_slug is not None:
            payload["display_slug"] = display_slug
        if expires_at is not None:
            payload["expires_at"] = expires_at
        data = _request(
            "POST",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/grants",
            api_key=self.api_key,
            user_id=user_id,
            json=payload,
        )
        return WorkspaceGrant.from_dict(data)

    def list_grants(
        self,
        workspace_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[WorkspaceGrant]:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/grants",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        if not isinstance(data, list):
            raise ValueError("Workspace grants response must be a list.")
        return [WorkspaceGrant.from_dict(item) for item in data]

    def update_grant(
        self,
        workspace_ref: str,
        grant_id: str,
        *,
        role: str | None = None,
        expires_at: str | None | object = _UNSET,
        user_id: str | None = None,
    ) -> WorkspaceGrant:
        payload = {}
        if role is not None:
            payload["role"] = role
        if expires_at is not _UNSET:
            payload["expires_at"] = expires_at
        data = _request(
            "PATCH",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/grants/{_encode_ref(grant_id)}",
            api_key=self.api_key,
            user_id=user_id,
            json=payload,
        )
        return WorkspaceGrant.from_dict(data)

    def revoke_grant(self, workspace_ref: str, grant_id: str, *, user_id: str | None = None) -> dict:
        return _request(
            "DELETE",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/grants/{_encode_ref(grant_id)}",
            api_key=self.api_key,
            user_id=user_id,
        )

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
        keywords: list[str] | None = None,
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
        if keywords:
            payload["keywords"] = keywords
        data = _request(
            "POST",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files",
            api_key=self.api_key,
            user_id=user_id,
            json=payload,
        )
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
        data["workspace"] = workspace_ref
        if workspace_path:
            data["path"] = workspace_path
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with open(file_path, "rb") as handle:
            files = {"file": (filename, handle, content_type)}
            with httpx.Client(timeout=120) as client:
                response = client.post(
                    f"{self.api_base}/upload",
                    headers=_headers(self.api_key, user_id=user_id, content_type=None),
                    data=data,
                    files=files,
                )
        return WorkspaceFile.from_dict(_handle_response(response))

    def get_file(
        self,
        workspace_ref: str,
        file_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> WorkspaceFile:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files/{_encode_file_ref(file_ref)}",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        return WorkspaceFile.from_dict(data)

    def update_file(
        self,
        workspace_ref: str,
        file_ref: str,
        *,
        display_name: str | None = None,
        keywords: list[str] | None = None,
        summary: str | None | object = _UNSET,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> WorkspaceFile:
        payload = {}
        if display_name is not None:
            payload["display_name"] = display_name
        if keywords is not None:
            payload["keywords"] = keywords
        if summary is not _UNSET:
            payload["summary"] = summary
        data = _request(
            "PATCH",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files/{_encode_file_ref(file_ref)}",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            json=payload,
        )
        return WorkspaceFile.from_dict(data)

    def regenerate_file(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None) -> WorkspaceFile:
        data = _request(
            "POST",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files/{_encode_file_ref(file_ref)}/regenerate",
            api_key=self.api_key,
            user_id=user_id,
        )
        return WorkspaceFile.from_dict(data)

    def wait_until_processed(
        self,
        workspace_ref: str,
        file_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
        timeout: float = 300.0,
        poll_interval: float = 2.0,
    ) -> WorkspaceFile:
        start = time.monotonic()
        terminal_failures = {"failed", "deleted"}
        while time.monotonic() - start < timeout:
            item = self.get_file(workspace_ref, file_ref, user_id=user_id, agent_id=agent_id)
            if item.file_state == "processed" and item.processing_state == "processed":
                return item
            if item.file_state in terminal_failures or item.processing_state in terminal_failures:
                raise ValueError(f"Shared knowledge file {file_ref} is {item.file_state} with processing {item.processing_state or 'unknown'}")
            time.sleep(poll_interval)
        raise TimeoutError(f"Shared knowledge file {file_ref} did not process within {timeout}s")

    def list_files(
        self,
        workspace_ref: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[WorkspaceFile]:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        return [WorkspaceFile.from_dict(item) for item in data]

    def manifest(self, workspace_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> WorkspaceManifest:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/manifest",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
        )
        return WorkspaceManifest.from_dict(data)

    def download_url(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> DownloadUrl:
        data = _request(
            "POST",
            f"{self.api_base}/download-url",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            json={"workspace": workspace_ref, "path": file_ref},
        )
        return DownloadUrl.from_dict(data)

    def markdown_file(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> tuple[dict, str]:
        manifest = self.manifest(workspace_ref, user_id=user_id, agent_id=agent_id)
        markdown_file = _find_markdown_file(manifest, file_ref)
        body = _request_bytes(
            "POST",
            f"{self.api_base}/tomd",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            json={"workspace": workspace_ref, "path": markdown_file.get("path") or file_ref, "index": 1},
        ).decode("utf-8")
        return markdown_file, body

    def download(
        self,
        workspace_ref: str,
        file_ref: str,
        *,
        raw: bool = False,
        index: int = 1,
        user_id: str | None = None,
        agent_id: str | None = None,
    ) -> bytes:
        return _request_bytes(
            "POST",
            f"{self.api_base}/download",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            json={"workspace": workspace_ref, "path": file_ref, "raw": raw, "index": index},
        )

    def meta(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None, agent_id: str | None = None) -> dict:
        return _request(
            "POST",
            f"{self.api_base}/meta",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            json={"workspace": workspace_ref, "path": file_ref},
        )

    def delete_file(self, workspace_ref: str, file_ref: str, *, user_id: str | None = None) -> dict:
        return _request(
            "DELETE",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files/{_encode_file_ref(file_ref)}",
            api_key=self.api_key,
            user_id=user_id,
        )

    def search_files(
        self,
        workspace_ref: str,
        query: str,
        *,
        user_id: str | None = None,
        agent_id: str | None = None,
        vector: bool = True,
    ) -> list[WorkspaceFileSearchResult]:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(workspace_ref)}/files/search",
            api_key=self.api_key,
            user_id=user_id,
            agent_id=agent_id,
            params={"q": query, "vector": str(vector).lower()},
        )
        return [WorkspaceFileSearchResult.from_dict(item) for item in data]

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
        for markdown_file in manifest.markdown_files:
            if ready_only and markdown_file.get("state") != "processed":
                continue
            markdown_path = PurePosixPath(f"{markdown_file['path']}.md")
            target = os.path.abspath(os.path.join(workspace_root, *markdown_path.parts))
            root_abs = os.path.abspath(workspace_root)
            if not target.startswith(root_abs + os.sep):
                raise ValueError(f"Unsafe markdown path: {markdown_path}")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                body = _request_bytes(
                    "POST",
                    f"{self.api_base}/tomd",
                    api_key=self.api_key,
                    user_id=user_id,
                    agent_id=agent_id,
                    log_errors=not ready_only,
                    json={"workspace": workspace_ref, "path": markdown_file["path"], "index": 1},
                ).decode("utf-8")
            except APIError as exc:
                detail = str(exc.detail).lower()
                if ready_only and exc.status_code == 404 and "workspace markdown not found" in detail:
                    continue
                raise
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


def _find_markdown_file(manifest: WorkspaceManifest, file_ref: str) -> dict:
    normalized_ref = str(PurePosixPath(file_ref.strip().replace("\\", "/")))
    for markdown_file in manifest.markdown_files:
        if not isinstance(markdown_file, dict):
            continue
        if file_ref == str(markdown_file.get("file_id", "")):
            return markdown_file
        if normalized_ref == str(PurePosixPath(str(markdown_file.get("path", "")))):
            return markdown_file
    raise ValueError(f"Shared knowledge Markdown file not found for {file_ref}")
