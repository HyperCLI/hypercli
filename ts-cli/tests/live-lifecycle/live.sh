#!/usr/bin/env bash
# Live tests against the dev backend, one serialized job per subcommand.
# Usage: live.sh <group> <sub>
#
# Required env (set by the workflow):
#   HYPER_API_KEY   — CI key (hypercli-ci-v2, scope *:*)
#   HYPER_API_BASE=https://api.dev.hypercli.com — the base for all APIs.
#
# Conventions:
#   Environment selection uses HYPER_API_BASE, never public CLI flags.
#   Exit codes: 0 ok, 1 CliError (mapped API error), 2 UsageError.
#   Errors print "error: <msg>" on stderr; info ("total N") always stderr.
#   Persistent refs: hypercli-ci-*; hypercli-ci-does-not-exist never resolves.
set -euo pipefail

GROUP="${1:?usage: live.sh <group> <sub>}"
SUB="${2:?usage: live.sh <group> <sub>}"

export HYPER_API_KEY="${HYPER_API_KEY:?HYPER_API_KEY is required}"
export HYPER_API_BASE="${HYPER_API_BASE:-https://api.dev.hypercli.com}"

NOID="hypercli-ci-does-not-exist"
CLI=(node dist/index.js)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cd "${CLI_WORKDIR:-/opt/cli}"

step() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# Account presweep: drive every agent this CI account can list into a
# deletable state and delete it, so a job never starts against a full
# saved-agent quota.
#
# Admission rules the sweep must respect (agents/SPEC.md, user API only):
#   STOP    only from STARTING|RUNNING   (CREATING/RESTORING/ARCHIVING/
#                                         ARCHIVED/FAILED -> 409)
#   ARCHIVE only from STOPPED|ARCHIVING  (FAILED -> 409)
#   DELETE  only from STOPPED|ARCHIVED   (FAILED -> 409)
# FAILED therefore has NO legal exit through the user API. The sweep reports
# such agents as unreclaimable residue, counts them, and keeps going; it
# never blindly stop-then-deletes and swallows the 409s.
#
# Nothing here echoes raw CLI stderr (it can carry the API key's error
# context); only the parsed HTTP status is logged.
SWEEP_CAP="${HYPERCLI_AGENT_CAP:-10}"
SWEEP_AGENT_DEADLINE="${SWEEP_AGENT_DEADLINE_SECONDS:-180}"
SWEEP_POLL="${SWEEP_POLL_SECONDS:-5}"
SWEEP_DIR=""
SWEEP_OUT=""
SWEEP_ERR=""
SWEEP_HTTP="none"
SWEEP_STUCK=0
SWEEP_REMAINING=0

sweep_init() {
  SWEEP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cli-sweep.XXXXXXXX")"
  SWEEP_OUT="${SWEEP_DIR}/out.json"
  SWEEP_ERR="${SWEEP_DIR}/err.txt"
}

sweep_cleanup() {
  [ -z "${SWEEP_DIR}" ] || rm -rf -- "${SWEEP_DIR}"
  SWEEP_DIR=""
}

# Runs the CLI without letting a non-zero exit kill the job (set -e): callers
# branch on the return code. Leaves the parsed status in SWEEP_HTTP.
sweep_cli() {
  local rc=0 matched
  "${CLI[@]}" "$@" >"${SWEEP_OUT}" 2>"${SWEEP_ERR}" || rc=$?
  matched="$(grep -oE 'HTTP [1-5][0-9]{2}' "${SWEEP_ERR}" 2>/dev/null | head -n1 || true)"
  SWEEP_HTTP="${matched##* }"
  [ -n "${SWEEP_HTTP}" ] || SWEEP_HTTP="none"
  return "${rc}"
}

sweep_unreclaimable() {
  SWEEP_STUCK=$((SWEEP_STUCK + 1))
  printf 'SWEEP_UNRECLAIMABLE id=%s name=%s state=%s reason=%s\n' "$1" "$2" "$3" "$4" >&2
}

