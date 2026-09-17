#!/bin/sh
set -eu

config_dir=/home/node/.kimi-code
config=${config_dir}/tui.toml

mkdir -p "${config_dir}"
if [ ! -e "${config}" ] && [ ! -L "${config}" ]; then
  cp /opt/hypercli-coding/kimi-tui.toml "${config}"
fi

exec /usr/local/bin/hypercli-coding-entrypoint "$@"
