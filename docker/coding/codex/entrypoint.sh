#!/bin/sh
set -eu

export CODEX_HOME="${CODEX_HOME-${HYPER_RUNTIME_HOME:-/home/node/.codex}}"
: "${CODEX_HOME:?must be a non-empty directory path}"
mkdir -p "${CODEX_HOME}"

exec /opt/hypercli/bin/entrypoint "$@"
