#!/usr/bin/env bash
# Group smoke matrix: every non-bare smoke for the group from
# /opt/cli/tests/ci-matrix.json, run offline inside the CLI CI image.
set -euo pipefail

GROUP="${1:?usage: smoke-group.sh <group>}"
cd /opt/cli

node - "${GROUP}" <<'EOF' | while IFS= read -r argv; do
const group = process.argv[2];
const manifest = require('./tests/ci-matrix.json');
for (const smoke of manifest.groups[group].smokes) {
  const argv = group === 'core' ? [...smoke.argv] : [group, ...smoke.argv];
  const stripped = [...argv];
  if (stripped[stripped.length - 1] === '--help') stripped.pop();
  if (group === 'core' ? stripped.length === 0 : stripped.length <= 1) continue;
  console.log(argv.join(' '));
}
EOF
  node dist/index.js ${argv} > /dev/null
  echo "exit 0: hyper ${argv}"
done
