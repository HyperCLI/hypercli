#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_ROOT="${REPO_ROOT}/site"
MAIN_LOG="/tmp/hypercli-main-e2e.log"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${REPO_ROOT}}"
export SITE_ROOT

source "${REPO_ROOT}/.github/scripts/allocate_e2e_env.sh"

MAIN_PORT="${TEST_MAIN_BASE_URL##*:}"

cleanup() {
  if [[ -n "${MAIN_PID:-}" ]]; then
    kill "${MAIN_PID}" >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local status=$?
  if [[ ${status} -ne 0 && -f "${MAIN_LOG}" ]]; then
    echo "--- main log"
    tail -n 200 "${MAIN_LOG}" || true
  fi
  cleanup
  trap - EXIT
  exit "${status}"
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local pid="$4"

  for _ in {1..90}; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      echo "${label} dev server exited before becoming ready" >&2
      [[ -f "${log_file}" ]] && tail -n 200 "${log_file}" >&2 || true
      return 1
    fi

    if curl -fsS "${url}" >/dev/null; then
      return 0
    fi
    sleep 2
  done

  echo "${label} dev server did not become ready at ${url}" >&2
  [[ -f "${log_file}" ]] && tail -n 200 "${log_file}" >&2 || true
  return 1
}

trap on_exit EXIT

cd "${SITE_ROOT}"
./scripts/setup-local-env.sh
if [[ -d "${WORKSPACE_ROOT}/ts-sdk" ]]; then
  npm --prefix "${WORKSPACE_ROOT}/ts-sdk" run build
fi
npm run sdk:use-checkout
npm run test --workspace @hypercli/shared-ui
rm -rf "${SITE_ROOT}/apps/main/.next"
npm run build --workspace @hypercli/main

cd "${SITE_ROOT}/apps/main"
PORT="${MAIN_PORT}" npm run start >"${MAIN_LOG}" 2>&1 &
MAIN_PID=$!

cd "${SITE_ROOT}"

wait_for_url "${TEST_MAIN_BASE_URL}" "Main" "${MAIN_LOG}" "${MAIN_PID}"

# One smoke spec over every public route; the pages are static and share no
# state, so the workers actually parallelize.
npx playwright test \
  --config tests/main/playwright.config.ts \
  --project=chromium \
  --workers=4 \
  tests/main/main-e2e.spec.ts
