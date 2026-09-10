#!/usr/bin/env bash
# Python SDK live integration gate inside the SDK CI image.
set -euo pipefail
source /tests/integration.sh

sdk_ci_bootstrap
cd /opt/sdk
sdk_ci_with_retries "Python" 1 pytest -q tests/integration
