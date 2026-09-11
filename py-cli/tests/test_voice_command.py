from pathlib import Path
import sys
import types

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_top_level_voice_transcribe_delegates_to_local_stt(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    called = {}

    def _fake_transcribe(audio_file, model, language, device, compute_type, json_output, output):
        called["audio_file"] = audio_file
        called["model"] = model
        called["language"] = language
        called["device"] = device
        called["compute_type"] = compute_type
        called["json_output"] = json_output
        called["output"] = output

    monkeypatch.setattr(voice, "_stt_transcribe", _fake_transcribe)

    audio_file = tmp_path / "voice.ogg"
    audio_file.write_bytes(b"ogg")
    output = tmp_path / "transcript.txt"

    result = runner.invoke(
        app,
        [
            "voice",
            "transcribe",
            str(audio_file),
            "--model",
            "turbo",
            "--device",
            "cpu",
            "--compute",
            "int8",
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 0, result.stdout
    assert called == {
        "audio_file": audio_file,
        "model": "turbo",
        "language": None,
        "device": "cpu",
        "compute_type": "int8",
        "json_output": False,
        "output": output,
    }


def test_top_level_voice_group_is_registered():
    result = runner.invoke(app, ["voice", "--help"])

    assert result.exit_code == 0
    assert "Voice commands" in result.stdout
    assert "transcribe" in result.stdout


def test_agent_transcribe_command_is_removed():
    result = runner.invoke(app, ["agent", "transcribe", "voice.ogg"])

    assert result.exit_code != 0
    assert "No such command 'transcribe'" in result.output


def test_agent_voice_transcribe_command_is_registered():
    result = runner.invoke(app, ["agent", "voice", "--help"])

    assert result.exit_code == 0
    assert "Voice commands" in result.stdout
    assert "transcribe" in result.stdout


def test_voice_tts_forwards_timeout(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    captured = {}

    def _fake_post_voice(endpoint, api_key, output, base_url=None, **kwargs):
        captured["endpoint"] = endpoint
        captured["api_key"] = api_key
        captured["output"] = output
        captured["base_url"] = base_url
        captured["kwargs"] = kwargs

    monkeypatch.setattr(voice, "_post_voice", _fake_post_voice)

    output = tmp_path / "tts.wav"
    result = runner.invoke(
        app,
        [
            "voice",
            "tts",
            "hello",
            "--format",
            "wav",
            "--output",
            str(output),
            "--timeout",
            "720",
        ],
    )

    assert result.exit_code == 0, result.stdout
    assert captured["endpoint"] == "tts"
    assert captured["kwargs"]["timeout"] == 720.0


def test_voice_clone_accepts_file_alias(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    captured = {}

    def _fake_stream_clone_voice(api_key, output, base_url=None, **kwargs):
        captured["api_key"] = api_key
        captured["output"] = output
        captured["base_url"] = base_url
        captured["kwargs"] = kwargs

    monkeypatch.setattr(voice, "_stream_clone_voice", _fake_stream_clone_voice)

    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"reference")
    output = tmp_path / "clone.mp3"
    result = runner.invoke(
        app,
        ["voice", "clone", "hello", "--file", str(ref), "--output", str(output)],
    )

    assert result.exit_code == 0, result.stdout
    assert captured["kwargs"]["ref_audio"] == ref


def test_voice_clone_rest_uses_assembled_audio(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    captured = {}

    def _fake_post_voice(endpoint, api_key, output, base_url=None, **kwargs):
        captured["endpoint"] = endpoint
        captured["api_key"] = api_key
        captured["output"] = output
        captured["base_url"] = base_url
        captured["kwargs"] = kwargs

    def _fake_stream_clone_voice(*args, **kwargs):
        raise AssertionError("clone should not stream with --rest")

    monkeypatch.setattr(voice, "_post_voice", _fake_post_voice)
    monkeypatch.setattr(voice, "_stream_clone_voice", _fake_stream_clone_voice)

    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"reference")
    output = tmp_path / "clone.mp3"
    result = runner.invoke(
        app,
        ["voice", "clone", "hello", "--file", str(ref), "--output", str(output), "--rest"],
    )

    assert result.exit_code == 0, result.stdout
    assert captured["endpoint"] == "clone"
    assert captured["kwargs"]["ref_audio"] == ref


def test_voice_clone_downloads_url(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    captured = {}

    def _fake_download(url):
        captured["url"] = url
        return b"downloaded-reference"

    def _fake_stream_clone_voice(api_key, output, base_url=None, **kwargs):
        captured["kwargs"] = kwargs

    monkeypatch.setattr(voice, "_download_audio", _fake_download)
    monkeypatch.setattr(voice, "_stream_clone_voice", _fake_stream_clone_voice)

    output = tmp_path / "clone.mp3"
    result = runner.invoke(
        app,
        ["voice", "clone", "hello", "--url", "https://example.test/ref.wav", "--output", str(output)],
    )

    assert result.exit_code == 0, result.stdout
    assert captured["url"] == "https://example.test/ref.wav"
    assert captured["kwargs"]["ref_audio"] == b"downloaded-reference"


def test_voice_clone_requires_exactly_one_source(monkeypatch, tmp_path):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"reference")

    result = runner.invoke(
        app,
        ["voice", "clone", "hello", "--file", str(ref), "--url", "https://example.test/ref.wav"],
    )

    assert result.exit_code == 1
    assert "exactly one" in result.stdout


def test_voice_clone_rejects_unsafe_urls_before_api_use(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")

    for url in [
        "http://example.test/ref.wav",
        "https://localhost/ref.wav",
        "https://127.0.0.1/ref.wav",
        "https://10.0.0.1/ref.wav",
        "https://169.254.1.1/ref.wav",
        "https://192.0.2.1/ref.wav",
        "https://[::1]/ref.wav",
        "https://[fe80::1]/ref.wav",
        "https://[2001:db8::1]/ref.wav",
    ]:
        result = runner.invoke(app, ["voice", "clone", "hello", "--url", url])
        assert result.exit_code == 1, url
        assert "Reference audio URL" in result.stdout, url


def test_voice_clone_rejects_oversized_local_reference(monkeypatch, tmp_path):
    import hypercli_cli.voice as voice

    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    ref = tmp_path / "large.wav"
    ref.write_bytes(b"0" * (voice.MAX_REFERENCE_AUDIO_BYTES + 1))

    result = runner.invoke(app, ["voice", "clone", "hello", "--file", str(ref)])

    assert result.exit_code == 1
    assert "exceeds" in result.stdout


def test_download_audio_uses_timeout_no_env_proxy_and_enforces_content_length(monkeypatch):
    import hypercli_cli.voice as voice

    calls = []

    class DummyResponse:
        status_code = 200
        headers = {"content-length": str(voice.MAX_REFERENCE_AUDIO_BYTES + 1)}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"x"

    def fake_stream(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return DummyResponse()

    fake_httpx = types.SimpleNamespace(stream=fake_stream, HTTPError=Exception)
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    try:
        voice._download_audio("https://example.test/ref.wav")
    except BaseException as exc:
        assert getattr(exc, "exit_code", getattr(exc, "code", None)) == 1
    else:
        raise AssertionError("expected _download_audio to exit")

    assert calls
    for method, url, kwargs in calls:
        assert method == "GET"
        assert url == "https://example.test/ref.wav"
        assert kwargs["timeout"] == voice.REFERENCE_AUDIO_TIMEOUT_SECONDS
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
