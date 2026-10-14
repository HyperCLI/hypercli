import pytest

from hypercli.native_permissions import native_unattended_choice


@pytest.mark.parametrize("runtime,value", [
    ("claude-code", "bypassPermissions"), ("codex", "agent-full-access"),
    ("opencode", "hypercli-unattended"),
])
def test_native_choices_require_advertisement(runtime, value):
    option = {"id": "mode", "type": "select", "options": [
        {"value": "plan"}, {"group": "native", "options": [{"value": value}]}]}
    assert native_unattended_choice(runtime, [option]) == ("mode", value)
    assert native_unattended_choice(runtime, []) is None
    assert native_unattended_choice(runtime, [{**option, "id": "agent"}]) is None
    assert native_unattended_choice("unknown", [option]) is None


def test_no_build_or_classifier_auto_fallback():
    option = {"id": "mode", "type": "select", "options": [{"value": "build"}, {"value": "auto"}]}
    for runtime in ("claude-code", "codex", "opencode"):
        assert native_unattended_choice(runtime, [option]) is None
