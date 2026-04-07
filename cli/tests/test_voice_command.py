from pathlib import Path

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
    assert "No such command 'transcribe'" in result.stdout
