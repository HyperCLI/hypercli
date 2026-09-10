#!/usr/bin/env bash
# ts-sdk live integration gate inside the SDK CI image.
set -euo pipefail
source /tests/integration.sh

sdk_ci_bootstrap
cd /opt/ts-sdk
sdk_ci_with_retries "TS" 1 npm run test:integration
