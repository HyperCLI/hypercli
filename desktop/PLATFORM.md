# PLATFORM.md — Hosted Buzz Agent Platform

How HyperCLI's hosted buzz agent images are built, launched, and verified in
CI. Companion to `BUZZ.md` (relay protocol + desktop2 integration). Audited
against the hosted platform contract and `~/dev/hypercli` (`hyper-acp`,
Buzz plugin, buzz-backend-provider, desktop e2e).

---

## 1. Image architecture (hypercli-agent-images/buzz)

No single "buzz image" — a shared base plus six provider images:

| Runtime | Image | ACP child (`BUZZ_ACP_AGENT_COMMAND` [+ ARGS]) | Auth model |
|---|---|---|---|
| `buzz-agent` | `hypercli-buzz-agent` | `/usr/local/bin/buzz-agent` (MCP `buzz-dev-mcp`) | hosted HyperCLI inference (zero-login) |
| `opencode` | `hypercli-buzz-opencode` | `/usr/local/bin/opencode acp` | seeded HyperCLI provider (zero-login) |
| `goose` | `hypercli-buzz-goose` | `/usr/local/bin/goose acp` | seeded HyperCLI provider (zero-login) |
| `codex` | `hypercli-buzz-codex` | `/usr/local/bin/codex-acp` | native Codex key/device login |
| `claude-code` | `hypercli-buzz-claude` | `/usr/local/bin/claude-agent-acp` | native Claude subscription/Console/SSO |
| `kimi-code` | `hypercli-buzz-kimi-code` | `/usr/local/bin/kimi acp` | native Moonshot OAuth |

Base image (`buzz/base/Dockerfile`): `node:24-bookworm-slim`; builds
- `sprig` multicall (→ `buzz`, `buzz-dev-mcp`) from upstream `block/buzz` at
  the exact source commit recorded in `hypercli/hyper-acp/plugins/buzz-acp/PROVENANCE.md`
  (currently `8342dfcc…`, tag `desktop-v0.5.5`);
- `hyper-acp` from `HyperCLI/hypercli.git`, including the copied Buzz plugin
  binary under `/usr/local/lib/hyper-acp/plugins/buzz-acp`, at a caller-supplied
  40-hex `HYPERCLI_REF`.

Common: USER `node`, WORKDIR `/home/node`, no EXPOSE (outbound-only), tini +
per-runtime entrypoint, `CMD ["sleep","infinity"]`; hosted launch overrides the
command with `/usr/local/bin/hyper-acp`. Full HyperCLI source at `/opt/hypercli`
with the `hyper` CLI pip-installed; nest dirs/skills seeded by
`hypercli-buzz-init` (only-if-missing, mode 0700) under `/home/node/.buzz`.

Entrypoint chain (hosted launch):
```
tini → hypercli-buzz-<runtime>-entrypoint → hypercli-buzz-init
     → (per-runtime settings mgmt) → hypercli-buzz-entrypoint
     → exec "$@" → /usr/local/bin/hyper-acp → ACP child (lazy if BUZZ_ACP_LAZY_POOL)
```

Per-runtime entrypoint extras:
- `buzz-agent`: defaults `BUZZ_AGENT_PROVIDER=anthropic`,
  `BUZZ_AGENT_MODEL=kimi-k2.6-anthropic`, `ANTHROPIC_BASE_URL=$HYPER_API_BASE`
  (hard fail if unset), `ANTHROPIC_API_KEY=$HYPER_AGENTS_API_KEY`. Guards are
  `[ -z "${VAR+x}" ]` — explicit empty launch values win.
- `claude-code`: `HYPERCLI_RUNTIME_INFERENCE` = `native` (default) | `hypercli`
  | anything else → exit 2. `hypercli` writes an owned 3-key model catalog;
  `native` removes stale generated catalogs. No secrets on disk.
- `opencode`/`goose`: seed provider configs reading `HYPER_AGENTS_API_KEY` at
  runtime. `codex`: passthrough (`NO_BROWSER=1`). `kimi-code`: seeds tui.toml.

