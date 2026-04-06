"""HyperClaw Voice API commands — TTS, clone, design"""
import json
import os
from pathlib import Path

import typer
from rich.console import Console
from hypercli import HyperCLI, APIError

app = typer.Typer(help="Voice API — text-to-speech, voice cloning, voice design")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
DEFAULT_API_BASE = "https://api.hypercli.com"


def _get_api_key(key: str | None) -> str:
    """Resolve API key: --key > HYPER_API_KEY > HYPER_AGENTS_API_KEY > agent-key.json."""
    if key:
        return key
    env_key = os.environ.get("HYPER_API_KEY", "").strip()
    if env_key:
        return env_key
    env_key = os.environ.get("HYPER_AGENTS_API_KEY", "").strip()
    if env_key:
        return env_key
    if AGENT_KEY_PATH.exists():
        with open(AGENT_KEY_PATH) as f:
            k = json.load(f).get("key", "")
        if k:
            return k
    console.print("[red]❌ No API key found.[/red]")
    console.print("Pass [bold]--key sk-...[/bold], set [bold]HYPER_API_KEY[/bold] or [bold]HYPER_AGENTS_API_KEY[/bold], or run [bold]hyper agent subscribe[/bold]")
    raise typer.Exit(1)


def _resolve_api_base(base_url: str | None) -> str:
    """Resolve API base: --base-url > HYPER_API_BASE > HYPERCLI_API_URL > default."""
    if base_url:
        return base_url.rstrip("/")
    env_base = os.environ.get("HYPER_API_BASE", "").strip()
    if env_base:
        return env_base.rstrip("/")
    env_base = os.environ.get("HYPERCLI_API_URL", "").strip()
    if env_base:
        return env_base.rstrip("/")
    return DEFAULT_API_BASE


def _voice_client(api_key: str, base_url: str | None = None) -> HyperCLI:
    api_base = _resolve_api_base(base_url)
    return HyperCLI(api_key=api_key, api_url=api_base)


def _save_voice_output(output: Path, audio: bytes) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(audio)
    size_kb = len(audio) / 1024
    console.print(f"[green]✅ Saved {output} ({size_kb:.1f} KB)[/green]")


def _handle_voice_error(error: APIError) -> None:
    detail = error.detail if isinstance(error.detail, str) else json.dumps(error.detail)
    console.print(f"[red]❌ {error.status_code}: {detail[:500]}[/red]")
    raise typer.Exit(1)


def _post_voice(endpoint: str, api_key: str, output: Path, base_url: str | None = None, **kwargs) -> None:
    """POST to voice endpoint through the SDK and save audio output."""
    api_base = _resolve_api_base(base_url)
    url = f"{api_base}/agents/voice/{endpoint}"
    console.print(f"[dim]→ POST {url}[/dim]")

    try:
        client = _voice_client(api_key, base_url)
        method = getattr(client.voice, endpoint)
        audio = method(**kwargs)
        _save_voice_output(output, audio)
    except APIError as error:
        _handle_voice_error(error)
    except OSError as e:
        console.print(f"[red]❌ File error: {e}[/red]")
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
    _post_voice(
        "tts",
        api_key,
        output,
        base_url,
        text=text,
        voice=voice,
        language=language,
        response_format=format,
    )


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

    console.print(f"[dim]Reference: {ref_audio} ({ref_audio.stat().st_size / 1024:.1f} KB)[/dim]")
    _post_voice(
        "clone",
        api_key,
        output,
        base_url,
        text=text,
        ref_audio=ref_audio,
        language=language,
        x_vector_only=x_vector_only,
        response_format=format,
    )


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
    _post_voice(
        "design",
        api_key,
        output,
        base_url,
        text=text,
        description=description,
        language=language,
        response_format=format,
    )
