#!/usr/bin/env bash
set -euo pipefail

# ACP default: background the gateway in-pod and run hyper-acp (spawning
# `openclaw acp`) in front. `gateway ...` selects the deprecated native
# gateway mode; any other argument is exec'd directly.
LAUNCH_MODE=acp
case "${1:-}" in
  ""|hyper-acp|/usr/local/bin/hyper-acp|/opt/hypercli/bin/hyper-acp|acp)
    if [[ $# -gt 0 ]]; then shift; fi
    ;;
  gateway)
    LAUNCH_MODE=gateway
    shift
    ;;
  *)
    LAUNCH_MODE=command
    ;;
esac

# stdio ACP reserves fd 1 for JSON-RPC frames; boot chatter goes to stderr
# and fd 1 is restored right before hyper-acp starts.
[[ "${LAUNCH_MODE}" == "acp" ]] && exec 3>&1 1>&2

. /opt/hypercli/lib/desktop.sh

USER_HOME="${HOME:-/home/node}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${USER_HOME}/.openclaw}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR}/openclaw.json}"
export HYPER_WORKSPACES_DIR="${HYPER_WORKSPACES_DIR:-${USER_HOME}/shared}"

runtime_config=$(python3 /opt/hypercli/lib/runtime-config.py)
eval "${runtime_config}"
unset runtime_config

/opt/hypercli-openclaw/init.sh
CONFIG_PATH="${OPENCLAW_CONFIG_PATH}" node /opt/hypercli-openclaw/config.ts

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/openclaw-npm-cache}"
export npm_config_cache="${npm_config_cache:-${NPM_CONFIG_CACHE}}"

find "${OPENCLAW_STATE_DIR}/extensions" -maxdepth 1 -type d \
  \( -name '.openclaw-install-stage-*' -o -name '.openclaw-install-backups' \) \
  -exec rm -rf {} + 2>/dev/null || true

if [[ -n "${OPENCLAW_BUNDLED_PLUGINS_DIR:-}" ]]; then
  # slack is no longer bundled but stays listed: purge legacy installs retained
  # in agent state dirs.
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

if [[ "${LAUNCH_MODE}" == "gateway" ]]; then
  if [[ $# -eq 0 ]]; then
    set -- run
  fi
  if [[ "${1}" == "run" ]]; then
    run_args=("${@:2}")
    echo "[openclaw] starting gateway on ${OPENCLAW_GATEWAY_BIND:-loopback}:${OPENCLAW_PORT:-18789}"
    exec openclaw gateway run --port "${OPENCLAW_PORT:-18789}" --bind "${OPENCLAW_GATEWAY_BIND:-loopback}" "${run_args[@]}"
  fi
  exec openclaw gateway "$@"
fi

if [[ "${LAUNCH_MODE}" == "command" ]]; then
  exec "$@"
fi

# ACP mode: background the gateway (pod-internal hop), wait for it to accept
# loopback connections, then run hyper-acp in front (`openclaw acp` is baked
# in via HYPER_ACP_AGENT_* image ENVs). First process to exit ends the pod.
GATEWAY_PORT="${OPENCLAW_PORT:-18789}"
GATEWAY_BIND="${OPENCLAW_GATEWAY_BIND:-loopback}"
# URL is env-pinned to loopback: the bridge only ever dials the pod-internal gateway.
export OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-ws://127.0.0.1:${GATEWAY_PORT}}"

# Sessions/chat are backend-authoritative — the contract authority is
# sessions/README.md §15 (the memory-shaped session model): hyper-acp must
# dial the backend ACP bridge over HYPER_ACP_WS_URL, or it boots into the
# stdio fallback (acp/hyper-acp/crates/hyper-acp/src/bin/hyper-acp.rs) and
# the pod serves no sessions/chat at all. Lagoon/Fly pods receive
# HYPER_API_BASE plus the runtime key but NOT HYPER_ACP_WS_URL, so
# derive the bridge URL here from the product API base with the same rules
# docker/agent-base/entrypoint.sh uses (canonical product hosts map to Agents
# bridge hosts; custom hosts and path prefixes survive). An explicit HYPER_ACP_WS_URL always wins: backend
# runners and pods pin the exact /ws bridge per launch and that override
# must never be rewritten (agents/backend/agents/runners/launch.py).
if [[ -z "${HYPER_ACP_WS_URL:-}" ]]; then
  HYPER_ACP_WS_URL=$(python3 /opt/hypercli/lib/runtime-config.py --acp-ws-url)
  export HYPER_ACP_WS_URL
fi

openclaw gateway run --port "${GATEWAY_PORT}" --bind "${GATEWAY_BIND}" >&2 &
gateway_pid=$!

acp_pid=""
shutdown() { [[ -z "${acp_pid}" ]] || kill "${acp_pid}" 2>/dev/null || true; kill "${gateway_pid}" 2>/dev/null || true; }
trap shutdown TERM INT

deadline=$(( SECONDS + ${OPENCLAW_ACP_GATEWAY_READY_TIMEOUT_SECONDS:-180} ))
while (( SECONDS < deadline )); do
  if ! kill -0 "${gateway_pid}" 2>/dev/null; then
    echo "[openclaw] gateway exited during ACP startup" >&2
    kill "${gateway_pid}" 2>/dev/null || true
    wait 2>/dev/null || true
    exit 1
  fi
  if (exec 9<>"/dev/tcp/127.0.0.1/${GATEWAY_PORT}") 2>/dev/null; then
    exec 1>&3 3>&-
    # background children of non-interactive shells would get /dev/null stdin
    hyper-acp "$@" <&0 &
    acp_pid=$!
    status=0
    wait -n "${acp_pid}" "${gateway_pid}" || status=$?
    kill "${acp_pid}" "${gateway_pid}" 2>/dev/null || true
    wait 2>/dev/null || true
    exit "${status}"
  fi
  sleep 1
done
echo "[openclaw] gateway readiness timed out after ${OPENCLAW_ACP_GATEWAY_READY_TIMEOUT_SECONDS:-180}s" >&2
kill "${gateway_pid}" 2>/dev/null || true
wait 2>/dev/null || true
exit 1
