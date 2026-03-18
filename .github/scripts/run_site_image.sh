#!/usr/bin/env bash

set -euo pipefail

SITE_IMAGE="${SITE_IMAGE:?SITE_IMAGE is required}"

docker run --rm "${SITE_IMAGE}"