## 2. Runtime auth (two distinct mechanisms)

1. **Hosted ACP runtime injection** (in the Buzz plugin,
   `hyper-acp/plugins/buzz-acp/src/acp.rs`):
   only when `HYPERCLI_RUNTIME_INFERENCE=hypercli` exactly AND
   `HYPER_AGENTS_API_KEY`+`HYPER_API_BASE` non-empty, buzz-acp injects
   per-runtime inference env **in-memory at child spawn** (Claude:
   `ANTHROPIC_*` all-or-nothing; Codex: `CODEX_CONFIG` hypercli provider
   overlay; Kimi: `KIMI_MODEL_*`). Never persisted.
2. **Runtime auth wrappers** (`/usr/local/bin/hypercli-runtime-auth` →
   per-runtime `runtime-auth.sh`): `status|login|logout` for claude/codex/kimi
   for remote exec/PTY sessions; login happens inside the pod so credentials
   persist in the sync-backed home. `status` always exits 0 with one JSON
   object; kimi status is O_NOFOLLOW/mode-checked and never prints content.

`HYPER_AGENTS_API_KEY` is **injected by Lagoon at pod-spec time**, never by the
provider/launcher, and is stripped if a client submits it.

## 3. Launch contract (what desktop2 must supply)

Backend is buzz-agnostic: runtime is just an enum value; image/command/env/
secrets are client-supplied. Rules that ARE server-side:
- launch config keys limited to `image, env, secrets, routes, command,
  entrypoint, restart, sync_root, sync_include|sync_exclude, sync_uid/gid,
  registry_url, registry_auth, runtime_scopes`; unknown keys rejected.
- env/secrets: ≤256 entries, ≤64 KiB values, env∩secrets = ∅.
- **START is a complete replacement** — missing keys → 422.
- size: default `small`; resolved against plan `AGENT_SIZE_PRESETS`; resize of
  running agent → 409. **No server-side `large` enforcement for buzz.**

The buzz launch payload the CI pins (provider/e2e golden contract):
- `image = ghcr.io/hypercli/hypercli-buzz-<runtime>:<tag>`,
  `command = ["/usr/local/bin/hyper-acp"]`, `restart = false`,
  `sync_root = /home/node`, `sync_uid/gid = 1000`, `routes = {}`,
  `runtime_scopes = ["agents:none","files:*","flows:*","models:*","voice:*","web:*","workspaces:*"]`
- **secrets**: `BUZZ_PRIVATE_KEY`, `NOSTR_PRIVATE_KEY` (agent nsec — never env)
- **env**: `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG` (NIP-OA; `BUZZ_ACP_AGENT_OWNER`
  must be absent when auth tag present), `BUZZ_ACP_AGENT_COMMAND/ARGS`,
  `BUZZ_ACP_MCP_COMMAND` (buzz-agent/codex only), `BUZZ_ACP_LAZY_POOL=true`,
  `BUZZ_ACP_RELAY_OBSERVER=true`, `BUZZ_ACP_AGENTS` (2/5/10 for
  small/medium/large), `BUZZ_ACP_MULTIPLE_EVENT_HANDLING=steer`,
  `BUZZ_ACP_DEDUP=queue`, `BUZZ_ACP_RESPOND_TO` (+`_ALLOWLIST`),
  `BUZZ_ACP_DISPLAY_NAME` + `BUZZ_ACP_TEXT_MENTIONS=true` when name-safe,
  `BUZZ_ACP_REQUIRE_REPLY=true`, `BUZZ_ACP_MODEL`, `BUZZ_ACP_SYSTEM_PROMPT`,
  `BUZZ_ACP_SESSION_TITLE`, `HYPER_WORKSPACES_BOOT_SYNC/DIR/SYNC_READY_ONLY`
- **tags**: `app=buzz`, `buzz_agent=<agent_pubkey_hex>`,
  `buzz_channel=<id>` per channel (desktop), `buzz_launch=<sha256>`
  fingerprint (provider, for idempotent reconcile)
