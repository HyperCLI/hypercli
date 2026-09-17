#!/bin/sh
set -eu

config_dir=${HOME}/.config/opencode
config=${config_dir}/opencode.json
: "${HYPER_API_BASE:=https://api.hypercli.com}"
: "${HYPER_OPENCODE_MCP_URL:=${HYPER_API_BASE%/}/api/mcp}"
if [ -n "${HYPER_API_KEY:-}" ]; then
  export HYPER_MCP_API_KEY="${HYPER_API_KEY}"
elif [ -n "${HYPER_AGENTS_API_KEY:-}" ]; then
  export HYPER_MCP_API_KEY="${HYPER_AGENTS_API_KEY}"
fi
export HYPER_API_BASE HYPER_OPENCODE_MCP_URL
mkdir -p "${config_dir}"
if [ ! -e "${config}" ] && [ ! -L "${config}" ]; then
  cp /opt/hypercli-coding/opencode.json "${config}"
fi

exec /usr/local/bin/hypercli-coding-entrypoint "$@"
