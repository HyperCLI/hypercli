"""
Tests for HyperAgent SDK client
"""
import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from hypercli.agent import HyperAgent, HyperAgentKey, HyperAgentPlan, HyperAgentModel


class TestHyperAgentDataclasses:
    """Tests for HyperAgent dataclasses."""
    
    def test_agent_key_from_dict(self):
        data = {
            "key": "sk-hyper-test-123",
            "plan_id": "5aiu",
            "expires_at": "2026-03-07T12:00:00Z",
            "tpm_limit": 250000,
            "rpm_limit": 5000,
            "user_id": "user-123"
        }
        key = HyperAgentKey.from_dict(data)
        assert key.key == "sk-hyper-test-123"
        assert key.plan_id == "5aiu"
        assert key.tpm_limit == 250000
        assert key.rpm_limit == 5000
    
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
    
    def test_openai_client_creation(self, mock_http):
        """Test that OpenAI client is created with correct config."""
        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", dev=True)
        
        # Access openai property to trigger creation
        with patch('hypercli.agent.OpenAI') as mock_openai:
            mock_openai.return_value = MagicMock()
            client = agent.openai
            
            mock_openai.assert_called_once_with(
                api_key="sk-hyper-test",
                base_url="https://api.dev.hypercli.com/v1",
            )
    
    def test_chat_uses_openai_client(self, mock_http):
        """Test that chat method uses OpenAI client."""
        agent = HyperAgent(mock_http, agent_api_key="sk-hyper-test", dev=True)
        
        with patch('hypercli.agent.OpenAI') as mock_openai:
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
        api_key = os.getenv("HYPERCLAW_API_KEY")
        if not api_key:
            pytest.skip("HYPERCLAW_API_KEY not set")
        
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
