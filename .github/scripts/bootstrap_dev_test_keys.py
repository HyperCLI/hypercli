#!/usr/bin/env python3
"""Bootstrap live dev test credentials for HyperCLI integration suites."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests


DEFAULT_PRODUCT_BASE = "https://api.dev.hypercli.com"
DEFAULT_PLAN_ID = "2aiu"
ROOT_KEY_TAGS = ["jobs:*", "renders:*", "agents:*", "user:self", "api:self"]


@dataclass
class BootstrapState:
    product_base: str
    orchestra_api_base: str
    agents_api_base: str
    orchestra_admin_key: str
    agents_admin_key: str
    orchestra_user_id: str
    hyperclaw_user_id: str
    email: str
    test_api_key: str
    test_agent_api_key: str


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


def _normalize_agents_api_base(raw: str, *, product_base: str) -> str:
    base = (raw or "").strip().rstrip("/")
    if not base:
        return f"{product_base.rstrip('/')}/agents"

    parsed = urlsplit(base if "://" in base else f"https://{base}")
    host = parsed.netloc.lower()
    path = parsed.path.rstrip("/")

    if host in {"api.hypercli.com", "api.hyperclaw.app", "api.dev.hypercli.com", "api.dev.hyperclaw.app", "dev-api.hyperclaw.app"}:
        if not path:
            path = "/agents"
    elif host in {"api.agents.hypercli.com", "api.agents.dev.hypercli.com"}:
        if path in {"", "/api"}:
            host = "api.dev.hypercli.com" if host == "api.agents.dev.hypercli.com" else "api.hypercli.com"
            path = "/agents"

    return urlunsplit((parsed.scheme or "https", host, path, "", "")).rstrip("/")


def _headers(admin_key: str) -> dict[str, str]:
    return {
        "X-BACKEND-API-KEY": admin_key,
        "Content-Type": "application/json",
    }


def _request(method: str, url: str, *, expected: tuple[int, ...] = (200,), **kwargs):
    response = requests.request(method, url, timeout=30, **kwargs)
    if response.status_code not in expected:
        raise RuntimeError(f"{method} {url} failed: {response.status_code} {response.text}")
    return response


def bootstrap() -> BootstrapState:
    product_base = _normalize_product_base(os.getenv("TEST_API_BASE", DEFAULT_PRODUCT_BASE))
    orchestra_api_base = _normalize_orchestra_api_base(product_base)
    agents_api_base = _normalize_agents_api_base(
        os.getenv("HYPERCLAW_AGENTS_API_BASE") or os.getenv("AGENTS_API_BASE_URL") or "",
        product_base=product_base,
    )

    orchestra_admin_key = os.getenv("BACKEND_API_KEY", "").strip()
    agents_admin_key = os.getenv("AGENTS_BACKEND_API_KEY", "").strip() or orchestra_admin_key
    if not orchestra_admin_key:
        raise RuntimeError("BACKEND_API_KEY is required")
    if not agents_admin_key:
        raise RuntimeError("AGENTS_BACKEND_API_KEY is required")

    suffix = uuid.uuid4().hex[:10]
    orchestra_user_id = f"sdk-int-{suffix}"
    email = f"sdk-int-{suffix}@example.com"

    _request(
        "POST",
        f"{orchestra_api_base}/admin/users",
        headers=_headers(orchestra_admin_key),
        json={"user_id": orchestra_user_id, "email": email, "user_type": "PAID"},
        expected=(200,),
    )
    _request(
        "POST",
        f"{orchestra_api_base}/admin/users/{orchestra_user_id}/topup",
        headers=_headers(orchestra_admin_key),
        json={
            "amount_usd": 25.0,
            "meta": {"suite": "hypercli-sdk-integration", "source": "bootstrap_dev_test_keys"},
        },
        expected=(200,),
    )
    orchestra_login_response = _request(
        "GET",
        f"{orchestra_api_base}/admin/auth/login",
        headers=_headers(orchestra_admin_key),
        params={"user_id": orchestra_user_id},
        expected=(200,),
    )
    orchestra_jwt = str(orchestra_login_response.json()["token"])
    orchestra_key_response = _request(
        "POST",
        f"{orchestra_api_base}/keys",
        headers={"Authorization": f"Bearer {orchestra_jwt}", "Content-Type": "application/json"},
        json={
            "name": f"sdk-int-root-{suffix}",
            "tags": ROOT_KEY_TAGS,
        },
        expected=(200,),
    )
    test_api_key = str(orchestra_key_response.json()["api_key"])

    hyperclaw_user_response = _request(
        "POST",
        f"{agents_api_base}/admin/users",
        headers=_headers(agents_admin_key),
        json={
            "user_id": orchestra_user_id,
            "external_id": orchestra_user_id,
            "orchestra_user_id": orchestra_user_id,
            "email": email,
        },
        expected=(200,),
    )
    hyperclaw_user_id = str(hyperclaw_user_response.json()["id"])
    _request(
        "POST",
        f"{agents_api_base}/admin/subscriptions/grant",
        headers=_headers(agents_admin_key),
        json={
            "user_id": hyperclaw_user_id,
            "plan_id": os.getenv("HYPERCLAW_SMOKE_PLAN_ID", DEFAULT_PLAN_ID),
        },
        expected=(200,),
    )
    hyperclaw_key_response = _request(
        "POST",
        f"{agents_api_base}/admin/keys",
        headers=_headers(agents_admin_key),
        json={"user_id": hyperclaw_user_id, "alias": f"sdk-int-agents-{suffix}"},
        expected=(200,),
    )
    hyperclaw_key_payload = hyperclaw_key_response.json()
    test_agent_api_key = str(
        hyperclaw_key_payload.get("key")
        or hyperclaw_key_payload.get("token")
        or hyperclaw_key_payload.get("api_key")
    )
    if not test_agent_api_key:
        raise RuntimeError(f"HyperClaw admin key create returned no API key: {hyperclaw_key_payload}")

    return BootstrapState(
        product_base=product_base,
        orchestra_api_base=orchestra_api_base,
        agents_api_base=agents_api_base,
        orchestra_admin_key=orchestra_admin_key,
        agents_admin_key=agents_admin_key,
        orchestra_user_id=orchestra_user_id,
        hyperclaw_user_id=hyperclaw_user_id,
        email=email,
        test_api_key=test_api_key,
        test_agent_api_key=test_agent_api_key,
    )


def cleanup(state: BootstrapState) -> None:
    try:
        keys_response = _request(
            "GET",
            f"{state.agents_api_base}/admin/keys",
            headers=_headers(state.agents_admin_key),
            params={"user_id": state.hyperclaw_user_id, "hydrate": "true"},
            expected=(200,),
        )
        key_items = keys_response.json().get("keys", [])
        for key_item in key_items:
            token = (
                key_item.get("token")
                if isinstance(key_item, dict)
                else None
            )
            if token:
                requests.delete(
                    f"{state.agents_api_base}/admin/keys/{token}",
                    headers=_headers(state.agents_admin_key),
                    timeout=15,
                )
    except Exception:
        pass

    try:
        requests.delete(
            f"{state.agents_api_base}/admin/users/{state.hyperclaw_user_id}",
            headers=_headers(state.agents_admin_key),
            timeout=15,
        )
    except Exception:
        pass

    try:
        requests.delete(
            f"{state.orchestra_api_base}/admin/users/{state.orchestra_user_id}",
            headers=_headers(state.orchestra_admin_key),
            timeout=15,
        )
    except Exception:
        pass


def _write_state_file(state: BootstrapState) -> str:
    fd, path = tempfile.mkstemp(prefix="hypercli-dev-bootstrap-", suffix=".json")
    os.close(fd)
    Path(path).write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")
    return path


def _load_state_file(path: str) -> BootstrapState:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return BootstrapState(**payload)


def _print_github_env(state: BootstrapState, state_file: str) -> None:
    fields = {
        "TEST_API_KEY": state.test_api_key,
        "TEST_API_BASE": state.product_base,
        "TEST_AGENT_API_KEY": state.test_agent_api_key,
        "EXPECTED_TEST_EMAIL": state.email,
        "HYPERCLAW_AGENTS_API_BASE": state.agents_api_base,
        "BOOTSTRAP_STATE_FILE": state_file,
    }
    for key, value in fields.items():
        print(f"{key}<<EOF")
        print(value)
        print("EOF")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap or cleanup live dev SDK integration credentials")
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
