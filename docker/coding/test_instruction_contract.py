"""Static contract for Backend-backed instruction probes (no image required)."""
from __future__ import annotations

from pathlib import Path
import inspect

import testlib


ROOT = Path(__file__).resolve().parent


def test_generated_probe_requires_backend_commands_and_rejects_retired_persona_files():
    for command in ("hyper user", "hyper soul", "hyper role"):
        assert command in testlib.COMMON_PROBE
        assert command in testlib.INSTRUCTION_PERSONA_REFS
    assert "instructions_retired_markers_absent" in testlib.COMMON_PROBE
    for marker in (
        "~/.hypercli/USER.md",
        "~/.hypercli/SOUL.md",
        "HYPER_AGENT_ROLE",
        "/opt/hypercli/roles",
        "/opt/hypercli-identities",
    ):
        assert marker in testlib.INSTRUCTION_RETIRED_MARKERS
    persistence_source = inspect.getsource(testlib.assert_workspace_persistence)
    assert "INSTRUCTION_RETIRED_MARKERS" in persistence_source
    assert "not in seeded_text" in persistence_source


def test_runtime_specific_probes_use_shared_contract_constants():
    for path in (ROOT / "test_runtime_home.py", ROOT / "pi" / "test.py"):
        text = path.read_text(encoding="utf-8")
        assert "INSTRUCTION_PERSONA_REFS" in text
        assert "INSTRUCTION_RETIRED_MARKERS" in text
        assert "~/.hypercli/USER.md' in" not in text
        assert "~/.hypercli/SOUL.md' in" not in text


def test_maintainer_docs_do_not_restore_local_persona_contract():
    for path in (ROOT / "AGENTS.md", ROOT / "README.md"):
        text = path.read_text(encoding="utf-8")
        for command in ("hyper user", "hyper soul", "hyper role"):
            assert command in text, f"{command} missing from {path}"
        for marker in ("~/.hypercli/USER.md", "~/.hypercli/SOUL.md", "HYPER_AGENT_ROLE"):
            assert marker not in text, f"retired marker {marker} returned in {path}"
