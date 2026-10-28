"""Static contract for Backend-backed instruction probes (no image required)."""
from __future__ import annotations

from pathlib import Path
import ast
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
        "/opt/hypercli-identities",
    ):
        assert marker in testlib.INSTRUCTION_RETIRED_MARKERS
    persistence_source = inspect.getsource(testlib.assert_workspace_persistence)
    assert "INSTRUCTION_RETIRED_MARKERS" in persistence_source
    assert "not in seeded_text" in persistence_source


def test_pi_generated_probe_compiles():
    # Evaluate the actual generator without executing Docker or the ACP child.
    path = ROOT / "pi" / "test.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assignment = next(
        node for node in tree.body if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "probe" for target in node.targets)
    )
    probe = eval(compile(ast.Expression(assignment.value), str(path), "eval"), vars(testlib))
    compile(probe, "pi generated probe", "exec")
    for command in testlib.INSTRUCTION_PERSONA_REFS:
        assert command in probe


def test_runtime_home_generated_probes_compile(monkeypatch):
    import test_runtime_home
    from types import SimpleNamespace

    probes = []

    def capture(*args, **kwargs):
        if "-c" in args:
            probe = args[args.index("-c") + 1]
            compile(probe, "runtime-home generated probe", "exec")
            probes.append(probe)
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(test_runtime_home, "docker", capture)
    for runtime, (_, default, _, _) in test_runtime_home.ROOTS.items():
        monkeypatch.setattr(test_runtime_home, "image_config", lambda image: {
            "Env": [f"HYPER_RUNTIME_HOME={default}"], "Entrypoint": ["/entrypoint"],
        })
        test_runtime_home.assert_runtime_home(runtime, "offline-image")
    assert probes


def test_common_generated_probe_compiles():
    compile(testlib.COMMON_PROBE, "common generated probe", "exec")


def test_maintainer_docs_do_not_restore_local_persona_contract():
    for path in (ROOT / "AGENTS.md", ROOT / "README.md"):
        text = path.read_text(encoding="utf-8")
        for command in ("hyper user", "hyper soul", "hyper role"):
            assert command in text, f"{command} missing from {path}"
        for marker in ("~/.hypercli/USER.md", "~/.hypercli/SOUL.md", "HYPER_AGENT_ROLE"):
            assert marker not in text, f"retired marker {marker} returned in {path}"
