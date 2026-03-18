"""HyperClaw Embed — text embeddings via HyperClaw API."""
import json
import os
from pathlib import Path

import httpx
import typer
from rich.console import Console

app = typer.Typer(help="Text embeddings via HyperClaw API (qwen3-embedding-4b)")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
PROD_API_BASE = "https://api.hypercli.com"
DEV_API_BASE = "https://api.dev.hypercli.com"


def _get_api_key(key: str | None) -> str:
    """Resolve API key: --key flag > env HYPER_API_KEY > agent-key.json."""
    if key:
        return key
    env_key = os.environ.get("HYPER_API_KEY", "").strip()
    if env_key:
        return env_key
    if AGENT_KEY_PATH.exists():
        with open(AGENT_KEY_PATH) as f:
            k = json.load(f).get("key", "")
        if k:
            return k
    console.print("[red]❌ No API key found.[/red]")
    console.print("Pass [bold]--key sk-...[/bold], set [bold]HYPER_API_KEY[/bold], or run [bold]hyper agent subscribe[/bold]")
    raise typer.Exit(1)


@app.command("text")
def embed_text(
    text: str = typer.Argument(..., help="Text to embed"),
    model: str = typer.Option("qwen3-embedding-4b", "--model", "-m", help="Embedding model"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
    json_output: bool = typer.Option(False, "--json", help="Output full JSON response"),
    output: Path = typer.Option(None, "--output", "-o", help="Write embeddings to file"),
):
    """Generate embeddings for text.

    Examples:
      hyper agent embed text "Hello world"
      hyper agent embed text "Test" --json
      hyper agent embed text "Document chunk" -o embedding.json
    """
    api_key = _get_api_key(key)
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    url = f"{api_base}/v1/embeddings"

    try:
        resp = httpx.post(
            url,
            json={"model": model, "input": text},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        console.print(f"[red]❌ Embedding request failed: {e}[/red]")
        raise typer.Exit(1)

    embedding = data["data"][0]["embedding"]
    dims = len(embedding)
    usage = data.get("usage", {})
    tokens = usage.get("total_tokens", 0)

    if json_output:
        result = json.dumps(data, indent=2)
        if output:
            output.write_text(result)
            console.print(f"[green]✅ Written to {output} ({dims} dimensions, {tokens} tokens)[/green]")
        else:
            print(result)
    else:
        console.print(f"[green]✅ Embedded ({dims} dimensions, {tokens} tokens)[/green]")
        console.print(f"[dim]Model: {data.get('model', model)}[/dim]")
        console.print(f"[dim]First 5: {embedding[:5]}[/dim]")
        if output:
            output.write_text(json.dumps(embedding))
            console.print(f"[green]Saved to {output}[/green]")


@app.command("test")
def embed_test(
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Quick test to verify embedding endpoint works.

    Examples:
      hyper agent embed test
      hyper agent embed test --dev
    """
    api_key = _get_api_key(key)
    api_base = DEV_API_BASE if dev else PROD_API_BASE
    url = f"{api_base}/v1/embeddings"

    test_texts = [
        "The quick brown fox jumps over the lazy dog.",
        "GPU orchestration and cloud computing infrastructure.",
    ]

    console.print(f"[bold]Testing embedding endpoint: {url}[/bold]\n")

    try:
        resp = httpx.post(
            url,
            json={"model": "qwen3-embedding-4b", "input": test_texts},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        console.print(f"[red]❌ FAIL: {e}[/red]")
        raise typer.Exit(1)

    embeddings = data.get("data", [])
    if len(embeddings) != 2:
        console.print(f"[red]❌ Expected 2 embeddings, got {len(embeddings)}[/red]")
        raise typer.Exit(1)

    dims = len(embeddings[0]["embedding"])
    usage = data.get("usage", {})

    # Compute cosine similarity
    import math
    v1 = embeddings[0]["embedding"]
    v2 = embeddings[1]["embedding"]
    dot = sum(a * b for a, b in zip(v1, v2))
    mag1 = math.sqrt(sum(a * a for a in v1))
    mag2 = math.sqrt(sum(b * b for b in v2))
    cosine_sim = dot / (mag1 * mag2) if mag1 and mag2 else 0

    console.print(f"[green]✅ PASS[/green]")
    console.print(f"  Model: {data.get('model', 'qwen3-embedding-4b')}")
    console.print(f"  Dimensions: {dims}")
    console.print(f"  Tokens: {usage.get('total_tokens', '?')}")
    console.print(f"  Cosine similarity: {cosine_sim:.4f}")
    console.print(f"  (Two unrelated sentences should be < 0.9)")
