import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from hypercli_cli.cli import app
from hypercli_cli.memory_captions import import_caption_file, parse_caption_file, transcript_lines


runner = CliRunner()


SYNTHETIC_SRT = """1
00:00:00,000 --> 00:00:01,000
Hello

2
00:00:01,000 --> 00:00:02,000
Hello world.

3
00:00:05,000 --> 00:00:07,000
Second idea with <i>markup</i>.
"""


SYNTHETIC_VTT = """WEBVTT

00:00:00.000 --> 00:00:02.000
First VTT line

00:00:02.000 --> 00:00:03.500
First VTT line continues.
"""


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_parse_caption_file_dedupes_progressive_srt(tmp_path):
    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)

    segments = parse_caption_file(caption)
    lines = transcript_lines(segments)

    assert [segment.text for segment in segments] == [
        "Hello world.",
        "Second idea with markup.",
    ]
    assert [line.text for line in lines] == [
        "Hello world.",
        "Second idea with markup.",
    ]


def test_parse_caption_file_handles_vtt(tmp_path):
    caption = _write(tmp_path / "abc123.en.vtt", SYNTHETIC_VTT)

    segments = parse_caption_file(caption)
    lines = transcript_lines(segments)

    assert [segment.text for segment in segments] == ["First VTT line continues."]
    assert lines[0].start_ms == 0
    assert lines[0].text == "First VTT line continues."


def test_import_caption_file_writes_rich_markdown_and_raw_files(tmp_path):
    caption = _write(tmp_path / "Mdd5USdDRHA.en-orig.srt", SYNTHETIC_SRT)
    raw_json3 = _write(tmp_path / "Mdd5USdDRHA.en-orig.json3", '{"events":[]}')
    workspace = tmp_path / "workspace"

    result = import_caption_file(
        caption_file=caption,
        workspace=workspace,
        collection="youtube/example",
        video_id="Mdd5USdDRHA",
        title="Synthetic Video",
        source_url="https://www.youtube.com/watch?v=Mdd5USdDRHA",
        channel="Synthetic Channel",
        channel_url="https://www.youtube.com/@synthetic",
        participants=["Host", "Guest"],
        caption_language="en-orig",
        caption_kind="auto",
        raw_json3=raw_json3,
        imported_at="2026-05-29T00:00:00+00:00",
        enrichment={
            "short_summary": "A short grounded summary.",
            "long_description": "A longer grounded description.",
            "keywords": ["housing", "creator voice"],
        },
    )

    markdown = result.markdown_path.read_text(encoding="utf-8")
    frontmatter_raw = markdown.split("---", 2)[1]
    frontmatter = yaml.safe_load(frontmatter_raw)

    assert result.markdown_path == workspace / "memory/youtube/example/videos/Mdd5USdDRHA.md"
    assert result.parsed_text_path == workspace / "memory/youtube/example/parsed/Mdd5USdDRHA.txt"
    assert (
        result.raw_caption_path == workspace / "memory/youtube/example/raw/Mdd5USdDRHA.en-orig.srt"
    )
    assert (
        result.raw_json3_path == workspace / "memory/youtube/example/raw/Mdd5USdDRHA.en-orig.json3"
    )
    assert frontmatter["source_url"] == "https://www.youtube.com/watch?v=Mdd5USdDRHA"
    assert frontmatter["source_file"] == "../raw/Mdd5USdDRHA.en-orig.srt"
    assert frontmatter["parsed_text_file"] == "../parsed/Mdd5USdDRHA.txt"
    assert frontmatter["raw_json3_file"] == "../raw/Mdd5USdDRHA.en-orig.json3"
    assert frontmatter["participants"] == ["Host", "Guest"]
    assert "## Source Files" in markdown
    assert "- Parsed text: `../parsed/Mdd5USdDRHA.txt`" in markdown
    assert "- Caption source: `../raw/Mdd5USdDRHA.en-orig.srt`" in markdown
    assert "- Exact timestamp source: `../raw/Mdd5USdDRHA.en-orig.json3`" in markdown
    assert "## Keywords" in markdown
    assert "`housing`, `creator voice`" in markdown
    assert "Watch: https://www.youtube.com/watch?v=Mdd5USdDRHA&t=0s" in markdown
    assert "[00:00:00] Hello world." in markdown
    assert result.parsed_text_path.read_text(encoding="utf-8").startswith("[00:00:00] Hello world.")


