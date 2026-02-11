"""HyperClaw onboarding flow — TUI + JSON mode"""
import asyncio
import json
import os
import getpass
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from decimal import Decimal

import typer
from rich.console import Console
from rich.table import Table

console = Console()

# Paths
HYPERCLI_DIR = Path.home() / ".hypercli"
ONBOARD_DIR = HYPERCLI_DIR / "onboard"
STATE_PATH = ONBOARD_DIR / "state.json"
QR_PATH = ONBOARD_DIR / "wallet_qr.png"
WALLET_PATH = HYPERCLI_DIR / "wallet.json"
CLAW_KEY_PATH = HYPERCLI_DIR / "claw-key.json"
OPENCLAW_CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"

PROD_API_BASE = "https://api.hyperclaw.app"
DEV_API_BASE = "https://dev-api.hyperclaw.app"

BASE_RPC = "https://mainnet.base.org"
USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

TOTAL_STEPS = 6


def _require_deps():
    """Check wallet/x402 deps are available."""
    try:
        from web3 import Web3
        from eth_account import Account
        from x402 import x402Client
        return True
    except ImportError:
        console.print("[red]❌ Onboarding requires wallet + x402 dependencies[/red]")
        console.print("\nInstall with:")
        console.print('  [bold]pip install "hypercli-cli[all]"[/bold]')
        raise typer.Exit(1)


def _load_state() -> dict:
    """Load onboard state from disk."""
    if STATE_PATH.exists():
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"version": 1, "current_step": "wallet", "steps": {}}


def _save_state(state: dict):
    """Write state to disk."""
    ONBOARD_DIR.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.utcnow().isoformat() + "Z"
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def _step_done(state: dict, step: str) -> bool:
    return state.get("steps", {}).get(step, {}).get("status") == "complete"


def _mark_step(state: dict, step: str, data: dict):
    state.setdefault("steps", {})[step] = {**data, "status": "complete"}
    state["current_step"] = step
    _save_state(state)


def _get_usdc_balance(address: str) -> Decimal:
    """Check USDC balance on Base."""
    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(BASE_RPC))
    usdc_abi = [{
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    }]
    usdc = w3.eth.contract(address=USDC_CONTRACT, abi=usdc_abi)
    raw = usdc.functions.balanceOf(address).call()
    return Decimal(raw) / Decimal("1000000")


def _step_header(num: int, name: str):
    console.print(f"\n[bold]Step {num}/{TOTAL_STEPS} — {name}[/bold]\n")


# ============================================================
# Step 1: Wallet
# ============================================================
def step_wallet(state: dict, json_mode: bool) -> dict:
    from eth_account import Account

    if _step_done(state, "wallet") and WALLET_PATH.exists():
        with open(WALLET_PATH) as f:
            addr = "0x" + json.load(f).get("address", "")
        if not json_mode:
            _step_header(1, "Wallet")
            console.print(f"[green]✓[/green] Wallet: [bold]{addr}[/bold] (existing)")
        _mark_step(state, "wallet", {"address": addr})
        return state

    if WALLET_PATH.exists():
        with open(WALLET_PATH) as f:
            addr = "0x" + json.load(f).get("address", "")
        if not json_mode:
            _step_header(1, "Wallet")
            console.print(f"[green]✓[/green] Wallet: [bold]{addr}[/bold] (existing)")
        _mark_step(state, "wallet", {"address": addr})
        return state

    if not json_mode:
        _step_header(1, "Wallet")
        console.print("No wallet found. Creating one...\n")

    # Get passphrase
    passphrase_env = os.getenv("HYPERCLI_WALLET_PASSPHRASE")
    if passphrase_env:
        passphrase = passphrase_env
    elif json_mode:
        # In JSON mode, use empty passphrase
        passphrase = ""
    else:
        passphrase = getpass.getpass("Set a passphrase (or Enter for none): ")
        if passphrase:
            confirm = getpass.getpass("Confirm: ")
            if passphrase != confirm:
                console.print("[red]❌ Passphrases don't match![/red]")
                raise typer.Exit(1)

    account = Account.create()
    keystore = account.encrypt(passphrase)

    HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
    with open(WALLET_PATH, "w") as f:
        json.dump(keystore, f, indent=2)
    os.chmod(WALLET_PATH, 0o600)

    if not json_mode:
        console.print(f"[green]✓[/green] Wallet: [bold]{account.address}[/bold]")
        console.print(f"[green]✓[/green] Saved to {WALLET_PATH}")

    _mark_step(state, "wallet", {"address": account.address})
    return state


