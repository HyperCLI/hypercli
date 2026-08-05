# HyperCLI Desktop + Buzz provider — build and state of play

Written 2026-08-05. Everything below is verified against source or live
traffic; where something is unverified it says so.

## What the pieces are

| component | repo path | ships as |
|---|---|---|
| Desktop app (Tauri v2) | `hypercli/desktop` | `HyperCLI.app`, NSIS `.exe`, AppImage/deb |
| Buzz backend provider | `hypercli/buzz-backend-provider` | `buzz-backend-hypercli` binary — released standalone **and** bundled in the app as a Tauri sidecar |
| Hosted Buzz ACP | `hypercli/buzz-acp` | Cargo package `hypercli-buzz-acp`, installed executable `buzz-acp` inside the runtime images |
| Rust SDK | `hypercli/rs-sdk` | `hypercli-sdk` crate, used by both |
| Agent images | `hyperclaw-backend/hypercli-agent-images/buzz/*` | `ghcr.io/hypercli/hypercli-buzz-{agent,goose,opencode,codex,claude,kimi-code}` |

The desktop app's only jobs: authenticate (API key or browser sign-in), and
install the provider binary where Buzz Desktop will find it.

## How the app is built

```bash
# 1. build the provider and stage it as the sidecar (per target triple)
cargo build --release --locked -p buzz-backend-hypercli
mkdir -p desktop/src-tauri/binaries
cp target/release/buzz-backend-hypercli \
   desktop/src-tauri/binaries/buzz-backend-hypercli-$(rustc -vV | sed -n 's/host: //p')

# 2. build the app
cd desktop/src-tauri && cargo tauri build --bundles app
```

`binaries/` is **gitignored and hand-populated**. That is the single most
dangerous thing about this build — see "Stale sidecar" below.

CI (`.github/workflows/release-desktop.yml`) does step 1 from source on every
release, so published builds are always current. Local builds are not.

Version lives in **two** files that must agree (the release workflow
validates both): `desktop/src-tauri/tauri.conf.json` and
`desktop/src-tauri/Cargo.toml`.

Release: dispatch **Release Desktop** with `version` + `publish_release`.
Builds on GitHub-hosted runners (macOS both arches, Windows, Linux), then a
self-hosted Linux job signs the macOS apps with `rcodesign` using a Developer
ID cert pulled from the `hypercli-apple-cert` Pulumi stack, rebuilds the
updater tarballs from the *signed* app and re-signs them with the Tauri
updater key (`hypercli-tauri-key` stack), then publishes `desktop-v<version>`
plus the rolling `desktop-latest` feed that installed apps poll every 6h.

## Issues hit so far, and their state

### 1. Install used to point into the app bundle — FIXED (0.1.1)
Symlinks in `~/.local/bin` pointed at the binary inside `HyperCLI.app`. A
downloaded (quarantined) app runs from a macOS App Translocation mount that
is destroyed on quit, so every provider name dangled the moment the app
closed: our UI said "not installed", Buzz silently dropped the providers.

