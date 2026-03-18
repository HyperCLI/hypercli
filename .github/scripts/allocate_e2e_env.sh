#!/usr/bin/env bash

set -euo pipefail

allocate_port() {
  python3 - <<'PY'
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

if [[ -z "${TEST_MAIN_BASE_URL:-}" ]]; then
  TEST_MAIN_PORT="$(allocate_port)"
  export TEST_MAIN_BASE_URL="http://127.0.0.1:${TEST_MAIN_PORT}"
else
  export TEST_MAIN_BASE_URL
fi

if [[ -z "${TEST_CONSOLE_BASE_URL:-}" ]]; then
  TEST_CONSOLE_PORT="$(allocate_port)"
  export TEST_CONSOLE_BASE_URL="http://127.0.0.1:${TEST_CONSOLE_PORT}"
else
  export TEST_CONSOLE_BASE_URL
fi

if [[ -z "${TEST_BASE_URL:-}" ]]; then
  TEST_CLAW_PORT="$(allocate_port)"
  export TEST_BASE_URL="http://127.0.0.1:${TEST_CLAW_PORT}"
else
  export TEST_BASE_URL
fi

export TEST_TOPUP_CONSOLE_BASE_URL="${TEST_TOPUP_CONSOLE_BASE_URL:-${TEST_CONSOLE_BASE_URL}}"
export TEST_HOSTNAME="${TEST_HOSTNAME:-127.0.0.1}"
export LOCAL_MAIN_SITE_URL="${TEST_MAIN_BASE_URL}"
export LOCAL_CONSOLE_URL="${TEST_CONSOLE_BASE_URL}"
export LOCAL_AGENTS_URL="${TEST_BASE_URL}"
export LOCAL_COOKIE_DOMAIN="${TEST_HOSTNAME}"
export LOCAL_HYPERCLAW_COOKIE_DOMAIN="${TEST_HOSTNAME}"
export LOCAL_DOMAIN="${TEST_HOSTNAME}"
export CONSOLE_PORT="${TEST_CONSOLE_BASE_URL##*:}"
export CLAW_PORT="${TEST_BASE_URL##*:}"
