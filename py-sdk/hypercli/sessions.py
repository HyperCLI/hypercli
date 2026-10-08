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
    import_outcome: dict[str, Any] | None = None
    last_message_id: str | None = None
    message_count: int | None = None
    head_seq: int | None = None
    receipts: list[dict[str, Any]] = field(default_factory=list)
    agent_state: str | None = None  # computed per request ("live"|"archived"|"deleted"); None on old servers

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
            import_outcome=data.get("import_outcome") if isinstance(data.get("import_outcome"), dict) else None,
            last_message_id=data.get("last_message_id"),
            message_count=data.get("message_count"),
            head_seq=data.get("head_seq"),
            receipts=list(data.get("receipts") or []),
            agent_state=data.get("agent_state") if isinstance(data.get("agent_state"), str) else None,
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
