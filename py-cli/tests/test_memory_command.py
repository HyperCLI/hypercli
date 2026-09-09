from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_memory_command_is_registered():
    result = runner.invoke(app, ["memory", "--help"])

    assert result.exit_code == 0
    assert "Prepare OpenClaw memory artifacts" in result.stdout
    assert "import" in result.stdout
