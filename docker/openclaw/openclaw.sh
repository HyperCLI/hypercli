#!/usr/bin/env bash
set -euo pipefail

# Fresh docker exec/native CLI sessions do not inherit entrypoint exports.
# Resolve from this invocation's environment/config, using the same resolver
# as startup, without rerunning init, config reconciliation, or the gateway.
runtime_config=$(python3 /opt/hypercli/lib/runtime-config.py)
eval "${runtime_config}"
unset runtime_config

exec node /app/openclaw.mjs "$@"
