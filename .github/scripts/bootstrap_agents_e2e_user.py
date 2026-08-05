#!/usr/bin/env python3
"""Create and clean up an isolated, unpaid user for the agents checkout E2E."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


DEFAULT_PRODUCT_BASE = "https://api.dev.hypercli.com"
DEFAULT_TIMEOUT_SECONDS = 30.0
TRANSIENT_STATUSES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class TestIdentity:
    orchestra_user_id: str
    email: str


@dataclass
class BootstrapState:
    orchestra_api_base: str
    agents_admin_base: str
    orchestra_user_id: str
    hyperclaw_user_id: str | None
    email: str


@dataclass(frozen=True)
class Response:
    status: int
    payload: object
    text: str


def _new_test_identity(suite: str = "agents-e2e") -> TestIdentity:
    generated = uuid.uuid4()
    safe_suite = re.sub(r"[^a-z0-9]+", "-", suite.lower()).strip("-") or "agents-e2e"
    return TestIdentity(
        orchestra_user_id=str(generated),
        email=f"{safe_suite}-{generated.hex[:12]}@example.com",
    )


def _normalize_product_base(raw: str) -> str:
    base = (raw or DEFAULT_PRODUCT_BASE).strip().rstrip("/")
    return base[:-4] if base.endswith("/api") else base


def _orchestra_api_base(product_base: str) -> str:
    return f"{_normalize_product_base(product_base)}/api"


def _agents_admin_base(product_base: str) -> str:
    override = os.getenv("TEST_AGENTS_ADMIN_BASE", "").strip().rstrip("/")
    if override:
        return override

    parsed = urlsplit(_normalize_product_base(product_base))
    host = parsed.netloc.lower()
    if host in {"api.dev.hypercli.com", "api.dev.hyperclaw.app", "dev-api.hyperclaw.app"}:
        host = "api.agents.dev.hypercli.com"
    elif host in {"api.hypercli.com", "api.hyperclaw.app"}:
        host = "api.agents.hypercli.com"
    else:
        raise RuntimeError(
            "Cannot derive the agents admin API from TEST_API_BASE_URL; set TEST_AGENTS_ADMIN_BASE"
        )
    return urlunsplit((parsed.scheme or "https", host, "", "", "")).rstrip("/")


def _assert_dev_target(product_base: str, agents_admin_base: str) -> None:
    if os.getenv("ALLOW_NON_DEV_E2E_USER_BOOTSTRAP", "").strip() == "1":
        return
    hosts = {
        urlsplit(_normalize_product_base(product_base)).hostname or "",
        urlsplit(agents_admin_base).hostname or "",
    }
    if not all(host in {"localhost", "127.0.0.1"} or ".dev." in host for host in hosts):
        raise RuntimeError(
            "Refusing to seed an agents E2E identity outside dev; "
            "set ALLOW_NON_DEV_E2E_USER_BOOTSTRAP=1 only for an intentional non-dev run"
        )


def _request(
    method: str,
    url: str,
    *,
    admin_key: str,
    expected: tuple[int, ...] = (200,),
    json_body: dict[str, object] | None = None,
    params: dict[str, object] | None = None,
    attempts: int = 4,
) -> Response:
    if params:
        query = urlencode({key: value for key, value in params.items() if value is not None})
        url = f"{url}?{query}"
    data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
    headers = {"X-BACKEND-API-KEY": admin_key}
    if data is not None:
        headers["Content-Type"] = "application/json"

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(
                Request(url, data=data, headers=headers, method=method),
                timeout=DEFAULT_TIMEOUT_SECONDS,
            ) as raw_response:
                status = raw_response.status
                text = raw_response.read().decode("utf-8", errors="replace")
        except HTTPError as error:
            status = error.code
            text = error.read().decode("utf-8", errors="replace")
        except URLError as error:
            last_error = error
            if attempt >= attempts:
                raise RuntimeError(f"{method} {url} failed: {error}") from error
            time.sleep(attempt)
            continue

        if status in expected:
            try:
                payload: object = json.loads(text) if text else {}
            except json.JSONDecodeError:
                payload = {}
            return Response(status=status, payload=payload, text=text)
        if status in TRANSIENT_STATUSES and attempt < attempts:
            time.sleep(attempt)
            continue
        raise RuntimeError(f"{method} {url} failed: {status} {text}")

    if last_error is not None:
        raise RuntimeError(f"{method} {url} failed: {last_error}") from last_error
    raise RuntimeError(f"{method} {url} failed after {attempts} attempts")


def _extract_hyperclaw_user_id(response: Response, *, orchestra_user_id: str) -> str | None:
    payload = response.payload if isinstance(response.payload, dict) else {}
    raw = payload.get("id") or payload.get("user_id")
    if raw:
        return str(raw)
    user = payload.get("user")
    if isinstance(user, dict):
        raw = user.get("id") or user.get("user_id")
        if raw:
            return str(raw)
    if response.status != 409:
        return None
    return None


def _lookup_hyperclaw_user_id(
    *, agents_admin_base: str, admin_key: str, orchestra_user_id: str
) -> str:
    response = _request(
        "GET",
        f"{agents_admin_base}/admin/users",
        admin_key=admin_key,
        params={"orchestra_user_id": orchestra_user_id, "limit": 2, "offset": 0},
    )
    payload = response.payload if isinstance(response.payload, dict) else {}
    items = payload.get("items")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise RuntimeError(
            f"Expected one HyperClaw projection for {orchestra_user_id}, got {items!r}"
        )
    raw = items[0].get("id") or items[0].get("user_id")
    if not raw:
        raise RuntimeError("HyperClaw user lookup returned no id")
    return str(raw)


def cleanup(state: BootstrapState, *, admin_key: str | None = None) -> list[str]:
    """Best-effort cleanup that always attempts both product projections."""
    key = (admin_key or os.getenv("BACKEND_API_KEY", "")).strip()
    if not key:
        return ["BACKEND_API_KEY is required for cleanup"]

    errors: list[str] = []
    if state.hyperclaw_user_id:
        try:
            _request(
                "DELETE",
                f"{state.agents_admin_base}/admin/users/{state.hyperclaw_user_id}",
                admin_key=key,
                expected=(200, 204, 404),
            )
        except Exception as error:  # cleanup must continue to Orchestra
            errors.append(f"HyperClaw cleanup failed: {error}")

    try:
        _request(
            "DELETE",
            f"{state.orchestra_api_base}/admin/users/{state.orchestra_user_id}",
            admin_key=key,
            expected=(200, 204, 404),
        )
    except Exception as error:
        errors.append(f"Orchestra cleanup failed: {error}")
    return errors


def bootstrap(
    *,
    suite: str = "agents-subscription",
    plan_id: str | None = None,
    entitlement_duration: int = 3600,
) -> BootstrapState:
    admin_key = os.getenv("BACKEND_API_KEY", "").strip()
    if not admin_key:
        raise RuntimeError("BACKEND_API_KEY is required")

    product_base = _normalize_product_base(
        os.getenv("TEST_API_BASE_URL") or os.getenv("TEST_API_BASE") or DEFAULT_PRODUCT_BASE
    )
    orchestra_base = _orchestra_api_base(product_base)
    agents_base = _agents_admin_base(product_base)
    _assert_dev_target(product_base, agents_base)
    identity = _new_test_identity(suite)
    state = BootstrapState(
        orchestra_api_base=orchestra_base,
        agents_admin_base=agents_base,
        orchestra_user_id=identity.orchestra_user_id,
        hyperclaw_user_id=None,
        email=identity.email,
    )

    try:
        _request(
            "POST",
            f"{orchestra_base}/admin/users",
            admin_key=admin_key,
            expected=(200, 201, 409),
            json_body={
                "user_id": identity.orchestra_user_id,
                "email": identity.email,
                "user_type": "PAID",
            },
        )
        response = _request(
            "POST",
            f"{agents_base}/admin/users",
            admin_key=admin_key,
            expected=(200, 201, 409),
            json_body={
                "user_id": identity.orchestra_user_id,
                "external_id": identity.orchestra_user_id,
                "orchestra_user_id": identity.orchestra_user_id,
                "email": identity.email,
            },
        )
        state.hyperclaw_user_id = _extract_hyperclaw_user_id(
            response, orchestra_user_id=identity.orchestra_user_id
        )
        if not state.hyperclaw_user_id:
            state.hyperclaw_user_id = _lookup_hyperclaw_user_id(
                agents_admin_base=agents_base,
                admin_key=admin_key,
                orchestra_user_id=identity.orchestra_user_id,
            )
        if plan_id:
            _request(
                "POST",
                f"{agents_base}/admin/users/{state.hyperclaw_user_id}/entitlements",
                admin_key=admin_key,
                expected=(200, 201),
                json_body={
                    "plan_id": plan_id,
                    "quantity": 1,
                    "duration": entitlement_duration,
                    "meta": {"source": suite},
                },
            )
        return state
    except Exception:
        for error in cleanup(state, admin_key=admin_key):
            print(error, file=sys.stderr)
        raise


def _write_state_file(state: BootstrapState, requested_path: str | None) -> str:
    if requested_path:
        path = Path(requested_path)
        path.parent.mkdir(parents=True, exist_ok=True)
    else:
        descriptor, generated_path = tempfile.mkstemp(
            prefix="hypercli-agents-e2e-user-", suffix=".json"
        )
        os.close(descriptor)
        path = Path(generated_path)
    path.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")
    path.chmod(0o600)
    return str(path)


def _load_state_file(path: str) -> BootstrapState:
    return BootstrapState(**json.loads(Path(path).read_text(encoding="utf-8")))


def _append_github_env(path: str, values: dict[str, str]) -> None:
    with Path(path).open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    bootstrap_parser = commands.add_parser("bootstrap")
    bootstrap_parser.add_argument("--suite", default="agents-subscription")
    bootstrap_parser.add_argument("--state-file")
    bootstrap_parser.add_argument("--github-env-file")
    bootstrap_parser.add_argument("--plan-id")
    bootstrap_parser.add_argument("--entitlement-duration", type=int, default=3600)

    cleanup_parser = commands.add_parser("cleanup")
    cleanup_parser.add_argument("--state-file", required=True)
    args = parser.parse_args()

    if args.command == "bootstrap":
        state = bootstrap(
            suite=args.suite,
            plan_id=args.plan_id,
            entitlement_duration=args.entitlement_duration,
        )
        state_file = _write_state_file(state, args.state_file)
        values = {"TEST_EMAIL": state.email, "AGENTS_E2E_USER_STATE_FILE": state_file}
        if args.github_env_file:
            _append_github_env(args.github_env_file, values)
        print(json.dumps({**values, **asdict(state)}))
        return 0

    state = _load_state_file(args.state_file)
    errors = cleanup(state)
    Path(args.state_file).unlink(missing_ok=True)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
