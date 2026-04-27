"""Thin shared notify client for Python callers."""

from __future__ import annotations

import asyncio
import argparse
import json
import logging
import os
import sys
from typing import Any
from urllib import request as urlrequest
from urllib.parse import quote


NOTIFY_URL = os.getenv("NOTIFY_URL", "").strip()
NOTIFY_API_KEY = os.getenv("NOTIFY_API_KEY", "").strip()
NOTIFY_TIMEOUT = float(os.getenv("NOTIFY_TIMEOUT", "5.0"))
logger = logging.getLogger(__name__)


class Severity:
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


def _build_url(base_url: str, category: str) -> str:
    return f"{base_url.rstrip('/')}/{quote(category, safe='')}"


def _build_logs_url(base_url: str, limit: int) -> str:
    root_url = base_url.rstrip("/")
    if root_url.endswith("/notify"):
        root_url = root_url[:-len("/notify")]
    return f"{root_url}/logs?limit={limit}"


def _build_payload(
    lines: list[str],
    *,
    severity: str = "info",
    version: str | None = "v1",
    thread_id: str | None = None,
    media: str | None = None,
    media_filename: str | None = None,
    media_url: str | None = None,
) -> dict[str, Any]:
    payload = {
        "lines": lines,
        "severity": severity,
    }
    if version is not None:
        payload["version"] = version
    if thread_id is not None:
        payload["thread_id"] = thread_id
    if media is not None:
        payload["media"] = media
    if media_filename is not None:
        payload["media_filename"] = media_filename
    if media_url is not None:
        payload["media_url"] = media_url
    return payload


def _split_text_lines(text: str) -> list[str]:
    return text.split("\n")


def _log_background_failure(exc: BaseException) -> None:
    logger.warning("Background notify failed: %s", exc, exc_info=True)


