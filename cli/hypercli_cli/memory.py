"""OpenClaw memory artifact helpers."""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
from typing import Any

import typer
from rich.console import Console

from . import llm
from .memory_captions import (
    DEFAULT_WORKSPACE,
    SUPPORTED_CAPTION_EXTENSIONS,
    discover_caption_files,
    import_caption_file,
    parse_caption_file,
    transcript_lines,
)
from .memory_documents import (
    SUPPORTED_DOCUMENT_EXTENSIONS,
    discover_document_files,
    extract_document_text,
    import_document_file,
)

app = typer.Typer(help="Prepare OpenClaw memory artifacts")
console = Console()
MEMORY_ENRICH_MAX_TOKENS = 512
KEYWORD_STOPWORDS = {
    "and",
    "for",
    "from",
    "into",
    "the",
    "this",
    "that",
    "with",
}


def _memory_enrich_temperature(model: str) -> float:
    normalized = model.lower()
    if "kimi" in normalized or "moonshot" in normalized:
        return 1.0
    return 0.2


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [part.strip() for part in value.split(",") if part.strip()] or None


def _sample_transcript_text(caption_file: Path, max_chars: int = 12_000) -> str:
    segments = parse_caption_file(caption_file)
    lines = transcript_lines(segments)
    parts: list[str] = []
    for line in lines:
        parts.append(line.text)
        if sum(len(part) + 1 for part in parts) >= max_chars:
            break
    return "\n".join(parts)[:max_chars]


def _sample_document_text(document_file: Path, max_chars: int = 12_000) -> str:
    return extract_document_text(document_file).text[:max_chars]


def _coerce_json_object(parsed: Any) -> dict[str, Any]:
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, list):
        for item in parsed:
            coerced = _coerce_json_object(item)
            if coerced:
                return coerced
    return {}


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"[\[{]", stripped):
            try:
                parsed, _ = decoder.raw_decode(stripped[match.start() :])
                break
            except json.JSONDecodeError:
                continue
        else:
            raise
    return _coerce_json_object(parsed)


def _first_string(parsed: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _first_list(parsed: dict[str, Any], keys: list[str]) -> list[Any]:
    for key in keys:
        value = parsed.get(key)
        if isinstance(value, list):
            return value
    return []


def _walk_strings(value: Any) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, dict):
        strings: list[str] = []
        for key, nested in value.items():
            if key in {"keywords", "tags", "topics", "source_url", "sourceUrl", "title"}:
                continue
            strings.extend(_walk_strings(nested))
        return strings
    if isinstance(value, list):
        strings = []
        for nested in value:
            strings.extend(_walk_strings(nested))
        return strings
    return []


def _derive_fallback_keywords(*values: str | None) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()
    for value in values:
        for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", value or ""):
            keyword = word.lower()
            if keyword in KEYWORD_STOPWORDS or keyword in seen:
                continue
            seen.add(keyword)
            keywords.append(keyword)
            if len(keywords) >= 6:
                return keywords
    return keywords or ["memory"]


def _fallback_summary(*, title: str | None, text_sample: str | None) -> str:
    sample = " ".join((text_sample or "").split())
    if sample:
        sample = sample[:220].rstrip()
    if title and sample:
        return f"{title}: {sample}"
    return title or sample or "Imported memory source."


def _normalize_enrichment_payload(
    parsed: dict[str, Any],
    *,
    fallback_title: str | None = None,
    fallback_text_sample: str | None = None,
    fallback_source_kind: str | None = None,
    fallback_source_name: str | None = None,
) -> dict[str, Any]:
    nested = parsed.get("metadata") or parsed.get("enrichment") or parsed.get("memory_metadata")
    if isinstance(nested, dict):
        parsed = {**nested, **parsed}

    summary = parsed.get("summary")
    if isinstance(summary, dict):
        parsed = {**summary, **parsed}

    short_summary = _first_string(
        parsed,
        [
            "short_summary",
            "shortSummary",
            "short",
            "brief_summary",
            "briefSummary",
            "summary",
        ],
    )
    long_description = _first_string(
        parsed,
        [
            "long_description",
            "longDescription",
            "long",
            "detailed_summary",
            "detailedSummary",
            "description",
        ],
    )
    raw_keywords = _first_list(parsed, ["keywords", "tags", "topics"])
    keywords = []
    if isinstance(raw_keywords, list):
        keywords = [str(keyword).strip() for keyword in raw_keywords if str(keyword).strip()]

    if not short_summary and not long_description:
        fallback_strings = _walk_strings(parsed)
        if fallback_strings:
            short_summary = fallback_strings[0]
        elif fallback_title or fallback_text_sample:
            short_summary = _fallback_summary(title=fallback_title, text_sample=fallback_text_sample)
        else:
            raise RuntimeError("LLM enrichment returned no summary fields")
    if not keywords:
        keywords = _derive_fallback_keywords(
            fallback_title,
            fallback_source_kind,
            fallback_source_name,
            fallback_text_sample,
        )

    return {
        "short_summary": short_summary,
        "long_description": long_description,
        "keywords": keywords,
    }


