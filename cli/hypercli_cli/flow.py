"""hyper flow commands - simplified flow interfaces"""
import math
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import typer
from pathlib import Path
from typing import Any, Optional, List

from hypercli import HyperCLI, X402Client
from .output import output, console, spinner

HUMO_FPS = 25  # HuMo video_humo template frame rate
USDC_ATOMIC_UNITS = Decimal("1000000")


app = typer.Typer(help="Simplified render flows for images, video, speech, and transcription.")


def get_client() -> HyperCLI:
    return HyperCLI()


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


def resolve_input(client: HyperCLI, value: str, label: str = "file") -> tuple[str | None, str | None]:
    """Resolve an input to (url, file_id)."""
    p = Path(value)
    if p.is_file():
        with spinner(f"Uploading {label} {p.name}..."):
            f = client.files.upload(str(p))
        console.print(f"  [green]✓[/green] Uploaded {p.name} -> [dim]{f.id[:8]}[/dim]")
        return None, f.id
    return value, None


def _usd_to_atomic(amount_usd: float) -> int:
    try:
        usd = Decimal(str(amount_usd))
    except (InvalidOperation, TypeError, ValueError):
        raise typer.BadParameter("Invalid --amount value")
    if usd <= 0:
        raise typer.BadParameter("--amount must be greater than 0")
    return int((usd * USDC_ATOMIC_UNITS).to_integral_value(rounding=ROUND_HALF_UP))


def _create_flow_render(
    flow_type: str,
    payload: dict[str, Any],
    x402: bool,
    amount: Optional[float],
):
    """Create a flow render either via account billing or x402."""
    clean_payload = {k: v for k, v in payload.items() if v is not None}

    if x402:
        from .wallet import require_wallet_deps, load_wallet

        require_wallet_deps()
        account = load_wallet()
        notify_url = clean_payload.pop("notify_url", None)

        x402_client = X402Client()
        required_amount = x402_client.get_flow_price(flow_type)
        required_amount_raw = _usd_to_atomic(required_amount)

        if amount is None:
            amount = required_amount
            console.print(f"[dim]Using fixed x402 flow price for {flow_type}: ${amount:.6f}[/dim]")
        else:
            provided_amount_raw = _usd_to_atomic(amount)
            if provided_amount_raw != required_amount_raw:
                raise typer.BadParameter(
                    f"--amount must equal fixed flow price for {flow_type}: ${required_amount:.6f}"
                )

        with spinner("Creating render with x402..."):
            x402_result = x402_client.create_flow(
                flow_type=flow_type,
                amount=amount,
                account=account,
                params=clean_payload,
                notify_url=notify_url,
            )
        return x402_result.render, x402_result

    with spinner("Creating render..."):
        render = get_client().renders._flow(f"/api/flow/{flow_type}", **clean_payload)
    return render, None


def print_render_result(render, fmt: str, x402_result=None):
    """Print render result consistently across all commands."""
    if fmt == "json":
        if x402_result:
            output(
                {
                    "render": render.__dict__,
                    "access_key": x402_result.access_key,
                    "status_url": x402_result.status_url,
                    "cancel_url": x402_result.cancel_url,
                },
                "json",
            )
        else:
            output(render, "json")
        return

    console.print(f"[bold green]✓[/bold green] Render created: [cyan]{render.render_id}[/cyan]")
    console.print(f"  State: {render.state}")
    if render.template:
        console.print(f"  Template: {render.template}")
    if render.result_url:
        console.print(f"  Result: {render.result_url}")
    if x402_result:
        console.print(f"  Access Key: {x402_result.access_key}")
        console.print(f"  Status URL: {x402_result.status_url}")
        console.print(f"  Cancel URL: {x402_result.cancel_url}")


# =============================================================================
# Common option definitions
# =============================================================================

OPT_NEGATIVE = typer.Option(None, "--negative", "-n", help="Negative prompt (things to avoid)")
OPT_WIDTH = typer.Option(None, "--width", "-W", help="Output width")
OPT_HEIGHT = typer.Option(None, "--height", "-H", help="Output height")
OPT_NOTIFY = typer.Option(None, "--notify", help="Webhook URL for completion notification")
OPT_X402 = typer.Option(False, "--x402", help="Pay per-use via embedded x402 wallet")
OPT_AMOUNT = typer.Option(None, "--amount", help="USDC amount to spend with --x402 (defaults to fixed flow price)")
OPT_FMT = typer.Option("table", "--output", "-o", help="Output format: table|json")


