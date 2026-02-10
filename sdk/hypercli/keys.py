"""API Keys management"""
from dataclasses import dataclass
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .http import HTTPClient


@dataclass
class ApiKey:
    key_id: str
    name: str
    api_key: Optional[str]  # Full key only on create
    api_key_preview: Optional[str]  # Masked key on list
    last4: Optional[str]
    is_active: bool
    created_at: str
    last_used_at: Optional[str]

    @classmethod
    def from_dict(cls, data: dict) -> "ApiKey":
        return cls(
            key_id=data.get("key_id", ""),
            name=data.get("name", ""),
            api_key=data.get("api_key"),
            api_key_preview=data.get("api_key_preview"),
            last4=data.get("last4"),
            is_active=data.get("is_active", True),
            created_at=data.get("created_at", ""),
            last_used_at=data.get("last_used_at"),
        )


class KeysAPI:
    """API Keys management"""

    def __init__(self, http: "HTTPClient"):
        self._http = http

    def create(self, name: str = "default") -> ApiKey:
        """Create a new API key"""
        data = self._http.post("/api/keys", json={"name": name})
        return ApiKey.from_dict(data)

    def list(self) -> List[ApiKey]:
        """List all API keys (masked)"""
        data = self._http.get("/api/keys")
        return [ApiKey.from_dict(k) for k in data]

    def get(self, key_id: str) -> ApiKey:
        """Get a specific API key (masked)"""
        data = self._http.get(f"/api/keys/{key_id}")
        return ApiKey.from_dict(data)

    def disable(self, key_id: str) -> dict:
        """Deactivate an API key (irreversible)"""
        return self._http.delete(f"/api/keys/{key_id}")

    def rename(self, key_id: str, name: str) -> ApiKey:
        """Rename an API key"""
        data = self._http.patch(f"/api/keys/{key_id}", json={"name": name})
        return ApiKey.from_dict(data)
