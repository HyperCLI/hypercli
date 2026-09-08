"""Routines API client."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

from .config import get_agents_api_base_url, get_config_value
from .workspaces import _request


def _derive_routines_base(agents_api_base: str | None = None) -> str:
    configured = get_config_value("HYPER_ROUTINES_API_BASE")
    if configured:
        raw = configured.strip().rstrip("/")
    else:
        raw = (agents_api_base or get_agents_api_base_url()).strip().rstrip("/")
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    path = parsed.path.rstrip("/")
    if path.endswith("/routines"):
        return f"{parsed.scheme}://{parsed.netloc}{path}"
    if path.endswith("/agents"):
        path = path[: -len("/agents")]
    return f"{parsed.scheme}://{parsed.netloc}{path}/routines"


def _encode_ref(value: str) -> str:
    return quote(value, safe="")


def _parse_datetime(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        raise ValueError(f"Invalid routine timestamp: {value}")
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp


@dataclass
class Routine:
    id: str
    user_id: str
    agent_id: str
    cron: str | None
    prompt: str
    enabled: bool
    name: str | None = None
    run_at: str | None = None
    next_run_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Routine":
        return cls(
            id=str(data.get("id", "")),
            user_id=str(data.get("user_id", "")),
            agent_id=str(data.get("agent_id", "")),
            cron=data.get("cron"),
            prompt=data.get("prompt", ""),
            enabled=bool(data.get("enabled", True)),
            name=data.get("name"),
            run_at=data.get("run_at"),
            next_run_at=_parse_datetime(data.get("next_run_at")),
            created_at=_parse_datetime(data.get("created_at")),
            updated_at=_parse_datetime(data.get("updated_at")),
        )


class RoutinesAPI:
    """Client for the routines service mounted at /routines."""

    def __init__(self, api_key: str, api_base: str | None = None, agents_api_base: str | None = None):
        if not api_key:
            raise ValueError("API key required for routines")
        self.api_key = api_key
        self.api_base = (api_base or _derive_routines_base(agents_api_base)).rstrip("/")

    def list(self, *, agent_id: str | None = None) -> list[Routine]:
        params = {"agent_id": agent_id} if agent_id else None
        data = _request("GET", self.api_base, api_key=self.api_key, params=params)
        return [Routine.from_dict(item) for item in data]

    def get(self, routine_id: str) -> Routine:
        data = _request(
            "GET",
            f"{self.api_base}/{_encode_ref(routine_id)}",
            api_key=self.api_key,
        )
        return Routine.from_dict(data)

    def create(
        self,
        *,
        agent_id: str,
        prompt: str,
        cron: str | None = None,
        run_at: str | None = None,
        name: str | None = None,
        enabled: bool = True,
    ) -> Routine:
        payload = {
            "agent_id": agent_id,
            "prompt": prompt,
            "enabled": enabled,
        }
        if cron is not None:
            payload["cron"] = cron
        if run_at is not None:
            payload["run_at"] = run_at
        if name is not None:
            payload["name"] = name
        data = _request("POST", self.api_base, api_key=self.api_key, json=payload)
        return Routine.from_dict(data)

    def update(
        self,
        routine_id: str,
        *,
        agent_id: str | None = None,
        cron: str | None = None,
        prompt: str | None = None,
        enabled: bool | None = None,
        name: str | None = None,
    ) -> Routine:
        payload = {}
        if agent_id is not None:
            payload["agent_id"] = agent_id
        if cron is not None:
            payload["cron"] = cron
        if name is not None:
            payload["name"] = name
        if prompt is not None:
            payload["prompt"] = prompt
        if enabled is not None:
            payload["enabled"] = enabled
        data = _request(
            "PATCH",
            f"{self.api_base}/{_encode_ref(routine_id)}",
            api_key=self.api_key,
            json=payload,
        )
        return Routine.from_dict(data)

    def delete(self, routine_id: str) -> dict:
        return _request(
            "DELETE",
            f"{self.api_base}/{_encode_ref(routine_id)}",
            api_key=self.api_key,
        )
