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


@pytest.mark.asyncio
async def test_speak_clone_sends_op_and_reference_audio():
    received = []

    async def handler(ws):
        message = json.loads(await ws.recv())
        received.append(message)
        rid = message["request_id"]
        await ws.send(json.dumps({"type": "start", "request_id": rid, "format": "mp3"}))
        await ws.send(_chunk_message(rid, 0, 1, b"cloned-audio"))
        await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 1, "elapsed": 0.1}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            chunks = [
                c async for c in session.speak_clone("clone me", ref_audio=b"reference-audio")
            ]
        assert chunks[0].audio == b"cloned-audio"
        speak = received[0]
        assert speak["op"] == "clone"
        assert speak["ref_audio_base64"] == base64.b64encode(b"reference-audio").decode()
        assert speak["x_vector_only"] is True
        assert "voice" not in speak
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_speak_design_sends_op_and_instruct():
    received = []

    async def handler(ws):
        message = json.loads(await ws.recv())
        received.append(message)
        rid = message["request_id"]
        await ws.send(_chunk_message(rid, 0, 1, b"designed-audio"))
        await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 1, "elapsed": 0.1}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            chunks = [
                c async for c in session.speak_design("design me", description="a warm narrator")
            ]
        assert chunks[0].audio == b"designed-audio"
        speak = received[0]
        assert speak["op"] == "design"
        assert speak["instruct"] == "a warm narrator"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_speak_tts_sends_op_tts():
    received = []

    async def handler(ws):
        message = json.loads(await ws.recv())
        received.append(message)
        rid = message["request_id"]
        await ws.send(_chunk_message(rid, 0, 1, b"tts-audio"))
        await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 1, "elapsed": 0.1}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        async with VoiceSession(url, "hyper_api_test") as session:
            [c async for c in session.speak("hi", voice="serena")]
        assert received[0]["op"] == "tts"
        assert received[0]["voice"] == "serena"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_clone_and_design_stream_conveniences(monkeypatch):
    from types import SimpleNamespace

    from hypercli.voice import VoiceAPI

    received = []

    async def handler(ws):
        async for raw in ws:
            message = json.loads(raw)
            received.append(message)
            if message["type"] != "speak":
                continue
            rid = message["request_id"]
            await ws.send(_chunk_message(rid, 0, 1, f"audio-{message['op']}".encode()))
            await ws.send(json.dumps({"type": "done", "request_id": rid, "total_chunks": 1, "elapsed": 0.1}))

    server, url = await _start_server(handler)
    try:
        api = VoiceAPI(SimpleNamespace(base_url="https://api.hypercli.com", api_key="hyper_api_test"))
        monkeypatch.setattr(api, "connect", lambda *, timeout=None: VoiceSession(url, "hyper_api_test"))

        clone_chunks = [c async for c in api.clone_stream("clone me", ref_audio=b"ref")]
        assert clone_chunks[0].audio == b"audio-clone"

        design_chunks = [c async for c in api.design_stream("design me", description="a narrator")]
        assert design_chunks[0].audio == b"audio-design"

        ops = [m["op"] for m in received if m["type"] == "speak"]
        assert ops == ["clone", "design"]
        assert all(m["chunks"] is True for m in received if m["type"] == "speak")
    finally:
        server.close()
        await server.wait_closed()
