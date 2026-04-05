import json
from types import SimpleNamespace

from typer.testing import CliRunner

from hypercli_cli.cli import app
import hypercli_cli.wallet as wallet_mod


runner = CliRunner()


class FakeLocalAccount:
    def __init__(self, private_key_hex: str):
        raw = private_key_hex.removeprefix("0x").lower()
        self._private_key_hex = raw
        self.key = bytes.fromhex(raw)
        self.address = f"0x{raw[-40:]}"

    def encrypt(self, passphrase: str):
        return {
            "address": self.address[2:].lower(),
            "crypto": {
                "ciphertext": self._private_key_hex[::-1],
                "passphrase": passphrase,
            },
        }

    def sign_message(self, _message):
        return SimpleNamespace(signature=b"\x12\x34")


class FakeAccountAPI:
    CREATED_PRIVATE_KEY = "11" * 32

    @staticmethod
    def create():
        return FakeLocalAccount(FakeAccountAPI.CREATED_PRIVATE_KEY)

    @staticmethod
    def decrypt(data, passphrase):
        crypto = data.get("crypto") or data.get("Crypto") or {}
        if crypto.get("passphrase") != passphrase:
            raise ValueError("bad passphrase")
        return bytes.fromhex(str(crypto["ciphertext"])[::-1])

    @staticmethod
    def from_key(private_key):
        if isinstance(private_key, bytes):
            raw = private_key.hex()
        else:
            raw = str(private_key).removeprefix("0x")
        return FakeLocalAccount(raw)


def _set_temp_wallet_paths(monkeypatch, tmp_path):
    wallet_dir = tmp_path / ".hypercli"
    wallet_path = wallet_dir / "wallet.json"
    passphrase_path = wallet_dir / "wallet.passphrase"
    monkeypatch.setattr(wallet_mod, "WALLET_AVAILABLE", True)
    monkeypatch.setattr(wallet_mod, "Account", FakeAccountAPI)
    monkeypatch.setattr(wallet_mod, "WALLET_DIR", wallet_dir)
    monkeypatch.setattr(wallet_mod, "WALLET_PATH", wallet_path)
    monkeypatch.setattr(wallet_mod, "WALLET_PASSPHRASE_PATH", passphrase_path)
    return wallet_path


def test_wallet_create_unencrypted_wallet(monkeypatch, tmp_path):
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)

    result = runner.invoke(app, ["wallet", "create", "--no-passphrase"])
    assert result.exit_code == 0

    plain_data = json.loads(wallet_path.read_text())
    assert plain_data["type"] == "plaintext_private_key"
    assert plain_data["private_key"] == f"0x{FakeAccountAPI.CREATED_PRIVATE_KEY}"
    assert plain_data["address"] == f"0x{FakeAccountAPI.CREATED_PRIVATE_KEY[-40:]}"


def test_old_unencrypted_wallet_import(monkeypatch, tmp_path):
    known_private_key = "22" * 32
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)
    wallet_path.parent.mkdir(parents=True, exist_ok=True)
    wallet_path.write_text(
        json.dumps(
            {
                "type": "plaintext_private_key",
                "address": f"0x{known_private_key[-40:]}",
                "private_key": f"0x{known_private_key}",
            }
        )
    )

    result = runner.invoke(app, ["wallet", "address"])
    assert result.exit_code == 0
    assert f"0x{known_private_key[-40:]}" in result.stdout


def test_old_encrypted_wallet_import(monkeypatch, tmp_path):
    known_private_key = "44" * 32
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)
    wallet_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_account = FakeLocalAccount(known_private_key)
    wallet_path.write_text(json.dumps(legacy_account.encrypt("legacy-pass")))

    result = runner.invoke(app, ["wallet", "decrypt", "--passphrase", "legacy-pass"])

    assert result.exit_code == 0
    decrypted_data = json.loads(wallet_path.read_text())
    assert decrypted_data["type"] == "plaintext_private_key"
    assert decrypted_data["private_key"] == f"0x{known_private_key}"
    assert decrypted_data["address"] == legacy_account.address


def test_encrypt_created_plaintext_wallet(monkeypatch, tmp_path):
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)

    create_result = runner.invoke(app, ["wallet", "create", "--no-passphrase"])
    assert create_result.exit_code == 0

    result = runner.invoke(app, ["wallet", "encrypt", "--passphrase", "secret"])
    assert result.exit_code == 0

    encrypted_data = json.loads(wallet_path.read_text())
    assert "crypto" in encrypted_data
    assert "private_key" not in encrypted_data
    assert encrypted_data["address"] == FakeAccountAPI.CREATED_PRIVATE_KEY[-40:]


def test_decrypt_encrypted_wallet(monkeypatch, tmp_path):
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)

    create_result = runner.invoke(app, ["wallet", "create", "--no-passphrase"])
    assert create_result.exit_code == 0
    encrypt_result = runner.invoke(app, ["wallet", "encrypt", "--passphrase", "secret"])
    assert encrypt_result.exit_code == 0

    result = runner.invoke(app, ["wallet", "decrypt", "--passphrase", "secret"])
    assert result.exit_code == 0

    decrypted_data = json.loads(wallet_path.read_text())
    assert decrypted_data["type"] == "plaintext_private_key"
    assert decrypted_data["private_key"] == f"0x{FakeAccountAPI.CREATED_PRIVATE_KEY}"
    assert decrypted_data["address"] == f"0x{FakeAccountAPI.CREATED_PRIVATE_KEY[-40:]}"
