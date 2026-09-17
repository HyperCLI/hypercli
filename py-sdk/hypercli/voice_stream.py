from __future__ import annotations

"""Voice streaming session over the /ws/voice WebSocket.

The server owns text chunking; a session receives an ordered stream of
audio chunks. One request at a time: idle → rendering → receiving → idle.

Usage:
    async with client.voice.connect() as session:
        async for chunk in session.speak("Hello there.", voice="serena"):
            handle(chunk.audio)

    # one-shot convenience:
    async for chunk in client.voice.tts_stream("Hello there.", voice="serena"):
        handle(chunk.audio)
"""
import asyncio
import contextlib
import json
import uuid
from dataclasses import dataclass
from typing import AsyncIterator, Optional
from urllib.parse import urlencode

import websockets


@dataclass
class VoiceChunk:
    """One audio chunk delivered by the server, in order."""

    request_id: str
    index: int
    total: int
    audio: bytes
    final: bool


class VoiceStreamError(RuntimeError):
    """Server-reported error for a voice streaming request."""

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f"voice stream error {code}: {detail}")


class VoiceSession:
    """Long-lived voice streaming session over one WebSocket connection.

    States: closed → idle → rendering → receiving → idle. The session
    handles one request at a time; call speak() again once the previous
    iterator is exhausted.
    """

    def __init__(self, ws_url: str, api_key: str, *, timeout: float = 300.0):
        self._ws_url = ws_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._ws = None
        self.state = "closed"

    async def open(self) -> "VoiceSession":
        if self._ws is not None:
            return self
        # Send the credential as both a ?token= query param (historic contract)
        # and an Authorization Bearer header. urlencode keeps tokens with
        # URL-unsafe characters intact.
        url = f"{self._ws_url}/voice?{urlencode({'token': self._api_key})}"
        self._ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Bearer {self._api_key}"},
            ping_interval=20,
            ping_timeout=20,
            max_size=None,
        )
        self.state = "idle"
        return self

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        self.state = "closed"
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def __aenter__(self) -> "VoiceSession":
        return await self.open()

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def cancel(self, request_id: str) -> None:
        """Cancel an in-flight request server-side."""
        if self._ws is not None:
            await self._ws.send(json.dumps({"type": "cancel", "request_id": request_id}))

    async def speak(
        self,
        text: str,
        *,
        voice: str = "serena",
        language: str = "auto",
        response_format: str = "mp3",
        chunks: bool = True,
        request_id: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> AsyncIterator[VoiceChunk]:
        """Speak text with a preset voice; yield ordered VoiceChunk items.

        chunks=True streams each server-side split as its own chunk;
        chunks=False yields a single chunk holding the assembled file.
        """
        stream = self._speak(
            op="tts",
            body={"text": text, "voice": voice, "language": language},
            response_format=response_format,
            chunks=chunks,
            request_id=request_id,
            timeout=timeout,
        )
        async with contextlib.aclosing(stream) as chunks_iter:
            async for chunk in chunks_iter:
                yield chunk

    async def speak_clone(
        self,
        text: str,
        *,
        ref_audio,
        language: str = "auto",
        x_vector_only: bool = True,
        response_format: str = "mp3",
        chunks: bool = True,
        request_id: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> AsyncIterator[VoiceChunk]:
        """Speak text in a voice cloned from reference audio (bytes or path)."""
        from .voice import _encode_reference_audio

        stream = self._speak(
            op="clone",
            body={
                "text": text,
                "ref_audio_base64": _encode_reference_audio(ref_audio),
                "language": language,
                "x_vector_only": x_vector_only,
            },
            response_format=response_format,
            chunks=chunks,
            request_id=request_id,
            timeout=timeout,
        )
        async with contextlib.aclosing(stream) as chunks_iter:
            async for chunk in chunks_iter:
                yield chunk

    async def speak_design(
        self,
        text: str,
        *,
        description: str,
        language: str = "auto",
        response_format: str = "mp3",
        chunks: bool = True,
        request_id: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> AsyncIterator[VoiceChunk]:
        """Speak text in a voice designed from a natural-language description."""
        stream = self._speak(
            op="design",
            body={"text": text, "instruct": description, "language": language},
            response_format=response_format,
            chunks=chunks,
            request_id=request_id,
            timeout=timeout,
        )
        async with contextlib.aclosing(stream) as chunks_iter:
            async for chunk in chunks_iter:
                yield chunk

    async def _speak(
        self,
        *,
        op: str,
        body: dict,
        response_format: str,
        chunks: bool,
        request_id: Optional[str],
        timeout: Optional[float],
    ) -> AsyncIterator[VoiceChunk]:
        if self._ws is None or self.state == "closed":
            raise RuntimeError("Session is not connected; call open() or use 'async with'")
        if self.state != "idle":
            raise RuntimeError(f"Session is {self.state}; one request at a time")

        rid = request_id or uuid.uuid4().hex[:12]
        deadline = asyncio.get_running_loop().time() + (timeout or self._timeout)
        self.state = "rendering"
        finished = False
        try:
            await self._ws.send(json.dumps({
                "type": "speak",
                "request_id": rid,
                "op": op,
                "format": response_format,
                "chunks": chunks,
                **body,
            }))
            expected_seq = 0
            received_chunks = 0
            saw_final = False
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise TimeoutError(f"voice stream timed out after {timeout or self._timeout:.0f}s")
                raw = await asyncio.wait_for(self._ws.recv(), timeout=remaining)
                if isinstance(raw, bytes):
                    raise VoiceStreamError("protocol", "Unexpected binary frame without audio header")
                try:
                    message = json.loads(raw)
                except ValueError:
                    raise VoiceStreamError("protocol", "Expected JSON control frame")
                if message.get("request_id") not in ("", rid):
                    continue

                msg_type = message.get("type")
                if msg_type == "audio":
                    if saw_final:
                        raise VoiceStreamError("protocol", "Audio frame received after final chunk")
                    seq = int(message.get("seq", -1))
                    if seq != expected_seq:
                        raise VoiceStreamError("protocol", f"Unexpected audio sequence: expected {expected_seq}, got {seq}")
                    expected = int(message.get("bytes", -1))
                    if expected < 0:
                        raise VoiceStreamError("protocol", "Audio header has invalid byte length")
                    payload = await asyncio.wait_for(self._ws.recv(), timeout=max(0.0, deadline - asyncio.get_running_loop().time()))
                    if not isinstance(payload, bytes):
                        raise VoiceStreamError("protocol", "Expected binary audio payload after audio header")
                    if expected != len(payload):
                        raise VoiceStreamError("protocol", f"Audio payload length mismatch: expected {expected}, got {len(payload)}")
                    total = int(message.get("total", 1))
                    final = bool(message.get("final"))
                    if total < 1 or seq >= total:
                        raise VoiceStreamError("protocol", f"Invalid audio total {total} for sequence {seq}")
                    expected_seq += 1
                    received_chunks += 1
                    saw_final = final
                    self.state = "receiving"
                    yield VoiceChunk(
                        request_id=rid,
                        index=seq,
                        total=total,
                        audio=payload,
                        final=final,
                    )
                elif msg_type == "done":
                    total_done = message.get("total_chunks", message.get("chunks"))
                    if total_done is not None and int(total_done) != received_chunks:
                        raise VoiceStreamError("protocol", f"Done chunk count mismatch: expected {received_chunks}, got {total_done}")
                    if received_chunks and not saw_final:
                        raise VoiceStreamError("protocol", "Done received before final audio chunk")
                    finished = True
                    return
                elif msg_type == "error":
                    finished = True
                    raise VoiceStreamError(
                        str(message.get("code") or ""),
                        str(message.get("detail") or ""),
                    )
        finally:
            if not finished and self._ws is not None:
                # Consumer bailed early (or timed out) — cancel server-side.
                try:
                    await self.cancel(rid)
                except Exception:
                    pass
            self.state = "idle" if self._ws is not None else "closed"
