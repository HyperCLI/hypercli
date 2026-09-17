#!/usr/bin/env bash
set -euo pipefail

valid_id() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65534 ))
}

path_ancestors_are_safe() {
  local path="$1"
  local parent component current=""
  parent="$(dirname -- "${path}")"
  IFS='/' read -r -a components <<< "${parent}"
  for component in "${components[@]}"; do
    [[ -n "${component}" ]] || continue
    current="${current}/${component}"
    if [[ -L "${current}" ]]; then
      return 1
    fi
  done
  return 0
}

HERMES_OWNER_UID="${HERMES_UID:-${PUID:-10000}}"
HERMES_OWNER_GID="${HERMES_GID:-${PGID:-10000}}"
export HERMES_OWNER_UID HERMES_OWNER_GID
valid_id "${HERMES_OWNER_UID}" || HERMES_OWNER_UID=10000
valid_id "${HERMES_OWNER_GID}" || HERMES_OWNER_GID=10000

if ! path_ancestors_are_safe "${HERMES_HOME}/."; then
  echo "[hermes-agent] refusing symlinked HERMES_HOME ancestry: ${HERMES_HOME}" >&2
  exit 1
fi

mkdir -p "${HOME}" "${HERMES_HOME}" "${HERMES_SKILLS_DIR}" "${HYPER_WORKSPACES_DIR}"
chown -R -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${HERMES_MANAGED_DIR}"
/opt/hypercli-hermes/skills.sh

if [[ ! -e "${CONFIG_PATH}" ]]; then
  cp "${CONFIG_TEMPLATE}" "${CONFIG_PATH}"
  echo "[hermes-agent] seeded default config at ${CONFIG_PATH}"
else
  echo "[hermes-agent] preserving existing config at ${CONFIG_PATH}"
fi

if [[ ! -e "${MEM0_CONFIG_PATH}" && -e "${MEM0_CONFIG_TEMPLATE}" ]]; then
  cp "${MEM0_CONFIG_TEMPLATE}" "${MEM0_CONFIG_PATH}"
  echo "[hermes-agent] seeded default Mem0 config at ${MEM0_CONFIG_PATH}"
else
  echo "[hermes-agent] preserving existing Mem0 config at ${MEM0_CONFIG_PATH}"
fi
python3 /opt/hypercli-hermes/configure_mem0.py "${MEM0_CONFIG_PATH}"

chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${CONFIG_PATH}"
if [[ -e "${MEM0_CONFIG_PATH}" || -L "${MEM0_CONFIG_PATH}" ]]; then
  chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${MEM0_CONFIG_PATH}"
fi
chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${HOME}" "${HERMES_HOME}" "${HERMES_SKILLS_DIR}"
chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${HYPER_WORKSPACES_DIR}"
