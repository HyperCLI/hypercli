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
gives up after 600s; that is a timeout, **not** a rejection. The Desktop
release workflow treats that exact timeout as `pending`, records both
submissions in its `desktop-notarization-submissions` workflow artifact, and
continues with Developer-ID-signed but unstapled archives. Any other non-zero
notary result is still fatal. The submission remains queued at Apple and you
re-query it out of band. From gilfoyle
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
| **claude-code** | `claude-agent-acp` uses the synced native Claude login by default; it inherits `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_MODEL` only in explicit HyperCLI compatibility mode | **native-first**; HyperCLI injection requires `HYPERCLI_RUNTIME_INFERENCE=hypercli` |
| **kimi-code** | pinned Kimi 0.31 uses its synced native login/config by default; compatibility mode synthesizes an in-memory provider from `KIMI_MODEL_*` env | **native-first**; HyperCLI injection requires `HYPERCLI_RUNTIME_INFERENCE=hypercli` |
| **codex** | `codex-acp` uses its synced native login by default; compatibility mode forwards a `CODEX_CONFIG` overlay with `model_providers.<id>.base_url` and `env_key` | **native-first; HyperCLI inference blocked**: codex ≥0.146 requires `wire_api = "responses"`; our gateway serves Anthropic Messages and chat-completions |

Upstream login behavior is not uniform. Claude and Codex are built-ins with
local auth probes (`claude auth status`, `codex login status`), while Kimi is a
PATH-only preset marked auth `NotApplicable`. Provider deploy does not run the
local spawn/readiness setup-mode path, so hosted inference can be configured
inside the container. Claude, Codex, and Kimi now default to their synced
native vendor login/config. Only the exact opt-in
`HYPERCLI_RUNTIME_INFERENCE=hypercli` makes `hypercli-buzz-acp` derive a child
environment from Lagoon's inherited `HYPER_API_BASE` +
`HYPER_AGENTS_API_KEY` before each lazy spawn/respawn. It never persists the
key and never mixes with explicit native runtime env. Codex still cannot infer
through HyperCLI until the gateway serves Responses.

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

### 6. Slot selection and real provider CI — IMPLEMENTED AND VERIFIED

New provider launches no longer hard-code `large`. The provider reads the
capacity returned with the deterministic-handle lookup and chooses the largest
currently available entitlement slot (`large`, then `medium`, then `small`).
It still reuses an existing deployment before considering capacity. If create
loses a slot race with HTTP 429, it refreshes inventory and may retry an
unattempted lower tier. Unit coverage pins that fallback.

The backend provider smoke now uses the private shared dev `#CI` relay and
invokes the exact one-shot provider binary against immutable candidate images.
Buzz Agent, OpenCode, Goose, and Kimi must subscribe and return a non-empty
reply within 60 seconds; Codex and Claude validate their native auth/config
surfaces without pretending unsupported inference works. Every case publishes
owner-signed `!shutdown`, verifies the slot is released, and removes its
deployment and Nostr identity. Backend candidate `c3da7fdd` passed all six
runtime-image lanes, all six provider lanes, and the dynamic-route lifecycle;
the six exact tested image digests were then promoted to `:latest`.

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

## HyperCLI-native Buzz launcher/editor — implemented locally, release pending

HyperCLI Desktop now has a second, first-party path in addition to installing
the provider for vanilla Buzz. It can save a Buzz connection (canonical relay
plus owner nsec in the OS keychain), discover the owner's visible channels,
create a fresh agent identity, enroll it as a bot, and create the matching
HyperCLI deployment directly through `rs-sdk`. Vanilla Buzz remains unchanged
and continues to use the one-shot provider executable.

Connection setup is a first-class dashboard surface, not an advanced field in
agent creation: **Buzz connections** opens a focused list/add/remove screen.
The nsec is entered only while adding a connection, moves immediately into the
system keychain, and is never rendered again. Create selects from those saved
identities; with none configured, it routes through connection setup first.
Every connection-add affordance is the same compact `+`, including the create/
editor section; opening it and returning preserves the in-progress agent form.

Private channel discovery follows upstream Buzz's authenticated HTTP bridge:
NIP-98-signed `POST /query` first requests kind 39002 with `#p=<owner>`, then
requests kind 39000 only for the returned `d` channel ids. A plain WebSocket
subscription can connect to a hosted community while returning none of its
private discovery state; do not switch this path back to raw `fetch_events`.
Relay metadata stores the channel name without presentation punctuation (for
example `ci`); the picker adds one leading `#`. Tests compare the normalized
name so relay storage and Buzz UI decoration cannot drift into a false miss.

