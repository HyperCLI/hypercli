#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: hypercli-codex-auth <status|login|logout> [arguments...]

Run Codex's native authentication inside the hosted runtime.
  status  Report the current native login state.
  login   Start native login (defaults to --device-auth).
  logout  Remove the persisted native login.
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
    if /usr/local/bin/codex login status "$@" >/dev/null 2>&1; then
      authenticated=true
    else
      status=$?
      if [ "${status}" -ne 1 ]; then
        exit "${status}"
      fi
      authenticated=false
    fi
    printf '{"runtime":"codex","authenticated":%s}\n' "${authenticated}"
    ;;
  login)
    if [ "$#" -eq 0 ]; then
      set -- --device-auth
    fi
    exec /usr/local/bin/codex login "$@"
    ;;
  logout)
    exec /usr/local/bin/codex logout "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
