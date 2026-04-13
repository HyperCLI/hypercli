"""Basic LLM chat commands via the OpenAI-compatible HyperClaw surface."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
import typer
from rich.console import Console
from hypercli.config import get_api_key, get_api_url

app = typer.Typer(help="Basic LLM chat commands via /v1/chat/completions")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
DEFAULT_API_BASE = "https://api.hypercli.com"
MODEL_PREFERENCE = ("kimi-k2.5", "kimi-k2-5")


def _resolve_api_key(key: str | None) -> str:
    if key:
        return key
    configured = get_api_key()
    if configured:
        return configured
    for env_name in ("HYPER_AGENTS_API_KEY",):
        env_key = os.environ.get(env_name, "").strip()
        if env_key:
            return env_key
    if AGENT_KEY_PATH.exists():
        try:
            with open(AGENT_KEY_PATH) as f:
                saved = json.load(f).get("key", "").strip()
            if saved:
                return saved
        except Exception:
            pass
    console.print("[red]❌ No API key found.[/red]")
    console.print(
        "Pass [bold]--key[/bold], set [bold]HYPER_API_KEY[/bold], or run "
        "[bold]hyper configure[/bold]."
    )
    raise typer.Exit(1)


def _resolve_api_base(base_url: str | None) -> str:
    if base_url:
        return base_url.rstrip("/")
    configured = get_api_url()
    if configured:
        return configured.rstrip("/")
    return DEFAULT_API_BASE


def _pick_default_model(models_payload: dict[str, Any]) -> str | None:
    data = models_payload.get("data")
    if not isinstance(data, list):
        return None
    ids = [str(item.get("id", "")).strip() for item in data if item.get("id")]
    if not ids:
        return None
    for preferred in MODEL_PREFERENCE:
        for model_id in ids:
            if preferred in model_id:
                return model_id
    for model_id in ids:
        if "embedding" not in model_id.lower():
            return model_id
    return ids[0]


def _resolve_default_model(api_key: str, api_base: str) -> str:
    response = httpx.get(
        f"{api_base}/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=15,
    )
    if response.status_code >= 400:
        detail = response.text
        try:
            detail = response.json()
        except Exception:
            pass
        console.print(f"[red]❌ Failed to list models: {detail}[/red]")
        raise typer.Exit(1)

    model_id = _pick_default_model(response.json())
    if not model_id:
        console.print("[red]❌ No chat-capable models returned by /v1/models[/red]")
        raise typer.Exit(1)
    return model_id


def _get_openai_client(api_key: str, api_base: str):
    try:
        from openai import OpenAI
    except ImportError:
        console.print("[red]❌ The llm command requires the openai package.[/red]")
        console.print("Reinstall or upgrade with [bold]pip install 'hypercli-cli>=2026.4.13'[/bold].")
        raise typer.Exit(1)
    return OpenAI(api_key=api_key, base_url=f"{api_base}/v1")


@app.command("chat")
def chat(
    prompt: str = typer.Argument(..., help="User prompt to send"),
    model: str = typer.Option(None, "--model", "-m", help="Model ID (defaults to Kimi or first non-embedding model)"),
    system: str = typer.Option(None, "--system", "-s", help="Optional system prompt"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="Product API base URL (default: api.hypercli.com)"),
    key: str = typer.Option(None, "--key", "-k", help="API key"),
    temperature: float = typer.Option(None, "--temperature", help="Sampling temperature"),
    max_tokens: int = typer.Option(None, "--max-tokens", help="Maximum completion tokens"),
    stream: bool = typer.Option(True, "--stream/--no-stream", help="Stream partial tokens"),
    json_output: bool = typer.Option(False, "--json", help="Print raw response JSON"),
):
    """Send one basic chat completion request."""
    api_key = _resolve_api_key(key)
    api_base = _resolve_api_base(base_url)
    resolved_model = model or _resolve_default_model(api_key, api_base)

    client = _get_openai_client(api_key, api_base)
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    request: dict[str, Any] = {"model": resolved_model, "messages": messages}
    if temperature is not None:
        request["temperature"] = temperature
    if max_tokens is not None:
        request["max_tokens"] = max_tokens

    if json_output:
        response = client.chat.completions.create(stream=False, **request)
        console.print_json(response.model_dump_json(indent=2))
        return

    if stream:
        stream_response = client.chat.completions.create(stream=True, **request)
        saw_content = False
        for chunk in stream_response:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                saw_content = True
                console.print(delta, end="")
        if saw_content:
            console.print()
        return

    response = client.chat.completions.create(stream=False, **request)
    message = response.choices[0].message.content or ""
    console.print(message)
