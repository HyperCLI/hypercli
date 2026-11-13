#!/usr/bin/env python3
"""Refresh only the room surface in docs/agents-openapi.json, offline.

Provenance: FastAPI main.app.openapi() from the sibling private Agents backend,
whose session router mounts agents.session_room_routes. Requires that backend's
Python dependencies; from the mono root run:

  agents/venv/bin/python hypercli/tools/export_agents_rooms_openapi.py
  agents/venv/bin/python hypercli/tools/export_agents_rooms_openapi.py --check

The full app is imported but never started (no lifespan, requests or dependency
execution). Ambient environment is cleared, dotenv loading is disabled, and
network access/database engine creation are blocked. Dummy configuration only
satisfies import-time settings validation; it does not supply API schemas.
Only /agents/rooms paths and their generated component closure are merged, so
unrelated snapshot content is preserved. Conflicting shared components fail.
This is a source snapshot, not evidence of a deployed backend version.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def room_path(path):
    return path == "/agents/rooms" or path.startswith("/agents/rooms/")


def references(value):
    if isinstance(value, dict):
        if "$ref" in value:
            yield value["$ref"]
        for child in value.values():
            yield from references(child)
    elif isinstance(value, list):
        for child in value:
            yield from references(child)


def resolve(document, ref):
    if not ref.startswith("#/"):
        raise ValueError(f"Expected local reference: {ref}")
    value = document
    for part in ref[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def export(backend):
    os.environ.clear()
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    os.environ.update({key: "offline" for key in (
        "DATABASE_URL", "HYPER_TRIAL_TIER", "JWT_PUBLIC_KEY", "LITELLM_BASE_URL",
        "LITELLM_MASTER_KEY", "BACKEND_API_KEY", "X402_FACILITATOR_URL",
        "X402_RECIPIENT_ADDRESS", "X402_NETWORK", "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET", "AGENTS_DOMAIN", "STACK", "HYPER_API_BASE",
    )})
    os.environ.update({key: "1" for key in (
        "X402_MAX_DEADLINE_SECONDS", "X402_MIN_DEADLINE_SECONDS",
        "X402_SETTLEMENT_TIMEOUT", "X402_SETTLEMENT_RETRIES", "X402_CONNECT_TIMEOUT",
        "X402_MAX_AMOUNT_REQUIRED", "X402_MIN_PAYMENT", "DEFAULT_TPM_LIMIT", "DEFAULT_RPM_LIMIT",
    )})
    os.environ.update(
        PLANS_JSON=json.dumps({
            "plans": [{"id": "offline", "slot_grants": {}}],
            "agent_size_presets": {"small": {
                "cpu": 1, "memory": 1, "cpu_request": 1, "memory_request": 1, "storage_gb": 1,
            }},
        }),
        PUBLIC_PLANS_JSON=json.dumps({
            "plans": [], "agent_size_presets": {"small": {"cpu": 1, "memory": 1}},
        }),
    )

    def offline(event, args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.bind"}:
            raise RuntimeError("Network disabled during OpenAPI export")

    sys.addaudithook(offline)
    import dotenv
    import sqlalchemy
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    dotenv.load_dotenv = lambda *args, **kwargs: False
    # Deterministic, non-secret test public key; no auth requests are executed.
    os.environ["JWT_PUBLIC_KEY"] = ec.derive_private_key(1, ec.SECP256R1()).public_key().public_bytes(
        Encoding.X962, PublicFormat.UncompressedPoint,
    ).hex()

    def no_db(*args, **kwargs):
        raise RuntimeError("Database disabled during OpenAPI export")

    sqlalchemy.create_engine = no_db
    sys.path.insert(0, str(backend))
    from main import app

    return app.openapi()


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend", type=Path, default=root.parent / "agents/backend")
    parser.add_argument("--check", action="store_true", help="Fail if the snapshot needs updating")
    args = parser.parse_args()
    target = root / "docs/agents-openapi.json"
    original = target.read_text()
    snapshot = json.loads(original)
    generated = export(args.backend.resolve())
    rooms = {path: item for path, item in generated["paths"].items() if room_path(path)}
    if not rooms:
        raise ValueError("Backend exported no room paths")
    snapshot["paths"] = {path: item for path, item in snapshot["paths"].items()
                         if not room_path(path)}
    snapshot["paths"].update(rooms)
    pending = list(references(rooms))
    # Security requirements name components rather than using $ref.
    for item in rooms.values():
        for operation in item.values():
            for requirement in operation.get("security", []):
                pending.extend(f"#/components/securitySchemes/{name}" for name in requirement)
    seen = set()
    while pending:
        ref = pending.pop()
        if ref in seen:
            continue
        seen.add(ref)
        _, component_root, category, name = ref.split("/")
        if component_root != "components":
            raise ValueError(f"Unexpected reference: {ref}")
        value = resolve(generated, ref)
        components = snapshot.setdefault("components", {}).setdefault(category, {})
        if name in components and components[name] != value and not name.startswith("Room"):
            raise ValueError(f"Shared component changed: {ref}")
        components[name] = value
        pending.extend(references(value))
    for ref in references(snapshot):
        resolve(snapshot, ref)
    rendered = json.dumps(snapshot, indent=2) + "\n"
    if args.check:
        if rendered != original:
            raise SystemExit("Room OpenAPI snapshot is stale; rerun without --check")
    else:
        target.write_text(rendered)
    print(f"Validated {len(rooms)} room paths and {len(seen)} referenced components")


if __name__ == "__main__":
    main()
