"""OpenAI-compatible models API"""
from dataclasses import dataclass
from typing import TYPE_CHECKING, List

if TYPE_CHECKING:
    from .http import HTTPClient


@dataclass
class Model:
    id: str
    object: str
    owned_by: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Model":
        return cls(
            id=data.get("id", ""),
            object=data.get("object", "model"),
            owned_by=data.get("owned_by"),
        )


class ModelsAPI:
    """OpenAI-compatible models API"""

    def __init__(self, http: "HTTPClient"):
        self._http = http

    def list(self) -> List[Model]:
        payload = self._http.get("/v1/models")
        data = payload.get("data") if isinstance(payload, dict) else payload
        return [Model.from_dict(item) for item in (data or [])]
