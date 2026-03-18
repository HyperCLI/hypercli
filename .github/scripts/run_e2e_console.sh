#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_ROOT="${REPO_ROOT}/site"
CONSOLE_LOG="/tmp/hypercli-console-e2e.log"
CLAW_LOG="/tmp/hypercli-claw-e2e.log"

source "${REPO_ROOT}/.github/scripts/allocate_e2e_env.sh"

cleanup() {
  if [[ -n "${CONSOLE_PID:-}" ]]; then
    kill "${CONSOLE_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CLAW_PID:-}" ]]; then
    kill "${CLAW_PID}" >/dev/null 2>&1 || true
  fi
}

show_logs() {
  if [[ -f "${CONSOLE_LOG}" ]]; then
    echo "--- console log"
    tail -n 200 "${CONSOLE_LOG}" || true
  fi
  if [[ -f "${CLAW_LOG}" ]]; then
    echo "--- claw log"
    tail -n 200 "${CLAW_LOG}" || true
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local pid="$4"

  for _ in {1..120}; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      echo "${label} dev server exited before becoming ready" >&2
      [[ -f "${log_file}" ]] && tail -n 200 "${log_file}" >&2 || true
      return 1
    fi

    if [[ -f "${log_file}" ]] && grep -Eq "Ready in|✓ Ready" "${log_file}"; then
      if curl -sS -o /dev/null "${url}"; then
        return 0
      fi
    fi

    if curl -sS -o /dev/null "${url}"; then
      return 0
    fi
    sleep 2
  done
  echo "${label} dev server did not become ready at ${url}" >&2
  [[ -f "${log_file}" ]] && tail -n 200 "${log_file}" >&2 || true
  return 1
}

notify_failure_screenshot() {
  python3 - <<'PY'
import base64
import json
import os
import urllib.request
from pathlib import Path

notify_api_key = os.getenv("NOTIFY_API_KEY", "").strip()
if not notify_api_key:
    raise SystemExit(0)

endpoint = os.getenv("NOTIFY_URL", "https://api.hypercli.com/notify")
run_url = os.getenv("GITHUB_RUN_URL", "").strip()
screenshots = sorted((Path(os.getenv("SITE_ROOT", ".")) / "test-results").rglob("*.png"))
if not screenshots:
    raise SystemExit(0)

screenshot = screenshots[0]
test_name = screenshot.parent.name if screenshot.parent.name != "test-results" else screenshot.stem
payload = {
    "category": "frontend",
    "severity": "error",
    "message": f"Frontend E2E console failed\nTest: {test_name}\nWorkflow: E2E Console\nRun: {run_url or 'local docker run'}",
    "image": base64.b64encode(screenshot.read_bytes()).decode("ascii"),
    "image_filename": screenshot.name,
    "channel": "frontend",
}
request = urllib.request.Request(
    endpoint,
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "X-BACKEND-API-KEY": notify_api_key,
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=20) as response:
    response.read()
PY
}

trap cleanup EXIT

cd "${SITE_ROOT}"
./scripts/setup-local-env.sh
rm -rf "${SITE_ROOT}/apps/console/.next" "${SITE_ROOT}/apps/claw/.next"

cd "${SITE_ROOT}/apps/console"
PORT="${CONSOLE_PORT}" npm run dev >"${CONSOLE_LOG}" 2>&1 &
CONSOLE_PID=$!
cd "${SITE_ROOT}/apps/claw"
PORT="${CLAW_PORT}" npm run dev >"${CLAW_LOG}" 2>&1 &
CLAW_PID=$!

cd "${SITE_ROOT}"

wait_for_url "${TEST_CONSOLE_BASE_URL}" "Console" "${CONSOLE_LOG}" "${CONSOLE_PID}"
wait_for_url "${TEST_BASE_URL}" "Claw" "${CLAW_LOG}" "${CLAW_PID}"

set +e
npx playwright test \
  --config tests/claw/playwright.config.ts \
  --workers=1 \
  tests/claw/console-login.spec.ts
login_status=$?

topup_status=0
if [[ ${login_status} -eq 0 ]]; then
  npx playwright test \
    --config tests/claw/playwright.config.ts \
    --workers=1 \
    tests/claw/console-topup.spec.ts
  topup_status=$?
fi
set -e

status=0
if [[ ${login_status} -ne 0 || ${topup_status} -ne 0 ]]; then
  status=1
fi

if [[ ${status} -ne 0 ]]; then
  notify_failure_screenshot || true
  show_logs
fi

exit "${status}"
