#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_ROOT="${REPO_ROOT}/site"
CONSOLE_LOG="/tmp/hypercli-console-e2e.log"
CLAW_LOG="/tmp/hypercli-claw-e2e.log"
FAILURE_NOTIFIED=0
export SITE_ROOT

source "${REPO_ROOT}/.github/scripts/allocate_e2e_env.sh"

load_local_env_if_needed() {
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    return 0
  fi
  for env_file in "${REPO_ROOT}/.env" "${SITE_ROOT}/tests/claw/.env"; do
    if [[ -f "${env_file}" ]]; then
      set -a
      # shellcheck source=/dev/null
      source "${env_file}"
      set +a
    fi
  done
}

cleanup() {
  if [[ -n "${CONSOLE_PID:-}" ]]; then
    kill "${CONSOLE_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CLAW_PID:-}" ]]; then
    kill "${CLAW_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_BOOTSTRAP_STATE_FILE:-}" && -f "${LOCAL_BOOTSTRAP_STATE_FILE}" ]]; then
    python3 "${REPO_ROOT}/.github/scripts/bootstrap_console_test_key.py" cleanup \
      --state-file "${LOCAL_BOOTSTRAP_STATE_FILE}" >/dev/null 2>&1 || true
  fi
}

sync_artifacts() {
  local dest="${E2E_ARTIFACTS_DIR:-}"
  if [[ -z "${dest}" ]]; then
    return 0
  fi
  mkdir -p "${dest}"
  if [[ -d "${SITE_ROOT}/playwright-report" ]]; then
    rm -rf "${dest}/playwright-report"
    cp -r "${SITE_ROOT}/playwright-report" "${dest}/playwright-report"
  fi
  if [[ -d "${SITE_ROOT}/test-results" ]]; then
    rm -rf "${dest}/test-results"
    cp -r "${SITE_ROOT}/test-results" "${dest}/test-results"
  fi
}

