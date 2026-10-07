#!/bin/sh
set -eu

export GOOSE_PATH_ROOT="${GOOSE_PATH_ROOT-${HYPER_RUNTIME_HOME:-/home/node/.goose}}"
: "${GOOSE_PATH_ROOT:?must be a non-empty directory path}"
config_dir=${GOOSE_PATH_ROOT}/config
provider_dir=${config_dir}/custom_providers

mkdir -p "${provider_dir}"
if [ ! -e "${config_dir}/config.yaml" ] && [ ! -L "${config_dir}/config.yaml" ]; then
  cp /opt/hypercli/share/runtime/goose-config.yaml "${config_dir}/config.yaml"
fi
if [ ! -e "${provider_dir}/hypercli.json" ] && [ ! -L "${provider_dir}/hypercli.json" ]; then
  cp /opt/hypercli/share/runtime/goose-provider.json "${provider_dir}/hypercli.json"
fi

exec /opt/hypercli/bin/entrypoint "$@"
