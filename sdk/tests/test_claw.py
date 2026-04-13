"""
Tests for HyperAgent SDK client
"""
import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from hypercli import HyperCLI
from hypercli.agent import (
    HyperAgent,
    HyperAgentEntitlement,
    HyperAgentEntitlements,
    HyperAgentEntitlementsSummary,
    HyperAgentPlan,
    HyperAgentCurrentPlan,
    HyperAgentSubscription,
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
)


class TestHyperAgentDataclasses:
    """Tests for HyperAgent dataclasses."""

    def test_agent_plan_from_dict(self):
        data = {
            "id": "5aiu",
            "name": "5 Agents",
            "price_usd": 3.0,
            "tpm_limit": 250000,
            "rpm_limit": 5000
        }
        plan = HyperAgentPlan.from_dict(data)
        assert plan.id == "5aiu"
        assert plan.price_usd == 3.0
    
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
                "active_subscription_count": 1,
                "active_entitlement_count": 1,
                "entitlements": {
                    "effective_plan_id": "large",
                    "pooled_tpm_limit": 2000,
                    "pooled_rpm_limit": 20,
                    "pooled_tpd": 2000000,
                    "billing_reset_at": "2026-04-15T00:00:00Z",
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
                        "expires_at": "2026-04-15T00:00:00Z",
                        "agent_tier": "large",
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
        assert summary.billing_reset_at is not None
        assert summary.entitlements.billing_reset_at is not None
        assert summary.active_subscriptions[0].plan_id == "large"
        assert isinstance(summary.entitlement_items[0], HyperAgentEntitlement)
        assert summary.entitlement_items[0].tags == ["customer=acme"]


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
            "billing_reset_at": "2026-04-15T00:00:00Z",
            "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
            "active_subscription_count": 1,
            "active_entitlement_count": 1,
            "entitlements": {
                "effective_plan_id": "large",
                "pooled_tpm_limit": 2000,
                "pooled_rpm_limit": 20,
                "pooled_tpd": 2000000,
                "billing_reset_at": "2026-04-15T00:00:00Z",
                "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
                "active_entitlement_count": 1,
            },
            "entitlement_items": [
                {
                    "id": "ent-1",
                    "user_id": "user-1",
                    "plan_id": "large",
                    "plan_name": "Large",
                    "provider": "X402",
                    "status": "ACTIVE",
                    "expires_at": "2026-04-20T00:00:00Z",
                    "agent_tier": "large",
                    "features": {"voice": True},
                    "tags": ["customer=acme"],
                    "active_agent_count": 0,
                    "active_agent_ids": [],
                }
            ],
            "active_subscriptions": [],
            "subscriptions": [],
            "user": {"id": "user-1", "team_id": "team-1"},
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        summary = agent.entitlements()

        assert isinstance(summary, HyperAgentEntitlementsSummary)
        assert summary.billing_reset_at is not None
        assert summary.entitlements.slot_inventory["large"]["available"] == 1
        assert summary.entitlement_items[0].provider == "X402"
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/entitlements",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_entitlement_instances(self, mock_http):
        mock_http._session.get.return_value.json.return_value = {
            "items": [
                {
                    "id": "ent-1",
                    "user_id": "user-1",
                    "subscription_id": None,
                    "plan_id": "large",
                    "plan_name": "Large",
                    "provider": "X402",
                    "status": "ACTIVE",
                    "expires_at": "2026-04-20T00:00:00Z",
                    "agent_tier": "large",
                    "features": {"voice": True},
                    "tags": ["customer=acme"],
                    "active_agent_count": 0,
                    "active_agent_ids": [],
                }
            ]
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        entitlements = agent.entitlement_instances()

        assert len(entitlements) == 1
        assert entitlements[0].plan_id == "large"
        assert entitlements[0].tags == ["customer=acme"]
        mock_http._session.get.assert_called_with(
            "https://api.hypercli.com/agents/entitlements/instances",
            headers={"Authorization": "Bearer sk-hyper-test"},
        )

    def test_cancel_subscription(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "ok": True,
            "message": "Subscription will be cancelled at the end of the current billing period",
            "subscription": {
                "id": "sub-1",
                "user_id": "user-1",
                "plan_id": "large",
                "plan_name": "Large",
                "provider": "STRIPE",
                "status": "ACTIVE",
                "cancel_at_period_end": True,
                "can_cancel": True,
            },
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        result = agent.cancel_subscription("sub-1")

        assert result.ok is True
        assert result.subscription is not None
        assert result.subscription.cancel_at_period_end is True
        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions/sub-1/update",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"bundle": {}},
        )

    def test_update_subscription(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "ok": True,
            "message": "Subscription upgraded immediately",
            "subscription": {
                "id": "sub-1",
                "user_id": "user-1",
                "plan_id": "large",
                "plan_name": "Large",
                "provider": "STRIPE",
                "status": "ACTIVE",
                "cancel_at_period_end": False,
                "can_cancel": True,
            },
        }
        mock_http._session.post.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        result = agent.update_subscription("sub-1", {"large": 1})

        assert result.ok is True
        assert result.subscription is not None
        assert result.subscription.plan_id == "large"
        mock_http._session.post.assert_called_with(
            "https://api.hypercli.com/agents/subscriptions/sub-1/update",
            headers={"Authorization": "Bearer sk-hyper-test"},
            json={"bundle": {"large": 1}},
        )

    def test_usage_endpoints(self, mock_http):
        mock_http._session.get.side_effect = [
            Mock(json=Mock(return_value={
                "total_tokens": 100,
                "prompt_tokens": 60,
                "completion_tokens": 40,
                "request_count": 5,
                "active_keys": 2,
                "current_tpm": 1000,
                "current_rpm": 10,
                "period": "30d",
            }), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "history": [{"date": "2026-04-13", "total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "requests": 5}],
                "days": 7,
            }), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "keys": [{"key_hash": "key-1", "name": "Primary", "total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "requests": 5}],
                "days": 7,
            }), raise_for_status=Mock()),
        ]

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        summary = agent.usage_summary()
        history = agent.usage_history()
        keys = agent.key_usage()

        assert isinstance(summary, HyperAgentUsageSummary)
        assert summary.total_tokens == 100
        assert isinstance(history, HyperAgentUsageHistory)
        assert history.history[0].date == "2026-04-13"
        assert isinstance(keys, HyperAgentKeyUsage)
        assert keys.keys[0].key_hash == "key-1"

    def test_types_and_billing_endpoints(self, mock_http):
        mock_http._session.get.side_effect = [
            Mock(json=Mock(return_value={
                "types": [{"id": "medium", "name": "Medium", "cpu": 1, "memory": 2, "cpu_limit": 1, "memory_limit": 2}],
                "plans": [{"id": "2aiu", "name": "2 AIU", "price": 20, "agents": 1, "agent_type": "medium", "highlighted": True}],
            }), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "company_billing": {"address": ["HyperCLI"], "email": "support@hypercli.com"},
                "profile": None,
            }), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "company_billing": {"address": ["HyperCLI"], "email": "support@hypercli.com"},
                "profile": {"billing_name": "Test User"},
            }), raise_for_status=Mock()),
        ]
        mock_http._session.put.return_value.json.return_value = {
            "company_billing": {"address": ["HyperCLI"], "email": "support@hypercli.com"},
            "profile": {"billing_name": "Test User"},
            "synced_stripe_customer_ids": ["cus_123"],
        }
        mock_http._session.put.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        catalog = agent.agent_types()
        info = agent.billing_info()
        profile = agent.billing_profile()
        updated = agent.update_billing_profile(HyperAgentBillingProfileFields(billing_name="Test User"))

        assert isinstance(catalog, HyperAgentTypeCatalog)
        assert catalog.types[0].id == "medium"
        assert isinstance(info, HyperAgentBillingInfo)
        assert info.email == "support@hypercli.com"
        assert isinstance(profile, HyperAgentBillingProfileResponse)
        assert profile.profile is not None
        assert profile.profile.billing_name == "Test User"
        assert updated.synced_stripe_customer_ids == ["cus_123"]

    def test_payments_and_checkout_endpoints(self, mock_http):
        mock_http._session.get.side_effect = [
            Mock(json=Mock(return_value={
                "items": [{
                    "id": "pay_123",
                    "user_id": "user-1",
                    "subscription_id": None,
                    "entitlement_id": None,
                    "provider": "STRIPE",
                    "status": "SUCCEEDED",
                    "amount": "2000",
                    "currency": "usd",
                    "external_payment_id": "pi_123",
                    "created_at": "2026-04-13T00:00:00Z",
                    "updated_at": "2026-04-13T00:00:00Z",
                    "user": {"id": "user-1", "email": "user@example.com", "wallet_address": None, "team_id": "team-1", "plan_id": "2aiu"},
                    "subscription": None,
                    "entitlement": None,
                }]
            }), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "id": "pay_123",
                "user_id": "user-1",
                "subscription_id": None,
                "entitlement_id": None,
                "provider": "STRIPE",
                "status": "SUCCEEDED",
                "amount": "2000",
                "currency": "usd",
                "external_payment_id": "pi_123",
                "created_at": "2026-04-13T00:00:00Z",
                "updated_at": "2026-04-13T00:00:00Z",
                "user": {"id": "user-1", "email": "user@example.com", "wallet_address": None, "team_id": "team-1", "plan_id": "2aiu"},
                "subscription": None,
                "entitlement": None,
            }), raise_for_status=Mock()),
        ]
        mock_http._session.post.side_effect = [
            Mock(json=Mock(return_value={"checkout_url": "https://checkout.stripe.test/session"}), raise_for_status=Mock()),
            Mock(json=Mock(return_value={
                "ok": True,
                "key": "sk-x402",
                "plan_id": "2aiu",
                "quantity": 1,
                "bundle": {"medium": 1},
                "amount_paid": "20.000000",
                "duration_days": 30,
                "expires_at": "2026-05-13T00:00:00Z",
                "tpm_limit": 1000,
                "rpm_limit": 10,
            }), raise_for_status=Mock()),
        ]

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        payments = agent.payments(limit=10, provider="stripe", status="succeeded")
        payment = agent.payment("pay_123")
        stripe = agent.create_stripe_checkout(bundle={"medium": 1})
        x402 = agent.create_x402_checkout(bundle={"medium": 1})

        assert isinstance(payments, HyperAgentPaymentsResponse)
        assert payments.items[0].id == "pay_123"
        assert payment.external_payment_id == "pi_123"
        assert isinstance(stripe, HyperAgentStripeCheckoutResponse)
        assert stripe.checkout_url == "https://checkout.stripe.test/session"
        assert isinstance(x402, HyperAgentX402CheckoutResponse)
        assert x402.plan_id == "2aiu"
    
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
