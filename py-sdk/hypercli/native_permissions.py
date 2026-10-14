"""Verified native unattended choices, never a permission callback responder."""

# claude-agent-acp 0.59.0, codex-acp 1.1.7, OpenCode 1.18.35 plus image profile.
_UNATTENDED_MODES = {
    "claude-code": "bypassPermissions",
    "codex": "agent-full-access",
    "opencode": "hypercli-unattended",
}


def native_unattended_choice(runtime, options):
    """Return an advertised (config_id, value), or None for unsupported policy."""
    value = _UNATTENDED_MODES.get(runtime)
    if value is None:
        return None
    for option in options:
        if option.get("id") != "mode" or option.get("type") != "select":
            continue
        choices = [choice for entry in option["options"]
                   for choice in (entry["options"] if "group" in entry else [entry])]
        if any(choice["value"] == value for choice in choices):
            return option["id"], value
    return None
