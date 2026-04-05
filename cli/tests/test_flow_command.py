from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


def test_flow_get_uses_renders_api(monkeypatch):
    class FakeRenders:
        def get(self, render_id):
            assert render_id == "render-123"
            return SimpleNamespace(
                render_id=render_id,
                state="completed",
                template="video_wan2_2_14B_i2v",
                render_type="comfyui",
                result_url="https://example.com/out.mp4",
            )

    class FakeClient:
        renders = FakeRenders()

    monkeypatch.setattr("hypercli_cli.flow.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["flow", "get", "render-123"])

    assert result.exit_code == 0
    assert "render-123" in result.stdout
    assert "completed" in result.stdout


def test_flow_status_uses_renders_api(monkeypatch):
    class FakeRenders:
        def status(self, render_id):
            assert render_id == "render-123"
            return SimpleNamespace(
                render_id=render_id,
                state="running",
                progress=0.5,
            )

    class FakeClient:
        renders = FakeRenders()

    monkeypatch.setattr("hypercli_cli.flow.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["flow", "status", "render-123"])

    assert result.exit_code == 0
    assert "render-123" in result.stdout
    assert "running" in result.stdout


def test_flow_list_uses_renders_api(monkeypatch):
    class FakeRenders:
        def list(self, state=None, template=None, type=None):
            assert state == "completed"
            assert template is None
            assert type is None
            return [
                SimpleNamespace(
                    render_id="render-123",
                    state="completed",
                    template="video_wan2_2_14B_i2v",
                    render_type="comfyui",
                    created_at="2026-04-05T14:50:30Z",
                )
            ]

    class FakeClient:
        renders = FakeRenders()

    monkeypatch.setattr("hypercli_cli.flow.HyperCLI", lambda: FakeClient())

    result = runner.invoke(app, ["flow", "list", "--state", "completed"])

    assert result.exit_code == 0
    assert "render-123" in result.stdout
    assert "completed" in result.stdout
