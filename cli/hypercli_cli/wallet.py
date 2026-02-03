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
