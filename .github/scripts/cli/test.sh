#!/usr/bin/env bash
# Vitest. With no args, the full suite; otherwise the named test files.
set -euo pipefail

cd /opt/cli
exec python3 /opt/tools/run_unit_tests.py -- npx vitest run "$@"
