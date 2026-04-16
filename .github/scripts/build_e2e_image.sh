#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BUILD_CTX="${BUILD_CTX:-/tmp/hypercli-e2e-${IMAGE_TAG}}"
E2E_IMAGE="${E2E_IMAGE:-hypercli-e2e:${IMAGE_TAG}}"

rm -rf "${BUILD_CTX}"
mkdir -p "${BUILD_CTX}"

copy_src() {
  local src="$1"
  local dest="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'node_modules' \
      --exclude '.next' \
      --exclude '.turbo' \
      --exclude '.cache' \
      --exclude '.netlify' \
      --exclude 'dist' \
      --exclude 'coverage' \
      --exclude 'playwright-report' \
      --exclude 'test-results' \
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
      "${dest}/test-results"
  fi
}

mkdir -p "${BUILD_CTX}/.github/docker"
cp "${REPO_ROOT}/.github/docker/e2e-site.Dockerfile" "${BUILD_CTX}/.github/docker/e2e-site.Dockerfile"

copy_src "${REPO_ROOT}/.github" "${BUILD_CTX}/.github"
copy_src "${REPO_ROOT}/ts-sdk" "${BUILD_CTX}/ts-sdk"
copy_src "${REPO_ROOT}/site" "${BUILD_CTX}/site"

docker build \
  -t "${E2E_IMAGE}" \
  -f "${BUILD_CTX}/.github/docker/e2e-site.Dockerfile" \
  "${BUILD_CTX}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "e2e_image=${E2E_IMAGE}" >> "${GITHUB_OUTPUT}"
fi

echo "${E2E_IMAGE}"
