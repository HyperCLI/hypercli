from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_top_level_config_openclaw_delegates(monkeypatch):
    captured = {}

    def fake_config_cmd(format, key, base_url, placeholder_env, apply, dev):
        captured.update(
            {
                "format": format,
                "key": key,
                "base_url": base_url,
                "placeholder_env": placeholder_env,
                "apply": apply,
                "dev": dev,
            }
        )

    monkeypatch.setattr("hypercli_cli.cli.agent.config_cmd", fake_config_cmd)

    result = runner.invoke(
        app,
        [
            "config",
            "openclaw",
            "--apply",
            "--key",
            "hyper_api_test",
            "--base-url",
            "https://api.dev.hypercli.com",
            "--placeholder-env",
            "HYPER_API_KEY",
            "--dev",
        ],
    )

    assert result.exit_code == 0
    assert captured == {
        "format": "openclaw",
        "key": "hyper_api_test",
        "base_url": "https://api.dev.hypercli.com",
        "placeholder_env": "HYPER_API_KEY",
        "apply": True,
        "dev": True,
    }
