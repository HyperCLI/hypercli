from __future__ import annotations

"""Voice API client."""
from pathlib import Path
from typing import TYPE_CHECKING
import base64

if TYPE_CHECKING:
    from .http import HTTPClient


def _encode_reference_audio(ref_audio: bytes | str | Path) -> str:
    if isinstance(ref_audio, bytes):
        audio_bytes = ref_audio
    else:
        audio_bytes = Path(ref_audio).read_bytes()
    return base64.b64encode(audio_bytes).decode()


class VoiceAPI:
    """Voice capability API wrapper."""

    DEFAULT_TIMEOUT = 300.0

    def __init__(self, http: "HTTPClient"):
        self._http = http

    def tts(
        self,
        text: str,
        *,
        voice: str = "Chelsie",
        language: str = "auto",
        response_format: str = "mp3",
        timeout: float = DEFAULT_TIMEOUT,
    ) -> bytes:
        return self._http.post_bytes(
            "/agents/voice/tts",
            json={
                "text": text,
                "voice": voice,
                "language": language,
                "response_format": response_format,
            },
            timeout=timeout,
        )

    def clone(
        self,
        text: str,
        *,
        ref_audio: bytes | str | Path,
        language: str = "auto",
        x_vector_only: bool = True,
        response_format: str = "mp3",
        timeout: float = DEFAULT_TIMEOUT,
    ) -> bytes:
        return self._http.post_bytes(
            "/agents/voice/clone",
            json={
                "text": text,
                "ref_audio_base64": _encode_reference_audio(ref_audio),
                "language": language,
                "x_vector_only": x_vector_only,
                "response_format": response_format,
            },
            timeout=timeout,
        )

    def design(
        self,
        text: str,
        *,
        description: str,
        language: str = "auto",
        response_format: str = "mp3",
        timeout: float = DEFAULT_TIMEOUT,
    ) -> bytes:
        return self._http.post_bytes(
            "/agents/voice/design",
            json={
                "text": text,
                "instruct": description,
                "language": language,
                "response_format": response_format,
            },
            timeout=timeout,
        )
