"""Output formatting"""
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
import json as json_lib
from typing import Any
from rich.console import Console
from rich.table import Table
from rich import print_json

console = Console()


def _json_safe(data: Any) -> Any:
    if data is None or isinstance(data, (str, int, float, bool)):
        return data
    if isinstance(data, (datetime, date)):
        return data.isoformat()
    if isinstance(data, dict):
        return {str(key): _json_safe(value) for key, value in data.items()}
    if isinstance(data, (list, tuple, set)):
        return [_json_safe(value) for value in data]
    if is_dataclass(data) and not isinstance(data, type):
        return _json_safe(asdict(data))
    model_dump = getattr(data, "model_dump", None)
    if callable(model_dump):
        return _json_safe(model_dump())
    if hasattr(data, "__dict__"):
        return _json_safe(vars(data))
    return str(data)


def output(data: Any, fmt: str = "table", columns: list[str] = None):
    """Output data in requested format"""
    if fmt == "json":
        print_json(data=_json_safe(data))
    elif fmt == "table":
        if isinstance(data, list):
            table_list(data, columns)
        elif hasattr(data, "__dict__"):
            table_dict(data.__dict__)
        elif isinstance(data, dict):
            table_dict(data)
        else:
            console.print(data)
    else:
        console.print(data)


def table_list(items: list, columns: list[str] = None):
    """Render list as table"""
    if not items:
        console.print("[dim]No results[/dim]")
        return

    # Convert dataclass to dict if needed
    if hasattr(items[0], "__dict__"):
        items = [i.__dict__ for i in items]

    cols = columns or list(items[0].keys())
    table = Table(show_header=True, header_style="bold cyan")

    for col in cols:
        table.add_column(col, no_wrap=True if col.endswith("_id") else False)

    for item in items:
        row = [str(item.get(col, "")) for col in cols]
        table.add_row(*row)

    console.print(table)


def table_dict(data: dict):
    """Render dict as key-value table"""
    table = Table(show_header=False, box=None)
    table.add_column("Key", style="bold cyan")
    table.add_column("Value")

    for k, v in data.items():
        if isinstance(v, (dict, list)):
            v = json_lib.dumps(v, indent=2)
        table.add_row(str(k), str(v))

    console.print(table)


def error(msg: str):
    console.print(f"[bold red]Error:[/bold red] {msg}")


def success(msg: str):
    console.print(f"[bold green]✓[/bold green] {msg}")


def spinner(msg: str = "Loading..."):
    """Context manager for showing a spinner during slow operations"""
    return console.status(f"[bold cyan]{msg}[/bold cyan]", spinner="dots")
