"""Live Backend persona discovery and resolution. No artifacts or disk cache."""
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .http import HTTPClient


def canonical_soul(meta: dict | None) -> str:
    """Read stored canonical SOUL, never the effective selected persona."""
    meta = meta or {}
    value = meta.get("soul") if "soul" in meta else (meta.get("ui") or {}).get("soul")
    return value if isinstance(value, str) else ""


class PersonasAPI:
    def __init__(self, http: "HTTPClient"):
        self._http = http

    def list(self) -> dict:
        """Read the current authorized catalog."""
        return self._http.get("/personas")

    def get(self, persona_id: str) -> dict:
        """Read exact service-assembled INDEX.md; never concatenate locally."""
        if len(persona_id) > 64 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", persona_id):
            raise ValueError("persona id must be an exact lowercase hyphenated identifier")
        return self._http.get(f"/personas/{persona_id}")

    def resolve(self, agent_id: str | None = None) -> dict:
        """Resolve current USER + effective SOUL. Backend owns authorization,
        bound-Agent inference and canonical precedence; failures never fall back.
        """
        if agent_id is not None and not agent_id.strip():
            raise ValueError("agent_id must not be blank")
        return self._http.get("/personas/resolve", params=None if agent_id is None else {"agent_id": agent_id})
