"""Tests for seed_instructions.sh: seed the native instructions when absent.

The seeder is seed-if-absent only. Whatever exists at the target is left as it
is; nothing is hashed, compared, or replaced.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "seed_instructions.sh"
TEMPLATE = HERE / "AGENTS.md.template"

BASH = shutil.which("bash")

requires_bash = pytest.mark.skipif(BASH is None, reason="requires bash")


def run_seed(*args, env=None):
    return subprocess.run(
        [str(BASH), str(SCRIPT), *map(str, args)],
        capture_output=True,
        text=True,
        env=env,
    )


@requires_bash
def test_missing_target_is_seeded(tmp_path):
    target = tmp_path / "AGENTS.md"
    result = run_seed(TEMPLATE, target)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == TEMPLATE.read_bytes()
    assert result.stdout == f"[hermes-agent] seeded native instructions at {target}\n"


@requires_bash
@pytest.mark.parametrize(
    "existing",
    [
        # An older platform template is an existing file like any other.
        "older-platform-template",
        "current-template",
        "owner-edited",
    ],
)
def test_existing_target_is_never_hashed_compared_or_replaced(tmp_path, existing):
    script = SCRIPT.read_text()
    assert "sha256sum" not in script
    assert "RETIRED" not in script
    heading = TEMPLATE.read_text().splitlines()[0]
    target = tmp_path / "AGENTS.md"
    if existing == "older-platform-template":
        before = f"{heading}\n\nAn older platform template.\n"
    elif existing == "current-template":
        before = TEMPLATE.read_text()
    else:
        before = "# my own rules\nleave me alone\n"
    target.write_text(before)

    result = run_seed(TEMPLATE, target)

    assert result.returncode == 0, result.stderr
    assert target.read_text() == before
    assert result.stdout == ""


@requires_bash
@pytest.mark.parametrize("dangling", [False, True])
def test_symlink_target_is_untouched(tmp_path, dangling):
    real = tmp_path / "real-agents.md"
    real.write_bytes(b"# pointed at\n")
    target = tmp_path / "AGENTS.md"
    target.symlink_to(tmp_path / "absent" if dangling else real)
    result = run_seed(TEMPLATE, target)
    assert result.returncode == 0, result.stderr
    assert target.is_symlink()
    assert not (tmp_path / "absent").exists()
    assert real.read_bytes() == b"# pointed at\n"


@requires_bash
def test_directory_target_is_untouched(tmp_path):
    target = tmp_path / "AGENTS.md"
    target.mkdir()
    inner = target / "keep.txt"
    inner.write_bytes(b"keep me\n")
    result = run_seed(TEMPLATE, target)
    assert result.returncode == 0, result.stderr
    assert target.is_dir()
    assert inner.read_bytes() == b"keep me\n"


@requires_bash
def test_seed_needs_only_coreutils(tmp_path):
    # No hashing tool is required: a PATH without sha256sum still seeds.
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for tool in ("cp",):
        tool_path = shutil.which(tool)
        assert tool_path, f"{tool} not found on PATH"
        (bindir / tool).symlink_to(tool_path)
    env = os.environ.copy()
    env["PATH"] = str(bindir)

    target = tmp_path / "AGENTS.md"
    result = run_seed(TEMPLATE, target, env=env)

    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == TEMPLATE.read_bytes()


@requires_bash
def test_missing_template_seeds_nothing(tmp_path):
    target = tmp_path / "AGENTS.md"
    result = run_seed(tmp_path / "absent-template.md", target)
    assert result.returncode == 0, result.stderr
    assert not target.exists()


@requires_bash
def test_wrong_argument_count_is_a_usage_error(tmp_path):
    result = run_seed(TEMPLATE)
    assert result.returncode == 2
    assert "usage: seed_instructions.sh TEMPLATE TARGET" in result.stderr
    assert not (tmp_path / "AGENTS.md").exists()
