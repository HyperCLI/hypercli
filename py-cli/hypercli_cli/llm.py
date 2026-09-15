"""Basic LLM chat commands via the OpenAI-compatible HyperCLI surface."""
from __future__ import annotations

import base64
import json
import mimetypes
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
VISION_MODEL_PREFERENCE = ("kimi-k2.6", "kimi-k2-6", "kimi-k2.5", "kimi-k2-5")
DEFAULT_LLM_TIMEOUT_SECONDS = 60.0
DEFAULT_IMAGE_PROMPT = "Describe this image concisely."
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


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


def _resolve_llm_timeout() -> float:
    raw = os.environ.get("HYPER_LLM_TIMEOUT_SECONDS", "").strip()
    if not raw:
        return DEFAULT_LLM_TIMEOUT_SECONDS
    try:
        timeout = float(raw)
    except ValueError:
        return DEFAULT_LLM_TIMEOUT_SECONDS
    return timeout if timeout > 0 else DEFAULT_LLM_TIMEOUT_SECONDS


def _pick_default_model(models_payload: dict[str, Any]) -> str | None:
    return _pick_preferred_model(models_payload, MODEL_PREFERENCE)


def _pick_default_vision_model(models_payload: dict[str, Any]) -> str | None:
    return _pick_preferred_model(models_payload, VISION_MODEL_PREFERENCE)


def _pick_preferred_model(models_payload: dict[str, Any], preferences: tuple[str, ...]) -> str | None:
    data = models_payload.get("data")
    if not isinstance(data, list):
        return None
    ids = [str(item.get("id", "")).strip() for item in data if item.get("id")]
    if not ids:
        return None
    for preferred in preferences:
        for model_id in ids:
            if preferred in model_id:
                return model_id
    for model_id in ids:
        if "embedding" not in model_id.lower():
            return model_id
    return ids[0]


def _resolve_default_model(api_key: str, api_base: str) -> str:
    return _resolve_default_model_with_picker(api_key, api_base, _pick_default_model)


def _resolve_default_vision_model(api_key: str, api_base: str) -> str:
    return _resolve_default_model_with_picker(api_key, api_base, _pick_default_vision_model)


def _resolve_default_model_with_picker(api_key: str, api_base: str, picker) -> str:
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

    model_id = picker(response.json())
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
    return OpenAI(
        api_key=api_key,
        base_url=f"{api_base}/v1",
        timeout=_resolve_llm_timeout(),
    )


def _image_data_url(path: Path) -> str:
    if not path.exists() or not path.is_file():
        console.print(f"[red]❌ Image file not found: {path}[/red]")
        raise typer.Exit(1)

    extension = path.suffix.lower()
    if extension not in SUPPORTED_IMAGE_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_IMAGE_EXTENSIONS))
        console.print(f"[red]❌ Unsupported image extension {extension or '(none)'}.[/red]")
        console.print(f"Supported image extensions: {supported}")
        raise typer.Exit(1)

    content_type = mimetypes.guess_type(path.name)[0] or {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }[extension]
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def _print_chat_response(response: Any, *, json_output: bool) -> None:
    if json_output:
        console.print_json(response.model_dump_json(indent=2))
        return
    message = response.choices[0].message.content or ""
    console.print(message)


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
        _print_chat_response(response, json_output=True)
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
    _print_chat_response(response, json_output=False)


@app.command("image")
def image(
    image_path: Path = typer.Argument(
        ...,
        help="Local image file to send",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
        resolve_path=True,
    ),
    prompt: str = typer.Option(DEFAULT_IMAGE_PROMPT, "--prompt", "-p", help="Prompt to ask about the image"),
    model: str = typer.Option(None, "--model", "-m", help="Vision-capable model ID (defaults to Kimi vision if available)"),
    system: str = typer.Option(None, "--system", "-s", help="Optional system prompt"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="Product API base URL (default: api.hypercli.com)"),
    key: str = typer.Option(None, "--key", "-k", help="API key"),
    temperature: float = typer.Option(None, "--temperature", help="Sampling temperature"),
    max_tokens: int = typer.Option(None, "--max-tokens", help="Maximum completion tokens"),
    stream: bool = typer.Option(True, "--stream/--no-stream", help="Stream partial tokens"),
    json_output: bool = typer.Option(False, "--json", help="Print raw response JSON"),
):
    """Send a local image to a vision-capable chat model."""
    api_key = _resolve_api_key(key)
    api_base = _resolve_api_base(base_url)
    resolved_model = model or _resolve_default_vision_model(api_key, api_base)

    client = _get_openai_client(api_key, api_base)
    messages: list[dict[str, Any]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": _image_data_url(image_path)}},
            ],
        }
    )

    request: dict[str, Any] = {"model": resolved_model, "messages": messages}
    if temperature is not None:
        request["temperature"] = temperature
    if max_tokens is not None:
        request["max_tokens"] = max_tokens

    if json_output:
        response = client.chat.completions.create(stream=False, **request)
        _print_chat_response(response, json_output=True)
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
    _print_chat_response(response, json_output=False)
