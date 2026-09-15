"""HyperCLI Voice API commands — TTS, clone, design"""
import json
import os
from ipaddress import ip_address
from socket import getaddrinfo, gaierror
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import typer
from rich.console import Console
from hypercli import HyperCLI, APIError
from hypercli.config import get_agent_api_key, get_agents_api_base_url_from_product_base, get_api_key
from .stt import transcribe as _stt_transcribe

app = typer.Typer(help="Voice commands — text-to-speech, voice cloning, voice design, and local transcription")
console = Console()

HYPERCLI_DIR = Path.home() / ".hypercli"
AGENT_KEY_PATH = HYPERCLI_DIR / "agent-key.json"
DEFAULT_API_BASE = "https://api.hypercli.com"
MAX_REFERENCE_AUDIO_BYTES = 25 * 1024 * 1024
REFERENCE_AUDIO_TIMEOUT_SECONDS = 30


def _get_api_key(key: str | None) -> str:
    """Resolve API key from canonical config before legacy agent-key storage."""
    if key:
        return key
    configured = (get_api_key() or get_agent_api_key() or "").strip()
    if configured:
        return configured
    if AGENT_KEY_PATH.exists():
        try:
            with open(AGENT_KEY_PATH) as f:
                saved = json.load(f)
            expires_at = saved.get("expires_at")
            if expires_at:
                expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires <= datetime.now(timezone.utc):
                    saved = {}
            k = str(saved.get("key", "")).strip()
            if k:
                return k
        except Exception:
            pass
    console.print("[red]❌ No API key found.[/red]")
    console.print("Pass [bold]--key[/bold], set [bold]HYPER_API_KEY[/bold], or run [bold]hyper configure[/bold].")
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


def _validate_reference_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        console.print("[red]❌ Reference audio URL must be a valid HTTPS URL.[/red]")
        raise typer.Exit(1)
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith(".localhost"):
        console.print("[red]❌ Reference audio URL cannot target localhost.[/red]")
        raise typer.Exit(1)
    try:
        ip = ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            console.print("[red]❌ Reference audio URL cannot target private or local IP addresses.[/red]")
            raise typer.Exit(1)
    except ValueError:
        pass
    return url


def _assert_safe_resolved_host(host: str) -> None:
    try:
        infos = getaddrinfo(host, None)
    except gaierror:
        return
    for info in infos:
        address = info[4][0]
        try:
            ip = ip_address(address)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            console.print("[red]❌ Reference audio URL cannot resolve to private or local IP addresses.[/red]")
            raise typer.Exit(1)


def _download_audio(url: str) -> bytes:
    import httpx

    current_url = _validate_reference_url(url)

    try:
        for _ in range(6):
            _assert_safe_resolved_host(urlparse(current_url).hostname or "")
            with httpx.stream(
                "GET",
                current_url,
                follow_redirects=False,
                timeout=REFERENCE_AUDIO_TIMEOUT_SECONDS,
                trust_env=False,
            ) as response:
                if response.status_code not in (301, 302, 303, 307, 308):
                    response.raise_for_status()
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > MAX_REFERENCE_AUDIO_BYTES:
                        console.print(f"[red]❌ Reference audio exceeds {MAX_REFERENCE_AUDIO_BYTES} bytes.[/red]")
                        raise typer.Exit(1)
                    chunks = []
                    total = 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_REFERENCE_AUDIO_BYTES:
                            console.print(f"[red]❌ Reference audio exceeds {MAX_REFERENCE_AUDIO_BYTES} bytes.[/red]")
                            raise typer.Exit(1)
                        chunks.append(chunk)
                    return b"".join(chunks)
                location = response.headers.get("location")
                if not location:
                    response.raise_for_status()
                    return b"".join(response.iter_bytes())
                current_url = _validate_reference_url(urljoin(current_url, location))
        else:
            console.print("[red]❌ Reference audio URL redirected too many times.[/red]")
            raise typer.Exit(1)
    except typer.Exit:
        raise
    except (TypeError, ValueError):
        console.print("[red]❌ Invalid reference audio content length.[/red]")
        raise typer.Exit(1)
    except httpx.HTTPError as e:
        console.print(f"[red]❌ Failed to download reference audio: {e}[/red]")
        raise typer.Exit(1)


def _read_reference_file(ref_audio: Path) -> Path:
    if not ref_audio.exists():
        console.print(f"[red]❌ Reference audio not found: {ref_audio}[/red]")
        raise typer.Exit(1)
    if ref_audio.stat().st_size > MAX_REFERENCE_AUDIO_BYTES:
        console.print(f"[red]❌ Reference audio exceeds {MAX_REFERENCE_AUDIO_BYTES} bytes.[/red]")
        raise typer.Exit(1)
    return ref_audio


