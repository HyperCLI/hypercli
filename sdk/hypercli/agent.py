"""
HyperAgent API client

Provides access to the HyperClaw inference API for AI agents.
Uses the official OpenAI Python client for chat completions.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from .http import HTTPClient

try:
    from openai import OpenAI

    OPENAI_AVAILABLE = True
except ImportError:
    OpenAI = None
    OPENAI_AVAILABLE = False


@dataclass
class HyperAgentKey:
    """HyperAgent API key with subscription details."""

    key: str
    plan_id: str
    expires_at: datetime
    tpm_limit: int
    rpm_limit: int
    user_id: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentKey":
        expires = data.get("expires_at", "")
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
        return cls(
            key=data["key"],
            plan_id=data["plan_id"],
            expires_at=expires,
            tpm_limit=data.get("tpm_limit", 0),
            rpm_limit=data.get("rpm_limit", 0),
            user_id=data.get("user_id"),
        )


@dataclass
class HyperAgentPlan:
    """HyperAgent subscription plan."""

    id: str
    name: str
    price_usd: float
    tpm_limit: int
    rpm_limit: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentPlan":
        price = data.get("price_usd", data.get("price", 0))
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            price_usd=float(price or 0),
            tpm_limit=int(data.get("tpm_limit", 0)),
            rpm_limit=int(data.get("rpm_limit", 0)),
        )


@dataclass
class HyperAgentModel:
    """Available model on HyperAgent."""

    id: str
    name: str
    context_length: int
    supports_vision: bool = False
    supports_function_calling: bool = False
    supports_tool_choice: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentModel":
        caps = data.get("capabilities", {})
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            context_length=data.get("context_length", 0),
            supports_vision=caps.get("supports_vision", False),
            supports_function_calling=caps.get("supports_function_calling", False),
            supports_tool_choice=caps.get("supports_tool_choice", False),
        )


class HyperAgent:
    """
    HyperAgent API client.

    Provides access to HyperClaw inference endpoints using the OpenAI Python
    client.

    Usage:
        from hypercli import HyperCLI

        client = HyperCLI(agent_api_key="sk-...")

        openai = client.agent.openai
        response = openai.chat.completions.create(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello!"}],
        )

        response = client.agent.chat(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello!"}],
        )
    """

    AGENT_API_BASE = "https://api.hyperclaw.app/v1"
    DEV_API_BASE = "https://dev-api.hyperclaw.app/v1"

    def __init__(self, http: HTTPClient, agent_api_key: str = None, dev: bool = False):
        self._http = http
        self._api_key = agent_api_key or http.api_key
        self._dev = dev
        self._base_url = self.DEV_API_BASE if dev else self.AGENT_API_BASE
        self._openai = None

    @property
    def openai(self) -> "OpenAI":
        if not OPENAI_AVAILABLE:
            raise ImportError(
                "OpenAI package required for chat. Install with: pip install openai"
            )

        if self._openai is None:
            self._openai = OpenAI(
                api_key=self._api_key,
                base_url=self._base_url,
            )
        return self._openai

    def chat(
        self,
        model: str,
        messages: List[Dict],
        temperature: float = None,
        max_tokens: int = None,
        tools: List[Dict] = None,
        tool_choice: Union[str, Dict] = None,
        stream: bool = False,
        **kwargs,
    ):
        params = {
            "model": model,
            "messages": messages,
            **kwargs,
        }

        if temperature is not None:
            params["temperature"] = temperature
        if max_tokens is not None:
            params["max_tokens"] = max_tokens
        if tools:
            params["tools"] = tools
        if tool_choice:
            params["tool_choice"] = tool_choice
        if stream:
            params["stream"] = stream

        return self.openai.chat.completions.create(**params)

    def models(self) -> List[HyperAgentModel]:
        response = self.openai.models.list()
        return [
            HyperAgentModel.from_dict(
                {
                    "id": model.id,
                    "name": getattr(model, "name", model.id),
                    "context_length": getattr(model, "context_length", 0),
                    "capabilities": getattr(model, "capabilities", {}),
                }
            )
            for model in response.data
        ]

    def _api_base_without_v1(self) -> str:
        return self._base_url.replace("/v1", "")

    def key_status(self) -> HyperAgentKey:
        response = self._http._session.get(
            f"{self._api_base_without_v1()}/api/keys/status",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        return HyperAgentKey.from_dict(response.json())

    def plans(self) -> List[HyperAgentPlan]:
        response = self._http._session.get(
            f"{self._api_base_without_v1()}/api/plans",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        data = response.json()
        return [HyperAgentPlan.from_dict(plan) for plan in data.get("plans", [])]

    def discovery_health(self) -> Dict[str, Any]:
        response = self._http._session.get(f"{self._api_base_without_v1()}/discovery/health")
        response.raise_for_status()
        return response.json()

    def discovery_config(self, api_key: str = None) -> Dict[str, Any]:
        headers = {}
        if api_key:
            headers["X-API-KEY"] = api_key

        response = self._http._session.get(
            f"{self._api_base_without_v1()}/discovery/config",
            headers=headers,
        )
        response.raise_for_status()
        return response.json()
