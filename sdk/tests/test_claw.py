"""
Tests for HyperClaw SDK client
"""
import pytest
import os
from unittest.mock import Mock, patch
from hypercli.claw import Claw, ClawKey, ClawPlan, ClawModel, ChatMessage, ChatCompletion


class TestClawDataclasses:
    """Tests for Claw dataclasses."""
    
    def test_claw_key_from_dict(self):
        data = {
            "key": "sk-test-123",
            "plan_id": "5aiu",
            "expires_at": "2026-03-07T12:00:00Z",
            "tpm_limit": 250000,
            "rpm_limit": 5000,
            "user_id": "user-123"
        }
        key = ClawKey.from_dict(data)
        assert key.key == "sk-test-123"
        assert key.plan_id == "5aiu"
        assert key.tpm_limit == 250000
        assert key.rpm_limit == 5000
    
    def test_claw_plan_from_dict(self):
        data = {
            "id": "5aiu",
            "name": "5 Agents",
            "price_usd": 3.0,
            "tpm_limit": 250000,
            "rpm_limit": 5000
        }
        plan = ClawPlan.from_dict(data)
        assert plan.id == "5aiu"
        assert plan.price_usd == 3.0
    
    def test_claw_model_from_dict(self):
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
        model = ClawModel.from_dict(data)
        assert model.id == "kimi-k2.5"
        assert model.context_length == 262144
        assert model.supports_vision is True
        assert model.supports_function_calling is True
    
    def test_chat_message_to_dict(self):
        msg = ChatMessage(role="user", content="Hello!")
        assert msg.to_dict() == {"role": "user", "content": "Hello!"}
    
    def test_chat_completion_from_dict(self):
        data = {
            "id": "chatcmpl-123",
            "model": "kimi-k2.5",
            "choices": [{
                "message": {"content": "Hi there!"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}
        }
        completion = ChatCompletion.from_dict(data)
        assert completion.id == "chatcmpl-123"
        assert completion.message == "Hi there!"
        assert completion.finish_reason == "stop"


class TestClawClient:
    """Tests for Claw client methods."""
    
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
        
        claw = Claw(mock_http, dev=True)
        result = claw.discovery_health()
        
        assert result["status"] == "ok"
        assert result["hosts_total"] == 1
        mock_http._session.get.assert_called_once()
    
    def test_chat_payload(self, mock_http):
        mock_http._session.post.return_value.json.return_value = {
            "id": "chatcmpl-123",
            "model": "kimi-k2.5",
            "choices": [{"message": {"content": "Hi!"}, "finish_reason": "stop"}],
            "usage": {}
        }
        mock_http._session.post.return_value.raise_for_status = Mock()
        
        claw = Claw(mock_http, dev=True)
        result = claw.chat(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100
        )
        
        # Verify the call was made with correct payload
        call_args = mock_http._session.post.call_args
        payload = call_args.kwargs["json"]
        assert payload["model"] == "kimi-k2.5"
        assert payload["messages"] == [{"role": "user", "content": "Hello"}]
        assert payload["temperature"] == 0.7
        assert payload["max_tokens"] == 100


class TestClawIntegration:
    """Integration tests for Claw client (require running service)."""
    
    @pytest.fixture
    def claw_client(self):
        """Create a Claw client for integration tests."""
        api_key = os.getenv("HYPERCLAW_API_KEY")
        if not api_key:
            pytest.skip("HYPERCLAW_API_KEY not set")
        
        # Create minimal mock http for standalone claw
        http = Mock()
        http._api_key = api_key
        import requests
        http._session = requests.Session()
        
        return Claw(http, dev=True)
    
    @pytest.mark.integration
    def test_discovery_health_integration(self, claw_client):
        result = claw_client.discovery_health()
        assert "status" in result
        assert result["status"] == "ok"
    
    @pytest.mark.integration
    def test_models_integration(self, claw_client):
        models = claw_client.models()
        # Should return a list (may be empty if no models configured)
        assert isinstance(models, list)
