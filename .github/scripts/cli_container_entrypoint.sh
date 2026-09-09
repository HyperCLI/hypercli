#!/usr/bin/env bash
# Runs inside the CLI CI image (repo secret-hidden registry). The repo checkout
# is mounted at /workspace (shadowing the baked sources). Re-link the
# file:../ts-sdk dep against the mounted tree and rebuild both dists so the
# command under test reflects the checked-out commit, then exec it.
set -euo pipefail

cd /workspace/ts-sdk
npm ci --no-audit --no-fund --prefer-offline
npm run build

cd /workspace/cli
npm ci --no-audit --no-fund --prefer-offline
npm run build

cd /workspace
exec "$@"
