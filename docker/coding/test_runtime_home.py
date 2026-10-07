"""Offline runtime-root gate: python3 docker/coding/test_runtime_home.py RUNTIME IMAGE."""
from __future__ import annotations

import json
import sys

from testlib import docker, image_config


ROOTS = {
    "opencode": ("OPENCODE_CONFIG_DIR", "/home/node/.config/opencode", ["opencode.json"], "AGENTS.md"),
    "claude": ("CLAUDE_CONFIG_DIR", "/home/node/.claude", ["settings.json"], "CLAUDE.md"),
    "codex": ("CODEX_HOME", "/home/node/.codex", [], "AGENTS.md"),
    "goose": ("GOOSE_PATH_ROOT", "/home/node/.goose", ["config/config.yaml", "config/custom_providers/hypercli.json"], "config/.goosehints"),
    "kimi-code": ("KIMI_CODE_HOME", "/home/node/.kimi-code", ["tui.toml"], "AGENTS.md"),
    "pi": ("PI_CODING_AGENT_DIR", "/home/node/.pi/agent", [], "AGENTS.md"),
}


def assert_runtime_home(runtime: str, image: str) -> None:
    native, default, templates, instructions = ROOTS[runtime]
    other = "CLAUDE.md" if instructions == "AGENTS.md" else "AGENTS.md"
    config = image_config(image)
    baked = dict(item.split("=", 1) for item in config["Env"])
    assert baked["HYPER_RUNTIME_HOME"] == default
    assert native not in baked, "baked native defaults would shadow runtime HYPER_RUNTIME_HOME"
    entrypoint = config["Entrypoint"][-1]
    for user in ("node", "root"):
        for overrides, expected in (
            ({}, default),
            ({"HYPER_RUNTIME_HOME": "/tmp/runtime home"}, "/tmp/runtime home"),
            ({"HYPER_RUNTIME_HOME": "/tmp/unused", native: "/tmp/native home"}, "/tmp/native home"),
            ({"HYPER_RUNTIME_HOME": "/tmp/unused", native: default}, default),
        ):
            args = ["run", "--rm", "--network", "none", "--user", user]
            if runtime == "claude":
                args += ["-e", "HYPERCLI_RUNTIME_INFERENCE=hypercli"]
            for key, value in overrides.items():
                args += ["-e", f"{key}={value}"]
            probe = f"""
import os
from pathlib import Path
assert os.environ[{native!r}] == {expected!r}
assert Path({expected!r}).is_dir()
assert os.getcwd() == '/home/node'
seeded = Path({expected!r}, {instructions!r})
assert seeded.is_file() and not seeded.is_symlink()
body = seeded.read_text(encoding='utf-8')
assert '~/.hypercli/USER.md' in body and '~/.hypercli/SOUL.md' in body
assert not Path({expected!r}, {other!r}).exists()
for name in {templates!r}:
    assert Path({expected!r}, name).is_file(), name
"""
            docker(*args, image, "python3", "-c", probe)

        # Seed only inside a disposable container, then exercise the real setup
        # twice. Existing files, directories and dangling links must all survive.
        probe = f"""
import os, subprocess
from pathlib import Path
root = Path('/tmp/personal root')
root.mkdir()
os.environ['HYPER_RUNTIME_HOME'] = str(root)
os.environ['HYPERCLI_RUNTIME_INFERENCE'] = 'hypercli'
names = {templates!r} + [{instructions!r}, {other!r}]
for kind in ('file', 'link', 'directory'):
    for name in names:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if kind == 'file': path.write_text('personal sentinel')
        elif kind == 'link': path.symlink_to('/tmp/nonexistent-personal-target')
        else: path.mkdir()
    for _ in range(2):
        subprocess.run([{entrypoint!r}, 'true'], check=True)
    for name in names:
        path = root / name
        if kind == 'file':
            assert path.read_text() == 'personal sentinel'
            path.unlink()
        elif kind == 'link':
            assert path.is_symlink() and os.readlink(path) == '/tmp/nonexistent-personal-target'
            path.unlink()
        else:
            assert path.is_dir()
            path.rmdir()
"""
        docker("run", "--rm", "--network", "none", "--user", user,
               "--entrypoint", "python3", image, "-c", probe)
        empty = docker("run", "--rm", "--network", "none", "--user", user,
                       "-e", f"{native}=", image, "true", check=False)
        assert empty.returncode != 0, "an explicitly empty native root must fail, not redirect writes"
    print(json.dumps({"runtime": runtime, "runtime_home": "PASS"}))


if __name__ == "__main__":
    assert_runtime_home(*sys.argv[1:])
