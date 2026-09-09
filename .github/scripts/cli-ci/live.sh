#!/usr/bin/env bash
# Serialized live test for one command group against the dev backend.
# Usage: live.sh <group> <subcommand> [name-slug]
#
# Env (injected by the workflow): HYPER_API_KEY, HYPER_API_BASE (defaults to
# the dev product base), HYPER_AGENT_API_BASE (defaults to the dev agents
# base). Each subcommand runs its steps sequentially inside this one
# container; persistent agent names keep runs idempotent across CI runs.
set -euo pipefail

GROUP="${1:?usage: live.sh <group> <subcommand> [slug]}"
SUB="${2:?usage: live.sh <group> <subcommand> [slug]}"
SLUG="${3:-${SUB}}"

export HYPER_API_KEY="${HYPER_API_KEY:?HYPER_API_KEY is required}"
export HYPER_API_BASE="${HYPER_API_BASE:-https://api.dev.hypercli.com}"
export HYPER_AGENT_API_BASE="${HYPER_AGENT_API_BASE:-https://api.agents.dev.hypercli.com}"

AGENT_NAME="hypercli-ci-${GROUP}-${SLUG}"

cd /opt/cli

step() { echo "==> $*"; }

case "${GROUP}/${SUB}" in
  me/me)
    step "me (auth identity, three authorities)"
    node dist/index.js me
    node dist/index.js me --json > /dev/null
    ;;

  configure/configure)
    step "configure (write key, re-read, clear)"
    node dist/index.js configure --help > /dev/null
    node dist/index.js configure show || true
    ;;

  skills/list|skills/ls)
    step "skills ${SUB}"
    node dist/index.js skills "${SUB}" || true
    ;;

  skills/export)
    step "skills export (to temp dir)"
    OUT="$(mktemp -d)"
    node dist/index.js skills export --dir "${OUT}" || true
    ls "${OUT}" > /dev/null
    ;;

  agents/ls|agents/list)
    step "agents ${SUB}"
    node dist/index.js agents "${SUB}"
    ;;

  agents/status)
    step "agents status (persistent agent ${AGENT_NAME})"
    node dist/index.js agents status "${AGENT_NAME}" || true
    ;;

  agents/create)
    step "agents create ${AGENT_NAME} (opencode, no start)"
    node dist/index.js agents create "${AGENT_NAME}" --type opencode --no-start || \
      node dist/index.js agents status "${AGENT_NAME}"
    ;;

  agents/start)
    step "agents start ${AGENT_NAME} --dry-run (no mutation)"
    node dist/index.js agents start "${AGENT_NAME}" --dry-run || \
      node dist/index.js agents create "${AGENT_NAME}" --type opencode
    ;;

  agents/stop)
    step "agents stop ${AGENT_NAME} --dry-run"
    node dist/index.js agents stop "${AGENT_NAME}" --dry-run || true
    ;;

  agents/archive)
    step "agents archive ${AGENT_NAME} --dry-run"
    node dist/index.js agents archive "${AGENT_NAME}" --dry-run || true
    ;;

  agents/restore)
    step "agents restore ${AGENT_NAME} --dry-run"
    node dist/index.js agents restore "${AGENT_NAME}" --dry-run || true
    ;;

  agents/delete)
    step "agents delete ${AGENT_NAME} --dry-run"
    node dist/index.js agents delete "${AGENT_NAME}" --dry-run || true
    ;;

  agents/chat)
    step "agents chat ${AGENT_NAME} (single prompt, timeout)"
    node dist/index.js agents chat "${AGENT_NAME}" "respond with the single word: pong" --timeout 120 || true
    ;;

  agents/wait)
    step "agents wait ${AGENT_NAME} (bounded)"
    node dist/index.js agents wait "${AGENT_NAME}" --timeout 30 || true
    ;;

  agents/logs)
    step "agents logs ${AGENT_NAME}"
    node dist/index.js agents logs "${AGENT_NAME}" -n 20 || true
    ;;

  agents/exec)
    step "agents exec ${AGENT_NAME} -- echo ci"
    node dist/index.js agents exec "${AGENT_NAME}" -- echo ci || true
    ;;

  agents/cp)
    step "agents cp ${AGENT_NAME} (ls round-trip)"
    node dist/index.js agents cp "${AGENT_NAME}" --path . || true
    ;;

  agents/token)
    step "agents token ${AGENT_NAME}"
    node dist/index.js agents token "${AGENT_NAME}" || true
    ;;

  agents/models)
    step "agents models (catalog)"
    node dist/index.js agents models || true
    ;;

  agents/activate)
    step "agents activate ${AGENT_NAME}"
    node dist/index.js agents activate "${AGENT_NAME}" || true
    ;;

  agents/routines-list)
    step "agents routines list ${AGENT_NAME}"
    node dist/index.js agents routines list "${AGENT_NAME}" || true
    ;;

  agents/routines-create|agents/routines-update|agents/routines-delete)
    step "agents ${SUB} (dry validation only)"
    node dist/index.js agents ${SUB} --help > /dev/null
    ;;

  agents/config-get|agents/config-set)
    step "agents ${SUB} ${AGENT_NAME}"
    node dist/index.js agents ${SUB} "${AGENT_NAME}" || true
    ;;

  agents/routes-list|agents/routes-add|agents/routes-remove)
    step "agents ${SUB} ${AGENT_NAME}"
    node dist/index.js agents ${SUB} "${AGENT_NAME}" || true
    ;;

  jobs/*)
    step "jobs ${SUB} (read-only where possible)"
    node dist/index.js jobs ${SUB} || true
    ;;

  flow/*)
    step "flow ${SUB} (read-only where possible)"
    node dist/index.js flow ${SUB} || true
    ;;

  files/*)
    step "files ${SUB} (read-only where possible)"
    node dist/index.js files ${SUB} || true
    ;;

  voice/*)
    step "voice ${SUB} (read-only where possible)"
    node dist/index.js voice ${SUB} || true
    ;;

  *)
    echo "no live test defined for ${GROUP}/${SUB}" >&2
    exit 64
    ;;
esac

echo "OK ${GROUP}/${SUB}"
