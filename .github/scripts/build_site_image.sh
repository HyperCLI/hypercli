#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BUILD_CTX="${BUILD_CTX:-/tmp/hypercli-build-site-${IMAGE_TAG}}"
SITE_IMAGE="${SITE_IMAGE:-hypercli-site-builder:${IMAGE_TAG}}"
PUSH_IMAGE="${PUSH_IMAGE:-0}"

rm -rf "${BUILD_CTX}"
mkdir -p "${BUILD_CTX}"

copy_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "${dest}")"
  cp "${src}" "${dest}"
}

mkdir -p "${BUILD_CTX}/.github/docker" "${BUILD_CTX}/.github/scripts"
cp "${REPO_ROOT}/.github/docker/build-site.Dockerfile" "${BUILD_CTX}/.github/docker/build-site.Dockerfile"
cp "${REPO_ROOT}/.github/scripts/site_container_entrypoint.sh" "${BUILD_CTX}/.github/scripts/site_container_entrypoint.sh"

copy_file "${REPO_ROOT}/ts-sdk/package.json" "${BUILD_CTX}/ts-sdk/package.json"
copy_file "${REPO_ROOT}/ts-sdk/package-lock.json" "${BUILD_CTX}/ts-sdk/package-lock.json"
copy_file "${REPO_ROOT}/site/package.json" "${BUILD_CTX}/site/package.json"
copy_file "${REPO_ROOT}/site/package-lock.json" "${BUILD_CTX}/site/package-lock.json"
copy_file "${REPO_ROOT}/site/apps/main/package.json" "${BUILD_CTX}/site/apps/main/package.json"
copy_file "${REPO_ROOT}/site/apps/console/package.json" "${BUILD_CTX}/site/apps/console/package.json"
copy_file "${REPO_ROOT}/site/apps/claw/package.json" "${BUILD_CTX}/site/apps/claw/package.json"
copy_file "${REPO_ROOT}/site/packages/shared-ui/package.json" "${BUILD_CTX}/site/packages/shared-ui/package.json"
copy_file "${REPO_ROOT}/site/mock-server/package.json" "${BUILD_CTX}/site/mock-server/package.json"

docker build \
  -t "${SITE_IMAGE}" \
  -f "${BUILD_CTX}/.github/docker/build-site.Dockerfile" \
  "${BUILD_CTX}"

if [[ "${PUSH_IMAGE}" == "1" ]]; then
  docker push "${SITE_IMAGE}"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "site_image=${SITE_IMAGE}" >> "${GITHUB_OUTPUT}"
fi

echo "${SITE_IMAGE}"