def enrich_text_metadata(
    *,
    title: str,
    source_kind: str,
    text_sample: str,
    source_url: str | None,
    source_name: str | None,
    model: str | None,
    base_url: str | None,
    key: str | None,
) -> dict[str, Any]:
    """Generate optional memory metadata through Hyper's OpenAI-compatible API."""
    api_key = llm._resolve_api_key(key)
    api_base = llm._resolve_api_base(base_url)
    resolved_model = model or llm._resolve_default_model(api_key, api_base)
    client = llm._get_openai_client(api_key, api_base)
    response = client.chat.completions.create(
        model=resolved_model,
        stream=False,
        temperature=_memory_enrich_temperature(resolved_model),
        max_tokens=MEMORY_ENRICH_MAX_TOKENS,
        messages=[
            {
                "role": "system",
                "content": (
                    "Return strict JSON only. Summarize extracted source text for an "
                    "OpenClaw memory file. Keep claims grounded in the supplied text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Title: {title}\n"
                    f"Source kind: {source_kind}\n"
                    f"Source name: {source_name or ''}\n"
                    f"Source URL: {source_url or ''}\n\n"
                    "Text excerpt:\n"
                    f"{text_sample}\n\n"
                    "Return JSON with keys: short_summary, long_description, keywords. "
                    "keywords must be a list of concise lowercase phrases."
                ),
            },
        ],
    )
    content = response.choices[0].message.content or "{}"
    try:
        parsed = _extract_json_object(content)
    except json.JSONDecodeError:
        parsed = {}
    return _normalize_enrichment_payload(
        parsed,
        fallback_title=title,
        fallback_text_sample=text_sample,
        fallback_source_kind=source_kind,
        fallback_source_name=source_name,
    )


def enrich_caption_metadata(
    *,
    caption_file: Path,
    title: str,
    source_url: str | None,
    channel: str | None,
    model: str | None,
    base_url: str | None,
    key: str | None,
) -> dict[str, Any]:
    """Generate optional caption metadata through Hyper's OpenAI-compatible API."""
    return enrich_text_metadata(
        title=title,
        source_kind="captions",
        text_sample=_sample_transcript_text(caption_file),
        source_url=source_url,
        source_name=channel,
        model=model,
        base_url=base_url,
        key=key,
    )


def enrich_document_metadata(
    *,
    document_file: Path,
    title: str,
    source_url: str | None,
    author: str | None,
    model: str | None,
    base_url: str | None,
    key: str | None,
) -> dict[str, Any]:
    """Generate optional document metadata through Hyper's OpenAI-compatible API."""
    return enrich_text_metadata(
        title=title,
        source_kind=document_file.suffix.lower().lstrip(".") or "document",
        text_sample=_sample_document_text(document_file),
        source_url=source_url,
        source_name=author,
        model=model,
        base_url=base_url,
        key=key,
    )


def _discover_memory_files(input_path: Path) -> tuple[list[Path], list[Path]]:
    if input_path.is_file():
        suffix = input_path.suffix.lower()
        if suffix in SUPPORTED_CAPTION_EXTENSIONS:
            return [input_path], []
        if suffix in SUPPORTED_DOCUMENT_EXTENSIONS:
            return [], [input_path]
        return [], []
    return discover_caption_files(input_path), discover_document_files(input_path)


def _run_index(*, index: bool, agent: str | None) -> None:
    if not index:
        return
    cmd = ["openclaw", "memory", "index"]
    if agent:
        cmd.extend(["--agent", agent])
    subprocess.run(cmd, check=True)


