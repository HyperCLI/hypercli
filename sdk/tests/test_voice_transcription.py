import json
from urllib.parse import parse_qs, urlsplit

import pytest
import websockets

from hypercli.voice_stream import VoiceStreamError
from hypercli.voice_transcription import VoiceTranscriptionSession


async def _start_server(handler):
    server = await websockets.serve(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    return server, f"ws://127.0.0.1:{port}"


@pytest.mark.asyncio
async def test_transcribe_sends_binary_audio_and_yields_events():
    received = []

    async def handler(ws):
        await ws.send(json.dumps({"event": "ready"}))
        async for raw in ws:
            received.append(raw)
            if isinstance(raw, str) and json.loads(raw).get("event") == "commit":
                await ws.send(json.dumps({"event": "ack"}))
                await ws.send(json.dumps({"event": "transcript.delta", "delta": "hello ", "text": "hello "}))
                await ws.send(json.dumps({"event": "transcript.final", "text": "hello world"}))

    server, url = await _start_server(handler)
    try:
        session = VoiceTranscriptionSession(url, "hyper_api_test")
        async with session:
            assert session.state == "ready"
            events = [event async for event in session.transcribe(b"\x01\x02\x03")]
            assert session.state == "ready"

        assert received[0] == b"\x01\x02\x03"
        assert json.loads(received[1]) == {"event": "commit"}
        assert [event["type"] for event in events] == ["ack", "transcript.delta", "transcript.final"]
        assert events[1]["delta"] == "hello "
        assert events[2]["text"] == "hello world"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_transcribe_sends_config_params_and_base64_audio():
    received = []
    request_query = {}

    async def handler(ws):
        request_query.update(parse_qs(urlsplit(ws.request.path).query))
        await ws.send(json.dumps({"type": "ready"}))
        async for raw in ws:
            received.append(raw)
            if json.loads(raw).get("event") == "commit":
                await ws.send(json.dumps({"type": "transcript.final", "text": "done"}))

    server, url = await _start_server(handler)
    try:
        session = VoiceTranscriptionSession(
            url,
            "hyper_api_test",
            language="en",
            model="tiny",
            response_format="json",
            prompt="names",
        )
        async with session:
            events = [event async for event in session.transcribe("AQID", base64=True)]

        assert request_query["token"] == ["hyper_api_test"]
        assert request_query["language"] == ["en"]
        assert request_query["model"] == ["tiny"]
        assert request_query["response_format"] == ["json"]
        assert request_query["prompt"] == ["names"]
        assert json.loads(received[0]) == {"event": "audio", "audio": "AQID"}
        assert json.loads(received[1]) == {"event": "commit"}
        assert [event["type"] for event in events] == ["transcript.final"]
        assert events[0]["text"] == "done"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_transcribe_raises_on_error_event():
    async def handler(ws):
        await ws.send(json.dumps({"event": "ready"}))
        async for raw in ws:
            if isinstance(raw, str) and json.loads(raw).get("event") == "commit":
                await ws.send(json.dumps({"event": "error", "code": "stt_failed", "detail": "decoder exploded"}))

    server, url = await _start_server(handler)
    try:
        async with VoiceTranscriptionSession(url, "hyper_api_test") as session:
            with pytest.raises(VoiceStreamError) as excinfo:
                async for _event in session.transcribe(b"\x00"):
                    pass
            assert excinfo.value.code == "stt_failed"
            assert excinfo.value.detail == "decoder exploded"
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_open_raises_on_error_before_ready():
    async def handler(ws):
        await ws.send(json.dumps({"event": "error", "code": "model_unavailable", "detail": "no such model"}))
        await ws.wait_closed()

    server, url = await _start_server(handler)
    try:
        with pytest.raises(VoiceStreamError, match="no such model"):
            await VoiceTranscriptionSession(url, "hyper_api_test").open()
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_events_requires_connection():
    session = VoiceTranscriptionSession("ws://127.0.0.1:1", "hyper_api_test")
    with pytest.raises(RuntimeError, match="not connected"):
        await session.events().__aiter__().__anext__()
