"""Backend session catalog types. Source is descriptive, forward-open provenance."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionRecord:
    id: str
    source: str | None = None
    summary_text: str | None = None
    summary_keywords: list[str] = field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None
    participants: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionRecord":
        return cls(
            id=str(data["id"]),
            source=data.get("source") if isinstance(data.get("source"), str) else None,
            summary_text=data.get("summary_text"),
            summary_keywords=list(data.get("summary_keywords") or []),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
            participants=list(data.get("participants") or []),
        )


@dataclass
class SessionPage:
    items: list[SessionRecord]
    next_cursor: str | None = None
    has_more: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionPage":
        return cls(
            items=[SessionRecord.from_dict(row) for row in data.get("items", [])],
            next_cursor=data.get("next_cursor"),
            has_more=data.get("has_more") is True,
        )
