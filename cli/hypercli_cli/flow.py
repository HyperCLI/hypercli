"""hyper flow commands - Simplified render flows"""
import math
import os
import typer
from pathlib import Path
from typing import Optional, List
from hypercli import HyperCLI
from .output import output, console, success, spinner

HUMO_FPS = 25  # HuMo video_humo template frame rate


def get_audio_duration(file_path: str) -> float | None:
    """Get audio duration in seconds using mutagen. Returns None on failure."""
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(file_path)
        if audio is not None and audio.info is not None:
            return audio.info.length
    except Exception:
        pass
    return None

app = typer.Typer(help="Simplified render flows for images, video, speech, and transcription.")


def get_client() -> HyperCLI:
    return HyperCLI()


def resolve_input(client: HyperCLI, value: str, label: str = "file") -> tuple:
    """Resolve an input to (url, file_id).

    - Local file path → uploads via files API, returns (None, file_id)
    - URL (http/https) → returns (url, None)

    Returns:
        Tuple of (url, file_id) — exactly one will be set.
    """
    p = Path(value)
    if p.is_file():
        with spinner(f"Uploading {p.name}..."):
            f = client.files.upload(str(p))
        console.print(f"  [green]✓[/green] Uploaded {p.name} → [dim]{f.id[:8]}[/dim]")
        return None, f.id
    return value, None


def print_render_result(render, fmt: str):
    """Print render result consistently across all commands."""
    if fmt == "json":
        output(render, "json")
    else:
        console.print(f"[bold green]✓[/bold green] Render created: [cyan]{render.render_id}[/cyan]")
        console.print(f"  State: {render.state}")
        if render.template:
            console.print(f"  Template: {render.template}")
        if render.result_url:
            console.print(f"  Result: {render.result_url}")


# =============================================================================
# Common option definitions for consistency
# =============================================================================

OPT_NEGATIVE = typer.Option(None, "--negative", "-n", help="Negative prompt (things to avoid)")
OPT_WIDTH = typer.Option(None, "--width", "-W", help="Output width")
OPT_HEIGHT = typer.Option(None, "--height", "-H", help="Output height")
OPT_NOTIFY = typer.Option(None, "--notify", help="Webhook URL for completion notification")
OPT_FMT = typer.Option("table", "--output", "-o", help="Output format: table|json")


# =============================================================================
# Text-only flows (no file inputs)
# =============================================================================