@app.command("text-to-image")
def text_to_image(
    prompt: str = typer.Argument(..., help="Text description of the image"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    payload = {
        "prompt": prompt,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("text-to-image", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("text-to-image-hidream")
def text_to_image_hidream(
    prompt: str = typer.Argument(..., help="Text description of the image"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    payload = {
        "prompt": prompt,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("text-to-image-hidream", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("text-to-video")
def text_to_video(
    prompt: str = typer.Argument(..., help="Text description of the video"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    payload = {
        "prompt": prompt,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("text-to-video", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("image-to-video")
def image_to_video(
    prompt: str = typer.Argument(..., help="Description of the motion/animation"),
    image: Optional[str] = typer.Option(None, "--image", "-i", help="Image URL or local file path"),
    file_id: Optional[str] = typer.Option(None, "--file-id", help="Pre-uploaded image file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
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

    payload = {
        "prompt": prompt,
        "image_url": image_url,
        "file_ids": file_ids,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("image-to-video", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("speaking-video")
def speaking_video(
    prompt: str = typer.Argument(..., help="Scene description prompt"),
    image: Optional[str] = typer.Option(None, "--image", "-i", help="Portrait image URL or local file path"),
    image_id: Optional[str] = typer.Option(None, "--image-id", help="Pre-uploaded image file ID"),
    audio: Optional[str] = typer.Option(None, "--audio", "-a", help="Audio file URL or local file path"),
    audio_id: Optional[str] = typer.Option(None, "--audio-id", help="Pre-uploaded audio file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    client = get_client()

    image_url, image_file_id = None, None
    if image_id:
        image_file_id = image_id
    elif image:
        image_url, image_file_id = resolve_input(client, image, "image")
    else:
        console.print("[red]Error:[/red] --image/-i or --image-id is required")
        raise typer.Exit(1)

    audio_url, audio_file_id = None, None
    length = None
    if audio_id:
        audio_file_id = audio_id
    elif audio:
        if not audio.startswith(("http://", "https://")):
            duration = get_audio_duration(audio)
            if duration:
                length = math.ceil(duration * HUMO_FPS) + 1
                console.print(f"[dim]Audio: {duration:.1f}s -> {length} frames[/dim]")
        audio_url, audio_file_id = resolve_input(client, audio, "audio")
    else:
        console.print("[red]Error:[/red] --audio/-a or --audio-id is required")
        raise typer.Exit(1)

    file_ids = None
    if image_file_id or audio_file_id:
        file_ids = [fid for fid in [image_file_id, audio_file_id] if fid]

    payload = {
        "prompt": prompt,
        "image_url": image_url,
        "audio_url": audio_url,
        "file_ids": file_ids,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    if length is not None:
        payload["length"] = length

    render, x402_result = _create_flow_render("speaking-video", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("image-to-image")
def image_to_image(
    prompt: str = typer.Argument(..., help="Description of the transformation"),
    images: Optional[List[str]] = typer.Option(None, "--image", "-i", help="Image URL or local file path (repeat for multiple, max 3)"),
    file_ids_opt: Optional[List[str]] = typer.Option(None, "--file-id", help="Pre-uploaded file ID (repeat for multiple, max 3)"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    if not images and not file_ids_opt:
        console.print("[red]Error:[/red] At least one --image/-i or --file-id is required")
        raise typer.Exit(1)

    client = get_client()
    image_urls: list[str] = []
    file_ids: list[str] = []

    if file_ids_opt:
        file_ids = list(file_ids_opt)
    elif images:
        for img in images:
            url, fid = resolve_input(client, img, "image")
            if fid:
                file_ids.append(fid)
            else:
                image_urls.append(url)

    payload = {
        "prompt": prompt,
        "image_urls": image_urls or None,
        "file_ids": file_ids or None,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("image-to-image", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("first-last-frame-video")
def first_last_frame_video(
    prompt: str = typer.Argument(..., help="Description of the transition/motion"),
    start_image: Optional[str] = typer.Option(None, "--start", "-s", help="Start frame URL or local file path"),
    end_image: Optional[str] = typer.Option(None, "--end", "-e", help="End frame URL or local file path"),
    start_id: Optional[str] = typer.Option(None, "--start-id", help="Pre-uploaded start frame file ID"),
    end_id: Optional[str] = typer.Option(None, "--end-id", help="Pre-uploaded end frame file ID"),
    negative: Optional[str] = OPT_NEGATIVE,
    width: Optional[int] = OPT_WIDTH,
    height: Optional[int] = OPT_HEIGHT,
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    client = get_client()

    start_url, start_file_id = None, None
    if start_id:
        start_file_id = start_id
    elif start_image:
        start_url, start_file_id = resolve_input(client, start_image, "start image")
    else:
        console.print("[red]Error:[/red] --start/-s or --start-id is required")
        raise typer.Exit(1)

    end_url, end_file_id = None, None
    if end_id:
        end_file_id = end_id
    elif end_image:
        end_url, end_file_id = resolve_input(client, end_image, "end image")
    else:
        console.print("[red]Error:[/red] --end/-e or --end-id is required")
        raise typer.Exit(1)

    file_ids = None
    if start_file_id or end_file_id:
        file_ids = [fid for fid in [start_file_id, end_file_id] if fid]

    payload = {
        "prompt": prompt,
        "start_image_url": start_url,
        "end_image_url": end_url,
        "file_ids": file_ids,
        "negative": negative,
        "width": width,
        "height": height,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("first-last-frame-video", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("audio-to-text")
def audio_to_text(
    input: Optional[str] = typer.Argument(None, help="Audio URL or local file path"),
    file_id: Optional[str] = typer.Option(None, "--file-id", help="Pre-uploaded audio file ID"),
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
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

    payload = {
        "audio_url": audio_url,
        "file_ids": file_ids,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("audio-to-text", payload, x402, amount)
    print_render_result(render, fmt, x402_result)


@app.command("text-to-speech")
def text_to_speech(
    text: str = typer.Argument(..., help="Text to synthesize"),
    mode: str = typer.Option("design", "--mode", "-m", help="TTS mode: custom, design, or clone"),
    language: str = typer.Option("Auto", "--language", "-l", help="Language (Auto, English, Chinese, etc.)"),
    speaker: Optional[str] = typer.Option(None, "--speaker", "-s", help="Speaker for custom mode"),
    style: Optional[str] = typer.Option(None, "--style", help="Style instruction for custom mode"),
    model_size: Optional[str] = typer.Option(None, "--model-size", help="Model size: 0.6B or 1.7B"),
    voice_description: Optional[str] = typer.Option(None, "--voice-desc", "-d", help="Voice description for design mode"),
    ref_audio: Optional[str] = typer.Option(None, "--ref-audio", help="Reference audio URL or local file path (clone mode)"),
    ref_audio_id: Optional[str] = typer.Option(None, "--ref-audio-id", help="Pre-uploaded reference audio file ID (clone mode)"),
    ref_text: Optional[str] = typer.Option(None, "--ref-text", help="Reference audio transcript for clone mode"),
    use_xvector_only: bool = typer.Option(False, "--xvector-only", help="Use x-vector only for clone mode"),
    notify_url: Optional[str] = OPT_NOTIFY,
    x402: bool = OPT_X402,
    amount: Optional[float] = OPT_AMOUNT,
    fmt: str = OPT_FMT,
):
    client = get_client()

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

    payload = {
        "text": text,
        "mode": mode,
        "language": language,
        "speaker": speaker,
        "style": style,
        "model_size": model_size,
        "voice_description": voice_description,
        "ref_audio_url": ref_audio_url,
        "file_ids": file_ids,
        "ref_text": ref_text,
        "use_xvector_only": use_xvector_only if use_xvector_only else None,
        "notify_url": notify_url,
    }
    render, x402_result = _create_flow_render("text-to-speech", payload, x402, amount)
    print_render_result(render, fmt, x402_result)
