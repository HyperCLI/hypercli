#!/usr/bin/env python3
"""Project the single app release version; Python 3.11+, no dependencies.

The public checkout is standalone. --parent explicitly enables the parent's
ownership map; packages consume committed projections, never this tool at runtime.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib

PUBLIC = Path(__file__).resolve().parents[1]
MANIFESTS = {"package.json", "Cargo.toml", "pyproject.toml"}


def app_version(root: Path) -> str:
    authority = json.loads((root / "versions.json").read_text())
    if set(authority) != {"appVersion"}:
        raise ValueError("versions.json must contain only appVersion")
    version = authority["appVersion"]
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("appVersion must be stable SemVer (major.minor.patch)")
    if int(version.split(".")[0]) >= 2000:
        raise ValueError("calendar versions are not app release versions")
    return version


def replace_version(text: str, pattern: str, value: str, count: int = 1) -> str:
    matches = list(re.finditer(pattern, text, re.MULTILINE))
    if len(matches) != count:
        raise ValueError(f"expected {count} matches, got {len(matches)} for {pattern!r}")
    for match in reversed(matches):
        start, end = match.span("version")
        text = text[:start] + value + text[end:]
    return text


def project(text: str, rule: dict, version: str) -> str:
    kind = rule["kind"]
    value = rule.get("value", "{appVersion}").replace("{appVersion}", version)
    if kind == "generated":
        return rule["content"].replace("{appVersion}", version)
    if kind == "json":
        json.loads(text)
        for keys in rule["keys"]:
            start, end = json_value_span(text, keys)
            text = text[:start] + json.dumps(value) + text[end:]
        return text
    if kind == "toml":
        # Parse first so malformed TOML cannot be repaired into apparent success.
        tomllib.loads(text)
        table = re.escape(rule["table"])
        key = re.escape(rule.get("key", "version"))
        pattern = rf'^\[{table}\]\n(?:(?!\[)[^\n]*\n)*?{key}\s*=\s*"(?P<version>[^"\n]+)"'
        return replace_version(text, pattern, value)
    if kind == "cargo-lock":
        tomllib.loads(text)
        for name in rule["names"]:
            pattern = rf'^\[\[package\]\]\nname = "{re.escape(name)}"\nversion = "(?P<version>[^"\n]+)"'
            text = replace_version(text, pattern, value)
        return text
    if kind == "regex":
        return replace_version(text, rule["pattern"], value, rule.get("count", 1))
    raise ValueError(f"unknown projection kind: {kind}")


def json_value_span(text: str, keys: list[str], start: int = 0) -> tuple[int, int]:
    """Locate an exact object path while preserving all surrounding formatting."""
    decoder = json.JSONDecoder()
    start = re.compile(r"\s*").match(text, start).end()
    if not keys:
        _, end = decoder.raw_decode(text, start)
        return start, end
    if text[start] != "{":
        raise ValueError(f"expected JSON object for {keys}")
    pos = start + 1
    while True:
        pos = re.compile(r"\s*").match(text, pos).end()
        if text[pos] == "}":
            raise ValueError(f"missing JSON field {keys}")
        key, pos = decoder.raw_decode(text, pos)
        pos = re.compile(r"\s*:\s*").match(text, pos).end()
        if key == keys[0]:
            return json_value_span(text, keys[1:], pos)
        _, pos = decoder.raw_decode(text, pos)
        pos = re.compile(r"\s*").match(text, pos).end()
        if text[pos] == ",":
            pos += 1


def inventory(root: Path, ownership: dict) -> list[str]:
    """Fail closed on newly added manifests, including not-yet-staged files."""
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    found = {p for p in paths if Path(p).name in MANIFESTS}
    classified = set(ownership["manifests"])
    errors = [f"unclassified manifest: {p}" for p in sorted(found - classified)]
    errors += [f"missing classified manifest: {p}" for p in sorted(classified - found)]
    targets = {r["path"] for r in ownership["projections"]}
    for path, classification in ownership["manifests"].items():
        if classification == "app" and path not in targets:
            errors.append(f"app manifest has no projection: {path}")
        elif classification.startswith("inherits:"):
            # An inherited Cargo version must remain inherited, not become a
            # new independent literal that passes the ownership inventory.
            data = tomllib.loads((root / path).read_text())
            if data["package"].get("version") != {"workspace": True}:
                errors.append(f"app manifest must inherit workspace version: {path}")
            if classification.removeprefix("inherits:") not in targets:
                errors.append(f"unmanaged workspace authority: {path}")
        elif classification != "app" and not classification.startswith("excluded:"):
            errors.append(f"invalid manifest classification: {path}")
    return errors


def synchronize(root: Path, ownership: dict, version: str, check: bool) -> list[str]:
    errors = inventory(root, ownership)
    changes: dict[Path, str] = {}
    for rule in ownership["projections"]:
        path = root / rule["path"]
        if not path.resolve().is_relative_to(root.resolve()):
            errors.append(f"projection escapes repository: {rule['path']}")
            continue
        try:
            text = changes.get(path, path.read_text() if path.exists() else "")
            expected = project(text, rule, version)
            if expected != text:
                changes[path] = expected
        except (ValueError, KeyError, OSError) as exc:
            errors.append(f"{rule['path']}: {exc}")
    if check:
        errors += [f"version drift: {p.relative_to(root)}" for p in changes]
    elif not errors:
        for path, text in changes.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            print(f"updated {path.relative_to(root)}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift without writing")
    parser.add_argument("--parent", type=Path, help="also project a mono checkout using version-ownership.json")
    args = parser.parse_args()
    try:
        version = app_version(PUBLIC)
        scopes = [(PUBLIC, PUBLIC / "version-ownership.json")]
        if args.parent:
            scopes.append((args.parent.resolve(), args.parent / "version-ownership.json"))
        errors = []
        for root, manifest in scopes:
            ownership = json.loads(manifest.read_text())
            errors.extend(f"{root.name}: {error}" for error in synchronize(root, ownership, version, args.check))
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
        print(f"appVersion {version}: {'checked' if args.check else 'synchronized'}")
        return 0
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        print(f"version check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
