from pathlib import Path

import httpx

from hypercli import HyperCLI
from hypercli.voice import VoiceAPI


class DummyVoiceHTTP:
    def __init__(self):
        self.calls = []

    def post_bytes(self, path, json=None, timeout=None):
        self.calls.append((path, json, timeout))
        return b"audio-bytes"


def test_voice_tts_posts_to_agents_voice_prefix():
    http = DummyVoiceHTTP()
    voice = VoiceAPI(http)

    audio = voice.tts("hello", voice="serena", language="english", response_format="wav")

    assert audio == b"audio-bytes"
    assert http.calls == [
        (
            "/voice/tts",
            {
                "text": "hello",
                "voice": "serena",
                "language": "english",
                "response_format": "wav",
            },
            VoiceAPI.DEFAULT_TIMEOUT,
        )
    ]


def test_hypercli_voice_uses_derived_agents_base(monkeypatch):
    calls = []

    def fake_request(method, url, headers=None, timeout=30.0, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        return httpx.Response(
            200,
            content=b"audio-bytes",
            request=httpx.Request(method.upper(), url),
        )

    monkeypatch.setattr("hypercli.http.request_with_retry", fake_request)

    client = HyperCLI(api_key="hyper_api_test", api_url="https://api.dev.hypercli.com")
    audio = client.voice.tts("hello")

    assert audio == b"audio-bytes"
    assert calls == [
        (
            "post",
            "https://api.dev.hypercli.com/agents/voice/tts",
            {
                "text": "hello",
                "voice": "serena",
                "language": "auto",
                "response_format": "mp3",
            },
        )
    ]


def test_voice_clone_base64_encodes_reference(tmp_path: Path):
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"reference-audio")

    http = DummyVoiceHTTP()
    voice = VoiceAPI(http)

    audio = voice.clone("clone me", ref_audio=ref, response_format="wav")

    assert audio == b"audio-bytes"
    path, payload, timeout = http.calls[0]
    assert path == "/voice/clone"
    assert payload["text"] == "clone me"
    assert payload["response_format"] == "wav"
    assert payload["ref_audio_base64"] == "cmVmZXJlbmNlLWF1ZGlv"
    assert timeout == VoiceAPI.DEFAULT_TIMEOUT


def test_voice_design_posts_description():
    http = DummyVoiceHTTP()
    voice = VoiceAPI(http)

    audio = voice.design("hello", description="warm narrator", response_format="wav")

    assert audio == b"audio-bytes"
    assert http.calls == [
        (
            "/voice/design",
            {
                "text": "hello",
                "instruct": "warm narrator",
                "language": "auto",
                "response_format": "wav",
            },
            VoiceAPI.DEFAULT_TIMEOUT,
        )
    ]


def test_voice_timeout_uses_env_default(monkeypatch):
    monkeypatch.setenv("HYPER_VOICE_TIMEOUT_SECONDS", "720")

    http = DummyVoiceHTTP()
    voice = VoiceAPI(http)

    voice.tts("hello")

    assert http.calls[0][2] == 720.0
