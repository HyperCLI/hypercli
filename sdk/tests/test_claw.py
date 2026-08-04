"""
Tests for HyperAgent SDK client
"""
import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from hypercli import HyperCLI
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
    HyperAgentUsageSummary,
    HyperAgentUsageHistory,
    HyperAgentKeyUsage,
    HyperAgentTypeCatalog,
    HyperAgentBillingInfo,
    HyperAgentBillingProfileFields,
    HyperAgentBillingProfileResponse,
    HyperAgentPaymentsResponse,
    HyperAgentStripeCheckoutResponse,
    HyperAgentX402CheckoutResponse,
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
    
    def test_discovery_health(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "status": "ok",
            "hosts_total": 1,
            "hosts_healthy": 0,
            "fallbacks_active": 1
        }
        mock_http._session.get.return_value.raise_for_status = Mock()
        
        agent = HyperAgent(mock_http, dev=True)
        result = agent.discovery_health()
        
        assert result["status"] == "ok"
        assert result["hosts_total"] == 1
        mock_http._session.get.assert_called_once()

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

    def test_redeem_grant_code(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "grant": {"id": "grant-1", "code": "promo-123"},
            "entitlement": {"id": "ent-1", "plan_id": "solo"},
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        result = agent.redeem_grant_code("promo-123")

        assert result["grant"]["code"] == "promo-123"
        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/billing/grants/redeem",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"code": "promo-123"},
        )

    def test_redeem_grant_code_can_request_extension(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "grant": {"id": "grant-1", "code": "promo-123"},
            "entitlement": {"id": "ent-1", "plan_id": "solo"},
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        agent.redeem_grant_code("promo-123", extend_existing=True)

        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/billing/grants/redeem",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"code": "promo-123", "extend_existing": True},
        )
    
    def test_openai_client_creation(self, mock_http):
        """Test that OpenAI client is created with correct config."""
        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", dev=True)
        
        # Access openai property to trigger creation
        with patch('hypercli.agent.OPENAI_AVAILABLE', True), patch('hypercli.agent.OpenAI') as mock_openai:
            mock_openai.return_value = MagicMock()
            client = agent.openai
            
            mock_openai.assert_called_once_with(
                api_key="sk-hyper-test",
                base_url="https://api.agents.dev.hypercli.com/v1",
            )

    def test_openai_client_uses_agents_base_url_for_inference(self, mock_http):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.hypercli.com/agents",
        )

        with patch('hypercli.agent.OPENAI_AVAILABLE', True), patch('hypercli.agent.OpenAI') as mock_openai:
            mock_openai.return_value = MagicMock()
            _ = agent.openai

            mock_openai.assert_called_once_with(
                api_key="sk-hyper-test",
                base_url="https://api.agents.hypercli.com/v1",
            )

    def test_openai_client_normalizes_generic_api_host_to_agents_host(self, mock_http):
        agent = HyperAgent(
            mock_http,
            agent_api_key="sk-hyper-test",
            agents_api_base_url="https://api.dev.hypercli.com",
        )

        with patch('hypercli.agent.OPENAI_AVAILABLE', True), patch('hypercli.agent.OpenAI') as mock_openai:
            mock_openai.return_value = MagicMock()
            _ = agent.openai

            mock_openai.assert_called_once_with(
                api_key="sk-hyper-test",
                base_url="https://api.agents.dev.hypercli.com/v1",
            )
    
    def test_chat_uses_openai_client(self, mock_http):
        """Test that chat method uses OpenAI client."""
        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", dev=True)
        
        with patch('hypercli.agent.OPENAI_AVAILABLE', True), patch('hypercli.agent.OpenAI') as mock_openai:
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            
            agent.chat(
                model="kimi-k2.5",
                messages=[{"role": "user", "content": "Hello"}],
                temperature=0.7,
                max_tokens=100
            )
            
            mock_client.chat.completions.create.assert_called_once_with(
                model="kimi-k2.5",
                messages=[{"role": "user", "content": "Hello"}],
                temperature=0.7,
                max_tokens=100
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

class TestHyperAgentIntegration:
    """Integration tests for HyperAgent client (require running service)."""
    
    @pytest.fixture
    def agent_client(self):
        """Create a HyperAgent client for integration tests."""
        api_key = os.getenv("HYPER_API_KEY")
        if not api_key:
            pytest.skip("HYPER_API_KEY not set")
        
        # Create minimal mock http for standalone client
        http = Mock()
        http._api_key = api_key
        import requests
        http._session = requests.Session()
        
        return HyperAgent(http, agent_api_key=api_key, dev=True)
    
    @pytest.mark.integration
    def test_discovery_health_integration(self, agent_client):
        result = agent_client.discovery_health()
        assert "status" in result
        assert result["status"] == "ok"
    
    @pytest.mark.integration
    def test_chat_integration(self, agent_client):
        """Test actual chat completion (requires running service + credits)."""
        response = agent_client.chat(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
            max_tokens=10
        )
        assert response.choices[0].message.content is not None


def test_hypercli_dev_client_defaults_agents_urls():
    os.environ.pop("AGENTS_API_BASE_URL", None)
    os.environ.pop("AGENTS_WS_URL", None)
    os.environ.pop("HYPER_API_BASE", None)
    os.environ.pop("HYPERCLI_API_URL", None)
    client = HyperCLI(api_key="hyper_api_test_key", agent_api_key="sk-hyper-test", agent_dev=True)
    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"
    assert client.agent._base_url == "https://api.agents.dev.hypercli.com/v1"


def test_hypercli_uses_agent_env_for_agent_clients(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "sk-product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "sk-agent")
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.agents.dev.hypercli.com")

    client = HyperCLI()

    assert client._api_key == "sk-product"
    assert client.deployments._api_key == "sk-agent"
    assert client.agent._api_key == "sk-agent"
    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"


def test_hypercli_derives_agent_urls_from_explicit_api_url(monkeypatch):
    monkeypatch.delenv("AGENTS_API_BASE_URL", raising=False)
    monkeypatch.delenv("AGENTS_WS_URL", raising=False)
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.delenv("HYPERCLI_API_URL", raising=False)

    client = HyperCLI(
        api_key="sk-product",
        agent_api_key="sk-agent",
        api_url="https://api.dev.hypercli.com",
    )

    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"
    assert client.agent._base_url == "https://api.agents.dev.hypercli.com/v1"
