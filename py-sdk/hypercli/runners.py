"""Runners API client — self-hosted compute registry (agents backend /runners)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlsplit

from .config import get_agents_api_base_url, get_config_value
from .routines import _parse_datetime
from .workspaces import _encode_ref, _request


def _derive_runners_base(agents_api_base: str | None = None) -> str:
    configured = get_config_value("HYPER_RUNNERS_API_BASE")
    if configured:
        raw = configured.strip().rstrip("/")
    else:
        raw = (agents_api_base or get_agents_api_base_url()).strip().rstrip("/")
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    path = parsed.path.rstrip("/")
    if path.endswith("/runners"):
        return f"{parsed.scheme}://{parsed.netloc}{path}"
    return f"{parsed.scheme}://{parsed.netloc}{path}/runners"


_UNSET = object()


@dataclass
class RunnerUiMeta:
    """User-writable cosmetic runner metadata exposed under meta.ui."""

    display_name: str | None = None

    @classmethod
    def from_dict(cls, data: dict | None) -> RunnerUiMeta | None:
        if not isinstance(data, dict):
            return None
        display_name = data.get("display_name")
        if display_name is not None and not isinstance(display_name, str):
            return None
        return cls(display_name=display_name)


@dataclass
class RunnerMeta:
    ui: RunnerUiMeta | None = None

    @classmethod
    def from_dict(cls, data: dict | None) -> RunnerMeta | None:
        if not isinstance(data, dict):
            return None
        return cls(ui=RunnerUiMeta.from_dict(data.get("ui")))


@dataclass
class Runner:
    runner_id: str
    owner_user_id: str
    name: str
    tags: list[str] = field(default_factory=list)
    platform: dict = field(default_factory=dict)
    version: str = ""
    created_at: datetime | None = None
    last_seen_at: datetime | None = None
    disconnected_at: datetime | None = None
    meta: RunnerMeta | None = None
    connected: bool | None = None
    ready: bool | None = None
    connection_scope: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> Runner:
        return cls(
            runner_id=str(data.get("runner_id", "")),
            owner_user_id=str(data.get("owner_user_id", "")),
            name=str(data.get("name", "")),
            tags=[str(tag) for tag in data.get("tags") or []],
            platform=dict(data.get("platform") or {}),
            version=str(data.get("version", "")),
            created_at=_parse_datetime(data.get("created_at")),
            last_seen_at=_parse_datetime(data.get("last_seen_at")),
            disconnected_at=_parse_datetime(data.get("disconnected_at")),
            meta=RunnerMeta.from_dict(data.get("meta")),
            connected=data.get("connected"),
            ready=data.get("ready"),
            connection_scope=data.get("connection_scope"),
        )


class RunnersAPI:
    """Client for the self-hosted runner registry mounted under the agents API."""

    def __init__(self, api_key: str, api_base: str | None = None, agents_api_base: str | None = None):
        if not api_key:
            raise ValueError("API key required for runners")
        self.api_key = api_key
        self.api_base = (api_base or _derive_runners_base(agents_api_base)).rstrip("/")

    def list(self) -> list[Runner]:
        data = _request("GET", self.api_base, api_key=self.api_key)
        items = data if isinstance(data, list) else data.get("runners") if isinstance(data, dict) else None
        if items is None:
            raise ValueError("Runners response must be an array.")
        return [Runner.from_dict(item) for item in items]

    def get(self, runner_id: str) -> Runner:
        data = _request("GET", f"{self.api_base}/{_encode_ref(runner_id)}", api_key=self.api_key)
        return Runner.from_dict(data)

    def update(self, runner_id: str, *, display_name: str | None | object = _UNSET) -> Runner:
        """Set meta.ui.display_name. Omit to leave it unchanged; pass None to clear it explicitly."""
        body = {} if display_name is _UNSET else {"ui": {"display_name": display_name}}
        if not body:
            return self.get(runner_id)
        data = _request(
            "PATCH",
            f"{self.api_base}/{_encode_ref(runner_id)}",
            api_key=self.api_key,
            json=body,
        )
        return Runner.from_dict(data)
