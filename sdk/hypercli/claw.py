"""
HyperClaw API client

Provides access to the HyperClaw inference API for AI agents.
Uses the official OpenAI Python client for chat completions.
"""
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from .http import HTTPClient

# OpenAI client is optional - only needed for chat
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False


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


class Claw:
    """
    HyperClaw API Client
    
    Provides access to HyperClaw inference endpoints using the OpenAI Python client.
    
    Usage:
        from hypercli import HyperCLI
        
        client = HyperCLI(claw_api_key="sk-...")
        
        # Get OpenAI client for chat
        openai = client.claw.openai
        response = openai.chat.completions.create(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello!"}]
        )
        
        # Or use the convenience wrapper
        response = client.claw.chat(
            model="kimi-k2.5",
            messages=[{"role": "user", "content": "Hello!"}]
        )
        
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
        
        # Function calling
        response = client.claw.chat(
            model="kimi-k2.5",
            messages=[...],
            tools=[{"type": "function", "function": {...}}]
        )
    """
    
    # Default HyperClaw API base URL
    CLAW_API_BASE = "https://api.hyperclaw.app/v1"
    DEV_API_BASE = "https://dev-api.hyperclaw.app/v1"
    
    def __init__(self, http: HTTPClient, claw_api_key: str = None, dev: bool = False):
        """
        Initialize HyperClaw client.
        
        Args:
            http: HTTPClient for making requests (used for non-OpenAI endpoints)
            claw_api_key: Optional separate API key for HyperClaw
            dev: Use dev API endpoint
        """
        self._http = http
        self._api_key = claw_api_key or http.api_key
        self._dev = dev
        self._base_url = self.DEV_API_BASE if dev else self.CLAW_API_BASE
        self._openai = None
    
    @property
    def openai(self) -> "OpenAI":
        """
        Get OpenAI client configured for HyperClaw.
        
        Returns:
            OpenAI client instance
            
        Raises:
            ImportError: If openai package is not installed
        """
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
        **kwargs
    ):
        """
        Create a chat completion using the OpenAI client.
        
        Args:
            model: Model ID (e.g., "kimi-k2.5")
            messages: List of message dicts
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            tools: List of tool definitions for function calling
            tool_choice: Tool choice mode ("auto", "none", or specific tool)
            stream: Whether to stream the response
            **kwargs: Additional parameters passed to the API
            
        Returns:
            OpenAI ChatCompletion object
        """
        params = {
            "model": model,
            "messages": messages,
            **kwargs
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
    
    def models(self) -> List[ClawModel]:
        """
        List available models.
        
        Returns:
            List of ClawModel objects
        """
        response = self.openai.models.list()
        return [
            ClawModel.from_dict({
                "id": m.id,
                "name": getattr(m, "name", m.id),
                "context_length": getattr(m, "context_length", 0),
                "capabilities": getattr(m, "capabilities", {}),
            })
            for m in response.data
        ]
    
    def _api_base_without_v1(self) -> str:
        """Get API base URL without /v1 suffix."""
        return self._base_url.replace("/v1", "")
    
    def key_status(self) -> ClawKey:
        """
        Get current API key status and subscription details.
        
        Returns:
            ClawKey object with subscription info
        """
        r = self._http._session.get(
            f"{self._api_base_without_v1()}/api/keys/status",
            headers={"Authorization": f"Bearer {self._api_key}"},
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
            f"{self._api_base_without_v1()}/api/plans",
            headers={"Authorization": f"Bearer {self._api_key}"},
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
            f"{self._api_base_without_v1()}/discovery/health",
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
            f"{self._api_base_without_v1()}/discovery/config",
            headers=headers,
        )
        r.raise_for_status()
        return r.json()
