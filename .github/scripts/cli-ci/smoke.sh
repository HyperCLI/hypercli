#!/usr/bin/env bash
# Offline --help smoke for one subcommand argv.
set -euo pipefail

cd /opt/cli
node dist/index.js "$@" > /dev/null
echo "exit 0: hyper $*"
