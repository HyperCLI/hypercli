#!/usr/bin/env bash
# Live tests against the dev backend, one serialized job per subcommand.
# Usage: live.sh <group> <sub>
#
# Required env (set by the workflow):
#   HYPER_API_KEY   — CI key (hypercli-ci-v2, scope *:*)
#   HYPER_API_BASE=https://api.dev.hypercli.com — product API. Mandatory:
#   --dev only retargets the AGENTS API; jobs/flow/files/voice read apiUrl
#   from HYPER_API_BASE and would silently hit prod (401) without it.
#
# Conventions:
#   --dev trails subcommand args (hyper --dev agents ls is rejected).
#   For agents exec / jobs create / jobs exec, --dev must come BEFORE `--`
#   (everything after -- is folded into the command string).
#   Exit codes: 0 ok, 1 CliError (mapped API error), 2 UsageError.
#   Errors print "error: <msg>" on stderr; info ("total N") always stderr.
#   Persistent refs: hypercli-ci-*; hypercli-ci-does-not-exist never resolves.
set -euo pipefail

GROUP="${1:?usage: live.sh <group> <sub>}"
SUB="${2:?usage: live.sh <group> <sub>}"

export HYPER_API_KEY="${HYPER_API_KEY:?HYPER_API_KEY is required}"
export HYPER_API_BASE="${HYPER_API_BASE:-https://api.dev.hypercli.com}"
# SDK reads AGENTS_WS_URL (ts-sdk config.ts); with --dev the default already
# resolves to the dev WS, this just pins it. HYPER_AGENTS_WS_URL is not read.
export AGENTS_WS_URL="${AGENTS_WS_URL:-wss://api.agents.dev.hypercli.com/ws}"

NOID="hypercli-ci-does-not-exist"
CLI=(node dist/index.js)

cd /opt/cli

step() { echo "==> $*"; }

# assert_fail <want-rc> <grep -F pattern> -- <argv...>
# Runs the CLI (append --dev before any `--`). Non-zero rc is the success
# case; rc 0 fails the test.
assert_fail() {
  local want="$1" pat="$2" out rc=0; shift 2
  [ "$1" = "--" ] && shift
  local args=("$@")
  local dev_args=() token placed=0
  for token in "${args[@]}"; do
    if [ "$placed" = 0 ] && [ "$token" = "--" ]; then
      dev_args+=("--dev")
      placed=1
    fi
    dev_args+=("$token")
  done
  [ "$placed" = 1 ] || dev_args+=("--dev")
  out="$("${CLI[@]}" "${dev_args[@]}" 2>&1)" || rc=$?
  [ "${rc}" -eq "${want}" ] || { echo "want exit ${want}, got ${rc}: ${out}"; exit 1; }
  grep -qF -- "${pat}" <<<"${out}" || { echo "missing '${pat}': ${out}"; exit 1; }
  echo "expected failure ok (${dev_args[*]}): ${pat}"
}

