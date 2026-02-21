"""HyperClaw Voice API commands — TTS, clone, design"""
import base64
import json
import sys
from pathlib import Path

import httpx
import typer
from rich.console import Console

app = typer.Typer(help="Voice API — text-to-speech, voice cloning, voice design")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
CLAW_KEY_PATH = HYPERCLI_DIR / "claw-key.json"
PROD_API_BASE = "https://api.hyperclaw.app"
DEV_API_BASE = "https://dev-api.hyperclaw.app"


def _get_api_key(key: str | None) -> str:
    """Resolve API key from flag or saved claw key."""
    if key:
        return key
    if CLAW_KEY_PATH.exists():
        with open(CLAW_KEY_PATH) as f:
            k = json.load(f).get("key", "")
        if k:
            return k
    console.print("[red]❌ No API key found.[/red]")
    console.print("Pass [bold]--key sk-...[/bold] or run [bold]hyper claw subscribe[/bold]")
    raise typer.Exit(1)


def _post_voice(
    endpoint: str,
    payload: dict,
    api_key: str,
    output: Path,
    dev: bool = False,
):
    """POST to voice endpoint and save audio output."""
    api_base = DEV_API_BASE if dev else PROD_API_BASE
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
    output: Path = typer.Option("output.wav", "--output", "-o", help="Output audio file"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Generate speech from text using a preset voice.
    
    Examples:
      hyper claw voice tts "Hello world"
      hyper claw voice tts "Bonjour" -v Etienne -l french -o hello.wav
    """
    api_key = _get_api_key(key)
    payload = {
        "text": text,
        "voice": voice,
        "language": language,
    }
    _post_voice("tts", payload, api_key, output, dev)


@app.command("clone")
def clone(
    text: str = typer.Argument(..., help="Text to synthesize"),
    ref_audio: Path = typer.Option(..., "--ref", "-r", help="Reference audio file (wav/mp3/ogg)"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    x_vector_only: bool = typer.Option(True, "--x-vector-only/--full-clone", help="Use x_vector_only mode (recommended)"),
    output: Path = typer.Option("output.wav", "--output", "-o", help="Output audio file"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Clone a voice from reference audio.
    
    Examples:
      hyper claw voice clone "Hello" --ref voice.wav
      hyper claw voice clone "Test" -r ref.wav -l english -o cloned.wav
    """
    api_key = _get_api_key(key)

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
    }
    _post_voice("clone", payload, api_key, output, dev)


@app.command("design")
def design(
    text: str = typer.Argument(..., help="Text to synthesize"),
    description: str = typer.Option(..., "--desc", "-d", help="Voice description (e.g. 'young female, warm, American accent')"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    output: Path = typer.Option("output.wav", "--output", "-o", help="Output audio file"),
    key: str = typer.Option(None, "--key", "-k", help="API key (sk-...)"),
    dev: bool = typer.Option(False, "--dev", help="Use dev API"),
):
    """Design a voice from a text description.
    
    Examples:
      hyper claw voice design "Hello" --desc "deep male voice, British accent"
      hyper claw voice design "Test" -d "young woman, cheerful" -o designed.wav
    """
    api_key = _get_api_key(key)
    payload = {
        "text": text,
        "voice_description": description,
        "language": language,
    }
    _post_voice("design", payload, api_key, output, dev)
