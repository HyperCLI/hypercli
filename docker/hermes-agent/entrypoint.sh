#!/usr/bin/env bash
set -euo pipefail

. /opt/hypercli/lib/desktop.sh

export HOME="${HOME:-/home/hermes}"
export HERMES_HOME="${HERMES_HOME:-${HOME}/.hermes}"
export HYPER_WORKSPACES_DIR="${HYPER_WORKSPACES_DIR:-${HOME}/shared}"
export CONFIG_PATH="${HERMES_HOME}/config.yaml"
export CONFIG_TEMPLATE="${HERMES_CONFIG_TEMPLATE:-/opt/hypercli-hermes/config.yaml}"
export MEM0_CONFIG_PATH="${HERMES_HOME}/mem0.json"
export MEM0_CONFIG_TEMPLATE="${MEM0_CONFIG_TEMPLATE:-/opt/hypercli-hermes/mem0.json}"
export HYPERCLI_SKILLS_DIR="${HYPERCLI_SKILLS_DIR:-/opt/hypercli/skills}"
export HERMES_SKILLS_DIR="${HERMES_SKILLS_DIR:-${HERMES_HOME}/skills}"
export HERMES_PLATFORM_MANAGED_DIR="/run/hypercli-hermes-managed"
export HERMES_MANAGED_DIR="${HERMES_MANAGED_DIR:-${HERMES_PLATFORM_MANAGED_DIR}}"

if [[ -n "${HYPER_API_KEY:-}" && -z "${HYPER_AGENTS_API_KEY:-}" ]]; then
  export HYPER_AGENTS_API_KEY="${HYPER_API_KEY}"
fi

if [[ -n "${HYPER_AGENTS_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="${HYPER_AGENTS_API_KEY}"
fi

mkdir -p "${HERMES_MANAGED_DIR}"
/opt/hypercli-hermes/init.sh
python3 /opt/hypercli-hermes/config.py "${HERMES_MANAGED_DIR}"
if hyper_desktop_enabled; then
  hyper_start_desktop
fi
exec /opt/hermes/docker/entrypoint-dispatch.sh "$@"
