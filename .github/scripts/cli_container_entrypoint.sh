#!/usr/bin/env bash
# Runs inside the CLI CI image (docker/cli-ci.Dockerfile). The image bakes
# /opt/ts-sdk and /opt/cli (deps + dists + tests) from the commit that built
# it, which is also the SHA the CI run targets; the repo checkout is mounted
# at /workspace as a fallback. Re-link the file:../ts-sdk dep against the
# baked tree and run the named gate.
#
# Subcommands:
#   gate <group>      vitest files for the group from tests/ci-matrix.json
#   gate-smoke <group> bare `node dist/index.js <group> --help` smoke
#   smoke <argv...>   `node dist/index.js <argv...>` offline smoke
#   test [files...]   vitest (full suite when no files are given)
#   typecheck         tsc --noEmit for the CLI
set -euo pipefail

prepare() {
  cd /opt/cli
  npm ci --no-audit --no-fund --prefer-offline
  npm run build
}

run_gate() {
  local group="$1"
  cd /opt/cli
  local tests
  tests="$(node -p "require('./tests/ci-matrix.json').groups['${group}'].tests.map((t) => 'tests/' + t + '.test.ts').join(' ')")"
  if [ -n "${tests}" ]; then
    npx vitest run ${tests}
  else
    echo "no vitest files declared for group '${group}' in tests/ci-matrix.json"
  fi
}

run_gate_smoke() {
  local group="$1"
  cd /opt/cli
  if [ "${group}" = "core" ]; then
    node dist/index.js > /dev/null
    node dist/index.js --help > /dev/null
  else
    node dist/index.js "${group}" --help > /dev/null
  fi
}

run_smoke() {
  cd /opt/cli
  node dist/index.js "$@" > /dev/null
  echo "exit 0: hyper $*"
}

run_test() {
  cd /opt/cli
  if [ "$#" -gt 0 ]; then
    npx vitest run "$@"
  else
    npx vitest run
  fi
}

run_typecheck() {
  cd /opt/cli
  npm run typecheck
}

CMD="${1:-}"
shift || true

case "${CMD}" in
  gate)        prepare; run_gate "$@" ;;
  gate-smoke)  prepare; run_gate_smoke "$@" ;;
  smoke)       prepare; run_smoke "$@" ;;
  test)        prepare; run_test "$@" ;;
  typecheck)   prepare; run_typecheck ;;
  *)
    echo "usage: cli_container_entrypoint {gate|gate-smoke|smoke|test|typecheck} [args...]" >&2
    exit 64
    ;;
esac
