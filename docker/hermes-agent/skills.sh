#!/usr/bin/env bash
set -euo pipefail

if [[ -L "${HERMES_SKILLS_DIR}" ]]; then
  echo "[hermes-agent] skipping bundled skill repair through symlink: ${HERMES_SKILLS_DIR}" >&2
  exit 0
fi

if [[ ! -d "${HYPERCLI_SKILLS_DIR}" ]]; then
  exit 0
fi

while IFS= read -r -d '' source_entry; do
  entry_name="${source_entry##*/}"
  target_entry="${HERMES_SKILLS_DIR}/${entry_name}"
  if [[ -L "${target_entry}" ]]; then
    echo "[hermes-agent] skipping bundled skill repair through symlink: ${target_entry}" >&2
    continue
  fi
  if [[ ! -e "${target_entry}" ]]; then
    cp -a "${source_entry}" "${target_entry}"
    echo "[hermes-agent] seeded HyperCLI skill (${entry_name})"
  fi
  chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${target_entry}"
  while IFS= read -r -d '' source_path; do
    relative_path="${source_path#"${source_entry}"}"
    target_path="${target_entry}${relative_path}"
    if [[ -e "${target_path}" || -L "${target_path}" ]]; then
      chown -h -- "${HERMES_OWNER_UID}:${HERMES_OWNER_GID}" "${target_path}"
    fi
  done < <(find -P "${source_entry}" -print0)
done < <(find "${HYPERCLI_SKILLS_DIR}" -mindepth 1 -maxdepth 1 -type d -print0)
