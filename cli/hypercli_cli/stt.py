"""HyperClaw STT — local speech-to-text via faster-whisper."""
import sys
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(help="Speech-to-text via faster-whisper (local, no API key)")
console = Console()

# Lazy import to avoid crashing when faster-whisper isn't installed
_model_cache = {}


def _get_model(model_size: str, device: str, compute_type: str):
    """Get or create a cached whisper model."""
    key = (model_size, device, compute_type)
    if key not in _model_cache:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            console.print("[red]❌ faster-whisper not installed.[/red]")
            console.print("Install with: [bold]pip install 'hypercli-cli[stt]'[/bold]")
            console.print("Or: [bold]pip install 'hypercli-cli[all]'[/bold]")
            raise typer.Exit(1)
        _model_cache[key] = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model_cache[key]


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
    """Transcribe audio to text using faster-whisper (runs locally).

    Examples:
      hyper claw stt transcribe voice.ogg
      hyper claw stt transcribe meeting.mp3 --model large-v3 --language en
      hyper claw stt transcribe audio.wav --json -o transcript.json
    """
    if not audio_file.exists():
        console.print(f"[red]❌ File not found: {audio_file}[/red]")
        raise typer.Exit(1)

    # Auto-select compute type based on device
    if compute_type == "auto":
        compute_type = "int8" if device == "cpu" else "float16"
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"
        if device == "cpu" and compute_type == "float16":
            compute_type = "int8"

    console.print(f"[dim]Model: {model} | Device: {device} | Compute: {compute_type}[/dim]")
    console.print(f"[dim]File: {audio_file} ({audio_file.stat().st_size / 1024:.1f} KB)[/dim]")

    whisper_model = _get_model(model, device, compute_type)

    kwargs = {}
    if language:
        kwargs["language"] = language

    segments, info = whisper_model.transcribe(str(audio_file), **kwargs)

    if not language:
        console.print(f"[dim]Detected language: {info.language} (p={info.language_probability:.2f})[/dim]")

    if json_output:
        import json
        results = []
        for seg in segments:
            results.append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
            })
        output_text = json.dumps({
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 3),
            "segments": results,
            "text": " ".join(r["text"] for r in results),
        }, indent=2, ensure_ascii=False)
    else:
        parts = []
        for seg in segments:
            parts.append(seg.text.strip())
        output_text = " ".join(parts)

    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(output_text)
        console.print(f"[green]✅ Written to {output}[/green]")
    else:
        # Print to stdout (useful for piping)
        print(output_text)
