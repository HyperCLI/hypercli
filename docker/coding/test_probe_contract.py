"""Offline contract for the generated in-image probes (no image required).

The per-runtime image tests build Python probes as strings and run them inside
the image, so a name that no longer exists only fails in CI. Evaluate the
generators here without Docker and fail on a dangling name.
"""
from __future__ import annotations

import ast
import builtins
from pathlib import Path

import testlib


ROOT = Path(__file__).resolve().parent


def undefined_names(source: str) -> set[str]:
    """Names a probe reads without defining or importing (scope is lenient)."""
    tree = ast.parse(source)
    defined = set(dir(builtins))
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            defined.add(node.id)
            continue
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
            if isinstance(node, ast.ClassDef):
                continue
            args = node.args
        elif isinstance(node, ast.Lambda):
            args = node.args
        elif isinstance(node, ast.Import):
            for alias in node.names:
                defined.add((alias.asname or alias.name).split(".")[0])
            continue
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                defined.add(alias.asname or alias.name)
            continue
        elif isinstance(node, ast.ExceptHandler) and node.name:
            defined.add(node.name)
            continue
        else:
            continue
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            defined.add(arg.arg)
        for arg in (args.vararg, args.kwarg):
            if arg:
                defined.add(arg.arg)
    return {
        node.id for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in defined
    }


def check(source: str, label: str) -> None:
    compile(source, label, "exec")
    dangling = undefined_names(source)
    assert not dangling, f"{label} reads undefined names: {sorted(dangling)}"


def test_common_generated_probe_is_self_contained():
    check(testlib.COMMON_PROBE, "common generated probe")


def test_pi_generated_probe_is_self_contained():
    # Evaluate the actual generator without executing Docker or the ACP child.
    path = ROOT / "pi" / "test.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assignment = next(
        node for node in tree.body if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "probe" for target in node.targets)
    )
    probe = eval(compile(ast.Expression(assignment.value), str(path), "eval"), vars(testlib))
    check(probe, "pi generated probe")


def test_runtime_home_generated_probes_are_self_contained(monkeypatch):
    import test_runtime_home
    from types import SimpleNamespace

    probes = []

    def capture(*args, **kwargs):
        if "-c" in args:
            probes.append(args[args.index("-c") + 1])
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(test_runtime_home, "docker", capture)
    for runtime, (_, default, _, _) in test_runtime_home.ROOTS.items():
        monkeypatch.setattr(test_runtime_home, "image_config", lambda image: {
            "Env": [f"HYPER_RUNTIME_HOME={default}"], "Entrypoint": ["/entrypoint"],
        })
        test_runtime_home.assert_runtime_home(runtime, "offline-image")
    assert probes
    for index, probe in enumerate(probes):
        check(probe, f"runtime-home generated probe #{index}")


def test_maintainer_docs_do_not_restore_local_persona_contract():
    for path in (ROOT / "AGENTS.md", ROOT / "README.md"):
        text = path.read_text(encoding="utf-8")
        for command in ("hyper persona resolve", "hyper_persona_resolve"):
            assert command in text, f"{command} missing from {path}"
        for marker in ("~/.hypercli/USER.md", "~/.hypercli/SOUL.md", "HYPER_AGENT_ROLE"):
            assert marker not in text, f"retired marker {marker} returned in {path}"