@app.command("text-to-image")
def text_to_image(
    prompt: str = typer.Argument(..., help="Text description of the image"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate an image from a text prompt using Qwen-Image.

    Excellent for text rendering in images. GPU: L40S.

    Examples:

      hyper flow text-to-image "a cat wearing sunglasses"

      hyper flow text-to-image "neon sign saying HELLO" -W 1024 -H 768
    """
    client = get_client()
    with spinner("Creating render..."):
        render = client.renders.text_to_image(
            prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


@app.command("text-to-image-hidream")
def text_to_image_hidream(
    prompt: str = typer.Argument(..., help="Text description of the image"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate an image using HiDream I1 Full (highest quality, 50 steps).

    GPU: L40S.

    Examples:

      hyper flow text-to-image-hidream "a mystical forest at sunset"
    """
    client = get_client()
    with spinner("Creating render..."):
        render = client.renders.text_to_image_hidream(
            prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


@app.command("text-to-video")
def text_to_video(
    prompt: str = typer.Argument(..., help="Text description of the video"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate a video from a text prompt using Wan 2.2 14B.

    GPU: RTX PRO 6000 in Finland.

    Examples:

      hyper flow text-to-video "a cat walking through a garden"
    """
    client = get_client()
    with spinner("Creating render..."):
        render = client.renders.text_to_video(
            prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


# =============================================================================
# Single-image input flows
# =============================================================================

@app.command("image-to-video")
def image_to_video(
    prompt: str = typer.Argument(..., help="Description of the motion/animation"),
    image: Optional[str] = typer.Option(None, "--image", "-i", help="Image — URL or local file path"),
    file_id: Optional[str] = typer.Option(None, "--file-id", help="Pre-uploaded image file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Animate an image into a video using Wan 2.2 14B Animate.

    GPU: RTX PRO 6000 in Finland.

    Inputs accept URLs, local file paths (auto-uploaded), or pre-uploaded file IDs.

    Examples:

      hyper flow image-to-video "the character is dancing" -i character.png

      hyper flow image-to-video "waves crashing" -i https://example.com/ocean.jpg

      hyper flow image-to-video "dancing" --file-id abc123
    """
    if not image and not file_id:
        console.print("[red]Error:[/red] --image/-i or --file-id is required")
        raise typer.Exit(1)

    client = get_client()

    image_url, file_ids = None, None
    if file_id:
        file_ids = [file_id]
    elif image:
        url, fid = resolve_input(client, image, "image")
        if fid:
            file_ids = [fid]
        else:
            image_url = url

    with spinner("Creating render..."):
        render = client.renders.image_to_video(
            prompt=prompt, image_url=image_url, file_ids=file_ids,
            negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


# =============================================================================
# Multi-input flows (image + audio, two images, etc.)
# =============================================================================

@app.command("speaking-video")
def speaking_video(
    prompt: str = typer.Argument(..., help="Scene description prompt"),
    image: Optional[str] = typer.Option(None, "--image", "-i", help="Portrait image — URL or local file path"),
    image_id: Optional[str] = typer.Option(None, "--image-id", help="Pre-uploaded image file ID"),
    audio: Optional[str] = typer.Option(None, "--audio", "-a", help="Audio file — URL or local file path"),
    audio_id: Optional[str] = typer.Option(None, "--audio-id", help="Pre-uploaded audio file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate a speaking/lip-sync video using HuMo 17B.

    Animates a portrait image with audio to produce a talking-head video.

    Output: 640x640 MP4, duration matches audio. GPU: RTX PRO 6000 in Finland.

    Inputs accept URLs, local file paths (auto-uploaded), or pre-uploaded file IDs.

    Examples:

      hyper flow speaking-video "a person speaking" -i face.png -a speech.wav

      hyper flow speaking-video "a person speaking" -i https://example.com/face.png -a https://example.com/speech.wav

      hyper flow speaking-video "a person speaking" --image-id abc123 --audio-id def456
    """
    client = get_client()

    # Resolve image
    image_url, image_file_id = None, None
    if image_id:
        image_file_id = image_id
    elif image:
        image_url, image_file_id = resolve_input(client, image, "image")
    else:
        console.print("[red]Error:[/red] --image/-i or --image-id is required")
        raise typer.Exit(1)

    # Resolve audio + detect duration for frame count
    audio_url, audio_file_id = None, None
    length = None
    if audio_id:
        audio_file_id = audio_id
    elif audio:
        # If local file, detect duration before uploading
        if not audio.startswith(("http://", "https://")):
            duration = get_audio_duration(audio)
            if duration:
                length = math.ceil(duration * HUMO_FPS) + 1
                console.print(f"[dim]Audio: {duration:.1f}s → {length} frames[/dim]")
        audio_url, audio_file_id = resolve_input(client, audio, "audio")
    else:
        console.print("[red]Error:[/red] --audio/-a or --audio-id is required")
        raise typer.Exit(1)

    # Build file_ids (positional: [image, audio])
    file_ids = None
    if image_file_id or audio_file_id:
        file_ids = [fid for fid in [image_file_id, audio_file_id] if fid]

    with spinner("Creating render..."):
        render = client.renders.speaking_video(
            prompt=prompt, image_url=image_url, audio_url=audio_url, file_ids=file_ids,
            negative=negative, length=length, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


@app.command("image-to-image")
def image_to_image(
    prompt: str = typer.Argument(..., help="Description of the transformation"),
    images: Optional[List[str]] = typer.Option(None, "--image", "-i", help="Image — URL or local file path (repeat for multiple, max 3)"),
    file_ids_opt: Optional[List[str]] = typer.Option(None, "--file-id", help="Pre-uploaded file ID (repeat for multiple, max 3)"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Transform images using Qwen Image Edit (1-3 input images).

    First image is the main subject, additional images are style references.

    GPU: RTX PRO 6000 in Finland.

    Inputs accept URLs, local file paths (auto-uploaded), or pre-uploaded file IDs.

    Examples:

      hyper flow image-to-image "make it look like a watercolor" -i photo.jpg

      hyper flow image-to-image "apply this style" -i subject.jpg -i style_ref.jpg

      hyper flow image-to-image "transform" --file-id abc123 --file-id def456
    """
    if not images and not file_ids_opt:
        console.print("[red]Error:[/red] At least one --image/-i or --file-id is required")
        raise typer.Exit(1)

    client = get_client()

    image_urls = []
    file_ids = []

    if file_ids_opt:
        file_ids = list(file_ids_opt)
    elif images:
        for img in images:
            url, fid = resolve_input(client, img, "image")
            if fid:
                file_ids.append(fid)
            else:
                image_urls.append(url)

    with spinner("Creating render..."):
        render = client.renders.image_to_image(
            prompt=prompt,
            image_urls=image_urls or None,
            file_ids=file_ids or None,
            negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


@app.command("first-last-frame-video")
def first_last_frame_video(
    prompt: str = typer.Argument(..., help="Description of the transition/motion"),
    start_image: Optional[str] = typer.Option(None, "--start", "-s", help="Start frame — URL or local file path"),
    end_image: Optional[str] = typer.Option(None, "--end", "-e", help="End frame — URL or local file path"),
    start_id: Optional[str] = typer.Option(None, "--start-id", help="Pre-uploaded start frame file ID"),
    end_id: Optional[str] = typer.Option(None, "--end-id", help="Pre-uploaded end frame file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate a video morphing between two images using Wan 2.2 14B.

    Creates smooth transitions between start and end frames.

    GPU: RTX PRO 6000 in Finland.

    Inputs accept URLs, local file paths (auto-uploaded), or pre-uploaded file IDs.

    Examples:

      hyper flow first-last-frame-video "smooth transition" -s day.png -e night.png

      hyper flow first-last-frame-video "morphing" --start-id abc123 --end-id def456
    """
    client = get_client()

    # Resolve start image
    start_url, start_file_id = None, None
    if start_id:
        start_file_id = start_id
    elif start_image:
        start_url, start_file_id = resolve_input(client, start_image, "start image")
    else:
        console.print("[red]Error:[/red] --start/-s or --start-id is required")
        raise typer.Exit(1)

    # Resolve end image
    end_url, end_file_id = None, None
    if end_id:
        end_file_id = end_id
    elif end_image:
        end_url, end_file_id = resolve_input(client, end_image, "end image")
    else:
        console.print("[red]Error:[/red] --end/-e or --end-id is required")
        raise typer.Exit(1)

    # Build file_ids (positional: [start, end])
    file_ids = None
    if start_file_id or end_file_id:
        file_ids = [fid for fid in [start_file_id, end_file_id] if fid]

    with spinner("Creating render..."):
        render = client.renders.first_last_frame_video(
            prompt=prompt, start_image_url=start_url, end_image_url=end_url, file_ids=file_ids,
            negative=negative, width=width, height=height, notify_url=notify_url,
        )
    print_render_result(render, fmt)


# =============================================================================
# Audio flows
# =============================================================================

@app.command("audio-to-text")
def audio_to_text(
    input: Optional[str] = typer.Argument(None, help="Audio URL or local file path"),
    file_id: Optional[str] = typer.Option(None, "--file-id", help="Pre-uploaded audio file ID"),
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Transcribe audio to text using WhisperX.

    GPU: L4.

    Accepts a URL, local file path (auto-uploaded), or pre-uploaded file ID.

    Examples:

      hyper flow audio-to-text recording.mp3

      hyper flow audio-to-text https://example.com/recording.mp3

      hyper flow audio-to-text --file-id abc123
    """
    if not input and not file_id:
        console.print("[red]Error:[/red] Provide an audio URL/file path or --file-id")
        raise typer.Exit(1)

    client = get_client()

    audio_url, file_ids = None, None
    if file_id:
        file_ids = [file_id]
    elif input:
        url, fid = resolve_input(client, input, "audio")
        if fid:
            file_ids = [fid]
        else:
            audio_url = url

    with spinner("Creating render..."):
        render = client.renders.audio_to_text(audio_url=audio_url, file_ids=file_ids, notify_url=notify_url)
    print_render_result(render, fmt)


@app.command("text-to-speech")
def text_to_speech(
    text: str = typer.Argument(..., help="Text to synthesize"),
    mode: str = typer.Option("design", "--mode", "-m", help="TTS mode: custom, design, or clone"),
    language: str = typer.Option("Auto", "--language", "-l", help="Language (Auto, English, Chinese, etc.)"),
    # CustomVoice options
    speaker: Optional[str] = typer.Option(None, "--speaker", "-s", help="Speaker for custom mode (Ryan, Serena, etc.)"),
    style: Optional[str] = typer.Option(None, "--style", help="Style instruction for custom mode"),
    model_size: Optional[str] = typer.Option(None, "--model-size", help="Model size: 0.6B or 1.7B"),
    # VoiceDesign options
    voice_description: Optional[str] = typer.Option(None, "--voice-desc", "-d", help="Voice description for design mode"),
    # VoiceClone options
    ref_audio: Optional[str] = typer.Option(None, "--ref-audio", help="Reference audio — URL or local file path (clone mode)"),
    ref_audio_id: Optional[str] = typer.Option(None, "--ref-audio-id", help="Pre-uploaded reference audio file ID (clone mode)"),
    ref_text: Optional[str] = typer.Option(None, "--ref-text", help="Reference audio transcript for clone mode"),
    use_xvector_only: bool = typer.Option(False, "--xvector-only", help="Use x-vector only for clone mode"),
    # Output
    notify_url: Optional[str] = OPT_NOTIFY,
    fmt: str = OPT_FMT,
):
    """
    Generate speech from text using Qwen3-TTS.

    Three modes:

      design  - Describe any voice in natural language (default)

      custom  - Use predefined speakers (Ryan, Serena, etc.)

      clone   - Clone a voice from reference audio

    Clone mode accepts URLs, local file paths, or pre-uploaded file IDs for reference audio.

    Examples:

      hyper flow text-to-speech "Hello world" -d "A young Indian male voice"

      hyper flow text-to-speech "Hello" -m custom -s Serena --style "Speak warmly"

      hyper flow text-to-speech "Hello" -m clone --ref-audio reference.wav --ref-text "..."
    """
    client = get_client()

    # Resolve ref_audio for clone mode
    ref_audio_url = None
    file_ids = None
    if ref_audio_id:
        file_ids = [ref_audio_id]
    elif ref_audio:
        url, fid = resolve_input(client, ref_audio, "ref audio")
        if fid:
            file_ids = [fid]
        else:
            ref_audio_url = url

    with spinner("Creating render..."):
        render = client.renders.text_to_speech(
            text=text, mode=mode, language=language,
            speaker=speaker, style=style, model_size=model_size,
            voice_description=voice_description,
            ref_audio_url=ref_audio_url, file_ids=file_ids,
            ref_text=ref_text,
            use_xvector_only=use_xvector_only if use_xvector_only else None,
            notify_url=notify_url,
        )
    print_render_result(render, fmt)