# ============================================================
# Step 2: Fund wallet
# ============================================================
def step_fund(state: dict, json_mode: bool, poll_interval: int = 10) -> dict:
    wallet_addr = state["steps"]["wallet"]["address"]

    # Generate QR
    ONBOARD_DIR.mkdir(parents=True, exist_ok=True)
    try:
        import qrcode
        qr_obj = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L,
                                box_size=10, border=2)
        qr_obj.add_data(wallet_addr)
        qr_obj.make(fit=True)
        img = qr_obj.make_image(fill_color="black", back_color="white")
        img.save(str(QR_PATH))
    except ImportError:
        pass

    balance = _get_usdc_balance(wallet_addr)

    if balance > 0:
        if not json_mode:
            _step_header(2, "Fund wallet")
            console.print(f"[green]✓[/green] Balance: [bold]${balance:.2f} USDC[/bold] (skip)")
        _mark_step(state, "funding", {"balance": str(balance), "address": wallet_addr,
                                       "qr_path": str(QR_PATH)})
        return state

    if not json_mode:
        _step_header(2, "Fund wallet")
        console.print(f"Send USDC on [bold]Base[/bold] to:\n")
        console.print(f"  [bold]{wallet_addr}[/bold]\n")

        # Show ASCII QR if possible
        try:
            import qrcode
            qr_obj = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L,
                                    box_size=1, border=1)
            qr_obj.add_data(wallet_addr)
            qr_obj.make(fit=True)
            qr_obj.print_ascii(invert=True)
            console.print()
        except ImportError:
            pass

        if QR_PATH.exists():
            console.print(f"[dim]QR saved: {QR_PATH}[/dim]\n")

        console.print("Waiting for funds (Ctrl+C to resume later)\n")

    # Save intermediate state so agent can pick up QR path
    state.setdefault("steps", {})["funding"] = {
        "status": "waiting",
        "address": wallet_addr,
        "balance": "0.00",
        "qr_path": str(QR_PATH),
    }
    state["current_step"] = "funding"
    _save_state(state)

    # Poll
    while True:
        balance = _get_usdc_balance(wallet_addr)
        if balance > 0:
            if not json_mode:
                console.print(f"  ${balance:.2f} [green]✓[/green]")
                console.print(f"\n[green]✓[/green] Balance: [bold]${balance:.2f} USDC[/bold]")
            _mark_step(state, "funding", {"balance": str(balance), "address": wallet_addr,
                                           "qr_path": str(QR_PATH)})
            return state
        else:
            if not json_mode:
                console.print(f"  ${balance:.2f} ⏳")
            # Update state file for agent polling
            state["steps"]["funding"]["balance"] = str(balance)
            _save_state(state)
        time.sleep(poll_interval)


