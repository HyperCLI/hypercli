# BUZZ.md — HyperCLI × Buzz integration

Everything we've learned about how Buzz discovers, launches, and renders
agents, how the copied Buzz ACP plugin is used by `hyper-acp`, how our provider
works, and the design options for remote-terminal / local-surface features.

Audience: anyone touching `hyper-acp/plugins/buzz-acp/`,
`buzz-backend-provider/`, or the desktop app's Buzz surfaces. Read this before
editing any of them.

---

## 1. Active ACP layout

Hosted Buzz launches no longer run the old top-level `buzz-acp` fork or its
observer websocket. The active container command is `/usr/local/bin/hyper-acp`.
`hyper-acp` connects outbound to the platform ACP websocket named by
`HYPER_ACP_WS_URL`, forwards raw ACP JSON-RPC frames, and uses
`HYPER_ACP_AGENT_COMMAND=/usr/local/lib/hyper-acp/plugins/buzz-acp` to run the
copied Buzz ACP plugin.

Source locations:

- Canonical ACP copy: `hyper-acp/`, sourced from
  `agentclientprotocol/agent-client-protocol`; see `hyper-acp/PROVENANCE.md`.
- Buzz plugin copy: `hyper-acp/plugins/buzz-acp/`, sourced from
  `~/dev/buzz-git/crates/buzz-acp`; see
  `hyper-acp/plugins/buzz-acp/PROVENANCE.md`.
- HyperCLI launcher/transport wrapper: `hyper-acp/crates/hyper-acp/`.
- Slack relay plugin: `hyper-acp/plugins/slack-relay/`.

The old observer websocket used an inbound listener env and bespoke
auth/replay marker frames. That route is not the hosted platform scheduling
path. SDK/provider launch code intentionally scrubs the legacy inbound listener
env from hosted Buzz launches and sets `HYPER_ACP_WS_URL` instead.

### The exit-2 production crash (resolved)

- **Symptom:** hosted opencode pods crash-looped ~1s after `agent_pool_ready`,
  exit code 2, no useful k8s termination message.
- **Root cause:** `93612ffd`'s fail-closed check. Launch config carried bare
  `coding-anthropic`; the ACP catalog advertises `hypercli/coding-anthropic`.
  Mismatch → intentional `exit(2)`. Silent because the fork's fatal log goes to
  **stdout** while k8s `terminationMessage` reads **stderr**.
- **Fix:** `d8837b45` (`BUZZ_MODEL_PREFIX`) + image rebuild with the prefix
  env baked. **Not** OOM (10Gi, Burstable), **not** an upstream bug.
