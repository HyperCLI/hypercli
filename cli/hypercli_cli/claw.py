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
    plan_id: str = typer.Argument("1aiu", help="Plan ID: 1aiu, 2aiu, 5aiu, 10aiu (default: 1aiu)"),
    amount: str = typer.Argument(None, help="USDC amount to pay (e.g., '25' for $25). Duration scales proportionally."),
    dev: bool = typer.Option(False, "--dev", help="Use dev API (dev-api.hyperclaw.app)")
):
    """Subscribe to a HyperClaw plan via x402 payment.
    
    Duration scales with payment amount (1aiu: $25 = 32 days):
      - $25 → 32 days
      - $12.50 → 16 days
      - $1 → ~1.3 days
    
    Examples:
      hyper claw subscribe 1aiu 25     # Pay $25 for 32 days
      hyper claw subscribe 1aiu 50     # Pay $50 for 64 days
      hyper claw subscribe 5aiu 100    # Pay $100 for 5aiu plan
    """
    require_x402_deps()
    
    # Import wallet helper
    from .wallet import load_wallet
    
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    
    console.print(f"\n[bold]Subscribing to HyperClaw plan: {plan_id}[/bold]\n")
    console.print(f"API: {api_base}")
    if amount:
        console.print(f"Custom amount: [bold]${amount} USDC[/bold]")
    
    # Load wallet
    account = load_wallet()
    console.print(f"[green]✓[/green] Loaded wallet: {account.address}\n")
    
    # Run async subscribe
    result = asyncio.run(_subscribe_async(account, plan_id, api_base, amount))
    
    if result:
        import yaml
        from datetime import datetime
        
        # Save key (current)
        HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
        with open(CLAW_KEY_PATH, "w") as f:
            json.dump(result, f, indent=2)
        
        # Build history entry with key info
        tx_hash = result.get("tx_hash", "")
        basescan_url = f"https://basescan.org/tx/{tx_hash}" if tx_hash else ""
        
        history_entry = {
            "key": result["key"],
            "plan": result["plan_id"],
            "amount_usdc": result.get("amount_paid", ""),
            "date": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            "expires": result.get("expires_at", ""),
            "basescan": basescan_url,
            "tpm_limit": result.get("tpm_limit", 0),
            "rpm_limit": result.get("rpm_limit", 0),
        }
        
        # Load existing keys or start fresh
        keys_history_path = HYPERCLI_DIR / "claw-keys.yaml"
        if keys_history_path.exists():
            with open(keys_history_path) as f:
                keys_data = yaml.safe_load(f) or {"keys": []}
        else:
            keys_data = {"keys": []}
        
        keys_data["keys"].append(history_entry)
        
        with open(keys_history_path, "w") as f:
            yaml.dump(keys_data, f, default_flow_style=False, sort_keys=False)
        
        console.print("\n[green]✅ Subscription successful![/green]\n")
        console.print(f"API Key: [bold]{result['key']}[/bold]")
        console.print(f"Plan: {result['plan_id']}")
        console.print(f"Amount paid: [bold]${result.get('amount_paid', 'N/A')} USDC[/bold]")
        console.print(f"Duration: [bold]{result.get('duration_days', 30):.2f} days[/bold]")
        console.print(f"Expires: {result['expires_at']}")
        console.print(f"Limits: {result['tpm_limit']:,} TPM / {result['rpm_limit']:,} RPM")
        console.print(f"\n[green]✓[/green] Key saved to [bold]{CLAW_KEY_PATH}[/bold]")
        console.print(f"[green]✓[/green] Key history: [bold]{keys_history_path}[/bold]")
        console.print("\nConfigure OpenClaw with: [bold]hyper claw openclaw-setup[/bold]")


