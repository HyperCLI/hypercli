#!/bin/sh
set -eu

export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR-${HYPER_RUNTIME_HOME:-/home/node/.pi/agent}}"
: "${PI_CODING_AGENT_DIR:?must be a non-empty directory path}"
mkdir -p "${PI_CODING_AGENT_DIR}"

exec /opt/hypercli/bin/entrypoint "$@"
