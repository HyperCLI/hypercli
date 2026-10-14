import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("provision_unattended", Path(__file__).with_name("provision-unattended.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
contract_spec = importlib.util.spec_from_file_location("opencode_config_contract", Path(__file__).with_name("config_contract.py"))
contract = importlib.util.module_from_spec(contract_spec)
contract_spec.loader.exec_module(contract)


class ProvisionTest(unittest.TestCase):
    def test_image_config_contract_through_source_entrypoint(self):
        # Execute the actual checked-out entrypoint, not a rewritten copy. Only
        # image-absolute dependency locations are shimmed: model/auth processes
        # never run. The real provisioning helper and seed are used unchanged.
        source = Path(__file__).resolve().parent
        shell = r'''
set -eu
python3() {
    case "$1" in
        /opt/hypercli/lib/runtime-config.py)
            printf '%s\n' 'HYPER_API_BASE=https://example.invalid' 'HYPER_RUNTIME_API_KEY=fixture' ;;
        /opt/hypercli/share/runtime/provision-unattended.py)
            command "$PYTHON" "$SOURCE/provision-unattended.py" "$2" ;;
        *) return 91 ;;
    esac
}
cp() {
    [ "$1" = /opt/hypercli/share/runtime/opencode.json ] || return 92
    command cp "$SOURCE/opencode.json" "$2"
}
exec() {
    [ "$1" = /opt/hypercli/bin/entrypoint ] || return 93
    shift
    command "$@"
}
set -- true
. "$SOURCE/entrypoint.sh"
'''

        def boot(home):
            subprocess.run(["/bin/bash", "-c", shell], check=True, timeout=10,
                           env={"PATH": os.defpath, "HOME": str(home), "SOURCE": str(source),
                                "PYTHON": sys.executable,
                                "OPENCODE_CONFIG_DIR": str(home / ".config/opencode")})

        contract.assert_config_preserved(boot)

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
