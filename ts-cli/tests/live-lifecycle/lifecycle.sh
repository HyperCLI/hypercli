#!/usr/bin/env bash
# Sourced by live.sh. User-key cleanup only: no admin bypass or forced state.
# HYPERCLI_CI_USER_ID must pin the dedicated dev CI account (or a caller-created
# disposable owner). A prefix alone is never account ownership proof.
# These jobs have a user-scoped key, not admin/bootstrap authority. A fresh owner
# can be supplied by a caller, but does not recover legacy shared-account rows.

lc_json() {
  node - "${LC_OUT}" "$1" "${HYPERCLI_CI_USER_ID}" "${2:-}" "${3:-}" <<'JS'
const fs = require('node:fs');
const [file, mode, owner, id, name] = process.argv.slice(2);
const fail = code => { console.error(`LIFECYCLE_INVALID ${code}`); process.exit(1); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ciName = /^hypercli-ci-lifecycle-(?:[0-9a-f]{7}-[1-9][0-9]{0,2}|[0-9a-f]{10})$/;
const states = new Set('CREATING STARTING RESTORING RUNNING STOPPING STOPPED UPGRADING ARCHIVING ARCHIVED FAILED DELETED'.split(' '));
let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('json'); }
function owned(row) {
  if (!row || !uuid.test(row.id) || !ciName.test(row.name) || row.name.length > 32 ||
      row.runtime !== 'opencode' || !Array.isArray(row.tags) ||
      row.tags.length !== 1 || row.tags[0] !== `agent:${row.id}` ||
      !states.has(row.state)) fail('ownership_or_state');
  return row;
}
if (mode === 'identity') {
  const who = data.identity;
  if (!uuid.test(owner) || !who || who.userId !== owner || who.authType !== 'api_key' ||
      who.agent_id || who.runtime || !Array.isArray(who.tags) || !who.tags.includes('*:*')) fail('ci_account_or_scope');
} else if (mode === 'inventory') {
  if (!Array.isArray(data)) fail('inventory_shape');
  const seen = new Set();
  const names = new Set();
  const rows = data.filter(row => typeof row?.name === 'string' && ciName.test(row.name)).map(owned);
  for (const row of rows) {
    if (seen.has(row.id) || names.has(row.name)) fail('ambiguous_inventory');
    seen.add(row.id);
    names.add(row.name);
  }
  console.error(`LIFECYCLE_INVENTORY owned=${rows.length} outside_scope=${data.length - rows.length}`);
  for (const row of rows) if (row.state !== 'DELETED') console.log(`${row.id}\t${row.name}\t${row.state}`);
} else if (mode === 'capacity') {
  // The owned sweep can only remove rows it owns; foreign or FAILED rows still
  // occupy the account's saved-agent quota. Refuse CREATE rather than feeding
  // the backend a request that can only come back 429.
  if (!Array.isArray(data)) fail('inventory_shape');
  const cap = Number(id);
  if (!Number.isInteger(cap) || cap < 1) fail('capacity_argument');
  const live = data.filter(row => row && typeof row.state === 'string' && row.state !== 'DELETED');
  if (live.length + 1 > cap) {
    for (const row of live) console.error(`LIFECYCLE_BLOCKING id=${row.id} name=${row.name} state=${row.state}`);
    console.error(`LIFECYCLE_NO_CAPACITY live=${live.length} cap=${cap} needed=1; CREATE not attempted`);
    process.exit(1);
  }
  console.error(`LIFECYCLE_CAPACITY live=${live.length} cap=${cap}`);
} else if (mode === 'record') {
  const row = owned(data);
  if ((id && row.id !== id) || row.name !== name) fail('identity_changed');
  console.log(id ? row.state : row.id);
} else if (mode === 'chat') {
  if (data.agent_id !== id || typeof data.reply !== 'string' || data.reply.trim() !== 'CI_OK') fail('chat_reply');
} else fail('mode');
JS
}

