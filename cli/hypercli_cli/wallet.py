"""Wallet management commands for HyperCLI"""
import json
import getpass
import os
from pathlib import Path
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="Wallet management commands")
console = Console()

# Check if wallet dependencies are available
try:
    from web3 import Web3
    from eth_account import Account
    WALLET_AVAILABLE = True
except ImportError:
    WALLET_AVAILABLE = False

WALLET_DIR = Path.home() / ".hypercli"
WALLET_PATH = WALLET_DIR / "wallet.json"
BASE_RPC = "https://mainnet.base.org"
USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


def require_wallet_deps():
    """Check if wallet dependencies are installed"""
    if not WALLET_AVAILABLE:
        console.print("[red]❌ Wallet commands require crypto dependencies[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)


@app.command("create")
def create():
    """Create a new wallet with encrypted keystore"""
    require_wallet_deps()
    
    if WALLET_PATH.exists():
        console.print(f"[yellow]Wallet already exists at {WALLET_PATH}[/yellow]")
        overwrite = typer.confirm("Overwrite existing wallet?", default=False)
        if not overwrite:
            console.print("Cancelled.")
            raise typer.Exit(0)
    
    console.print("\n[bold]Creating new Ethereum wallet...[/bold]\n")
    
    # Generate random account
    account = Account.create()
    
    console.print(f"[green]✓[/green] Wallet address: [bold]{account.address}[/bold]")
    
    # Get passphrase (check env first)
    passphrase_env = os.getenv("HYPERCLI_WALLET_PASSPHRASE")
    if passphrase_env:
        passphrase = passphrase_env
        console.print("[dim]Using passphrase from HYPERCLI_WALLET_PASSPHRASE[/dim]")
    else:
        passphrase = getpass.getpass("Set keystore passphrase: ")
        confirm = getpass.getpass("Confirm passphrase: ")
        
        if passphrase != confirm:
            console.print("[red]❌ Passphrases don't match![/red]")
            raise typer.Exit(1)
    
    # Encrypt and save keystore
    keystore = account.encrypt(passphrase)
    
    WALLET_DIR.mkdir(parents=True, exist_ok=True)
    with open(WALLET_PATH, "w") as f:
        json.dump(keystore, f, indent=2)
    
    # Set restrictive permissions
    os.chmod(WALLET_PATH, 0o600)
    
    console.print(f"\n[green]✓[/green] Keystore saved to [bold]{WALLET_PATH}[/bold]")
    console.print(f"[green]✓[/green] Address: [bold]{account.address}[/bold]")
    console.print("\n[yellow]⚠️  Fund this address with USDC on Base to use for payments![/yellow]")
    
    # Show QR code for easy mobile scanning
    try:
        import qrcode
        console.print("\n[bold]Scan to send USDC:[/bold]\n")
        qr_obj = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=1,
            border=1,
        )
        qr_obj.add_data(account.address)
        qr_obj.make(fit=True)
        qr_obj.print_ascii(invert=True)
    except ImportError:
        console.print("\n[dim]Tip: run 'hyper wallet qr' to display address as QR code[/dim]")


@app.command("address")
def address():
    """Show wallet address"""
    require_wallet_deps()
    
    if not WALLET_PATH.exists():
        console.print(f"[red]❌ No wallet found at {WALLET_PATH}[/red]")
        console.print("Create one with: [bold]hyper wallet create[/bold]")
        raise typer.Exit(1)
    
    with open(WALLET_PATH) as f:
        keystore = json.load(f)
    
    addr = keystore.get("address", "unknown")
    console.print(f"\n[bold]Wallet address:[/bold] 0x{addr}")