# Full visible inventory as id<TAB>name<TAB>state, DELETED rows dropped.
sweep_inventory() {
  if ! sweep_cli agents ls --json; then
    echo "sweep: 'agents ls' failed (http=${SWEEP_HTTP}); refusing to sweep blind" >&2
    return 1
  fi
  node - "${SWEEP_OUT}" >"${SWEEP_DIR}/inventory.tsv" <<'JS'
const fs = require('node:fs');
let data;
try { data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
catch { console.error('sweep: agents ls returned unparseable JSON'); process.exit(1); }
if (!Array.isArray(data)) { console.error('sweep: agents ls did not return an array'); process.exit(1); }
for (const row of data) {
  const id = typeof row?.id === 'string' ? row.id : '';
  const name = (typeof row?.name === 'string' && row.name) ||
    (typeof row?.display_name === 'string' && row.display_name) || '(unnamed)';
  const state = typeof row?.state === 'string' ? row.state : 'UNKNOWN';
  if (!id || state === 'DELETED') continue;
  console.log([id, name, state].join('\t'));
}
JS
}

# Current state of one agent, or MISSING when the backend no longer has it.
sweep_state() {
  if sweep_cli agents status "$1" --json; then
    node - "${SWEEP_OUT}" <<'JS'
const fs = require('node:fs');
let row;
try { row = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch { process.exit(1); }
if (!row || typeof row.state !== 'string') process.exit(1);
console.log(row.state);
JS
  elif [ "${SWEEP_HTTP}" = 404 ]; then
    printf 'MISSING\n'
  else
    return 1
  fi
}

# Drive one agent to deletion, branching on the state the list already gave
# us. Returns 0 when the agent is gone, 1 when it is residue (already
# reported by sweep_unreclaimable).
sweep_agent() {
  local id="$1" name="$2" state="$3" stops=0 deletes=0
  local deadline=$((SECONDS + SWEEP_AGENT_DEADLINE))
  while :; do
    case "${state}" in
      MISSING|DELETED)
        return 0 ;;
      RUNNING|STARTING)
        # The only two states STOP is admitted from.
        if [ "${stops}" -ge 1 ]; then
          sweep_unreclaimable "${id}" "${name}" "${state}" "restarted-after-stop"; return 1
        fi
        step "sweep ${name} (${id}) state=${state}: stop"
        if ! sweep_cli agents stop "${id}" --yes; then
          sweep_unreclaimable "${id}" "${name}" "${state}" "stop-rejected-http-${SWEEP_HTTP}"; return 1
        fi
        stops=$((stops + 1))
        sweep_cli agents wait "${id}" --state STOPPED --timeout 120 --interval 5 || true
        ;;
      STOPPED|ARCHIVED)
        # The only two states DELETE is admitted from.
        if [ "${deletes}" -ge 1 ]; then
          sweep_unreclaimable "${id}" "${name}" "${state}" "survived-delete"; return 1
        fi
        step "sweep ${name} (${id}) state=${state}: delete"
        if ! sweep_cli agents delete "${id}" --yes; then
          sweep_unreclaimable "${id}" "${name}" "${state}" "delete-rejected-http-${SWEEP_HTTP}"; return 1
        fi
        deletes=$((deletes + 1))
        ;;
      FAILED)
        # Spec-mandated dead end: STOP, ARCHIVE and DELETE all 409 from here.
        sweep_unreclaimable "${id}" "${name}" FAILED "no-legal-exit-from-FAILED"; return 1 ;;
      CREATING|STOPPING|RESTORING|ARCHIVING|UPGRADING)
        : ;; # Transient: observe, never interrupt a storage operation.
      *)
        sweep_unreclaimable "${id}" "${name}" "${state}" "unhandled-state"; return 1 ;;
    esac
    if [ "${SECONDS}" -ge "${deadline}" ]; then
      sweep_unreclaimable "${id}" "${name}" "${state}" "deadline-${SWEEP_AGENT_DEADLINE}s"; return 1
    fi
    sleep "${SWEEP_POLL}"
    state="$(sweep_state "${id}")" || {
      sweep_unreclaimable "${id}" "${name}" "${state}" "status-unreadable-http-${SWEEP_HTTP}"; return 1
    }
  done
}