lc_cli() {
  local rc=0
  timeout --kill-after=5s "${LC_COMMAND_TIMEOUT:-45}" "${CLI[@]}" "$@" >"${LC_OUT}" 2>"${LC_ERR}" || rc=$?
  LC_HTTP="none"
  if [ "$rc" -ne 0 ]; then
    read -r LC_HTTP LC_CAUSE < <(node - "${LC_ERR}" <<'JS'
const text = require('node:fs').readFileSync(process.argv[2], 'utf8');
const status = /HTTP ([1-5][0-9]{2})\b/.exec(text)?.[1] ?? 'none';
const cause = status === '429' && /Maximum [0-9]+ saved agents/.test(text) ? 'saved_agent_quota_no_retry'
  : status === '429' ? 'quota_or_rate_limit_no_retry'
  : /slot|capacity/i.test(text) ? 'capacity_unavailable_no_create_retry' : 'command_failed';
console.log(status, cause);
JS
)
    if [ "$1/${2:-}:${LC_HTTP}" != agents/status:404 ]; then
      printf 'LIFECYCLE_COMMAND_FAILED command=%s/%s exit=%s http=%s cause=%s\n' "$1" "${2:-}" "$rc" "$LC_HTTP" "$LC_CAUSE" >&2
    fi
  fi
  return "$rc"
}

lc_inventory() {
  lc_cli agents ls --json || return $?
  lc_json inventory >"${LC_SCRATCH}/inventory.tsv"
}

lc_state() {
  if lc_cli agents status "$1" --json; then
    lc_json record "$1" "$2"
  elif [ "${LC_HTTP}" = 404 ]; then
    printf 'MISSING\n'
  else
    return 1
  fi
}

lc_leftover() {
  printf 'LIFECYCLE_LEFTOVER id=%s name=%s state=%s recovery=admin-inspect\n' "$1" "$2" "$3" >&2
}

lc_clean_agent() {
  local id="$1" name="$2" state stopped=0 deleted=0
  while :; do
    state="$(lc_state "$id" "$name")" || { lc_leftover "$id" "$name" unreadable; return 1; }
    case "$state" in
      MISSING|DELETED) return 0 ;;
      FAILED) lc_leftover "$id" "$name" FAILED; return 1 ;;
      RUNNING)
        if [ "$stopped" = 0 ] && [ "$deleted" = 0 ]; then
          lc_cli agents stop "$id" --yes --json || { lc_leftover "$id" "$name" "$state"; return 1; }
          stopped=1
          continue
        fi ;;
      STOPPED|ARCHIVED)
        if [ "$deleted" = 0 ]; then
          lc_cli agents delete "$id" --yes --json || { lc_leftover "$id" "$name" "$state"; return 1; }
          deleted=1
          continue
        fi ;;
      CREATING|STARTING|STOPPING|RESTORING|ARCHIVING|UPGRADING) ;; # Observe; never interrupt a storage operation.
      *) lc_leftover "$id" "$name" unknown; return 1 ;;
    esac
    if [ "$SECONDS" -ge "$LC_DEADLINE" ]; then
      lc_leftover "$id" "$name" "$state"; return 1
    fi
    sleep "$LC_POLL_SECONDS"
  done
}

lc_wait() {
  LC_COMMAND_TIMEOUT=255 lc_cli agents wait "$LC_ID" --state "$1" --timeout 240 --interval 5 --json || return $?
  local state
  state="$(lc_json record "$LC_ID" "$LC_NAME")" || return 1
  [ "$state" = "$1" ] || { lc_leftover "$LC_ID" "$LC_NAME" "$state"; return 1; }
}

lc_exit() {
  local original=$? failed=0 id name state
  trap - EXIT INT TERM
  set +e
  LC_DEADLINE=$((SECONDS + LC_CLEANUP_SECONDS))
  if [ "$LC_CREATE_ATTEMPTED" = 1 ]; then
    if [ -z "$LC_ID" ]; then
      # Lost/malformed create responses are reconciled by this run's unique name,
      # never by submitting CREATE again or sweeping a broader prefix in the trap.
      if lc_inventory; then
        while IFS=$'\t' read -r id name state; do
          [ "$name" != "$LC_NAME" ] || LC_ID="$id"
        done <"${LC_SCRATCH}/inventory.tsv"
      fi
    fi
    if [ -n "$LC_ID" ]; then
      lc_clean_agent "$LC_ID" "$LC_NAME" || failed=1
    else
      printf 'LIFECYCLE_CREATE_UNRESOLVED name=%s inspect_before_rerun=true\n' "$LC_NAME" >&2
      failed=1
    fi
  fi
  # Only this invocation's mktemp root; never shared /tmp or another job's state.
  rm -rf -- "$LC_SCRATCH" || failed=1
  [ "$original" -ne 0 ] || original="$failed"
  exit "$original"
}