# ============================================================
# Step 3: Choose plan
# ============================================================
def step_plan(state: dict, json_mode: bool, api_base: str,
              plan_override: str = None, amount_override: str = None) -> dict:
    import httpx

    if _step_done(state, "plan"):
        plan_data = state["steps"]["plan"]
        if not json_mode:
            _step_header(3, "Choose plan")
            console.print(f"[green]✓[/green] Plan: {plan_data['plan']} — ${plan_data['amount']} USDC (skip)")
        return state

    # Fetch plans from API
    try:
        resp = httpx.get(f"{api_base}/api/plans", timeout=10)
        resp.raise_for_status()
        plans = resp.json().get("plans", [])
    except Exception as e:
        console.print(f"[red]❌ Failed to fetch plans: {e}[/red]")
        raise typer.Exit(1)

    if not json_mode:
        _step_header(3, "Choose plan")

        table = Table(show_header=True, header_style="bold")
        table.add_column("Plan", style="cyan")
        table.add_column("Name", style="green")
        table.add_column("Price", style="yellow")
        table.add_column("TPM", style="magenta")
        table.add_column("RPM", style="magenta")

        for p in plans:
            table.add_row(
                p["id"],
                p["name"],
                f"${p['price']}/mo",
                f"{p['tpm_limit']:,}",
                f"{p['rpm_limit']:,}",
            )
        console.print(table)
        console.print()

    # Select plan
    if plan_override:
        plan_id = plan_override
    elif json_mode:
        plan_id = "1aiu"
    else:
        plan_id = typer.prompt("Select plan", default="1aiu")

    # Find plan details
    plan_info = next((p for p in plans if p["id"] == plan_id), None)
    if not plan_info:
        console.print(f"[red]❌ Unknown plan: {plan_id}[/red]")
        raise typer.Exit(1)

    # Amount
    default_amount = str(plan_info["price"])
    if amount_override:
        amount = amount_override
    elif json_mode:
        amount = default_amount
    else:
        amount = typer.prompt("Payment amount", default=f"${default_amount}").replace("$", "")

    if not json_mode:
        console.print(f"\n[green]✓[/green] Plan: {plan_id} ({plan_info['name']}) — ${amount} USDC")

    _mark_step(state, "plan", {"plan": plan_id, "amount": amount, "name": plan_info["name"],
                                "tpm": plan_info["tpm_limit"], "rpm": plan_info["rpm_limit"]})
    return state


# ============================================================
# Step 4: Subscribe
# ============================================================
def step_subscribe(state: dict, json_mode: bool, api_base: str) -> dict:
    if _step_done(state, "subscribe"):
        sub = state["steps"]["subscribe"]
        if not json_mode:
            _step_header(4, "Subscribe")
            console.print(f"[green]✓[/green] Already subscribed — key: {sub['key'][:20]}... (skip)")
        return state

    from .wallet import load_wallet
    from .claw import _subscribe_async

    plan_data = state["steps"]["plan"]
    plan_id = plan_data["plan"]
    amount = plan_data["amount"]

    if not json_mode:
        _step_header(4, "Subscribe")

    account = load_wallet()

    if not json_mode:
        console.print(f"[green]✓[/green] Wallet loaded: {account.address}\n")

    result = asyncio.run(_subscribe_async(account, plan_id, api_base, amount))

    if not result:
        console.print("[red]❌ Subscription failed[/red]")
        raise typer.Exit(1)

    # Save key
    HYPERCLI_DIR.mkdir(parents=True, exist_ok=True)
    with open(CLAW_KEY_PATH, "w") as f:
        json.dump(result, f, indent=2)

    # Save to key history
    try:
        import yaml
        history_entry = {
            "key": result["key"],
            "plan": result["plan_id"],
            "amount_usdc": result.get("amount_paid", ""),
            "date": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            "expires": result.get("expires_at", ""),
            "tpm_limit": result.get("tpm_limit", 0),
            "rpm_limit": result.get("rpm_limit", 0),
        }
        keys_path = HYPERCLI_DIR / "claw-keys.yaml"
        if keys_path.exists():
            with open(keys_path) as f:
                keys_data = yaml.safe_load(f) or {"keys": []}
        else:
            keys_data = {"keys": []}
        keys_data["keys"].append(history_entry)
        with open(keys_path, "w") as f:
            yaml.dump(keys_data, f, default_flow_style=False, sort_keys=False)
    except ImportError:
        pass

    if not json_mode:
        console.print(f"\n[green]✅ Subscribed![/green]")
        console.print(f"  Key:     [bold]{result['key']}[/bold]")
        console.print(f"  Plan:    {result['plan_id']}")
        console.print(f"  Expires: {result.get('expires_at', 'N/A')}")
        console.print(f"  Limits:  {result.get('tpm_limit', 0):,} TPM / {result.get('rpm_limit', 0):,} RPM")
        console.print(f"\n[green]✓[/green] Key saved to {CLAW_KEY_PATH}")

    _mark_step(state, "subscribe", {
        "key": result["key"],
        "plan": result["plan_id"],
        "expires": result.get("expires_at", ""),
        "tpm": result.get("tpm_limit", 0),
        "rpm": result.get("rpm_limit", 0),
    })
    return state


