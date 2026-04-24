"""
OpenClaw Gateway Client — WebSocket RPC client for the OpenClaw Gateway protocol.

The Python SDK mirrors the TS SDK's browser/control-ui handshake closely:
- edge/proxy auth uses `?token=<jwt>`
- gateway auth uses the shared gateway token or a cached device token
- non-local connects require signed device identity payloads
- pairing-required flows can be auto-approved through trusted exec
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import shlex
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Literal, Optional
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

import httpx
import websockets
from nacl.signing import SigningKey
from websockets.asyncio.client import ClientConnection


PROTOCOL_VERSION = 3
DEFAULT_TIMEOUT = 15.0
CHAT_TIMEOUT = 120.0
INITIAL_RECONNECT_DELAY = 0.8
MAX_RECONNECT_DELAY = 15.0
BACKOFF_MULTIPLIER = 1.7
OPERATOR_ROLE = "operator"
OPERATOR_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"]
STORAGE_VERSION = 1
STORAGE_KEY = "openclaw.device.auth.v1"
CONNECT_ERROR_PAIRING_REQUIRED = "PAIRING_REQUIRED"
CONNECT_ERROR_DEVICE_TOKEN_MISMATCH = "AUTH_DEVICE_TOKEN_MISMATCH"
PAIRING_APPROVED_CODE = "PAIRING_APPROVED"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _storage_path() -> Path:
    override = os.environ.get("HYPERCLI_GATEWAY_STORE_PATH", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".hypercli" / "openclaw-device-auth.json"


def _storage_scope_key(scope: str, role: str) -> str:
    return f"{scope.strip()}|{role.strip()}"


GatewayConnectionState = Literal["disconnected", "connecting", "connected"]


@dataclass
class DeviceTokenEntry:
    token: str
    role: str
    scopes: list[str]
    updated_at_ms: int
    gateway_url: str | None = None


@dataclass
class GatewayPairingState:
    request_id: str
    role: str
    gateway_url: str
    status: str
    updated_at_ms: int
    device_id: str | None = None
    error: str | None = None


@dataclass
class DeviceIdentityRecord:
    device_id: str
    public_key: str
    private_key: str
    created_at_ms: int


@dataclass
class DeviceAuthStore:
    version: int = STORAGE_VERSION
    device_id: str | None = None
    public_key: str | None = None
    private_key: str | None = None
    created_at_ms: int | None = None
    tokens: dict[str, dict[str, Any]] | None = None
    pending_pairings: dict[str, dict[str, Any]] | None = None


def _read_device_auth_store() -> DeviceAuthStore | None:
    path = _storage_path()
    try:
        if path.exists():
            raw = json.loads(path.read_text())
            if isinstance(raw, dict) and raw.get("version") == STORAGE_VERSION:
                return DeviceAuthStore(**raw)
    except Exception:
        return None
    return None


def _write_device_auth_store(store: DeviceAuthStore) -> None:
    path = _storage_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": STORAGE_VERSION,
        **({"device_id": store.device_id} if store.device_id else {}),
        **({"public_key": store.public_key} if store.public_key else {}),
        **({"private_key": store.private_key} if store.private_key else {}),
        **({"created_at_ms": store.created_at_ms} if store.created_at_ms is not None else {}),
        **({"tokens": store.tokens} if store.tokens else {}),
        **({"pending_pairings": store.pending_pairings} if store.pending_pairings else {}),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _load_or_create_device_identity() -> DeviceIdentityRecord:
    store = _read_device_auth_store()
    if store and store.public_key and store.private_key:
        derived_id = _sha256_hex(_b64url_decode(store.public_key))
        if derived_id != store.device_id:
            store.device_id = derived_id
            _write_device_auth_store(store)
        return DeviceIdentityRecord(
            device_id=derived_id,
            public_key=store.public_key,
            private_key=store.private_key,
            created_at_ms=store.created_at_ms or _now_ms(),
        )

    signing_key = SigningKey.generate()
    public_key_bytes = signing_key.verify_key.encode()
    identity = DeviceIdentityRecord(
        device_id=_sha256_hex(public_key_bytes),
        public_key=_b64url(public_key_bytes),
        private_key=_b64url(signing_key.encode()),
        created_at_ms=_now_ms(),
    )
    _write_device_auth_store(
        DeviceAuthStore(
            device_id=identity.device_id,
            public_key=identity.public_key,
            private_key=identity.private_key,
            created_at_ms=identity.created_at_ms,
            tokens=(store.tokens if store else None),
            pending_pairings=(store.pending_pairings if store else None),
        )
    )
    return identity


def _load_stored_device_token(device_id: str, scope: str, role: str) -> DeviceTokenEntry | None:
    store = _read_device_auth_store()
    if not store or store.device_id != device_id or not store.tokens:
        return None
    key = _storage_scope_key(scope, role)
    entry = store.tokens.get(key)
    if not isinstance(entry, dict) or not isinstance(entry.get("token"), str):
        return None
    return DeviceTokenEntry(**entry)


def _store_stored_device_token(
    *,
    device_id: str,
    scope: str,
    role: str,
    token: str,
    scopes: list[str] | None = None,
    gateway_url: str | None = None,
) -> DeviceTokenEntry:
    store = _read_device_auth_store() or DeviceAuthStore()
    key = _storage_scope_key(scope, role)
    entry = DeviceTokenEntry(
        token=token,
        role=role,
        scopes=list(scopes or []),
        updated_at_ms=_now_ms(),
        gateway_url=gateway_url,
    )
    tokens = dict(store.tokens or {})
    tokens[key] = asdict(entry)
    store.tokens = tokens
    if not store.device_id:
        store.device_id = device_id
    _write_device_auth_store(store)
    return entry


def _clear_stored_device_token(device_id: str, scope: str, role: str) -> None:
    store = _read_device_auth_store()
    if not store or store.device_id != device_id or not store.tokens:
        return
    key = _storage_scope_key(scope, role)
    if key not in store.tokens:
        return
    tokens = dict(store.tokens)
    del tokens[key]
    store.tokens = tokens or None
    _write_device_auth_store(store)


def _load_pending_pairing(scope: str, role: str) -> GatewayPairingState | None:
    store = _read_device_auth_store()
    if not store or not store.pending_pairings:
        return None
    entry = store.pending_pairings.get(_storage_scope_key(scope, role))
    if not isinstance(entry, dict):
        return None
    return GatewayPairingState(**entry)


def _store_pending_pairing(pairing: GatewayPairingState, scope: str) -> GatewayPairingState:
    store = _read_device_auth_store() or DeviceAuthStore()
    pending = dict(store.pending_pairings or {})
    pending[_storage_scope_key(scope, pairing.role)] = asdict(pairing)
    store.pending_pairings = pending
    _write_device_auth_store(store)
    return pairing


def _clear_pending_pairing(scope: str, role: str) -> None:
    store = _read_device_auth_store()
    if not store or not store.pending_pairings:
        return
    key = _storage_scope_key(scope, role)
    if key not in store.pending_pairings:
        return
    pending = dict(store.pending_pairings)
    del pending[key]
    store.pending_pairings = pending or None
    _write_device_auth_store(store)


def _build_device_auth_payload(
    *,
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    signed_at_ms: int,
    token: str | None,
    nonce: str,
) -> str:
    return "|".join(
        [
            "v2",
            device_id,
            client_id,
            client_mode,
            role,
            ",".join(scopes),
            str(signed_at_ms),
            token or "",
            nonce,
        ]
    )


def _sign_device_payload(private_key: str, payload: str) -> str:
    signing_key = SigningKey(_b64url_decode(private_key))
    return _b64url(signing_key.sign(payload.encode("utf-8")).signature)


def _read_connect_error_code(details: Any) -> str | None:
    if not isinstance(details, dict):
        return None
    code = details.get("code")
    return code.strip() if isinstance(code, str) and code.strip() else None


def _read_connect_pairing_request_id(details: Any) -> str | None:
    if not isinstance(details, dict):
        return None
    request_id = details.get("requestId")
    return request_id.strip() if isinstance(request_id, str) and request_id.strip() else None


def _is_concurrent_pairing_approval_race(exc: Exception) -> bool:
    return "unknown requestid" in str(exc).lower()


def _is_retryable_connect_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code in {404, 408, 425, 429, 500, 502, 503, 504}

    text = str(exc).lower()
    transient_markers = (
        "503",
        "502",
        "504",
        "service unavailable",
        "connection refused",
        "timed out",
        "temporarily unavailable",
        "try again",
    )
    return any(marker in text for marker in transient_markers)


def _with_query_token(url: str, token: str | None) -> str:
    if not token:
        return url
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("token", token))
    query_text = "&".join(f"{quote(k)}={quote(v)}" for k, v in query)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query_text, parts.fragment))


@dataclass
class GatewayError(Exception):
    """Error returned by the Gateway."""

    code: str
    message: str
    details: Optional[dict] = None

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class GatewayRequestError(GatewayError):
    """Structured gateway request error."""


@dataclass
class GatewayCloseInfo:
    code: int
    reason: str
    error: GatewayError | None = None


@dataclass
class ChatEvent:
    """A streaming chat event."""

    type: str
    text: Optional[str] = None
    data: Optional[dict] = None


@dataclass
class GatewayChatToolCall:
    id: str | None
    name: str
    args: Any = None
    result: str | None = None


@dataclass
class GatewayChatMessageSummary:
    role: str
    text: str
    thinking: str
    tool_calls: list[GatewayChatToolCall]
    media_urls: list[str]
    timestamp: int | None = None


def _as_content_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _normalize_tool_args(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    trimmed = value.strip()
    if not trimmed or (not trimmed.startswith("{") and not trimmed.startswith("[")):
        return value
    try:
        return json.loads(trimmed)
    except Exception:
        return value


def _stringify_tool_result(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, indent=2)
    except Exception:
        return str(value)


def _gateway_tool_call_id(record: dict[str, Any]) -> str | None:
    for candidate in (
        record.get("id"),
        record.get("toolCallId"),
        record.get("tool_call_id"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _gateway_tool_name(record: dict[str, Any]) -> str | None:
    for candidate in (
        record.get("name"),
        record.get("toolName"),
        record.get("tool_name"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _merge_gateway_tool_result(
    tool_calls: list[GatewayChatToolCall],
    result: GatewayChatToolCall,
) -> list[GatewayChatToolCall]:
    next_tool_calls = list(tool_calls)
    index = -1
    for cursor in range(len(next_tool_calls) - 1, -1, -1):
        entry = next_tool_calls[cursor]
        if result.id and entry.id and entry.id == result.id:
            index = cursor
            break
        if result.name and entry.name == result.name and entry.result is None:
            index = cursor
            break
    if index >= 0:
        current = next_tool_calls[index]
        next_tool_calls[index] = GatewayChatToolCall(
            id=result.id or current.id,
            name=current.name,
            args=current.args,
            result=result.result if result.result is not None else current.result,
        )
        return next_tool_calls
    next_tool_calls.append(result)
    return next_tool_calls


def _extract_message_text(message: Any) -> str:
    if isinstance(message, str):
        return message
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for entry in content:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") != "text":
                continue
            text = entry.get("text")
            if isinstance(text, str) and text:
                parts.append(text)
        if parts:
            return "\n".join(parts)

    text = message.get("text")
    return text if isinstance(text, str) else ""


def extract_gateway_chat_thinking(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    parts: list[str] = []
    for entry in _as_content_items(message.get("content")):
        if entry.get("type") != "thinking":
            continue
        thinking = entry.get("thinking")
        if isinstance(thinking, str) and thinking.strip():
            parts.append(thinking.strip())
    return "\n".join(parts)


def extract_gateway_chat_media_urls(message: Any) -> list[str]:
    if not isinstance(message, dict):
        return []

    media_urls: list[str] = []
    for entry in _as_content_items(message.get("content")):
        if entry.get("type") != "image":
            continue
        source = entry.get("source")
        if not isinstance(source, dict):
            continue
        if source.get("type") == "url" and isinstance(source.get("url"), str) and source.get("url").strip():
            media_urls.append(source["url"])
            continue
        if (
            source.get("type") == "base64"
            and isinstance(source.get("data"), str)
            and source.get("data").strip()
        ):
            mime_type = source.get("media_type") if isinstance(source.get("media_type"), str) else "image/png"
            media_urls.append(f"data:{mime_type};base64,{source['data']}")

    media_url = message.get("mediaUrl")
    if isinstance(media_url, str) and media_url.strip():
        media_urls.append(media_url)
    extra_media_urls = message.get("mediaUrls")
    if isinstance(extra_media_urls, list):
        for entry in extra_media_urls:
            if isinstance(entry, str) and entry.strip():
                media_urls.append(entry)
    return media_urls


def extract_gateway_chat_tool_calls(message: Any) -> list[GatewayChatToolCall]:
    if not isinstance(message, dict):
        return []

    tool_calls: list[GatewayChatToolCall] = []
    for entry in _as_content_items(message.get("content")):
        kind = str(entry.get("type") or "").strip().lower()
        name = _gateway_tool_name(entry)
        tool_call_id = _gateway_tool_call_id(entry)

        if kind in {"toolcall", "tool_call", "tooluse", "tool_use"} or (
            name and (entry.get("arguments") is not None or entry.get("args") is not None)
        ):
            tool_calls.append(
                GatewayChatToolCall(
                    id=tool_call_id,
                    name=name or "tool",
                    args=_normalize_tool_args(entry.get("arguments", entry.get("args"))),
                )
            )
            continue

        if kind in {"toolresult", "tool_result"}:
            tool_calls = _merge_gateway_tool_result(
                tool_calls,
                GatewayChatToolCall(
                    id=tool_call_id,
                    name=name or "tool",
                    result=_stringify_tool_result(
                        entry.get("text", entry.get("content", entry.get("result")))
                    ),
                ),
            )

    top_level_tool_calls = message.get("tool_calls")
    if isinstance(top_level_tool_calls, list):
        for entry in top_level_tool_calls:
            if not isinstance(entry, dict):
                continue
            name = _gateway_tool_name(entry)
            if not name:
                continue
            tool_calls.append(
                GatewayChatToolCall(
                    id=_gateway_tool_call_id(entry),
                    name=name,
                    args=_normalize_tool_args(entry.get("arguments", entry.get("args"))),
                )
            )

    top_level_name = _gateway_tool_name(message)
    top_level_result = _stringify_tool_result(
        message.get("result", message.get("content", message.get("text", message.get("partialResult"))))
    )
    role = str(message.get("role") or "").strip().lower()
    if top_level_name and top_level_result and (
        role in {"toolresult", "tool_result"} or message.get("toolCallId") or message.get("tool_call_id")
    ):
        tool_calls = _merge_gateway_tool_result(
            tool_calls,
            GatewayChatToolCall(
                id=_gateway_tool_call_id(message),
                name=top_level_name,
                result=top_level_result,
            ),
        )

    return tool_calls


def normalize_gateway_chat_message(message: Any) -> GatewayChatMessageSummary | None:
    if not isinstance(message, dict):
        return None

    text = _extract_message_text(message)
    thinking = extract_gateway_chat_thinking(message)
    tool_calls = extract_gateway_chat_tool_calls(message)
    media_urls = extract_gateway_chat_media_urls(message)
    timestamp = message.get("timestamp") if isinstance(message.get("timestamp"), int) else None
    role = message.get("role") if isinstance(message.get("role"), str) and message.get("role").strip() else "assistant"

    if not text and not thinking and not tool_calls and not media_urls:
        return None

    return GatewayChatMessageSummary(
        role=role,
        text=text,
        thinking=thinking,
        tool_calls=tool_calls,
        media_urls=media_urls,
        timestamp=timestamp,
    )


def _message_run_id(message: Any) -> str | None:
    if not isinstance(message, dict):
        return None

    for candidate in (
        message.get("runId"),
        message.get("agentRunId"),
        (message.get("meta") or {}).get("runId") if isinstance(message.get("meta"), dict) else None,
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _latest_history_assistant_text(messages: list[dict], accepted_run_ids: set[str]) -> str:
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip().lower()
        if role != "assistant":
            continue
        message_run_id = _message_run_id(message)
        if message_run_id and accepted_run_ids and message_run_id not in accepted_run_ids:
            continue
        text = _extract_message_text(message).strip()
        if text:
            return text
    return ""


def _stream_delta(previous_text: str, next_text: str) -> tuple[str, str]:
    if not next_text:
        return "", previous_text
    if previous_text and next_text.startswith(previous_text):
        return next_text[len(previous_text):], next_text
    if next_text == previous_text:
        return "", previous_text
    return next_text, next_text


def _parse_agent_session_key(session_key: str | None) -> tuple[str, str] | None:
    normalized = (session_key or "").strip().lower()
    if not normalized:
        return None
    parts = [part for part in normalized.split(":") if part]
    if len(parts) < 3 or parts[0] != "agent":
        return None
    agent_id = parts[1].strip()
    rest = ":".join(parts[2:]).strip()
    if not agent_id or not rest:
        return None
    return agent_id, rest


def _same_session_key(left: str | None, right: str | None) -> bool:
    normalized_left = (left or "").strip().lower()
    normalized_right = (right or "").strip().lower()
    if not normalized_left or not normalized_right:
        return False
    if normalized_left == normalized_right:
        return True

    parsed_left = _parse_agent_session_key(normalized_left)
    parsed_right = _parse_agent_session_key(normalized_right)
    if parsed_left and parsed_right:
        return parsed_left == parsed_right
    if parsed_left:
        return parsed_left[1] == normalized_right
    if parsed_right:
        return normalized_left == parsed_right[1]
    return False


class GatewayClient:
    """
    Async WebSocket client for the OpenClaw Gateway protocol v3.

    The implementation follows the TS SDK's handshake and storage model closely.
    """

    def __init__(
        self,
        url: str,
        token: str | None = None,
        gateway_token: str | None = None,
        deployment_id: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        auto_approve_pairing: bool = False,
        client_id: str = "cli",
        client_mode: str = "cli",
        client_display_name: str | None = None,
        client_version: str = "hypercli-sdk",
        client_platform: str = "python",
        client_instance_id: str | None = None,
        caps: list[str] | None = None,
        origin: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        chat_timeout: float = CHAT_TIMEOUT,
        on_hello: Callable[[dict[str, Any]], None] | None = None,
        on_close: Callable[[GatewayCloseInfo], None] | None = None,
        on_gap: Callable[[dict[str, int]], None] | None = None,
        on_pairing: Callable[[GatewayPairingState | None], None] | None = None,
    ):
        self.url = url
        self.token = token
        self.gateway_token = gateway_token
        self.deployment_id = deployment_id
        self.api_key = api_key
        self.api_base = api_base.rstrip("/") if api_base else None
        self.auto_approve_pairing = auto_approve_pairing
        self.client_id = client_id or "cli"
        self.client_mode = client_mode or "cli"
        self.client_display_name = client_display_name
        self.client_version = client_version
        self.client_platform = client_platform
        self.client_instance_id = client_instance_id
        self.caps = list(caps or ["tool-events"])
        # Non-browser SDK clients should not send Origin by default. OpenClaw
        # treats any Origin header as browser-originated and enforces the
        # control-ui/browser origin checks.
        self.origin = origin.strip() if isinstance(origin, str) and origin.strip() else None
        self.timeout = timeout
        self.chat_timeout = chat_timeout
        self.on_hello = on_hello
        self.on_close = on_close
        self.on_gap = on_gap
        self.on_pairing = on_pairing

        self._ws: ClientConnection | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._event_handlers: set[Callable[[dict[str, Any]], None]] = set()
        self._connection_state_handlers: set[Callable[[GatewayConnectionState], None]] = set()
        self._reader_task: asyncio.Task | None = None
        self._connected = False
        self._connection_state: GatewayConnectionState = "disconnected"
        self._closed = False
        self._version: str | None = None
        self._protocol: int | None = None
        self._pending_pairing = _load_pending_pairing(self._storage_scope(), OPERATOR_ROLE)
        self._last_seq: int | None = None
        self._auto_approve_attempted_request_ids: set[str] = set()

    @property
    def version(self) -> str | None:
        return self._version

    @property
    def protocol(self) -> int | None:
        return self._protocol

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def connection_state(self) -> GatewayConnectionState:
        return self._connection_state

    @property
    def pending_pairing(self) -> GatewayPairingState | None:
        return self._pending_pairing

    def on_connection_state(self, handler: Callable[[GatewayConnectionState], None]) -> Callable[[], None]:
        self._connection_state_handlers.add(handler)
        return lambda: self._connection_state_handlers.discard(handler)

    def _set_connection_state(self, state: GatewayConnectionState) -> None:
        if self._connection_state == state:
            return
        self._connection_state = state
        for handler in list(self._connection_state_handlers):
            try:
                handler(state)
            except Exception:
                pass

    def set_gateway_token(self, token: str | None) -> None:
        self.gateway_token = token.strip() if isinstance(token, str) and token.strip() else None

    def _storage_scope(self) -> str:
        return self.deployment_id or self.url

    def on_event(self, handler: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self._event_handlers.add(handler)
        return lambda: self._event_handlers.discard(handler)

    def _update_pairing_state(self, pairing: GatewayPairingState | None) -> None:
        self._pending_pairing = pairing
        if pairing:
            _store_pending_pairing(pairing, self._storage_scope())
        else:
            _clear_pending_pairing(self._storage_scope(), OPERATOR_ROLE)
        if self.on_pairing:
            self.on_pairing(pairing)

    def _can_auto_approve_pairing(self) -> bool:
        return bool(
            self.auto_approve_pairing
            and self.deployment_id
            and self.api_key
            and self.api_base
        )

    async def _approve_pairing_request(self, request_id: str) -> None:
        if not self._can_auto_approve_pairing():
            raise RuntimeError(
                "auto_approve_pairing requires deployment_id, api_key, and api_base"
            )
        command = (
            "openclaw devices approve "
            f"{shlex.quote(request_id)} --json"
        )
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.api_base}/deployments/{quote(self.deployment_id or '')}/exec",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "command": command,
                    "timeout": 30,
                },
            )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Pairing approval failed: {response.status_code} {response.text}"
            )
        payload = response.json()
        exit_code = payload.get("exitCode", payload.get("exit_code", 1))
        if exit_code != 0:
            raise RuntimeError(
                (payload.get("stderr") or payload.get("stdout") or "pairing approval failed").strip()
            )

    async def _reader_loop(self) -> None:
        close_info: GatewayCloseInfo | None = None
        try:
            assert self._ws is not None
            async for raw in self._ws:
                self._handle_message(raw)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            close_info = GatewayCloseInfo(
                code=1006,
                reason="reader closed",
                error=GatewayError("UNAVAILABLE", str(exc)),
            )
        else:
            ws = self._ws
            close_info = GatewayCloseInfo(
                code=int(getattr(ws, "close_code", 1000) or 1000),
                reason=str(getattr(ws, "close_reason", "") or ""),
                error=None,
            )
        finally:
            self._connected = False
            self._set_connection_state("disconnected")
            self._ws = None
            close_error = close_info.error if close_info and close_info.error else GatewayError(
                "UNAVAILABLE",
                f"gateway closed ({close_info.code if close_info else 1006}): {(close_info.reason if close_info else 'reader closed') or 'reader closed'}",
            )
            for request_id, future in list(self._pending.items()):
                if not future.done():
                    future.set_exception(close_error)
                self._pending.pop(request_id, None)
            if self.on_close and close_info:
                self.on_close(close_info)

    def _handle_message(self, raw: str) -> None:
        try:
            message = json.loads(raw)
        except Exception:
            return

        if message.get("type") == "event":
            seq = message.get("seq")
            if isinstance(seq, int):
                if self._last_seq is not None and seq > self._last_seq + 1 and self.on_gap:
                    self.on_gap({"expected": self._last_seq + 1, "received": seq})
                self._last_seq = seq
            self._event_queue.put_nowait(message)
            for handler in list(self._event_handlers):
                try:
                    handler(message)
                except Exception:
                    pass
            return

        if message.get("type") != "res":
            return

        future = self._pending.pop(message.get("id"), None)
        if not future or future.done():
            return

        if message.get("ok"):
            future.set_result(message.get("payload"))
            return

        error = message.get("error") or {}
        future.set_exception(
            GatewayRequestError(
                error.get("code", "UNAVAILABLE"),
                error.get("message", "gateway request failed"),
                error.get("details") if isinstance(error.get("details"), dict) else None,
            )
        )

    async def _send_connect(self, ws: ClientConnection, nonce: str) -> dict[str, Any]:
        identity = _load_or_create_device_identity()
        stored_device_token = _load_stored_device_token(
            identity.device_id,
            self._storage_scope(),
            OPERATOR_ROLE,
        )
        auth_token = stored_device_token.token if stored_device_token else self.gateway_token
        signed_at_ms = _now_ms()
        payload = _build_device_auth_payload(
            device_id=identity.device_id,
            client_id=self.client_id,
            client_mode=self.client_mode,
            role=OPERATOR_ROLE,
            scopes=OPERATOR_SCOPES,
            signed_at_ms=signed_at_ms,
            token=auth_token,
            nonce=nonce,
        )
        request_id = str(uuid.uuid4())
        params: dict[str, Any] = {
            "minProtocol": PROTOCOL_VERSION,
            "maxProtocol": PROTOCOL_VERSION,
            "client": {
                "id": self.client_id,
                **({"displayName": self.client_display_name} if self.client_display_name else {}),
                "version": self.client_version,
                "platform": self.client_platform,
                "mode": self.client_mode,
                **({"instanceId": self.client_instance_id} if self.client_instance_id else {}),
            },
            "role": OPERATOR_ROLE,
            "scopes": list(OPERATOR_SCOPES),
            "device": {
                "id": identity.device_id,
                "publicKey": identity.public_key,
                "signature": _sign_device_payload(identity.private_key, payload),
                "signedAt": signed_at_ms,
                "nonce": nonce,
            },
            "caps": list(self.caps),
            **({"auth": {"token": auth_token}} if auth_token else {}),
        }
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": request_id,
                    "method": "connect",
                    "params": params,
                }
            )
        )
        raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout)
        message = json.loads(raw)
        if not message.get("ok"):
            error = message.get("error") or {}
            raise GatewayRequestError(
                error.get("code", "CONNECT_FAILED"),
                error.get("message", "Connection rejected"),
                error.get("details") if isinstance(error.get("details"), dict) else None,
            )

        payload_data = message.get("payload") or {}
        device_token = ((payload_data.get("auth") or {}).get("deviceToken") or "").strip()
        if device_token:
            _store_stored_device_token(
                device_id=identity.device_id,
                scope=self._storage_scope(),
                role=(payload_data.get("auth") or {}).get("role", OPERATOR_ROLE),
                token=device_token,
                scopes=list((payload_data.get("auth") or {}).get("scopes") or []),
                gateway_url=self.url,
            )
        return payload_data

    async def connect(self) -> None:
        self._closed = False
        if self._connected:
            return
        self._set_connection_state("connecting")

        delay = INITIAL_RECONNECT_DELAY
        deadline = asyncio.get_running_loop().time() + max(self.timeout, 30.0)
        while not self._closed:
            ws: ClientConnection | None = None
            try:
                ws = await websockets.connect(
                    _with_query_token(self.url, self.token),
                    origin=self.origin,
                    ping_interval=None,
                )
                raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout)
                challenge = json.loads(raw)
                nonce = str((challenge.get("payload") or {}).get("nonce") or "").strip()
                if challenge.get("event") != "connect.challenge":
                    raise GatewayError("PROTOCOL", f"Expected connect.challenge, got {challenge}")
                if not nonce:
                    raise GatewayError("DEVICE_AUTH_NONCE_REQUIRED", "gateway connect challenge missing nonce")

                hello = await self._send_connect(ws, nonce)
                self._ws = ws
                self._version = hello.get("server", {}).get("version") or hello.get("version")
                self._protocol = hello.get("protocol")
                self._connected = True
                self._set_connection_state("connected")
                self._update_pairing_state(None)
                self._last_seq = None
                self._reader_task = asyncio.create_task(self._reader_loop())
                if self.on_hello:
                    self.on_hello(hello)
                return
            except GatewayRequestError as exc:
                details = exc.details or {}
                detail_code = _read_connect_error_code(details)
                request_id = _read_connect_pairing_request_id(details)
                identity = _load_or_create_device_identity()

                if detail_code in {CONNECT_ERROR_PAIRING_REQUIRED, CONNECT_ERROR_DEVICE_TOKEN_MISMATCH}:
                    _clear_stored_device_token(identity.device_id, self._storage_scope(), OPERATOR_ROLE)

                if detail_code == CONNECT_ERROR_PAIRING_REQUIRED and request_id:
                    self._update_pairing_state(
                        GatewayPairingState(
                            request_id=request_id,
                            role=OPERATOR_ROLE,
                            gateway_url=self.url,
                            device_id=identity.device_id,
                            status="pending",
                            updated_at_ms=_now_ms(),
                        )
                    )
                    if (
                        self._can_auto_approve_pairing()
                        and request_id not in self._auto_approve_attempted_request_ids
                    ):
                        self._auto_approve_attempted_request_ids.add(request_id)
                        try:
                            self._update_pairing_state(
                                GatewayPairingState(
                                    request_id=request_id,
                                    role=OPERATOR_ROLE,
                                    gateway_url=self.url,
                                    device_id=identity.device_id,
                                    status="approving",
                                    updated_at_ms=_now_ms(),
                                )
                            )
                            await self._approve_pairing_request(request_id)
                            self._update_pairing_state(
                                GatewayPairingState(
                                    request_id=request_id,
                                    role=OPERATOR_ROLE,
                                    gateway_url=self.url,
                                    device_id=identity.device_id,
                                    status="approved",
                                    updated_at_ms=_now_ms(),
                                )
                            )
                            if ws is not None:
                                await ws.close()
                            await asyncio.sleep(delay)
                            delay = min(delay * BACKOFF_MULTIPLIER, MAX_RECONNECT_DELAY)
                            continue
                        except Exception as approval_error:
                            if _is_concurrent_pairing_approval_race(approval_error):
                                self._update_pairing_state(
                                    GatewayPairingState(
                                        request_id=request_id,
                                        role=OPERATOR_ROLE,
                                        gateway_url=self.url,
                                        device_id=identity.device_id,
                                        status="approved",
                                        updated_at_ms=_now_ms(),
                                    )
                                )
                                if ws is not None:
                                    await ws.close()
                                await asyncio.sleep(delay)
                                delay = min(delay * BACKOFF_MULTIPLIER, MAX_RECONNECT_DELAY)
                                continue
                            self._update_pairing_state(
                                GatewayPairingState(
                                    request_id=request_id,
                                    role=OPERATOR_ROLE,
                                    gateway_url=self.url,
                                    device_id=identity.device_id,
                                    status="failed",
                                    updated_at_ms=_now_ms(),
                                    error=str(approval_error),
                                )
                            )
                            raise GatewayError("UNAVAILABLE", str(approval_error)) from approval_error

                if detail_code == CONNECT_ERROR_DEVICE_TOKEN_MISMATCH:
                    if ws is not None:
                        await ws.close()
                        await asyncio.sleep(delay)
                        delay = min(delay * BACKOFF_MULTIPLIER, MAX_RECONNECT_DELAY)
                        continue

                raise exc
            except Exception as exc:
                if ws is not None:
                    try:
                        await ws.close()
                    except Exception:
                        pass
                if (
                    not self._closed
                    and _is_retryable_connect_error(exc)
                    and asyncio.get_running_loop().time() < deadline
                ):
                    await asyncio.sleep(delay)
                    delay = min(delay * BACKOFF_MULTIPLIER, MAX_RECONNECT_DELAY)
                    continue
                raise
        raise GatewayError("UNAVAILABLE", "gateway client stopped")

    async def close(self) -> None:
        self._closed = True
        self._connected = False
        self._set_connection_state("disconnected")
        reader = self._reader_task
        self._reader_task = None
        if reader:
            reader.cancel()
            try:
                await reader
            except asyncio.CancelledError:
                pass
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def __aenter__(self) -> GatewayClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def call(self, method: str, params: dict | None = None, timeout: float | None = None) -> Any:
        if not self._connected or self._ws is None:
            raise GatewayError("NOT_CONNECTED", "Not connected to gateway")

        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await self._ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": request_id,
                    "method": method,
                    **({"params": params} if params else {}),
                }
            )
        )
        try:
            return await asyncio.wait_for(future, timeout=timeout or self.timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(request_id, None)
            raise GatewayError("TIMEOUT", f"RPC {method} timed out after {timeout or self.timeout}s") from exc

    async def config_get(self) -> dict:
        result = await self.call("config.get")
        return result.get("config", result)

    async def config_schema(self) -> dict:
        return await self.call("config.schema")

    async def config_patch(self, patch: dict, base_hash: str | None = None) -> dict:
        if base_hash is None:
            raw_result = await self.call("config.get")
            base_hash = raw_result.get("hash") or raw_result.get("baseHash", "")
        return await self.call(
            "config.patch",
            {"raw": json.dumps(patch), "baseHash": base_hash},
            timeout=30,
        )

    async def config_apply(self, config: dict) -> dict:
        raw_result = await self.call("config.get")
        base_hash = raw_result.get("hash") or raw_result.get("baseHash", "")
        return await self.call(
            "config.apply",
            {"raw": json.dumps(config), "baseHash": base_hash},
            timeout=30,
        )

    async def config_set(self, config: dict, base_hash: str | None = None) -> dict:
        if base_hash is None:
            raw_result = await self.call("config.get")
            base_hash = raw_result.get("hash") or raw_result.get("baseHash", "")
        return await self.call(
            "config.set",
            {"raw": json.dumps(config), "baseHash": base_hash},
            timeout=30,
        )

    async def status(self) -> dict:
        return await self.call("status")

    async def wait_ready(
        self,
        timeout: float = 300.0,
        retry_interval: float = 5.0,
        probe: Literal["config", "status"] = "config",
    ) -> dict:
        deadline = asyncio.get_running_loop().time() + timeout
        last_error: Exception | None = None

        while not self._closed:
            try:
                if not self._connected:
                    await self.connect()
                if probe == "status":
                    return await self.status()
                return await self.config_get()
            except Exception as exc:
                last_error = exc
                await self.close()
                if asyncio.get_running_loop().time() >= deadline:
                    break
                await asyncio.sleep(retry_interval)

        detail = f": {last_error}" if last_error else ""
        raise GatewayError("TIMEOUT", f"Gateway readiness probe timed out after {timeout}s{detail}")

    async def models_list(self) -> list[dict]:
        result = await self.call("models.list")
        return result.get("models", [])

    async def channels_status(self, probe: bool = False, timeout_ms: int | None = None) -> dict:
        params: dict[str, Any] = {"probe": probe}
        if timeout_ms is not None:
            params["timeoutMs"] = timeout_ms
        return await self.call("channels.status", params)

    async def channels_logout(self, channel: str, account_id: str | None = None) -> dict:
        params: dict[str, Any] = {"channel": channel}
        if account_id:
            params["accountId"] = account_id
        return await self.call("channels.logout", params)

    async def web_login_start(
        self,
        *,
        force: bool = False,
        timeout_ms: int | None = None,
        verbose: bool = False,
        account_id: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {}
        if force:
            params["force"] = True
        if timeout_ms is not None:
            params["timeoutMs"] = timeout_ms
        if verbose:
            params["verbose"] = True
        if account_id:
            params["accountId"] = account_id
        return await self.call("web.login.start", params, timeout=30)

    async def web_login_wait(
        self,
        *,
        timeout_ms: int | None = None,
        account_id: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {}
        if timeout_ms is not None:
            params["timeoutMs"] = timeout_ms
        if account_id:
            params["accountId"] = account_id
        return await self.call("web.login.wait", params, timeout=self.chat_timeout)

    async def agents_list(self) -> list[dict]:
        result = await self.call("agents.list")
        return result.get("agents", [])

    async def agent_get(self, agent_id: str) -> dict:
        return await self.call("agents.get", {"agentId": agent_id})

    async def files_list(self, agent_id: str) -> list[dict]:
        result = await self.call("agents.files.list", {"agentId": agent_id})
        return result.get("files", [])

    async def file_get(self, agent_id: str, name: str) -> str:
        result = await self.call("agents.files.get", {"agentId": agent_id, "name": name})
        return result.get("content", "")

    async def file_set(self, agent_id: str, name: str, content: str) -> dict:
        return await self.call(
            "agents.files.set",
            {"agentId": agent_id, "name": name, "content": content},
        )

    async def sessions_list(self, limit: int = 20) -> list[dict]:
        result = await self.call("sessions.list", {"limit": limit})
        return result.get("sessions", [])

    async def sessions_preview(self, session_key: str, limit: int = 20) -> list[dict]:
        result = await self.call("sessions.preview", {"keys": [session_key], "limit": limit})
        previews = result.get("previews", [])
        if not previews:
            return []
        return previews[0].get("items", [])

    async def sessions_patch(self, key: str, **patch: Any) -> dict:
        params: dict[str, Any] = {"key": key, **patch}
        return await self.call("sessions.patch", params)

    async def chat_history(self, session_key: str | None = None, limit: int = 50) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if session_key:
            params["sessionKey"] = session_key
        result = await self.call("chat.history", params)
        return result.get("messages", [])

    async def chat_send(
        self,
        message: str,
        session_key: str | None = "main",
        agent_id: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[ChatEvent]:
        idempotency_key = str(uuid.uuid4())
        resolved_session_key = session_key or "main"
        params: dict[str, Any] = {
            "message": message,
            "deliver": False,
            "idempotencyKey": idempotency_key,
            "sessionKey": resolved_session_key,
        }
        if agent_id:
            params["agentId"] = agent_id
        if attachments:
            params["attachments"] = attachments

        result = await self.call("chat.send", params, timeout=30)
        accepted_run_ids = {idempotency_key}
        server_run_id = str((result or {}).get("runId") or "").strip()
        if server_run_id:
            accepted_run_ids.add(server_run_id)

        deadline = asyncio.get_running_loop().time() + self.chat_timeout
        last_legacy_text = ""
        last_thinking_text = ""
        streamed_display_text = False
        seen_tool_call_ids: set[str] = set()
        seen_tool_result_ids: set[str] = set()
        while asyncio.get_running_loop().time() < deadline:
            remaining = max(0.1, min(1.0, deadline - asyncio.get_running_loop().time()))
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                if self._reader_task is not None and self._reader_task.done() and not self._connected:
                    raise GatewayError("UNAVAILABLE", "gateway connection closed while waiting for chat events")
                continue

            event_name = event.get("event")
            payload = event.get("payload") or {}
            if isinstance(payload, dict):
                payload_run_id = str(payload.get("runId") or "").strip()
                payload_session_key = str(payload.get("sessionKey") or "").strip()
                if payload_run_id and payload_run_id not in accepted_run_ids:
                    continue
                if payload_session_key and not _same_session_key(payload_session_key, resolved_session_key):
                    continue

            if event_name == "chat.content":
                text = str(payload.get("text") or "")
                if text:
                    deadline = asyncio.get_running_loop().time() + self.chat_timeout
                    streamed_display_text = True
                    yield ChatEvent(type="content", text=text)
                continue
            if event_name == "agent" and str(payload.get("stream") or "").lower() == "tool":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                tool_payload = payload.get("data") or {}
                if not isinstance(tool_payload, dict):
                    continue
                phase = str(tool_payload.get("phase") or "").lower()
                if phase == "start":
                    tool_call_id = str(tool_payload.get("toolCallId") or "").strip()
                    if not tool_call_id:
                        tool_call_id = f"{tool_payload.get('name', 'tool')}:{json.dumps(tool_payload.get('args'), sort_keys=True, default=str)}"
                    seen_tool_call_ids.add(tool_call_id)
                    yield ChatEvent(
                        type="tool_call",
                        data={
                            **({"toolCallId": tool_payload.get("toolCallId")} if tool_payload.get("toolCallId") else {}),
                            "name": tool_payload.get("name"),
                            "args": tool_payload.get("args"),
                        },
                    )
                elif phase == "result":
                    tool_result_id = str(tool_payload.get("toolCallId") or "").strip()
                    if not tool_result_id:
                        tool_result_id = f"{tool_payload.get('name', 'tool')}:{json.dumps(tool_payload.get('args'), sort_keys=True, default=str)}"
                    seen_tool_result_ids.add(tool_result_id)
                    yield ChatEvent(
                        type="tool_result",
                        data={
                            **({"toolCallId": tool_payload.get("toolCallId")} if tool_payload.get("toolCallId") else {}),
                            "name": tool_payload.get("name"),
                            "result": tool_payload.get("result"),
                            "isError": tool_payload.get("isError"),
                        },
                    )
                continue
            if event_name == "chat.thinking":
                text = str(payload.get("text") or "")
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                if text:
                    last_thinking_text += text
                yield ChatEvent(type="thinking", text=text)
                continue
            if event_name == "chat.tool_call":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                tool_call_id = str(payload.get("toolCallId") or "").strip()
                if not tool_call_id:
                    tool_call_id = f"{payload.get('name', 'tool')}:{json.dumps(payload.get('args', payload.get('arguments')), sort_keys=True, default=str)}"
                seen_tool_call_ids.add(tool_call_id)
                yield ChatEvent(type="tool_call", data=payload)
                continue
            if event_name == "chat.tool_result":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                tool_result_id = str(payload.get("toolCallId") or "").strip()
                if not tool_result_id:
                    tool_result_id = f"{payload.get('name', 'tool')}:{json.dumps(payload.get('args', payload.get('arguments')), sort_keys=True, default=str)}"
                seen_tool_result_ids.add(tool_result_id)
                yield ChatEvent(type="tool_result", data=payload)
                continue
            if event_name == "chat.done":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                yield ChatEvent(type="done", data=payload)
                return
            if event_name == "chat.error":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                yield ChatEvent(type="error", text=str(payload.get("message") or "Unknown error"), data=payload)
                return

            if event_name != "chat":
                continue

            state = str(payload.get("state") or "").lower()
            current_text = _extract_message_text(payload.get("message"))
            normalized_message = normalize_gateway_chat_message(payload.get("message"))
            if state == "delta":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                delta_text, last_legacy_text = _stream_delta(last_legacy_text, current_text)
                if delta_text:
                    streamed_display_text = True
                    yield ChatEvent(type="content", text=delta_text, data=payload)
                continue
            if state == "final":
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                if normalized_message and normalized_message.thinking:
                    thinking_delta, last_thinking_text = _stream_delta(
                        last_thinking_text,
                        normalized_message.thinking,
                    )
                    if thinking_delta:
                        yield ChatEvent(type="thinking", text=thinking_delta, data=payload)

                if normalized_message:
                    for tool_call in normalized_message.tool_calls:
                        tool_call_key = tool_call.id or (
                            f"{tool_call.name}:{json.dumps(tool_call.args, sort_keys=True, default=str)}"
                        )
                        if tool_call.args is not None and tool_call_key not in seen_tool_call_ids:
                            seen_tool_call_ids.add(tool_call_key)
                            yield ChatEvent(
                                type="tool_call",
                                data={
                                    **({"toolCallId": tool_call.id} if tool_call.id else {}),
                                    "name": tool_call.name,
                                    "args": tool_call.args,
                                },
                            )
                        if tool_call.result is not None and tool_call_key not in seen_tool_result_ids:
                            seen_tool_result_ids.add(tool_call_key)
                            yield ChatEvent(
                                type="tool_result",
                                data={
                                    **({"toolCallId": tool_call.id} if tool_call.id else {}),
                                    "name": tool_call.name,
                                    "result": tool_call.result,
                                },
                            )
                if current_text:
                    delta_text, last_legacy_text = _stream_delta(last_legacy_text, current_text)
                    if delta_text:
                        streamed_display_text = True
                        yield ChatEvent(type="content", text=delta_text, data=payload)
                    yield ChatEvent(type="done", data=payload)
                    return
                if streamed_display_text or last_legacy_text:
                    yield ChatEvent(type="done", data=payload)
                    return
                if normalized_message and (normalized_message.thinking or normalized_message.tool_calls):
                    yield ChatEvent(type="done", data=payload)
                    return
                history_text = _latest_history_assistant_text(
                    await self.chat_history(resolved_session_key, limit=20),
                    accepted_run_ids,
                )
                if history_text:
                    yield ChatEvent(type="content", text=history_text, data=payload)
                yield ChatEvent(type="done", data=payload)
                return
            if state in {"error", "aborted"}:
                deadline = asyncio.get_running_loop().time() + self.chat_timeout
                if current_text:
                    delta_text, last_legacy_text = _stream_delta(last_legacy_text, current_text)
                    if delta_text:
                        streamed_display_text = True
                        yield ChatEvent(type="content", text=delta_text, data=payload)
                yield ChatEvent(type="error", text=str(payload.get("errorMessage") or state), data=payload)
                return

        raise GatewayError("TIMEOUT", "Streaming chat.send timed out")

    async def chat_abort(self, session_key: str | None = None) -> dict:
        params: dict[str, Any] = {}
        if session_key:
            params["sessionKey"] = session_key
        return await self.call("chat.abort", params)

    async def sessions_reset(
        self,
        session_key: str,
        reason: Literal["new", "reset"] | None = None,
    ) -> dict:
        params: dict[str, Any] = {"key": session_key}
        if reason is not None:
            params["reason"] = reason
        return await self.call("sessions.reset", params)

    async def cron_list(self) -> list[dict]:
        result = await self.call("cron.list")
        return result.get("jobs", [])

    async def cron_add(self, job: dict) -> dict:
        return await self.call("cron.add", {"job": job})

    async def cron_remove(self, job_id: str) -> dict:
        return await self.call("cron.remove", {"jobId": job_id})

    async def cron_run(self, job_id: str) -> dict:
        return await self.call("cron.run", {"jobId": job_id})

    async def exec_approve(self, exec_id: str) -> dict:
        return await self.call("exec.approve", {"execId": exec_id})

    async def exec_deny(self, exec_id: str) -> dict:
        return await self.call("exec.deny", {"execId": exec_id})

    async def next_event(self, timeout: float | None = None) -> Optional[dict]:
        try:
            return await asyncio.wait_for(self._event_queue.get(), timeout=timeout or self.timeout)
        except asyncio.TimeoutError:
            return None

    async def events(self, timeout: float = 60.0) -> AsyncIterator[dict]:
        while self._connected:
            event = await self.next_event(timeout=timeout)
            if event is None:
                break
            yield event
