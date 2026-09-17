#!/usr/bin/env bash
set -euo pipefail

. /opt/hypercli/lib/desktop.sh

USER_HOME="${HOME:-/home/node}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${USER_HOME}/.openclaw}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR}/openclaw.json}"
export HYPER_WORKSPACES_DIR="${HYPER_WORKSPACES_DIR:-${USER_HOME}/shared}"

if [[ -n "${HYPER_API_KEY:-}" ]]; then
  export HYPER_AGENTS_API_KEY="${HYPER_API_KEY}"
fi

# The Slack plugin resolves botToken from the gateway process env, so the
# derivation must be exported here (slack.ts validates the same preconditions
# while reconciling the config, but child-process env cannot reach the exec'd
# gateway).
case "$(printf '%s' "${HYPER_SLACK_APP_ENABLED:-0}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on|enabled)
    export SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-${HYPER_AGENTS_API_KEY:-}}"
    export SLACK_API_URL="${SLACK_API_URL:-${HYPER_SLACK_API_URL:-}}"
    ;;
esac

/opt/hypercli-openclaw/init.sh
CONFIG_PATH="${OPENCLAW_CONFIG_PATH}" node /opt/hypercli-openclaw/config.ts
CONFIG_PATH="${OPENCLAW_CONFIG_PATH}" node /opt/hypercli-openclaw/slack.ts

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/openclaw-npm-cache}"
export npm_config_cache="${npm_config_cache:-${NPM_CONFIG_CACHE}}"

find "${OPENCLAW_STATE_DIR}/extensions" -maxdepth 1 -type d \
  \( -name '.openclaw-install-stage-*' -o -name '.openclaw-install-backups' \) \
  -exec rm -rf {} + 2>/dev/null || true

if [[ -n "${OPENCLAW_BUNDLED_PLUGINS_DIR:-}" ]]; then
  for bundled_plugin_id in brave slack whatsapp; do
    rm -rf "${OPENCLAW_STATE_DIR}/extensions/${bundled_plugin_id}" 2>/dev/null || true
  done
fi

BUILD_INFO_PATH="${OPENCLAW_BUILD_INFO_PATH:-/app/dist/build-info.json}"
RUNTIME_CHECKPOINT="${OPENCLAW_STATE_DIR}/.hypercli-runtime-checkpoint.json"
if [[ ! -r "${BUILD_INFO_PATH}" ]] || ! cmp -s "${BUILD_INFO_PATH}" "${RUNTIME_CHECKPOINT}"; then
  echo "[openclaw] repairing OpenClaw state for this runtime build"
  openclaw doctor --fix --non-interactive --yes --no-workspace-suggestions
  if [[ -r "${BUILD_INFO_PATH}" ]]; then
    cp "${BUILD_INFO_PATH}" "${RUNTIME_CHECKPOINT}" 2>/dev/null || true
  fi
else
  echo "[openclaw] state already repaired for this runtime build; skipping doctor"
fi

if [[ -n "${OPENCLAW_INSTALL_PLUGINS:-}" ]]; then
  normalized_plugins="${OPENCLAW_INSTALL_PLUGINS//,/ }"
  for plugin_spec in ${normalized_plugins}; do
    if [[ -z "${plugin_spec}" ]]; then
      continue
    fi
    plugin_id="$(basename "${plugin_spec}")"
    if [[ "${plugin_spec}" = /* && -e "${OPENCLAW_STATE_DIR}/extensions/${plugin_id}" ]]; then
      case "$(printf '%s' "${OPENCLAW_FORCE_INSTALL_PLUGINS:-0}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on|enabled) ;;
        *) echo "[openclaw] managed plugin already installed (${plugin_id}); skipping"; continue ;;
      esac
    fi
    echo "[openclaw] installing managed plugin (${plugin_spec})"
    INSTALL_ARGS=(plugins install)
    case "$(printf '%s' "${OPENCLAW_FORCE_INSTALL_PLUGINS:-0}" | tr '[:upper:]' '[:lower:]')" in
      1|true|yes|on|enabled) INSTALL_ARGS+=(--force) ;;
    esac
    INSTALL_ARGS+=("${plugin_spec}")
    openclaw "${INSTALL_ARGS[@]}"
  done
fi

if hyper_desktop_enabled; then
  hyper_start_desktop
fi

echo "[openclaw] starting gateway on ${OPENCLAW_GATEWAY_BIND:-lan}:${OPENCLAW_PORT:-18789}"
exec openclaw gateway run --port "${OPENCLAW_PORT:-18789}" --bind "${OPENCLAW_GATEWAY_BIND:-lan}"