- **Upstream behavior:** upstream never exits 2 — a model miss warns, emits
  `control_result {type: switch_model, status: unsupported_model}`, and
  continues on the agent default (soft-fail, locked in by `50a71137e`'s test).
  Our fail-closed stance for launch-config models is a deliberate divergence.

### Upstream drift (as of 2026-08-24, `origin/main @ 0e69b3fd7`)

23 upstream commits touch `crates/buzz-acp` since the pin. Assessment:

- **Cheap ports worth taking:** `934f3325c` (prompt-only workspace-scan fix,
  3 lines), `025425591` (restores missing turn-end log + delivery receipts on
  a `run_prompt_task` race), `5b3f0375a` (4-line Goose prompt fix).
- **Conditional:** `4da7264d9` (observer telemetry pacing, +1188, touches
  `relay.rs` we modified), `dc2dbfe0f` (idle re-sleep for lazy pools).
- **Strategic vendor decision, not cherry-picks:** `50a71137e` (rewrites
  `create_session_and_apply_model` — `ModelSwitchOutcome`, `control_result`
  frames, requestId echo — the exact region where `93612ffd` inserted
  `exit(2)`; porting requires manually re-placing our fail-closed guard) and
  `563e4346d` (session-context reduction).
- **Skip:** add+revert pairs (`ad538bfb1`/`6a17d035f`,
  `54f11219e`/`08eb46ef3`), NIP-AM usage backend (`5e4c05f90`), prompt churn.
- **Rebase hot spots (changed on both sides):** `acp.rs`, `pool.rs`,
  `config.rs`, `lib.rs`, `relay.rs`. **Clean (upstream-only):** `base_prompt.md`,
  `queue.rs`, `usage.rs` — take verbatim on next vendor.

---

## 2. How Buzz providers work

Source: `~/dev/buzz-git/desktop/src-tauri/src/managed_agents/backend.rs`.

### Discovery — filename only, never executed

`discover_provider_candidates()` (`backend.rs:593`) scans three places for
executables named `buzz-backend-*`:

1. Every dir on `PATH` (GUI apps get a minimal launchd PATH, so…)
2. The app bundle's `Contents/MacOS/` (bundled providers)
3. `~/.local/bin` (user-installed providers)

The part after `buzz-backend-` is the **provider id** (e.g.
`buzz-backend-hypercli-opencode` → id `hypercli-opencode`, shown as a
"Run on" choice). Discovery never runs the binary — filename + executable bit.

`resolve_provider_binary()` (`backend.rs:650`) is the only execution path: it
validates the id against `^[a-z0-9][a-z0-9_-]*$` and only resolves ids that
were discovered in the scan — a compromised frontend can't steer execution to
an arbitrary binary.

### Protocol — one-shot JSON over stdin/stdout, two ops

`invoke_provider()` (`backend.rs:75`): spawn, write **one JSON line to stdin,
close stdin**, read stdout until one JSON object parses. That's the entire
transport. The provider cannot hold a stream — no logs, no attach, no shell.

`provider_deploy()` (`backend.rs:509`) sends exactly two requests, both against
the same staged copy of the binary (staged + hashed first for TOCTOU safety):

```json
{"op":"info","request_id":"…"}
→ {"ok":true,"name":"HyperCLI","version":"…","protocol_version":1,
   "description":"…","config_schema":{ … }}

{"op":"deploy","request_id":"…","agent":{ … },"provider_config":{ … }}
→ {"agent_id":"<uuid>"}
```

Deploy gets a **600s timeout** — the provider is expected to provision *and
wait until running*. After it answers, the process exits and is **never
invoked again**. The agent connects to the relay itself; Buzz talks to it over
Nostr like any agent and stamps `backend.type = Provider{id, config}`.

### The `agent` payload (what the provider receives)

Deserialized on our side as `BuzzAgentPayload`
(`buzz-backend-provider/src/lib.rs:48`):

| Field | Meaning |
|---|---|
| `name` | Display name |
| `relay_url` | Relay/community the agent joins |
| `private_key_nsec` | **The agent's Nostr identity** — the secret Buzz's dialog warns about. Unique per agent. |
| `auth_tag` | Optional auth tag |
| `agent_command` / `agent_args` | What to run *inside* the pod (e.g. `/usr/local/bin/opencode acp`) |
| `system_prompt`, `model` | Persona + model |
| `parallelism` | 1–32 |
| `respond_to` / `respond_to_allowlist` | Access policy |
| `env_vars`, `channels` | Extra env + channel subscriptions |

`provider_config` is validated by Buzz (`validate_provider_config`,
`backend.rs:536`): ≤20 fields, ≤64KB, scalar values only, and any key that
*looks* secret (`secret|password|token|key|credential`, split on separators
and camelCase) is rejected.

### The `config_schema` drives the "Run on" dialog — and its gate

The desktop renders `config_schema.properties` as form fields
(`desktop/src/features/agents/ui/ProviderConfigFields.tsx`) and enables the
submit button only when every key in `config_schema.required` is non-empty
(`whereToRunIntent.ts:47-57` `providerConfigComplete`). Empty `properties` →
no fields rendered, nothing to gate.

**Our fix (2026-08-24):** we removed the `api_base` field from our schema
(`properties: {}`). It *looked* required (the renderer only badges `required`
keys with `*`, everything else has no "Optional" marker), and it was redundant:
`buzz-backend-provider/src/main.rs:47` already calls
`discover_client_config()` — which reads `~/.hypercli/config` and `HYPERCLI_*`
env — and only overrides when `api_base` is explicitly present. The field
still works as an undocumented deploy-time override for dev/self-hosted
control planes (`provider_api_base_from_options`); it's just no longer
advertised. All 60 provider tests updated and green.

### What the provider protocol cannot do

- No `stop`, `status`, `logs`, `exec`, `shell` ops. Ever.
- No long-lived anything — stdin is closed after one line.
- Therefore: **a PTY cannot live in the provider.** Adding an op on our side
  is a no-op until Buzz's frontend learns to call it.

---

## 3. How Buzz harnesses work

Source: `~/dev/buzz-git/desktop/src-tauri/src/managed_agents/`.

### The catalog — three tiers, nothing else makes a harness "exist"

`discover_acp_runtimes_from()` (`discovery.rs:1274`) builds the list the UI
shows. Three tiers:

| Tier | Source | Members | Shape |
|---|---|---|---|
| **Builtin** | compiled-in `KNOWN_ACP_RUNTIMES` (`discovery.rs:86`) | goose, claude, codex, buzz-agent | Rich `KnownAcpRuntime`: commands, aliases, auth-probe args, install hints, model/provider/effort env keys, skill dir |
| **Preset** | compiled-in `PRESET_HARNESSES` (`presets.rs`) | opencode, kimi, grok, amp, hermes, openclaw | Thin `PresetHarness{id, label, command, args, install_hint}` |
| **Custom** | `*.json` in `custom_harnesses_dir` (`custom_harnesses.rs:49`) | anything you add | Thinnest `HarnessDefinition{id, label, command, args, env}` — no recompile, no Buzz edit |

**codex/claude/opencode are not special.** They're vanilla ACP harnesses that
exist in the UI purely because they're registered. The **Custom tier is the
open door**: drop a JSON file and your harness appears in the same dropdown,
spawns the same way, gets `backend.type = local` → the full local surface.

### Availability — PATH resolution (and the nvm gotcha)

A harness is `Available` iff its `command` resolves
(`resolve_command_uncached`, `discovery.rs:706`): workspace → buzz-managed →
`PATH` env → **login shell** (`find_via_login_shell`, cached) → common binary
dirs (`~/.local/bin`, mise/volta/asdf/bun shims, homebrew) → **nvm fallback**
(`find_nvm_default_bin`, `login_shell.rs:183`).

The nvm fallback reads `~/.nvm/alias/default` (one alias hop), else the
highest-semver dir under `~/.nvm/versions/node/`. **Known failure:** a
bare-major alias (`default = "22"`) matches neither a literal `v22/…` dir nor
an `alias/22` file — Buzz reports "OpenCode (not installed)" while nvm happily
runs it. This is an upstream Buzz limitation; workaround is a full-version
alias or a `~/.local/bin` symlink.

**Create gate:** `AgentDefinitionDialog.tsx:492-500` requires
`selectedRuntimeIsAvailable` in create mode — **even for remote provider
runs.** The harness gate doesn't care what "Run on" says.

### Spawn — Buzz launches a child and forgets its stdio

`runtime.rs:523`:

```rust
command.stdin(Stdio::null());               // Buzz can't type into the agent
command.stdout(Stdio::from(log_file));      // output → log file
command.stderr(Stdio::from(log_file));
command.env("BUZZ_PRIVATE_KEY", &record.private_key_nsec);  // per-agent identity
command.env("BUZZ_RELAY_URL", …);
command.env("BUZZ_ACP_RELAY_OBSERVER", "true");   // activity feed on
command.env("BUZZ_ACP_AGENT_COMMAND", …);  // what the harness spawns next
// …plus LAZY_POOL, AGENTS, SYSTEM_PROMPT, MODEL, EFFORT_LEVEL, AUTH_TAG,
// team instructions, and the HarnessDefinition.env layer
```

**Buzz does not speak ACP to the agent.** The harness (buzz-acp) spawns the
real agent itself, holds the ACP stdio privately, connects to the relay, and
publishes observer events. Buzz's only control over the child is `kill(pid)`
— start/stop. A `runtime_pid` record lets Buzz re-adopt a still-running child
across app restarts (ownership proven by the `BUZZ_MANAGED_AGENT` marker env,
`lifecycle.rs:35-50`).

### The activity feed is relay events, not the local process

The Runtime tab's "Thinking / Ran `buzz messages send…` / Replied" rows come
from `observerRelayStore` — relay observer events the agent publishes
(`BUZZ_ACP_RELAY_OBSERVER=true`). **This is why remote provider agents show
activity too** (verified with goose-buzz): the feed never touches the local
process.

### The Buzz terminal is a local shell — never the agent

`terminal_runtime.rs:410-448`: Buzz opens a PTY running **your login shell**
(`resolve_shell($SHELL)`) with context env injected (`channel_id`, `npub`,
`relay_url`, `session_id`) so you can drive the relay with the `buzz` CLI.
It's a convenience shell *for the user*, works identically for local and
remote agents, and has **no relationship to any agent's process**. There is no
"agent console" in Buzz to preserve or lose.

### ACP `terminal/*` is agent→client, not a user shell

ACP's terminal methods (`terminal/create`, `/output`, `/kill`,
`/wait_for_exit`, `/release`) let the **agent subprocess** ask its **client**
(buzz-acp) to run terminals on the agent's behalf. buzz-acp's
`build_client_capabilities()` (`buzz-acp/src/acp.rs:560`) advertises
`auth.terminal` for terminal-native login flows — again agent-facing. There is
no ACP method where a *user* requests a shell into the runtime.

