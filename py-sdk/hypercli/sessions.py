"""Backend session catalog types. Source is descriptive, forward-open provenance."""

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from acp import schema


def _parse_session_setup(setup: Any) -> dict[str, Any]:
    if not isinstance(setup, dict) or not isinstance(setup.get("mcpServers"), list):
        raise ValueError("Invalid session setup: expected an object with mcpServers")
    parsed = schema.NewSessionRequest.model_validate(setup)
    # Upstream's forward-compatible parser drops invalid list entries. Recovery
    # must preserve the entire intended list or fail, never silently shorten it.
    if len(parsed.mcp_servers) != len(setup["mcpServers"]):
        raise ValueError("Invalid session setup MCP server entry")
    return deepcopy(setup)


@dataclass
class SessionSetup:
    """Platform-retained standard ACP setup for one session/agent pair."""

    session_id: str
    agent_id: str
    setup: dict[str, Any] | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionSetup":
        if (not isinstance(data, dict)
                or not isinstance(data.get("session_id"), str)
                or not isinstance(data.get("agent_id"), str)
                or "setup" not in data):
            raise ValueError("Invalid session setup response")
        setup = data["setup"]
        if setup is not None:
            setup = _parse_session_setup(setup)
        return cls(data["session_id"], data["agent_id"], setup)


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
    external_url: str | None = None  # opaque external reference, independent of source
    meta: dict[str, Any] = field(default_factory=dict)
    mode: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionRecord":
        agent_state = data.get("agentState", data.get("agent_state"))
        return cls(
            id=str(data["id"]),
            meta=deepcopy(data.get("meta", {})),
            mode=data.get("mode"),
            source=data.get("source") if isinstance(data.get("source"), str) else None,
            external_url=data.get("external_url"),
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
            agent_state=agent_state if isinstance(agent_state, str) else None,
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
