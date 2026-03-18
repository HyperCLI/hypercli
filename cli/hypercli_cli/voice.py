"""HyperClaw Voice API commands — TTS, clone, design"""
import base64
import json
import os
import sys
from pathlib import Path

import httpx
import typer
from rich.console import Console

app = typer.Typer(help="Voice API — text-to-speech, voice cloning, voice design")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
DEFAULT_API_BASE = "https://api.hypercli.com"


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


def _resolve_api_base(base_url: str | None) -> str:
    """Resolve API base: --base-url > HYPER_API_BASE env > default."""
    if base_url:
        return base_url.rstrip("/")
    env_base = os.environ.get("HYPER_API_BASE", "").strip()
    if env_base:
        return env_base.rstrip("/")
    return DEFAULT_API_BASE


def _post_voice(
    endpoint: str,
    payload: dict,
    api_key: str,
    output: Path,
    base_url: str | None = None,
):
    """POST to voice endpoint and save audio output."""
    api_base = _resolve_api_base(base_url)
    url = f"{api_base}/voice/{endpoint}"

    console.print(f"[dim]→ POST {url}[/dim]")

    try:
        with httpx.Client(timeout=600.0) as client:
            resp = client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            console.print(f"[red]❌ {resp.status_code}: {resp.text[:500]}[/red]")
            raise typer.Exit(1)

        output.parent.mkdir(parents=True, exist_ok=True)
        with open(output, "wb") as f:
            f.write(resp.content)

        size_kb = len(resp.content) / 1024
        console.print(f"[green]✅ Saved {output} ({size_kb:.1f} KB)[/green]")

    except httpx.HTTPError as e:
        console.print(f"[red]❌ Request failed: {e}[/red]")
        raise typer.Exit(1)


@app.command("tts")
def tts(
    text: str = typer.Argument(..., help="Text to synthesize"),
    voice: str = typer.Option("Chelsie", "--voice", "-v", help="Voice name (CustomVoice preset)"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--output", "-o", help="Output audio file (default: output.<format>)"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Generate speech from text using a preset voice.

    Examples:
      hyper agent voice tts "Hello world"
      hyper agent voice tts "Bonjour" -v Etienne -l french -f opus -o hello.opus
    """
    api_key = _get_api_key(key)
    if output is None:
        output = Path(f"output.{format}")
    payload = {
        "text": text,
        "voice": voice,
        "language": language,
        "response_format": format,
    }
    _post_voice("tts", payload, api_key, output, base_url)


@app.command("clone")
def clone(
    text: str = typer.Argument(..., help="Text to synthesize"),
    ref_audio: Path = typer.Option(..., "--ref", "-r", help="Reference audio file (wav/mp3/ogg)"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    x_vector_only: bool = typer.Option(True, "--x-vector-only/--full-clone", help="Use x_vector_only mode (recommended)"),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--output", "-o", help="Output audio file (default: output.<format>)"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Clone a voice from reference audio.

    Examples:
      hyper agent voice clone "Hello" --ref voice.wav
      hyper agent voice clone "Test" -r ref.wav -l english -f mp3 -o cloned.mp3
    """
    api_key = _get_api_key(key)
    if output is None:
        output = Path(f"output.{format}")

    if not ref_audio.exists():
        console.print(f"[red]❌ Reference audio not found: {ref_audio}[/red]")
        raise typer.Exit(1)

    with open(ref_audio, "rb") as f:
        ref_b64 = base64.b64encode(f.read()).decode()

    console.print(f"[dim]Reference: {ref_audio} ({ref_audio.stat().st_size / 1024:.1f} KB)[/dim]")

    payload = {
        "text": text,
        "ref_audio_base64": ref_b64,
        "language": language,
        "x_vector_only": x_vector_only,
        "response_format": format,
    }
    _post_voice("clone", payload, api_key, output, base_url)


@app.command("design")
def design(
    text: str = typer.Argument(..., help="Text to synthesize"),
    description: str = typer.Option(..., "--desc", "-d", help="Voice description (e.g. 'young female, warm, American accent')"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--output", "-o", help="Output audio file (default: output.<format>)"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Design a voice from a text description.

    Examples:
      hyper agent voice design "Hello" --desc "deep male voice, British accent"
      hyper agent voice design "Test" -d "young woman, cheerful" -f mp3 -o designed.mp3
    """
    api_key = _get_api_key(key)
    if output is None:
        output = Path(f"output.{format}")
    payload = {
        "text": text,
        "instruct": description,
        "language": language,
        "response_format": format,
    }
    _post_voice("design", payload, api_key, output, base_url)
