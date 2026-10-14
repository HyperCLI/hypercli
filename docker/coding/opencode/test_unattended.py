import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("provision_unattended", Path(__file__).with_name("provision-unattended.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionTest(unittest.TestCase):
    def test_existing_home_preserves_fields_and_explicit_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.json"
            path.write_text(json.dumps({"model": "native/model", "permission": {"bash": "ask"}, "agent": {"custom": {"mode": "primary"}}}))
            self.assertTrue(module.provision(path))
            data = json.loads(path.read_text())
            self.assertEqual(data["permission"], {"bash": "ask"})
            self.assertEqual(data["model"], "native/model")
            self.assertEqual(data["agent"]["hypercli-unattended"]["permission"], {"*": "allow"})
            data["agent"]["hypercli-unattended"] = {"disable": True}
            path.write_text(json.dumps(data))
            original = path.read_bytes()
            self.assertFalse(module.provision(path))
            self.assertEqual(path.read_bytes(), original)

    def test_user_formats_and_symlinks_are_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.json"
            original = '{ // user JSONC\n "agent": {} }'
            path.write_text(original)
            self.assertFalse(module.provision(path))
            self.assertEqual(path.read_text(), original)
            link = Path(directory) / "linked.json"
            link.symlink_to(path)
            self.assertFalse(module.provision(link))


if __name__ == "__main__":
    unittest.main()
