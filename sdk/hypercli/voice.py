from __future__ import annotations

"""Voice API client."""
import os
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator
import base64

if TYPE_CHECKING:
    from .http import HTTPClient
    from .voice_stream import VoiceChunk, VoiceSession


def _encode_reference_audio(ref_audio: bytes | str | Path) -> str:
    if isinstance(ref_audio, bytes):
        audio_bytes = ref_audio
    else:
        audio_bytes = Path(ref_audio).read_bytes()
    return base64.b64encode(audio_bytes).decode()


def _default_voice_timeout() -> float:
    raw_value = os.environ.get("HYPER_VOICE_TIMEOUT_SECONDS", "300").strip()
    try:
        return float(raw_value)
    except ValueError:
        return 300.0


def _resolve_voice_timeout(timeout: float | None) -> float:
    if timeout is not None:
        return float(timeout)
    return _default_voice_timeout()


class VoiceAPI:
    """Voice capability API wrapper."""
    DEFAULT_TIMEOUT = 300.0

    def __init__(self, http: "HTTPClient"):
        self._http = http

    def tts(
        self,
        text: str,
        *,
        voice: str = "serena",
        language: str = "auto",
        response_format: str = "mp3",
        timeout: float | None = None,
    ) -> bytes:
        return self._http.post_bytes(
            "/agents/voice/tts",
            json={
                "text": text,
                "voice": voice,
                "language": language,
                "response_format": response_format,
            },
            timeout=_resolve_voice_timeout(timeout),
        )

    def clone(
        self,
        text: str,
        *,
        ref_audio: bytes | str | Path,
        language: str = "auto",
        x_vector_only: bool = True,
        response_format: str = "mp3",
        timeout: float | None = None,
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
            timeout=_resolve_voice_timeout(timeout),
        )

    def design(
        self,
        text: str,
        *,
        description: str,
        language: str = "auto",
        response_format: str = "mp3",
        timeout: float | None = None,
    ) -> bytes:
        return self._http.post_bytes(
            "/agents/voice/design",
            json={
                "text": text,
                "instruct": description,
                "language": language,
                "response_format": response_format,
            },
            timeout=_resolve_voice_timeout(timeout),
        )

    def connect(self, *, timeout: float | None = None) -> "VoiceSession":
        """Create a streaming VoiceSession (open with 'async with' or open()).

        The session talks to /ws/voice and receives ordered audio chunks
        as the server renders them.
        """
        from .config import get_agents_ws_url_from_product_base
        from .voice_stream import VoiceSession

        ws_url = get_agents_ws_url_from_product_base(self._http.base_url)
        return VoiceSession(
            ws_url,
            self._http.api_key,
            timeout=_resolve_voice_timeout(timeout),
        )

    async def tts_stream(
        self,
        text: str,
        *,
        voice: str = "serena",
        language: str = "auto",
        response_format: str = "mp3",
        timeout: float | None = None,
    ) -> AsyncIterator["VoiceChunk"]:
        """One-shot streaming TTS: opens a session, speaks, closes."""
        async with self.connect(timeout=timeout) as session:
            async for chunk in session.speak(
                text,
                voice=voice,
                language=language,
                response_format=response_format,
                chunks=True,
            ):
                yield chunk