def test_memory_import_captions_cli_writes_openclaw_memory(tmp_path):
    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)
    raw_json3 = _write(tmp_path / "abc123.en.json3", '{"events":[]}')
    workspace = tmp_path / "workspace"

    result = runner.invoke(
        app,
        [
            "memory",
            "import",
            str(caption),
            "--workspace",
            str(workspace),
            "--collection",
            "youtube/example",
            "--source-id",
            "abc123",
            "--title",
            "CLI Synthetic Video",
            "--source-url",
            "https://www.youtube.com/watch?v=abc123",
            "--channel",
            "CLI Channel",
            "--participants",
            "Host, Guest",
            "--language",
            "en",
            "--caption-kind",
            "auto",
            "--raw-json3",
            str(raw_json3),
        ],
    )

    assert result.exit_code == 0, result.stdout
    markdown_path = workspace / "memory/youtube/example/videos/abc123.md"
    assert markdown_path.exists()
    markdown = markdown_path.read_text(encoding="utf-8")
    assert "# CLI Synthetic Video" in markdown
    assert "Channel: CLI Channel" in markdown
    assert "`../raw/abc123.en.json3`" in markdown


def test_memory_import_captions_cli_uses_hyper_memory_dir(monkeypatch, tmp_path):
    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)
    memory_dir = tmp_path / "explicit-memory"
    monkeypatch.setenv("HYPER_MEMORY_DIR", str(memory_dir))

    result = runner.invoke(
        app,
        [
            "memory",
            "import",
            str(caption),
            "--collection",
            "youtube/example",
        ],
    )

    assert result.exit_code == 0, result.stdout
    assert (memory_dir / "youtube/example/videos/abc123.md").exists()
    assert (memory_dir / "youtube/example/raw/abc123.en.srt").exists()


def test_memory_import_captions_cli_indexes_when_requested(monkeypatch, tmp_path):
    import hypercli_cli.memory as memory

    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)
    workspace = tmp_path / "workspace"
    calls = []

    def fake_run(cmd, check):
        calls.append((cmd, check))

    monkeypatch.setattr(memory.subprocess, "run", fake_run)

    result = runner.invoke(
        app,
        [
            "memory",
            "import",
            str(caption),
            "--workspace",
            str(workspace),
            "--collection",
            "youtube/example",
            "--index",
            "--agent",
            "default",
        ],
    )

    assert result.exit_code == 0, result.stdout
    assert calls == [(["openclaw", "memory", "index", "--agent", "default"], True)]


def test_enrich_caption_metadata_builds_hyper_v1_request(monkeypatch, tmp_path):
    import hypercli_cli.memory as memory

    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)
    captured = {}

    class FakeMessage:
        content = json.dumps(
            {
                "short_summary": "Short.",
                "long_description": "Long.",
                "keywords": ["alpha", "beta"],
            }
        )

    class FakeChoice:
        message = FakeMessage()

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return type("Response", (), {"choices": [FakeChoice()]})()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(memory.llm, "_resolve_api_key", lambda key: "hyper_api_test")
    monkeypatch.setattr(memory.llm, "_resolve_api_base", lambda base_url: "https://api.hyper.test")
    monkeypatch.setattr(memory.llm, "_resolve_default_model", lambda api_key, api_base: "kimi-test")
    monkeypatch.setattr(memory.llm, "_get_openai_client", lambda api_key, api_base: FakeClient())

    enrichment = memory.enrich_caption_metadata(
        caption_file=caption,
        title="Synthetic Video",
        source_url="https://www.youtube.com/watch?v=abc123",
        channel="Synthetic Channel",
        model=None,
        base_url=None,
        key=None,
    )

    assert enrichment["short_summary"] == "Short."
    assert enrichment["keywords"] == ["alpha", "beta"]
    assert captured["model"] == "kimi-test"
    assert captured["stream"] is False
    assert captured["max_tokens"] == memory.MEMORY_ENRICH_MAX_TOKENS
    assert "Synthetic Video" in captured["messages"][1]["content"]


def test_enrich_caption_metadata_rejects_empty_enrichment(monkeypatch, tmp_path):
    import hypercli_cli.memory as memory

    caption = _write(tmp_path / "abc123.en.srt", SYNTHETIC_SRT)

    class FakeMessage:
        content = json.dumps({"keywords": []})

    class FakeChoice:
        message = FakeMessage()

    class FakeCompletions:
        def create(self, **kwargs):
            return type("Response", (), {"choices": [FakeChoice()]})()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(memory.llm, "_resolve_api_key", lambda key: "hyper_api_test")
    monkeypatch.setattr(memory.llm, "_resolve_api_base", lambda base_url: "https://api.hyper.test")
    monkeypatch.setattr(memory.llm, "_resolve_default_model", lambda api_key, api_base: "kimi-test")
    monkeypatch.setattr(memory.llm, "_get_openai_client", lambda api_key, api_base: FakeClient())

    with pytest.raises(RuntimeError, match="no summary"):
        memory.enrich_caption_metadata(
            caption_file=caption,
            title="Synthetic Video",
            source_url="https://www.youtube.com/watch?v=abc123",
            channel="Synthetic Channel",
            model=None,
            base_url=None,
            key=None,
        )