# ============================================================
# Step 5: Configure OpenClaw
# ============================================================
def step_configure(state: dict, json_mode: bool, api_base: str) -> dict:
    if _step_done(state, "configure"):
        cfg = state["steps"]["configure"]
        if not json_mode:
            _step_header(5, "Configure OpenClaw")
            console.print(f"[green]✓[/green] Already configured (skip)")
        return state

    api_key = state["steps"]["subscribe"]["key"]

    if not json_mode:
        _step_header(5, "Configure OpenClaw")

    if not OPENCLAW_CONFIG_PATH.exists():
        if not json_mode:
            console.print("[yellow]⚠[/yellow] OpenClaw not detected (no ~/.openclaw/openclaw.json)")
            console.print(f"  Configure manually later:\n")
            console.print(f"  Base URL: {api_base}/v1")
            console.print(f"  API Key:  {api_key}")
        _mark_step(state, "configure", {"status": "complete", "openclaw_detected": False})
        return state

    # Fetch models
    if not json_mode:
        console.print("Detected OpenClaw config at ~/.openclaw/openclaw.json")
        console.print("Fetching available models... ", end="")

    from .claw import fetch_models
    models = fetch_models(api_key, api_base)

    if not json_mode:
        console.print("[green]✓[/green]")
        for m in models:
            console.print(f"  Model: {m['id']}")
        console.print()

    # Read existing config
    with open(OPENCLAW_CONFIG_PATH) as f:
        config = json.load(f)

    # Patch
    config.setdefault("models", {}).setdefault("providers", {})
    config["models"]["providers"]["hyperclaw"] = {
        "baseUrl": f"{api_base}/v1",
        "apiKey": api_key,
        "api": "openai-completions",
        "models": models,
    }

    if not json_mode:
        console.print("Patching config... [green]✓[/green]")

    # Ask about default model
    set_default = False
    if models:
        if json_mode:
            set_default = True
        else:
            set_default = typer.confirm("Set as default model?", default=True)

    default_model = None
    if set_default and models:
        default_model = f"hyperclaw/{models[0]['id']}"
        config.setdefault("agents", {}).setdefault("defaults", {}).setdefault("model", {})
        config["agents"]["defaults"]["model"]["primary"] = default_model
        if not json_mode:
            console.print(f"\n[green]✓[/green] Provider: hyperclaw added")
            console.print(f"[green]✓[/green] Default model: {default_model}")
    else:
        if not json_mode:
            console.print(f"\n[green]✓[/green] Provider: hyperclaw added")

    # Write config
    with open(OPENCLAW_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")

    _mark_step(state, "configure", {
        "openclaw_detected": True,
        "config_path": str(OPENCLAW_CONFIG_PATH),
        "default_model": default_model,
        "models": [m["id"] for m in models],
    })
    return state


# ============================================================
# Step 6: Verify + Restart
# ============================================================
def step_verify(state: dict, json_mode: bool, api_base: str) -> dict:
    import httpx

    api_key = state["steps"]["subscribe"]["key"]

    if not json_mode:
        _step_header(6, "Verify")
        console.print("Testing inference against kimi-k2.5...\n")

    try:
        start = time.time()
        resp = httpx.post(
            f"{api_base}/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "kimi-k2.5",
                "messages": [{"role": "user", "content": "What is 2+2? Answer with just the number."}],
                "max_tokens": 32,
            },
            timeout=30,
        )
        elapsed = time.time() - start
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"].strip()
        tokens = data.get("usage", {}).get("total_tokens", 0)

        if not json_mode:
            console.print(f'  → "What is 2+2?"')
            console.print(f'  ← "{content}"  ({elapsed:.1f}s, {tokens} tokens)\n')
            console.print("[green]✅ All good![/green]")

        _mark_step(state, "verify", {"model": "kimi-k2.5", "latency_ms": int(elapsed * 1000),
                                      "tokens": tokens, "response": content})

    except Exception as e:
        if not json_mode:
            console.print(f"[yellow]⚠[/yellow] Inference test failed: {e}")
            console.print("  Key may need a moment to propagate. Try:")
            console.print("    hyper claw onboard")
        _mark_step(state, "verify", {"status": "complete", "error": str(e)})

    # Restart OpenClaw
    openclaw_detected = state.get("steps", {}).get("configure", {}).get("openclaw_detected", False)
    if openclaw_detected:
        do_restart = False
        if json_mode:
            do_restart = True
        else:
            console.print()
            do_restart = typer.confirm("Restart OpenClaw now?", default=True)

        if do_restart:
            if not json_mode:
                console.print("Restarting... ", end="")
            try:
                subprocess.run(["openclaw", "gateway", "restart"], capture_output=True, timeout=10)
                if not json_mode:
                    console.print("[green]✓[/green]")
            except Exception as e:
                if not json_mode:
                    console.print(f"[yellow]⚠ {e}[/yellow]")
                    console.print("  Run manually: [bold]openclaw gateway restart[/bold]")
        else:
            if not json_mode:
                console.print("\n  Run when ready: [bold]openclaw gateway restart[/bold]")

    # Final banner
    sub = state["steps"]["subscribe"]
    if not json_mode:
        console.print(f"\n{'─' * 40}\n")
        console.print(f"  🐾 [bold]HyperClaw is ready.[/bold]\n")
        console.print(f"  API:     {api_base}/v1")
        console.print(f"  Model:   kimi-k2.5")
        console.print(f"  Key:     {sub['key'][:20]}...")
        console.print(f"  Expires: {sub['expires']}")
        console.print(f"\n  Check status:  [bold]hyper claw status[/bold]")
        console.print(f"\n{'─' * 40}")

    state["current_step"] = "done"
    _save_state(state)
    return state


