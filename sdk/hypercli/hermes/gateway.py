"""Client for Hermes Agent's stable API Server HTTP and SSE surface."""
from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypedDict, cast
from urllib.parse import quote

import httpx

from ..http import APIError


class HermesHealth(TypedDict, total=False):
    status: str


class HermesDetailedHealth(TypedDict, total=False):
    status: str
    readiness: dict[str, Any]


class HermesCapabilities(TypedDict, total=False):
    object: str
    platform: str
    model: str
    auth: dict[str, Any]
    features: dict[str, bool]
    endpoints: dict[str, Any]


class HermesModel(TypedDict, total=False):
    id: str
    object: str
    created: int
    owned_by: str


class HermesModels(TypedDict, total=False):
    object: str
    data: list[HermesModel]


class HermesSession(TypedDict, total=False):
    id: str
    source: str
    user_id: str | None
    model: str | None
    title: str | None
    started_at: float
    ended_at: float | None
    end_reason: str | None
    message_count: int
    parent_session_id: str | None
    last_active: float
    preview: str | None
    has_system_prompt: bool
    has_model_config: bool


class HermesSessionEnvelope(TypedDict, total=False):
    object: str
    session: HermesSession


class HermesSessionList(TypedDict, total=False):
    object: str
    data: list[HermesSession]
    limit: int
    offset: int
    has_more: bool


class HermesMessage(TypedDict, total=False):
    id: str
    session_id: str
    role: str
    content: Any
    tool_call_id: str | None
    tool_calls: list[dict[str, Any]]
    tool_name: str | None
    timestamp: float
    token_count: int
    finish_reason: str | None
    reasoning: Any
    reasoning_content: Any


class HermesMessageList(TypedDict, total=False):
    object: str
    session_id: str
    data: list[HermesMessage]


class HermesRun(TypedDict, total=False):
    run_id: str
    id: str
    status: str
    session_id: str | None
    output: Any
    error: Any


class HermesSessionModelLock(TypedDict, total=False):
    object: str
    session_id: str
    runtime: dict[str, Any]


@dataclass(frozen=True)
class HermesSSEEvent:
    """One SSE frame; unknown event names and fields are retained verbatim."""

    event: str
    data: Any
    id: str | None = None
    retry: int | None = None
    fields: tuple[tuple[str, str], ...] = ()