- vendor secrets (`ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, …) must NOT appear
  in env.

Owner proof precedence everywhere: `BUZZ_AUTH_TAG` > `BUZZ_ACP_AGENT_OWNER`;
provider fails `MissingOwner` if neither.

## 4. Channel-response gating (the "nuked" features)

Three independent layers, all launcher-controlled:

1. **Subscription scope** — `BUZZ_ACP_SUBSCRIBE`: `mentions` (default, `#p`
   filter on agent pubkey) | `all` | `config` (per-channel TOML rules).
   `BUZZ_ACP_CHANNELS`, `BUZZ_ACP_KINDS`, `BUZZ_ACP_NO_MENTION_FILTER`
   refine. **For channel-wide responses set `BUZZ_ACP_SUBSCRIBE=all`** — no
   image/provider default does this.
2. **Mention matching** — structured `p`-tag primary;
   `BUZZ_ACP_TEXT_MENTIONS=true` + valid `BUZZ_ACP_DISPLAY_NAME` adds
   case-insensitive textual `@name` (fork re-add; routing only, does not
   weaken the author gate).
3. **Author gate** — `BUZZ_ACP_RESPOND_TO`: `owner-only` (default) |
   `allowlist` | `anyone` | `nobody` (harness accepts `nobody`; the provider
   binary rejects it). Owner + same-owner sibling agents pass via NIP-OA
   proof. **With no resolvable owner and `owner-only`, ALL events are
   dropped** — always ship `BUZZ_AUTH_TAG`.

**Reply publication**: upstream removed auto-publishing; ACP streamed text is
observer telemetry only — the agent must explicitly `buzz messages send` /
`buzz reactions add`. The fork's reply guard: if a turn ends with no publish
and `BUZZ_ACP_REQUIRE_REPLY=true`, buzz-acp injects the nag in-session ≤ 2
times (`BUZZ_ACP_MAX_REPLY_NAGS`, constants in `rs-sdk/src/types.rs:377-383`),
then accepts silence. `!shutdown` (owner-signed, agent-mentioned kind 9) is
terminal — `restart:false` means the pod exits for good.

## 5. Relay-side agent lifecycle (launcher duties)

Order matters (see BUZZ.md §5): create deployment → wait `stopped` → publish
agent-signed **kind 0** profile (with auth tag) via NIP-98 `POST /events` +
`x-auth-tag` → owner-signed **kind 9000** enrollment (role bot) per channel →
start. On failure: stop + `DELETE` + **kind 9001** removals. Channel
discovery: NIP-98 `POST /query` kinds 39002 (`#p`=owner) → 39000 (`#d`=ids).
Presence is kind **20001** (ephemeral, WS-only) with relay-synthesized kind
**40902** snapshots for queries.

## 6. CI contract (two suites exercise the live dev relay)

### A. Platform agent-image CI `hypercli-buzz-acp` job
Matrix over all 6 runtimes; runs `tests/smoke/test_buzz_provider_hypercli_e2e.py`
and `tests/smoke/test_buzz_provider_live_smoke.py` in the smoke image with
host-built `buzz-backend-hypercli` plus image-extracted `hyper-acp`, `buzz`,
and the internal Buzz plugin binary bind-mounted in. Recipe:
1. Paid smoke user via `BACKEND_API_KEY` bootstrap, plan `pro`.
2. Agent key minted with pinned `nak key generate` (raw hex); owner attestation
   via the image-extracted auth-tag helper (owner nsec on stdin).
3. Enroll: `buzz channels add-member --channel <id> --pubkey <agent> --role bot`;
   profile via `buzz users set-profile`.
4. `{"op":"deploy"}` to the provider binary (protocol v1; `info` first).
5. Asserts: full launch_config (§3), secrets not env, size = largest free tier
   (large→medium→small, one slot consumed), idempotent re-deploy (same
   agent_id, same launch_config, no extra slot).
6. In-pod exec assertions (PID-1 child, nest layout, per-runtime
   `auth-methods --json` sets, `hypercli-runtime-auth` wrappers).
