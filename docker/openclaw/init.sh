#!/usr/bin/env bash
set -euo pipefail

USER_HOME="${HOME:-/home/node}"
STATE_DIR="${OPENCLAW_STATE_DIR:-${USER_HOME}/.openclaw}"
CONFIG_TEMPLATE="${OPENCLAW_CONFIG_TEMPLATE:-/opt/hypercli-openclaw/openclaw.json}"
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${STATE_DIR}/openclaw.json}"
WORKSPACE_DIR="${STATE_DIR}/workspace"
SESSIONS_DIR="${STATE_DIR}/agents/default/sessions"
HYPER_WORKSPACES_DIR="${HYPER_WORKSPACES_DIR:-${USER_HOME}/shared}"
HYPERCLI_SKILLS_DIR="${HYPERCLI_SKILLS_DIR:-/opt/hypercli/skills}"
OPENCLAW_SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-${STATE_DIR}/skills}"

mkdir -p "${WORKSPACE_DIR}" "${SESSIONS_DIR}" "${HYPER_WORKSPACES_DIR}" "${OPENCLAW_SKILLS_DIR}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp "${CONFIG_TEMPLATE}" "${CONFIG_PATH}"
fi

if [[ -d "${HYPERCLI_SKILLS_DIR}" ]]; then
  while IFS= read -r -d '' source_entry; do
    entry_name="${source_entry##*/}"
    target_entry="${OPENCLAW_SKILLS_DIR}/${entry_name}"
    if [[ ! -e "${target_entry}" && ! -L "${target_entry}" ]]; then
      cp -R "${source_entry}" "${target_entry}"
      echo "[openclaw] seeded bundled HyperCLI skill (${entry_name})"
    fi
  done < <(find "${HYPERCLI_SKILLS_DIR}" -mindepth 1 -maxdepth 1 -type d -print0)
else
  echo "[openclaw] bundled HyperCLI skills directory is missing: ${HYPERCLI_SKILLS_DIR}" >&2
  exit 1
fi

chmod 700 "${STATE_DIR}" 2>/dev/null || true
chmod 600 "${CONFIG_PATH}" 2>/dev/null || true