class HermesAPIError(APIError):
    """Normalized OpenAI-style error returned by the Hermes API server."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        error_type: str | None = None,
        code: str | None = None,
        param: str | None = None,
        method: str | None = None,
        url: str | None = None,
        response_text: str | None = None,
    ) -> None:
        super().__init__(status_code, detail, method, url, response_text)
        self.error_type = error_type
        self.code = code
        self.param = param


def _parse_sse(lines: Iterator[str]) -> Iterator[HermesSSEEvent]:
    fields: list[tuple[str, str]] = []

    def emit() -> HermesSSEEvent | None:
        if not fields:
            return None
        data_lines = [value for name, value in fields if name == "data"]
        raw_data = "\n".join(data_lines)
        if raw_data == "[DONE]":
            data: Any = raw_data
        else:
            try:
                data = json.loads(raw_data)
            except (TypeError, ValueError):
                data = raw_data
        event = next((value for name, value in fields if name == "event"), "message")
        event_id = next((value for name, value in fields if name == "id"), None)
        retry_raw = next((value for name, value in fields if name == "retry"), None)
        try:
            retry = int(retry_raw) if retry_raw is not None else None
        except ValueError:
            retry = None
        return HermesSSEEvent(event=event, data=data, id=event_id, retry=retry, fields=tuple(fields))

    for line in lines:
        if line == "":
            item = emit()
            if item is not None:
                yield item
            fields = []
            continue
        if line.startswith(":"):
            continue
        name, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        fields.append((name, value))
    item = emit()
    if item is not None:
        yield item


class HermesApiClient:
    """Synchronous client for the stable Hermes API Server contract.

    OpenAI Chat Completions/Responses schemas are intentionally not copied here;
    use :attr:`HermesAgent.openai_base_url` and :attr:`api_key` with an OpenAI
    client for those endpoints.
    """

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 30.0) -> None:
        if not str(base_url or "").strip():
            raise ValueError("base_url is required")
        if not str(api_key or "").strip():
            raise ValueError("api_key is required")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    @property
    def openai_base_url(self) -> str:
        return f"{self.base_url}/v1"

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    @staticmethod
    def _raise_for_error(response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        payload: Any = None
        try:
            payload = response.json()
        except Exception:
            pass
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            detail = str(error.get("message") or response.text or "Hermes API request failed")
            error_type = str(error["type"]) if error.get("type") is not None else None
            code = str(error["code"]) if error.get("code") is not None else None
            param = str(error["param"]) if error.get("param") is not None else None
        else:
            detail_value = payload.get("detail") if isinstance(payload, dict) else None
            detail = str(detail_value or response.text or "Hermes API request failed")
            error_type = code = param = None
        raise HermesAPIError(
            response.status_code,
            detail,
            error_type=error_type,
            code=code,
            param=param,
            method=response.request.method if response.request else None,
            url=str(response.request.url) if response.request else None,
            response_text=response.text,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json_body: Mapping[str, Any] | None = None,
    ) -> Any:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers,
                params=params,
                json=dict(json_body) if json_body is not None else None,
            )
        self._raise_for_error(response)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    def _stream(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
    ) -> Iterator[HermesSSEEvent]:
        with httpx.Client(timeout=self.timeout) as client, client.stream(
            method,
            f"{self.base_url}{path}",
            headers={**self._headers, "Accept": "text/event-stream"},
            json=dict(json_body) if json_body is not None else None,
        ) as response:
            if response.status_code >= 400:
                response.read()
            self._raise_for_error(response)
            yield from _parse_sse(response.iter_lines())

    def health(self) -> HermesHealth:
        return cast(HermesHealth, self._request("GET", "/health"))

    def detailed_health(self) -> HermesDetailedHealth:
        return cast(HermesDetailedHealth, self._request("GET", "/health/detailed"))

    def capabilities(self) -> HermesCapabilities:
        return cast(HermesCapabilities, self._request("GET", "/v1/capabilities"))

    def models(self) -> HermesModels:
        return cast(HermesModels, self._request("GET", "/v1/models"))

    def list_sessions(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        source: str | None = None,
        include_children: bool = False,
    ) -> HermesSessionList:
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "include_children": str(include_children).lower(),
        }
        if source is not None:
            params["source"] = source
        return cast(HermesSessionList, self._request("GET", "/api/sessions", params=params))

    def create_session(self, **fields: Any) -> HermesSessionEnvelope:
        return cast(HermesSessionEnvelope, self._request("POST", "/api/sessions", json_body=fields))

    def get_session(self, session_id: str) -> HermesSessionEnvelope:
        return cast(HermesSessionEnvelope, self._request("GET", self._session_path(session_id)))

    def update_session(self, session_id: str, **fields: Any) -> HermesSessionEnvelope:
        return cast(
            HermesSessionEnvelope,
            self._request("PATCH", self._session_path(session_id), json_body=fields),
        )

    def delete_session(self, session_id: str) -> dict[str, Any]:
        return cast(dict[str, Any], self._request("DELETE", self._session_path(session_id)))

    def session_messages(self, session_id: str) -> HermesMessageList:
        return cast(HermesMessageList, self._request("GET", f"{self._session_path(session_id)}/messages"))

    def fork_session(self, session_id: str, **fields: Any) -> HermesSessionEnvelope:
        return cast(
            HermesSessionEnvelope,
            self._request("POST", f"{self._session_path(session_id)}/fork", json_body=fields),
        )

    def chat(self, session_id: str, message: Any, **fields: Any) -> dict[str, Any]:
        body = {"message": message, **fields}
        return cast(dict[str, Any], self._request("POST", f"{self._session_path(session_id)}/chat", json_body=body))

    def chat_stream(self, session_id: str, message: Any, **fields: Any) -> Iterator[HermesSSEEvent]:
        body = {"message": message, **fields}
        return self._stream("POST", f"{self._session_path(session_id)}/chat/stream", json_body=body)

    def model_lock(self, session_id: str, *, model: str, provider: str | None = None, **fields: Any) -> HermesSessionModelLock:
        body: dict[str, Any] = {"model": model, **fields}
        if provider is not None:
            body["provider"] = provider
        return cast(
            HermesSessionModelLock,
            self._request("POST", f"{self._session_path(session_id)}/model", json_body=body),
        )

    def create_run(self, input: Any, **fields: Any) -> HermesRun:
        return cast(HermesRun, self._request("POST", "/v1/runs", json_body={"input": input, **fields}))

    def get_run(self, run_id: str) -> HermesRun:
        return cast(HermesRun, self._request("GET", self._run_path(run_id)))

    def run_events(self, run_id: str) -> Iterator[HermesSSEEvent]:
        return self._stream("GET", f"{self._run_path(run_id)}/events")

    def approve_run(
        self,
        run_id: str,
        choice: Literal["once", "session", "always", "deny"] = "once",
        *,
        resolve_all: bool = False,
    ) -> dict[str, Any]:
        return cast(
            dict[str, Any],
            self._request(
                "POST",
                f"{self._run_path(run_id)}/approval",
                json_body={"choice": choice, "resolve_all": resolve_all},
            ),
        )

    def stop_run(self, run_id: str) -> HermesRun:
        return cast(HermesRun, self._request("POST", f"{self._run_path(run_id)}/stop", json_body={}))

    @staticmethod
    def _session_path(session_id: str) -> str:
        return f"/api/sessions/{quote(str(session_id), safe='')}"

    @staticmethod
    def _run_path(run_id: str) -> str:
        return f"/v1/runs/{quote(str(run_id), safe='')}"


__all__ = [
    "HermesAPIError",
    "HermesApiClient",
    "HermesCapabilities",
    "HermesDetailedHealth",
    "HermesHealth",
    "HermesMessage",
    "HermesMessageList",
    "HermesModel",
    "HermesModels",
    "HermesRun",
    "HermesSSEEvent",
    "HermesSession",
    "HermesSessionEnvelope",
    "HermesSessionList",
    "HermesSessionModelLock",
]
