#!/usr/bin/env bash

set -euo pipefail

SITE_IMAGE="${SITE_IMAGE:?SITE_IMAGE is required}"
SITE_ENV_FILE="${SITE_ENV_FILE:-site/env.dev}"
SITE_SOURCE_ROOT="${SITE_SOURCE_ROOT:-$(pwd)}"
PULL_IMAGE="${PULL_IMAGE:-1}"

if [[ "${PULL_IMAGE}" == "1" ]]; then
  docker pull "${SITE_IMAGE}"
fi

env_file_args=()
if [[ -n "${SITE_ENV_FILE}" ]]; then
  env_file_args+=(--env-file "${SITE_ENV_FILE}")
fi

docker run --rm \
  "${env_file_args[@]}" \
  --mount "type=bind,src=${SITE_SOURCE_ROOT}/site,dst=/workspace/site-src,readonly" \
  --mount "type=bind,src=${SITE_SOURCE_ROOT}/ts-sdk,dst=/workspace/ts-sdk-src,readonly" \
  --mount "type=bind,src=${SITE_SOURCE_ROOT}/.github/scripts/site_container_entrypoint.sh,dst=/usr/local/bin/site_container_entrypoint,readonly" \
  -e SITE_ACTION="${SITE_ACTION:-build}" \
  -e SITE_PARALLEL="${SITE_PARALLEL:-false}" \
  -e SITE_CLEAN="${SITE_CLEAN:-true}" \
  -e SITE_TARGETS="${SITE_TARGETS:-}" \
  -e NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-}" \
  -e NETLIFY_PROD="${NETLIFY_PROD:-false}" \
  -e NETLIFY_DEPLOY_MESSAGE="${NETLIFY_DEPLOY_MESSAGE:-}" \
  -e NETLIFY_DEPLOY_TIMEOUT="${NETLIFY_DEPLOY_TIMEOUT:-900}" \
  -e GITHUB_SHA="${GITHUB_SHA:-}" \
  "${SITE_IMAGE}"
