from typer.testing import CliRunner

from hypercli_cli.cli import app


runner = CliRunner()


class _FakeKey:
    key_id = "key-123"
    name = "demo"
    api_key = "hyper_api_test"
    tags = ["*:*"]


def test_keys_create_all_expands_to_global_scope(monkeypatch):
    import hypercli_cli.keys as keys

    captured = {}

    class _FakeKeys:
        def create(self, *, name, tags=None):
            captured["name"] = name
            captured["tags"] = tags
            return _FakeKey()

    class _FakeClient:
        keys = _FakeKeys()

    monkeypatch.setattr(keys, "_get_client", lambda: _FakeClient())

    result = runner.invoke(app, ["keys", "create", "--name", "demo", "--all"])

    assert result.exit_code == 0, result.stdout
    assert captured == {"name": "demo", "tags": ["*:*"]}


def test_keys_create_rejects_all_and_tag_together():
    result = runner.invoke(app, ["keys", "create", "--all", "--tag", "team=dev"])

    assert result.exit_code != 0
    assert "Use either --all or --tag, not both" in result.stdout
