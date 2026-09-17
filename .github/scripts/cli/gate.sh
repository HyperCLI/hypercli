#!/usr/bin/env bash
# Group vitest gate. Runs the group's vitest files from
# /opt/cli/tests/ci-matrix.json inside the CLI CI image.
set -euo pipefail

GROUP="${1:?usage: gate.sh <group>}"
cd /opt/cli

tests="$(node -p "require('./tests/ci-matrix.json').groups['${GROUP}'].tests.map((t) => 'tests/' + t + '.test.ts').join(' ')")"
if [ -n "${tests}" ]; then
  npx vitest run ${tests}
else
  echo "no vitest files declared for group '${GROUP}' in tests/ci-matrix.json"
fi
