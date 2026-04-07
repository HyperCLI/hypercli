"""
Tests for HyperAgent SDK client
"""
import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from hypercli import HyperCLI
from hypercli.agent import (
    HyperAgent,
    HyperAgentPlan,
    HyperAgentCurrentPlan,
    HyperAgentSubscription,
    HyperAgentSubscriptionSummary,
    HyperAgentModel,
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
                "pooled_tpm_limit": 2000,
                "pooled_rpm_limit": 20,
                "pooled_tpd": 2000000,
                "slot_inventory": {"large": {"granted": 2, "used": 1, "available": 1}},
                "active_subscription_count": 1,
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
        assert summary.active_subscription_count == 1
        assert summary.active_subscriptions[0].plan_id == "large"


class TestHyperAgentClient:
    """Tests for HyperAgent client methods."""

    @pytest.fixture
    def mock_http(self):
        http = Mock()
        http._api_key = "test-key"
        http._session = Mock()
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
            "https://api.agents.hypercli.com/api/plans/current",
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
                }
            ]
        }
        mock_http._session.get.return_value.raise_for_status = Mock()

        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", agents_api_base_url="https://api.hypercli.com/agents")
        subscriptions = agent.subscriptions()

        assert len(subscriptions) == 1
        assert subscriptions[0].quantity == 2
        mock_http._session.get.assert_called_with(
            "https://api.agents.hypercli.com/api/subscriptions",
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
        mock_http._session.get.assert_called_with(
            "https://api.agents.hypercli.com/api/subscriptions/summary",
            headers={"Authorization": "Bearer sk-hyper-test"},
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
