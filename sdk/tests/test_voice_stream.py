import asyncio
import base64
import json

import pytest
import websockets

from hypercli.voice_stream import VoiceChunk, VoiceSession, VoiceStreamError


def _chunk_message(request_id: str, index: int, total: int, payload: bytes) -> str:
    return json.dumps({
        "type": "chunk",
        "request_id": request_id,
        "index": index,
        "total": total,
        "audio_b64": base64.b64encode(payload).decode("ascii"),
        "final": index == total - 1,
    })


async def _start_server(handler):
    server = await websockets.serve(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    return server, f"ws://127.0.0.1:{port}"


@pytest.mark.asyncio
async def test_speak_yields_ordered_chunks_then_done():
    received = []

    async def handler(ws):
        raw = await ws.recv()
        message = json.loads(raw)
        received.append(message)
        rid = message["request_id"]
        await ws.send(json.dumps({"type": "start", "request_id": rid, "format": "mp3"}))
        await ws.send(_chunk_message(rid, 0, 2, b"first"))
        await ws.send(_chunk_message(rid, 1, 2, b"second"))
        await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 2, "elapsed": 0.1}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        session = VoiceSession(url, "hyper_api_test")
        async with session:
            assert session.state == "idle"
            chunks = []
            async for chunk in session.speak("Hello. World.", voice="serena"):
                assert isinstance(chunk, VoiceChunk)
                assert session.state == "receiving"
                chunks.append(chunk)
            assert session.state == "idle"

        assert [c.audio for c in chunks] == [b"first", b"second"]
        assert [c.index for c in chunks] == [0, 1]
        assert chunks[-1].final is True
        assert received[0]["type"] == "speak"
        assert received[0]["text"] == "Hello. World."
        assert received[0]["voice"] == "serena"
        assert received[0]["chunks"] is True
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_speak_raises_on_server_error():
    async def handler(ws):
        message = json.loads(await ws.recv())
        rid = message["request_id"]
        await ws.send(json.dumps({"type": "start", "request_id": rid, "format": "mp3"}))
        await ws.send(json.dumps({
            "type": "error",
            "request_id": rid,
            "code": "400",
            "detail": "Unsupported speakers",
        }))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            with pytest.raises(VoiceStreamError) as excinfo:
                async for _ in session.speak("hello", voice="not-a-voice"):
                    pass
            assert excinfo.value.code == "400"
            assert session.state == "idle"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_speak_requires_idle_state():
    async def handler(ws):
        message = json.loads(await ws.recv())
        rid = message["request_id"]
        await ws.send(_chunk_message(rid, 0, 2, b"first"))
        # Never send done — session stays mid-request.
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            iterator = session.speak("hello").__aiter__()
            await iterator.__anext__()
            assert session.state == "receiving"

            with pytest.raises(RuntimeError, match="one request at a time"):
                await session.speak("again").__aiter__().__anext__()

            await iterator.aclose()
            assert session.state == "idle"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_early_break_sends_cancel():
    received = []
    cancel_seen = asyncio.Event()

    async def handler(ws):
        async for raw in ws:
            message = json.loads(raw)
            received.append(message)
            if message["type"] == "speak":
                rid = message["request_id"]
                await ws.send(_chunk_message(rid, 0, 3, b"first"))
            elif message["type"] == "cancel":
                cancel_seen.set()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            async for _chunk in session.speak("hello"):
                break
            await asyncio.wait_for(cancel_seen.wait(), timeout=2)
        cancels = [m for m in received if m["type"] == "cancel"]
        assert len(cancels) == 1
        assert cancels[0]["request_id"] == received[0]["request_id"]
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_speak_requires_connection():
    session = VoiceSession("ws://127.0.0.1:1", "hyper_api_test")
    with pytest.raises(RuntimeError, match="not connected"):
        await session.speak("hello").__aiter__().__anext__()


@pytest.mark.asyncio
async def test_chunks_false_single_assembled_chunk():
    async def handler(ws):
        message = json.loads(await ws.recv())
        assert message["chunks"] is False
        rid = message["request_id"]
        await ws.send(json.dumps({"type": "start", "request_id": rid, "format": "mp3"}))
        await ws.send(_chunk_message(rid, 0, 1, b"assembled-file"))
        await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 1, "elapsed": 0.1}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            chunks = [c async for c in session.speak("hello", chunks=False)]
        assert len(chunks) == 1
        assert chunks[0].audio == b"assembled-file"
        assert chunks[0].final is True
    finally:
        server.close()
        await server.wait_closed()
