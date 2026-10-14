"""OpenCode startup contract shared by the image and offline entrypoint tests."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
from typing import Callable


UNATTENDED_PROFILE = {
    "mode": "primary",
    "description": "Unattended execution with tools allowed",
    "permission": {"*": "allow"},
}


def assert_config_preserved(boot: Callable[[Path], None]) -> None:
    """Allow only the approved absent-profile addition; all other data is owned."""
    with tempfile.TemporaryDirectory() as directory:
        home = Path(directory)
        home.chmod(0o777)
        config = home / ".config/opencode/opencode.json"
        for _ in range(2):
            boot(home)
            generated = config.read_text(encoding="utf-8")
            assert "https://docs.hypercli.com/mcp" in generated
            assert json.loads(generated)["agent"]["hypercli-unattended"] == UNATTENDED_PROFILE
            config.unlink()

        for original in (
            {"userManaged": True},
            {"userManaged": True, "model": "native/model", "permission": {"bash": "ask"},
             "agent": {"custom": {"mode": "primary", "permission": {"edit": "deny"}}},
             "instructions": ["personal.md"], "nested": {"keep": [False, None, 3]}},
        ):
            config.write_text(json.dumps(original) + "\n", encoding="utf-8")
            boot(home)
            expected = {**original, "agent": {**original.get("agent", {}),
                                             "hypercli-unattended": UNATTENDED_PROFILE}}
            assert json.loads(config.read_bytes()) == expected
            provisioned = config.read_bytes()
            boot(home)
            assert config.read_bytes() == provisioned, "repeat boot rewrote existing native profile"

        for profile in ({"mode": "primary", "permission": {"*": "ask"}}, {"disable": True}):
            original = json.dumps({"userManaged": True, "agent": {"hypercli-unattended": profile}},
                                  indent=4).encode() + b"\n\n"
            config.write_bytes(original)
            boot(home)
            assert config.read_bytes() == original, "user-owned native profile was rewritten"

        for original in (b'{ // personal JSONC\n "userManaged": true }\n', b"personal non-JSON config\n"):
            config.write_bytes(original)
            boot(home)
            assert config.read_bytes() == original, "non-JSON configuration was rewritten"

        config.unlink()
        target = config.with_name("personal.json")
        original = b'{"userManaged": true}\n'
        target.write_bytes(original)
        config.symlink_to(target.name)
        boot(home)
        assert config.is_symlink() and config.readlink() == Path(target.name)
        assert target.read_bytes() == original, "symlink target was rewritten"
