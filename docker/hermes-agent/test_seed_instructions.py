"""Tests for seed_instructions.sh: refresh retired Hermes AGENTS.md templates."""

import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "seed_instructions.sh"
TEMPLATE = HERE / "AGENTS.md.template"
RETIRED_DIR = HERE / "testdata" / "retired-templates"

BASH = shutil.which("bash")
HASH_RE = re.compile(r"^[ \t]*([0-9a-f]{64})[ \t]*$", re.MULTILINE)


def run_seed(target, env=None):
    return subprocess.run(
        [str(BASH), str(SCRIPT), str(TEMPLATE), str(target)],
        capture_output=True,
        text=True,
        env=env,
    )


def assert_no_seed_temp(directory):
    leftovers = sorted(p.name for p in Path(directory).glob("*.seed.*"))
    assert leftovers == [], f"temp files left behind: {leftovers}"


def retired_hashes():
    return set(HASH_RE.findall(SCRIPT.read_text()))


def test_retired_templates_are_refreshed(tmp_path):
    template_bytes = TEMPLATE.read_bytes()
    for retired_file in sorted(RETIRED_DIR.glob("*.md")):
        target = tmp_path / "AGENTS.md"
        target.write_bytes(retired_file.read_bytes())
        result = run_seed(target)
        assert result.returncode == 0, result.stderr
        assert target.read_bytes() == template_bytes
        assert target.stat().st_mode & 0o777 == 0o644
        assert f"[hermes-agent] refreshed retired platform instructions at {target}" in result.stdout
        assert_no_seed_temp(tmp_path)
        target.unlink()


def test_missing_target_is_seeded(tmp_path):
    target = tmp_path / "AGENTS.md"
    result = run_seed(target)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == TEMPLATE.read_bytes()
    assert f"[hermes-agent] seeded native instructions at {target}" in result.stdout
    assert_no_seed_temp(tmp_path)


def test_owner_edited_file_is_untouched(tmp_path):
    target = tmp_path / "AGENTS.md"
    target.write_bytes(b"# my own rules\nleave me alone\n")
    result = run_seed(target)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == b"# my own rules\nleave me alone\n"
    assert f"[hermes-agent] preserving existing native instructions at {target}" in result.stdout
    assert_no_seed_temp(tmp_path)


def test_current_template_is_untouched(tmp_path):
    current_sha = hashlib.sha256(TEMPLATE.read_bytes()).hexdigest()
    assert current_sha not in retired_hashes()
    target = tmp_path / "AGENTS.md"
    target.write_bytes(TEMPLATE.read_bytes())
    result = run_seed(target)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == TEMPLATE.read_bytes()
    assert f"[hermes-agent] preserving existing native instructions at {target}" in result.stdout
    assert_no_seed_temp(tmp_path)


def test_symlink_target_is_untouched(tmp_path):
    real = tmp_path / "real-agents.md"
    real.write_bytes(b"# pointed at\n")
    target = tmp_path / "AGENTS.md"
    target.symlink_to(real)
    result = run_seed(target)
    assert result.returncode == 0, result.stderr
    assert target.is_symlink()
    assert os.readlink(target) == str(real)
    assert real.read_bytes() == b"# pointed at\n"
    assert_no_seed_temp(tmp_path)


def test_directory_target_is_untouched(tmp_path):
    target = tmp_path / "AGENTS.md"
    target.mkdir()
    inner = target / "keep.txt"
    inner.write_bytes(b"keep me\n")
    result = run_seed(target)
    assert result.returncode == 0, result.stderr
    assert target.is_dir()
    assert inner.read_bytes() == b"keep me\n"
    assert_no_seed_temp(tmp_path)


def test_symlinked_parent_blocks_refresh_but_not_seed(tmp_path):
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    linked_dir = tmp_path / "linked"
    linked_dir.symlink_to(real_dir)
    retired = (RETIRED_DIR / "c9e56394052091c77e8d7d4c418a082b826d2da74de464c73b4c733d3c02b066.md").read_bytes()
    (real_dir / "AGENTS.md").write_bytes(retired)
    result = run_seed(linked_dir / "AGENTS.md")
    assert result.returncode == 0, result.stderr
    assert (real_dir / "AGENTS.md").read_bytes() == retired
    (real_dir / "AGENTS.md").unlink()
    result = run_seed(linked_dir / "AGENTS.md")
    assert result.returncode == 0, result.stderr
    assert (real_dir / "AGENTS.md").read_bytes() == TEMPLATE.read_bytes()
    assert_no_seed_temp(real_dir)


def test_missing_sha256sum_fails_closed(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for tool in ("dirname", "cp", "mv", "rm"):
        tool_path = shutil.which(tool)
        assert tool_path, f"{tool} not found on PATH"
        (bindir / tool).symlink_to(tool_path)
    assert not (bindir / "sha256sum").exists()
    env = os.environ.copy()
    env["PATH"] = str(bindir)

    target = tmp_path / "AGENTS.md"
    target.write_bytes((RETIRED_DIR / "c9e56394052091c77e8d7d4c418a082b826d2da74de464c73b4c733d3c02b066.md").read_bytes())

    result = run_seed(target, env=env)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == (RETIRED_DIR / "c9e56394052091c77e8d7d4c418a082b826d2da74de464c73b4c733d3c02b066.md").read_bytes()
    assert_no_seed_temp(tmp_path)


def test_retired_hash_list_matches_testdata():
    parsed = retired_hashes()
    testdata = {p.stem for p in RETIRED_DIR.glob("*.md")}
    assert parsed == testdata
    for p in RETIRED_DIR.glob("*.md"):
        assert hashlib.sha256(p.read_bytes()).hexdigest() == p.stem