### Effort control is local-only by design

Spawn-scoped only: buzz-acp reads `BUZZ_ACP_EFFORT_LEVEL` once at session
creation (`apply_startup_effort`, `buzz-acp/src/pool.rs`). The desktop's
effort write-control renders only for `backend.type === "local"`; remote
effort is set at deploy time via env. Live mid-conversation effort switching
was deliberately removed upstream (archived on
`archive/claude-config-gaps-live-effort`).

---

## 4. Our provider: `buzz-backend-hypercli`

Crate: `~/dev/hypercli/buzz-backend-provider`. Protocol v1, ops `info` +
`deploy` only.

**Deploy behavior** (`src/lib.rs`):

- Derives the agent pubkey from `private_key_nsec`, computes a **deterministic
  handle** → idempotent lookup: an existing deployment with the same handle is
  reconciled/restarted instead of duplicated (dry-run never takes this path).
- Picks the largest available size from live capacity; applies **size-based
  parallelism defaults only when `BUZZ_ACP_AGENTS` isn't explicitly set** —
  any concrete Buzz value (including 1) is authoritative.
- Waits for the deployment to reach RUNNING (bounded timeout) before
  answering, since Buzz's deploy timeout expects provision+ready.
- `api_base` optional (see §2 schema fix); defaults to the installed HyperCLI
  config. `hypercli/` model prefix is applied image-side via
  `BUZZ_MODEL_PREFIX`, not here.

