#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: hypercli-kimi-auth <status|login> [arguments...]

Run Kimi Code's native authentication inside the hosted runtime.
  status  Report whether Kimi has a native OAuth credential as JSON.
  login   Start Kimi's native device-code login.
EOF
}

action=${1:-}
if [ -z "${action}" ]; then
  usage >&2
  exit 2
fi
shift

case "${action}" in
  status)
    kimi_home=${KIMI_CODE_HOME:-${HOME}/.kimi-code}
    credential=${kimi_home}/credentials/kimi-code.json
    python3 - "${credential}" <<'PY'
import json
import os
import stat
import sys

authenticated = False
path = sys.argv[1]
try:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if (
            stat.S_ISREG(info.st_mode)
            and info.st_uid == os.geteuid()
            and info.st_mode & 0o077 == 0
        ):
            payload = json.load(stream)
            authenticated = (
                isinstance(payload, dict)
                and isinstance(payload.get("access_token"), str)
                and bool(payload["access_token"].strip())
            )
except (OSError, UnicodeError, json.JSONDecodeError):
    pass

print(json.dumps(
    {"runtime": "kimi-code", "authenticated": authenticated},
    separators=(",", ":"),
))
PY
    ;;
  login)
    exec /usr/local/bin/kimi login "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