@app.command("qr")
def qr(
    output: str = typer.Option(None, "--output", "-o", help="Save QR code as PNG file"),
):
    """Display wallet address as QR code (for easy mobile scanning)"""
    require_wallet_deps()
    
    try:
        import qrcode
    except ImportError:
        console.print("[red]❌ QR code support requires the qrcode package[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)
    
    if not WALLET_PATH.exists():
        console.print(f"[red]❌ No wallet found at {WALLET_PATH}[/red]")
        console.print("Create one with: [bold]hyper wallet create[/bold]")
        raise typer.Exit(1)
    
    with open(WALLET_PATH) as f:
        keystore = json.load(f)
    
    addr = "0x" + keystore.get("address", "")
    
    if output:
        # Save as PNG
        try:
            qr_obj = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=2,
            )
            qr_obj.add_data(addr)
            qr_obj.make(fit=True)
            
            img = qr_obj.make_image(fill_color="black", back_color="white")
            
            # Ensure .png extension
            if not output.lower().endswith('.png'):
                output = output + '.png'
            
            img.save(output)
            console.print(f"[green]✓[/green] QR code saved to [bold]{output}[/bold]")
            console.print(f"[dim]Address: {addr}[/dim]")
        except Exception as e:
            console.print(f"[red]❌ Failed to save PNG: {e}[/red]")
            console.print("[dim]Try: pip install pillow[/dim]")
            raise typer.Exit(1)
    else:
        # Print ASCII to terminal
        console.print(f"\n[bold]Wallet Address:[/bold] {addr}")
        console.print("[dim]Scan to send USDC on Base network[/dim]\n")
        
        qr_obj = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=1,
            border=1,
        )
        qr_obj.add_data(addr)
        qr_obj.make(fit=True)
        qr_obj.print_ascii(invert=True)
        
        console.print(f"\n[bold]{addr}[/bold]")
        console.print("\n[dim]Tip: use --output wallet.png to save as image[/dim]")


@app.command("balance")
def balance():
    """Check USDC balance on Base"""
    require_wallet_deps()
    
    if not WALLET_PATH.exists():
        console.print(f"[red]❌ No wallet found at {WALLET_PATH}[/red]")
        console.print("Create one with: [bold]hyper wallet create[/bold]")
        raise typer.Exit(1)
    
    with open(WALLET_PATH) as f:
        keystore = json.load(f)
    
    # Get passphrase
    passphrase_env = os.getenv("HYPERCLI_WALLET_PASSPHRASE")
    if passphrase_env:
        passphrase = passphrase_env
    else:
        passphrase = getpass.getpass("Unlock keystore passphrase: ")
    
    try:
        private_key = Account.decrypt(keystore, passphrase)
        account = Account.from_key(private_key)
    except Exception as e:
        console.print(f"[red]❌ Failed to unlock wallet: {e}[/red]")
        raise typer.Exit(1)
    
    console.print(f"\n[bold]Checking USDC balance on Base...[/bold]\n")
    
    # Connect to Base
    w3 = Web3(Web3.HTTPProvider(BASE_RPC))
    
    # USDC ERC20 ABI (minimal - just balanceOf)
    usdc_abi = [
        {
            "constant": True,
            "inputs": [{"name": "_owner", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "balance", "type": "uint256"}],
            "type": "function",
        }
    ]
    
    usdc = w3.eth.contract(address=USDC_CONTRACT, abi=usdc_abi)
    
    # Get balance (USDC has 6 decimals)
    balance_raw = usdc.functions.balanceOf(account.address).call()
    balance_usdc = balance_raw / 1_000_000
    
    console.print(f"Wallet: [bold]{account.address}[/bold]")
    console.print(f"USDC Balance: [bold green]{balance_usdc:.6f}[/bold green]")
    
    if balance_usdc == 0:
        console.print("\n[yellow]⚠️  No USDC! Send some to this address on Base network.[/yellow]")
    else:
        console.print(f"\n[green]✓[/green] You have [bold]{balance_usdc:.2f} USDC[/bold]")


