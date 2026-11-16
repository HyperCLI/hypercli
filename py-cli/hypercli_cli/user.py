"""hyper user commands"""
import typer
from hypercli import HyperCLI
from .output import output, spinner

app = typer.Typer(help="User account commands")


@app.command("profile")
def user_profile(
    file: str | None = typer.Option(None, "--file", "-f"),
    fmt: str = typer.Option("table", "--output", "-o"),
):
    """Read canonical USER; writes require Backend user-family access. Use -f - for stdin."""
    from .metadata import read_content
    client = HyperCLI()
    profile = client.user.get_profile() if file is None else client.user.update_profile(read_content(file))
    if fmt == "json":
        output(profile, fmt)
    else:
        typer.echo(profile["profile"], nl=False)


@app.callback(invoke_without_command=True)
def user_info(
    ctx: typer.Context,
    fmt: str = typer.Option("table", "--output", "-o", help="Output format: table|json"),
):
    """Get current user info"""
    if ctx.invoked_subcommand is None:
        client = HyperCLI()
        with spinner("Fetching user info..."):
            user = client.user.get()
        output(user, fmt)