async def _subscribe_async(account, plan_id: str, api_base: str, amount: str = None):
    """Async helper for x402 payment.
    
    Args:
        account: Ethereum account for signing
        plan_id: Plan to subscribe to
        api_base: API base URL
        amount: Optional custom USDC amount (as string, e.g., "5.00")
    """
    import httpx
    from decimal import Decimal
    from x402.http import x402HTTPClient
    
    # Setup x402 client
    console.print("[bold]Setting up x402 client...[/bold]")
    client = x402Client()
    register_exact_evm_client(client, EthAccountSigner(account))
    http_client = x402HTTPClient(client)
    
    url = f"{api_base}/api/x402/{plan_id}"
    console.print(f"\n[bold]→ Requesting:[/bold] POST {url}\n")
    
    async with httpx.AsyncClient() as http:
        try:
            # Step 1: Make initial request to get 402 response with payment requirements
            response = await http.post(url)
            
            if response.status_code != 402:
                if response.is_success:
                    return response.json()
                console.print(f"\n[red]❌ Unexpected response: {response.status_code}[/red]")
                console.print(response.text)
                raise typer.Exit(1)
            
            console.print(f"[yellow]→[/yellow] Got 402 Payment Required")
            
            # Step 2: Parse payment requirements
            def get_header(name: str) -> str | None:
                return response.headers.get(name)
            
            try:
                body = response.json()
            except:
                body = None
            
            payment_required = http_client.get_payment_required_response(get_header, body)
            
            # Step 3: Modify amount if custom amount specified
            if amount and payment_required.accepts:
                amount_decimal = Decimal(amount)
                amount_smallest = str(int(amount_decimal * Decimal("1000000")))
                console.print(f"[bold]Custom amount:[/bold] ${amount} USDC ({amount_smallest} smallest units)")
                
                # Modify the amount in payment requirements
                # PaymentRequirements is a Pydantic model, so we can modify it
                for req in payment_required.accepts:
                    req.amount = amount_smallest
            else:
                console.print(f"[dim]Using server-requested amount: {payment_required.accepts[0].amount if payment_required.accepts else 'N/A'}[/dim]")
            
            # Step 4: Create payment payload
            console.print("[bold]Creating payment signature...[/bold]")
            payment_payload = await client.create_payment_payload(payment_required)
            
            # Step 5: Encode payment header
            payment_headers = http_client.encode_payment_signature_header(payment_payload)
            console.print(f"[green]✓[/green] Payment signed")
            
            # Step 6: Retry with payment
            console.print("[bold]Sending payment...[/bold]")
            retry_response = await http.post(url, headers=payment_headers)
            
            console.print(f"[green]✓[/green] Response status: {retry_response.status_code}")
            
            if retry_response.is_success:
                data = retry_response.json()
                return data
            else:
                console.print(f"\n[red]❌ Payment failed: {retry_response.status_code}[/red]")
                console.print(retry_response.text)
                raise typer.Exit(1)
                
        except typer.Exit:
            raise
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
    hours_left = time_left.seconds // 3600
    
    console.print("\n[bold]HyperClaw Subscription Status[/bold]\n")
    console.print(f"Plan: [bold]{key_data['plan_id']}[/bold]")
    console.print(f"Key: [dim]{key_data['key'][:20]}...[/dim]")
    
    # Show amount paid and duration if available
    if "amount_paid" in key_data:
        console.print(f"Paid: [bold]${key_data['amount_paid']} USDC[/bold]")
    if "duration_days" in key_data:
        console.print(f"Duration: {key_data['duration_days']:.2f} days")
    
    console.print(f"Expires: {expires_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    
    if days_left > 1:
        console.print(f"Time left: [green]{days_left} days, {hours_left} hours[/green]")
    elif days_left == 1:
        console.print(f"Time left: [yellow]1 day, {hours_left} hours[/yellow]")
    elif time_left.total_seconds() > 0:
        mins_left = time_left.seconds // 60
        console.print(f"Time left: [yellow]{hours_left} hours, {mins_left % 60} minutes[/yellow]")
    else:
        console.print(f"Time left: [red]EXPIRED[/red]")
    
    console.print(f"\nLimits:")
    console.print(f"  TPM: {key_data['tpm_limit']:,}")
    console.print(f"  RPM: {key_data['rpm_limit']:,}")


@app.command("plans")
def plans(
    dev: bool = typer.Option(False, "--dev", help="Use dev API")
):
    """List available HyperClaw plans"""
    import httpx
    
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    url = f"{api_base}/api/plans"
    
    try:
        response = httpx.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        console.print(f"[red]❌ Failed to fetch plans: {e}[/red]")
        raise typer.Exit(1)
    
    table = Table(title="HyperClaw Plans")
    table.add_column("Plan ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Price", style="yellow")
    table.add_column("Duration", style="blue")
    table.add_column("TPM", style="magenta")
    table.add_column("RPM", style="magenta")
    
    for plan in data.get("plans", []):
        plan_id = plan.get("id", "")
        name = plan.get("name", "")
        price = f"${plan.get('price', 0)}"
        duration = f"{plan.get('duration_days', 30)} days"
        tpm = f"{plan.get('tpm_limit', 0):,}"
        rpm = f"{plan.get('rpm_limit', 0):,}"
        table.add_row(plan_id, name, price, duration, tpm, rpm)
    
    console.print()
    console.print(table)
    console.print()
    console.print("Subscribe with: [bold]hyper claw subscribe <plan_id> <amount>[/bold]")


OPENCLAW_CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"


def fetch_models(api_base: str = PROD_API_BASE) -> list[dict]:
    """Fetch available models from HyperClaw /v1/models endpoint."""
    import httpx
    try:
        resp = httpx.get(f"{api_base}/api/v1/models", timeout=10)
        resp.raise_for_status()
        data = resp.json().get("data", [])
        return [
            {
                "id": m["id"],
                "name": m.get("id", "").replace("-", " ").title(),
                "reasoning": False,
                "input": ["text"],
                "contextWindow": m.get("context_window", 200000),
                "maxTokens": m.get("max_tokens", 8192),
            }
            for m in data
        ]
    except Exception as e:
        console.print(f"[yellow]⚠ Could not fetch models from API: {e}[/yellow]")
        console.print("[yellow]  Using fallback model list[/yellow]")
        return [
            {
                "id": "kimi-k2.5",
                "name": "Kimi K2.5",
                "reasoning": False,
                "input": ["text"],
                "contextWindow": 200000,
                "maxTokens": 8192,
            },
        ]


@app.command("openclaw-setup")
def openclaw_setup(
    default: bool = typer.Option(False, "--default", help="Set hyperclaw/kimi-k2.5 as the default model"),
):
    """Patch OpenClaw config with your HyperClaw API key.

    Reads key from ~/.hypercli/claw-key.json, patches only the
    models.providers.hyperclaw section in ~/.openclaw/openclaw.json.
    Everything else in the config is left untouched.
    """

    # Load HyperClaw key
    if not CLAW_KEY_PATH.exists():
        console.print("[red]❌ No HyperClaw key found.[/red]")
        console.print("Run: [bold]hyper claw subscribe 1aiu <amount>[/bold]")
        raise typer.Exit(1)

    with open(CLAW_KEY_PATH) as f:
        api_key = json.load(f).get("key", "")

    if not api_key:
        console.print("[red]❌ Invalid key file — missing 'key' field[/red]")
        raise typer.Exit(1)

    # Read existing config (or start empty)
    if OPENCLAW_CONFIG_PATH.exists():
        with open(OPENCLAW_CONFIG_PATH) as f:
            config = json.load(f)
    else:
        config = {}

    # Fetch current model list from API
    models = fetch_models()

    # Patch only models.providers.hyperclaw
    config.setdefault("models", {}).setdefault("providers", {})
    config["models"]["providers"]["hyperclaw"] = {
        "baseUrl": "https://api.hyperclaw.app/v1",
        "apiKey": api_key,
        "api": "openai-completions",
        "models": models,
    }

    # Optionally set default model
    if default:
        config.setdefault("agents", {}).setdefault("defaults", {}).setdefault("model", {})
        config["agents"]["defaults"]["model"]["primary"] = f"hyperclaw/{models[0]['id']}"

    # Write back
    OPENCLAW_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OPENCLAW_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")

    console.print(f"[green]✅ Patched {OPENCLAW_CONFIG_PATH}[/green]")
    console.print(f"   provider: hyperclaw  key: {api_key[:16]}...")
    for m in models:
        console.print(f"   model: hyperclaw/{m['id']}")
    if default:
        console.print(f"   default model: hyperclaw/{models[0]['id']}")
    console.print("\nRun: [bold]openclaw gateway restart[/bold]")
