#!/usr/bin/env bash
# Bare group --help smoke (offline, no API key).
set -euo pipefail

GROUP="${1:?usage: gate-smoke.sh <group>}"
cd /opt/cli

if [ "${GROUP}" = "core" ]; then
  node dist/index.js > /dev/null
  node dist/index.js --help > /dev/null
else
  node dist/index.js "${GROUP}" --help > /dev/null
fi
