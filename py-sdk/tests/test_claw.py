"""
Tests for HyperAgent SDK client
"""
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import httpx
import pytest

from hypercli import HyperAgentSubscriptionTrial, HyperCLI
from hypercli.agent import (
    HyperAgent,
    HyperAgentCanonicalPlanId,
    HyperAgentEntitlements,
    HyperAgentEntitlementsSummary,
    HyperAgentPlan,
    HyperAgentCurrentPlan,
    HyperAgentSubscription,
    HyperAgentSubscriptionMutationResult,
    HyperAgentEntitlement,
    HyperAgentSubscriptionSummary,
    HyperAgentModel,
    HyperAgentTypeCatalog,
    HyperAgentStripeCheckoutResponse,
    parse_hyper_agent_plan_id,
)


class TestHyperAgentDataclasses:
    """Tests for HyperAgent dataclasses."""

    def test_agent_plan_from_dict(self):
        data = {
            "id": "pro",
            "name": "Pro",
            "price": 149,
            "amount_cents": 14900,
            "contract_version": "2026-08",
            "agents": 3,
            "max_agent_size": "large",
            "agent_resources": {"max_agents": 3, "total_cpu": 6, "total_memory": 24},
            "tpm_limit": 69444,
            "rpm_limit": 347,
        }
        plan = HyperAgentPlan.from_dict(data)
        assert plan.id == "pro"
        assert plan.price_usd == 149
        assert plan.amount_cents == 14900
        assert plan.contract_version == "2026-08"
        assert plan.max_agent_size == "large"
        assert plan.slot_grants == {"large": 3}
        assert plan.agent_resources["total_memory"] == 24
        assert plan.aiu is None
        assert plan.canonical_id is HyperAgentCanonicalPlanId.PRO
        assert parse_hyper_agent_plan_id("solo") is HyperAgentCanonicalPlanId.SOLO
        assert parse_hyper_agent_plan_id("free") is None

    def test_agent_type_catalog_exposes_only_advertised_resources(self):
        catalog = HyperAgentTypeCatalog.from_dict(
            {
                "types": [
                    {
                        "id": "small",
                        "name": "Small",
                        "cpu": 0.5,
                        "memory": 2,
                        "cpu_request": 0.25,
                        "memory_request": 1,
                        "cpu_limit": 2,
                        "memory_limit": 3,
                    }
                ],
                "plans": [],
            }
        )

        assert catalog.types[0].cpu == 0.5
        assert catalog.types[0].memory == 2
        assert not hasattr(catalog.types[0], "cpu_limit")
        assert not hasattr(catalog.types[0], "memory_limit")

    def test_agent_model_from_dict(self):
        data = {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5",
            "context_length": 262144,
            "capabilities": {
                "supports_vision": True,
                "supports_function_calling": True,
                "supports_tool_choice": True
            }
        }
        model = HyperAgentModel.from_dict(data)
        assert model.id == "kimi-k2.5"
        assert model.context_length == 262144
        assert model.supports_vision is True
        assert model.supports_function_calling is True

    def test_current_plan_from_dict(self):
        current = HyperAgentCurrentPlan.from_dict(
            {
                "id": "large",
                "name": "Large",
                "price": 99,
                "tpm_limit": 1000,
                "rpm_limit": 10,
                "expires_at": "2026-04-07T10:00:00Z",
                "cancel_at_period_end": True,
                "pooled_tpd": 1000000,
                "slot_inventory": {"large": {"granted": 1, "used": 0, "available": 1}},
            }
        )
        assert current.id == "large"
        assert current.cancel_at_period_end is True
        assert current.expires_at is not None
        assert current.slot_inventory["large"]["granted"] == 1

    def test_subscription_trial_from_dict_preserves_nullable_fields(self):
        subscription = HyperAgentSubscription.from_dict(
            {
                "id": "sub-trial",
                "status": "TRIALING",
                "trial": {
                    "active": True,
                    "days": 14,
                    "starts_at": "2030-01-01T00:00:00Z",
                    "ends_at": "2030-01-15T00:00:00Z",
                    "seconds_remaining": 1209600,
                },
            }
        )

        assert isinstance(subscription.trial, HyperAgentSubscriptionTrial)
        assert subscription.trial.active is True
        assert subscription.trial.days == 14
        assert subscription.trial.starts_at is not None
        assert subscription.trial.starts_at.isoformat() == "2030-01-01T00:00:00+00:00"
        assert subscription.trial.ends_at is not None
        assert subscription.trial.ends_at.isoformat() == "2030-01-15T00:00:00+00:00"
        assert subscription.trial.seconds_remaining == 1209600

        nullable = HyperAgentSubscription.from_dict(
            {
                "id": "sub-no-active-trial",
                "trial": {
                    "active": False,
                    "days": None,
                    "starts_at": None,
                    "ends_at": None,
                    "seconds_remaining": None,
                },
            }
        )
        assert nullable.trial == HyperAgentSubscriptionTrial(
            active=False,
            days=None,
            starts_at=None,
            ends_at=None,
            seconds_remaining=None,
        )
        assert HyperAgentSubscription.from_dict({"id": "sub-no-trial", "trial": None}).trial is None

    def test_explicit_subscription_trial_takes_precedence_over_legacy_metadata(self):
        explicit = HyperAgentSubscription.from_dict(
            {
                "id": "sub-explicit-trial",
                "status": "CANCELED",
                "cancel_at_period_end": True,
                "meta": {
                    "trial": True,
                    "trial_active": False,
                    "trial_ended_at": "2029-01-15T00:00:00Z",
                },
                "trial": {
                    "active": True,
                    "days": 14,
                    "starts_at": "2030-01-01T00:00:00Z",
                    "ends_at": "2030-01-15T00:00:00Z",
                    "seconds_remaining": None,
                },
            }
        )
        explicit_null = HyperAgentSubscription.from_dict(
            {
                "id": "sub-explicit-no-trial",
                "status": "ACTIVE",
                "current_period_end": "2030-01-15T00:00:00Z",
                "meta": {
                    "trial": True,
                    "trial_days": 14,
                    "trial_started_at": "2030-01-01T00:00:00Z",
                },
                "trial": None,
            }
        )

        assert explicit.trial is not None
        assert explicit.trial.active is True
        assert explicit.trial.seconds_remaining is None
        assert explicit_null.trial is None

    def test_subscription_trial_legacy_fallback_uses_persisted_timing(self):
        now = datetime.now(timezone.utc)
        period_end = now + timedelta(days=5)
        subscription = HyperAgentSubscription.from_dict(
            {
                "id": "sub-active-legacy-trial",
                "status": "ACTIVE",
                "current_period_end": period_end.isoformat(),
                "meta": {"trial": "true", "trial_days": "14"},
                "entitlements": [
                    {
                        "id": "ent-active-legacy-trial",
                        "starts_at": (now - timedelta(days=1)).isoformat(),
                    }
                ],
            }
        )

        assert subscription.trial is not None
        assert subscription.trial.active is True
        assert subscription.trial.days == 14
        assert subscription.trial.starts_at == period_end - timedelta(days=14)
        assert subscription.trial.ends_at == period_end
        assert subscription.trial.seconds_remaining is not None
        assert 4 * 24 * 60 * 60 < subscription.trial.seconds_remaining <= 5 * 24 * 60 * 60

        metadata_start = now - timedelta(days=1)
        metadata_end = now + timedelta(days=4)
        metadata_subscription = HyperAgentSubscription.from_dict(
            {
                "id": "sub-metadata-legacy-trial",
                "status": "TRIALING",
                "meta": {
                    "trial": True,
                    "trial_days": 14,
                    "trial_start": int(metadata_start.timestamp()),
                    "trial_end": int(metadata_end.timestamp()),
                },
            }
        )

        assert metadata_subscription.trial is not None
        assert metadata_subscription.trial.starts_at == datetime.fromtimestamp(
            int(metadata_start.timestamp()), tz=timezone.utc
        )
        assert metadata_subscription.trial.ends_at == datetime.fromtimestamp(
            int(metadata_end.timestamp()), tz=timezone.utc
        )

    @pytest.mark.parametrize("finalizer", ["canceled", "inactive", "ended", "cancel_scheduled"])
    def test_subscription_trial_legacy_fallback_rejects_canceled_or_finalized_trials(
        self, finalizer
    ):
        now = datetime.now(timezone.utc)
        data = {
            "id": f"sub-{finalizer}-legacy-trial",
            "status": "ACTIVE",
            "meta": {
                "trial": True,
                "trial_days": 14,
                "trial_started_at": (now - timedelta(days=1)).isoformat(),
                "trial_ends_at": (now + timedelta(days=5)).isoformat(),
            },
        }
        if finalizer == "canceled":
            data["status"] = "CANCELED"
        elif finalizer == "inactive":
            data["meta"]["trial_active"] = False
        elif finalizer == "ended":
            data["meta"]["trial_ended_at"] = now.isoformat()
        else:
            data["cancel_at_period_end"] = True

        assert HyperAgentSubscription.from_dict(data).trial is None

    def test_subscription_trial_legacy_fallback_does_not_revive_converted_trial(self):
        now = datetime.now(timezone.utc)
        subscription = HyperAgentSubscription.from_dict(
            {
                "id": "sub-converted-legacy-trial",
                "status": "ACTIVE",
                "current_period_end": (now + timedelta(days=22)).isoformat(),
                "meta": {"trial": True, "trial_days": 7},
                "entitlements": [
                    {
                        "id": "ent-converted-legacy-trial",
                        "starts_at": (now - timedelta(days=8)).isoformat(),
                    }
                ],
            }
        )

        assert subscription.trial is None

    def test_subscription_summary_from_dict(self):
        summary = HyperAgentSubscriptionSummary.from_dict(
            {
                "effective_plan_id": "large",
                "current_subscription_id": "sub-1",
                "current_entitlement_id": "sub-1",
                "pooled_tpm_limit": 2000,
                "pooled_rpm_limit": 20,
                "pooled_tpd": 2000000,
                "billing_reset_at": "2026-04-15T00:00:00Z",
                "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
                "agent_slots": [
                    {
                        "id": "slot-1",
                        "entitlement_id": "ent-1",
                        "plan_id": "pro",
                        "size": "large",
                        "agent_id": "agent-1",
                        "occupied": True,
                    }
                ],
                "active_subscription_count": 1,
                "active_entitlement_count": 1,
                "entitlements": {
                    "effective_plan_id": "large",
                    "pooled_tpm_limit": 2000,
                    "pooled_rpm_limit": 20,
                    "pooled_tpd": 2000000,
                    "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
                    "active_entitlement_count": 1,
                },
                "entitlement_items": [
                    {
                        "id": "ent-1",
                        "user_id": "user-1",
                        "subscription_id": "sub-1",
                        "plan_id": "large",
                        "plan_name": "Large",
                        "provider": "STRIPE",
                        "status": "ACTIVE",
                        "starts_at": "2026-04-01T00:00:00Z",
                        "expires_at": "2026-04-15T00:00:00Z",
                        "agent_tier": "large",
                        "slot_grants": {"large": 1},
                        "features": {"voice": True},
                        "tags": ["customer=acme"],
                        "active_agent_count": 1,
                        "active_agent_ids": ["agent-1"],
                    }
                ],
                "active_subscriptions": [
                    {
                        "id": "sub-1",
                        "user_id": "user-1",
                        "plan_id": "large",
                        "plan_name": "Large",
                        "provider": "STRIPE",
                        "status": "ACTIVE",
                    }
                ],
                "subscriptions": [],
                "user": {"id": "user-1", "team_id": "team-1"},
            }
        )
        assert summary.effective_plan_id == "large"
        assert summary.current_entitlement_id == "sub-1"
        assert summary.active_subscription_count == 1
        assert isinstance(summary.entitlements, HyperAgentEntitlements)
        assert summary.entitlements.active_entitlement_count == 1
        assert summary.active_subscriptions[0].plan_id == "large"
        assert summary.entitlements.billing_reset_at is not None
        assert isinstance(summary.entitlement_items[0], HyperAgentEntitlement)
        assert summary.entitlement_items[0].starts_at is not None
        assert summary.entitlement_items[0].tags == ["customer=acme"]
        assert summary.entitlement_items[0].slot_grants == {"large": 1}
        assert summary.agent_slots[0].size == "large"
        assert summary.entitlements.agent_slots[0].agent_id == "agent-1"
        assert summary.has_active_plan is True

    def test_subscription_summary_preserves_direct_entitlement_items(self):
        summary = HyperAgentSubscriptionSummary.from_dict(
            {
                "effective_plan_id": "pro",
                "current_subscription_id": None,
                "current_entitlement_id": "ent-direct-1",
                "pooled_tpm_limit": 8680550,
                "pooled_rpm_limit": 868,
                "pooled_tpd": 250000000,
                "slot_inventory": {"large": {"granted": 1, "used": 0, "available": 1}},
                "active_subscription_count": 0,
                "active_entitlement_count": 1,
                "entitlement_items": [
                    {
                        "id": "ent-direct-1",
                        "user_id": "user-1",
                        "subscription_id": None,
                        "plan_id": "pro",
                        "plan_name": "Pro",
                        "provider": "ACTIVATION_CODE",
                        "status": "ACTIVE",
                        "starts_at": "2026-04-01T00:00:00Z",
                        "agent_tier": "large",
                        "slot_grants": {"large": 1},
                    }
                ],
                "active_subscriptions": [],
                "subscriptions": [],
            }
        )

        assert summary.active_subscription_count == 0
        assert summary.active_entitlement_count == 1
        assert summary.has_active_plan is True
        assert summary.entitlement_items[0].subscription_id is None
        assert summary.entitlement_items[0].starts_at is not None
        assert summary.entitlement_items[0].slot_grants == {"large": 1}