# Presweep the whole account. Sets SWEEP_REMAINING / SWEEP_STUCK. Returns
# non-zero only when the account itself could not be established (identity,
# scope, listing) — never because a single agent is unreclaimable.
sweep_account() {
  : "${HYPERCLI_CI_USER_ID:?Set the dedicated CI account UUID; the sweep deletes every agent it can list and must not run against a personal account}"
  sweep_init
  step "presweep: confirming the key belongs to CI account ${HYPERCLI_CI_USER_ID}"
  if ! sweep_cli me --json; then
    echo "sweep: 'me' failed (http=${SWEEP_HTTP}); refusing to sweep" >&2
    return 1
  fi
  node - "${SWEEP_OUT}" "${HYPERCLI_CI_USER_ID}" <<'JS' || return 1
const fs = require('node:fs');
const [file, owner] = process.argv.slice(2);
let who;
try { who = JSON.parse(fs.readFileSync(file, 'utf8')).identity; } catch { who = null; }
if (!who || who.userId !== owner) {
  console.error('sweep: authenticated user is not HYPERCLI_CI_USER_ID; refusing to delete agents');
  process.exit(1);
}
if (who.authType !== 'api_key') {
  console.error('sweep: expected an api_key identity; refusing to delete agents');
  process.exit(1);
}
JS

  sweep_inventory || return 1
  local total id name state
  total="$(wc -l <"${SWEEP_DIR}/inventory.tsv" | tr -d "[:space:]")"
  step "presweep: ${total} agent(s) visible to this account; deleting all of them"
  SWEEP_STUCK=0
  # A single unreclaimable agent must not abort the sweep.
  while IFS=$'\t' read -r id name state; do
    sweep_agent "${id}" "${name}" "${state}" || true
  done <"${SWEEP_DIR}/inventory.tsv"

  sweep_inventory || return 1
  SWEEP_REMAINING="$(wc -l <"${SWEEP_DIR}/inventory.tsv" | tr -d "[:space:]")"
  step "presweep: ${SWEEP_REMAINING} agent(s) remain (${SWEEP_STUCK} unreclaimable)"
  while IFS=$'\t' read -r id name state; do
    printf 'SWEEP_RESIDUE id=%s name=%s state=%s\n' "${id}" "${name}" "${state}" >&2
  done <"${SWEEP_DIR}/inventory.tsv"
}

# Fail fast when the residue makes a create impossible, instead of burning
# retries into 429s.
sweep_require_capacity() {
  local need="${1:-1}"
  if [ "$((SWEEP_REMAINING + need))" -gt "${SWEEP_CAP}" ]; then
    echo "error: presweep could not free a slot: ${SWEEP_REMAINING} agent(s) remain, cap is ${SWEEP_CAP}, this job needs ${need}." >&2
    echo "error: stuck agents (id name state) are listed above as SWEEP_RESIDUE; FAILED agents have no user-API exit and need an operator." >&2
    return 1
  fi
  step "presweep: ${SWEEP_REMAINING}/${SWEEP_CAP} slots used; ${need} create(s) can proceed"
}

# assert_fail <want-rc> <grep -F pattern> -- <argv...>
# Runs the CLI with the configured product base. Non-zero rc is the success
# case; rc 0 fails the test.
assert_fail() {
  local want="$1" pat="$2" out rc=0; shift 2
  [ "$1" = "--" ] && shift
  local args=("$@")
  out="$("${CLI[@]}" "${args[@]}" 2>&1)" || rc=$?
  [ "${rc}" -eq "${want}" ] || { echo "want exit ${want}, got ${rc}: ${out}"; exit 1; }
  grep -qF -- "${pat}" <<<"${out}" || { echo "missing '${pat}': ${out}"; exit 1; }
  echo "expected failure ok (${args[*]}): ${pat}"
}

