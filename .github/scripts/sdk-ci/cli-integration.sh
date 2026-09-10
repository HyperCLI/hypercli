#!/usr/bin/env bash
# py-cli dry-run integration gate inside the SDK CI image.
set -euo pipefail
source /tests/integration.sh

sdk_ci_bootstrap
cd /opt/py-cli
sdk_ci_with_retries "CLI" 0 pytest -q tests/integration
