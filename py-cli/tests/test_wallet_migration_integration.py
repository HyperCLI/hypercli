import json
import shutil
import subprocess

import pytest


OLD_HYPERCLI_VERSION = "2026.4.5"
REPO_CLI = "/home/ubuntu/dev/hypercli/cli"
REPO_SDK = "/home/ubuntu/dev/hypercli/sdk"
DOCKER_IMAGE = "python:3.12-slim"


@pytest.mark.integration
def test_old_wallet_can_be_migrated_with_current_cli_in_docker(tmp_path):
    if shutil.which("docker") is None:
        pytest.skip("docker is required for wallet migration integration coverage")

    home_dir = tmp_path / "home"
    home_dir.mkdir(parents=True, exist_ok=True)
    wallet_dir = home_dir / ".hypercli"
    wallet_path = wallet_dir / "wallet.json"
    wallet_old_path = wallet_dir / "wallet.old.json"
    wallet_decrypted_path = wallet_dir / "wallet.decrypted.json"

    script = f"""
set -e
python -m pip install -q "hypercli-cli[wallet]=={OLD_HYPERCLI_VERSION}"
HOME=/tmp-home HYPERCLI_WALLET_PASSPHRASE=legacy-pass python -m hypercli_cli.cli wallet create
cp /tmp-home/.hypercli/wallet.json /tmp-home/.hypercli/wallet.old.json
HOME=/tmp-home PYTHONPATH=/workspace/cli:/workspace/sdk python -m hypercli_cli.cli wallet decrypt --passphrase legacy-pass
cp /tmp-home/.hypercli/wallet.json /tmp-home/.hypercli/wallet.decrypted.json
HOME=/tmp-home PYTHONPATH=/workspace/cli:/workspace/sdk python -m hypercli_cli.cli wallet encrypt --passphrase migrated-pass
chmod 755 /tmp-home /tmp-home/.hypercli
chmod 644 /tmp-home/.hypercli/wallet.json /tmp-home/.hypercli/wallet.old.json /tmp-home/.hypercli/wallet.decrypted.json
"""

    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{home_dir}:/tmp-home",
            "-v",
            f"{REPO_CLI}:/workspace/cli:ro",
            "-v",
            f"{REPO_SDK}:/workspace/sdk:ro",
            DOCKER_IMAGE,
            "sh",
            "-lc",
            script,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    legacy_data = json.loads(wallet_old_path.read_text())
    decrypted_data = json.loads(wallet_decrypted_path.read_text())
    migrated_data = json.loads(wallet_path.read_text())

    legacy_address = str(legacy_data["address"]).lower()
    assert "crypto" in legacy_data or "Crypto" in legacy_data

    assert decrypted_data["type"] == "plaintext_private_key"
    assert str(decrypted_data["address"]).removeprefix("0x").lower() == legacy_address

    assert str(migrated_data["address"]).lower() == legacy_address
    assert "private_key" not in migrated_data
    assert "crypto" in migrated_data or "Crypto" in migrated_data
