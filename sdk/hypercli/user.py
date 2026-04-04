"""User API"""
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .http import HTTPClient


@dataclass
class User:
    user_id: str
    email: str | None
    name: str | None
    is_active: bool
    created_at: str

    @classmethod
    def from_dict(cls, data: dict) -> "User":
        return cls(
            user_id=data.get("user_id", ""),
            email=data.get("email"),
            name=data.get("name"),
            is_active=data.get("is_active", True),
            created_at=data.get("created_at", ""),
        )


@dataclass
class AuthMe:
    user_id: str
    orchestra_user_id: str | None
    team_id: str
    plan_id: str
    email: str | None
    auth_type: str
    capabilities: list[str]
    key_id: str | None
    key_name: str | None

    @classmethod
    def from_dict(cls, data: dict) -> "AuthMe":
        return cls(
            user_id=data.get("user_id", ""),
            orchestra_user_id=data.get("orchestra_user_id"),
            team_id=data.get("team_id", ""),
            plan_id=data.get("plan_id", ""),
            email=data.get("email"),
            auth_type=data.get("auth_type", ""),
            capabilities=list(data.get("capabilities") or []),
            key_id=data.get("key_id"),
            key_name=data.get("key_name"),
        )


class UserAPI:
    """User API wrapper"""

    def __init__(self, http: "HTTPClient", auth_http: Optional["HTTPClient"] = None):
        self._http = http
        self._auth_http = auth_http or http

    def get(self) -> User:
        """Get current user info"""
        data = self._http.get("/api/user")
        return User.from_dict(data)

    def auth_me(self) -> AuthMe:
        """Resolve the current auth context, including key capabilities."""
        data = self._auth_http.get("/auth/me")
        return AuthMe.from_dict(data)
