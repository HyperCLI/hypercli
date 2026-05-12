#!/usr/bin/env bash

set -euo pipefail

SITE_IMAGE="${SITE_IMAGE:?SITE_IMAGE is required}"
SITE_ENV_FILE="${SITE_ENV_FILE:-site/env.dev}"

env_file_args=()
if [[ -n "${SITE_ENV_FILE}" ]]; then
  env_file_args+=(--env-file "${SITE_ENV_FILE}")
fi

docker run --rm \
  "${env_file_args[@]}" \
  -e SITE_ACTION="${SITE_ACTION:-build}" \
  -e SITE_TARGETS="${SITE_TARGETS:-}" \
  -e NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-}" \
  -e NETLIFY_PROD="${NETLIFY_PROD:-false}" \
  -e NETLIFY_DEPLOY_MESSAGE="${NETLIFY_DEPLOY_MESSAGE:-}" \
  -e NETLIFY_DEPLOY_TIMEOUT="${NETLIFY_DEPLOY_TIMEOUT:-900}" \
  -e GITHUB_SHA="${GITHUB_SHA:-}" \
  "${SITE_IMAGE}"
