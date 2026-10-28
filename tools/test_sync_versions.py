"""Offline release-contract tests, including real standalone checkout projections."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import sync_versions as versions


class VersionContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.map = json.loads((versions.PUBLIC / "version-ownership.json").read_text())
        paths = {"versions.json", *self.map["manifests"]}
        paths.update(rule["path"] for rule in self.map["projections"])
        for name in paths:
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(versions.PUBLIC / name, dest)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def sync(self, version=None, check=True):
        with contextlib.redirect_stdout(io.StringIO()):
            return versions.synchronize(self.root, self.map, version or versions.app_version(self.root), check)

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*")
                if p.is_file() and ".git" not in p.parts}

    def test_standalone_idempotence_and_next_release(self):
        self.assertEqual(self.sync(), [])
        before = self.snapshot()
        legacy_py_cli = (self.root / "py-cli/pyproject.toml").read_text()
        self.assertEqual(self.sync(check=False), [])
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.sync("0.9.1", check=False), [])
        self.assertEqual(self.sync("0.9.1"), [])
        # Runtime identity and package manifests change together without parent files.
        for name in ("ts-sdk", "ts-cli"):
            package = json.loads((self.root / name / "package.json").read_text())
            self.assertEqual(package["version"], "0.9.1")
            self.assertIn("'0.9.1'", (self.root / name / "src/version.ts").read_text())
        self.assertEqual((self.root / "py-cli/pyproject.toml").read_text(), legacy_py_cli)
        self.assertIn('version = "0.9.1"', (self.root / "Cargo.toml").read_text())
        self.assertIn('"@agentclientprotocol/sdk": "1.5.0"', (self.root / "ts-sdk/package.json").read_text())

    def test_check_detects_drift_without_mutation(self):
        for name, old, new in (
            ("ts-cli/package.json", '"0.8.0"', '"2026.10.6"'),
            ("ts-cli/src/version.ts", "'0.8.0'", "'0.1.0'"),
            ("ts-cli/package-lock.json", '"0.8.0"', '"0.7.0"'),
            ("Cargo.lock", 'name = "hypercli-sdk"\nversion = "0.8.0"', 'name = "hypercli-sdk"\nversion = "0.1.0"'),
        ):
            with self.subTest(name=name):
                path = self.root / name
                original = path.read_text()
                # Read the actual baseline version so future releases need no test edits.
                old = old.replace("0.8.0", versions.app_version(self.root))
                self.assertIn(old, original)
                path.write_text(original.replace(old, new, 1))
                before = self.snapshot()
                self.assertIn(f"version drift: {name}", self.sync())
                self.assertEqual(before, self.snapshot())
                self.assertEqual(self.sync(check=False), [])
                self.assertEqual(path.read_text(), original)

    def test_new_manifest_requires_explicit_ownership(self):
        path = self.root / "new-cli/package.json"
        path.parent.mkdir()
        path.write_text('{"name":"new-cli","version":"0.8.0"}')
        self.assertIn("unclassified manifest: new-cli/package.json", self.sync())

    def test_inherited_cargo_version_cannot_become_independent(self):
        path = self.root / "rs-sdk/Cargo.toml"
        path.write_text(path.read_text().replace("version.workspace = true", 'version = "0.8.0"'))
        self.assertIn("app manifest must inherit workspace version: rs-sdk/Cargo.toml", self.sync())

    def test_removed_package_does_not_require_staging_to_update_ownership(self):
        name = "compat/Cargo.toml"
        path = self.root / name
        path.parent.mkdir()
        path.write_text('[package]\nname = "compat"\nversion = "0.8.0"\n')
        subprocess.run(["git", "add", name], cwd=self.root, check=True)
        path.unlink()
        self.assertEqual(versions.inventory(self.root, self.map), [])
        self.map["manifests"][name] = "excluded: test compatibility package"
        self.assertIn(f"missing classified manifest: {name}",
                      versions.inventory(self.root, self.map))

    def test_invalid_authority_and_calendar_version_are_rejected(self):
        for data in ({"appVersion": "2026.10.6"}, {"appVersion": "0.8.0", "packageVersions": {}},
                     {"appVersion": "0.8.0-dev"}, {"appVersion": 8}):
            (self.root / "versions.json").write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                versions.app_version(self.root)

    def test_cargo_lock_names_must_cover_local_appversion_packages(self):
        rule = next(r for r in self.map["projections"] if r["kind"] == "cargo-lock")
        rule["names"] = []
        before = self.snapshot()
        errors = self.sync()
        self.assertIn('Cargo.lock: local package "hypercli-sdk" tracks appVersion '
                      "but is not in the cargo-lock names list", errors)
        self.assertEqual(self.sync(check=False), errors)
        self.assertEqual(before, self.snapshot())

    def test_missing_selector_fails_closed(self):
        path = self.root / "py-sdk/hypercli/__init__.py"
        path.write_text(path.read_text().replace("__version__ =", "version ="))
        before = self.snapshot()
        self.assertTrue(any("expected 1 matches" in e for e in self.sync(check=False)))
        self.assertEqual(before, self.snapshot())


class ParentCheckoutContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.sdk = self.parent / "hypercli"
        self.sdk.mkdir()
        for root in (self.parent, self.sdk):
            subprocess.run(["git", "init", "-q", str(root)], check=True)
        (self.sdk / "versions.json").write_text('{"appVersion":"0.8.3"}\n')
        (self.sdk / "package.json").write_text('{"version":"0.8.3"}\n')
        (self.sdk / "version-ownership.json").write_text(json.dumps({
            "manifests": {"package.json": "app"},
            "projections": [{"path": "package.json", "kind": "json", "keys": [["version"]]}],
        }))
        (self.parent / "version-ownership.json").write_text('{"manifests":{},"projections":[]}')
        subprocess.run(["git", "add", "."], cwd=self.sdk, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "commit", "-qm", "fixture"], cwd=self.sdk, check=True)
        self.sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.sdk, text=True).strip()
        self.record(self.sha)

    def record(self, sha):
        subprocess.run(["git", "update-index", "--add", "--cacheinfo", f"160000,{sha},hypercli"],
                       cwd=self.parent, check=True)

    def invoke(self, check=False):
        argv = ["sync_versions.py", "--parent", str(self.parent)] + (["--check"] if check else [])
        output = io.StringIO()
        with patch.object(versions, "PUBLIC", self.sdk), patch("sys.argv", argv), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            return versions.main(), output.getvalue()

    def test_stale_checkout_fails_before_reading_authority_or_writing(self):
        expected = "1" * 40
        self.record(expected)
        # Even a broken authority must not obscure the checkout mismatch.
        (self.sdk / "versions.json").write_text("not json")
        before = {p: p.read_bytes() for p in self.parent.rglob("*")
                  if p.is_file() and ".git" not in p.parts}
        for check in (False, True):
            with self.subTest(check=check):
                code, message = self.invoke(check)
                self.assertEqual(code, 1)
                self.assertIn("SDK checkout mismatch", message)
                self.assertIn(expected, message)
                self.assertIn(self.sha, message)
                for path, content in before.items():
                    self.assertEqual(path.read_bytes(), content)

    def test_aligned_checkout_allows_dirty_version_authority(self):
        (self.sdk / "versions.json").write_text('{"appVersion":"0.8.4"}\n')
        self.assertEqual(self.invoke()[0], 0)
        self.assertEqual(json.loads((self.sdk / "package.json").read_text())["version"], "0.8.4")
        self.assertEqual(self.invoke(check=True)[0], 0)

    def test_intentional_sdk_commit_requires_staging_parent_gitlink(self):
        (self.sdk / "versions.json").write_text('{"appVersion":"0.8.4"}\n')
        subprocess.run(["git", "add", "versions.json"], cwd=self.sdk, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "commit", "-qm", "next release"], cwd=self.sdk, check=True)
        self.assertEqual(self.invoke()[0], 1)
        subprocess.run(["git", "add", "hypercli"], cwd=self.parent, check=True)
        self.assertEqual(self.invoke()[0], 0)


if __name__ == "__main__":
    unittest.main()
