#!/usr/bin/env bash

# Post-deploy smoke: real Privy email-OTP login against the deployed site.
# Unlike run_e2e_privy.sh this does not build or start local servers; it
# points tests/claw/login.spec.ts at TEST_BASE_URL (feat from main, dev
# from dev).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_ROOT="${REPO_ROOT}/site"

: "${TEST_BASE_URL:?set TEST_BASE_URL to the deployed site URL}"

echo "Post-deploy login smoke against: ${TEST_BASE_URL}" >&2

cd "${SITE_ROOT}"
npx playwright test \
  --config tests/claw/playwright.config.ts \
  --project=chromium \
  --max-failures=1 \
  --workers=1 \
  tests/claw/login.spec.ts