class TestHyperAgentClient:
    """Tests for HyperAgent client methods."""

    @pytest.fixture
    def mock_http(self):
        http = Mock()
        http._api_key = "test-key"
        http._session = Mock()
        http._session.put = Mock()
        return http

    def test_current_plan(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "id": "large",
            "name": "Large",
            "price": 99,
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        current = agent.current_plan()

        assert current.id == "large"
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/plans/current",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_agent_types(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "types": [
                {"id": "small", "name": "Small", "cpu": 0.5, "memory": 2},
                {"id": "large", "name": "Large", "cpu": 2, "memory": 8},
            ],
            "plans": [
                {
                    "id": "team",
                    "name": "Team",
                    "price": 49,
                    "agents": 1,
                    "agent_type": "medium",
                    "highlighted": True,
                }
            ],
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        catalog = agent.agent_types()

        assert [preset.id for preset in catalog.types] == ["small", "large"]
        assert catalog.types[0].cpu == 0.5
        assert catalog.plans[0].agent_type == "medium"
        assert catalog.plans[0].highlighted is True
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/types",
            headers={"Authorization": "Bearer sk-hyper-test"},
            params=None,
        )

    def test_subscriptions(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "items": [
                {
                    "id": "sub-1",
                    "user_id": "user-1",
                    "plan_id": "large",
                    "plan_name": "Large",
                    "provider": "STRIPE",
                    "status": "ACTIVE",
                    "quantity": 2,
                    "current_period_end": "2026-04-15T00:00:00Z",
                }
            ]
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        subscriptions = agent.subscriptions()

        assert len(subscriptions) == 1
        assert subscriptions[0].quantity == 2
        assert subscriptions[0].expires_at is not None
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_subscription_summary(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "effective_plan_id": "large",
            "current_subscription_id": "sub-1",
            "pooled_tpm_limit": 2000,
            "pooled_rpm_limit": 20,
            "pooled_tpd": 2000000,
            "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
            "active_subscription_count": 1,
            "active_entitlement_count": 1,
            "entitlement_items": [
                {
                    "id": "ent-1",
                    "user_id": "user-1",
                    "subscription_id": "sub-1",
                    "plan_id": "large",
                    "plan_name": "Large",
                    "provider": "STRIPE",
                    "status": "ACTIVE",
                    "expires_at": "2026-04-15T00:00:00Z",
                    "agent_tier": "large",
                    "slot_grants": {"large": 1},
                    "features": {"voice": True},
                    "tags": ["customer=acme"],
                    "active_agent_count": 1,
                    "active_agent_ids": ["agent-1"],
                }
            ],
            "active_subscriptions": [
                {
                    "id": "sub-1",
                    "user_id": "user-1",
                    "plan_id": "large",
                    "plan_name": "Large",
                    "provider": "STRIPE",
                    "status": "ACTIVE",
                }
            ],
            "subscriptions": [],
            "user": {"id": "user-1", "team_id": "team-1"},
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        summary = agent.subscription_summary()

        assert summary.current_subscription_id == "sub-1"
        assert summary.slot_inventory["large"]["available"] == 1
        assert summary.entitlement_items[0].plan_id == "large"
        assert summary.entitlement_items[0].slot_grants == {"large": 1}
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions/summary",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_entitlements(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "effective_plan_id": "large",
            "current_subscription_id": "sub-1",
            "current_entitlement_id": "sub-1",
            "pooled_tpm_limit": 2000,
            "pooled_rpm_limit": 20,
            "pooled_tpd": 2000000,
            "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
            "active_subscription_count": 1,
            "active_entitlement_count": 1,
            "entitlements": {
                "effective_plan_id": "large",
                "pooled_tpm_limit": 2000,
                "pooled_rpm_limit": 20,
                "pooled_tpd": 2000000,
                "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
                "active_entitlement_count": 1,
            },
            "active_subscriptions": [],
            "subscriptions": [],
            "user": {"id": "user-1", "team_id": "team-1"},
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        summary = agent.entitlements()

        assert isinstance(summary, HyperAgentEntitlementsSummary)
        assert summary.entitlements.slot_inventory["large"]["available"] == 1
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/entitlements",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_cancel_subscription(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "ok": True,
            "message": "Subscription will be cancelled at the end of the current billing period",
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        result = agent.cancel_subscription("sub-1")

        assert result["ok"] is True
        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions/sub-1/cancel",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_update_subscription_uses_named_plan_and_quantity(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "ok": True,
            "message": "Subscription upgraded immediately",
            "subscription": {
                "id": "sub-1",
                "user_id": "user-1",
                "plan_id": "team",
                "plan_name": "Team",
                "provider": "STRIPE",
                "status": "ACTIVE",
                "quantity": 2,
            },
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )
        result = agent.update_subscription(
            "sub-1",
            plan_id=HyperAgentCanonicalPlanId.TEAM,
            quantity=2,
        )

        assert isinstance(result, HyperAgentSubscriptionMutationResult)
        assert result.ok is True
        assert result.subscription is not None
        assert result.subscription.plan_id == "team"
        assert result.subscription.quantity == 2
        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions/sub-1/update",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"plan_id": "team", "quantity": 2},
        )

    @pytest.mark.parametrize("quantity", [0, -1, 1.5, True])
    def test_update_subscription_rejects_invalid_quantity(self, mock_http, quantity):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        with pytest.raises(ValueError, match="quantity must be a positive integer"):
            agent.update_subscription("sub-1", plan_id="team", quantity=quantity)

        mock_http._session.post.assert_not_called()

    def test_claim_trial_entitlement_posts_bodyless(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "id": "ent-trial-1",
            "user_id": "user-1",
            "subscription_id": None,
            "plan_id": "team",
            "plan_name": "Team",
            "provider": "TRIAL",
            "status": "ACTIVE",
            "starts_at": "2026-08-11T12:00:00Z",
            "expires_at": "2026-08-18T12:00:00Z",
            "slot_grants": {"medium": 3},
        }
        mock_http._session.post.return_value.raise_for_status = Mock()
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        result = agent.claim_trial_entitlement()

        assert isinstance(result, HyperAgentEntitlement)
        assert result.id == "ent-trial-1"
        assert result.plan_id == "team"
        assert result.provider == "TRIAL"
        assert result.starts_at == datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
        assert result.expires_at == datetime(2026, 8, 18, 12, tzinfo=timezone.utc)
        assert result.slot_grants == {"medium": 3}
        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/plans/trial",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_claim_trial_entitlement_propagates_conflict(self, mock_http):
        url = "https://api.hypercli.com/agents/plans/trial"
        response = httpx.Response(
            409,
            request=httpx.Request("POST", url),
            json={"detail": "trial_not_eligible"},
        )
        mock_http._session.post.return_value = response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            agent.claim_trial_entitlement()

        assert exc_info.value.response.status_code == 409
        assert exc_info.value.response.json()["detail"] == "trial_not_eligible"
        mock_http._session.post.assert_called_once_with(
            url,
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_create_stripe_trial_checkout_serializes_optional_urls(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "checkout_url": "https://checkout.stripe.com/c/pay/cs_trial",
            "session_id": "cs_trial",
            "checkout_attempt_id": "attempt-trial",
        }
        mock_http._session.post.return_value.raise_for_status = Mock()
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        result = agent.create_stripe_trial_checkout(
            success_url="https://claw.hypercli.com/plans?trial=success",
            cancel_url="https://claw.hypercli.com/plans?trial=canceled",
        )

        assert isinstance(result, HyperAgentStripeCheckoutResponse)
        assert result.checkout_url == "https://checkout.stripe.com/c/pay/cs_trial"
        assert result.checkout_session_id == "cs_trial"
        assert result.checkout_attempt_id == "attempt-trial"
        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/stripe/trial",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={
                "success_url": "https://claw.hypercli.com/plans?trial=success",
                "cancel_url": "https://claw.hypercli.com/plans?trial=canceled",
            },
        )

    def test_create_stripe_trial_checkout_propagates_http_errors(self, mock_http):
        url = "https://api.hypercli.com/agents/stripe/trial"
        response = httpx.Response(
            409,
            request=httpx.Request("POST", url),
            json={"detail": "Team trial has already been used"},
        )
        mock_http._session.post.return_value = response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            agent.create_stripe_trial_checkout()

        assert exc_info.value.response.status_code == 409
        assert exc_info.value.response.json()["detail"] == "Team trial has already been used"
        mock_http._session.post.assert_called_once_with(
            url,
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={},
        )


    def test_purchase_via_x402_uses_plan_route(self, mock_http):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "ok": True,
            "key": "hyper_api_x402",
            "plan_id": "solo",
            "quantity": 1,
            "bundle": {"small": 1},
            "amount_paid": "20.00",
            "duration_days": 30,
            "expires_at": "2026-05-19T12:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }
        mock_http._session.post.return_value = mock_response

        result = agent.purchase_via_x402("solo", quantity=1)

        assert result.plan_id == "solo"
        assert mock_http._session.post.call_args[0][0] == "https://api.hypercli.com/agents/x402/solo"
        assert mock_http._session.post.call_args[1]["json"] == {"quantity": 1}

        with pytest.raises(ValueError, match="Arbitrary slot bundles are no longer supported"):
            agent.purchase_via_x402("solo", bundle={"small": 1})

    def test_purchase_bundle_via_x402_is_rejected_locally(self, mock_http):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "ok": True,
            "key": "hyper_api_x402",
            "plan_id": "_bundle",
            "quantity": 1,
            "bundle": {"large": 2},
            "amount_paid": "200.00",
            "duration_days": 30,
            "expires_at": "2026-05-19T12:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }
        mock_http._session.post.return_value = mock_response

        with pytest.raises(ValueError, match="Arbitrary slot bundles are no longer supported"):
            agent.purchase_bundle_via_x402(quantity=1, bundle={"large": 2})
        mock_http._session.post.assert_not_called()

    def test_create_x402_checkout_requires_plan_id(self, mock_http):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "ok": True,
            "key": "hyper_api_x402",
            "plan_id": "_bundle",
            "quantity": 1,
            "bundle": {"medium": 1},
            "amount_paid": "40.00",
            "duration_days": 30,
            "expires_at": "2026-05-19T12:00:00Z",
            "tpm_limit": 1000,
            "rpm_limit": 10,
        }
        mock_http._session.post.return_value = mock_response

        with pytest.raises(ValueError, match="A canonical plan ID is required"):
            agent.create_x402_checkout(quantity=1, bundle={"medium": 1})
        mock_http._session.post.assert_not_called()

    def test_redeem_grant_code_posts_and_parses_redemption(self, mock_http):
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "grant": {
                "id": "grant-1",
                "type": "ACTIVATION_CODE",
                "code": "promo-123",
                "plan_id": "solo",
                "duration": 3600,
                "tags": ["customer=acme"],
            },
            "entitlement": {
                "id": "ent-1",
                "user_id": "user-1",
                "subscription_id": None,
                "plan_id": "solo",
                "plan_name": "Solo",
                "provider": "ACTIVATION_CODE",
                "status": "ACTIVE",
                "starts_at": "2026-04-19T12:00:00Z",
                "expires_at": "2026-04-19T13:00:00Z",
                "tpm_limit": 1000,
                "rpm_limit": 10,
                "tpd_limit": 1000000,
                "agent_tier": "small",
                "features": {},
                "tags": ["customer=acme"],
            },
        }
        mock_http._session.post.return_value = mock_response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        result = agent.redeem_grant_code("promo-123")

        assert result.grant.code == "promo-123"
        assert result.grant.type == "ACTIVATION_CODE"
        assert result.grant.tags == ["customer=acme"]
        assert result.entitlement.provider == "ACTIVATION_CODE"
        assert result.entitlement.starts_at.isoformat() == "2026-04-19T12:00:00+00:00"
        assert result.payment is None
        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/billing/grants/redeem",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"code": "promo-123"},
        )

    def test_redeem_grant_code_can_request_extension(self, mock_http):
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "grant": {"id": "grant-1", "type": "ACTIVATION_CODE", "code": "promo-123"},
            "entitlement": {"id": "ent-1", "plan_id": "solo", "provider": "ACTIVATION_CODE"},
        }
        mock_http._session.post.return_value = mock_response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        agent.redeem_grant_code("promo-123", extend_existing=True)

        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/billing/grants/redeem",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"code": "promo-123", "extend_existing": True},
        )

    def test_purchase_entitlement_from_balance_posts_and_parses_redemption(self, mock_http):
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "grant": {
                "id": "grant-1",
                "type": "BALANCE",
                "plan_id": "solo",
                "duration": 3600,
                "tags": ["customer=acme"],
            },
            "entitlement": {
                "id": "ent-1",
                "user_id": "user-1",
                "subscription_id": None,
                "plan_id": "solo",
                "plan_name": "Solo",
                "provider": "BALANCE",
                "status": "ACTIVE",
                "starts_at": "2026-04-19T12:00:00Z",
                "expires_at": "2026-04-19T13:00:00Z",
                "tpm_limit": 1000,
                "rpm_limit": 10,
                "tpd_limit": 1000000,
                "agent_tier": "small",
                "features": {},
                "tags": ["customer=acme"],
                "slot_grants": {"small": 1, "medium": 0, "large": 0},
                "active_agent_count": 0,
                "active_agent_ids": [],
            },
            "payment": {
                "id": "pay-1",
                "user_id": "user-1",
                "provider": "BALANCE",
                "status": "SUCCEEDED",
                "amount": "10000",
                "currency": "usdc",
                "external_payment_id": "tx-1",
            },
        }
        mock_http._session.post.return_value = mock_response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        result = agent.purchase_entitlement_from_balance(
            "solo", duration=3600, tags=["customer=acme"]
        )

        assert result.grant.type == "BALANCE"
        assert result.grant.duration == 3600
        assert result.entitlement.starts_at.isoformat() == "2026-04-19T12:00:00+00:00"
        assert result.payment is not None
        assert result.payment.provider == "BALANCE"
        assert result.payment.external_payment_id == "tx-1"
        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/billing/balance/solo",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"duration": 3600, "tags": ["customer=acme"]},
        )

    def test_purchase_entitlement_from_balance_can_request_extension(self, mock_http):
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "grant": {"id": "grant-1", "type": "BALANCE", "plan_id": "solo", "duration": 3600},
            "entitlement": {"id": "ent-1", "plan_id": "solo", "provider": "BALANCE", "tags": []},
        }
        mock_http._session.post.return_value = mock_response
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        agent.purchase_entitlement_from_balance("solo", duration=3600, extend_existing=True)

        mock_http._session.post.assert_called_once_with(
            "https://api.hypercli.com/agents/billing/balance/solo",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"duration": 3600, "extend_existing": True},
        )

    def test_usage_report_combines_sections_and_degrades_tolerantly(self, mock_http):
        def make_response(payload):
            response = Mock()
            response.raise_for_status.return_value = None
            response.json.return_value = payload
            return response

        def fake_get(url, headers=None, params=None):
            if url.endswith("/usage/history"):
                return make_response(
                    {
                        "history": [
                            {
                                "date": "2026-04-19",
                                "total_tokens": 10,
                                "prompt_tokens": 6,
                                "completion_tokens": 4,
                                "requests": 2,
                            }
                        ],
                        "days": params["days"],
                    }
                )
            if url.endswith("/usage/keys"):
                failing = Mock()
                failing.raise_for_status.side_effect = httpx.HTTPStatusError(
                    "forbidden",
                    request=httpx.Request("GET", url),
                    response=httpx.Response(403, request=httpx.Request("GET", url)),
                )
                return failing
            if url.endswith("/usage/agents"):
                return make_response(
                    {
                        "agents": [
                            {
                                "agent_id": "agent-1",
                                "name": "alpha",
                                "managed": True,
                                "avatar_url": None,
                                "total_tokens": 7,
                                "prompt_tokens": 5,
                                "completion_tokens": 2,
                                "requests": 1,
                            }
                        ],
                        "unattributed": {
                            "total_tokens": 3,
                            "prompt_tokens": 1,
                            "completion_tokens": 2,
                            "requests": 1,
                        },
                        "days": params["days"],
                    }
                )
            raise AssertionError(f"unexpected url: {url}")

        mock_http._session.get.side_effect = fake_get
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        report = agent.usage_report(days=120)

        assert report.days == 90
        assert report.history is not None
        assert report.history[0].total_tokens == 10
        assert report.keys is None
        assert report.agents is not None
        assert report.agents[0].agent_id == "agent-1"
        assert report.agents[0].managed is True
        assert report.unattributed.total_tokens == 3

    def test_billing_history_reports_subscription_and_payment_counts(self, mock_http):
        def make_response(payload):
            response = Mock()
            response.raise_for_status.return_value = None
            response.json.return_value = payload
            return response

        def fake_get(url, headers=None, params=None):
            if url.endswith("/subscriptions"):
                return make_response(
                    {
                        "items": [
                            {
                                "id": "sub-1",
                                "user_id": "user-1",
                                "plan_id": "solo",
                                "plan_name": "Solo",
                                "provider": "STRIPE",
                                "status": "ACTIVE",
                                "quantity": 1,
                            }
                        ]
                    }
                )
            if url.endswith("/billing/payments"):
                assert params == {"limit": 1}
                return make_response(
                    {
                        "items": [
                            {
                                "id": "pay-1",
                                "user_id": "user-1",
                                "provider": "STRIPE",
                                "status": "SUCCEEDED",
                                "amount": "1000",
                                "currency": "usd",
                            }
                        ]
                    }
                )
            raise AssertionError(f"unexpected url: {url}")

        mock_http._session.get.side_effect = fake_get
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        history = agent.billing_history()

        assert history.has_billing_history is True
        assert history.subscription_count == 1
        assert history.payment_count == 1

    def test_billing_history_is_false_for_fresh_account(self, mock_http):
        def make_response(payload):
            response = Mock()
            response.raise_for_status.return_value = None
            response.json.return_value = payload
            return response

        mock_http._session.get.side_effect = lambda url, headers=None, params=None: (
            make_response({"items": []})
        )
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        history = agent.billing_history()

        assert history.has_billing_history is False
        assert history.subscription_count == 0
        assert history.payment_count == 0

