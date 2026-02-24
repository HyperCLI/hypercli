#!/usr/bin/env bash
set -euo pipefail

cors_proxy_value="$(printf '%s' "${CORS_PROXY:-true}" | tr '[:upper:]' '[:lower:]')"

if [[ "${cors_proxy_value}" == "false" || "${cors_proxy_value}" == "0" || "${cors_proxy_value}" == "no" || "${cors_proxy_value}" == "off" ]]; then
  echo "[dev] CORS proxy disabled (CORS_PROXY=${CORS_PROXY:-false}). Starting apps only."
  exec npm run dev:apps
fi

proxy_script="${CORS_PROXY_PATH:-$HOME/corsanywhere/index.js}"
proxy_command=""
proxy_label=""

if [[ -f "${proxy_script}" ]]; then
  proxy_command="node $(printf '%q' "${proxy_script}")"
  proxy_label="${proxy_script}"
else
  proxy_command="npm run cors-proxy --silent"
  proxy_label="site/cors-anywhere.js (fallback)"
fi

echo "[dev] CORS proxy enabled (CORS_PROXY=${CORS_PROXY:-true}). Using ${proxy_label}."
exec npx concurrently --kill-others-on-fail --names proxy,apps "${proxy_command}" "npm run dev:apps"
