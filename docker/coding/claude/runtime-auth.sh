#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: hypercli-claude-auth <status|login|setup-token|logout> [arguments...]

Run Claude Code's native authentication inside the hosted runtime.
  status       Report the current native login state as JSON.
  login        Start native login (defaults to --claudeai).
  setup-token  Mint a long-lived inference token interactively.
  logout       Remove the persisted native login.
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
    status=0
    output=$(/usr/local/bin/claude auth status --json "$@" 2>/dev/null) || status=$?
    if [ "${status}" -ne 0 ] && [ "${status}" -ne 1 ]; then
      exit "${status}"
    fi
    printf '%s' "${output}" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
print(json.dumps({
    "runtime": "claude-code",
    "authenticated": bool(payload.get("loggedIn")),
}, separators=(",", ":")))
'
    ;;
  login)
    if [ "$#" -eq 0 ]; then
      set -- --claudeai
    fi
    exec /usr/local/bin/claude auth login "$@"
    ;;
  setup-token)
    exec /usr/local/bin/claude setup-token "$@"
    ;;
  logout)
    exec /usr/local/bin/claude auth logout "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