def _handle_voice_error(error: APIError) -> None:
    detail = error.detail if isinstance(error.detail, str) else json.dumps(error.detail)
    console.print(f"[red]❌ {error.status_code}: {detail[:500]}[/red]")
    raise typer.Exit(1)


def _post_voice(endpoint: str, api_key: str, output: Path, base_url: str | None = None, **kwargs) -> None:
    """POST to voice endpoint through the SDK and save audio output."""
    api_base = _resolve_api_base(base_url)
    url = f"{get_agents_api_base_url_from_product_base(api_base)}/voice/{endpoint}"
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


def _stream_voice(
    api_key: str,
    output: Path,
    base_url: str | None,
    *,
    text: str,
    voice: str,
    language: str,
    response_format: str,
    timeout: float | None,
) -> None:
    """Stream TTS chunks over /ws/voice through the SDK and save audio output."""
    import asyncio

    from hypercli import VoiceStreamError

    async def run() -> None:
        client = _voice_client(api_key, base_url)
        output.parent.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        with output.open("wb") as handle:
            async for chunk in client.voice.tts_stream(
                text,
                voice=voice,
                language=language,
                response_format=response_format,
                timeout=timeout,
            ):
                handle.write(chunk.audio)
                total_bytes += len(chunk.audio)
                console.print(
                    f"[dim]chunk {chunk.index + 1}/{chunk.total} ({len(chunk.audio) / 1024:.1f} KB)[/dim]"
                )
        console.print(f"[green]✅ Saved {output} ({total_bytes / 1024:.1f} KB)[/green]")

    try:
        asyncio.run(run())
    except VoiceStreamError as error:
        console.print(f"[red]❌ {error.code}: {error.detail[:500]}[/red]")
        raise typer.Exit(1)
    except OSError as e:
        console.print(f"[red]❌ File error: {e}[/red]")
        raise typer.Exit(1)


def _stream_clone_voice(
    api_key: str,
    output: Path,
    base_url: str | None,
    *,
    text: str,
    ref_audio,
    language: str,
    x_vector_only: bool,
    response_format: str,
    timeout: float | None,
) -> None:
    """Stream cloned speech chunks over /ws/voice and save concatenated audio."""
    import asyncio

    from hypercli import VoiceStreamError

    async def run() -> None:
        client = _voice_client(api_key, base_url)
        output.parent.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        with output.open("wb") as handle:
            async for chunk in client.voice.clone_stream(
                text,
                ref_audio=ref_audio,
                language=language,
                x_vector_only=x_vector_only,
                response_format=response_format,
                timeout=timeout,
            ):
                handle.write(chunk.audio)
                total_bytes += len(chunk.audio)
                console.print(
                    f"[dim]chunk {chunk.index + 1}/{chunk.total} ({len(chunk.audio) / 1024:.1f} KB)[/dim]"
                )
        console.print(f"[green]✅ Saved {output} ({total_bytes / 1024:.1f} KB)[/green]")

    try:
        asyncio.run(run())
    except VoiceStreamError as error:
        console.print(f"[red]❌ {error.code}: {error.detail[:500]}[/red]")
        raise typer.Exit(1)
    except OSError as e:
        console.print(f"[red]❌ File error: {e}[/red]")
        raise typer.Exit(1)


@app.command("transcribe")
def transcribe(
    audio_file: Path = typer.Argument(..., help="Audio file to transcribe (wav, mp3, ogg, m4a, etc.)"),
    model: str = typer.Option("turbo", "--model", "-m", help="Whisper model: tiny, base, small, medium, large-v3, turbo"),
    language: str = typer.Option(None, "--language", "-l", help="Language code (e.g. en, de, fr). Auto-detect if omitted."),
    device: str = typer.Option("auto", "--device", "-d", help="Device: auto, cpu, cuda"),
    compute_type: str = typer.Option("auto", "--compute", help="Compute type: auto, int8, float16, float32"),
    json_output: bool = typer.Option(False, "--json", help="Output as JSON with timestamps"),
    output: Path = typer.Option(None, "--output", "-o", help="Write transcript to file"),
):
    """Transcribe audio locally using faster-whisper.

    Examples:
      hyper voice transcribe voice.ogg
      hyper voice transcribe meeting.mp3 --model large-v3 --language en
      hyper voice transcribe audio.wav --json -o transcript.json
    """
    _stt_transcribe(audio_file, model, language, device, compute_type, json_output, output)


