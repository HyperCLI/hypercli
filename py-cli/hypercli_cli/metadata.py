"""Canonical semantic metadata commands; never project runtime files."""
import sys
from pathlib import Path
import typer
from hypercli import HyperCLI
from hypercli.personas import canonical_soul
from .output import output


def read_content(file: str) -> str:
    return sys.stdin.read() if file == "-" else Path(file).read_text(encoding="utf-8")


def resolve_agent(client: HyperCLI, agent_id: str | None) -> str:
    if agent_id is not None:
        return client.deployments.resolve_agent_id(agent_id)
    identity = client.deployments.access_identity()
    if identity.agent_id:
        return identity.agent_id
    raise typer.BadParameter("this credential does not identify exactly one agent; pass --agent")


def soul(
    agent_id: str | None = typer.Option(None, "--agent"),
    file: str | None = typer.Option(None, "--file", "-f"),
    fmt: str = typer.Option("table", "--output", "-o"),
):
    """Read canonical SOUL. Writes require agents:* owner access; runtime self-writes denied."""
    client = HyperCLI()
    target = resolve_agent(client, agent_id)
    agent = client.deployments.get(target) if file is None else client.deployments.update(target, soul=read_content(file))
    value = canonical_soul(agent.meta)
    if fmt == "json":
        output({"agent_id": agent.id, "soul": value}, fmt)
    else:
        typer.echo(value, nl=False)


def selector(
    agent_id: str,
    value: str | None = typer.Argument(None),
    clear: bool = typer.Option(False, "--clear", help="Clear the selector; incompatible with a persona value."),
    fmt: str = typer.Option("json", "--output", "-o"),
):
    """Read/set persona selector; --clear clears. agents:* owner writes only; no runtime self-write."""
    if clear and value is not None:
        raise typer.BadParameter("--clear cannot be combined with a persona value")
    if value is not None and not value.strip():
        raise typer.BadParameter("persona id must not be blank; use --clear")
    client = HyperCLI()
    if clear:
        agent = client.deployments.update(agent_id, persona=None)
    elif value is None:
        agent = client.deployments.get(agent_id)
    else:
        agent = client.deployments.update(agent_id, persona=value)
    output({"agent_id": agent.id, "persona": (agent.meta or {}).get("persona")}, fmt)
