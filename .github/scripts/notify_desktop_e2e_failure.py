#!/usr/bin/env python3
"""Desktop e2e failure notification with the Playwright video attached.

Mirrors the failure-media path in run_e2e_agents.sh: newest video.webm under
desktop/test-results is converted to MP4 (Telegram-friendly), falling back to
the raw webm, then to a screenshot, and finally to the Playwright log tail.
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "notify"))
from notify_client import notify  # type: ignore

RESULTS_ROOT = REPO_ROOT / "desktop" / "test-results"
LOG_FILE = Path(os.getenv("DESKTOP_E2E_LOG", "/tmp/desktop-e2e.log"))

if not os.getenv("NOTIFY_API_KEY", "").strip():
    raise SystemExit(0)

run_url = os.getenv("GITHUB_RUN_URL", "").strip()


def newest(pattern: str) -> Path | None:
    items = [p for p in RESULTS_ROOT.rglob(pattern) if p.is_file()] if RESULTS_ROOT.exists() else []
    return max(items, key=lambda p: p.stat().st_mtime) if items else None


def convert_webm_to_mp4(webm: Path) -> Path | None:
    mp4 = Path("/tmp") / f"{webm.parent.name}-{webm.stem}.mp4"
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(webm),
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(mp4),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        print(f"failed to convert Playwright video {webm} to mp4: {exc}", file=sys.stderr)
        return None
    return mp4 if mp4.exists() and mp4.stat().st_size > 0 else None


artifact = None
video = newest("*.webm")
if video:
    artifact = convert_webm_to_mp4(video) or video
if artifact is None:
    artifact = newest("*.png")

lines = [
    "<b>❌ Desktop E2E Failed</b>",
    "🧪 Suite: <code>desktop-chat</code>",
    f"🔗 Run: {run_url or 'local run'}",
]

if artifact is not None:
    test_name = artifact.parent.name if artifact.parent.name != "test-results" else artifact.stem
    lines.insert(2, f"🧩 Test: <code>{test_name}</code>")
    media = base64.b64encode(artifact.read_bytes()).decode("ascii")
    media_filename = artifact.name
else:
    log_lines = ["No Playwright video or screenshot was produced; failure happened before/during test startup."]
    if LOG_FILE.exists():
        log_lines.append("\n--- desktop e2e log tail ---")
        log_lines.extend(LOG_FILE.read_text(errors="replace").splitlines()[-120:])
    media = base64.b64encode("\n".join(log_lines).encode("utf-8")).decode("ascii")
    media_filename = "desktop-e2e-failure.txt"

notify.send(
    "frontend",
    lines,
    severity="error",
    media=media,
    media_filename=media_filename,
)
