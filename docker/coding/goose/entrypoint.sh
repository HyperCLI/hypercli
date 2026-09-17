#!/bin/sh
set -eu

config_dir=/home/node/.goose/config
provider_dir=${config_dir}/custom_providers

mkdir -p "${provider_dir}"
if [ ! -e "${config_dir}/config.yaml" ] && [ ! -L "${config_dir}/config.yaml" ]; then
  cp /opt/hypercli-coding/goose-config.yaml "${config_dir}/config.yaml"
fi
if [ ! -e "${provider_dir}/hypercli.json" ] && [ ! -L "${provider_dir}/hypercli.json" ]; then
  cp /opt/hypercli-coding/goose-provider.json "${provider_dir}/hypercli.json"
fi

exec /usr/local/bin/hypercli-coding-entrypoint "$@"
