#!/usr/bin/env bash
# tsc --noEmit for the CLI.
set -euo pipefail

cd /opt/cli
npm run typecheck
