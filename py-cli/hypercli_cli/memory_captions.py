"""Caption-to-OpenClaw memory helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
import os
from pathlib import Path
import re
import shutil
from typing import Iterable

import yaml


SUPPORTED_CAPTION_EXTENSIONS = {".srt", ".vtt", ".ttml"}
DEFAULT_WORKSPACE = Path.home() / ".openclaw" / "workspace"

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_VTT_TIMESTAMP_TAG_RE = re.compile(r"<\d{2}:\d{2}:\d{2}\.\d{3}>")
_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class CaptionSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class CaptionImportResult:
    markdown_path: Path
    parsed_text_path: Path | None
    raw_caption_path: Path | None
    raw_json3_path: Path | None
    segment_count: int
    transcript_line_count: int


def resolve_memory_root(
    *,
    workspace: Path | None = None,
    memory_dir: Path | None = None,
) -> Path:
    """Resolve the OpenClaw memory root for generated artifacts."""
    if memory_dir is not None:
        return memory_dir.expanduser().resolve()
    env_memory_dir = os.environ.get("HYPER_MEMORY_DIR")
    if env_memory_dir:
        return Path(env_memory_dir).expanduser().resolve()
    resolved_workspace = (workspace or DEFAULT_WORKSPACE).expanduser().resolve()
    return resolved_workspace / "memory"


def _format_timestamp(total_ms: int) -> str:
    total_seconds = max(0, total_ms // 1000)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _format_youtube_timestamp(total_ms: int) -> int:
    return max(0, total_ms // 1000)


def _clean_caption_text(text: str) -> str:
    cleaned = text.replace("\\N", " ").replace("\n", " ")
    cleaned = _VTT_TIMESTAMP_TAG_RE.sub("", cleaned)
    cleaned = _HTML_TAG_RE.sub("", cleaned)
    cleaned = unescape(cleaned)
    return _SPACE_RE.sub(" ", cleaned).strip()


def _common_suffix_prefix(left: str, right: str) -> int:
    max_len = min(len(left), len(right))
    for size in range(max_len, 7, -1):
        if left[-size:] == right[:size]:
            return size
    return 0


def _dedupe_progressive_segments(segments: Iterable[CaptionSegment]) -> list[CaptionSegment]:
    """Collapse common YouTube roll-up/progressive caption repeats.

    Auto captions often emit "hello", then "hello world", then "world again". Keeping all of
    those hurts search quality. This pass prefers the longest nearby text and merges suffix/prefix
    overlaps while keeping the earliest timestamp.
    """
    output: list[CaptionSegment] = []
    for segment in segments:
        text = _clean_caption_text(segment.text)
        if not text:
            continue
        current = CaptionSegment(segment.start_ms, segment.end_ms, text)
        if not output:
            output.append(current)
            continue

        previous = output[-1]
        gap_ms = current.start_ms - previous.end_ms
        nearby = gap_ms <= 2500
        if nearby and current.text == previous.text:
            output[-1] = CaptionSegment(
                previous.start_ms, max(previous.end_ms, current.end_ms), previous.text
            )
            continue
        if nearby and current.text.startswith(previous.text):
            output[-1] = CaptionSegment(previous.start_ms, current.end_ms, current.text)
            continue
        if nearby and previous.text.endswith(current.text):
            output[-1] = CaptionSegment(previous.start_ms, current.end_ms, previous.text)
            continue
        overlap = _common_suffix_prefix(previous.text, current.text) if nearby else 0
        if overlap:
            merged = previous.text + current.text[overlap:]
            output[-1] = CaptionSegment(previous.start_ms, current.end_ms, merged)
            continue
        output.append(current)
    return output


def parse_caption_file(path: Path) -> list[CaptionSegment]:
    """Parse an SRT/VTT/TTML caption file into cleaned timestamped segments."""
    try:
        import pysubs2
    except ImportError as exc:
        raise RuntimeError(
            "pysubs2 is required for caption imports. Install with: pip install pysubs2"
        ) from exc

    subs = pysubs2.load(str(path))
    raw_segments = [
        CaptionSegment(
            start_ms=int(event.start),
            end_ms=int(event.end),
            text=str(getattr(event, "plaintext", None) or event.text or ""),
        )
        for event in subs
    ]
    return _dedupe_progressive_segments(raw_segments)


def transcript_lines(
    segments: list[CaptionSegment],
    *,
    max_group_seconds: int = 20,
) -> list[CaptionSegment]:
    """Merge nearby caption cues into readable transcript lines."""
    lines: list[CaptionSegment] = []
    buffer: CaptionSegment | None = None

    def should_flush(text: str, start_ms: int, end_ms: int) -> bool:
        if end_ms - start_ms >= max_group_seconds * 1000:
            return True
        return text.endswith((".", "?", "!", ".”", "?’", "!”", '"'))

    for segment in segments:
        if buffer is None:
            buffer = segment
        else:
            gap_ms = segment.start_ms - buffer.end_ms
            if gap_ms > 3000 or should_flush(buffer.text, buffer.start_ms, buffer.end_ms):
                lines.append(buffer)
                buffer = segment
            else:
                buffer = CaptionSegment(
                    start_ms=buffer.start_ms,
                    end_ms=segment.end_ms,
                    text=f"{buffer.text} {segment.text}".strip(),
                )
        if buffer and should_flush(buffer.text, buffer.start_ms, buffer.end_ms):
            lines.append(buffer)
            buffer = None

    if buffer is not None:
        lines.append(buffer)
    return lines


def infer_video_id(path: Path) -> str:
    """Infer a stable id from caption names like VIDEO.en-orig.srt."""
    stem = path.name[: -len(path.suffix)] if path.suffix else path.stem
    return stem.split(".", 1)[0] or path.stem


def infer_caption_language(path: Path) -> str | None:
    stem = path.name[: -len(path.suffix)] if path.suffix else path.stem
    parts = stem.split(".")
    return parts[1] if len(parts) > 1 and parts[1] else None


def discover_caption_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    if not input_path.is_dir():
        raise FileNotFoundError(f"caption input not found: {input_path}")
    return sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_CAPTION_EXTENSIONS
    )


def _copy_raw_file(source: Path | None, raw_dir: Path) -> Path | None:
    if source is None:
        return None
    raw_dir.mkdir(parents=True, exist_ok=True)
    destination = raw_dir / source.name
    if source.resolve() != destination.resolve():
        shutil.copy2(source, destination)
    return destination


def _write_parsed_caption_text(path: Path, lines: list[CaptionSegment]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(f"[{_format_timestamp(line.start_ms)}] {line.text}" for line in lines)
    path.write_text(f"{text}\n" if text else "", encoding="utf-8")
    return path


def _relative_posix(path: Path, base: Path) -> str:
    return Path(os.path.relpath(path, base)).as_posix()


def _frontmatter_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return cleaned or None
    return value


def build_memory_markdown(
    *,
    video_id: str,
    title: str,
    source_url: str | None,
    channel: str | None,
    channel_url: str | None,
    participants: list[str] | None,
    caption_language: str | None,
    caption_kind: str | None,
    raw_caption_rel: str | None,
    raw_json3_rel: str | None,
    parsed_text_rel: str | None,
    imported_at: str,
    segments: list[CaptionSegment],
    enrichment: dict | None = None,
) -> str:
    lines = transcript_lines(segments)
    duration_seconds = round(max((segment.end_ms for segment in segments), default=0) / 1000, 3)
    frontmatter = {
        "source_type": "youtube" if source_url and "youtube." in source_url else "captions",
        "video_id": video_id,
        "title": title,
        "channel": _frontmatter_value(channel),
        "channel_url": _frontmatter_value(channel_url),
        "source_url": _frontmatter_value(source_url),
        "source_file": _frontmatter_value(raw_caption_rel),
        "parsed_text_file": _frontmatter_value(parsed_text_rel),
        "duration_seconds": duration_seconds,
        "caption_language": _frontmatter_value(caption_language),
        "caption_kind": _frontmatter_value(caption_kind),
        "participants": _frontmatter_value(participants),
        "raw_caption_file": _frontmatter_value(raw_caption_rel),
        "raw_json3_file": _frontmatter_value(raw_json3_rel),
        "imported_at": imported_at,
        "segment_count": len(segments),
        "transcript_line_count": len(lines),
    }
    frontmatter = {key: value for key, value in frontmatter.items() if value is not None}

    body: list[str] = ["---"]
    body.append(yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True).strip())
    body.append("---")
    body.append("")
    body.append(f"# {title}")
    body.append("")
    if source_url:
        body.append(f"Source: {source_url}  ")
    if channel:
        body.append(f"Channel: {channel}  ")
    if channel_url:
        body.append(f"Channel URL: {channel_url}  ")
    body.append(f"Duration: {duration_seconds:.3f}s  ")
    if caption_language:
        body.append(f"Caption language: {caption_language}  ")
    if caption_kind:
        body.append(f"Caption kind: {caption_kind}  ")
    body.append("")

    enrichment = enrichment or {}
    short_summary = str(enrichment.get("short_summary") or "").strip()
    long_description = str(enrichment.get("long_description") or "").strip()
    keywords = enrichment.get("keywords") or []
    if parsed_text_rel or raw_caption_rel or raw_json3_rel:
        body.extend(["## Source Files", ""])
        if parsed_text_rel:
            body.append(f"- Parsed text: `{parsed_text_rel}`")
        if raw_caption_rel:
            body.append(f"- Caption source: `{raw_caption_rel}`")
        if raw_json3_rel:
            body.append(f"- Exact timestamp source: `{raw_json3_rel}`")
        if source_url:
            body.append(f"- Source URL: {source_url}")
        body.append("")
    if short_summary:
        body.extend(["## Short Summary", "", short_summary, ""])
    if long_description:
        body.extend(["## Longer Description", "", long_description, ""])
    if keywords:
        body.extend(["## Keywords", ""])
        cleaned_keywords = [str(keyword).strip() for keyword in keywords if str(keyword).strip()]
        if cleaned_keywords:
            body.append(", ".join(f"`{keyword}`" for keyword in cleaned_keywords))
        body.append("")

    body.extend(["## Transcript", ""])
    current_heading: int | None = None
    for line in lines:
        heading_bucket = (_format_youtube_timestamp(line.start_ms) // 120) * 120
        if current_heading != heading_bucket:
            current_heading = heading_bucket
            heading_ms = heading_bucket * 1000
            body.append(f"### {_format_timestamp(heading_ms)}")
            if source_url:
                joiner = "&" if "?" in source_url else "?"
                body.append(f"Watch: {source_url}{joiner}t={heading_bucket}s")
            body.append("")
        body.append(f"[{_format_timestamp(line.start_ms)}] {line.text}")
    body.append("")
    return "\n".join(body)


def import_caption_file(
    *,
    caption_file: Path,
    workspace: Path | None = None,
    memory_dir: Path | None = None,
    collection: str,
    video_id: str | None = None,
    title: str | None = None,
    source_url: str | None = None,
    channel: str | None = None,
    channel_url: str | None = None,
    participants: list[str] | None = None,
    caption_language: str | None = None,
    caption_kind: str | None = None,
    raw_json3: Path | None = None,
    copy_raw: bool = True,
    enrichment: dict | None = None,
    imported_at: str | None = None,
) -> CaptionImportResult:
    caption_file = caption_file.resolve()
    memory_root = resolve_memory_root(workspace=workspace, memory_dir=memory_dir)
    collection = collection.strip().strip("/")
    if not collection:
        raise ValueError("collection is required")

    resolved_video_id = (video_id or infer_video_id(caption_file)).strip()
    resolved_title = (title or resolved_video_id).strip()
    resolved_language = caption_language or infer_caption_language(caption_file)
    resolved_imported_at = imported_at or datetime.now(timezone.utc).isoformat()

    collection_dir = memory_root / collection
    videos_dir = collection_dir / "videos"
    raw_dir = collection_dir / "raw"
    videos_dir.mkdir(parents=True, exist_ok=True)

    raw_caption_path = _copy_raw_file(caption_file, raw_dir) if copy_raw else None
    raw_json3_path = (
        _copy_raw_file(raw_json3.resolve() if raw_json3 else None, raw_dir) if copy_raw else None
    )
    segments = parse_caption_file(caption_file)
    parsed_lines = transcript_lines(segments)
    parsed_text_path = _write_parsed_caption_text(
        collection_dir / "parsed" / f"{resolved_video_id}.txt",
        parsed_lines,
    )

    raw_caption_rel = _relative_posix(raw_caption_path, videos_dir) if raw_caption_path else None
    raw_json3_rel = _relative_posix(raw_json3_path, videos_dir) if raw_json3_path else None
    parsed_text_rel = _relative_posix(parsed_text_path, videos_dir)
    markdown = build_memory_markdown(
        video_id=resolved_video_id,
        title=resolved_title,
        source_url=source_url,
        channel=channel,
        channel_url=channel_url,
        participants=participants,
        caption_language=resolved_language,
        caption_kind=caption_kind,
        raw_caption_rel=raw_caption_rel,
        raw_json3_rel=raw_json3_rel,
        parsed_text_rel=parsed_text_rel,
        imported_at=resolved_imported_at,
        segments=segments,
        enrichment=enrichment,
    )

    markdown_path = videos_dir / f"{resolved_video_id}.md"
    markdown_path.write_text(markdown, encoding="utf-8")
    return CaptionImportResult(
        markdown_path=markdown_path,
        parsed_text_path=parsed_text_path,
        raw_caption_path=raw_caption_path,
        raw_json3_path=raw_json3_path,
        segment_count=len(segments),
        transcript_line_count=len(parsed_lines),
    )
