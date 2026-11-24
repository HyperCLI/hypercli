"""Offline contract for the generated in-image probes (no image required).

The per-runtime image tests build Python probes as strings and run them inside
the image, so a name that no longer exists only fails in CI. Evaluate the
generators here without Docker and fail on a dangling name.

Standard library only, like the image tests it guards, so CI runs it with the
plain interpreter: ``python3 -m unittest test_probe_contract`` from here.
"""
from __future__ import annotations

import ast
import builtins
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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


def accepted_keywords(source: str) -> dict[str, set[str]]:
    """Keyword names each top-level function in `source` accepts ("**" = any)."""
    tree = ast.parse(source)
    return {
        node.name: {arg.arg for arg in [*node.args.args, *node.args.kwonlyargs]}
        | ({"**"} if node.args.kwarg else set())
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def unsupported_keywords(tree: ast.AST, definitions: dict[str, set[str]]) -> list[str]:
    """`line callee keyword` for every call passing a keyword the callee lacks."""
    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        function = node.func
        if isinstance(function, ast.Name):
            callee = function.id
        elif (
            isinstance(function, ast.Attribute)
            and isinstance(function.value, ast.Name)
            and function.value.id == "testlib"
        ):
            callee = function.attr
        else:
            continue
        accepted = definitions.get(callee)
        if accepted is None:
            continue
        bad += [
            f"{node.lineno} {callee} {keyword.arg}"
            for keyword in node.keywords
            if keyword.arg is not None and keyword.arg not in accepted and "**" not in accepted
        ]
    return bad


def scanned_sources() -> list[tuple[str, str]]:
    """`(label, source)` of every file whose calls into testlib must be valid.

    Every top-level test file is scanned, testlib itself included: it calls
    its own helpers, and the last regression was one of those calls.
    """
    return [
        *[(path.name, path.read_text(encoding="utf-8")) for path in sorted(ROOT.glob("*.py"))],
        *[
            (f"{path.parent.name}/test.py", path.read_text(encoding="utf-8"))
            for path in sorted(ROOT.glob("*/test.py"))
        ],
    ]


class ProbeContractTests(unittest.TestCase):
    def test_common_generated_probe_is_self_contained(self):
        check(testlib.COMMON_PROBE, "common generated probe")

    def test_pi_generated_probe_is_self_contained(self):
        # Evaluate the actual generator without executing Docker or the ACP child.
        path = ROOT / "pi" / "test.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        assignment = next(
            node for node in tree.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "probe" for target in node.targets)
        )
        probe = eval(compile(ast.Expression(assignment.value), str(path), "eval"), vars(testlib))
        check(probe, "pi generated probe")

    def test_runtime_home_generated_probes_are_self_contained(self):
        import test_runtime_home

        probes = []

        def capture(*args, **kwargs):
            if "-c" in args:
                probes.append(args[args.index("-c") + 1])
            return SimpleNamespace(returncode=1)

        with patch.object(test_runtime_home, "docker", capture):
            for runtime, (_, default, _, _) in test_runtime_home.ROOTS.items():
                with patch.object(test_runtime_home, "image_config", lambda image: {
                    "Env": [f"HYPER_RUNTIME_HOME={default}"], "Entrypoint": ["/entrypoint"],
                }):
                    test_runtime_home.assert_runtime_home(runtime, "offline-image")
        assert probes
        for index, probe in enumerate(probes):
            check(probe, f"runtime-home generated probe #{index}")

    def test_runtime_tests_call_testlib_with_accepted_keywords(self):
        """A keyword the callee no longer accepts only fails inside the built image."""
        definitions = accepted_keywords(Path(testlib.__file__).read_text(encoding="utf-8"))
        definitions |= accepted_keywords((ROOT / "test_runtime_home.py").read_text(encoding="utf-8"))
        assert {"assert_common_contract", "assert_workspace_persistence", "assert_runtime_home"} <= set(definitions)
        bad = [
            f"{label}: {found}"
            for label, source in scanned_sources()
            if (found := unsupported_keywords(ast.parse(source), definitions))
        ]
        assert not bad, bad

    def test_the_guard_scans_testlib_itself_and_every_runtime(self):
        labels = {label for label, _ in scanned_sources()}
        assert {
            "testlib.py", "test_runtime_home.py", "test_auth_contract.py",
            "buzz-agent/test.py", "opencode/test.py", "pi/test.py",
        } <= labels

    def test_keyword_guard_catches_the_regression_it_exists_for(self):
        definitions = accepted_keywords(
            "def assert_workspace_persistence(image): pass\n"
            "def f(a, **keywords): pass\n"
            "def g(image, /): pass\n"
        )
        stale = "assert_workspace_persistence(image, runtime=runtime)"
        assert unsupported_keywords(ast.parse(stale), definitions) == [
            "1 assert_workspace_persistence runtime"
        ]
        valid = "assert_workspace_persistence(image)\nf(1, anything=2)\ng(1)\nh(1, x=2)"
        assert unsupported_keywords(ast.parse(valid), definitions) == []
        # A positional-only parameter is not a keyword, and testlib.g(...) is a call.
        assert unsupported_keywords(ast.parse("g(image=1)"), definitions) == ["1 g image"]
        assert unsupported_keywords(ast.parse("testlib.g(image=1)"), definitions) == ["1 g image"]


if __name__ == "__main__":
    unittest.main()
