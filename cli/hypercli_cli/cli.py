"""HyperCLI - Main entry point"""
import sys
import json
import typer
from rich.console import Console
from rich.prompt import Prompt
from rich.table import Table

from hypercli import HyperCLI, APIError, configure
from hypercli.config import CONFIG_FILE

from . import agent, agents, billing, comfyui, files, flow, instances, jobs, keys, llm, user, wallet
from .output import output, spinner

console = Console()


def fuzzy_match(input_str: str, options: list[str], threshold: float = 0.5) -> list[str]:
    """Find similar strings using multiple heuristics"""
    def similarity(a: str, b: str) -> float:
        a, b = a.lower(), b.lower()
        if a == b:
            return 1.0

        # Exact substring match
        if a in b or b in a:
            return 0.9

        # Same characters (handles transpositions like rtx6000pro vs rtxpro6000)
        if sorted(a) == sorted(b):
            return 0.95

        # Character set overlap
        set_a, set_b = set(a), set(b)
        common = set_a & set_b
        jaccard = len(common) / len(set_a | set_b) if set_a | set_b else 0

        # Prefix match bonus
        prefix_len = 0
        for ca, cb in zip(a, b):
            if ca == cb:
                prefix_len += 1
            else:
                break
        prefix_bonus = prefix_len / max(len(a), len(b)) * 0.3

        return jaccard + prefix_bonus

    matches = [(opt, similarity(input_str, opt)) for opt in options]
    matches = [(opt, score) for opt, score in matches if score >= threshold]
    matches.sort(key=lambda x: x[1], reverse=True)
    return [opt for opt, _ in matches[:3]]

app = typer.Typer(
    name="hyper",
    help="HyperCLI - GPU orchestration, flows, and x402 tooling",
    no_args_is_help=True,
    rich_markup_mode="rich",
)
config_app = typer.Typer(
    help="Generate config for OpenClaw and other tools",
    no_args_is_help=True,
    rich_markup_mode="rich",
)

# Register subcommands
app.add_typer(agents.app, name="agents")
app.add_typer(agent.app, name="agent")
app.add_typer(config_app, name="config")
app.add_typer(billing.app, name="billing")
app.add_typer(comfyui.app, name="comfyui")
app.add_typer(files.app, name="files")
app.add_typer(flow.app, name="flow")
app.add_typer(instances.app, name="instances")
app.add_typer(keys.app, name="keys")
app.add_typer(jobs.app, name="jobs")
app.add_typer(llm.app, name="llm")
app.add_typer(user.app, name="user")
app.add_typer(wallet.app, name="wallet")