**Install surface (our desktop app):** the provider ships as a Tauri sidecar
(`externalBin: ["binaries/buzz-backend-hypercli"]` in the base
`tauri.conf.json`; the release workflow stages
`binaries/buzz-backend-hypercli-<target-triple>`). The `providers.rs` module
(`desktop/src-tauri/src/providers.rs`) exposes
`provider_status` / `install_providers` / `uninstall_providers`:

- Installs one real binary `~/.local/bin/buzz-backend-hypercli` via
  **stream-copy** (never `fs::copy` — that would clone
  `com.apple.quarantine` and Gatekeeper would kill it when Buzz spawns it),
  atomic temp-file rename, `xattr -d com.apple.quarantine` best-effort.
- Six runtime identities as **relative symlinks** beside it:
  `buzz-backend-hypercli-{buzz-agent,opencode,codex,claude,goose,kimi}`
  (copies on Windows). Buzz discovers each as a separate "Run on" choice.
- Settings UI shows installed/missing/broken pills + Install/Reinstall/
  Uninstall.

**Release:** `.github/workflows/release-buzz-provider.yml` builds per-platform
tarballs on `buzz-provider-v<version>` tags. Independent of SDK publishes.

---

## 5. The proposed `hypercli-bridge` (custom harness)

**Goal:** make a remote HyperCLI agent present to Buzz as a **local** agent —
full local surface (activity feed, model picker, effort control, local
chrome) — while the compute stays in the pod.

**Why a custom harness and not the provider:**

| | Provider (`buzz-backend-*`) | Custom harness |
|---|---|---|
| Lifetime | one-shot: `info` + `deploy`, exits | long-lived child, lives with the agent |
| `backend.type` | `Provider` | `Local` (the default) |
| Local surface | activity feed only | **full local surface** |
| Relay connection | lives in the pod | lives **on the host** (Buzz spawns it) |
| Agent survives laptop-off | **yes** | **no** — goes offline until bridge reconnects |

