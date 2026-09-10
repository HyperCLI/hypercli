#!/usr/bin/env bash
# Shared helpers for the live integration gates: dev-key bootstrap, retry
# on transient 503s, and skip on dev cluster tag capacity.
set -euo pipefail

_sdk_ci_cleanup() {
  if [ -n "${BOOTSTRAP_STATE_FILE:-}" ] && [ -f "${BOOTSTRAP_STATE_FILE}" ]; then
    python /opt/bin/bootstrap_dev_test_keys.py cleanup --state-file "${BOOTSTRAP_STATE_FILE}" || true
  fi
}

sdk_ci_bootstrap() {
  local envfile attempts
  envfile="$(mktemp)"
  if [ -z "${BACKEND_API_KEY:-}" ]; then
    echo "BACKEND_API_KEY is empty"
  else
    echo "BACKEND_API_KEY len=${#BACKEND_API_KEY} prefix_ok=$([ "${BACKEND_API_KEY#orchestra_dev_}" != "${BACKEND_API_KEY}" ] && echo yes || echo no)"
  fi
  for attempts in $(seq 1 "${SDK_INTEGRATION_RETRIES:-2}"); do
    : > "${envfile}"
    if python /opt/bin/bootstrap_dev_test_keys.py bootstrap --format env > "${envfile}"; then
      break
    fi
    if [ "${attempts}" -ge "${SDK_INTEGRATION_RETRIES:-2}" ]; then
      return 1
    fi
    echo "Transient bootstrap failure, retrying in ${SDK_INTEGRATION_RETRY_DELAY_SECONDS:-20}s..."
    sleep "${SDK_INTEGRATION_RETRY_DELAY_SECONDS:-20}"
  done
  set -a
  source "${envfile}"
  set +a
  trap _sdk_ci_cleanup EXIT
}

sdk_ci_run_integration() {
  # $1: label; $2: skip-on-tag-capacity (0|1); rest: the integration command
  local label="$1"
  local skip_capacity="$2"
  shift 2
  local log_file
  log_file="$(mktemp)"
  if "$@" 2>&1 | tee "${log_file}"; then
    return 0
  fi
  if [ "${skip_capacity}" = "1" ] && grep -Eq "No connected clusters available for tags|has entitlement capacity but no connected clusters are advertising that tag" "${log_file}"; then
    echo "Skipping ${label} integration failure due to dev cluster tag capacity"
    return 0
  fi
  if grep -Eq "503 Service Unavailable|API Error 503|failed: 503 Service Unavailable|Service Unavailable" "${log_file}"; then
    return 85
  fi
  return 1
}

sdk_ci_with_retries() {
  # $1: label; $2: skip-on-tag-capacity (0|1); rest: the integration command
  local label="$1"
  local skip_capacity="$2"
  shift 2
  local status
  for attempt in $(seq 1 "${SDK_INTEGRATION_RETRIES:-2}"); do
    if sdk_ci_run_integration "${label}" "${skip_capacity}" "$@"; then
      return 0
    fi
    status=$?
    if [ "${status}" -ne 85 ] || [ "${attempt}" -ge "${SDK_INTEGRATION_RETRIES:-2}" ]; then
      return "${status}"
    fi
    echo "Transient ${label} 503 failure, retrying in ${SDK_INTEGRATION_RETRY_DELAY_SECONDS:-20}s..."
    sleep "${SDK_INTEGRATION_RETRY_DELAY_SECONDS:-20}"
  done
}