@app.command("topup")
def topup(
    amount: str = typer.Argument(help="Amount in USDC to top up (max 6 decimals)"),
    api_url: str = typer.Option(None, help="API URL override"),
):
    """Top up account balance via Orchestra x402 endpoint.

    Flow:
    1) Resolve user_id via GET /api/user using your existing API key
    2) POST /api/x402/top_up with {user_id, amount}
    3) Handle 402 and retry with x402 payment headers

    Examples:
        hyper wallet topup 10
        hyper wallet topup 25.50
    """
    require_wallet_deps()
    from decimal import Decimal, InvalidOperation
    import httpx
    from hypercli.config import get_api_key, get_api_url

    try:
        from x402 import x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact.register import register_exact_evm_client
    except ImportError:
        console.print("[red]❌ x402 payment requires wallet/x402 dependencies[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)

    try:
        amount_dec = Decimal(amount)
    except InvalidOperation:
        console.print(f"[red]❌ Invalid amount: {amount}[/red]")
        raise typer.Exit(1)

    if amount_dec <= 0:
        console.print("[red]❌ Amount must be greater than 0[/red]")
        raise typer.Exit(1)
    if amount_dec.as_tuple().exponent < -6:
        console.print("[red]❌ Amount supports at most 6 decimals[/red]")
        raise typer.Exit(1)

    amount_atomic = int(amount_dec * Decimal("1000000"))

    # Step 1: Load wallet
    account = load_wallet()
    console.print(f"[green]✓[/green] Wallet: {account.address}")

    # Step 2: Check USDC balance
    w3 = Web3(Web3.HTTPProvider(BASE_RPC))
    usdc_abi = [
        {
            "constant": True,
            "inputs": [{"name": "_owner", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "balance", "type": "uint256"}],
            "type": "function",
        }
    ]
    usdc = w3.eth.contract(address=USDC_CONTRACT, abi=usdc_abi)
    balance_raw = usdc.functions.balanceOf(account.address).call()
    balance_usdc = Decimal(balance_raw) / Decimal("1000000")

    console.print(f"[green]✓[/green] Balance: {balance_usdc:.6f} USDC")

    if balance_raw < amount_atomic:
        console.print(
            f"\n[red]❌ Insufficient balance: {balance_usdc:.6f} < {amount_dec:.6f} USDC[/red]"
        )
        console.print(f"Send USDC on Base to: [bold]{account.address}[/bold]")
        raise typer.Exit(1)

    # Step 3: Set up x402 v2 client
    api_key = get_api_key()
    if not api_key:
        console.print("[red]❌ API key required for top-up[/red]")
        console.print(
            "Set it with: [bold]hyper configure[/bold] or [bold]hyper wallet login[/bold]"
        )
        raise typer.Exit(1)

    base_url = (api_url or get_api_url()).rstrip("/")
    user_endpoint = f"{base_url}/api/user"
    topup_endpoint = f"{base_url}/api/x402/top_up"
    auth_headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    signer = EthAccountSigner(account)
    x402_client = x402ClientSync()
    register_exact_evm_client(x402_client, signer)
    http_client = x402HTTPClientSync(x402_client)

    with httpx.Client(timeout=30) as client:
        # Step 4: Resolve user_id from API key
        console.print("\n[bold]Resolving user...[/bold]")
        user_resp = client.get(user_endpoint, headers=auth_headers)
        if user_resp.status_code != 200:
            console.print(
                f"[red]❌ Failed to get user: {user_resp.status_code} {user_resp.text}[/red]"
            )
            raise typer.Exit(1)

        user_id = user_resp.json().get("user_id")
        if not user_id:
            console.print("[red]❌ /api/user response missing user_id[/red]")
            raise typer.Exit(1)

        payload = {"user_id": user_id, "amount": float(amount_dec)}

        # Step 5: Request top-up (expect 402 then retry with payment)
        console.print(f"[bold]Requesting top-up of ${amount_dec:.2f}...[/bold]")
        resp = client.post(topup_endpoint, headers=auth_headers, json=payload)

        if resp.status_code == 402:
            console.print("[bold]Signing x402 payment...[/bold]")
            try:
                payment_headers, _ = http_client.handle_402_response(
                    dict(resp.headers), resp.content
                )
            except Exception as e:
                console.print(f"[red]❌ Failed to build payment header: {e}[/red]")
                raise typer.Exit(1)

            console.print("[bold]Submitting payment...[/bold]")
            retry_headers = {**auth_headers, **payment_headers}
            retry_headers["Access-Control-Expose-Headers"] = "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE"
            resp = client.post(topup_endpoint, headers=retry_headers, json=payload)

    if resp.status_code != 200:
        console.print(f"[red]❌ Top-up failed: {resp.status_code} {resp.text}[/red]")
        try:
            settle = http_client.get_payment_settle_response(lambda name: resp.headers.get(name))
            if getattr(settle, "error_reason", None):
                console.print(f"[red]❌ Payment error: {settle.error_reason}[/red]")
        except Exception:
            pass
        raise typer.Exit(1)

    result = resp.json()

    credited = result.get("amount", float(amount_dec))
    wallet = result.get("wallet", account.address)
    tx_id = result.get("transaction_id", "")
    msg = result.get("message", "Top-up successful")

    console.print(f"\n[bold green]✓ Top-up successful![/bold green]\n")
    console.print(f"  User:      {result.get('user_id', 'N/A')}")
    console.print(f"  Credited:  ${credited} USDC")
    console.print(f"  Wallet:    {wallet}")
    console.print(f"  Tx ID:     {tx_id or 'N/A'}")
    console.print(f"  Message:   {msg}")

    try:
        settle = http_client.get_payment_settle_response(lambda name: resp.headers.get(name))
        if getattr(settle, "transaction", None):
            console.print(f"  On-chain:  {settle.transaction}")
        if getattr(settle, "network", None):
            console.print(f"  Network:   {settle.network}")
    except Exception:
        pass

    console.print()


@app.command("login")
def wallet_login(
    name: str = typer.Option("cli", help="Name for the generated API key"),
    api_url: str = typer.Option(None, help="API URL override"),
):
    """Login with wallet signature, create an API key, and save it.
    
    This is the recommended way to set up HyperCLI from scratch:
    1. hyper wallet create
    2. hyper wallet login
    """
    require_wallet_deps()
    from eth_account.messages import encode_defunct
    import httpx
    from hypercli.config import get_api_url, configure

    base_url = (api_url or get_api_url()).rstrip("/")

    # Step 1: Load wallet
    account = load_wallet()
    console.print(f"[green]✓[/green] Wallet: {account.address}\n")

    # Step 2: Get challenge
    console.print("[bold]Requesting login challenge...[/bold]")
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{base_url}/api/auth/wallet/challenge",
            json={"wallet": account.address},
        )
        if resp.status_code != 200:
            console.print(f"[red]❌ Challenge failed: {resp.text}[/red]")
            raise typer.Exit(1)
        challenge = resp.json()

    # Step 3: Sign the challenge
    console.print("[bold]Signing challenge...[/bold]")
    message = encode_defunct(text=challenge["message"])
    signed = account.sign_message(message)

    # Step 4: Login
    console.print("[bold]Logging in...[/bold]")
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{base_url}/api/auth/wallet/login",
            json={
                "wallet": account.address,
                "signature": signed.signature.hex(),
                "timestamp": challenge["timestamp"],
            },
        )
        if resp.status_code != 200:
            console.print(f"[red]❌ Login failed: {resp.text}[/red]")
            raise typer.Exit(1)
        jwt_token = resp.json()["token"]

    console.print("[green]✓[/green] Authenticated\n")

    # Step 5: Create API key using JWT
    console.print(f"[bold]Creating API key '{name}'...[/bold]")
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{base_url}/api/keys",
            json={"name": name},
            headers={"Authorization": f"Bearer {jwt_token}"},
        )
        if resp.status_code != 200:
            console.print(f"[red]❌ Key creation failed: {resp.text}[/red]")
            raise typer.Exit(1)
        key_data = resp.json()

    api_key = key_data["api_key"]

    # Step 6: Save to config
    configure(api_key, api_url)

    console.print(f"[green]✓[/green] API key created and saved!\n")
    console.print(f"  Name:    {key_data['name']}")
    console.print(f"  Key:     [bold]{api_key}[/bold]")
    console.print(f"  Saved:   ~/.hypercli/config")
    console.print(f"\n[green]You're all set! Try:[/green] hyper keys list\n")


def load_wallet():
    """Load and decrypt wallet (helper function for other commands)"""
    require_wallet_deps()
    
    if not WALLET_PATH.exists():
        console.print(f"[red]❌ No wallet found at {WALLET_PATH}[/red]")
        console.print("Create one with: [bold]hyper wallet create[/bold]")
        raise typer.Exit(1)
    
    with open(WALLET_PATH) as f:
        keystore = json.load(f)
    
    # Get passphrase
    passphrase_env = os.getenv("HYPERCLI_WALLET_PASSPHRASE")
    if passphrase_env:
        passphrase = passphrase_env
    else:
        passphrase = getpass.getpass("Unlock keystore passphrase: ")
    
    try:
        private_key = Account.decrypt(keystore, passphrase)
        account = Account.from_key(private_key)
        return account
    except Exception as e:
        console.print(f"[red]❌ Failed to unlock wallet: {e}[/red]")
        raise typer.Exit(1)