The create screen collects name, a native image-picker avatar, instructions, runtime, best
available or explicit 2/4/8 GB size, one discovered channel, respond policy,
allowlist, optional model/concurrency, and additional environment. Automatic
concurrency is 2/5/10 for small/medium/large. Every deployment carries both
`app=buzz` and `buzz_agent=<canonical hex>` plus its channel tag. The editor
preserves the full stored launch envelope, mutates only owned fields, and
stop/PATCH/starts a running deployment. Runtime and Buzz connection are
immutable in-place; moving them is a future Clone/Move operation.
Legacy deployments with no recoverable `respond_to` value fail closed to
`owner` / **Only me** in the editor; the UI never renders or submits a blank
policy, and local validation explains the required choice before IPC.
The compact-app visual rule is deliberate: persistent cards represent agents;
task subpages, runtime login, SSH setup, and Buzz connection management use
flat fields and divided rows instead of nested cards. New agents require a
saved Buzz connection; existing identities keep their connection immutable
until a future explicit Clone/Move flow exists.
The hosted Buzz E2E bootstraps a unique dev user plus a one-hour `pro`
entitlement before opening Desktop, so largest-slot selection has deterministic
large capacity. Its `always()` cleanup removes both HyperClaw and Orchestra
user projections; the gate does not borrow slots from the shared test account.
Buzz display names are not backend deployment names. Both the provider and the
direct Desktop path use the SDK's `canonical_deployment_name` helper to derive
a lowercase DNS-safe slug with an eight-character Nostr identity suffix, while
the original name remains `BUZZ_ACP_DISPLAY_NAME` and the signed Buzz profile.
Fleet cards and the editor prefer that display value over the backend slug;
renames update the display field/profile and recanonicalize the backend name
with the existing Nostr suffix instead of sending the human name to DNS.
The same shared SDK `BuzzLaunchConfig` owns the default hosted image for each
coding runtime. Direct Desktop launches and provider launches therefore emit
the same `ghcr.io/hypercli/hypercli-buzz-*` image, while an explicit provider
image override still wins. Do not move this mapping back into either caller:
dev rejects a deployment without it as `Pod creation failed: image is required`.

Avatar bytes never enter launch env or relay events. The native picker rejects
symlinks, images over 2 MiB, and content whose magic is not PNG/JPEG/GIF/WebP,
then stages the bytes behind an opaque one-shot UUID. Save uploads them through
`POST /deployments/{id}/profile-image`; the one returned public URL becomes the
backend `avatar_url`, `BUZZ_PROFILE_PICTURE`, and the agent-signed kind-0
`picture`. Cancel discards the staged bytes. New deployments are created with
`start=false` and start only after avatar upload, launch-envelope update, Buzz
profile/enrollment, and local ownership metadata succeed.

Prompt drafting is a separate in-app step: the user supplies a short brief,
reviews/edits the generated text, then explicitly chooses **Use draft**. It
does not silently overwrite instructions. The editor window is 520 px wide,
the concurrency input has compact intrinsic height, and native login renders
`Connecting…` inside the visible auth card before the remote PTY/session call
can block for its 45-second connection timeout.

Allowlist nickname resolution deliberately matches upstream Buzz rather than
accepting every Nostr spelling: explicit values are valid `npub1...` or exact
64-character hex; nicknames are ASCII-case-insensitive exact matches of the
newest kind-0 `display_name` or `name` for a current member of every selected
channel. Partial rosters, missing matches, and ambiguity fail before relay or
backend mutation. Persisted allowlists contain canonical lowercase hex only.

### Relay publication identity contract

Do not submit an agent profile through the generic owner WebSocket publisher.
The profile is kind 0 signed by the agent, while 9000/9001 membership events
are signed by the owner. The relay rejects a signed event whose author differs
from the authenticated publishing identity.

Agent profiles use the exact upstream HTTP bridge contract:

1. POST the exact event JSON bytes to `{wss->https relay}/events`.
2. Build kind 27235 NIP-98 auth with the same agent key and tags for exact URL,
   `method=POST`, SHA-256 of those exact body bytes, and a fresh UUID nonce.
3. Send `Authorization: Nostr <base64 event>`, `Content-Type:
   application/json`, and the verified owner NIP-OA JSON as `x-auth-tag`.
4. Require both HTTP success and `accepted:true`.

Owner enrollment/removal stays owner-authenticated. Create and delete attempt
idempotent inverse events if a multi-event relay operation fails. A failed
local metadata write after deployment creation now stops/deletes the new
deployment and removes membership rather than leaking an orphan.

