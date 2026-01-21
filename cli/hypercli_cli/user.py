"""hyper user commands"""
import typer
from hypercli import HyperCLI
from .output import output, spinner

app = typer.Typer(help="User account commands")


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