def _observe_background_task(task: asyncio.Task[dict[str, Any] | None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError as exc:
        _log_background_failure(exc)
    except Exception as exc:
        _log_background_failure(exc)


async def send_async(
    category: str,
    lines: list[str] | str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout: float | None = None,
    severity: str = "info",
    version: str | None = "v1",
    thread_id: str | None = None,
    media: str | None = None,
    media_filename: str | None = None,
    media_url: str | None = None,
) -> dict[str, Any] | None:
    import httpx

    resolved_url = (base_url or NOTIFY_URL).strip()
    resolved_key = (api_key or NOTIFY_API_KEY).strip()
    if not resolved_url or not resolved_key:
        return None

    if isinstance(lines, str):
        lines = _split_text_lines(lines)
    payload = _build_payload(
        lines,
        severity=severity,
        version=version,
        thread_id=thread_id,
        media=media,
        media_filename=media_filename,
        media_url=media_url,
    )
    async with httpx.AsyncClient(timeout=timeout or NOTIFY_TIMEOUT) as client:
        response = await client.post(
            _build_url(resolved_url, category),
            json=payload,
            headers={"X-BACKEND-API-KEY": resolved_key},
        )
        response.raise_for_status()
        return response.json()


def notify_sync(
    category: str,
    lines: list[str] | str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout: float | None = None,
    severity: str = "info",
    version: str | None = "v1",
    thread_id: str | None = None,
    media: str | None = None,
    media_filename: str | None = None,
    media_url: str | None = None,
) -> dict[str, Any] | None:
    resolved_url = (base_url or NOTIFY_URL).strip()
    resolved_key = (api_key or NOTIFY_API_KEY).strip()
    if not resolved_url or not resolved_key:
        return None

    if isinstance(lines, str):
        lines = _split_text_lines(lines)
    payload = _build_payload(
        lines,
        severity=severity,
        version=version,
        thread_id=thread_id,
        media=media,
        media_filename=media_filename,
        media_url=media_url,
    )
    req = urlrequest.Request(
        _build_url(resolved_url, category),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-BACKEND-API-KEY": resolved_key,
        },
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=timeout or NOTIFY_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def notify_background(
    category: str,
    lines: list[str] | str,
    **kwargs,
) -> None:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            task = loop.create_task(send_async(category, lines, **kwargs))
            task.add_done_callback(_observe_background_task)
            return
    except RuntimeError:
        pass
    try:
        notify_sync(category, lines, **kwargs)
    except Exception as exc:
        _log_background_failure(exc)


async def error_async(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.ERROR)
    return await send_async("error", lines, **kwargs)


async def warning_async(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.WARNING)
    return await send_async("warning", lines, **kwargs)


async def info_async(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.INFO)
    return await send_async("info", lines, **kwargs)


def error(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.ERROR)
    return notify_sync("error", lines, **kwargs)


def warning(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.WARNING)
    return notify_sync("warning", lines, **kwargs)


def info(lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
    kwargs.setdefault("severity", Severity.INFO)
    return notify_sync("info", lines, **kwargs)


def fetch_logs(
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout: float | None = None,
    limit: int = 100,
) -> dict[str, Any] | None:
    resolved_url = (base_url or NOTIFY_URL).strip()
    resolved_key = (api_key or NOTIFY_API_KEY).strip()
    if not resolved_url or not resolved_key:
        return None

    req = urlrequest.Request(
        _build_logs_url(resolved_url, limit),
        headers={"X-BACKEND-API-KEY": resolved_key},
        method="GET",
    )
    with urlrequest.urlopen(req, timeout=timeout or NOTIFY_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


class _Notify:
    def send(self, category: str, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return notify_sync(category, lines, **kwargs)

    async def send_async(self, category: str, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        if isinstance(lines, str):
            lines = _split_text_lines(lines)
        return await send_async(category, lines, **kwargs)

    def send_sync(self, category: str, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return notify_sync(category, lines, **kwargs)

    def send_background(self, category: str, lines: list[str] | str, **kwargs) -> None:
        notify_background(category, lines, **kwargs)

    def fetch_logs(self, **kwargs) -> dict[str, Any] | None:
        return fetch_logs(**kwargs)

    def error(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return error(lines, **kwargs)

    def warning(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return warning(lines, **kwargs)

    def info(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return info(lines, **kwargs)

    async def error_async(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return await error_async(lines, **kwargs)

    async def warning_async(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return await warning_async(lines, **kwargs)

    async def info_async(self, lines: list[str] | str, **kwargs) -> dict[str, Any] | None:
        return await info_async(lines, **kwargs)


notify = _Notify()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Thin notify client")
    subparsers = parser.add_subparsers(dest="command", required=True)

    send_parser = subparsers.add_parser("send", help="send a notification")
    send_parser.add_argument("category")
    send_parser.add_argument("lines", nargs="+")
    send_parser.add_argument("--severity", default="info")
    send_parser.add_argument("--version", default="v1")
    send_parser.add_argument("--thread-id")
    send_parser.add_argument("--media")
    send_parser.add_argument("--media-filename")
    send_parser.add_argument("--media-url")
    send_parser.add_argument("--base-url")
    send_parser.add_argument("--api-key")
    send_parser.add_argument("--timeout", type=float)

    logs_parser = subparsers.add_parser("logs", help="fetch recent logs")
    logs_parser.add_argument("--limit", type=int, default=100)
    logs_parser.add_argument("--base-url")
    logs_parser.add_argument("--api-key")
    logs_parser.add_argument("--timeout", type=float)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "send":
            cli_lines: list[str] | str = args.lines[0] if len(args.lines) == 1 else args.lines
            result = notify_sync(
                args.category,
                cli_lines,
                severity=args.severity,
                version=args.version,
                thread_id=args.thread_id,
                media=args.media,
                media_filename=args.media_filename,
                media_url=args.media_url,
                base_url=args.base_url,
                api_key=args.api_key,
                timeout=args.timeout,
            )
        else:
            result = fetch_logs(
                limit=args.limit,
                base_url=args.base_url,
                api_key=args.api_key,
                timeout=args.timeout,
            )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(result or {}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