on_exit() {
  local status=$?
  cleanup
  sync_artifacts
  if [[ ${status} -ne 0 ]]; then
    notify_failure_once || true
  fi
  trap - EXIT
  exit "${status}"
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

notify_failure_artifact() {
  python3 - <<'PY'
import base64
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/workspace/notify")
try:
    from notify_client import notify  # type: ignore
except ModuleNotFoundError:
    raise SystemExit(0)

notify_api_key = os.getenv("NOTIFY_API_KEY", "").strip()
if not notify_api_key:
    raise SystemExit(0)

run_url = os.getenv("GITHUB_RUN_URL", "").strip()
artifact_root = Path(os.getenv("E2E_ARTIFACTS_DIR", "")).resolve() if os.getenv("E2E_ARTIFACTS_DIR", "").strip() else None
test_result_roots = [
    Path(os.getenv("SITE_ROOT", ".")) / "test-results",
]
if artifact_root is not None:
    test_result_roots.append(artifact_root / "test-results")
console_log = Path("/tmp/hypercli-console-e2e.log")
claw_log = Path("/tmp/hypercli-claw-e2e.log")

def newest(pattern: str):
    items = []
    for root in test_result_roots:
        if root.exists():
            items.extend(path for path in root.rglob(pattern) if path.is_file())
    if not items:
        return None
    return max(items, key=lambda path: path.stat().st_mtime)

def convert_webm_to_mp4(webm: Path) -> Path | None:
    mp4 = Path("/tmp") / f"{webm.parent.name}-{webm.stem}.mp4"
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(webm),
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(mp4),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        print(f"failed to convert Playwright video {webm} to mp4: {exc}", file=sys.stderr)
        return None
    return mp4 if mp4.exists() and mp4.stat().st_size > 0 else None

artifact = None
video = newest("*.webm")
if video:
    artifact = convert_webm_to_mp4(video)
    if artifact is None:
        artifact = video
if artifact is None:
    artifact = newest("*.png")

lines = [
    "<b>❌ Frontend Console Failed</b>",
    "🧪 Suite: <code>playwright-console</code>",
    f"🔗 Run: {run_url or 'local docker run'}",
]

media = None
media_filename = None
if artifact is not None:
    test_name = artifact.parent.name if artifact.parent.name != "test-results" else artifact.stem
    lines.insert(2, f"🧩 Test: <code>{test_name}</code>")
    media = base64.b64encode(artifact.read_bytes()).decode("ascii")
    media_filename = artifact.name
else:
    log_lines = ["No Playwright video or screenshot was produced; failure happened before/during test startup."]
    for label, path in [("console", console_log), ("claw", claw_log)]:
        if path.exists():
            log_lines.append(f"\n--- {label} log tail ---")
            log_lines.extend(path.read_text(errors="replace").splitlines()[-120:])
    log_text = "\n".join(log_lines).encode("utf-8")
    media = base64.b64encode(log_text).decode("ascii")
    media_filename = "playwright-console-failure.txt"

notify.send(
    "frontend",
    lines,
    severity="error",
    media=media,
    media_filename=media_filename,
)
PY
}

notify_failure_once() {
  if [[ "${FAILURE_NOTIFIED}" == "1" ]]; then
    return 0
  fi
  FAILURE_NOTIFIED=1
  notify_failure_artifact || true
}

bootstrap_console_key_if_needed() {
  if [[ -n "${TEST_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ -z "${BACKEND_API_KEY:-}" ]]; then
    echo "TEST_API_KEY is not set and BACKEND_API_KEY is unavailable for local bootstrap." >&2
    return 1
  fi
  if [[ -z "${TEST_EMAIL:-}" ]]; then
    echo "TEST_API_KEY is not set and TEST_EMAIL is unavailable for local bootstrap." >&2
    return 1
  fi

  local bootstrap_json
  bootstrap_json="$(python3 "${REPO_ROOT}/.github/scripts/bootstrap_console_test_key.py" bootstrap --format json)"
  TEST_API_KEY="$(printf '%s' "${bootstrap_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["test_api_key"])')"
  EXPECTED_TEST_EMAIL="$(printf '%s' "${bootstrap_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["email"])')"
  LOCAL_BOOTSTRAP_STATE_FILE="$(printf '%s' "${bootstrap_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state_file"])')"
  export TEST_API_KEY EXPECTED_TEST_EMAIL LOCAL_BOOTSTRAP_STATE_FILE
}

trap on_exit EXIT

cd "${SITE_ROOT}"
./scripts/setup-local-env.sh
load_local_env_if_needed
bootstrap_console_key_if_needed
rm -rf "${SITE_ROOT}/apps/console/.next" "${SITE_ROOT}/apps/claw/.next"
npm run build --workspace @hypercli/console --workspace @hypercli/claw

cd "${SITE_ROOT}/apps/console"
PORT="${CONSOLE_PORT}" npm run start >"${CONSOLE_LOG}" 2>&1 &
CONSOLE_PID=$!
cd "${SITE_ROOT}/apps/claw"
PORT="${CLAW_PORT}" npm run start >"${CLAW_LOG}" 2>&1 &
CLAW_PID=$!

cd "${SITE_ROOT}"

wait_for_url "${TEST_CONSOLE_BASE_URL}" "Console" "${CONSOLE_LOG}" "${CONSOLE_PID}"
wait_for_url "${TEST_BASE_URL}" "Claw" "${CLAW_LOG}" "${CLAW_PID}"

set +e
npx playwright test \
  --config tests/claw/playwright.config.ts \
  --project=chromium \
  --max-failures=1 \
  --workers=1 \
  tests/claw/console-login.spec.ts
login_status=$?

topup_status=0
if [[ ${login_status} -eq 0 ]]; then
  npx playwright test \
    --config tests/claw/playwright.config.ts \
    --project=chromium \
    --max-failures=1 \
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
  sync_artifacts
  notify_failure_once || true
  show_logs
fi

exit "${status}"
