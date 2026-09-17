from __future__ import annotations

"""Voice transcription streaming session over /ws/voice/transcribe.

This is intentionally separate from VoiceSession: TTS sends text and
receives audio chunks, while transcription sends audio and receives
transcript events (ack, transcript.delta, transcript.final).

Usage:
    async with VoiceTranscriptionSession(ws_url, api_key) as session:
        async for event in session.transcribe(audio_bytes):
            handle(event)
"""
import asyncio
import base64
import json
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlencode

import websockets

from .voice_stream import VoiceStreamError


class VoiceTranscriptionSession:
    """Voice transcription streaming session over one WebSocket connection.

    States: closed -> ready -> streaming -> committed -> ready. Send audio
    with send_audio()/send_base64_audio(), finalize with commit(), and read
    events() until the transcript.final event.
    """

    def __init__(
        self,
        ws_url: str,
        credential: str,
        *,
        timeout: float = 300.0,
        language: Optional[str] = None,
        model: Optional[str] = None,
        response_format: Optional[str] = None,
        prompt: Optional[str] = None,
    ):
        self._ws_url = ws_url.rstrip("/")
        self._credential = credential
        self._timeout = float(timeout)
        self._params = {
            "language": language,
            "model": model,
            "response_format": response_format,
            "prompt": prompt,
        }
        self._ws = None
        self._pre_ready: list[dict[str, Any]] = []
        self.state = "closed"

    async def open(self) -> "VoiceTranscriptionSession":
        if self._ws is not None:
            return self
        query = {"token": self._credential}
        query.update(
            {key: value for key, value in self._params.items() if value is not None}
        )
        url = f"{self._ws_url}/voice/transcribe?{urlencode(query)}"
        self._ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Bearer {self._credential}"},
            ping_interval=20,
            ping_timeout=20,
            max_size=None,
        )
        try:
            await self._wait_for_ready()
        except Exception:
            await self.close()
            raise
        self.state = "ready"
        return self

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        self.state = "closed"
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def __aenter__(self) -> "VoiceTranscriptionSession":
        return await self.open()

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def send_audio(self, audio: bytes) -> None:
        """Send one binary audio frame."""
        if self._ws is None:
            raise RuntimeError("Session is not connected; call open() or use 'async with'")
        await self._ws.send(bytes(audio))
        self.state = "streaming"

    async def send_base64_audio(self, audio: str | bytes) -> None:
        """Send audio as a base64 JSON event; str input is sent as-is."""
        encoded = audio if isinstance(audio, str) else base64.b64encode(bytes(audio)).decode()
        await self._send_json({"event": "audio", "audio": encoded})
        self.state = "streaming"

    async def commit(self) -> None:
        """Signal end of audio; the server finalizes the transcript."""
        await self._send_json({"event": "commit"})
        self.state = "committed"

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """Yield transcript events until transcript.final or an error."""
        if self._ws is None or self.state == "closed":
            raise RuntimeError("Session is not connected; call open() or use 'async with'")
        deadline = asyncio.get_running_loop().time() + self._timeout
        while True:
            if self._pre_ready:
                message = self._pre_ready.pop(0)
            else:
                message = self._parse_message(await self._next_message(deadline))
            if message is None:
                continue
            msg_type = message.get("type")
            if msg_type == "error":
                raise VoiceStreamError(
                    str(message.get("code") or ""),
                    str(message.get("detail") or message.get("message") or ""),
                )
            if msg_type == "ack":
                yield message
                continue
            if msg_type == "transcript.delta":
                yield {
                    **message,
                    "type": "transcript.delta",
                    "text": str(message.get("text") or ""),
                    "delta": str(message.get("delta") or ""),
                }
                continue
            if msg_type == "transcript.final":
                yield {
                    **message,
                    "type": "transcript.final",
                    "text": str(message.get("text") or ""),
                }
                self.state = "ready" if self._ws is not None else "closed"
                return

    async def transcribe(
        self, audio: bytes | str, *, base64: bool = False
    ) -> AsyncIterator[dict[str, Any]]:
        """Send audio, commit, and yield transcript events until final.

        A str payload is treated as pre-encoded base64; bytes are sent as a
        binary frame unless base64=True wraps them in a JSON audio event.
        """
        if isinstance(audio, str) or base64:
            await self.send_base64_audio(audio)
        else:
            await self.send_audio(audio)
        await self.commit()
        async for event in self.events():
            yield event

    async def _send_json(self, message: dict[str, Any]) -> None:
        if self._ws is None:
            raise RuntimeError("Session is not connected; call open() or use 'async with'")
        body = {key: value for key, value in message.items() if value is not None}
        await self._ws.send(json.dumps(body))

    async def _wait_for_ready(self) -> None:
        deadline = asyncio.get_running_loop().time() + self._timeout
        while True:
            message = self._parse_message(await self._next_message(deadline))
            if message is None:
                continue
            if message.get("type") == "ready":
                return
            if message.get("type") == "error":
                raise VoiceStreamError(
                    str(message.get("code") or ""),
                    str(message.get("detail") or message.get("message") or ""),
                )
            # Parity with ts-sdk: messages arriving before ready are kept,
            # not dropped, so an early ack/delta is not lost.
            self._pre_ready.append(message)

    async def _next_message(self, deadline: float) -> str:
        if self._ws is None:
            raise RuntimeError("Session is not connected")
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise VoiceStreamError(
                "timeout",
                f"voice transcription stream timed out after {self._timeout:.0f}s",
            )
        try:
            raw = await asyncio.wait_for(self._ws.recv(), timeout=remaining)
        except websockets.ConnectionClosed as closed:
            raise VoiceStreamError(
                "closed",
                f"voice transcription stream closed: {closed.code} {closed.reason}".strip(),
            ) from closed
        if isinstance(raw, str):
            return raw
        try:
            return raw.decode()
        except UnicodeDecodeError as decode_error:
            raise VoiceStreamError("bad-frame", "non-UTF8 frame on the transcription stream") from decode_error

    @staticmethod
    def _parse_message(raw: str) -> Optional[dict[str, Any]]:
        try:
            message = json.loads(raw)
        except ValueError:
            return None
        if not isinstance(message, dict):
            return None
        if message.get("type") is None and isinstance(message.get("event"), str):
            message["type"] = message["event"]
        if message.get("detail") is None and isinstance(message.get("error"), str):
            message["detail"] = message["error"]
        return message
