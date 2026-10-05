#!/bin/sh
set -eu

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR-${HYPER_RUNTIME_HOME:-/home/node/.config/opencode}}"
: "${OPENCODE_CONFIG_DIR:?must be a non-empty directory path}"
config_dir=${OPENCODE_CONFIG_DIR}
config=${config_dir}/opencode.json
runtime_config=$(python3 /opt/hypercli/lib/runtime-config.py)
eval "${runtime_config}"
unset runtime_config
: "${HYPER_OPENCODE_MCP_URL:=${HYPER_API_BASE%/}/api/mcp}"
# Preserve an explicit MCP credential, then use the canonical API key.
if [ -z "${HYPER_MCP_API_KEY:-}" ]; then
  export HYPER_MCP_API_KEY="${HYPER_RUNTIME_API_KEY}"
fi
export HYPER_API_BASE HYPER_OPENCODE_MCP_URL
mkdir -p "${config_dir}"
if [ ! -e "${config}" ] && [ ! -L "${config}" ]; then
  cp /opt/hypercli/share/runtime/opencode.json "${config}"
fi

exec /opt/hypercli/bin/entrypoint "$@"
