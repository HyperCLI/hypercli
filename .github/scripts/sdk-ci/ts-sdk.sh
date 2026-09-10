#!/usr/bin/env bash
# ts-sdk vitest gate inside the SDK CI image. With no args, the full suite;
# otherwise the named test files.
set -euo pipefail

cd /opt/ts-sdk
if [ "$#" -gt 0 ]; then
  npx vitest run "$@"
else
  npx vitest run
fi
