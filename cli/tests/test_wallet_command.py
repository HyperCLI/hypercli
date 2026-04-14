import json
import sys
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


def test_load_wallet_uses_explicit_passphrase(monkeypatch, tmp_path):
    known_private_key = "55" * 32
    wallet_path = _set_temp_wallet_paths(monkeypatch, tmp_path)
    wallet_path.parent.mkdir(parents=True, exist_ok=True)
    wallet_path.write_text(json.dumps(FakeLocalAccount(known_private_key).encrypt("secret")))

    account = wallet_mod.load_wallet(passphrase="secret")

    assert account.address == f"0x{known_private_key[-40:]}"


def test_wallet_balance_passes_explicit_passphrase(monkeypatch, tmp_path):
    _set_temp_wallet_paths(monkeypatch, tmp_path)
    seen: list[str | None] = []

    class _FakeCall:
        def call(self):
            return 1234567

    class _FakeContractFunctions:
        def balanceOf(self, _address):
            return _FakeCall()

    class _FakeContract:
        functions = _FakeContractFunctions()

    class _FakeEth:
        def contract(self, address=None, abi=None):
            return _FakeContract()

    class _FakeWeb3:
        HTTPProvider = staticmethod(lambda url: url)

        def __init__(self, _provider):
            self.eth = _FakeEth()

    def _fake_load_wallet(*, passphrase=None):
        seen.append(passphrase)
        return SimpleNamespace(address="0xabc")

    monkeypatch.setattr(wallet_mod, "load_wallet", _fake_load_wallet)
    monkeypatch.setattr(wallet_mod, "Web3", _FakeWeb3)

    result = runner.invoke(app, ["wallet", "balance", "--passphrase", "secret"])

    assert result.exit_code == 0
    assert seen == ["secret"]
    assert "1.234567" in result.stdout


def test_wallet_login_passes_explicit_passphrase(monkeypatch, tmp_path):
    _set_temp_wallet_paths(monkeypatch, tmp_path)
    load_calls: list[str | None] = []
    auth_calls: list[str | None] = []

    def _fake_load_wallet(*, passphrase=None):
        load_calls.append(passphrase)
        return SimpleNamespace(address="0xabc")

    def _fake_get_wallet_auth_token(api_url=None, *, passphrase=None):
        auth_calls.append(passphrase)
        return "jwt-token"

    class _FakeHttpxClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url, json=None, headers=None):
            return SimpleNamespace(
                status_code=200,
                json=lambda: {"api_key": "hyper_api_test", "name": json["name"]},
                text="ok",
            )

    monkeypatch.setattr(wallet_mod, "load_wallet", _fake_load_wallet)
    monkeypatch.setattr(wallet_mod, "get_wallet_auth_token", _fake_get_wallet_auth_token)
    monkeypatch.setitem(sys.modules, "httpx", SimpleNamespace(Client=_FakeHttpxClient))
    monkeypatch.setattr(
        sys.modules["hypercli.config"],
        "configure",
        lambda api_key, api_url: None,
    )
    monkeypatch.setattr(
        sys.modules["hypercli.config"],
        "get_api_url",
        lambda: "https://api.example.com",
    )

    result = runner.invoke(app, ["wallet", "login", "--passphrase", "secret"])

    assert result.exit_code == 0
    assert load_calls == ["secret"]
    assert auth_calls == ["secret"]


def test_wallet_topup_passes_explicit_passphrase(monkeypatch, tmp_path):
    _set_temp_wallet_paths(monkeypatch, tmp_path)
    load_calls: list[str | None] = []

    class _FakeCall:
        def call(self):
            return 2_000_000

    class _FakeContractFunctions:
        def balanceOf(self, _address):
            return _FakeCall()

    class _FakeContract:
        functions = _FakeContractFunctions()

    class _FakeEth:
        def contract(self, address=None, abi=None):
            return _FakeContract()

    class _FakeWeb3:
        HTTPProvider = staticmethod(lambda url: url)

        def __init__(self, _provider):
            self.eth = _FakeEth()

    class _FakeX402ClientSync:
        def register(self, *_args, **_kwargs):
            return None

    class _FakeX402HTTPClientSync:
        def __init__(self, _client):
            pass

        def handle_402_response(self, headers, content):
            return ({"X-Payment": "sig"}, None)

        def get_payment_settle_response(self, getter):
            return SimpleNamespace(transaction=None, network=None, error_reason=None)

    class _FakeEthAccountSigner:
        def __init__(self, account):
            self.account = account

    class _FakeHttpxClient:
        def __init__(self, timeout=None):
            self.timeout = timeout
            self.posts = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers=None):
            return SimpleNamespace(status_code=200, json=lambda: {"user_id": "user-1"}, text="ok")

        def post(self, url, headers=None, json=None):
            self.posts += 1
            if self.posts == 1:
                return SimpleNamespace(status_code=402, headers={}, content=b"", text="payment required")
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "user_id": "user-1",
                    "amount": 1.0,
                    "wallet": "0xabc",
                    "transaction_id": "tx-1",
                    "message": "Top-up successful",
                },
                headers={},
                text="ok",
            )

    def _fake_load_wallet(*, passphrase=None):
        load_calls.append(passphrase)
        return SimpleNamespace(address="0xabc")

    monkeypatch.setattr(wallet_mod, "load_wallet", _fake_load_wallet)
    monkeypatch.setattr(wallet_mod, "Web3", _FakeWeb3)
    monkeypatch.setitem(sys.modules, "httpx", SimpleNamespace(Client=_FakeHttpxClient))
    monkeypatch.setattr(sys.modules["hypercli.config"], "get_api_key", lambda: "hyper_api_test")
    monkeypatch.setattr(sys.modules["hypercli.config"], "get_api_url", lambda: "https://api.example.com")

    sys.modules["x402"] = SimpleNamespace(x402ClientSync=_FakeX402ClientSync)
    sys.modules["x402.http"] = SimpleNamespace(x402HTTPClientSync=_FakeX402HTTPClientSync)
    sys.modules["x402.mechanisms.evm"] = SimpleNamespace(EthAccountSigner=_FakeEthAccountSigner)
    sys.modules["x402.mechanisms.evm.exact.register"] = SimpleNamespace(
        register_exact_evm_client=lambda *_args, **_kwargs: None
    )

    result = runner.invoke(app, ["wallet", "topup", "1.0", "--passphrase", "secret"])

    assert result.exit_code == 0
    assert load_calls == ["secret"]
