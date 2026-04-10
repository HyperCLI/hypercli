"""
HyperAgent API client

Provides access to the HyperClaw inference API for AI agents.
Uses the official OpenAI Python client for chat completions.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlsplit

from .config import get_agents_api_base_url
from .http import HTTPClient

try:
    from openai import OpenAI

    OPENAI_AVAILABLE = True
except ImportError:
    OpenAI = None
    OPENAI_AVAILABLE = False


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
class HyperAgentCurrentPlan:
    """Effective current plan snapshot for an authenticated HyperClaw user."""

    id: str
    name: str
    price: float | str
    aiu: int | None = None
    agents: int | None = None
    tpm_limit: int = 0
    rpm_limit: int = 0
    expires_at: datetime | None = None
    cancel_at_period_end: bool = False
    provider: str | None = None
    seconds_remaining: int | None = None
    pooled_tpd: int = 0
    slot_inventory: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentCurrentPlan":
        expires_at = data.get("expires_at")
        if expires_at:
            expires_at = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            price=data.get("price", 0),
            aiu=data.get("aiu"),
            agents=data.get("agents"),
            tpm_limit=int(data.get("tpm_limit", 0) or 0),
            rpm_limit=int(data.get("rpm_limit", 0) or 0),
            expires_at=expires_at,
            cancel_at_period_end=bool(data.get("cancel_at_period_end", False)),
            provider=data.get("provider"),
            seconds_remaining=data.get("seconds_remaining"),
            pooled_tpd=int(data.get("pooled_tpd", 0) or 0),
            slot_inventory=data.get("slot_inventory") or None,
        )


@dataclass
class HyperAgentSubscription:
    """A purchased HyperClaw entitlement/subscription instance."""

    id: str
    user_id: str
    plan_id: str
    plan_name: str
    provider: str
    status: str
    quantity: int = 1
    expires_at: datetime | None = None
    updated_at: datetime | None = None
    stripe_subscription_id: str | None = None
    cancel_at_period_end: bool = False
    can_cancel: bool = False
    is_current: bool = False
    meta: dict[str, Any] | None = None
    plan_tpm_limit: int = 0
    plan_rpm_limit: int = 0
    plan_tpd: int = 0
    plan_agent_tier: str | None = None
    slot_grants: dict[str, int] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentSubscription":
        expires_at = data.get("expires_at")
        updated_at = data.get("updated_at")
        return cls(
            id=data["id"],
            user_id=data.get("user_id", ""),
            plan_id=data.get("plan_id", ""),
            plan_name=data.get("plan_name", data.get("plan_id", "")),
            provider=data.get("provider", ""),
            status=data.get("status", ""),
            quantity=int(data.get("quantity", 1) or 1),
            expires_at=datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) if expires_at else None,
            updated_at=datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")) if updated_at else None,
            stripe_subscription_id=data.get("stripe_subscription_id"),
            cancel_at_period_end=bool(data.get("cancel_at_period_end", False)),
            can_cancel=bool(data.get("can_cancel", False)),
            is_current=bool(data.get("is_current", False)),
            meta=data.get("meta") or None,
            plan_tpm_limit=int(data.get("plan_tpm_limit", 0) or 0),
            plan_rpm_limit=int(data.get("plan_rpm_limit", 0) or 0),
            plan_tpd=int(data.get("plan_tpd", 0) or 0),
            plan_agent_tier=data.get("plan_agent_tier"),
            slot_grants=data.get("slot_grants") or None,
        )


@dataclass
class HyperAgentEntitlements:
    """Effective account entitlements computed by the backend."""

    effective_plan_id: str
    pooled_tpm_limit: int
    pooled_rpm_limit: int
    pooled_tpd: int
    slot_inventory: dict[str, Any]
    active_entitlement_count: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentEntitlements":
        payload = data.get("entitlements") if isinstance(data.get("entitlements"), dict) else data
        return cls(
            effective_plan_id=payload.get("effective_plan_id", data.get("effective_plan_id", "")),
            pooled_tpm_limit=int(payload.get("pooled_tpm_limit", data.get("pooled_tpm_limit", 0)) or 0),
            pooled_rpm_limit=int(payload.get("pooled_rpm_limit", data.get("pooled_rpm_limit", 0)) or 0),
            pooled_tpd=int(payload.get("pooled_tpd", data.get("pooled_tpd", 0)) or 0),
            slot_inventory=payload.get("slot_inventory") or data.get("slot_inventory") or {},
            active_entitlement_count=int(
                payload.get(
                    "active_entitlement_count",
                    data.get("active_entitlement_count", data.get("active_subscription_count", 0)),
                )
                or 0
            ),
        )


@dataclass
class HyperAgentSubscriptionSummary:
    """Effective entitlement summary for an authenticated HyperClaw user."""

    effective_plan_id: str
    current_subscription_id: str | None
    current_entitlement_id: str | None
    pooled_tpm_limit: int
    pooled_rpm_limit: int
    pooled_tpd: int
    slot_inventory: dict[str, Any]
    active_subscription_count: int
    active_entitlement_count: int
    entitlements: HyperAgentEntitlements
    active_subscriptions: list[HyperAgentSubscription]
    subscriptions: list[HyperAgentSubscription]
    user: dict[str, Any]

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentSubscriptionSummary":
        return cls(
            effective_plan_id=data.get("effective_plan_id", ""),
            current_subscription_id=data.get("current_subscription_id"),
            current_entitlement_id=data.get("current_entitlement_id", data.get("current_subscription_id")),
            pooled_tpm_limit=int(data.get("pooled_tpm_limit", 0) or 0),
            pooled_rpm_limit=int(data.get("pooled_rpm_limit", 0) or 0),
            pooled_tpd=int(data.get("pooled_tpd", 0) or 0),
            slot_inventory=data.get("slot_inventory") or {},
            active_subscription_count=int(data.get("active_subscription_count", 0) or 0),
            active_entitlement_count=int(data.get("active_entitlement_count", data.get("active_subscription_count", 0)) or 0),
            entitlements=HyperAgentEntitlements.from_dict(data),
            active_subscriptions=[HyperAgentSubscription.from_dict(item) for item in data.get("active_subscriptions", [])],
            subscriptions=[HyperAgentSubscription.from_dict(item) for item in data.get("subscriptions", [])],
            user=data.get("user") or {},
        )


HyperAgentEntitlementsSummary = HyperAgentSubscriptionSummary


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

    AGENT_API_BASE = "https://api.hypercli.com/v1"
    DEV_API_BASE = "https://api.dev.hypercli.com/v1"

    def __init__(
        self,
        http: HTTPClient,
        agent_api_key: str = None,
        dev: bool = False,
        agents_api_base_url: str | None = None,
    ):
        self._http = http
        self._api_key = agent_api_key or http.api_key
        self._dev = dev
        self._base_url = self._resolve_base_url(agents_api_base_url, dev)
        self._control_base_url = self._resolve_control_base_url(getattr(http, "base_url", None), agents_api_base_url, dev)
        self._openai = None

    @classmethod
    def _resolve_base_url(cls, agents_api_base_url: str | None, dev: bool) -> str:
        raw = (agents_api_base_url or "").rstrip("/")
        if not raw:
            fallback = get_agents_api_base_url(dev).rstrip("/")
            return cls._resolve_base_url(fallback, dev)
        parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
        host = parsed.netloc.lower()
        if host in {"api.hypercli.com", "api.hyperclaw.app", "api.agents.hypercli.com"}:
            return "https://api.agents.hypercli.com/v1"
        if host in {"api.dev.hypercli.com", "api.dev.hyperclaw.app", "dev-api.hyperclaw.app", "api.agents.dev.hypercli.com"}:
            return "https://api.agents.dev.hypercli.com/v1"
        if raw.endswith("/api"):
            return f"{raw[:-4]}/v1"
        if raw.endswith("/agents"):
            return f"{raw[:-7]}/v1"
        if raw:
            return f"{raw}/v1"
        return cls.DEV_API_BASE if dev else cls.AGENT_API_BASE

    @classmethod
    def _resolve_control_base_url(
        cls,
        product_api_base_url: str | None,
        agents_api_base_url: str | None,
        dev: bool,
    ) -> str:
        raw_agents = (agents_api_base_url or "").rstrip("/")
        if not raw_agents:
            fallback = get_agents_api_base_url(dev).rstrip("/")
            return cls._resolve_control_base_url(None, fallback, dev)
        parsed = urlsplit(raw_agents if "://" in raw_agents else f"https://{raw_agents}")
        scheme = parsed.scheme or "https"
        normalized_path = parsed.path.rstrip("/")
        host = parsed.netloc.lower()
        if normalized_path.endswith("/agents"):
            return f"{scheme}://{parsed.netloc}{normalized_path}"
        if host in {"api.hypercli.com", "api.hyperclaw.app", "api.agents.hypercli.com"}:
            return "https://api.hypercli.com/agents"
        if host in {"api.dev.hypercli.com", "api.dev.hyperclaw.app", "dev-api.hyperclaw.app", "api.agents.dev.hypercli.com"}:
            return "https://api.dev.hypercli.com/agents"
        return f"{scheme}://{parsed.netloc}/agents"

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

    def plans(self) -> List[HyperAgentPlan]:
        response = self._http._session.get(
            f"{self._control_base_url}/plans",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        data = response.json()
        return [HyperAgentPlan.from_dict(plan) for plan in data.get("plans", [])]

    def current_plan(self) -> HyperAgentCurrentPlan:
        response = self._http._session.get(
            f"{self._control_base_url}/plans/current",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        return HyperAgentCurrentPlan.from_dict(response.json())

    def subscriptions(self) -> list[HyperAgentSubscription]:
        response = self._http._session.get(
            f"{self._control_base_url}/subscriptions",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        data = response.json()
        return [HyperAgentSubscription.from_dict(item) for item in data.get("items", [])]

    def subscription_summary(self) -> HyperAgentSubscriptionSummary:
        response = self._http._session.get(
            f"{self._control_base_url}/subscriptions/summary",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        return HyperAgentSubscriptionSummary.from_dict(response.json())

    def entitlements(self) -> HyperAgentEntitlementsSummary:
        response = self._http._session.get(
            f"{self._control_base_url}/entitlements",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        return HyperAgentEntitlementsSummary.from_dict(response.json())

    def cancel_subscription(self, subscription_id: str) -> Dict[str, Any]:
        response = self._http._session.post(
            f"{self._control_base_url}/subscriptions/{subscription_id}/cancel",
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        response.raise_for_status()
        return response.json()

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