def test_hypercli_dev_client_defaults_agents_urls():
    os.environ.pop("HYPER_API_BASE", None)
    client = HyperCLI(api_key="hyper_api_test_key", agent_api_key="sk-hyper-test", agent_dev=True)
    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"
    # Agents-only selection does not redirect product inference.
    assert client.agent._base_url == "https://api.agents.hypercli.com/v1"


def test_explicit_product_key_is_used_for_agent_clients(monkeypatch):
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    client = HyperCLI(api_key="hyper_api_explicit")

    assert client._api_key == "hyper_api_explicit"
    assert client.deployments._api_key == "hyper_api_explicit"
    assert client.agent._api_key == "hyper_api_explicit"


def test_hypercli_uses_product_env_before_agent_fallback(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    client = HyperCLI()

    assert client._api_key == "hyper_api_product"
    assert client.deployments._api_key == "hyper_api_product"
    assert client.agent._api_key == "hyper_api_product"
    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"


def test_hypercli_derives_agent_urls_from_explicit_api_url(monkeypatch):
    monkeypatch.delenv("HYPER_API_BASE", raising=False)

    client = HyperCLI(
        api_key="hyper_api_product",
        agent_api_key="hyper_api_agent",
        api_url="https://api.dev.hypercli.com",
    )

    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"
    assert client.agent._base_url == "https://api.agents.dev.hypercli.com/v1"