**Shape:** a `HarnessDefinition` JSON in Buzz's `custom_harnesses_dir`:

```json
{
  "id": "hypercli",
  "label": "HyperCLI (remote)",
  "command": "hypercli-bridge",
  "args": [],
  "env": {}
}
```

`hypercli-bridge` is a **buzz-acp-shaped** process (it must be — Buzz spawns
it with `stdin=null` and expects it to be relay-autonomous). Instead of
spawning a local agent subprocess, it attaches to the remote pod's agent
session over the control-plane websocket. Everything else — relay observer,
dedup, queue, effort env — is the same code path as buzz-acp.

**Agent selection needs zero config:** Buzz injects `BUZZ_PRIVATE_KEY` (the
agent's unique nsec) at spawn. The bridge derives the pubkey → deterministic
handle → resolves the pod, exactly like the provider's idempotent lookup.
Reconnects on wake; the pod-side session survives bridge restarts
(`session/load`).

**What the bridge does NOT give you:** a remote terminal. Buzz's terminal is
a local shell by construction (§3) — the bridge buys you local *chrome*, at
the cost of the laptop-on requirement. It is a UX-parity play, not a
remote-shell play.

**Do we need both provider and bridge?** Only if you want both behaviors
per-agent: 24/7 always-on agents (provider) *and* interactively-driven agents
with the full local surface (bridge). They share the control plane, pod
images, and the pubkey→handle resolution; the bridge is effectively the
provider's "attach" half without the "provision" half.

---

## 6. The real remote shell: `hypercli shell` (proposed)

The only thing that puts a shell *inside the remote pod* is the HyperCLI
control plane — the same websocket the web dashboard's Shell tab uses:

1. `POST /agents/deployments/{id}/shell/token` → `{jwt, ws_url, shell}`
2. Connect to `ws_url?jwt=…&shell=…` → bidirectional binary frames (stdin /
   stdout / resize), interactive PTY in the pod.

**Proposal:** `hypercli shell <agent>` in the Rust CLI — plain interactive
passthrough (`kubectl exec -it` style), **not** a TUI: no alternate screen,
no ratatui, stdin/stdout wired straight through, resize forwarded. Works from
any terminal, independent of laptop state (it's a websocket to the pod, not a
local process holding the agent up). The menubar app can later embed the same
transport as a Shell panel.

This is the terminal feature Buzz structurally cannot offer for remote
agents: its own terminal is host-local, and the provider protocol has no
streaming op.

---

## 7. Our desktop app (`hypercli-menubar`)

Crate: `~/dev/hypercli/desktop/src-tauri` (Tauri 2 + React 19,
`desktop/src/`). A menubar tray app for managing hosted agents — the native
counterpart to the web dashboard.

### Window model — one popup + one routed panel window

- **Tray icon** (`TRAY_ID = "hypercli-tray"`, `init_tray`, `lib.rs:895`)
  toggles the **popup**: the main agent list (`App.tsx`), anchored under the
  tray icon (`show_popup`/`hide_popup`).
- **Panel window**: a single auxiliary window (`show_panel_window`,
  `lib.rs:759`) shared by every secondary view. It is **never** a second
  window — interior navigation is the `panel-navigate` event:
  - `new` → `CreateWindow` (create agent)
  - `connections` → `SettingsWindow` (Buzz provider install + connections)
  - `edit:<agentId>` → `EditWindow` (edit stopped agent)
- `main.tsx` routes on the Tauri window label: `panel` → `PanelWindow`,
  anything else → `App` (the popup).

### Auth — browser login → deep link → scoped machine key

1. `start_login` opens `https://agents.hypercli.com/desktop-login` in the
   browser (its allowlist accepts the `hypercli://auth` callback — token in
   the URL fragment, no server round-trip).
2. The OS delivers `hypercli://auth#token=…` back via
   `tauri_plugin_deep_link`; the app percent-decodes the token.
3. `mint_api_key` exchanges it for a **scoped desktop machine key** —
   capabilities `["agents:*", "models:*", "user:self"]`
   (`DESKTOP_KEY_SCOPES`), annotated with OS + hostname
   (`key_annotation`). Agent management is the primary surface; the single
   model grant powers the prompt-drafting helper without making the desktop
   key an unrestricted inference key.
4. `save_api_key` persists it through the SDK's config
   (`discover_client_config` — `~/.hypercli/config` + `HYPERCLI_*` env, same
   discovery the provider and CLI use). `logout` removes the keys;
   `validate_key` reports capability + plan status for the UI.

### Agent lifecycle

`list_agents` maps each deployment to a `LauncherAgent` (state, runtime,
`is_buzz`, `can_start`/`can_stop`, archived flag, cpu/memory claims and pod
burst limits for the load bars). Row actions: start / stop / archive /
delete (**two-click confirm**) / avatar upload (`set_agent_avatar`).

Two creation paths:

- **OpenClaw** (`create_agent`): name (auto-generated if blank), size,
  `desktop` flag (OpenClaw Pro).
- **Buzz** (`buzz_launch::create_buzz_agent`, `buzz_launch.rs`): the rich
  form — runtime (buzz-agent, opencode, claude-code, codex, goose,
  kimi-code), instructions, model, concurrency (1–32), connection, channels,
  respond_to (anyone / owner-only / allowlist). Flow:
  1. Validate (name ≤32 chars, instructions size cap, concurrency range).
  2. **Resolve the model against the live gateway catalog**
     (`resolve_launch_model_blocking` → `GET /v1/models`) — a model that
     isn't served is rejected, never silently substituted.
  3. Build the launch via the SDK's `BuzzLaunchConfig.apply_to`
     (`rs-sdk/src/types.rs:473`): sets the runtime's buzz image, command
     `/usr/local/bin/hyper-acp`, agent command/args per runtime, injects
     `BUZZ_PRIVATE_KEY`/`NOSTR_PRIVATE_KEY` as secrets, `BUZZ_RELAY_URL` +
     `BUZZ_ACP_*` env, clears routes, `sync_root=/home/node`,
     `restart=false` (owner-signed `!shutdown` must not resurrect),
     marks the deployment as Buzz-managed, tags channels.
  4. `create_deployment` then `wait_for_stopped` — **CREATE only
     provisions**; the runtime stays stopped until the Buzz profile and the
     local ownership record are installed. The start path later reads
     `stored_launch_config` (the backend's redacted projection) and calls
     `start_deployment`.
  5. The create window's "Draft for me" button calls `draft_agent_prompt`
     (the scoped `models:*` grant) to draft instructions from keywords.

### Buzz connections

A connection = label + relay URL + owner nsec. Metadata lives in a local
JSON document; the **nsec lives in the OS keychain** — service
`com.hypercli.desktop.buzz-owner`, account `buzz-owner/{id}`
(`buzz_connections.rs:22`). `list_buzz_channels` queries the relay for
channels the owner can see. The Settings UI adds/removes connections; the
create window listens for `buzz-connections-changed` and refreshes on focus.

### Provider install (Settings → "Buzz provider")

The UI over `providers.rs` (§4): status pills per runtime identity
(installed / missing / broken-symlink), Install/Reinstall/Uninstall, plus an
App-Translocation warning on macOS (a quarantined download running from a
randomized mount — install still works, but the app should be moved to
Applications).

### Edit agent (stopped agents only)

`agent_edit.rs` — `get_agent_edit_config` reads the deployment's stored
launch-config projection and surfaces name, size, and (for Buzz runtimes)
`BUZZ_ACP_MODEL`, `BUZZ_ACP_SYSTEM_PROMPT`, `BUZZ_ACP_AGENTS`.
`update_agent` **requires the agent stopped** (backend contract for
launch-affecting edits), swaps the edited env keys into the stored map, and
PATCHes the **full projection** back via `update_deployment` — untouched
settings are preserved exactly; blanking the model removes the key (reset
to default). UI: `EditWindow` via the `edit:<agentId>` panel view, with a
"stop it first" banner when the agent isn't stopped.

### Metrics + LoadBar

`agent_metrics` per running agent, polled every **2s** and **focus-gated**
(pauses when the popup isn't focused; refreshes immediately on focus).
Each LoadBar is `icon+label | bar | readout`:

- Real limit reported → bar fill is true utilization, readout is `%`.
- No limit → fill scales against a **fallback ceiling** (4 cores / 8 GiB)
  and the readout shows the **absolute value** (`1.3` GB / `0.1` cores) —
  never a fake percent of a made-up limit.

### Release + signing

- Base `tauri.conf.json` bundles the provider sidecar
  (`externalBin: ["binaries/buzz-backend-hypercli"]`); every build — dev
  included — carries it (staged locally as
  `binaries/buzz-backend-hypercli-<target-triple>`, gitignored).
- `desktop/scripts/build-release-config.mjs` emits the release-only overlay
  `tauri.release.conf.json`: updater (pubkey from
  `HYPERCLI_UPDATER_PUBLIC_KEY`, endpoint = `latest.json` on the rolling
  `desktop-latest` GitHub release), `createUpdaterArtifacts`, macOS 10.15
  floor. Delta fields only — Tauri's `--config` merges over the base.
- `release-desktop.yml` gates on the **cross-repo** Buzz E2E — the latest
  "Build & Push Images" run on main in the platform's agent-image CI must
  be green (the old phantom "Desktop Buzz E2E" check never existed).
- macOS builds run `--no-sign`; a self-hosted sign job then **rcodesigns**
  the bundle (sidecar included) with the Developer ID PEM from the
  `apple-cert` Pulumi stack, notarizes with the ASC key when present, and
  re-signs the updater tarball with the Tauri key from the `tauri-key`
  Pulumi stack.

**Keychain popup gotcha:** local `npm run tauri build` output is
**adhoc-signed** (`Signature=adhoc`, no Team ID). macOS keychain ACLs grant
persistent access per stable code signature, so an adhoc build re-prompts
on **every** read of `com.hypercli.desktop.buzz-owner`. Signed release
builds keep "Always Allow" — the popup storm is a local-build artifact, not
a code bug.

---

## 8. Quick reference — key source locations

**Buzz (upstream, `~/dev/buzz-git`):**

- Provider discovery/protocol: `desktop/src-tauri/src/managed_agents/backend.rs`
  (`invoke_provider:75`, `provider_deploy:509`, `discover_provider_candidates:593`,
  `resolve_provider_binary:650`, `validate_provider_config:536`)
- Harness catalog: `…/discovery.rs` (`KNOWN_ACP_RUNTIMES:86`,
  `discover_acp_runtimes_from:1274`, `resolve_command_uncached:706`),
  `…/discovery/presets.rs`, `…/custom_harnesses.rs:49`
- nvm resolution: `…/discovery/login_shell.rs` (`find_via_login_shell:58`,
  `find_nvm_default_bin:183`)
- Spawn: `…/runtime.rs:523` (env at 533-779); lifecycle/adoption:
  `…/runtime/lifecycle.rs`
- Terminal (local shell): `…/terminal_runtime.rs:410-448`
- BackendKind: `…/types.rs:6`
- Dialog gating: `desktop/src/features/agents/ui/whereToRunIntent.ts:47`,
  `ProviderConfigFields.tsx`, `AgentDefinitionDialog.tsx:492-509`

**Ours (`~/dev/hypercli`):**

- ACP host and Buzz plugin: `hyper-acp/`, with copied Buzz source under
  `hyper-acp/plugins/buzz-acp/` and provenance in
  `hyper-acp/plugins/buzz-acp/PROVENANCE.md`
- Provider: `buzz-backend-provider/` (payload `src/lib.rs:48`, info schema
  `:306`, deploy `:327`, client config `src/main.rs:47`)
- Install UI: `desktop/src-tauri/src/providers.rs`,
  `desktop/src/SettingsWindow.tsx`
- Edit-agent surface: `desktop/src-tauri/src/agent_edit.rs`
  (`get_agent_edit_config` / `update_agent`, stopped-agents only, full
  launch-config replacement via `update_deployment`)

**Disconnect semantics (both models):**

- Provider agent: host-off → **keeps running** (relay connection lives in the
  pod). Buzz terminal unaffected (it's your Mac's shell anyway).
- Bridge agent: host-off → **goes offline** (relay connection lives on the
  host). Pod session survives; bridge reconnects on wake.
