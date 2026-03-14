#!/usr/bin/env python3
"""Send structured CI notifications to the HyperCLI notify webhook."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


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


def send_notification(args: argparse.Namespace) -> None:
    webhook_url = os.getenv(
        "NOTIFY_URL",
        os.getenv("NOTIFY_WEBHOOK_URL", "https://api.hypercli.com/notify/notify"),
    )
    api_key = os.getenv("NOTIFY_API_KEY", "")
    if not api_key:
        raise RuntimeError("NOTIFY_API_KEY is required")

    status = normalize_status(args.status)
    payload = {
        "category": args.category,
        "channel": args.channel,
        "severity": severity_for_status(status),
        "message": build_message(args.phase, status, args.message),
        "meta": {
            "repo": args.repo,
            "ref": args.ref,
            "sha": args.sha,
            "run_id": args.run_id,
            "run_url": args.run_url,
            "actor": args.actor,
            "workflow": args.workflow,
            "status": status,
            "phase": args.phase,
            "event": args.event,
        },
    }

    request = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-BACKEND-API-KEY": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"notify failed with HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"notify failed: {exc.reason}") from exc


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
