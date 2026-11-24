#!/usr/bin/env bash
set -euo pipefail

# Retired AGENTS.md.template texts, identified by the SHA-256 of the whole file.
# Add an entry whenever AGENTS.md.template changes (and drop a matching file
# into testdata/retired-templates/<sha>.md); never remove entries, so agents
# seeded with any older template keep getting refreshed.
RETIRED_TEMPLATE_SHA256S=(
  160f260a9d44e63e0cfdb5d72af00e01b7614eba98230984558d7ece2877a12d
  17d983debd140efb56e76f3c457ac86cf07ad7e92bf1d1978e7f335c7458ed37
  c9e56394052091c77e8d7d4c418a082b826d2da74de464c73b4c733d3c02b066
  4997170e6513949ae43025429520b3b88fde31aca364f28b38a09c824cb43b97
  ec134b2c9f38ef1f025fdc9ee46518b321458afe54ae44afb18856ea6064332d
)

usage() {
  echo "usage: seed_instructions.sh TEMPLATE TARGET" >&2
  exit 2
}

refresh_retired() {
  local template="$1"
  local target="$2"
  local tmp

  # init.sh runs as root inside a directory the agent owns: create the staging
  # file exclusively with a random name so a planted path is never followed.
  if ! tmp="$(mktemp -- "${target}.seed.XXXXXX")"; then
    echo "[hermes-agent] failed to stage instruction refresh for ${target}" >&2
    return 0
  fi
  if ! cp -- "${template}" "${tmp}" || ! chmod 0644 -- "${tmp}"; then
    rm -f -- "${tmp}"
    echo "[hermes-agent] failed to stage instruction refresh for ${target}" >&2
    return 0
  fi

  if [[ -L "${target}" || -d "${target}" ]]; then
    rm -f -- "${tmp}"
    return 0
  fi

  if ! mv -f -- "${tmp}" "${target}"; then
    rm -f -- "${tmp}"
    echo "[hermes-agent] failed to refresh instructions at ${target}" >&2
    return 0
  fi

  echo "[hermes-agent] refreshed retired platform instructions at ${target}"
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

  # Missing file: the original seed, unchanged.
  if [[ ! -e "${target}" && ! -L "${target}" ]]; then
    cp -- "${template}" "${target}"
    echo "[hermes-agent] seeded native instructions at ${target}"
    return 0
  fi

  # Refresh only a regular file in a real (non-symlinked) directory; never
  # follow or modify a symlink, directory or other special file.
  local parent
  parent="$(dirname -- "${target}")"
  if [[ -L "${target}" || ! -f "${target}" || -L "${parent}" ]]; then
    echo "[hermes-agent] preserving existing native instructions at ${target}"
    return 0
  fi

  local hash_line hash retired
  if ! hash_line="$(sha256sum -- "${target}" 2>/dev/null)"; then
    return 0
  fi
  hash="${hash_line%% *}"
  if [[ ! "${hash}" =~ ^[0-9a-f]{64}$ ]]; then
    return 0
  fi

  for retired in "${RETIRED_TEMPLATE_SHA256S[@]}"; do
    if [[ "${hash}" == "${retired}" ]]; then
      refresh_retired "${template}" "${target}"
      return 0
    fi
  done

  echo "[hermes-agent] preserving existing native instructions at ${target}"
}

main "$@"
