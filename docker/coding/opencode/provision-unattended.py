"""Add the native unattended agent only when its name is not user-owned.

Run at image startup, before OpenCode reads its configuration. Existing fields,
including an explicitly disabled/modified profile, always win.
"""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile


def provision(config: Path) -> bool:
    if config.is_symlink() or not config.is_file():
        return False
    try:
        original = config.read_bytes()
        data = json.loads(original)
    except (ValueError, OSError):
        return False  # JSONC/user-managed formats remain native-owned.
    if not isinstance(data, dict):
        return False
    agents = data.get("agent", {})
    if not isinstance(agents, dict) or "hypercli-unattended" in agents:
        return False
    data["agent"] = {**agents, "hypercli-unattended": {
        "mode": "primary",
        "description": "Unattended execution with tools allowed",
        "permission": {"*": "allow"},
    }}
    mode = stat.S_IMODE(config.stat().st_mode)
    fd, temporary = tempfile.mkstemp(prefix=".opencode-", dir=config.parent)
    try:
        with os.fdopen(fd, "w") as output:
            os.fchmod(output.fileno(), mode)
            json.dump(data, output, indent=2)
            output.write("\n")
        # Do not replace a concurrent user edit or a newly installed symlink.
        if config.is_symlink() or config.read_bytes() != original:
            return False
        os.replace(temporary, config)
        return True
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    provision(Path(sys.argv[1]))