@app.command("import")
def import_memory(
    input_path: Path = typer.Argument(
        ...,
        help=(
            "Source file or directory. Supported: .srt, .vtt, .ttml, "
            ".pdf, .doc, .docx, .epub, .txt, .md"
        ),
    ),
    workspace: Path = typer.Option(
        DEFAULT_WORKSPACE,
        "--workspace",
        "-w",
        help="OpenClaw workspace root used when --memory-dir/HYPER_MEMORY_DIR is not set",
    ),
    memory_dir: Path = typer.Option(
        None,
        "--memory-dir",
        envvar="HYPER_MEMORY_DIR",
        help="OpenClaw memory root; defaults to <workspace>/memory",
    ),
    collection: str = typer.Option(
        ...,
        "--collection",
        "-c",
        help="Collection under memory root, e.g. youtube/examplecreator",
    ),
    source_id: str = typer.Option(
        None,
        "--source-id",
        help="Stable source/video id for single-file imports",
    ),
    title: str = typer.Option(None, "--title", help="Readable title for single-file imports"),
    source_url: str = typer.Option(None, "--source-url", help="Original source URL"),
    channel: str = typer.Option(None, "--channel", help="Channel/show/source name"),
    channel_url: str = typer.Option(None, "--channel-url", help="Channel/show/source URL"),
    author: str = typer.Option(None, "--author", help="Document author/source name"),
    source_type: str = typer.Option(
        None, "--source-type", help="Override document source type in frontmatter"
    ),
    participants: str = typer.Option(
        None,
        "--participants",
        help="Comma-separated participant names, if known",
    ),
    caption_language: str = typer.Option(None, "--language", "-l", help="Caption language"),
    caption_kind: str = typer.Option(None, "--caption-kind", help="manual, auto, translated, asr"),
    raw_json3: Path = typer.Option(
        None, "--raw-json3", help="Optional json3 file to copy/link in metadata"
    ),
    no_copy_raw: bool = typer.Option(
        False, "--no-copy-raw", help="Do not copy raw caption/json3 files"
    ),
    enrich: bool = typer.Option(
        False, "--enrich", help="Generate summaries/keywords through Hyper /v1"
    ),
    model: str = typer.Option(None, "--model", "-m", help="Model for --enrich"),
    base_url: str = typer.Option(
        None, "--base-url", "-b", help="Product API base URL for --enrich"
    ),
    key: str = typer.Option(None, "--key", "-k", help="API key for --enrich"),
    index: bool = typer.Option(False, "--index", help="Run openclaw memory index after import"),
    agent: str = typer.Option(None, "--agent", help="Agent id for --index"),
):
    """Import supported sources into OpenClaw-indexable Markdown memory files."""
    caption_files, document_files = _discover_memory_files(input_path)
    if not caption_files and not document_files:
        console.print(f"[red]No supported memory source files found under {input_path}[/red]")
        raise typer.Exit(1)
    total_files = len(caption_files) + len(document_files)
    if total_files > 1 and (source_id or title or source_url or raw_json3):
        console.print(
            "[red]--source-id, --title, --source-url, and --raw-json3 only apply to "
            "single-file imports[/red]"
        )
        raise typer.Exit(1)
    if raw_json3 and not caption_files:
        console.print("[red]--raw-json3 only applies to caption imports[/red]")
        raise typer.Exit(1)

    for caption_file in caption_files:
        resolved_title = title or caption_file.stem
        enrichment = None
        if enrich:
            enrichment = enrich_caption_metadata(
                caption_file=caption_file,
                title=resolved_title,
                source_url=source_url,
                channel=channel,
                model=model,
                base_url=base_url,
                key=key,
            )
        result = import_caption_file(
            caption_file=caption_file,
            workspace=workspace,
            memory_dir=memory_dir,
            collection=collection,
            video_id=source_id,
            title=resolved_title,
            source_url=source_url,
            channel=channel,
            channel_url=channel_url,
            participants=_split_csv(participants),
            caption_language=caption_language,
            caption_kind=caption_kind,
            raw_json3=raw_json3,
            copy_raw=not no_copy_raw,
            enrichment=enrichment,
        )
        console.print(
            f"[green]✓[/green] {result.markdown_path} "
            f"({result.transcript_line_count} transcript lines)"
        )

    for document_file in document_files:
        resolved_title = title or document_file.stem
        enrichment = None
        if enrich:
            enrichment = enrich_document_metadata(
                document_file=document_file,
                title=resolved_title,
                source_url=source_url,
                author=author,
                model=model,
                base_url=base_url,
                key=key,
            )
        result = import_document_file(
            document_file=document_file,
            workspace=workspace,
            memory_dir=memory_dir,
            collection=collection,
            source_id=source_id,
            title=resolved_title,
            source_url=source_url,
            source_type=source_type,
            author=author,
            copy_raw=not no_copy_raw,
            enrichment=enrichment,
        )
        console.print(
            f"[green]✓[/green] {result.markdown_path} "
            f"({result.word_count} words, {result.character_count} chars)"
        )

    _run_index(index=index, agent=agent)