@config_app.command("openclaw")
def config_openclaw_cmd(
    key: str = typer.Option(None, "--key", "-k", help="API key. Falls back to ~/.hypercli/agent-key.json"),
    base_url: str = typer.Option(None, "--base-url", help="HyperClaw API base URL. Falls back to HYPER_API_BASE, then --dev/prod defaults"),
    placeholder_env: str = typer.Option(None, "--placeholder-env", help="Write ${ENV_VAR} placeholders into generated config instead of literal API keys"),
    apply: bool = typer.Option(False, "--apply", help="Write directly to ~/.openclaw/openclaw.json"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Generate or apply OpenClaw config."""
    agent.config_cmd(
        format="openclaw",
        key=key,
        base_url=base_url,
        placeholder_env=placeholder_env,
        apply=apply,
        dev=dev,
    )


@app.command("me")
def me_cmd(
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Resolve the current auth context and show key capabilities."""
    client = HyperCLI()
    with spinner("Resolving auth context..."):
        auth_me = client.user.auth_me()
    if fmt == "json":
        output(auth_me, fmt)
        return

    table = Table(show_header=False, box=None)
    table.add_column("Key", style="bold cyan")
    table.add_column("Value")
    table.add_row("user_id", auth_me.user_id)
    table.add_row("orchestra_user_id", str(auth_me.orchestra_user_id or ""))
    table.add_row("team_id", auth_me.team_id)
    table.add_row("plan_id", auth_me.plan_id)
    table.add_row("email", str(auth_me.email or ""))
    table.add_row("auth_type", auth_me.auth_type)
    has_active_subscription = bool(getattr(auth_me, "has_active_subscription", False))
    table.add_row("has_active_subscription", "yes" if has_active_subscription else "no")
    table.add_row("key_id", str(getattr(auth_me, "key_id", None) or ""))
    table.add_row("key_name", str(getattr(auth_me, "key_name", None) or ""))
    raw_capabilities = list(getattr(auth_me, "capabilities", []) or [])
    capabilities = "\n".join(raw_capabilities) if raw_capabilities else ""
    table.add_row("capabilities", capabilities)
    console.print(table)


@app.command("configure")
def configure_cmd():
    """Configure HyperCLI with your API key and API URL"""
    import getpass
    from hypercli.config import get_api_key, get_api_url, DEFAULT_API_URL

    console.print("\n[bold cyan]HyperCLI Configuration[/bold cyan]\n")

    # Show current config
    current_key = get_api_key()
    current_url = get_api_url()

    if current_key:
        key_preview = current_key[:4] + "..." + current_key[-4:] if len(current_key) > 8 else "****"
        console.print(f"Current API key: [dim]{key_preview}[/dim]")
    if current_url and current_url != DEFAULT_API_URL:
        console.print(f"Current API URL: [dim]{current_url}[/dim]")

    console.print()
    console.print("Get your API key at [link=https://hypercli.com/dashboard]hypercli.com/dashboard[/link]\n")

    # API Key
    api_key = getpass.getpass("API key (enter to keep current): ") if current_key else getpass.getpass("API key: ")
    api_key = api_key.strip() if api_key else None

    if not api_key and not current_key:
        console.print("[red]No API key provided[/red]")
        raise typer.Exit(1)

    # API URL
    url_prompt = f"API URL (enter for default, current: {current_url}): " if current_url != DEFAULT_API_URL else "API URL (enter for default): "
    api_url = Prompt.ask(url_prompt, default="")
    api_url = api_url.strip() if api_url else None

    # Only update what changed
    final_key = api_key or current_key
    final_url = api_url if api_url else (current_url if current_url != DEFAULT_API_URL else None)

    configure(final_key, final_url)

    console.print(f"\n[green]✓[/green] Config saved to {CONFIG_FILE}")
    if api_key:
        preview = api_key[:4] + "..." + api_key[-4:] if len(api_key) > 8 else "****"
        console.print(f"  API key: {preview}")
    if final_url:
        console.print(f"  API URL: {final_url}")
    console.print("\nTest your setup with: [cyan]hyper billing balance[/cyan]\n")


@app.callback()
def main(
    version: bool = typer.Option(False, "--version", "-v", help="Show version"),
):
    """
    [bold cyan]HyperCLI[/bold cyan] - GPU orchestration, flows, and x402 tooling

    Set your API key: [green]hyper configure[/green]

    Get started:
        hyper instances list      Browse available GPUs
        hyper instances launch    Launch a GPU instance
        hyper jobs list           View your running jobs
        hyper agent plans         View HyperClaw plans
    """
    if version:
        from . import __version__
        console.print(f"hyper version {__version__}")
        raise typer.Exit()


def cli():
    """Entry point with error handling"""
    try:
        app()
    except APIError as e:
        raw_detail = e.detail or str(e)
        detail = raw_detail if isinstance(raw_detail, str) else json.dumps(raw_detail)

        # Check for GPU type errors and suggest corrections
        if "GPU type" in detail and "not found" in detail and "Available:" in detail:
            # Extract the invalid GPU type and available options
            import re
            match = re.search(r"GPU type '([^']+)' not found\. Available: \[([^\]]+)\]", detail)
            if match:
                invalid_type = match.group(1)
                available_str = match.group(2)
                available = [s.strip().strip("'") for s in available_str.split(",")]

                console.print(f"[bold red]Error:[/bold red] Unknown GPU type '[yellow]{invalid_type}[/yellow]'")

                # Find similar GPU types
                suggestions = fuzzy_match(invalid_type, available)
                if suggestions:
                    console.print(f"\n[dim]Did you mean:[/dim]")
                    for s in suggestions:
                        console.print(f"  [green]{s}[/green]")

                console.print(f"\n[dim]Available GPU types:[/dim] {', '.join(available)}")
                sys.exit(1)

        # Check for region errors
        if "region" in detail.lower() and "not found" in detail.lower():
            console.print(f"[bold red]Error:[/bold red] {detail}")
            console.print("\n[dim]Tip: Use 'hyper jobs regions' to see available regions[/dim]")
            sys.exit(1)

        # Generic API error
        console.print(f"[bold red]API Error ({e.status_code}):[/bold red] {detail}")
        sys.exit(1)

    except KeyboardInterrupt:
        console.print("\n[dim]Interrupted[/dim]")
        sys.exit(130)


if __name__ == "__main__":
    cli()
