"""HyperClaw inference commands"""
import asyncio
import json
from pathlib import Path
from datetime import datetime, timedelta
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="HyperClaw inference commands")
console = Console()

# Check if wallet dependencies are available
try:
    from x402 import x402Client
    from x402.http.clients import x402HttpxClient
    from x402.mechanisms.evm import EthAccountSigner
    from x402.mechanisms.evm.exact.register import register_exact_evm_client
    X402_AVAILABLE = True
except ImportError:
    X402_AVAILABLE = False

HYPERCLI_DIR = Path.home() / ".hypercli"
CLAW_KEY_PATH = HYPERCLI_DIR / "claw-key.json"
DEV_API_BASE = "https://dev-api.hyperclaw.app"
PROD_API_BASE = "https://api.hyperclaw.app"


def require_x402_deps():
    """Check if x402 dependencies are installed"""
    if not X402_AVAILABLE:
        console.print("[red]❌ HyperClaw commands require wallet dependencies[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)


@app.command("subscribe")
def subscribe(
    plan_id: str = typer.Argument(..., help="Plan ID: 1aiu, 2aiu, 5aiu, 10aiu"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API (dev-api.hyperclaw.app)")
):
    """Subscribe to a HyperClaw plan via x402 payment"""
    require_x402_deps()
    
    # Import wallet helper
    from .wallet import load_wallet
    
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    
    console.print(f"\n[bold]Subscribing to HyperClaw plan: {plan_id}[/bold]\n")
    console.print(f"API: {api_base}")
    
    # Load wallet
    account = load_wallet()
    console.print(f"[green]✓[/green] Loaded wallet: {account.address}\n")
    
    # Run async subscribe
    result = asyncio.run(_subscribe_async(account, plan_id, api_base))
    
    if result:
        # Save key
        HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
        with open(CLAW_KEY_PATH, "w") as f:
            json.dump(result, f, indent=2)
        
        console.print("\n[green]✅ Subscription successful![/green]\n")
        console.print(f"API Key: [bold]{result['key']}[/bold]")
        console.print(f"Plan: {result['plan_id']}")
        console.print(f"Expires: {result['expires_at']}")
        console.print(f"Limits: {result['tpm_limit']:,} TPM / {result['rpm_limit']:,} RPM")
        console.print(f"\n[green]✓[/green] Key saved to [bold]{CLAW_KEY_PATH}[/bold]")
        console.print("\nConfigure OpenClaw with: [bold]hyper claw openclaw-setup[/bold]")


async def _subscribe_async(account, plan_id: str, api_base: str):
    """Async helper for x402 payment"""
    
    # Setup x402 v2 client
    console.print("[bold]Setting up x402 v2 client...[/bold]")
    client = x402Client()
    register_exact_evm_client(client, EthAccountSigner(account))
    
    url = f"{api_base}/x402/{plan_id}"
    console.print(f"\n[bold]→ Requesting:[/bold] POST {url}\n")
    
    async with x402HttpxClient(client) as http:
        try:
            response = await http.post(url)
            
            console.print(f"[green]✓[/green] Response status: {response.status_code}")
            
            if response.is_success:
                data = response.json()
                return data
            else:
                console.print(f"\n[red]❌ Request failed: {response.status_code}[/red]")
                console.print(response.text)
                raise typer.Exit(1)
                
        except Exception as e:
            console.print(f"\n[red]❌ Error: {e}[/red]")
            import traceback
            traceback.print_exc()
            raise typer.Exit(1)


@app.command("status")
def status():
    """Show current HyperClaw key status"""
    
    if not CLAW_KEY_PATH.exists():
        console.print("[yellow]No HyperClaw key found.[/yellow]")
        console.print("Subscribe with: [bold]hyper claw subscribe <aiu>[/bold]")
        raise typer.Exit(0)
    
    with open(CLAW_KEY_PATH) as f:
        key_data = json.load(f)
    
    # Parse expiry
    expires_at = datetime.fromisoformat(key_data["expires_at"].replace("Z", "+00:00"))
    now = datetime.now(expires_at.tzinfo)
    time_left = expires_at - now
    days_left = time_left.days
    
    console.print("\n[bold]HyperClaw Subscription Status[/bold]\n")
    console.print(f"Plan: [bold]{key_data['plan_id']}[/bold]")
    console.print(f"Key: [dim]{key_data['key'][:20]}...[/dim]")
    console.print(f"Expires: {expires_at.strftime('%Y-%m-%d %H:%M:%S')}")
    
    if days_left > 1:
        console.print(f"Time left: [green]{days_left} days[/green]")
    elif days_left == 1:
        console.print(f"Time left: [yellow]{days_left} day[/yellow]")
    else:
        console.print(f"Time left: [red]EXPIRED[/red]")
    
    console.print(f"\nLimits:")
    console.print(f"  TPM: {key_data['tpm_limit']:,}")
    console.print(f"  RPM: {key_data['rpm_limit']:,}")


@app.command("plans")
def plans():
    """List available HyperClaw plans"""
    
    table = Table(title="HyperClaw Plans")
    table.add_column("Plan ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Price", style="yellow")
    table.add_column("TPM", style="magenta")
    table.add_column("RPM", style="magenta")
    
    # Hardcoded for now (could fetch from API later)
    plans_data = [
        ("1aiu", "1 Agent", "$1", "50K", "1K"),
        ("2aiu", "2 Agents", "$2", "100K", "2K"),
        ("5aiu", "5 Agents", "$3", "250K", "5K"),
        ("10aiu", "10 Agents", "$4", "500K", "10K"),
    ]
    
    for plan in plans_data:
        table.add_row(*plan)
    
    console.print()
    console.print(table)
    console.print()
    console.print("Subscribe with: [bold]hyper claw subscribe <plan_id>[/bold]")


@app.command("openclaw-setup")
def openclaw_setup():
    """Show OpenClaw configuration instructions for HyperClaw key"""
    
    # Load HyperClaw key
    if not CLAW_KEY_PATH.exists():
        console.print("[red]❌ No HyperClaw key found.[/red]")
        console.print("Run: [bold]hyper claw subscribe <aiu>[/bold]")
        raise typer.Exit(1)
    
    with open(CLAW_KEY_PATH) as f:
        claw_key = json.load(f)
    
    console.print("\n[bold cyan]OpenClaw Configuration Instructions[/bold cyan]\n")
    console.print(f"Plan: [bold]{claw_key['plan_id']}[/bold]")
    console.print(f"Key: [dim]{claw_key['key'][:20]}...[/dim]")
    console.print(f"Expires: {claw_key['expires_at']}")
    
    # Show manual config instructions
    console.print("\n[bold]1. Add HyperClaw provider to OpenClaw config:[/bold]\n")
    
    provider_config = {
        "providers": {
            "hyperclaw": {
                "label": "HyperClaw",
                "baseURL": "https://api.hyperclaw.app/v1",
                "apiKey": claw_key["key"],
                "models": {
                    "kimi-k2.5": "kimi-k2.5",
                    "kimi-for-coding": "kimi-for-coding"
                }
            }
        }
    }
    
    console.print("Add this to your OpenClaw config:")
    console.print(json.dumps(provider_config, indent=2))
    
    console.print("\n[bold]2. Use in agents:[/bold]\n")
    console.print("  model: hyperclaw/kimi-k2.5")
    console.print("  model: hyperclaw/kimi-for-coding")
    
    console.print("\n[bold]3. Set expiry reminder (optional):[/bold]\n")
    expires_at = datetime.fromisoformat(claw_key["expires_at"].replace("Z", "+00:00"))
    reminder_time = expires_at - timedelta(days=1)
    
    console.print(f"Create a cron job to remind you 1 day before expiry ({reminder_time.strftime('%Y-%m-%d')}):")
    console.print(f"\n  Renew with: [bold]hyper claw subscribe {claw_key['plan_id']}[/bold]")
    
    console.print(f"\n[green]✓[/green] Key saved at [bold]{CLAW_KEY_PATH}[/bold]")
    console.print(f"[green]✓[/green] Limits: {claw_key['tpm_limit']:,} TPM / {claw_key['rpm_limit']:,} RPM")
