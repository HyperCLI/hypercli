#!/usr/bin/env python3
"""Send structured CI notifications via notify/notify_client.py."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "notify"))
from notify_client import notify_sync  # type: ignore


def normalize_status(status: str) -> str:
    value = (status or "").strip().lower()
    aliases = {
        "succeeded": "success",
        "passed": "success",
        "ok": "success",
        "failed": "failure",
        "error": "failure",
        "errored": "failure",
        "running": "running",
    }
    return aliases.get(value, value)


def severity_for_status(status: str) -> str:
    value = normalize_status(status)
    if value in {"success", "running"}:
      return "info"
    if value in {"failure", "cancelled", "timed_out"}:
      return "error"
    return "warning"


def build_message(phase: str, status: str, explicit_message: str) -> str:
    if explicit_message:
        return explicit_message

    norm = normalize_status(status)
    if phase == "start":
        return "HyperCLI CI started"
    if phase == "build":
        return "HyperCLI build succeeded" if norm == "success" else "HyperCLI build failed"
    if phase == "test":
        return "HyperCLI tests passed" if norm == "success" else "HyperCLI tests failed"
    return f"{phase or 'ci'} {norm or 'unknown'}"


def build_lines(
    *,
    category: str,
    phase: str,
    status: str,
    message: str,
    repo: str,
    ref: str,
    sha: str,
    workflow: str,
    actor: str,
    run_url: str,
) -> list[str]:
    lines = [f"<b>{category.upper()}</b> <code>{normalize_status(status)}</code>", message]
    details: list[str] = []
    if repo:
        details.append(f"Repo: <code>{repo}</code>")
    if ref:
        details.append(f"Ref: <code>{ref}</code>")
    if sha:
        details.append(f"SHA: <code>{sha[:7]}</code>")
    if workflow:
        details.append(f"Workflow: <code>{workflow}</code>")
    if actor:
        details.append(f"Actor: <code>{actor}</code>")
    if phase:
        details.append(f"Phase: <code>{phase}</code>")
    if details:
        lines.extend(["", *details])
    if run_url:
        lines.extend(["", f"<a href=\"{run_url}\">GitHub Actions run</a>"])
    return lines


def send_notification(args: argparse.Namespace) -> None:
    status = normalize_status(args.status)
    notify_sync(
        args.category,
        build_lines(
            category=args.category,
            phase=args.phase,
            status=status,
            message=build_message(args.phase, status, args.message),
            repo=args.repo,
            ref=args.ref,
            sha=args.sha,
            workflow=args.workflow,
            actor=args.actor,
            run_url=args.run_url,
        ),
        severity=severity_for_status(status),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Send CI notification")
    parser.add_argument("--category", required=True)
    parser.add_argument("--phase", default="")
    parser.add_argument("--status", required=True)
    parser.add_argument("--event", default="")
    parser.add_argument("--message", default="")
    parser.add_argument("--repo", default=os.getenv("GITHUB_REPOSITORY", ""))
    parser.add_argument("--ref", default=os.getenv("GITHUB_REF_NAME", ""))
    parser.add_argument("--sha", default=os.getenv("GITHUB_SHA", ""))
    parser.add_argument("--run-id", default=os.getenv("GITHUB_RUN_ID", ""))
    parser.add_argument("--run-url", default=os.getenv("GITHUB_RUN_URL", ""))
    parser.add_argument("--actor", default=os.getenv("GITHUB_ACTOR", ""))
    parser.add_argument("--workflow", default=os.getenv("GITHUB_WORKFLOW", ""))
    parser.add_argument("--channel", default="")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    send_notification(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
