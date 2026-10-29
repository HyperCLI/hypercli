#!/bin/sh
set -eu

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR-${HYPER_RUNTIME_HOME:-/home/node/.config/opencode}}"
: "${OPENCODE_CONFIG_DIR:?must be a non-empty directory path}"
config_dir=${OPENCODE_CONFIG_DIR}
config=${config_dir}/opencode.json
runtime_config=$(python3 /opt/hypercli/lib/runtime-config.py)
eval "${runtime_config}"
unset runtime_config
mkdir -p "${config_dir}"
if [ ! -e "${config}" ] && [ ! -L "${config}" ]; then
  cp /opt/hypercli/share/runtime/opencode.json "${config}"
fi

exec /opt/hypercli/bin/entrypoint "$@"
