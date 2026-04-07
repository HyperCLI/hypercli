from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_flow_help_hides_voice_and_transcription_flows():
    result = runner.invoke(app, ["flow", "--help"])

    assert result.exit_code == 0
    assert "speaking-video" not in result.stdout
    assert "audio-to-text" not in result.stdout
    assert "text-to-speech" not in result.stdout
    assert "text-to-image" in result.stdout
    assert "image-to-video" in result.stdout
