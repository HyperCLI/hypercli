#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BUILD_CTX="${BUILD_CTX:-/tmp/hypercli-build-site-${IMAGE_TAG}}"
SITE_IMAGE="${SITE_IMAGE:-hypercli-site-builder:${IMAGE_TAG}}"
PUSH_IMAGE="${PUSH_IMAGE:-0}"

rm -rf "${BUILD_CTX}"
mkdir -p "${BUILD_CTX}"

mkdir -p "${BUILD_CTX}/.github/docker" "${BUILD_CTX}/.github/scripts"
cp "${REPO_ROOT}/.github/docker/build-site.Dockerfile" "${BUILD_CTX}/.github/docker/build-site.Dockerfile"
cp "${REPO_ROOT}/.github/scripts/site_container_entrypoint.sh" "${BUILD_CTX}/.github/scripts/site_container_entrypoint.sh"

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