@app.command("tts")
def tts(
    text: str = typer.Argument(..., help="Text to synthesize"),
    voice: str = typer.Option("serena", "--voice", "-v", help="Voice name (CustomVoice preset)"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--out", "--output", "-o", help="Output audio file (default: output.<format>)"),
    stream: bool = typer.Option(False, "--stream", help="Stream audio chunks over /ws/voice as they render"),
    timeout: float | None = typer.Option(None, "--timeout", help="Voice request timeout in seconds"),
    key: str = typer.Option(None, "--key", "-k", help="API key (hyper_api_...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Generate speech from text using a preset voice.

    Examples:
      hyper voice tts "Hello world"
      hyper voice tts "Bonjour" -v eric -l french -f opus -o hello.opus
      hyper voice tts "Long text..." --stream
    """
    api_key = _get_api_key(key)
    if output is None:
        output = Path(f"output.{format}")
    if stream:
        _stream_voice(
            api_key,
            output,
            base_url,
            text=text,
            voice=voice,
            language=language,
            response_format=format,
            timeout=timeout,
        )
        return
    _post_voice(
        "tts",
        api_key,
        output,
        base_url,
        text=text,
        voice=voice,
        language=language,
        response_format=format,
        timeout=timeout,
    )


@app.command("clone")
def clone(
    text: str = typer.Argument(..., help="Text to synthesize"),
    ref_audio: Path | None = typer.Option(None, "--ref", "--file", "-r", help="Reference audio file (wav/mp3/ogg)"),
    ref_audio_url: str | None = typer.Option(None, "--url", help="Reference audio URL (wav/mp3/ogg)"),
    ref_text: str = typer.Option(None, "--ref-text", help="Transcript of the reference audio (required with --full-clone)"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    x_vector_only: bool = typer.Option(True, "--x-vector-only/--full-clone", help="Use x_vector_only mode (recommended)"),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--out", "--output", "-o", help="Output audio file (default: output.<format>)"),
    rest: bool = typer.Option(False, "--rest", help="Use REST assembled audio instead of WebSocket chunks"),
    timeout: float | None = typer.Option(None, "--timeout", help="Voice request timeout in seconds"),
    key: str = typer.Option(None, "--key", "-k", help="API key (hyper_api_...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Clone a voice from reference audio.

    Examples:
      hyper voice clone "Hello" --file voice.wav
      hyper voice clone "Hello" --url https://example.com/voice.wav
      hyper voice clone "Test" -r ref.wav -l english -f mp3 -o cloned.mp3
    """
    api_key = _get_api_key(key)
    if output is None:
        output = Path(f"output.{format}")

    if (ref_audio is not None) + (ref_audio_url is not None) != 1:
        console.print("[red]❌ Provide exactly one of --file/--ref or --url.[/red]")
        raise typer.Exit(1)

    if not x_vector_only and not ref_text:
        console.print("[red]❌ --full-clone (ICL mode) requires --ref-text with the transcript of the reference audio.[/red]")
        raise typer.Exit(1)

    if ref_audio is not None:
        source = _read_reference_file(ref_audio)
        console.print(f"[dim]Reference: {ref_audio} ({ref_audio.stat().st_size / 1024:.1f} KB)[/dim]")
    else:
        source = _download_audio(ref_audio_url or "")
        console.print(f"[dim]Reference: {ref_audio_url} ({len(source) / 1024:.1f} KB)[/dim]")

    if rest:
        _post_voice(
            "clone",
            api_key,
            output,
            base_url,
            text=text,
            ref_audio=source,
            ref_text=ref_text,
            language=language,
            x_vector_only=x_vector_only,
            response_format=format,
            timeout=timeout,
        )
        return

    _stream_clone_voice(
        api_key,
        output,
        base_url,
        text=text,
        ref_audio=source,
        language=language,
        x_vector_only=x_vector_only,
        response_format=format,
        timeout=timeout,
    )


@app.command("design")
def design(
    text: str = typer.Argument(..., help="Text to synthesize"),
    description: str = typer.Option(..., "--desc", "-d", help="Voice description (e.g. 'young female, warm, American accent')"),
    language: str = typer.Option("auto", "--language", "-l", help="Language: auto, english, chinese, etc."),
    format: str = typer.Option("mp3", "--format", "-f", help="Output format: wav, mp3, opus, ogg, flac"),
    output: Path = typer.Option(None, "--output", "-o", help="Output audio file (default: output.<format>)"),
    timeout: float | None = typer.Option(None, "--timeout", help="Voice request timeout in seconds"),
    key: str = typer.Option(None, "--key", "-k", help="API key (hyper_api_...)"),
    base_url: str = typer.Option(None, "--base-url", "-b", help="API base URL (default: api.hypercli.com)"),
):
    """Design a voice from a text description.

    Examples:
      hyper voice design "Hello" --desc "deep male voice, British accent"
      hyper voice design "Test" -d "young woman, cheerful" -f mp3 -o designed.mp3
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
        timeout=timeout,
    )
