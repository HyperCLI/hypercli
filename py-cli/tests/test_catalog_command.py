from types import SimpleNamespace
from unittest.mock import Mock
from typer.testing import CliRunner
from hypercli_cli import flow


def test_submit_uses_discovered_types_without_rewriting_names(monkeypatch):
    renders = SimpleNamespace(
        catalog=lambda: {"qwen21": {"templates": {"sample": {"inputs": {"prompt": {"type": "STRING"}}}}}},
        submit=Mock(return_value={"id": "render-1"}),
    )
    monkeypatch.setattr(flow, "get_client", lambda: SimpleNamespace(renders=renders))
    monkeypatch.setattr(flow, "output", lambda *_args: None)
    result = CliRunner().invoke(flow.app, ["submit", "qwen21", "sample", "--input", "prompt=42", "--input", "seed=0", "--input", "switch=false", "--media", "images.image_5_1=owned"])
    assert result.exit_code == 0, result.output
    renders.submit.assert_called_once_with("qwen21", "sample", {"prompt": "42", "seed": 0, "switch": False, "images.image_5_1": {"file_id": "owned"}})
