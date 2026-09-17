#!/usr/bin/env bash
set -euo pipefail

chrome_bin="${HYPERCLI_CHROME_BIN:-/usr/bin/google-chrome-stable}"
user_data_dir="${HYPERCLI_CHROME_USER_DATA_DIR:-${HOME:-/home/node}/.config/google-chrome}"
proxy_host="${HYPER_PROXY_HOST:-}"

# Boolean-ish true selects the canonical in-cluster hyper-proxy endpoint,
# boolean-ish false disables proxying; any other non-empty value is an
# explicit proxy URL passed through unchanged.
case "$(printf '%s' "${proxy_host}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on|enabled) proxy_host="socks5://hyper-proxy:8080" ;;
  0|false|no|off|disabled) proxy_host="" ;;
esac

mkdir -p "${user_data_dir}"

args=(
  # Chrome's own sandbox needs kernel primitives (a setuid helper or
  # unprivileged user namespaces) that are not guaranteed on every cluster
  # these pods land on, and Chrome hard-refuses to launch when the sandbox
  # cannot initialize. --no-sandbox keeps every desktop/automation launch
  # working; the pod/namespace boundary (not the Chrome sandbox) is the
  # security boundary for these agents. The "unsupported command-line flag"
  # infobar this triggers is suppressed image-wide by the
  # CommandLineFlagSecurityWarningsEnabled=false managed policy the
  # Dockerfile installs under /etc/opt/chrome/policies/managed; do not
  # replace that with --test-type, which flips broad automated-test
  # behavior across Chrome.
  --no-sandbox
  --disable-dev-shm-usage
  --no-first-run
  --no-default-browser-check
  --disable-default-apps
  --remote-debugging-address=127.0.0.1
  --remote-debugging-port=18800
  --user-data-dir="${user_data_dir}"
)

if [[ -n "${proxy_host}" ]]; then
  args+=(--proxy-server="${proxy_host}")
fi

exec "${chrome_bin}" "${args[@]}" "$@"
