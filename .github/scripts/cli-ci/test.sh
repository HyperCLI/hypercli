#!/usr/bin/env bash
# Vitest. With no args, the full suite; otherwise the named test files.
set -euo pipefail

cd /opt/cli
if [ "$#" -gt 0 ]; then
  npx vitest run "$@"
else
  npx vitest run
fi
