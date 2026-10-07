#!/bin/sh
set -eu

export KIMI_CODE_HOME="${KIMI_CODE_HOME-${HYPER_RUNTIME_HOME:-/home/node/.kimi-code}}"
: "${KIMI_CODE_HOME:?must be a non-empty directory path}"
config_dir=${KIMI_CODE_HOME}
config=${config_dir}/tui.toml

mkdir -p "${config_dir}"
if [ ! -e "${config}" ] && [ ! -L "${config}" ]; then
  cp /opt/hypercli/share/runtime/kimi-tui.toml "${config}"
fi

exec /opt/hypercli/bin/entrypoint "$@"