lc_main() {
  : "${HYPERCLI_CI_USER_ID:?Set the verified dedicated dev CI user UUID; a name prefix is not sufficient}"
  # The product base must be the exact dev API; the SDK derives the agents
  # endpoints from it. A prod or overridden value refuses the run.
  [ "$HYPER_API_BASE" = https://api.dev.hypercli.com ] || {
      echo 'Lifecycle requires exact dev endpoints' >&2; return 1;
    }
  LC_CLEANUP_SECONDS="${LIFECYCLE_CLEANUP_SECONDS:-240}"
  [[ "$LC_CLEANUP_SECONDS" =~ ^[0-9]+$ ]] && [ "$LC_CLEANUP_SECONDS" -le 600 ] || return 1
  LC_POLL_SECONDS="${LIFECYCLE_POLL_SECONDS:-5}"
  [[ "$LC_POLL_SECONDS" =~ ^[0-9]+$ ]] && [ "$LC_POLL_SECONDS" -le 30 ] || return 1
  umask 077
  LC_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/cli-lifecycle.XXXXXXXX")"
  LC_OUT="${LC_SCRATCH}/command.json" LC_ERR="${LC_SCRATCH}/command.err"
  LC_ID="" LC_NAME="" LC_CREATE_ATTEMPTED=0
  export HYPER_HOME="${LC_SCRATCH}/hyper-home"
  mkdir -m 700 "$HYPER_HOME"
  trap lc_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  lc_cli me --json
  lc_json identity
  lc_inventory # Unfiltered list: the backend returns the whole visible account inventory.
  local id name state failed=0
  LC_DEADLINE=$((SECONDS + LC_CLEANUP_SECONDS))
  while IFS=$'\t' read -r id name state; do
    step "cleanup owned lifecycle agent ${id} (${state})"
    lc_clean_agent "$id" "$name" || failed=1
  done <"${LC_SCRATCH}/inventory.tsv"
  lc_inventory
  if [ "$failed" != 0 ] || [ -s "${LC_SCRATCH}/inventory.tsv" ]; then
    while IFS=$'\t' read -r id name state; do lc_leftover "$id" "$name" "$state"; done <"${LC_SCRATCH}/inventory.tsv"
    echo 'CI inventory cleanup incomplete; CREATE not attempted. Recover these exact owned agents through supported admin APIs.' >&2
    return 1
  fi
  # LC_OUT still holds the whole visible inventory from the lc_inventory above.
  lc_json capacity "${LIFECYCLE_AGENT_CAP:-10}" || return 1
  LC_NAME="hypercli-ci-lifecycle-$(node -p 'require("node:crypto").randomBytes(5).toString("hex")')"
  step "create ${LC_NAME} (one submission; no blind quota retries)"
  LC_CREATE_ATTEMPTED=1
  local rc
  if lc_cli agents create "$LC_NAME" --runtime opencode --size large --json; then
    LC_ID="$(lc_json record '' "$LC_NAME")"
  else
    rc=$?
    # This explicit rejection occurs before record creation. Other failures may
    # have saved a row; the trap reconciles them rather than assuming no effect.
    if [ "$LC_HTTP:$LC_CAUSE" = 429:saved_agent_quota_no_retry ]; then LC_CREATE_ATTEMPTED=0; fi
    return "$rc"
  fi
  lc_wait STOPPED
  lc_cli agents start "$LC_ID" --json
  lc_wait RUNNING
  LC_COMMAND_TIMEOUT=135 lc_cli agents chat "$LC_ID" 'Reply with exactly: CI_OK' --timeout 120 --json
  lc_json chat "$LC_ID"
  lc_cli agents stop "$LC_ID" --yes --json
  lc_wait STOPPED
  lc_cli agents archive "$LC_ID" --json
  lc_wait ARCHIVED
  lc_cli agents restore "$LC_ID" --json
  lc_wait STOPPED
  lc_cli agents start "$LC_ID" --json
  lc_wait RUNNING
  LC_COMMAND_TIMEOUT=135 lc_cli agents chat "$LC_ID" 'Reply with exactly: CI_OK' --timeout 120 --json
  lc_json chat "$LC_ID"
  lc_cli agents stop "$LC_ID" --yes --json
  lc_wait STOPPED
  LC_DEADLINE=$((SECONDS + LC_CLEANUP_SECONDS))
  lc_clean_agent "$LC_ID" "$LC_NAME"
  LC_CREATE_ATTEMPTED=0
  echo 'lifecycle ok: create -> start -> chat -> stop -> archive -> restore -> start -> chat -> stop -> delete (public absence verified)'
}

lc_main