Now: one real binary is **copied** to `~/.local/bin/hypercli-configure`
(streamed, not `fs::copy` — that clones `com.apple.quarantine` on macOS and
Gatekeeper would kill the binary when Buzz exec'd it), with the seven
`buzz-backend-hypercli*` names as relative symlinks beside it. Dangling
leftovers are reported as `broken` rather than `missing`.

### 2. Stale sidecar — the recurring foot-gun
A locally built app bundles whatever happens to be in `binaries/`. A binary
copied there once in the morning shipped in every local rebuild for a day,
including a release, and "Install providers" faithfully copied it onto disk.
Symptom: the installed provider rejected launch commands that current source
accepts. Diagnosis method that works: replay a captured deploy request
against both binaries and compare.

**Not yet fixed:** the build should fail when `binaries/` is missing or older
than the provider source. Until then, always rebuild the sidecar before
building the app.

### 3. Notarization — unblocked 2026-08-05, first run in flight
Releases up to and including 0.1.1 are Developer-ID **signed but not
notarized** (the org's ASC provider record was still provisioning), so users
get one Gatekeeper "Open Anyway" prompt. App Store Connect came through and
the API key is now stored, so the release workflow's notarize branch fires
on its own — no code change was needed.

**Where every signing secret lives.** Nothing is on disk; both are Pulumi
stacks with an S3 backend, read in CI via `pulumi stack output --show-secrets`
and passed to `rcodesign` through process substitution (`<(printf '%s' "$VAR")`)
so no secret ever lands in the runner's filesystem — gilfoyle's `/tmp` is a
graveyard of old CI runs.

```bash
export AWS_PROFILE=linode-se
export PULUMI_CONFIG_PASSPHRASE_FILE=~/.pulumi/hypercli
```

| stack | repo | outputs |
|---|---|---|
| `hypercli-apple-cert/prod` | `HyperCLI/hypercli-apple-cert-pulumi` (private) | `developer-id-application-private-key-pem`, `-cert-pem`, `-bundle-pem` (key+cert for `rcodesign --pem-file`), `asc-api-key-p8`, `asc-key-id`, `asc-issuer-id` |
| `hypercli-tauri-key/prod` | `HyperCLI/hypercli-tauri-key-pulumi` (private) | minisign updater keypair + its password (`tauri_app_`-prefixed, generated in-stack) |

Team `J5AHS7QWMA`, cert `Developer ID Application: HyperCLI, Inc.`, expires
2031-08-05. Regenerating the CSR is `pulumi up` in the cert repo; the issued
cert is pasted back into stack **config** and re-exported so stack refs get
both halves.

**CI already has what it needs** — these repo secrets are set on
`HyperCLI/hypercli`, so no manual step is required at release time:

| secret | holds |
|---|---|
| `PULUMI_APPLE_CERT_STACK` | `org/project/stack` for the cert stack |
| `PULUMI_APPLE_AWS_PROFILE` | AWS profile for the Pulumi S3 backend |
| `PULUMI_APPLE_PASSPHRASE_FILE` | passphrase file path on the runner |
| `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` | minisign updater key |
| `HYPERCLI_UPDATER_PUBLIC_KEY` | baked into the app at build time |

Note the shape: the three `PULUMI_APPLE_*` secrets are only *pointers*. The
Developer ID cert, its private key, and the ASC API key are never GitHub
secrets — the signing job reads them live from the stack, so rotating a
credential means `pulumi up`, not touching repo settings.

**Scraping the status of a live submission.** `rcodesign notarize --wait`
gives up after 600s; that is a timeout, **not** a rejection. The submission
is still queued at Apple and you re-query it out of band. From gilfoyle
(where `rcodesign` lives at `~/.local/bin`, and a non-interactive ssh gets
neither it nor `pulumi` on `PATH`):

```bash
ssh ubuntu@gilfoyle 'export PATH=$HOME/.local/bin:$HOME/.pulumi/bin:$PATH \
  AWS_PROFILE=linode-se PULUMI_CONFIG_PASSPHRASE_FILE=$HOME/.pulumi/hypercli
W=$(mktemp -d); printf "name: hypercli-apple-cert\nruntime: python\n" > $W/Pulumi.yaml
cd $W && pulumi stack output asc-api-key-p8 -s prod --show-secrets > $W/key.p8
rcodesign encode-app-store-connect-api-key -o $W/api.json \
  "$(pulumi stack output asc-issuer-id -s prod)" \
  "$(pulumi stack output asc-key-id -s prod)" $W/key.p8
rcodesign notary-list --api-key-file $W/api.json    # id, timestamp, state
rm -rf $W'
```

`notary-list` prints one line per submission — uuid, UTC timestamp, name,
state. For a single submission use `rcodesign notary-wait <uuid>`, and once
it reads `Accepted`, `rcodesign staple <path>`.

Status as of the latest 2026-08-05 check: two `app.zip` submissions
(`44c65d3c-abc6-43ee-9fe8-ae3b629883c9` at 02:37:57Z and
`de7a2cba-011a-40b6-9062-f41054ec120c` at 02:35:29Z) are **`in progress`** —
remain **`in progress`**. This is simply longer than the 600s the tool waits;
signing itself took ~2s. Neither has failed. Continue polling `notary-list`;
if either changes to rejected, fetch `notary-log <uuid>` immediately.

Bare binaries (the standalone provider) can be signed and notarized but
**cannot be stapled** — only bundles and disk images carry a stapled ticket,
so a notarized loose binary still needs an online Gatekeeper check.

### 4. Provider launch contract drift — PARTIALLY FIXED, the big one
Buzz Desktop expresses model choice vendor-neutrally (`provider`, `model`)
and translates it into whatever env the *selected harness* reads. Every
harness reads a different dialect, and `hypercli` is not a provider id any of
them know except goose. Nothing upstream validates it: Buzz's readiness check
passes unknown provider ids straight through.

Verified per-runtime contract (source-cited, one agent per runtime):

| runtime | how it takes provider/model | status |
|---|---|---|
| **buzz-agent** | `BUZZ_AGENT_PROVIDER` ∈ {anthropic, openai, openai-compat, databricks, databricks_v2, openrouter}; Anthropic route needs `ANTHROPIC_BASE_URL` (**no `/v1`** — it appends `/v1/messages`) | **fixed in provider**: non-native id → `anthropic`, base URL forced |
| **goose** | image ships a declarative provider literally named `hypercli` (`custom_providers/hypercli.json`, anthropic engine, `HYPER_AGENTS_API_KEY`) | **fixed**: fill `GOOSE_PROVIDER=hypercli` only when absent, never clobber |
| **opencode** | config file only (`~/.config/opencode/opencode.json`, baked); models are named `<provider>/<model>` | **fixed**: qualify bare `BUZZ_ACP_MODEL` → `hypercli/<model>` so the switch stops silently no-op'ing |
| **claude-code** | `claude-agent-acp` inherits `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_MODEL` | **ACP runtime injection**: generated at each child spawn; image persists only a non-secret `settings.json` model catalog |
| **kimi-code** | pinned Kimi 0.31 synthesizes an in-memory provider from native `KIMI_MODEL_*` env and strips it from config write paths | **ACP runtime injection**: live HyperCLI inference is testable without a pre-seeded Kimi login |
| **codex** | `codex-acp` forwards a `CODEX_CONFIG` overlay with `model_providers.<id>.base_url` and `env_key` | **config fixed, inference blocked**: codex ≥0.146 requires `wire_api = "responses"`; our gateway serves Anthropic Messages and chat-completions |

Upstream login behavior is not uniform. Claude and Codex are built-ins with
local auth probes (`claude auth status`, `codex login status`), while Kimi is a
PATH-only preset marked auth `NotApplicable`. Provider deploy does not run the
local spawn/readiness setup-mode path, so hosted inference can be configured
inside the container. `hypercli-buzz-acp` now derives runtime-native child env
from Lagoon's inherited `HYPER_API_BASE` + `HYPER_AGENTS_API_KEY` immediately
before every lazy spawn/respawn. It never persists the key and never mixes with
an explicit native runtime env. Set `HYPERCLI_RUNTIME_INFERENCE=native` to use a
synced vendor login/config instead. Kimi 0.31 can therefore join live CI;
Claude and Codex retain native login for vendor-specific features, and Codex
still cannot infer through HyperCLI until the gateway serves Responses.

Provider-level translation for Buzz Agent, Goose, and OpenCode lives in
`apply_hypercli_inference_defaults` (`buzz-backend-provider/src/lib.rs`),
applied **after** the launch-block merge so it reaches the path Buzz actually
uses. Claude, Codex, and Kimi translation lives at the ACP child-spawn boundary
in `buzz-acp/src/acp.rs`, so it is re-applied on every lazy spawn and respawn.
Covered by runtime matrix tests plus the golden contract test
(`tests/protocol.rs` + `tests/fixtures/buzz-launch-contract.json`), which now
pins the injected keys per runtime — if the wire shape changes again, that
test fails rather than shipping silently.

Two structural notes:

* The per-runtime env block used to live in the legacy `else` branch, so it
  never ran on the launch-block path Buzz actually uses — the Goose special
  case had been dead code.
* Buzz's harness command set is open-ended, but hosted dispatch must remain
  fail-closed. Silently mapping an unknown custom harness onto a different
  image executes a runtime the user did not select. Until provider capability
  filtering exists upstream, unsupported hosted harnesses should fail with a
  clear error.

### 5. Providers cannot advertise harnesses — upstream
Buzz 0.5.4 validates a provider's `info` response against a closed six-field
allowlist and **rejects unknown fields**, so adding `harnesses` breaks every
deploy. `config_schema` *is* rendered in the create dialog, but as free-text
inputs only (`enum` is ignored), so no dropdown. Fixing mismatches properly
needs a small upstream change: allowlist `harnesses`, add it to the probe
type, filter the harness dropdown per provider.

### 6. Slot selection and real provider CI — IMPLEMENTED LOCALLY, CI PENDING

New provider launches no longer hard-code `large`. The provider reads the
capacity returned with the deterministic-handle lookup and chooses the largest
currently available entitlement slot (`large`, then `medium`, then `small`).
It still reuses an existing deployment before considering capacity. If create
loses a slot race with HTTP 429, it refreshes inventory and may retry an
unattempted lower tier. Unit coverage pins that fallback.

The backend provider smoke is being upgraded from a refused loopback relay to
the real hosted path. For each live-supported runtime (Buzz Agent, OpenCode,
Goose), it provisions a routed relay fixture, invokes the exact provider
binary with `provider_config: {}`, waits for the provider-created image to
subscribe, publishes an owner-signed kind-9 question, requires a non-empty
agent reply within 60 seconds, then publishes owner-signed `!shutdown` and
checks the deployment stops. This exercises both `buzz-backend-hypercli` and
the HyperCLI-owned `buzz-acp`; it is not considered verified until the backend
CI job passes against the candidate images.

HyperCLI now owns only the hosted ACP delta as the top-level
`hypercli/buzz-acp` package. Its Buzz crate dependencies share one exact,
documented unmodified upstream commit. The container builds upstream Sprig
for `buzz`, `buzz-agent`, and `buzz-dev-mcp`, but builds the real `buzz-acp`
binary from HyperCLI. The full Buzz application fork/submodule is no longer a
runtime-image dependency.

Every newly created provider deployment now carries `app=buzz` plus its
existing `buzz_agent=<public-key>` identity tag. Existing deployments are
still recognized by the identity tag, so this is backward compatible.
Provider reconciliation derives the same public key from the request nsec and
uses the identity tag as a second fence after the deterministic handle; it
never selects by display name or list order. New deployments also carry a
non-secret launch fingerprint. An identical running deploy is idempotent, a
changed running deploy fails until shutdown, and a stopped deployment can be
replaced when its runtime or launch contract changed.
Concurrency remains user-authoritative: if Buzz sends `BUZZ_ACP_AGENTS`, even
as `1`, the provider preserves it. Only a genuinely absent value receives the
resolved tier default: 2 on small (2 GB), 5 on medium (4 GB), and 10 on large
(8 GB), based on roughly 300 MB per harness process.

### 7. Authenticated agent fleet UI — IMPLEMENTED LOCALLY

After login, HyperCLI Desktop lists the account's saved deployments through
the Rust SDK. The default filter is Buzz-only; an All segment exposes the rest
of the account. New `app=buzz` and legacy `buzz_agent=<public-key>` tags both
qualify. The UI never receives launch configuration, pod IDs, or credentials.

Actions are fail-closed from a fresh backend state read: stopped agents may be
started or deleted; running agents may be stopped or restarted; failed,
restore-failed, and sync-failed agents may be restarted; transitional and
unknown states do not expose destructive actions. Restart of a running agent
requests stop, waits up to 60 seconds for `stopped`, then starts from the
stored launch contract. Delete is confirmed in the UI and rejected by the
Tauri command unless the fresh state is exactly `stopped`.

## Gotchas worth knowing

* **Silent failures everywhere.** An unmatched model makes buzz-acp warn once
  and run the harness default; a missing base URL sends our key to the
  vendor's cloud. A "RUNNING" deployment proves the pod booted, nothing more —
  `BUZZ_ACP_LAZY_POOL=true` means the harness may not even spawn until work
  arrives.
* **Vanilla Buzz cannot currently surface hosted restart after `!shutdown`.**
  The keyed record keeps its provider, provider path, and `backend_agent_id`,
  but Desktop derives its primary action from the permanent `deployed` status
  instead of offline presence. Delete removes that keyed instance and leaves
  the definition; Play on the remaining definition silently defaults to local
  because `Run on` is available only during brand-new creation. HyperCLI's
  provider can restart the exact identity, but current vanilla Buzz does not
  make that call reachable. Leave this as an upstream lifecycle/UI issue; do
  not mutate Buzz's local store from the provider.
* **`HYPER_AGENTS_API_KEY` is injected by lagoon at pod-spec time**, not by
  the provider — it cannot appear in `request.env`. Runtime-native key mapping
  therefore lives in `hypercli-buzz-acp` at the child-spawn boundary, where it
  also applies to lazy starts and respawns without persisting a secret.
* **Image entrypoints guard defaults with `[ -z "${VAR+x}" ]`** (only if
  unset). Buzz always sets the provider var, so those defaults never fire —
  that is the entire buzz-agent failure.
* Docs bug: `docs/agents/integrations.mdx` says `api.hypercli.com` where the
  agents API is `api.agents.hypercli.com`, and tells Claude Code users to set
  `OPENAI_BASE_URL` (it reads `ANTHROPIC_BASE_URL`).

## Debugging recipes that actually worked

### Sniffing what Buzz actually launches (the key seam)

Buzz invokes the provider as a **one-shot subprocess with the JSON request on
stdin** and reads one JSON response from stdout. That makes the provider
binary itself the interception point: replace the discovered
`buzz-backend-hypercli*` name with a shim that tees stdin to a file and execs
the real binary. Buzz cannot tell the difference, and you get the verbatim
payload — `launch.command`, `launch.env`, `provider_config`, everything.

```bash
REAL="$HOME/.local/bin/hypercli-configure"      # the real copy the app installs
for n in ~/.local/bin/buzz-backend-hypercli*; do
  rm -f "$n"                                    # remove FIRST — see gotcha
  printf '#!/bin/bash\ntee -a /tmp/buzz-provider-capture.jsonl | exec "%s" "$@"\n' \
    "$REAL" > "$n"
  chmod +x "$n"
done
```

**Gotcha that cost real time:** those names are symlinks to the shared
binary. Writing a heredoc directly to one *follows the link* and overwrites
the real binary. Always `rm` the name before writing the shim, and keep a
backup copy of the binary first.

Then hit launch in Buzz and read the capture:

```bash
python3 -c "
import json
for l in open('/tmp/buzz-provider-capture.jsonl'):
    d=json.loads(l)
    if d.get('op')!='deploy': continue
    a=d['agent']; L=a.get('launch') or {}
    print(a['name'], '|', L.get('command'), '|', json.dumps(L.get('env')))
"
```

This capture showed that the tested records all resolved to
`launch.command=buzz-agent` with `BUZZ_AGENT_PROVIDER=hypercli`. It does not
prove a global override: current Buzz resolves explicit launch pin, then the
record runtime, then a legacy persona runtime, then Buzz Agent. The capture is
therefore evidence of stale or mis-materialized records, not evidence that
`preferred_runtime` overrides per-agent harnesses.

### Replaying a captured request (no deploy, no side effects)

```bash
# --dry-run validates the launch shape and never enters the
# lookup/restart path, so it cannot touch an existing deployment.
./target/release/buzz-backend-hypercli --dry-run < request.json
```

Replay is also the way to compare **binaries**: run the same captured request
against the installed binary and a fresh build. That is how the stale-sidecar
bug was caught — identical input, `{"error":"Buzz launch command is
unsupported"}` from one and `{"ok":true}` from the other.

Because the dry-run still calls the API, the request it built is recorded in
the HTTP trace — which is how you verify what env the provider *would* send
without deploying anything.

# Provider HTTP trace (set HYPER_HTTP_TRACE_FILE in ~/.hypercli/config):
#   ~/.hypercli/logs/buzz-backend-hypercli.jsonl   — redacted JSONL, one line per call

# Local Buzz agent logs and config:
#   ~/Library/Application Support/xyz.block.buzz.app/agents/logs/<agent-pubkey>__<session>.log
#   ~/Library/Application Support/xyz.block.buzz.app/agents/{managed-agents,global-agent-config}.json
```

`global-agent-config.json` holds `preferred_runtime`, which selects the default
shown for new configuration. It does not override an existing record runtime.
When named Goose/OpenCode agents all launch `buzz-agent`, inspect each record's
materialized runtime and the persona fallback before blaming the global value.
