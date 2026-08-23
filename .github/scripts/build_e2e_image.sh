#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BUILD_CTX="${BUILD_CTX:-${RUNNER_TEMP:-/tmp}/hypercli-e2e-${IMAGE_TAG}}"
E2E_IMAGE="${E2E_IMAGE:-hypercli-e2e:${IMAGE_TAG}}"
E2E_IMAGE_FAMILY="${E2E_IMAGE_FAMILY:-}"

cleanup() {
  rm -rf -- "${BUILD_CTX}"
}

trap cleanup EXIT

if [[ -n "${E2E_IMAGE_FAMILY}" ]]; then
  image_repository="${E2E_IMAGE%:*}"
  mapfile -t stale_images < <(
    docker image ls \
      --filter "reference=${image_repository}:${E2E_IMAGE_FAMILY}-*" \
      --format '{{.Repository}}:{{.Tag}}' \
      | sort -u
  )
  if (( ${#stale_images[@]} > 0 )); then
    docker image rm "${stale_images[@]}" >&2 || true
  fi
  rm -rf -- "/tmp/hypercli-e2e-${E2E_IMAGE_FAMILY}-"*
fi

if [[ "${PRUNE_BUILD_CACHE:-0}" == "1" ]]; then
  docker builder prune \
    --all \
    --force \
    --filter "until=${BUILD_CACHE_MAX_AGE:-24h}" >&2
fi

rm -rf -- "${BUILD_CTX}"
mkdir -p -- "${BUILD_CTX}"

copy_src() {
  local src="$1"
  local dest="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'node_modules' \
      --exclude '.env' \
      --exclude '.env.*' \
      --exclude '.next' \
      --exclude '.turbo' \
      --exclude '.cache' \
      --exclude '.netlify' \
      --exclude 'dist' \
      --exclude 'coverage' \
      --exclude 'playwright-report' \
      --exclude 'test-results' \
      --exclude 'tests/claw/screenshots' \
      "${src}/" "${dest}/"
  else
    cp -r "${src}" "${dest}"
    rm -rf \
      "${dest}/node_modules" \
      "${dest}/.next" \
      "${dest}/.turbo" \
      "${dest}/.cache" \
      "${dest}/.netlify" \
      "${dest}/dist" \
      "${dest}/coverage" \
      "${dest}/playwright-report" \
      "${dest}/test-results" \
      "${dest}/tests/claw/screenshots"
    find "${dest}" -type f \( -name '.env' -o -name '.env.*' \) -delete
  fi
}

mkdir -p "${BUILD_CTX}/.github/docker"
cp "${REPO_ROOT}/.github/docker/e2e-site.Dockerfile" "${BUILD_CTX}/.github/docker/e2e-site.Dockerfile"

copy_src "${REPO_ROOT}/.github" "${BUILD_CTX}/.github"
copy_src "${REPO_ROOT}/notify" "${BUILD_CTX}/notify"
copy_src "${REPO_ROOT}/ts-sdk" "${BUILD_CTX}/ts-sdk"
copy_src "${REPO_ROOT}/site" "${BUILD_CTX}/site"

docker build \
  -t "${E2E_IMAGE}" \
  -f "${BUILD_CTX}/.github/docker/e2e-site.Dockerfile" \
  "${BUILD_CTX}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "e2e_image=${E2E_IMAGE}" >> "${GITHUB_OUTPUT}"
else
  echo "${E2E_IMAGE}"
fi
