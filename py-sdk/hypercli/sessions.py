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


@dataclass
class RoomAgent:
    """One verified agent roster entry on a room read."""

    agent_id: str
    name: str
    internal_session_id: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoomAgent":
        internal_session_id = data.get("internal_session_id")
        if (not isinstance(data, dict)
                or not isinstance(data.get("agent_id"), str)
                or not isinstance(data.get("name"), str)
                or not (internal_session_id is None or isinstance(internal_session_id, str))):
            raise ValueError("Invalid room agent entry")
        return cls(data["agent_id"], data["name"], internal_session_id)


@dataclass
class RoomRecord:
    """Explicit multiparty room (docs/MULTIPARTY.md) as the product API reads it.

    ``agent_turn_limit`` is the effective per-epoch allowance the backend
    enforces (product default 25); ``configured_agent_turn_limit`` preserves
    the explicit configuration and is ``None`` when the default is in force.
    """

    id: str
    kind: str = "room"
    title: str | None = None
    purpose: str = ""
    style: str = ""
    rules: list[str] = field(default_factory=list)
    owner_id: str = ""
    agents: list[RoomAgent] = field(default_factory=list)
    token_limit: int | None = None
    agent_turn_limit: int = 25
    configured_agent_turn_limit: int | None = None
    status: str = "live"
    setup_revision: int = 0
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoomRecord":
        rules = data.get("rules") if isinstance(data, dict) else None
        agents = data.get("agents") if isinstance(data, dict) else None
        token_limit = data.get("token_limit") if isinstance(data, dict) else None
        agent_turn_limit = data.get("agent_turn_limit") if isinstance(data, dict) else None
        configured = data.get("configured_agent_turn_limit") if isinstance(data, dict) else None
        setup_revision = data.get("setup_revision") if isinstance(data, dict) else None
        if (not isinstance(data, dict)
                or not isinstance(data.get("id"), str)
                or data.get("kind") != "room"
                or not isinstance(data.get("owner_id"), str)
                or not isinstance(data.get("status"), str)
                or not (isinstance(rules, list) and all(isinstance(rule, str) for rule in rules))
                or not (isinstance(agents, list))
                or not (token_limit is None or (isinstance(token_limit, int) and not isinstance(token_limit, bool)))
                or not (isinstance(agent_turn_limit, int) and not isinstance(agent_turn_limit, bool))
                or not (configured is None or (isinstance(configured, int) and not isinstance(configured, bool)))
                or not (isinstance(setup_revision, int) and not isinstance(setup_revision, bool))):
            raise ValueError("Invalid room record response")
        title = data.get("title")
        purpose = data.get("purpose")
        style = data.get("style")
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        if not all(value is None or isinstance(value, str) for value in (title, created_at, updated_at)) \
                or not isinstance(purpose, str) or not isinstance(style, str):
            raise ValueError("Invalid room record response")
        return cls(
            id=data["id"],
            kind="room",
            title=title,
            purpose=purpose,
            style=style,
            rules=list(rules),
            owner_id=data["owner_id"],
            agents=[RoomAgent.from_dict(agent) for agent in agents],
            token_limit=token_limit,
            agent_turn_limit=agent_turn_limit,
            configured_agent_turn_limit=configured,
            status=data["status"],
            setup_revision=setup_revision,
            created_at=created_at,
            updated_at=updated_at,
        )


@dataclass
class RoomMessage:
    """One canonical room message committed by the authenticated owner."""

    session_id: str
    message_id: str
    seq: int
    epoch_id: str
    sender_id: str
    sender_kind: str
    sender_name: str
    body: str
    reply_to: str | None = None
    created_at: str | None = None
    fanout: dict[str, bool] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoomMessage":
        fanout = data.get("fanout") if isinstance(data, dict) else None
        seq = data.get("seq") if isinstance(data, dict) else None
        reply_to = data.get("reply_to") if isinstance(data, dict) else None
        created_at = data.get("created_at") if isinstance(data, dict) else None
        if (not isinstance(data, dict)
                or not isinstance(data.get("session_id"), str)
                or not isinstance(data.get("message_id"), str)
                or not (isinstance(seq, int) and not isinstance(seq, bool))
                or not isinstance(data.get("epoch_id"), str)
                or not isinstance(data.get("sender_id"), str)
                or not isinstance(data.get("sender_kind"), str)
                or not isinstance(data.get("sender_name"), str)
                or not isinstance(data.get("body"), str)
                or not (reply_to is None or isinstance(reply_to, str))
                or not (created_at is None or isinstance(created_at, str))
                or not (isinstance(fanout, dict)
                        and all(isinstance(key, str) and isinstance(value, bool)
                                for key, value in fanout.items()))):
            raise ValueError("Invalid room message response")
        return cls(
            session_id=data["session_id"],
            message_id=data["message_id"],
            seq=seq,
            epoch_id=data["epoch_id"],
            sender_id=data["sender_id"],
            sender_kind=data["sender_kind"],
            sender_name=data["sender_name"],
            body=data["body"],
            reply_to=reply_to,
            created_at=created_at,
            fanout=dict(fanout),
        )
