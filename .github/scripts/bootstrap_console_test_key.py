#!/usr/bin/env python3
"""Bootstrap a fresh Orchestra API key for the console E2E user."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests


DEFAULT_PRODUCT_BASE = "https://api.dev.hypercli.com"
DEFAULT_REQUEST_TIMEOUT = 60.0
DEFAULT_REQUEST_RETRIES = 4
DEFAULT_RETRY_BACKOFF_SECONDS = 2.0
TRANSIENT_STATUSES = {429, 500, 502, 503, 504}
ROOT_KEY_TAGS = ["jobs:*", "renders:*", "agents:*", "user:self", "api:self"]


@dataclass
class BootstrapState:
    product_base: str
    orchestra_api_base: str
    orchestra_admin_key: str
    email: str
    orchestra_user_id: str
    key_id: str
    test_api_key: str


def _normalize_product_base(raw: str) -> str:
    base = (raw or DEFAULT_PRODUCT_BASE).strip().rstrip("/")
    if not base:
        return DEFAULT_PRODUCT_BASE
    if base.endswith("/api"):
        return base[:-4]
    return base


def _normalize_orchestra_api_base(product_base: str) -> str:
    parsed = urlsplit(product_base if "://" in product_base else f"https://{product_base}")
    path = parsed.path.rstrip("/")
    if path.endswith("/api"):
        path = path[:-4]
    return urlunsplit((parsed.scheme or "https", parsed.netloc, f"{path}/api", "", "")).rstrip("/")


def _headers(admin_key: str) -> dict[str, str]:
    return {
        "X-BACKEND-API-KEY": admin_key,
        "Content-Type": "application/json",
    }


def _request_timeout_seconds() -> float:
    raw = (os.getenv("BOOTSTRAP_REQUEST_TIMEOUT") or "").strip()
    if not raw:
        return DEFAULT_REQUEST_TIMEOUT
    return max(1.0, float(raw))


def _request_retries() -> int:
    raw = (os.getenv("BOOTSTRAP_REQUEST_RETRIES") or "").strip()
    if not raw:
        return DEFAULT_REQUEST_RETRIES
    return max(1, int(raw))


def _retry_backoff_seconds() -> float:
    raw = (os.getenv("BOOTSTRAP_REQUEST_BACKOFF_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_RETRY_BACKOFF_SECONDS
    return max(0.0, float(raw))


def _sleep_before_retry(attempt: int) -> None:
    time.sleep(_retry_backoff_seconds() * attempt)


def _request(method: str, url: str, *, expected: tuple[int, ...] = (200,), **kwargs):
    timeout = kwargs.pop("timeout", _request_timeout_seconds())
    attempts = _request_retries()
    last_exception: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.request(method, url, timeout=timeout, **kwargs)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_exception = exc
            if attempt >= attempts:
                raise
            _sleep_before_retry(attempt)
            continue

        if response.status_code in expected:
            return response
        if response.status_code in TRANSIENT_STATUSES and attempt < attempts:
            _sleep_before_retry(attempt)
            continue
        raise RuntimeError(f"{method} {url} failed: {response.status_code} {response.text}")

    if last_exception is not None:
        raise last_exception
    raise RuntimeError(f"{method} {url} failed after {attempts} attempts")


def _find_user_id(orchestra_api_base: str, admin_key: str, email: str) -> str:
    response = _request(
        "GET",
        f"{orchestra_api_base}/admin/users",
        headers=_headers(admin_key),
        params={"email": email, "limit": 50, "offset": 0},
        expected=(200,),
    )
    normalized_email = email.strip().lower()
    for user in response.json():
        if (user.get("email") or "").strip().lower() == normalized_email:
            return str(user["user_id"])
    return ""


def _create_user(orchestra_api_base: str, admin_key: str, email: str) -> str:
    user_id = f"console-e2e-{uuid.uuid4().hex[:10]}"
    response = _request(
        "POST",
        f"{orchestra_api_base}/admin/users",
        headers=_headers(admin_key),
        json={"user_id": user_id, "email": email, "user_type": "PAID"},
        expected=(200, 409),
    )
    if response.status_code == 409:
        existing = _find_user_id(orchestra_api_base, admin_key, email)
        if existing:
            return existing
        raise RuntimeError(f"User for {email} already exists but could not be resolved")
    payload = response.json()
    return str(payload.get("user_id") or payload.get("id") or user_id)


def _ensure_user_id(orchestra_api_base: str, admin_key: str, email: str) -> str:
    user_id = _find_user_id(orchestra_api_base, admin_key, email)
    if user_id:
        return user_id
    try:
        return _create_user(orchestra_api_base, admin_key, email)
    except RuntimeError:
        user_id = _find_user_id(orchestra_api_base, admin_key, email)
        if user_id:
            return user_id
        raise


def _admin_login(orchestra_api_base: str, admin_key: str, user_id: str) -> str:
    response = _request(
        "GET",
        f"{orchestra_api_base}/admin/auth/login",
        headers=_headers(admin_key),
        params={"user_id": user_id},
        expected=(200,),
    )
    return str(response.json()["token"])


def bootstrap() -> BootstrapState:
    product_base = _normalize_product_base(os.getenv("TEST_API_BASE", DEFAULT_PRODUCT_BASE))
    orchestra_api_base = _normalize_orchestra_api_base(product_base)
    orchestra_admin_key = os.getenv("BACKEND_API_KEY", "").strip()
    email = os.getenv("TEST_EMAIL", "").strip()
    if not orchestra_admin_key:
        raise RuntimeError("BACKEND_API_KEY is required")
    if not email:
        raise RuntimeError("TEST_EMAIL is required")

    orchestra_user_id = _ensure_user_id(orchestra_api_base, orchestra_admin_key, email)
    orchestra_jwt = _admin_login(orchestra_api_base, orchestra_admin_key, orchestra_user_id)
    suffix = uuid.uuid4().hex[:10]
    key_response = _request(
        "POST",
        f"{orchestra_api_base}/keys",
        headers={"Authorization": f"Bearer {orchestra_jwt}", "Content-Type": "application/json"},
        json={
            "name": f"console-e2e-{suffix}",
            "tags": ROOT_KEY_TAGS,
        },
        expected=(200,),
    )
    payload = key_response.json()
    return BootstrapState(
        product_base=product_base,
        orchestra_api_base=orchestra_api_base,
        orchestra_admin_key=orchestra_admin_key,
        email=email,
        orchestra_user_id=orchestra_user_id,
        key_id=str(payload["key_id"]),
        test_api_key=str(payload["api_key"]),
    )


def cleanup(state: BootstrapState) -> None:
    try:
        orchestra_jwt = _admin_login(state.orchestra_api_base, state.orchestra_admin_key, state.orchestra_user_id)
        requests.delete(
            f"{state.orchestra_api_base}/keys/{state.key_id}",
            headers={"Authorization": f"Bearer {orchestra_jwt}"},
            timeout=30,
        )
    except Exception:
        pass


def _write_state_file(state: BootstrapState) -> str:
    fd, path = tempfile.mkstemp(prefix="hypercli-console-bootstrap-", suffix=".json")
    os.close(fd)
    Path(path).write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")
    return path


def _load_state_file(path: str) -> BootstrapState:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return BootstrapState(**payload)


def _print_github_env(state: BootstrapState, state_file: str) -> None:
    fields = {
        "TEST_API_KEY": state.test_api_key,
        "EXPECTED_TEST_EMAIL": state.email,
        "BOOTSTRAP_STATE_FILE": state_file,
    }
    for key, value in fields.items():
        print(f"{key}<<EOF")
        print(value)
        print("EOF")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap or cleanup console E2E API keys")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap_parser = subparsers.add_parser("bootstrap")
    bootstrap_parser.add_argument("--format", choices=("json", "github-env"), default="json")

    cleanup_parser = subparsers.add_parser("cleanup")
    cleanup_parser.add_argument("--state-file", required=True)

    args = parser.parse_args()

    if args.command == "bootstrap":
        state = bootstrap()
        state_file = _write_state_file(state)
        if args.format == "github-env":
            _print_github_env(state, state_file)
        else:
            print(json.dumps({"state_file": state_file, **asdict(state)}, indent=2))
        return 0

    state = _load_state_file(args.state_file)
    cleanup(state)
    try:
        Path(args.state_file).unlink(missing_ok=True)
    except TypeError:
        if Path(args.state_file).exists():
            Path(args.state_file).unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