case "${GROUP}/${SUB}" in
  me/me)
    step "me (three authorities: identity, capabilities, agents)"
    "${CLI[@]}" me --dev | tee /tmp/me-table.txt
    grep -q '^Identity$' /tmp/me-table.txt
    grep -q '^Capabilities$' /tmp/me-table.txt
    grep -q '^Agents$' /tmp/me-table.txt
    "${CLI[@]}" me --dev --json > /tmp/me.json
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
    out="$("${CLI[@]}" configure --dev </dev/null 2>&1)" || rc=$?
    [ "${rc}" -eq 2 ] || { echo "configure: expected exit 2, got ${rc}" >&2; exit 1; }
    printf '%s' "${out}" | grep -q 'configure needs a TTY, or pass --api-key/--api-url'
    ;;

  skills/list|skills/ls)
    step "skills ${SUB} (bundled inventory)"
    "${CLI[@]}" skills "${SUB}" --dev | tee /tmp/skills-list.txt
    grep -q '^NAME' /tmp/skills-list.txt
    grep -q 'hypercli-agents' /tmp/skills-list.txt
    "${CLI[@]}" skills "${SUB}" --dev --json | node -e '
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
    "${CLI[@]}" skills export "${OUT}" --dev
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
    err="$("${CLI[@]}" agents "${SUB}" --dev 2>&1 >/dev/null)"
    grep -q '^total [0-9]' <<<"${err}" || { echo "ls: missing 'total N' on stderr"; exit 1; }
    jsonout="$("${CLI[@]}" agents "${SUB}" --json --dev 2>/dev/null)"
    grep -q '^\[' <<<"${jsonout}" || { echo "ls --json: stdout is not a JSON array"; exit 1; }
    grep -q '\]$' <<<"${jsonout}" || { echo "ls --json: unterminated JSON array"; exit 1; }
    "${CLI[@]}" agents "${SUB}" --state RUNNING --dev >/dev/null
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
    step "agents exec (negative path; --dev before --)"
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

  agents/models)
    step "agents models (no catalog invocation; openclaw-only per-agent)"
    assert_fail 2 "missing agent id" -- agents models
    assert_fail 1 "no agent matches '${NOID}'" -- agents models "${NOID}"
    ;;

  agents/create)
    step "agents create (dry-run payload + validation; real create lives in lifecycle)"
    out="$("${CLI[@]}" agents create hypercli-ci-dryrun --runtime opencode --dry-run --dev)"
    grep -qF '"name": "hypercli-ci-dryrun"' <<<"${out}"
    grep -qF '"method": "createOpenCode"' <<<"${out}"
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

  agents/lifecycle)
    step "agents lifecycle (serialized, real mutation: create → start → chat → stop → archive → restore → start → chat → stop → delete)"
    # Unique-per-run name avoids the async hostname release 409 race; the
    # sweep cleans up hypercli-ci-lifecycle-* orphans from crashed runs.
    NAME="hypercli-ci-lifecycle-${LIFECYCLE_SUFFIX:?LIFECYCLE_SUFFIX is required}"
    PREFIX="hypercli-ci-lifecycle"
    "${CLI[@]}" agents ls --json --dev 2>/dev/null | node -e '
      const a = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const x of a) {
        const n = x.name || x.display_name || "";
        if (n.startsWith(process.argv[1])) console.log(x.id, n);
      }
    ' "${PREFIX}" | while read -r OLD_ID OLD_NAME; do
      step "sweep leftover ${OLD_NAME} (${OLD_ID})"
      "${CLI[@]}" agents stop "${OLD_ID}" --yes --dev || true
      "${CLI[@]}" agents delete "${OLD_ID}" --yes --dev || true
    done

    # Create (real). The CI account's slot inventory is large-tier; a delete
    # moments earlier can lag slot release, so retry a few times with backoff
    # and keep stderr visible instead of piping it into /dev/null.
    ID=""
    CREATE_JSON=""
    for attempt in 1 2 3 4 5 6; do
      if CREATE_JSON="$("${CLI[@]}" agents create "${NAME}" --runtime opencode --size large --json --dev 2>>/tmp/create.err)"; then
        ID="$(printf '%s' "${CREATE_JSON}" | node -e \
          'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).id)')"
      fi
      [ -n "${ID}" ] && break
      echo "create attempt ${attempt} failed; stderr so far:" >&2
      cat /tmp/create.err >&2 || true
      # hostname release after delete is async; give the domains cache time
      sleep 15
    done
    [ -n "${ID}" ] || { echo "create returned no id after 6 attempts"; cat /tmp/create.err >&2; exit 1; }
    echo "created ${NAME} id=${ID}"

    "${CLI[@]}" agents wait "${ID}" --state RUNNING --timeout 120 --interval 5 --dev || {
      "${CLI[@]}" agents start "${ID}" --dev
      "${CLI[@]}" agents wait "${ID}" --state RUNNING --timeout 180 --interval 5 --dev
    }

    step "chat 1/2"
    "${CLI[@]}" agents chat "${ID}" "Reply with exactly: CI_OK" --timeout 120 --dev

    step "stop → archive → restore"
    "${CLI[@]}" agents stop "${ID}" --yes --dev
    "${CLI[@]}" agents wait "${ID}" --state STOPPED --timeout 120 --interval 5 --dev
    "${CLI[@]}" agents archive "${ID}" --dev
    # Large-tier storage snapshot/finalize is slow (observed ~73s); wait for
    # the acknowledged archive before restore, which 409s on a pending one.
    "${CLI[@]}" agents wait "${ID}" --state ARCHIVED --timeout 240 --interval 5 --dev
    "${CLI[@]}" agents restore "${ID}" --dev
    # Restore is async too: storage must finish re-materializing (back to
    # STOPPED) before start, which 409s on a still-restoring agent.
    "${CLI[@]}" agents wait "${ID}" --state STOPPED --timeout 240 --interval 5 --dev

    step "start → chat 2/2"
    "${CLI[@]}" agents start "${ID}" --dev
    "${CLI[@]}" agents wait "${ID}" --state RUNNING --timeout 180 --interval 5 --dev
    "${CLI[@]}" agents chat "${ID}" "Reply with exactly: CI_OK" --timeout 120 --dev

    step "stop → delete"
    "${CLI[@]}" agents stop "${ID}" --yes --dev
    "${CLI[@]}" agents wait "${ID}" --state STOPPED --timeout 120 --interval 5 --dev || true
    "${CLI[@]}" agents delete "${ID}" --yes --dev
    echo "lifecycle ok: ${NAME} (${ID}) create → start → chat → stop → archive → restore → start → chat → stop → delete"
    ;;

  agents/e2e-routines)
    step "agents e2e-routines (real agent + chat session json + one-shot routine on dev)"
    # Semi-real e2e (mirrors agents/lifecycle conventions): unique-per-run
    # name, presweep of crashed-run orphans, best-effort cleanup trap.
    : "${LIFECYCLE_SUFFIX:?LIFECYCLE_SUFFIX is required}"
    PREFIX="hypercli-ci-routines"
    NAME="${PREFIX}-${LIFECYCLE_SUFFIX}"
    ID=""
    RID=""

    cleanup() {
      step "cleanup (best-effort)"
      [ -z "${RID}" ] || "${CLI[@]}" routines delete "${RID}" --yes --dev || true
      if [ -n "${ID}" ]; then
        "${CLI[@]}" agents stop "${ID}" --yes --dev || true
        "${CLI[@]}" agents delete "${ID}" --yes --dev || true
      fi
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

    # Presweep orphans from crashed runs.
    "${CLI[@]}" agents ls --json --dev 2>/dev/null | node -e '
      const a = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const x of a) {
        const n = x.name || x.display_name || "";
        if (n.startsWith(process.argv[1])) console.log(x.id, n);
      }
    ' "${PREFIX}" | while read -r OLD_ID OLD_NAME; do
      step "sweep leftover ${OLD_NAME} (${OLD_ID})"
      "${CLI[@]}" agents stop "${OLD_ID}" --yes --dev || true
      "${CLI[@]}" agents delete "${OLD_ID}" --yes --dev || true
    done

    # Create (real). Same 6x/15s retry as agents/lifecycle: slot release after
    # a delete lags, and hostname release is async.
    CREATE_JSON=""
    for attempt in 1 2 3 4 5 6; do
      if CREATE_JSON="$("${CLI[@]}" agents create "${NAME}" --runtime opencode --size large --json --dev 2>>/tmp/create.err)"; then
        ID="$(printf '%s' "${CREATE_JSON}" | node -e \
          'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).id)')"
      fi
      [ -n "${ID}" ] && break
      echo "create attempt ${attempt} failed; stderr so far:" >&2
      cat /tmp/create.err >&2 || true
      sleep 15
    done
    [ -n "${ID}" ] || { echo "create returned no id after 6 attempts"; cat /tmp/create.err >&2; exit 1; }
    echo "created ${NAME} id=${ID}"

    "${CLI[@]}" agents wait "${ID}" --state RUNNING --timeout 180 --interval 5 --dev

    step "chat 1/2 (fresh session)"
    "${CLI[@]}" agents chat "${ID}" "Reply with exactly: CI_OK" --timeout 120 --json --dev > /tmp/chat1.json
    SESSION_ID="$(node -e '
      const j = JSON.parse(require("fs").readFileSync("/tmp/chat1.json", "utf8"));
      if (typeof j.session_id !== "string" || j.session_id.length === 0) throw new Error("session_id missing");
      if (!j.session || j.session.id !== j.session_id) throw new Error("session.id !== session_id");
      if (j.session.resumed !== false) throw new Error("fresh chat must report session.resumed === false");
      process.stdout.write(j.session_id);
    ')"
    echo "session ${SESSION_ID} (resumed=false)"

    step "chat 2/2 (resume with -s)"
    "${CLI[@]}" agents chat "${ID}" "ping" -s "${SESSION_ID}" --timeout 120 --json --dev > /tmp/chat2.json
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
      --prompt "Create the file ${FLAG} containing exactly ${TOKEN}" --name "${NAME}" --json --dev > /tmp/routine.json
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
      if got="$("${CLI[@]}" routines get "${RID}" --json --dev 2>/dev/null | node -e '
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
      if "${CLI[@]}" agents exec "${ID}" --dev -- cat "${FLAG}" 2>/dev/null | grep -qF "${TOKEN}"; then
        echo "flag ok: ${FLAG} contains ${TOKEN}"
        break
      fi
      [ "$(date +%s)" -lt "${deadline}" ] || { echo "flag file ${FLAG} never contained ${TOKEN}"; exit 1; }
      sleep 15
    done
    ;;

  jobs/gpus)
    step "jobs gpus (catalog; count varies on dev)"
    "${CLI[@]}" jobs gpus --dev | grep -q 'GPU_TYPE'
    "${CLI[@]}" jobs gpus --json --dev | grep -qF '"gpuType"'
    ;;

  jobs/list|jobs/ls)
    step "jobs ${SUB} (table + json)"
    "${CLI[@]}" jobs "${SUB}" --dev | grep -q 'ID'
    "${CLI[@]}" jobs "${SUB}" --json --dev | grep -qF '['
    ;;

  jobs/get|jobs/logs)
    step "jobs ${SUB} (unknown-id resolution + usage)"
    assert_fail 1 "no job in 'hyper jobs list'" -- jobs "${SUB}" "${NOID}"
    assert_fail 2 "usage: hyper jobs ${SUB}" -- jobs "${SUB}"
    ;;

  jobs/create)
    step "jobs create (dry-run positive + usage negatives)"
    out="$("${CLI[@]}" jobs create --image alpine --dry-run --dev -- echo hi 2>&1)"
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
    step "jobs exec (unknown-id negative; --dev before --)"
    assert_fail 1 "no job in 'hyper jobs list'" -- jobs exec "${NOID}" -- echo hi
    ;;

  flow/list)
    step "flow list (table + json)"
    "${CLI[@]}" flow list --dev | grep -q 'TYPE'
    "${CLI[@]}" flow list --json --dev | grep -qF '['
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
    out="$("${CLI[@]}" flow create text-to-image --prompt "ci smoke" --dry-run --dev 2>&1)"
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
    "${CLI[@]}" voice tts "${VOICE_TEXT}" --out "${VOICE_AUDIO}" --json --dev > "${VOICE_TTS_JSON}"
    node -e '
      const fs = require("fs");
      const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const audio = process.argv[2];
      if (record.out !== audio) throw new Error(`tts out mismatch: ${record.out} !== ${audio}`);
      if (!Number.isInteger(record.bytes) || record.bytes <= 0) throw new Error(`tts bytes invalid: ${record.bytes}`);
      if (fs.statSync(audio).size <= 0) throw new Error("tts audio file is empty");
      console.log(`tts json ok: ${record.bytes} bytes`);
    ' "${VOICE_TTS_JSON}" "${VOICE_AUDIO}"

    if ! "${CLI[@]}" voice transcribe "${VOICE_AUDIO}" --rest --language en --json --dev > "${VOICE_TRANSCRIBE_JSON}" 2>/tmp/hypercli-voice-transcribe.err; then
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
