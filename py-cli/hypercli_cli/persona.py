"""Dynamic persona commands: all reads go to Backend, with no disk cache."""
import typer
from hypercli import HyperCLI
from .output import output

app = typer.Typer(help="Live persona discovery and effective USER + SOUL resolution")


@app.command("list")
def list_personas(fmt: str = typer.Option("json", "--output", "-o")):
    """Read the current live catalog."""
    output(HyperCLI().personas.list(), fmt)


@app.command("get")
def get_persona(persona_id: str, fmt: str = typer.Option("json", "--output", "-o")):
    """Read an exact live persona artifact."""
    output(HyperCLI().personas.get(persona_id), fmt)


@app.command("resolve")
def resolve_persona(
    agent_id: str | None = typer.Option(None, "--agent"),
    fmt: str = typer.Option("json", "--output", "-o"),
):
    """Read current USER + effective SOUL (distinct from canonical stored SOUL)."""
    output(HyperCLI().personas.resolve(agent_id), fmt)
