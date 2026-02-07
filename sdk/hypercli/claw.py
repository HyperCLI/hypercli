"""
HyperClaw API client

Provides access to the HyperClaw inference API for AI agents.
Supports OpenAI-compatible chat completions with vision, function calling, etc.
"""
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from .http import HTTPClient


@dataclass
class ClawKey:
    """HyperClaw API key with subscription details."""
    key: str
    plan_id: str
    expires_at: datetime
    tpm_limit: int
    rpm_limit: int
    user_id: Optional[str] = None
    
    @classmethod
    def from_dict(cls, data: dict) -> "ClawKey":
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
class ClawPlan:
    """HyperClaw subscription plan."""
    id: str
    name: str
    price_usd: float
    tpm_limit: int
    rpm_limit: int
    
    @classmethod
    def from_dict(cls, data: dict) -> "ClawPlan":
        return cls(
            id=data["id"],
            name=data["name"],
            price_usd=data["price_usd"],
            tpm_limit=data["tpm_limit"],
            rpm_limit=data["rpm_limit"],
        )


@dataclass  
class ClawModel:
    """Available model on HyperClaw."""
    id: str
    name: str
    context_length: int
    supports_vision: bool = False
    supports_function_calling: bool = False
    supports_tool_choice: bool = False
    
    @classmethod
    def from_dict(cls, data: dict) -> "ClawModel":
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
class ChatMessage:
    """Chat message for completions."""
    role: str  # system, user, assistant
    content: Union[str, List[Dict]]  # string or content parts for vision
    
    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


@dataclass
class ChatCompletion:
    """Chat completion response."""
    id: str
    model: str
    message: str
    finish_reason: str
    usage: Dict[str, int]
    
    @classmethod
    def from_dict(cls, data: dict) -> "ChatCompletion":
        choice = data["choices"][0] if data.get("choices") else {}
        return cls(
            id=data.get("id", ""),
            model=data.get("model", ""),
            message=choice.get("message", {}).get("content", ""),
            finish_reason=choice.get("finish_reason", ""),
            usage=data.get("usage", {}),
        )


class Claw:
    """
    HyperClaw API Client
    
    Provides access to HyperClaw inference endpoints:
    - Chat completions (OpenAI-compatible)
    - Model listing
    - Key/subscription management
    
    Usage:
        from hypercli import HyperCLI
        
        client = HyperCLI()
        
        # List models
        models = client.claw.models()
        
        # Chat completion
        response = client.claw.chat(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello!"}]
        )
        print(response.message)
        
        # Vision
        response = client.claw.chat(
            model="kimi-k2.5",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "What's in this image?"},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
                ]
            }]
        )
    """
    
    # Default HyperClaw API base URL
    CLAW_API_BASE = "https://api.hyperclaw.app"
    DEV_API_BASE = "https://dev-api.hyperclaw.app"
    
    def __init__(self, http: HTTPClient, claw_api_key: str = None, dev: bool = False):
        """
        Initialize HyperClaw client.
        
        Args:
            http: HTTPClient for making requests
            claw_api_key: Optional separate API key for HyperClaw
            dev: Use dev API endpoint
        """
        self._http = http
        self._claw_api_key = claw_api_key
        self._api_base = self.DEV_API_BASE if dev else self.CLAW_API_BASE
    
    def _get_headers(self) -> dict:
        """Get headers for HyperClaw API requests."""
        key = self._claw_api_key or self._http._api_key
        return {"Authorization": f"Bearer {key}"}
    
    def models(self) -> List[ClawModel]:
        """
        List available models.
        
        Returns:
            List of ClawModel objects
        """
        r = self._http._session.get(
            f"{self._api_base}/v1/models",
            headers=self._get_headers(),
        )
        r.raise_for_status()
        data = r.json()
        return [ClawModel.from_dict(m) for m in data.get("data", [])]
    
    def chat(
        self,
        model: str,
        messages: List[Union[Dict, ChatMessage]],
        temperature: float = None,
        max_tokens: int = None,
        tools: List[Dict] = None,
        tool_choice: Union[str, Dict] = None,
        stream: bool = False,
        **kwargs
    ) -> ChatCompletion:
        """
        Create a chat completion.
        
        Args:
            model: Model ID (e.g., "kimi-k2.5")
            messages: List of message dicts or ChatMessage objects
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            tools: List of tool definitions for function calling
            tool_choice: Tool choice mode ("auto", "none", or specific tool)
            stream: Whether to stream the response (not yet implemented)
            **kwargs: Additional parameters passed to the API
            
        Returns:
            ChatCompletion object
        """
        # Convert ChatMessage objects to dicts
        msg_dicts = []
        for m in messages:
            if isinstance(m, ChatMessage):
                msg_dicts.append(m.to_dict())
            else:
                msg_dicts.append(m)
        
        payload = {
            "model": model,
            "messages": msg_dicts,
            **kwargs
        }
        
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
        if tool_choice:
            payload["tool_choice"] = tool_choice
        
        r = self._http._session.post(
            f"{self._api_base}/v1/chat/completions",
            headers=self._get_headers(),
            json=payload,
        )
        r.raise_for_status()
        return ChatCompletion.from_dict(r.json())
    
    def key_status(self) -> ClawKey:
        """
        Get current API key status and subscription details.
        
        Returns:
            ClawKey object with subscription info
        """
        r = self._http._session.get(
            f"{self._api_base}/api/keys/status",
            headers=self._get_headers(),
        )
        r.raise_for_status()
        return ClawKey.from_dict(r.json())
    
    def plans(self) -> List[ClawPlan]:
        """
        List available subscription plans.
        
        Returns:
            List of ClawPlan objects
        """
        r = self._http._session.get(
            f"{self._api_base}/api/plans",
            headers=self._get_headers(),
        )
        r.raise_for_status()
        data = r.json()
        return [ClawPlan.from_dict(p) for p in data.get("plans", [])]
    
    def discovery_health(self) -> Dict[str, Any]:
        """
        Get discovery service health status.
        
        Returns:
            Dict with hosts_total, hosts_healthy, fallbacks_active
        """
        r = self._http._session.get(
            f"{self._api_base}/discovery/health",
        )
        r.raise_for_status()
        return r.json()
    
    def discovery_config(self, api_key: str = None) -> Dict[str, Any]:
        """
        Get discovery service configuration (requires API key).
        
        Args:
            api_key: Backend API key (not the user's claw key)
            
        Returns:
            Dict with hosts, fallbacks, config
        """
        headers = {}
        if api_key:
            headers["X-API-KEY"] = api_key
        
        r = self._http._session.get(
            f"{self._api_base}/discovery/config",
            headers=headers,
        )
        r.raise_for_status()
        return r.json()