The shared dev-relay gate is serialized with cancellation disabled. Its
failure cleanup uses the authenticated deployment DELETE contract directly
with a three-minute bound, so `failed`/`error` agents (which the normal Desktop
UI correctly refuses to Stop) are still stopped and deleted by CI.

### Native auth and developer access hardening

The Rust SDK owns a fixed `/usr/local/bin/hypercli-runtime-auth` PTY session.
Webview input is restricted to one 1-2048-byte authorization token containing
only alphanumeric and `-._~+/=` characters; newlines, controls, and shell
syntax are rejected before I/O. Terminal errors cancel and remove the session,
and login URLs are displayed for an explicit user action rather than opened
automatically from untrusted terminal output. The UI handles an immediately
completed login without polling a nonexistent session and Enter sends the
login value without submitting the agent editor.

SSH generation returns only public material. The primary **Attach SSH key**
action opens a native single-file picker rooted at the local `~/.ssh`; it does
not blanket-copy that directory. Imports reject symlinks, unsafe permissions,
oversized/non-PEM input, upload to a fixed temporary path, derive the public key
noninteractively, and atomically install the canonical `~/.ssh/id_ed25519`;
traps remove invalid/encrypted temporary keys. An existing identity is not
overwritten implicitly.

Claude, Codex, and Kimi are native-login-first: absence of
`HYPERCLI_RUNTIME_INFERENCE` means no HyperCLI inference overlay. The exact
advanced opt-in is `HYPERCLI_RUNTIME_INFERENCE=hypercli`. Claude's optional
generated compatibility catalog and ownership marker are written through
private same-directory temporaries and atomic rename, so persisted symlinks or
hardlinks cannot redirect a write. Kimi keeps a pinned real-ACP compatibility
model-discovery test in addition to its unauthenticated native-default test.

### CI gates

`desktop-ci.yml` keeps the fast Rust, mocked Playwright, and real app/provider
installation checks. `desktop-buzz-e2e.yml` is a separate gate: `build-linux`
builds the real provider and Tauri app, uploads them, and the dependent
`dev-relay` job starts a Secret Service keyring, logs into the dev backend,
saves `BUZZ_DEV_E2E_NSEC`, discovers private `#CI`, launches a disposable Buzz
Agent, waits up to 12 minutes for backend RUNNING **and** up to 60 seconds for
the agent's relay `online` presence snapshot, sends a signed owner kind-9
question, requires a non-empty agent reply within 60 seconds, then stop/deletes
the deployment and erases its connection/keychain entry. Runs are non-cancelling
and serialized because they share one dev identity and channel. The nsec is an
existing GitHub secret and is never printed or passed in argv.

As of 2026-08-05 21:13 Europe/Moscow, local validation is green: 26 Desktop
Rust tests, 51 Rust SDK tests, 47 provider unit + 8 provider protocol tests,
and 28 mocked UI tests.
Real dev-relay run `31028721199` proved authenticated private discovery returned
the CI channel but timed out on the test's decorative-name comparison: relay
metadata is `ci`, while Buzz presents `#ci`. The UI now decorates the name and
the gate compares its normalized spelling. Run `31029815349` then correctly
exercised the new empty-state connection routing and exposed a stale assertion
that still waited for the agent editor before entering the nsec. The gate now
waits for the connection screen, saves the identity, and only then requires the
editor. Run `31032444451` then proved canonical backend naming and exposed the
next direct-launch seam: the SDK contract did not supply a container image, so
dev returned HTTP 500 with `Pod creation failed: image is required`. The image
mapping is now shared as described above. Run `31033168634` then proved dev
accepted the image and created the pod, but the E2E could not find its human
name because the fleet rendered the canonical backend slug. Display-name
projection is now corrected as described above. Do not cut 0.1.3 until the next
full gate reaches RUNNING, publishes online presence, receives the #CI reply,
and completes cleanup. Run `31033702545` reached RUNNING and accepted the owner
message but timed out waiting for a reply because the test used a fixed 10-second
delay rather than Buzz's actual readiness signal. It now waits for kind-40902
online presence exactly like the already-green provider E2E, and captures a
redacted persisted log tail before cleanup on any failure. Apple still reports
the existing notarization submissions as `in progress`, with no rejection log
available. Run `31034497508` validated that diagnostic path: the backend reached
RUNNING, but the persisted log showed `buzz-agent` rejecting the legacy
`--respond-to owner` spelling before relay startup. The current CLI contract is
`owner-only | allowlist | anyone | nobody`. Desktop now stores/emits
`owner-only`, reads legacy `owner` as `owner-only`, and the shared Rust SDK
canonicalizes the old alias at the final launch-env boundary. A regression test
pins the exact `BUZZ_ACP_RESPOND_TO=owner-only` wire value.
