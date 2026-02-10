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
    amount: float = typer.Argument(help="Amount in USDC to pay"),
    plan: str = typer.Option("1aiu", help="Plan ID (1aiu, 2aiu, 5aiu, 10aiu)"),
    api_url: str = typer.Option(None, help="API URL override"),
    save: bool = typer.Option(True, help="Save returned API key to config"),
):
    """Top up account by paying USDC via x402 protocol.
    
    Sends a USDC payment on Base to purchase or extend a plan.
    The duration granted is proportional to the amount paid.
    
    Examples:
        hyper wallet topup 25              # Pay $25 USDC for ~23 days of 1 AIU
        hyper wallet topup 35 --plan 1aiu  # Pay full price for 32 days
        hyper wallet topup 5               # Pay $5 for ~4.5 days
    """
    require_wallet_deps()
    import httpx
    from hypercli.config import get_api_url, configure

    try:
        from x402 import x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm.exact import ExactEvmClientScheme
        from x402.mechanisms.evm import EthAccountSigner
    except ImportError:
        console.print("[red]❌ x402 payment requires the x402 package[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install x402[/bold]")
        raise typer.Exit(1)

    base_url = (api_url or get_api_url()).rstrip("/")
    endpoint = f"{base_url}/api/x402/{plan}"

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
    balance_usdc = balance_raw / 1_000_000

    console.print(f"[green]✓[/green] Balance: {balance_usdc:.2f} USDC")

    if balance_usdc < amount:
        console.print(f"\n[red]❌ Insufficient balance: {balance_usdc:.2f} < {amount:.2f} USDC[/red]")
        console.print(f"Send USDC on Base to: [bold]{account.address}[/bold]")
        raise typer.Exit(1)

    # Step 3: Set up x402 client
    signer = EthAccountSigner(account)
    x402_client = x402ClientSync()
    x402_client.register("eip155:8453", ExactEvmClientScheme(signer))
    http_client = x402HTTPClientSync(x402_client)

    # Step 4: Hit endpoint to get 402 payment requirements
    console.print(f"\n[bold]Requesting payment for plan '{plan}'...[/bold]")

    with httpx.Client(timeout=30) as client:
        resp = client.post(endpoint)

        if resp.status_code == 404:
            console.print(f"[red]❌ Plan '{plan}' not found[/red]")
            raise typer.Exit(1)

        if resp.status_code != 402:
            console.print(f"[red]❌ Unexpected response: {resp.status_code} {resp.text}[/red]")
            raise typer.Exit(1)

        # Step 5: Create x402 payment (signs EIP-3009 transferWithAuthorization)
        console.print(f"[bold]Signing USDC payment of ${amount:.2f}...[/bold]")

        # Override the amount in the payment requirements to match user's requested amount
        from x402 import parse_payment_required
        payment_required = parse_payment_required(
            resp.headers, resp.content
        )

        # Override the amount to the user-specified amount (in USDC atomic units, 6 decimals)
        amount_atomic = str(int(amount * 1_000_000))
        for req in payment_required.accepts:
            req.amount = amount_atomic

        payment_payload = http_client.create_payment_payload(payment_required)
        payment_headers = http_client.encode_payment_signature_header(payment_payload)

        # Step 6: Retry with payment headers
        console.print(f"[bold]Submitting payment...[/bold]")
        resp2 = client.post(endpoint, headers=payment_headers)

    if resp2.status_code != 200:
        console.print(f"[red]❌ Payment failed: {resp2.status_code} {resp2.text}[/red]")
        raise typer.Exit(1)

    result = resp2.json()

    api_key = result.get("key", "")
    duration = result.get("duration_days", 0)
    expires = result.get("expires_at", "")
    paid = result.get("amount_paid", amount)

    console.print(f"\n[bold green]✓ Payment successful![/bold green]\n")
    console.print(f"  Plan:     {result.get('plan_id', plan)}")
    console.print(f"  Paid:     ${paid} USDC")
    console.print(f"  Duration: {duration:.1f} days")
    console.print(f"  Expires:  {expires[:19]}")
    console.print(f"  TPM:      {result.get('tpm_limit', 'N/A')}")
    console.print(f"  RPM:      {result.get('rpm_limit', 'N/A')}")

    if api_key:
        console.print(f"  API Key:  [bold]{api_key}[/bold]")

        if save:
            configure(api_key, api_url)
            console.print(f"\n[green]✓[/green] API key saved to ~/.hypercli/config")
        else:
            console.print(f"\n[yellow]⚠ Save this key — it won't be shown again.[/yellow]")

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
