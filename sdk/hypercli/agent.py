"""
HyperAgent API client

Provides access to the HyperClaw inference API for AI agents.
Uses the official OpenAI Python client for chat completions.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from urllib.parse import quote, urlsplit

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
    """A recurring HyperClaw billing subscription."""

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
    entitlements: list["HyperAgentEntitlement"] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentSubscription":
        expires_at = data.get("current_period_end", data.get("expires_at"))
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
            entitlements=[HyperAgentEntitlement.from_dict(item) for item in data.get("entitlements", [])] or None,
        )


@dataclass
class HyperAgentEntitlement:
    """A concrete 1:1 entitlement grant."""

    id: str
    user_id: str
    subscription_id: str | None
    plan_id: str
    plan_name: str
    provider: str
    status: str
    expires_at: datetime | None = None
    updated_at: datetime | None = None
    tpm_limit: int = 0
    rpm_limit: int = 0
    tpd_limit: int = 0
    agent_tier: str | None = None
    features: dict[str, bool] | None = None
    tags: list[str] | None = None
    meta: dict[str, Any] | None = None
    slot_grants: dict[str, int] | None = None
    active_agent_count: int = 0
    active_agent_ids: list[str] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentEntitlement":
        expires_at = data.get("expires_at")
        updated_at = data.get("updated_at")
        return cls(
            id=data["id"],
            user_id=data.get("user_id", ""),
            subscription_id=data.get("subscription_id"),
            plan_id=data.get("plan_id", ""),
            plan_name=data.get("plan_name", data.get("plan_id", "")),
            provider=data.get("provider", ""),
            status=data.get("status", ""),
            expires_at=datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) if expires_at else None,
            updated_at=datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")) if updated_at else None,
            tpm_limit=int(data.get("tpm_limit", 0) or 0),
            rpm_limit=int(data.get("rpm_limit", 0) or 0),
            tpd_limit=int(data.get("tpd_limit", 0) or 0),
            agent_tier=data.get("agent_tier"),
            features=data.get("features") or {},
            tags=data.get("tags") or [],
            meta=data.get("meta") or None,
            slot_grants=data.get("slot_grants") or None,
            active_agent_count=int(data.get("active_agent_count", 0) or 0),
            active_agent_ids=data.get("active_agent_ids") or [],
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
    billing_reset_at: datetime | None = None

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
            billing_reset_at=datetime.fromisoformat(str(payload.get("billing_reset_at")).replace("Z", "+00:00"))
            if payload.get("billing_reset_at")
            else None,
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
    billing_reset_at: datetime | None
    active_subscription_count: int
    active_entitlement_count: int
    entitlements: HyperAgentEntitlements
    entitlement_items: list[HyperAgentEntitlement]
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
            billing_reset_at=datetime.fromisoformat(str(data.get("billing_reset_at")).replace("Z", "+00:00"))
            if data.get("billing_reset_at")
            else None,
            active_subscription_count=int(data.get("active_subscription_count", 0) or 0),
            active_entitlement_count=int(data.get("active_entitlement_count", data.get("active_subscription_count", 0)) or 0),
            entitlements=HyperAgentEntitlements.from_dict(data),
            entitlement_items=[HyperAgentEntitlement.from_dict(item) for item in data.get("entitlement_items", [])],
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


@dataclass
class HyperAgentUsageSummary:
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    request_count: int
    active_keys: int
    current_tpm: int
    current_rpm: int
    period: str

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentUsageSummary":
        return cls(
            total_tokens=int(data.get("total_tokens", 0) or 0),
            prompt_tokens=int(data.get("prompt_tokens", 0) or 0),
            completion_tokens=int(data.get("completion_tokens", 0) or 0),
            request_count=int(data.get("request_count", 0) or 0),
            active_keys=int(data.get("active_keys", 0) or 0),
            current_tpm=int(data.get("current_tpm", 0) or 0),
            current_rpm=int(data.get("current_rpm", 0) or 0),
            period=str(data.get("period", "")),
        )


@dataclass
class HyperAgentUsageHistoryEntry:
    date: str
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    requests: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentUsageHistoryEntry":
        return cls(
            date=str(data.get("date", "")),
            total_tokens=int(data.get("total_tokens", 0) or 0),
            prompt_tokens=int(data.get("prompt_tokens", 0) or 0),
            completion_tokens=int(data.get("completion_tokens", 0) or 0),
            requests=int(data.get("requests", 0) or 0),
        )


@dataclass
class HyperAgentUsageHistory:
    history: list[HyperAgentUsageHistoryEntry]
    days: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentUsageHistory":
        return cls(
            history=[HyperAgentUsageHistoryEntry.from_dict(item) for item in data.get("history", [])],
            days=int(data.get("days", 0) or 0),
        )


@dataclass
class HyperAgentKeyUsageEntry:
    key_hash: str
    name: str
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    requests: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentKeyUsageEntry":
        return cls(
            key_hash=str(data.get("key_hash", "")),
            name=str(data.get("name", "")),
            total_tokens=int(data.get("total_tokens", 0) or 0),
            prompt_tokens=int(data.get("prompt_tokens", 0) or 0),
            completion_tokens=int(data.get("completion_tokens", 0) or 0),
            requests=int(data.get("requests", 0) or 0),
        )


@dataclass
class HyperAgentKeyUsage:
    keys: list[HyperAgentKeyUsageEntry]
    days: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentKeyUsage":
        return cls(
            keys=[HyperAgentKeyUsageEntry.from_dict(item) for item in data.get("keys", [])],
            days=int(data.get("days", 0) or 0),
        )


@dataclass
class HyperAgentTypePreset:
    id: str
    name: str
    cpu: float
    memory: int
    cpu_limit: float
    memory_limit: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentTypePreset":
        return cls(
            id=str(data.get("id", "")),
            name=str(data.get("name", "")),
            cpu=float(data.get("cpu", 0) or 0),
            memory=int(data.get("memory", 0) or 0),
            cpu_limit=float(data.get("cpu_limit", 0) or 0),
            memory_limit=int(data.get("memory_limit", 0) or 0),
        )


@dataclass
class HyperAgentTypePlan:
    id: str
    name: str
    price: int
    agents: int
    agent_type: str
    highlighted: bool

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentTypePlan":
        return cls(
            id=str(data.get("id", "")),
            name=str(data.get("name", "")),
            price=int(data.get("price", 0) or 0),
            agents=int(data.get("agents", 0) or 0),
            agent_type=str(data.get("agent_type", "")),
            highlighted=bool(data.get("highlighted", False)),
        )


@dataclass
class HyperAgentTypeCatalog:
    types: list[HyperAgentTypePreset]
    plans: list[HyperAgentTypePlan]

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentTypeCatalog":
        return cls(
            types=[HyperAgentTypePreset.from_dict(item) for item in data.get("types", [])],
            plans=[HyperAgentTypePlan.from_dict(item) for item in data.get("plans", [])],
        )


@dataclass
class HyperAgentBillingProfileFields:
    billing_name: str | None = None
    billing_company: str | None = None
    billing_tax_id: str | None = None
    billing_line1: str | None = None
    billing_line2: str | None = None
    billing_city: str | None = None
    billing_state: str | None = None
    billing_postal_code: str | None = None
    billing_country: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentBillingProfileFields":
        return cls(
            billing_name=data.get("billing_name"),
            billing_company=data.get("billing_company"),
            billing_tax_id=data.get("billing_tax_id"),
            billing_line1=data.get("billing_line1"),
            billing_line2=data.get("billing_line2"),
            billing_city=data.get("billing_city"),
            billing_state=data.get("billing_state"),
            billing_postal_code=data.get("billing_postal_code"),
            billing_country=data.get("billing_country"),
        )

    def to_dict(self) -> dict[str, str | None]:
        return {
            "billing_name": self.billing_name,
            "billing_company": self.billing_company,
            "billing_tax_id": self.billing_tax_id,
            "billing_line1": self.billing_line1,
            "billing_line2": self.billing_line2,
            "billing_city": self.billing_city,
            "billing_state": self.billing_state,
            "billing_postal_code": self.billing_postal_code,
            "billing_country": self.billing_country,
        }


@dataclass
class HyperAgentBillingInfo:
    address: list[str]
    email: str

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentBillingInfo":
        return cls(
            address=[str(item) for item in data.get("address", [])],
            email=str(data.get("email", "")),
        )


@dataclass
class HyperAgentBillingProfileResponse:
    company_billing: HyperAgentBillingInfo
    profile: HyperAgentBillingProfileFields | None
    synced_stripe_customer_ids: list[str] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentBillingProfileResponse":
        return cls(
            company_billing=HyperAgentBillingInfo.from_dict(data.get("company_billing", {})),
            profile=HyperAgentBillingProfileFields.from_dict(data["profile"]) if data.get("profile") else None,
            synced_stripe_customer_ids=[str(item) for item in data.get("synced_stripe_customer_ids", [])] or None,
        )


@dataclass
class HyperAgentBillingUser:
    id: str
    email: str | None
    wallet_address: str | None
    team_id: str | None
    plan_id: str | None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentBillingUser":
        return cls(
            id=str(data.get("id", "")),
            email=data.get("email"),
            wallet_address=data.get("wallet_address"),
            team_id=data.get("team_id"),
            plan_id=data.get("plan_id"),
        )


@dataclass
class HyperAgentPaymentSubscription:
    id: str
    plan_id: str
    provider: str
    status: str
    current_period_end: datetime | None
    stripe_subscription_id: str | None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentPaymentSubscription":
        current_period_end = data.get("current_period_end")
        return cls(
            id=str(data.get("id", "")),
            plan_id=str(data.get("plan_id", "")),
            provider=str(data.get("provider", "")),
            status=str(data.get("status", "")),
            current_period_end=datetime.fromisoformat(str(current_period_end).replace("Z", "+00:00")) if current_period_end else None,
            stripe_subscription_id=data.get("stripe_subscription_id"),
        )


@dataclass
class HyperAgentPaymentEntitlement:
    id: str
    plan_id: str
    provider: str
    status: str
    expires_at: datetime | None
    agent_tier: str | None
    features: dict[str, bool]
    tags: list[str]

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentPaymentEntitlement":
        expires_at = data.get("expires_at")
        return cls(
            id=str(data.get("id", "")),
            plan_id=str(data.get("plan_id", "")),
            provider=str(data.get("provider", "")),
            status=str(data.get("status", "")),
            expires_at=datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) if expires_at else None,
            agent_tier=data.get("agent_tier"),
            features=data.get("features") or {},
            tags=[str(item) for item in data.get("tags", [])],
        )


@dataclass
class HyperAgentPayment:
    id: str
    user_id: str
    subscription_id: str | None
    entitlement_id: str | None
    provider: str
    status: str
    amount: str
    currency: str
    external_payment_id: str | None
    created_at: datetime | None
    updated_at: datetime | None
    user: HyperAgentBillingUser | None
    subscription: HyperAgentPaymentSubscription | None
    entitlement: HyperAgentPaymentEntitlement | None

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentPayment":
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        return cls(
            id=str(data.get("id", "")),
            user_id=str(data.get("user_id", "")),
            subscription_id=data.get("subscription_id"),
            entitlement_id=data.get("entitlement_id"),
            provider=str(data.get("provider", "")),
            status=str(data.get("status", "")),
            amount=str(data.get("amount", "")),
            currency=str(data.get("currency", "")),
            external_payment_id=data.get("external_payment_id"),
            created_at=datetime.fromisoformat(str(created_at).replace("Z", "+00:00")) if created_at else None,
            updated_at=datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")) if updated_at else None,
            user=HyperAgentBillingUser.from_dict(data["user"]) if data.get("user") else None,
            subscription=HyperAgentPaymentSubscription.from_dict(data["subscription"]) if data.get("subscription") else None,
            entitlement=HyperAgentPaymentEntitlement.from_dict(data["entitlement"]) if data.get("entitlement") else None,
        )


@dataclass
class HyperAgentPaymentsResponse:
    items: list[HyperAgentPayment]

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentPaymentsResponse":
        return cls(items=[HyperAgentPayment.from_dict(item) for item in data.get("items", [])])


@dataclass
class HyperAgentStripeCheckoutResponse:
    checkout_url: str

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentStripeCheckoutResponse":
        return cls(checkout_url=str(data.get("checkout_url", "")))


@dataclass
class HyperAgentX402CheckoutResponse:
    ok: bool
    key: str
    plan_id: str
    quantity: int
    bundle: dict[str, int]
    amount_paid: str
    duration_days: float
    expires_at: datetime | None
    tpm_limit: int
    rpm_limit: int

    @classmethod
    def from_dict(cls, data: dict) -> "HyperAgentX402CheckoutResponse":
        expires_at = data.get("expires_at")
        return cls(
            ok=bool(data.get("ok", False)),
            key=str(data.get("key", "")),
            plan_id=str(data.get("plan_id", "")),
            quantity=int(data.get("quantity", 0) or 0),
            bundle={str(k): int(v) for k, v in (data.get("bundle") or {}).items()},
            amount_paid=str(data.get("amount_paid", "")),
            duration_days=float(data.get("duration_days", 0) or 0),
            expires_at=datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) if expires_at else None,
            tpm_limit=int(data.get("tpm_limit", 0) or 0),
            rpm_limit=int(data.get("rpm_limit", 0) or 0),
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

    def _control_get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._http._session.get(
            f"{self._control_base_url}{path}",
            headers={"Authorization": f"Bearer {self._api_key}"},
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def _control_post(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._http._session.post(
            f"{self._control_base_url}{path}",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload or {},
        )
        response.raise_for_status()
        return response.json()

    def _control_put(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._http._session.put(
            f"{self._control_base_url}{path}",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload or {},
        )
        response.raise_for_status()
        return response.json()

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

    def purchase_via_x402(
        self,
        plan_id: str,
        *,
        quantity: int | None = None,
        bundle: dict[str, int] | None = None,
    ) -> HyperAgentX402CheckoutResponse:
        payload: dict[str, Any] = {}
        if quantity is not None:
            payload["quantity"] = int(quantity)
        if bundle is not None:
            payload["bundle"] = {str(k): int(v) for k, v in bundle.items()}
        response = self._http._session.post(
            f"{self._control_base_url}/x402/{quote(str(plan_id), safe='')}",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return HyperAgentX402CheckoutResponse.from_dict(response.json())

    def purchase_bundle_via_x402(
        self,
        *,
        quantity: int | None = None,
        bundle: dict[str, int] | None = None,
    ) -> HyperAgentX402CheckoutResponse:
        payload: dict[str, Any] = {}
        if quantity is not None:
            payload["quantity"] = int(quantity)
        if bundle is not None:
            payload["bundle"] = {str(k): int(v) for k, v in bundle.items()}
        response = self._http._session.post(
            f"{self._control_base_url}/x402/_bundle",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return HyperAgentX402CheckoutResponse.from_dict(response.json())

    def create_x402_checkout(
        self,
        *,
        quantity: int | None = None,
        bundle: dict[str, int] | None = None,
    ) -> HyperAgentX402CheckoutResponse:
        """Backward-compatible bundle x402 checkout shim."""
        return self.purchase_bundle_via_x402(quantity=quantity, bundle=bundle)

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
