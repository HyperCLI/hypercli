"""Offline release-contract tests, including real standalone checkout projections."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

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
        self.assertEqual(self.sync(check=False), [])
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.sync("0.9.1", check=False), [])
        self.assertEqual(self.sync("0.9.1"), [])
        # Runtime identity and package manifests change together without parent files.
        for name in ("ts-sdk", "ts-cli"):
            package = json.loads((self.root / name / "package.json").read_text())
            self.assertEqual(package["version"], "0.9.1")
            self.assertIn("'0.9.1'", (self.root / name / "src/version.ts").read_text())
        self.assertIn('"hypercli-sdk[all]==0.9.1"', (self.root / "py-cli/pyproject.toml").read_text())
        self.assertIn('version = "0.9.1"', (self.root / "Cargo.toml").read_text())
        self.assertIn('"@agentclientprotocol/sdk": "1.5.0"', (self.root / "ts-sdk/package.json").read_text())

    def test_check_detects_drift_without_mutation(self):
        for name, old, new in (
            ("ts-cli/package.json", '"0.8.0"', '"2026.10.6"'),
            ("ts-cli/src/version.ts", "'0.8.0'", "'0.1.0'"),
            ("ts-cli/package-lock.json", '"0.8.0"', '"0.7.0"'),
            ("py-cli/pyproject.toml", "hypercli-sdk==0.8.0", "hypercli-sdk>=2026.6.26"),
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

    def test_invalid_authority_and_calendar_version_are_rejected(self):
        for data in ({"appVersion": "2026.10.6"}, {"appVersion": "0.8.0", "packageVersions": {}},
                     {"appVersion": "0.8.0-dev"}, {"appVersion": 8}):
            (self.root / "versions.json").write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                versions.app_version(self.root)

    def test_missing_selector_fails_closed(self):
        path = self.root / "py-sdk/hypercli/__init__.py"
        path.write_text(path.read_text().replace("__version__ =", "version ="))
        before = self.snapshot()
        self.assertTrue(any("expected 1 matches" in e for e in self.sync(check=False)))
        self.assertEqual(before, self.snapshot())


if __name__ == "__main__":
    unittest.main()
