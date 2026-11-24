#!/usr/bin/env bash
set -euo pipefail

# Seed the native instruction file from TEMPLATE when nothing exists at TARGET.
# Whatever exists there is left exactly as it is: a file, link, or directory is
# never followed, replaced, or removed, and no content is hashed or compared.
usage() {
  echo "usage: seed_instructions.sh TEMPLATE TARGET" >&2
  exit 2
}

main() {
  if [[ $# -ne 2 ]]; then
    usage
  fi
  local template="$1"
  local target="$2"

  if [[ ! -e "${template}" ]]; then
    return 0
  fi
  if [[ ! -e "${target}" && ! -L "${target}" ]]; then
    cp -- "${template}" "${target}"
    echo "[hermes-agent] seeded native instructions at ${target}"
  fi
}

main "$@"