7. Relay round-trip for reply-capable runtimes (buzz-agent/opencode/goose):
   presence online ≤ 60 s; owner mention → non-empty reply ≤ 60 s.
8. Shutdown: `!shutdown` retried every 20 s until `stopped`; slot release
   verified. Timeouts: gateway 300 s, pytest 900 s.

CI config (names only): secrets `BACKEND_API_KEY`, `BUZZ_DEV_E2E_NSEC`,
`GITEA_REGISTRY_*`, `GHCR_*`; Actions vars `BUZZ_DEV_E2E_PUBKEY`,
`BUZZ_DEV_E2E_RELAY_URL` (= `wss://dev.buzz.hypercli.com`, not in the repo),
`BUZZ_DEV_E2E_CHANNEL_ID`; literal `BUZZ_DEV_E2E_CHANNEL_NAME=CI`,
`HYPERCLAW_SMOKE_BUZZ_PLAN_ID=pro`.

Unselected-but-valid coverage (not in any workflow):
`tests/smoke/test_coding_agent_image_e2e.py` (direct `POST /deployments`
launch, `RUNTIME_SIZE="large"`), `test_coding_agent_inference_e2e.py`
(Anthropic tool-call preservation), `buzz_owner_shutdown_check.sh` +
`tests/fixtures/buzz_owner_shutdown.py` (hermetic kind-9 `!shutdown` gate).

### B. hypercli `desktop-buzz-e2e.yml` (the UI-driven gate)
Builds desktop debug binary + `buzz-backend-hypercli` sidecar, then on a
self-hosted runner (`desktop/e2e-tests/run-buzz-e2e.mjs` via
`npm run test:buzz`):
1. Bootstrap isolated paid user (`bootstrap_agents_e2e_user.py`, plan `pro`,
   1 h entitlement, state file, flock-serialized; always-cleanup).
2. Real app under tauri-driver/xvfb/gnome-keyring; session token via admin
   login, delivered by `hypercli://auth#token=…` deep link.
3. Types the owner nsec (`BUZZ_DEV_E2E_NSEC`, secret) into the native
   connection form; selects the private `#CI` channel; creates a `buzz-agent`
   agent **through the real UI**.
4. Polls `list_agents` → `running` (≤ 12 min); asserts 64-hex agent pubkey,
   `app=buzz` tag, owner ≠ agent key.
5. Relay assertions over the NIP-98 HTTP bridge (kind 27235, `u`/`method`/
   `payload`-sha256/`nonce` tags): kind **40902** presence `online` ≤ 60 s →
   owner kind **9** mention (`h`+`p` tags) `POST /events` accepted →
   non-empty agent kind 9 reply in `#h` ≤ 60 s.
6. Cleanup: stop+delete via the app, REST DELETE fallback (409 retried 3 min),
   `remove_buzz_connection` (keychain erased).

Also in that repo: `desktop/e2e-tests/run-e2e.mjs` (`npm test`) — auth +
"Install providers" gate asserting all 7 `buzz-backend-*` names resolve to the
bundled sidecar; no relay.

## 7. desktop2 deltas to implement (from the audits)

- Set nsec → keychain (`com.hypercli.desktop.buzz-owner`), mint per-agent
  keypair, compute NIP-OA in-process (`build_owner_attestation`,
  `desktop/src-tauri/src/buzz_connections.rs:561-589`) — never shell out,
  never log.
- Permissions UI maps to `BUZZ_ACP_RESPOND_TO` + allowlist +
  `BUZZ_ACP_SUBSCRIBE` (+ `BUZZ_ACP_TEXT_MENTIONS`/`DISPLAY_NAME`).
- Fix the start payload drift (BUZZ.md §6.1) — full replacement config.
- Size: largest-available tier with 429 fallback (provider behavior), or
  explicit; don't hardcode.
- Wire `BUZZ_ACP_REQUIRE_REPLY=true` and decide `BUZZ_ACP_SUBSCRIBE=all`
  exposure for channel-wide responses (the re-added features).