case "${GROUP}/${SUB}" in
  me/me)
    step "me (three authorities: identity, capabilities, agents)"
    "${CLI[@]}" me | tee /tmp/me-table.txt
    grep -q '^Identity$' /tmp/me-table.txt
    grep -q '^Capabilities$' /tmp/me-table.txt
    grep -q '^Agents$' /tmp/me-table.txt
    "${CLI[@]}" me --json > /tmp/me.json
    node -e '
      const j = JSON.parse(require("fs").readFileSync("/tmp/me.json", "utf8"));
      if (!j.identity || !j.identity.userId) throw new Error("identity.userId missing");
      if (typeof j.identity.email !== "string" || !j.identity.email.includes("@")) throw new Error("identity.email missing");
      if (j.identity.authType !== "api_key") throw new Error("identity.authType unexpected: " + j.identity.authType);
      if (!Array.isArray(j.capabilities) || j.capabilities.length === 0) throw new Error("capabilities missing");
      if (!("agents" in j) && !("agents_error" in j)) throw new Error("agents authority missing");
      console.log("me json ok: email=" + j.identity.email +
        " effectivePlan=" + (j.agents ? j.agents.effectivePlanId : "unavailable"));
    '
    ;;

  configure/configure)
    step "configure (offline help + non-TTY negative path)"
    "${CLI[@]}" configure --help > /dev/null
    rc=0
    out="$("${CLI[@]}" configure </dev/null 2>&1)" || rc=$?
    [ "${rc}" -eq 2 ] || { echo "configure: expected exit 2, got ${rc}" >&2; exit 1; }
    printf '%s' "${out}" | grep -q 'configure needs a TTY, or pass --api-key/--api-url'
    ;;

  skills/list|skills/ls)
    step "skills ${SUB} (bundled inventory)"
    "${CLI[@]}" skills "${SUB}" | tee /tmp/skills-list.txt
    grep -q '^NAME' /tmp/skills-list.txt
    grep -q 'hypercli-agents' /tmp/skills-list.txt
    "${CLI[@]}" skills "${SUB}" --json | node -e '
      const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
      if (!Array.isArray(j) || j.length === 0) throw new Error("skills list is empty");
      for (const s of j) {
        if (!s.name || !s.description || !Array.isArray(s.commands)) throw new Error("bad skill entry");
      }
      if (!j.some((s) => s.name === "hypercli")) throw new Error("hypercli skill missing");
      console.log("skills json ok:", j.length, "skills");
    '
    ;;

  skills/export)
    step "skills export (positional <dir>)"
    OUT="$(mktemp -d)"
    "${CLI[@]}" skills export "${OUT}"
    count="$(find "${OUT}" -name SKILL.md | wc -l)"
    [ "${count}" -ge 1 ] || { echo "skills export wrote no SKILL.md files" >&2; exit 1; }
    grep -q '^name: hypercli$' "${OUT}/hypercli/SKILL.md"
    echo "exported ${count} skills to ${OUT}"
    ;;

  skills/install)
    step "skills install (help + read-only negative path only; real install mutates an agent)"
    "${CLI[@]}" skills install --help > /dev/null
    assert_fail 1 "no agent matches 'hypercli-ci-no-such-agent-zzz'" -- skills install hypercli-ci-no-such-agent-zzz
    ;;

  agents/ls|agents/list)
    step "agents ${SUB} (table, json, state filter, error mapping)"
    err="$("${CLI[@]}" agents "${SUB}" 2>&1 >/dev/null)"
    grep -q '^total [0-9]' <<<"${err}" || { echo "ls: missing 'total N' on stderr"; exit 1; }
    jsonout="$("${CLI[@]}" agents "${SUB}" --json 2>/dev/null)"
    grep -q '^\[' <<<"${jsonout}" || { echo "ls --json: stdout is not a JSON array"; exit 1; }
    grep -q '\]$' <<<"${jsonout}" || { echo "ls --json: unterminated JSON array"; exit 1; }
    "${CLI[@]}" agents "${SUB}" --state RUNNING >/dev/null
    assert_fail 1 "HTTP 422" -- agents "${SUB}" --state running
    ;;

  agents/status)
    step "agents status (negative path)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents status "${NOID}"
    assert_fail 1 "no agent matches '${NOID}'" -- agents status "${NOID}" --verbose
    assert_fail 2 "missing agent id" -- agents status
    ;;

  agents/wait)
    step "agents wait (negative path + flag validation)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents wait "${NOID}" --state RUNNING --timeout 5 --interval 1
    assert_fail 2 "--timeout must be a positive number of seconds" -- agents wait "${NOID}" --timeout nope
    assert_fail 2 "missing agent id" -- agents wait
    ;;

  agents/logs)
    step "agents logs (negative path + -n validation)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents logs "${NOID}" -n 10
    assert_fail 2 "--lines must be a non-negative integer" -- agents logs "${NOID}" -n nope
    ;;

  agents/exec)
    step "agents exec (negative path)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents exec "${NOID}" -- echo hi
    assert_fail 2 "usage: hyper agents exec <id> [--] CMD [ARGS...]" -- agents exec "${NOID}"
    ;;

  agents/cp)
    step "agents cp (negative path; resolution before any local access)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents cp "${NOID}:/tmp/x" ci-local-dst
    assert_fail 1 "no agent matches '${NOID}'" -- agents cp ci-local-src "${NOID}:/tmp/x"
    assert_fail 2 "exactly one side of cp must be remote" -- agents cp localA localB
    ;;

  agents/token)
    step "agents token (negative path only; on a real agent it mints a key)"
    assert_fail 1 "no agent matches '${NOID}'" -- agents token "${NOID}"
    assert_fail 2 "missing agent id" -- agents token
    ;;

  agents/create)
    step "agents create (dry-run payload + validation; real create lives in lifecycle)"
    out="$("${CLI[@]}" agents create hypercli-ci-dryrun --runtime opencode --dry-run)"
    grep -qF '"name": "hypercli-ci-dryrun"' <<<"${out}"
    grep -qF '"method": "createAgent"' <<<"${out}"
    assert_fail 2 "" -- agents create x --runtime bogus --dry-run
    assert_fail 2 "" -- agents create x --runtime openclaw --model m --dry-run
    ;;

  agents/activate)
    step "agents activate (no real grant code; deterministic 404)"
    assert_fail 1 "Grant code not found" -- agents activate CI-BOGUS-CODE-0000
    ;;

  agents/routines)
    step "agents routines (client-side validation; dev 404s the routines API)"
    "${CLI[@]}" agents routines list --help > /dev/null
    assert_fail 2 "" -- agents routines create --prompt poke
    assert_fail 2 "" -- agents routines create --cron "* * * * *" --run-at 2030-01-01T00:00:00Z --prompt p
    ;;

  agents/presweep)
    step "agents presweep (delete every agent this CI account can list)"
    # Standalone entry point for the same sweep the e2e groups run, so an
    # operator can reclaim the CI account without a full e2e run.
    trap sweep_cleanup EXIT
    sweep_account
    sweep_require_capacity "${SWEEP_REQUIRE_SLOTS:-1}"
    ;;

  agents/lifecycle)
    step "agents lifecycle (serialized, real mutation: create → start → chat → stop → archive → restore → start → chat → stop → delete)"
    source "${SCRIPT_DIR}/lifecycle.sh"
    ;;

  agents/e2e-routines)
    step "agents e2e-routines (real agent + chat session json + one-shot routine on dev)"
    # Semi-real e2e (mirrors agents/lifecycle conventions): unique-per-run
    # name, full-account presweep before create, best-effort cleanup trap.
    : "${LIFECYCLE_SUFFIX:?LIFECYCLE_SUFFIX is required}"
    PREFIX="hypercli-ci-routines"
    NAME="${PREFIX}-${LIFECYCLE_SUFFIX}"
    ID=""
    RID=""

    cleanup() {
      step "cleanup (best-effort)"
      [ -z "${RID}" ] || "${CLI[@]}" routines delete "${RID}" --yes || true
      if [ -n "${ID}" ]; then
        if "${CLI[@]}" agents stop "${ID}" --yes; then
          "${CLI[@]}" agents wait "${ID}" --state STOPPED --timeout 120 --interval 5 || true
        fi
        "${CLI[@]}" agents delete "${ID}" --yes || true
      fi
      sweep_cleanup
    }
    on_exit() {
      local rc=$?
      cleanup
      if [ "${rc}" -ne 0 ] \
        && { [ "${E2E_KEEP_ALIVE_ON_FAILURE:-}" = "1" ] || [ "${E2E_KEEP_ALIVE_ON_FAILURE:-}" = "true" ]; }; then
        trap - EXIT
        echo "E2E_KEEP_ALIVE_ON_FAILURE is set; leaving this container alive for debugging." >&2
        echo "Rerun inside the container: cd /opt/cli && /tests/live.sh agents e2e-routines" >&2
        tail -f /dev/null
      fi
      exit "${rc}"
    }
    trap on_exit EXIT

    # Presweep the whole account, not just this prefix: leftovers of any name
    # occupy the same 10-saved-agent quota and used to 429 every create here.
    sweep_account
    sweep_require_capacity 1

    # Create (real). Same 6x/15s retry as agents/lifecycle: slot release after
    # a delete lags, and hostname release is async.
    CREATE_JSON=""
    for attempt in 1 2 3 4 5 6; do
      if CREATE_JSON="$("${CLI[@]}" agents create "${NAME}" --runtime opencode --size large --json 2>>/tmp/create.err)"; then
        ID="$(printf '%s' "${CREATE_JSON}" | node -e \
          'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).id)')"
      fi
      [ -n "${ID}" ] && break
      echo "create attempt ${attempt} failed; stderr so far:" >&2
      cat /tmp/create.err >&2 || true
      # The saved-agent cap is not a transient slot race: retrying it 6 times
      # only produces 6 identical 429s. Fail fast with the residue instead.
      if grep -qE 'HTTP 429.*Maximum [0-9]+ saved agents' /tmp/create.err; then
        echo "error: account is at the saved-agent cap after a full presweep;" >&2
        echo "error: ${SWEEP_REMAINING} agent(s) could not be reclaimed (see SWEEP_RESIDUE above)." >&2
        exit 1
      fi
      sleep 15
    done
    [ -n "${ID}" ] || { echo "create returned no id after 6 attempts"; cat /tmp/create.err >&2; exit 1; }
    echo "created ${NAME} id=${ID}"

    # create leaves agents provisioning; wait for STOPPED then start (the raw
    # start immediately after create 409s on storage provisioning).
    "${CLI[@]}" agents wait "${ID}" --state STOPPED --timeout 240 --interval 5
    "${CLI[@]}" agents start "${ID}"
    "${CLI[@]}" agents wait "${ID}" --state RUNNING --timeout 180 --interval 5

    step "chat 1/2 (fresh session)"
    "${CLI[@]}" agents chat "${ID}" "Reply with exactly: CI_OK" --timeout 120 --json > /tmp/chat1.json
    SESSION_ID="$(node -e '
      const j = JSON.parse(require("fs").readFileSync("/tmp/chat1.json", "utf8"));
      if (typeof j.session_id !== "string" || j.session_id.length === 0) throw new Error("session_id missing");
      if (!j.session || j.session.id !== j.session_id) throw new Error("session.id !== session_id");
      if (j.session.resumed !== false) throw new Error("fresh chat must report session.resumed === false");
      process.stdout.write(j.session_id);
    ')"
    echo "session ${SESSION_ID} (resumed=false)"

    step "chat 2/2 (resume with -s)"
    "${CLI[@]}" agents chat "${ID}" "ping" -s "${SESSION_ID}" --timeout 120 --json > /tmp/chat2.json
    node -e '
      const j = JSON.parse(require("fs").readFileSync("/tmp/chat2.json", "utf8"));
      if (!j.session || j.session.id !== process.argv[1]) throw new Error("session.id mismatch on resume");
      if (j.session.resumed !== true) throw new Error("resumed chat must report session.resumed === true");
      console.log("resume ok:", j.session.id);
    ' "${SESSION_ID}"

    step "one-shot routine (run at now+90s)"
    TOKEN="$(printf '%s' "${LIFECYCLE_SUFFIX}" | cut -c1-7)"
    FLAG="/home/node/hyperci-flag-${TOKEN}.txt"
    RUN_AT="$(date -u -d "+90 seconds" +%Y-%m-%dT%H:%M:%SZ)"
    "${CLI[@]}" routines create --run-at "${RUN_AT}" --agent "${ID}" --session "${SESSION_ID}" \
      --prompt "Create the file ${FLAG} containing exactly ${TOKEN}" --name "${NAME}" --json > /tmp/routine.json
    RID="$(node -e '
      const j = JSON.parse(require("fs").readFileSync("/tmp/routine.json", "utf8"));
      if (typeof j.id !== "string" || j.id.length === 0) throw new Error("routine id missing");
      if (j.next_run_at === null || j.next_run_at === undefined) throw new Error("next_run_at missing on a fresh one-shot routine");
      process.stdout.write(j.id);
    ')"
    echo "routine ${RID} scheduled for ${RUN_AT}"

    step "poll routine run (deadline 8 min)"
    deadline=$(( $(date +%s) + 480 ))
    fired=0
    while [ "$(date +%s)" -lt "${deadline}" ]; do
      if got="$("${CLI[@]}" routines get "${RID}" --json 2>/dev/null | node -e '
        const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
        process.stdout.write(j.enabled === false && j.next_run_at === null ? "1" : "0");
      ')" && [ "${got}" = "1" ]; then
        fired=1
        break
      fi
      sleep 15
    done
    [ "${fired}" = "1" ] || { echo "routine ${RID} did not run within 8 minutes"; exit 1; }
    echo "routine ${RID} fired"

    step "verify flag file (up to 3 min after fire)"
    deadline=$(( $(date +%s) + 180 ))
    while true; do
      if "${CLI[@]}" agents exec "${ID}" -- cat "${FLAG}" 2>/dev/null | grep -qF "${TOKEN}"; then
        echo "flag ok: ${FLAG} contains ${TOKEN}"
        break
      fi
      [ "$(date +%s)" -lt "${deadline}" ] || { echo "flag file ${FLAG} never contained ${TOKEN}"; exit 1; }
      sleep 15
    done
    ;;

  jobs/gpus)
    step "jobs gpus (catalog; count varies on dev)"
    "${CLI[@]}" jobs gpus | grep -q 'GPU_TYPE'
    "${CLI[@]}" jobs gpus --json | grep -qF '"gpuType"'
    ;;

  jobs/list|jobs/ls)
    step "jobs ${SUB} (table + json)"
    "${CLI[@]}" jobs "${SUB}" | grep -q 'ID'
    "${CLI[@]}" jobs "${SUB}" --json | grep -qF '['
    ;;

  jobs/get|jobs/logs)
    step "jobs ${SUB} (unknown-id resolution + usage)"
    assert_fail 1 "no job in 'hyper jobs list'" -- jobs "${SUB}" "${NOID}"
    assert_fail 2 "usage: hyper jobs ${SUB}" -- jobs "${SUB}"
    ;;

  jobs/create)
    step "jobs create (dry-run positive + usage negatives)"
    out="$("${CLI[@]}" jobs create --image alpine --dry-run -- echo hi 2>&1)"
    grep -qF '"image": "alpine"' <<<"${out}"
    grep -qF '"command": "echo hi"' <<<"${out}"
    assert_fail 2 "missing '-- CMD...'" -- jobs create --image alpine
    ;;

  jobs/cancel)
    step "jobs cancel (non-TTY refusal = zero mutation)"
    assert_fail 2 "usage: hyper jobs cancel" -- jobs cancel
    assert_fail 1 "refusing to cancel" -- jobs cancel "${NOID}"
    ;;

  jobs/extend)
    step "jobs extend (usage negative)"
    assert_fail 2 "usage: hyper jobs extend" -- jobs extend
    ;;

  jobs/exec)
    step "jobs exec (unknown-id negative)"
    assert_fail 1 "no job in 'hyper jobs list'" -- jobs exec "${NOID}" -- echo hi
    ;;

  flow/list)
    step "flow list (table + json)"
    "${CLI[@]}" flow list | grep -q 'TYPE'
    "${CLI[@]}" flow list --json | grep -qF '['
    ;;

  flow/status)
    step "flow status (404 negative + usage)"
    assert_fail 1 "Render not found" -- flow status "${NOID}"
    assert_fail 2 "usage: hyper flow status" -- flow status
    ;;

  flow/wait)
    step "flow wait (404 negative, returns fast; + usage)"
    assert_fail 1 "Render not found" -- flow wait "${NOID}" --timeout 5
    assert_fail 2 "usage: hyper flow wait" -- flow wait
    ;;

  flow/create)
    step "flow create (dry-run positive + type/prompt validation)"
    out="$("${CLI[@]}" flow create text-to-image --prompt "ci smoke" --dry-run 2>&1)"
    grep -qF '"type": "text-to-image"' <<<"${out}"
    assert_fail 2 "unknown flow type 'bogus-type'" -- flow create bogus-type
    assert_fail 2 "requires --prompt" -- flow create text-to-image
    ;;

  flow/cancel)
    step "flow cancel (non-TTY refusal = zero mutation)"
    assert_fail 1 "refusing to cancel" -- flow cancel "${NOID}"
    ;;

  files/upload)
    step "files upload (usage + pre-network path error; real upload not run)"
    assert_fail 2 "usage: hyper files upload" -- files upload
    assert_fail 1 "cannot read file" -- files upload "${NOID}.txt"
    ;;

  files/get)
    step "files get (404 negative + usage)"
    assert_fail 1 "failed to get file ${NOID}: 404" -- files get "${NOID}"
    assert_fail 2 "usage: hyper files get" -- files get
    ;;

  files/delete)
    step "files delete (non-TTY refusal = zero mutation)"
    assert_fail 1 "refusing to delete" -- files delete "${NOID}"
    ;;

  voice/tts)
    step "voice tts (usage negatives only; real synth bills TTS)"
    assert_fail 2 "usage: hyper voice tts" -- voice tts
    assert_fail 2 "usage: hyper voice tts" -- voice tts one two
    assert_fail 2 "unknown voice command 'bogus'" -- voice bogus
    ;;

  voice/transcribe)
    step "voice transcribe (live TTS audio -> REST STT)"
    VOICE_TEXT="Hey this is hyper voice"
    VOICE_AUDIO="$(mktemp "${TMPDIR:-/tmp}/hypercli-voice-XXXXXX.mp3")"
    VOICE_TTS_JSON="$(mktemp "${TMPDIR:-/tmp}/hypercli-voice-tts-XXXXXX.json")"
    VOICE_TRANSCRIBE_JSON="$(mktemp "${TMPDIR:-/tmp}/hypercli-voice-transcribe-XXXXXX.json")"
    "${CLI[@]}" voice tts "${VOICE_TEXT}" --out "${VOICE_AUDIO}" --json > "${VOICE_TTS_JSON}"
    node -e '
      const fs = require("fs");
      const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const audio = process.argv[2];
      if (record.out !== audio) throw new Error(`tts out mismatch: ${record.out} !== ${audio}`);
      if (!Number.isInteger(record.bytes) || record.bytes <= 0) throw new Error(`tts bytes invalid: ${record.bytes}`);
      if (fs.statSync(audio).size <= 0) throw new Error("tts audio file is empty");
      console.log(`tts json ok: ${record.bytes} bytes`);
    ' "${VOICE_TTS_JSON}" "${VOICE_AUDIO}"

    if ! "${CLI[@]}" voice transcribe "${VOICE_AUDIO}" --rest --language en --json > "${VOICE_TRANSCRIBE_JSON}" 2>/tmp/hypercli-voice-transcribe.err; then
      if grep -qF "STT worker is not configured" /tmp/hypercli-voice-transcribe.err; then
        echo "SKIP voice/transcribe: dev STT worker is not configured" >&2
        exit 0
      fi
      cat /tmp/hypercli-voice-transcribe.err >&2
      exit 1
    fi
    node -e '
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (!j || typeof j.text !== "string" || j.text.length === 0) throw new Error("transcript text missing");
      const normalized = j.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
      for (const token of ["hyper", "voice"]) {
        if (!tokens.has(token)) throw new Error(`transcript missing token ${token}: ${j.text}`);
      }
      console.log(`transcribe json ok: ${j.text}`);
    ' "${VOICE_TRANSCRIBE_JSON}"
    ;;

  *)
    echo "no live test defined for ${GROUP}/${SUB}" >&2
    exit 64
    ;;
esac

echo "OK ${GROUP}/${SUB}"
