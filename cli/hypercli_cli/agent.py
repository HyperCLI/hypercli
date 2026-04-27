"""HyperAgent inference commands"""
import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import urlsplit
import typer
from rich.console import Console
from rich.table import Table

from hypercli import HyperCLI
from hypercli.config import get_agents_api_base_url_from_product_base

from .onboard import onboard as _onboard_fn
from .voice import app as voice_app
from .embed import app as embed_app

app = typer.Typer(help="HyperAgent inference commands")
console = Console()

# Register subcommands
app.command("onboard")(_onboard_fn)
app.add_typer(voice_app, name="voice")
app.add_typer(embed_app, name="embed")

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
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
DEV_API_BASE = "https://api.dev.hypercli.com"
PROD_API_BASE = "https://api.hypercli.com"
DEV_INFERENCE_API_BASE = "https://api.agents.dev.hypercli.com"
PROD_INFERENCE_API_BASE = "https://api.agents.hypercli.com"


def require_x402_deps():
    """Check if x402 dependencies are installed"""
    if not X402_AVAILABLE:
        console.print("[red]❌ HyperClaw commands require wallet dependencies[/red]")
        console.print("\nInstall with:")
        console.print("  [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)


def _resolve_agent_query_key() -> str:
    key = os.getenv("HYPER_AGENTS_API_KEY", "").strip() or os.getenv("HYPER_API_KEY", "").strip()
    if key:
        return key
    if AGENT_KEY_PATH.exists():
        try:
            with open(AGENT_KEY_PATH) as f:
                data = json.load(f)
            key = str(data.get("key") or "").strip()
            if key:
                return key
        except Exception:
            pass
    console.print("[red]❌ No HyperClaw API key found.[/red]")
    console.print("Set HYPER_AGENTS_API_KEY or HYPER_API_KEY, or subscribe first with [bold]hyper agent subscribe[/bold].")
    raise typer.Exit(1)


def _get_agent_query_client(dev: bool) -> HyperCLI:
    key = _resolve_agent_query_key()
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    return HyperCLI(api_key=key, agent_api_key=key, api_url=api_base, agent_dev=dev)


@app.command("subscribe")
def subscribe(
    plan_id: str = typer.Argument("basic", help="Plan ID: basic, plus, pro, team (default: basic)"),
    amount: str = typer.Argument(None, help="USDC amount to pay (e.g., '25' for $25). Duration scales proportionally."),
    passphrase: str = typer.Option(
        None,
        "--passphrase",
        help="Current keystore passphrase. Skips interactive prompt.",
    ),
):
    """Subscribe to a HyperClaw plan via x402 payment.
    
    Duration scales with payment amount (basic: $25 = 32 days):
      - $25 → 32 days
      - $12.50 → 16 days
      - $1 → ~1.3 days
    
    Examples:
      hyper agent subscribe basic 25     # Pay $25 for 32 days
      hyper agent subscribe basic 50     # Pay $50 for 64 days
      hyper agent subscribe pro 100    # Pay $100 for pro plan
    """
    require_x402_deps()
    
    # Import wallet helper
    from .wallet import load_wallet
    from hypercli.config import get_api_url
    
    api_base = get_api_url().rstrip("/")
    
    console.print(f"\n[bold]Subscribing to HyperClaw plan: {plan_id}[/bold]\n")
    console.print(f"API: {api_base}")
    if amount:
        console.print(f"Custom amount: [bold]${amount} USDC[/bold]")
    
    # Load wallet
    account = load_wallet(passphrase=passphrase)
    console.print(f"[green]✓[/green] Loaded wallet: {account.address}\n")
    
    # Run async subscribe
    result = asyncio.run(_subscribe_async(account, plan_id, api_base, amount))
    
    if result:
        import yaml
        from datetime import datetime
        
        # Save key (current)
        HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
        with open(AGENT_KEY_PATH, "w") as f:
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
        keys_history_path = HYPERCLI_DIR / "agent-keys.yaml"
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
        console.print(f"\n[green]✓[/green] Key saved to [bold]{AGENT_KEY_PATH}[/bold]")
        console.print(f"[green]✓[/green] Key history: [bold]{keys_history_path}[/bold]")
        console.print("\nConfigure OpenClaw with: [bold]hyper config openclaw --apply[/bold]")


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
    
    async with httpx.AsyncClient() as http:
        try:
            url = await _resolve_plan_purchase_url(http, api_base, plan_id)
            console.print(f"\n[bold]→ Requesting:[/bold] POST {url}\n")

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
            
            # Step 6: Retry with payment (include JWT if available from agent login)
            jwt_path = HYPERCLI_DIR / "agent-jwt.json"
            if jwt_path.exists():
                try:
                    with open(jwt_path) as f:
                        jwt_data = json.load(f)
                    jwt_token = jwt_data.get("token", "")
                    if jwt_token:
                        payment_headers["Authorization"] = f"Bearer {jwt_token}"
                        console.print("[green]✓[/green] Attaching user auth (from agent login)")
                except Exception:
                    pass

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


def _extract_plan_purchase_url_from_discovery(discovery: object, plan_id: str) -> str | None:
    if not isinstance(discovery, dict):
        return None
    resources = discovery.get("resources")
    if not isinstance(resources, list):
        return None
    suffix = f"/x402/{plan_id}"
    for resource in resources:
        if not isinstance(resource, str):
            continue
        parsed = urlsplit(resource)
        if parsed.path.endswith(suffix):
            return resource
    return None


async def _resolve_plan_purchase_url(http: "httpx.AsyncClient", api_base: str, plan_id: str) -> str:
    normalized_api_base = api_base.rstrip("/")
    agents_base = get_agents_api_base_url_from_product_base(normalized_api_base).rstrip("/")
    discovery_candidates = [
        f"{agents_base}/.well-known/x402",
        f"{normalized_api_base}/api/.well-known/x402",
    ]

    for discovery_url in discovery_candidates:
        try:
            response = await http.get(discovery_url)
        except Exception:
            continue
        if response.status_code >= 400:
            continue
        try:
            payload = response.json()
        except Exception:
            continue
        resource_url = _extract_plan_purchase_url_from_discovery(payload, plan_id)
        if resource_url:
            return resource_url

    return f"{agents_base}/x402/{plan_id}"


@app.command("status")
def status():
    """Show current HyperClaw key status"""
    
    if not AGENT_KEY_PATH.exists():
        console.print("[yellow]No HyperClaw key found.[/yellow]")
        console.print("Subscribe with: [bold]hyper agent subscribe <aiu>[/bold]")
        raise typer.Exit(0)
    
    with open(AGENT_KEY_PATH) as f:
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
    console.print("Subscribe with: [bold]hyper agent subscribe <plan_id> <amount>[/bold]")


@app.command("current-plan")
def current_plan(
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """Show the effective current HyperClaw plan."""
    client = _get_agent_query_client(dev)
    current = client.agent.current_plan()

    if json_output:
        console.print_json(json.dumps(current.__dict__, indent=2, default=str))
        return

    console.print("\n[bold]Current HyperClaw Plan[/bold]\n")
    console.print(f"Plan: [bold]{current.name}[/bold] ({current.id})")
    console.print(f"TPM/RPM: {current.tpm_limit:,} / {current.rpm_limit:,}")
    if current.pooled_tpd:
        console.print(f"Pooled TPD: {current.pooled_tpd:,}")
    if current.expires_at:
        console.print(f"Expires: {current.expires_at.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    if current.provider:
        console.print(f"Provider: {current.provider}")
    console.print(f"Cancel at period end: {'yes' if current.cancel_at_period_end else 'no'}")
    if current.slot_inventory:
        console.print("\n[bold]Slots[/bold]")
        for tier, inventory in current.slot_inventory.items():
            console.print(
                f"  {tier}: {inventory.get('used', 0)}/{inventory.get('granted', 0)} "
                f"({inventory.get('available', 0)} available)"
            )


@app.command("subscriptions")
def subscriptions(
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """List your HyperClaw subscriptions/entitlements."""
    client = _get_agent_query_client(dev)
    items = client.agent.subscriptions()

    if json_output:
        console.print_json(json.dumps([item.__dict__ for item in items], indent=2, default=str))
        return

    table = Table(title="HyperClaw Subscriptions")
    table.add_column("ID", style="cyan")
    table.add_column("Plan", style="green")
    table.add_column("Qty", justify="right")
    table.add_column("Provider")
    table.add_column("Status")
    table.add_column("Expires")
    for item in items:
        expires = item.expires_at.strftime("%Y-%m-%d %H:%M:%S %Z") if item.expires_at else ""
        table.add_row(item.id[:12], item.plan_name or item.plan_id, str(item.quantity), item.provider, item.status, expires)
    console.print()
    console.print(table)


@app.command("subscription-summary")
def subscription_summary(
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """Show your effective HyperClaw entitlement summary."""
    client = _get_agent_query_client(dev)
    summary = client.agent.subscription_summary()

    if json_output:
        console.print_json(json.dumps({
            "effective_plan_id": summary.effective_plan_id,
            "current_subscription_id": summary.current_subscription_id,
            "pooled_tpm_limit": summary.pooled_tpm_limit,
            "pooled_rpm_limit": summary.pooled_rpm_limit,
            "pooled_tpd": summary.pooled_tpd,
            "slot_inventory": summary.slot_inventory,
            "active_subscription_count": summary.active_subscription_count,
            "active_subscriptions": [item.__dict__ for item in summary.active_subscriptions],
            "subscriptions": [item.__dict__ for item in summary.subscriptions],
            "user": summary.user,
        }, indent=2, default=str))
        return

    console.print("\n[bold]HyperClaw Entitlement Summary[/bold]\n")
    console.print(f"Effective plan: [bold]{summary.effective_plan_id}[/bold]")
    console.print(f"Current subscription: {summary.current_subscription_id or ''}")
    console.print(
        f"Pooled limits: {summary.pooled_tpm_limit:,} TPM / "
        f"{summary.pooled_rpm_limit:,} RPM / {summary.pooled_tpd:,} TPD"
    )
    console.print("\n[bold]Slots[/bold]")
    for tier, inventory in summary.slot_inventory.items():
        console.print(
            f"  {tier}: {inventory.get('used', 0)}/{inventory.get('granted', 0)} "
            f"({inventory.get('available', 0)} available)"
        )


@app.command("activate-code")
def activate_code(
    code: str = typer.Argument(..., help="Activation or promo code to redeem"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """Redeem a HyperClaw activation code for the current account."""
    client = _get_agent_query_client(dev)
    result = client.agent.redeem_grant_code(code)

    if json_output:
        console.print_json(json.dumps(result, indent=2, default=str))
        return

    grant = result.get("grant") or {}
    entitlement = result.get("entitlement") or {}
    console.print("\n[bold]HyperClaw Code Activated[/bold]\n")
    console.print(f"Code: [bold]{grant.get('code') or code}[/bold]")
    console.print(f"Plan: [bold]{entitlement.get('plan_name') or entitlement.get('plan_id') or grant.get('plan_id') or ''}[/bold]")
    if entitlement.get("starts_at"):
        console.print(f"Starts: {entitlement.get('starts_at')}")
    if entitlement.get("expires_at"):
        console.print(f"Expires: {entitlement.get('expires_at')}")
    tags = entitlement.get("tags") or grant.get("tags") or []
    if tags:
        console.print(f"Tags: {', '.join(str(tag) for tag in tags)}")


@app.command("models")
def models(
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON response"),
):
    """List available HyperClaw models."""
    import httpx

    api_base = DEV_API_BASE if dev else PROD_API_BASE
    key = os.getenv("HYPER_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else {}

    # Prefer OpenAI-compatible endpoint, then fallback to legacy.
    urls = [f"{api_base}/v1/models", f"{api_base}/models"]
    payload = None
    source_url = None
    for url in urls:
        try:
            response = httpx.get(url, headers=headers, timeout=15)
            if response.status_code >= 400:
                continue
            payload = response.json()
            source_url = url
            break
        except Exception:
            continue

    if payload is None:
        console.print(
            f"[red]❌ Failed to fetch models from {urls[0]} or {urls[1]} "
            "(set HYPER_API_KEY if endpoint requires auth)[/red]"
        )
        raise typer.Exit(1)

    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        models_data = payload.get("data", [])
    elif isinstance(payload, dict) and isinstance(payload.get("models"), list):
        models_data = payload.get("models", [])
    else:
        console.print("[red]❌ Unexpected models response shape[/red]")
        if json_output:
            console.print_json(json.dumps(payload))
        raise typer.Exit(1)

    if json_output:
        console.print_json(json.dumps({"models": models_data}))
        return

    table = Table(title="HyperClaw Models")
    table.add_column("Model ID", style="cyan")
    table.add_column("Context", style="blue")
    table.add_column("Vision", style="green")
    table.add_column("Tools", style="green")
    table.add_column("Reasoning", style="magenta")

    for model in models_data:
        model_id = str(model.get("id", ""))
        context_length = model.get("context_length", "")
        vision = "yes" if model.get("supports_vision") else "no"
        tools = "yes" if model.get("supports_tools") else "no"
        reasoning = "yes" if model.get("supports_reasoning") else "no"
        table.add_row(model_id, str(context_length), vision, tools, reasoning)

    console.print()
    console.print(table)
    console.print()
    console.print(f"Source: {source_url}")


@app.command("login")
def login(
    api_url: str = typer.Option(None, "--api-url", help="API base URL override"),
):
    """Login to HyperClaw with your wallet.

    Signs a challenge message with your wallet key to authenticate,
    then creates a user-bound API key for agent management.

    Prerequisite: hyper wallet create (if you don't have a wallet yet)

    Flow:
      1. Signs a challenge with your wallet private key
      2. Backend verifies signature, creates/finds your user
      3. Creates an API key bound to your user account
      4. Saves the key to ~/.hypercli/agent-key.json

    After login, you can use:
      hyper agents create    Launch an OpenClaw agent pod
      hyper agents list      List your agents
      hyper agent config      Generate provider configs
    """
    try:
        from eth_account.messages import encode_defunct
        from eth_account import Account
    except ImportError:
        console.print("[red]❌ Wallet dependencies required[/red]")
        console.print("Install with: [bold]pip install 'hypercli-cli[wallet]'[/bold]")
        raise typer.Exit(1)

    import httpx

    # Import wallet loader from wallet module
    from .wallet import load_wallet

    base_url = (api_url or PROD_API_BASE).rstrip("/")

    # Step 1: Load wallet
    account = load_wallet()
    console.print(f"\n[green]✓[/green] Wallet: [bold]{account.address}[/bold]\n")

    # Step 2: Get challenge
    console.print("[bold]Requesting challenge...[/bold]")
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{base_url}/api/auth/wallet/challenge",
            json={"wallet": account.address},
        )
        if resp.status_code != 200:
            console.print(f"[red]❌ Challenge failed: {resp.text}[/red]")
            raise typer.Exit(1)
        challenge = resp.json()

    # Step 3: Sign
    console.print("[bold]Signing...[/bold]")
    message = encode_defunct(text=challenge["message"])
    signed = account.sign_message(message)

    # Step 4: Verify signature and login
    console.print("[bold]Authenticating...[/bold]")
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
        login_data = resp.json()
        jwt_token = login_data["token"]

    console.print("[green]✓[/green] Authenticated\n")

    user_id = login_data.get("user_id", "")
    team_id = login_data.get("team_id", "")
    wallet_addr = login_data.get("wallet_address", account.address)

    # Step 5: Create an agent API key using the JWT
    console.print("[bold]Creating API key...[/bold]")
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{base_url}/api/keys",
            json={"name": "agent-cli"},
            headers={"Authorization": f"Bearer {jwt_token}"},
        )
        if resp.status_code != 200:
            # Save JWT anyway so user can still auth
            jwt_path = HYPERCLI_DIR / "agent-jwt.json"
            HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
            with open(jwt_path, "w") as f:
                json.dump({"token": jwt_token, "user_id": user_id, "team_id": team_id}, f, indent=2)
            console.print(f"[yellow]⚠ Key creation failed: {resp.text}[/yellow]")
            console.print(f"[green]✓[/green] JWT saved to {jwt_path} (use for direct auth)")
            raise typer.Exit(1)

        key_data = resp.json()

    api_key = key_data.get("api_key", key_data.get("key", ""))

    # Step 6: Save as agent key
    HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
    agent_key_data = {
        "key": api_key,
        "plan_id": login_data.get("plan_id", "free"),
        "user_id": user_id,
        "team_id": team_id,
        "wallet_address": wallet_addr,
        "tpm_limit": 0,
        "rpm_limit": 0,
        "expires_at": "",
    }
    with open(AGENT_KEY_PATH, "w") as f:
        json.dump(agent_key_data, f, indent=2)

    console.print(f"[green]✓[/green] API key saved to [bold]{AGENT_KEY_PATH}[/bold]\n")
    console.print(f"  User:    {user_id[:12]}...")
    console.print(f"  Team:    {team_id[:12]}...")
    console.print(f"  Key:     {api_key[:20]}...")
    console.print(f"  Wallet:  {wallet_addr}")
    console.print(f"\n[green]You're all set![/green]")
    console.print(f"  Launch agent:   [bold]hyper agents create[/bold]")
    console.print(f"  Configure:      [bold]hyper config openclaw --apply[/bold]")


OPENCLAW_CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"


def _resolve_api_base(base_url: str | None = None, dev: bool = False) -> str:
    """Resolve API base from flag/env, then fall back to dev/prod defaults."""
    return (
        base_url
        or os.environ.get("HYPER_API_BASE")
        or (DEV_INFERENCE_API_BASE if dev else PROD_INFERENCE_API_BASE)
    ).rstrip("/")


def fetch_models(api_key: str, api_base: str = PROD_INFERENCE_API_BASE) -> list[dict]:
    """Fetch available models from LiteLLM /v1/models (served by HyperClaw)."""
    import httpx

    def _infer_mode(model_id: str) -> str | None:
        normalized = (model_id or "").strip().lower()
        if "embedding" in normalized:
            return "embedding"
        return None

    def _meta_for_model(model_id: str) -> dict:
        normalized = (model_id or "").strip().lower()
        aliases = {
            "kimi-k2.5": {"name": "Kimi K2.5", "reasoning": True, "contextWindow": 262144},
            "moonshotai/kimi-k2.5": {"name": "Kimi K2.5", "reasoning": True, "contextWindow": 262144},
            "glm-5": {"name": "GLM-5", "reasoning": True, "contextWindow": 202752},
            "zai-org/glm-5": {"name": "GLM-5", "reasoning": True, "contextWindow": 202752},
            "qwen3-embedding-4b": {
                "name": "Qwen3 Embedding 4B",
                "reasoning": False,
                "contextWindow": 32768,
                "mode": "embedding",
                "input": ["text"],
            },
        }
        if normalized in aliases:
            return aliases[normalized]
        suffix = normalized.rsplit("/", 1)[-1]
        return aliases.get(suffix, {})

    try:
        resp = httpx.get(
            f"{api_base}/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
        return [
            {
                "id": m["id"],
                "name": _meta_for_model(m["id"]).get("name", m["id"].replace("-", " ").title()),
                "reasoning": _meta_for_model(m["id"]).get("reasoning", False),
                "input": _meta_for_model(m["id"]).get("input", ["text", "image"]),
                "contextWindow": _meta_for_model(m["id"]).get("contextWindow", 200000),
                **({"mode": m.get("mode") or _meta_for_model(m["id"]).get("mode") or _infer_mode(m["id"])} if (m.get("mode") or _meta_for_model(m["id"]).get("mode") or _infer_mode(m["id"])) else {}),
            }
            for m in data
            if m.get("id")
        ]
    except Exception as e:
        console.print(f"[yellow]⚠ Could not fetch models from API: {e}[/yellow]")
        console.print("[yellow]  Using fallback model list[/yellow]")
        return [
            {
                "id": "kimi-k2.5",
                "name": "Kimi K2.5",
                "reasoning": True,
                "input": ["text", "image"],
                "contextWindow": 262144,
            },
            {
                "id": "glm-5",
                "name": "GLM-5",
                "reasoning": True,
                "input": ["text", "image"],
                "contextWindow": 202752,
            },
            {
                "id": "qwen3-embedding-4b",
                "name": "Qwen3 Embedding 4B",
                "reasoning": False,
                "input": ["text"],
                "contextWindow": 32768,
                "mode": "embedding",
            },
        ]


@app.command("openclaw-setup")
def openclaw_setup(
    default: bool = typer.Option(False, "--default", help="Set hyperclaw/kimi-k2.5 as the default model"),
):
    """Patch OpenClaw config with your HyperClaw API key.

    Reads key from ~/.hypercli/agent-key.json, patches only the
    models.providers.hyperclaw section in ~/.openclaw/openclaw.json.
    Everything else in the config is left untouched.
    """

    # Load HyperClaw key
    if not AGENT_KEY_PATH.exists():
        console.print("[red]❌ No HyperClaw key found.[/red]")
        console.print("Run: [bold]hyper agent subscribe basic <amount>[/bold]")
        raise typer.Exit(1)

    with open(AGENT_KEY_PATH) as f:
        api_key = json.load(f).get("key", "")

    if not api_key:
        console.print("[red]❌ Invalid key file — missing 'key' field[/red]")
        raise typer.Exit(1)

    config = {}
    if OPENCLAW_CONFIG_PATH.exists():
        with open(OPENCLAW_CONFIG_PATH) as f:
            config = json.load(f)

    models = fetch_models(api_key, PROD_INFERENCE_API_BASE)
    snippet = _config_openclaw(api_key, models, PROD_INFERENCE_API_BASE)
    if not default:
        defaults = (((snippet.get("agents") or {}).get("defaults") or {}))
        model_cfg = defaults.get("model") or {}
        model_cfg.pop("primary", None)
        if not model_cfg and "model" in defaults:
            defaults.pop("model", None)

    _deep_merge(config, snippet)

    # Write back
    OPENCLAW_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OPENCLAW_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")

    console.print(f"[green]✅ Patched {OPENCLAW_CONFIG_PATH}[/green]")
    providers = ((snippet.get("models") or {}).get("providers") or {})
    for provider_id, provider_cfg in providers.items():
        console.print(f"   provider: {provider_id}  key: {api_key[:16]}...")
        for m in provider_cfg.get("models") or []:
            console.print(f"   model: {provider_id}/{m['id']}")
    primary = ((((snippet.get("agents") or {}).get("defaults") or {}).get("model") or {}).get("primary"))
    if primary:
        console.print(f"   default model: {primary}")
    console.print("\nOpenClaw will use the Anthropic-compatible /v1/messages endpoint.")
    console.print("Run: [bold]openclaw gateway restart[/bold]")


# ---------------------------------------------------------------------------
# hyper agent config — generate / apply provider configs for various tools
# ---------------------------------------------------------------------------

def _resolve_api_key(key: str | None) -> str:
    """Resolve API key from --key flag or ~/.hypercli/agent-key.json."""
    if key:
        return key
    if AGENT_KEY_PATH.exists():
        with open(AGENT_KEY_PATH) as f:
            k = json.load(f).get("key", "")
        if k:
            return k
    console.print("[red]❌ No API key found.[/red]")
    console.print("Either pass [bold]--key sk-...[/bold] or subscribe first:")
    console.print("  [bold]hyper agent subscribe basic[/bold]")
    raise typer.Exit(1)


def _config_openclaw(
    api_key: str,
    models: list[dict],
    api_base: str = PROD_INFERENCE_API_BASE,
    placeholder_env: str | None = None,
) -> dict:
    """OpenClaw openclaw.json provider snippet (LLM only)."""
    def _model_suffix(model_id: str) -> str:
        return str(model_id or "").strip().lower().rsplit("/", 1)[-1]

    def _is_supported_openclaw_model(model: dict) -> bool:
        suffix = _model_suffix(model.get("id", ""))
        return (
            suffix == "glm-5"
            or "kimi" in suffix
            or "embedding" in suffix
        )

    api_base = api_base.rstrip("/")
    supported_models = [m for m in models if _is_supported_openclaw_model(m)]
    chat_models = [m for m in supported_models if m.get("mode") != "embedding"]
    embedding_models = [m for m in supported_models if m.get("mode") == "embedding"]
    kimi_models = [m for m in chat_models if "kimi" in _model_suffix(m.get("id", ""))]
    glm_models = [m for m in chat_models if _model_suffix(m.get("id", "")) == "glm-5"]
    other_chat_models = [
        m for m in chat_models
        if m not in kimi_models and m not in glm_models
    ]
    provider_models = kimi_models + glm_models + other_chat_models
    embedding_model_id = embedding_models[0]["id"] if embedding_models else None
    primary_model = (
        f"hyperclaw/{kimi_models[0]['id']}" if kimi_models else (
            f"hyperclaw/{glm_models[0]['id']}" if glm_models else (
                f"hyperclaw/{other_chat_models[0]['id']}" if other_chat_models else None
            )
        )
    )
    config_api_key = f"${{{placeholder_env}}}" if placeholder_env else api_key
    return {
        "models": {
            "mode": "merge",
            "providers": {
                "hyperclaw": {
                    # OpenClaw/pi-ai appends /v1/messages for anthropic-messages.
                    "baseUrl": api_base,
                    "apiKey": config_api_key,
                    "api": "anthropic-messages",
                    "authHeader": True,
                    "models": provider_models,
                }
            }
        },
        "agents": {
            "defaults": {
                **({"model": {"primary": primary_model}} if primary_model else {}),
                "models": {
                    **{f"hyperclaw/{m['id']}": {"alias": "kimi"} for m in kimi_models},
                    **{f"hyperclaw/{m['id']}": {"alias": "glm"} for m in glm_models},
                    **{f"hyperclaw/{m['id']}": {"alias": m['id'].split('-')[0]} for m in other_chat_models},
                },
                **(
                    {
                        "memorySearch": {
                            "provider": "openai",
                            "model": embedding_model_id,
                            "remote": {
                                "baseUrl": f"{api_base}/v1",
                                "apiKey": config_api_key,
                            },
                        }
                    }
                    if embedding_model_id
                    else {}
                ),
            }
        }
    }


def _config_opencode(api_key: str, models: list[dict], api_base: str = PROD_INFERENCE_API_BASE) -> dict:
    """OpenCode opencode.json provider snippet."""
    api_base = api_base.rstrip("/")
    model_entries = {}
    for m in models:
        model_entries[m["id"]] = {"name": m["id"]}
    return {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "hypercli": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "HyperCLI",
                "options": {
                    "baseURL": f"{api_base}/v1",
                    "apiKey": api_key,
                },
                "models": model_entries,
            }
        }
    }


def _config_env(api_key: str, models: list[dict], api_base: str = PROD_INFERENCE_API_BASE) -> str:
    """Shell env vars for generic OpenAI-compatible tools."""
    api_base = api_base.rstrip("/")
    lines = [
        f'export OPENAI_API_KEY="{api_key}"',
        f'export OPENAI_BASE_URL="{api_base}/v1"',
        f'# Available models: {", ".join(m["id"] for m in models)}',
    ]
    return "\n".join(lines)


@app.command("exec")
def exec_cmd(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
    command: str = typer.Argument(..., help="Command to execute"),
    timeout: int = typer.Option(30, "--timeout", "-t", help="Command timeout (seconds)"),
):
    """Execute a command on a `hypercli-openclaw` agent container."""
    from . import agents

    agents.exec_cmd(agent_id=agent_id, command=command, timeout=timeout)


@app.command("shell")
def shell_cmd(
    agent_id: str = typer.Argument(..., help="Agent ID (or prefix)"),
):
    """Open an interactive shell on a `hypercli-openclaw` agent container."""
    from . import agents

    agents.shell(agent_id=agent_id)


FORMAT_CHOICES = ["openclaw", "opencode", "env"]


@app.command("config")
def config_cmd(
    format: str = typer.Argument(
        None,
        help=f"Output format: {', '.join(FORMAT_CHOICES)}. Omit to show all.",
    ),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...). Falls back to ~/.hypercli/agent-key.json"),
    base_url: str = typer.Option(None, "--base-url", help="HyperClaw API base URL. Falls back to HYPER_API_BASE, then --dev/prod defaults"),
    placeholder_env: str = typer.Option(None, "--placeholder-env", help="Write ${ENV_VAR} placeholders into generated config instead of literal API keys"),
    apply: bool = typer.Option(False, "--apply", help="Write config to the appropriate file (openclaw/opencode only)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Generate provider configs for OpenClaw, OpenCode, and other tools.

    Examples:
      hyper agent config                          # Show all configs
      hyper config openclaw                       # OpenClaw snippet
      hyper agent config opencode --key sk-...    # OpenCode with explicit key
      hyper config openclaw --base-url https://api.dev.hypercli.com
      hyper config openclaw --apply               # Write directly to openclaw.json
      hyper agent config env                      # Shell export lines
    """
    api_key = _resolve_api_key(key)
    api_base = _resolve_api_base(base_url, dev)

    # Validate key & fetch models
    console.print(f"[dim]Validating key against {api_base}...[/dim]")
    models = fetch_models(api_key, api_base)
    model_names = ", ".join(m["id"] for m in models)
    console.print(f"[green]✓[/green] Key valid — models: [bold]{model_names}[/bold]\n")

    formats = [format] if format else FORMAT_CHOICES
    for fmt in formats:
        if fmt not in FORMAT_CHOICES:
            console.print(f"[red]Unknown format: {fmt}[/red]")
            console.print(f"Choose from: {', '.join(FORMAT_CHOICES)}")
            raise typer.Exit(1)

    for fmt in formats:
        if fmt == "openclaw":
            snippet = _config_openclaw(api_key, models, api_base, placeholder_env=placeholder_env)
            _show_snippet("OpenClaw", "~/.openclaw/openclaw.json", snippet, apply, OPENCLAW_CONFIG_PATH)
        elif fmt == "opencode":
            snippet = _config_opencode(api_key, models, api_base)
            target = Path.cwd() / "opencode.json"
            _show_snippet("OpenCode", "opencode.json", snippet, apply, target)
        elif fmt == "env":
            console.print("[bold]── Shell Environment ──[/bold]")
            console.print(_config_env(api_key, models, api_base))
            console.print()


def _show_snippet(name: str, path_hint: str, data: dict, apply: bool, target_path: Path):
    """Print a JSON snippet and optionally apply it."""
    console.print(f"[bold]── {name} ({path_hint}) ──[/bold]")
    formatted = json.dumps(data, indent=2)
    console.print(formatted)
    console.print()

    if apply:
        if target_path.exists():
            with open(target_path) as f:
                existing = json.load(f)
            if name == "OpenClaw":
                merged = _merge_openclaw_config(existing, data)
            else:
                _deep_merge(existing, data)
                merged = existing
        else:
            merged = data

        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "w") as f:
            json.dump(merged, f, indent=2)
            f.write("\n")
        console.print(f"[green]✅ Written to {target_path}[/green]\n")
        if name == "OpenClaw":
            _refresh_openclaw_runtime()


def _refresh_openclaw_runtime():
    """Best-effort refresh of OpenClaw generated runtime state after config changes."""
    if shutil.which("openclaw") is None:
        console.print("[yellow]⚠[/yellow] OpenClaw CLI not found in PATH.")
        console.print("Run after install: [bold]openclaw models list[/bold]")
        console.print("Then restart when ready: [bold]openclaw gateway restart[/bold]\n")
        return

    try:
        subprocess.run(
            ["openclaw", "models", "list"],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        console.print("[green]✓[/green] Regenerated OpenClaw model cache.")
    except Exception:
        console.print("[yellow]⚠[/yellow] Could not regenerate OpenClaw model cache automatically.")
        console.print("Run manually: [bold]openclaw models list[/bold]")
    console.print("Restart when ready: [bold]openclaw gateway restart[/bold]\n")


def _deep_merge(base: dict, overlay: dict):
    """Recursively merge overlay into base (mutates base)."""
    for k, v in overlay.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def _merge_openclaw_config(existing: dict, snippet: dict) -> dict:
    """Merge OpenClaw config while replacing generated provider/model sections exactly."""
    merged = dict(existing)
    _deep_merge(merged, snippet)

    snippet_models = ((snippet.get("models") or {}).get("providers") or {})
    if snippet_models:
        merged.setdefault("models", {})
        merged["models"]["providers"] = snippet_models

    snippet_defaults = (((snippet.get("agents") or {}).get("defaults") or {}).get("models") or {})
    if snippet_defaults:
        merged.setdefault("agents", {})
        merged["agents"].setdefault("defaults", {})
        merged["agents"]["defaults"]["models"] = snippet_defaults

    snippet_model_config = (((snippet.get("agents") or {}).get("defaults") or {}).get("model") or {})
    if snippet_model_config:
        merged.setdefault("agents", {})
        merged["agents"].setdefault("defaults", {})
        merged["agents"]["defaults"]["model"] = snippet_model_config

    return merged