# ============================================================
# Main onboard command
# ============================================================
def onboard(
    json_mode: bool = typer.Option(False, "--json", help="JSON mode — write state to disk, minimal stdout"),
    plan: str = typer.Option(None, "--plan", help="Plan ID (skip prompt)"),
    amount: str = typer.Option(None, "--amount", help="USDC amount (skip prompt)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    reset: bool = typer.Option(False, "--reset", help="Start fresh (delete state)"),
    status: bool = typer.Option(False, "--status", help="Show current onboard state and exit"),
    poll_interval: int = typer.Option(10, "--poll", help="Balance poll interval in seconds"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Walk through all steps without making changes"),
):
    """Guided onboarding: wallet → fund → plan → subscribe → configure → verify"""

    if status:
        state = _load_state()
        console.print(json.dumps(state, indent=2))
        raise typer.Exit(0)

    if reset:
        if STATE_PATH.exists():
            STATE_PATH.unlink()
        console.print("[green]✓[/green] Onboard state cleared")
        raise typer.Exit(0)

    if not dry_run:
        _require_deps()

    api_base = DEV_API_BASE if dev else PROD_API_BASE

    if dry_run:
        _run_dry(api_base, plan_override=plan, amount_override=amount)
        return

    state = _load_state()

    if not json_mode:
        console.print("\n[bold]🐾 HyperClaw Onboarding[/bold]\n")

    # Run steps in order, skipping completed ones
    state = step_wallet(state, json_mode)
    state = step_fund(state, json_mode, poll_interval)
    state = step_plan(state, json_mode, api_base, plan_override=plan, amount_override=amount)
    state = step_subscribe(state, json_mode, api_base)
    state = step_configure(state, json_mode, api_base)
    state = step_verify(state, json_mode, api_base)


def _run_dry(api_base: str, plan_override: str = None, amount_override: str = None):
    """Walk through the full onboard flow without making any changes."""
    import httpx

    console.print("\n[bold]🐾 HyperClaw Onboarding (dry run)[/bold]\n")
    console.print("[dim]No changes will be made.[/dim]\n")

    # Step 1: Wallet
    _step_header(1, "Wallet")
    if WALLET_PATH.exists():
        with open(WALLET_PATH) as f:
            addr = "0x" + json.load(f).get("address", "")
        console.print(f"[green]✓[/green] Wallet: [bold]{addr}[/bold] (existing)")
    else:
        console.print("[yellow]→[/yellow] Would create new wallet at ~/.hypercli/wallet.json")
        addr = "0x0000000000000000000000000000000000000000"

    # Step 2: Fund
    _step_header(2, "Fund wallet")
    if WALLET_PATH.exists():
        try:
            balance = _get_usdc_balance(addr)
            console.print(f"  Address: [bold]{addr}[/bold]")
            console.print(f"  Balance: [bold]${balance:.2f} USDC[/bold]")
            if balance == 0:
                console.print("[yellow]→[/yellow] Would poll every 10s until funded")
            else:
                console.print(f"[green]✓[/green] Already funded")
        except Exception:
            console.print(f"  Address: [bold]{addr}[/bold]")
            console.print("[yellow]→[/yellow] Would poll balance until funded")
    else:
        console.print("[yellow]→[/yellow] Would show QR code and poll balance")
    console.print(f"  QR path: {QR_PATH}")

    # Step 3: Plan
    _step_header(3, "Choose plan")
    try:
        resp = httpx.get(f"{api_base}/api/plans", timeout=10)
        resp.raise_for_status()
        plans = resp.json().get("plans", [])

        from rich.table import Table
        table = Table(show_header=True, header_style="bold")
        table.add_column("Plan", style="cyan")
        table.add_column("Name", style="green")
        table.add_column("Price", style="yellow")
        table.add_column("TPM", style="magenta")
        table.add_column("RPM", style="magenta")
        for p in plans:
            table.add_row(p["id"], p["name"], f"${p['price']}/mo",
                          f"{p['tpm_limit']:,}", f"{p['rpm_limit']:,}")
        console.print(table)

        plan_id = plan_override or "1aiu"
        plan_info = next((p for p in plans if p["id"] == plan_id), plans[0] if plans else None)
        amt = amount_override or str(plan_info["price"]) if plan_info else "35"
        console.print(f"\n[green]✓[/green] Would select: {plan_id} ({plan_info['name'] if plan_info else '?'}) — ${amt} USDC")
    except Exception as e:
        console.print(f"[yellow]⚠ Could not fetch plans: {e}[/yellow]")
        console.print("[yellow]→[/yellow] Would prompt for plan selection")

    # Step 4: Subscribe
    _step_header(4, "Subscribe")
    console.print("[yellow]→[/yellow] Would sign x402 payment and submit")
    console.print("[yellow]→[/yellow] Would save key to ~/.hypercli/claw-key.json")
    if CLAW_KEY_PATH.exists():
        with open(CLAW_KEY_PATH) as f:
            existing = json.load(f)
        console.print(f"  [dim]Existing key: {existing.get('key', '?')[:20]}...[/dim]")

    # Step 5: Configure
    _step_header(5, "Configure OpenClaw")
    if OPENCLAW_CONFIG_PATH.exists():
        console.print(f"[green]✓[/green] OpenClaw detected at {OPENCLAW_CONFIG_PATH}")
        console.print("[yellow]→[/yellow] Would patch models.providers.hyperclaw")
        console.print("[yellow]→[/yellow] Would prompt to set default model")
    else:
        console.print("[yellow]⚠[/yellow] OpenClaw not detected")
        console.print("[yellow]→[/yellow] Would skip, show manual config instructions")

    # Step 6: Verify
    _step_header(6, "Verify")
    console.print("[yellow]→[/yellow] Would test inference: \"What is 2+2?\"")
    console.print("[yellow]→[/yellow] Would prompt to restart OpenClaw")

    # Summary
    console.print(f"\n{'─' * 40}")
    console.print(f"\n  [bold]Dry run complete.[/bold] No changes made.")
    console.print(f"  Run [bold]hyper claw onboard[/bold] to start for real.\n")
    console.print(f"{'─' * 40}")
