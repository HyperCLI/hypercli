# BUZZ.md — Buzz Launcher Integration Guide

How desktop2 (hypercli-menubar) integrates with the HyperCLI backend and the
Buzz relay to launch hosted Buzz agents. Synthesized from audits of
`~/dev/hypercli` (ts-sdk / rs-sdk / sdk), `~/dev/hypercli-buzz-deploy`, and
`~/dev/buzz-git` (upstream `block/buzz` main + `hypercli/hypercli` fork branch).

---

## 1. Architecture overview

```
desktop2 (Tauri menubar)
  │  REST/WS, Bearer API key            wss, NIP-42 + NIP-OA
  ▼                                    ▼
HyperCLI backend (api.hypercli.com/agents)      Buzz relay (env.buzz.hypercli.com)
  │  launches deployment                       │  NIP-29 channels, kind 9 messages
  ▼                                            ▼
K8s pod: buzz image, /usr/local/bin/hyper-acp ──┘
  └─ spawns ACP harness subprocess (goose / claude / codex / opencode / kimi-code …)
```

- desktop2 talks to the HyperCLI backend **only through the Rust SDK**
  (`hypercli-sdk = { path = "../../rs-sdk" }`, `src-tauri/Cargo.toml:40`).
  There is no TS SDK or raw fetch usage.
- desktop2 talks to the Buzz relay directly (nostr WS + NIP-98 HTTP) for
  channel discovery, profile publish, and NIP-29 enrollment — see §5.
- The agent workload is the `buzz-acp` harness binary inside a
  `ghcr.io/hypercli/hypercli-buzz-*` image; it wraps an ACP agent subprocess.

## 2. Relay endpoints (from hypercli-buzz-deploy)

| env | relay WS | pairing WS | notes |
|---|---|---|---|
| internal | `wss://internal.buzz.hypercli.com` | `…/pair` | `:prod` image |
| dev | `wss://dev.buzz.hypercli.com` | `…/pair` | `:latest` CI image |
| community | `wss://community.buzz.hypercli.com` | `…/pair` | public-facing, `:prod` |

- traefik routes `Host(h) && PathPrefix(/pair)` → pairing-relay :5000, else
  relay :3000 (pulumi-buzz/relay.py:170-196). WS timeouts are infinite.
- Media: `https://<host>/media` (minio `buzz-media`).
- Relay env flags set in deployment (`pulumi-buzz/__main__.py:91-93`):
  `BUZZ_REQUIRE_AUTH_TOKEN=true`, `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`,
  `BUZZ_ALLOW_NIP_OA_AUTH=true` → **closed relay**: NIP-42 always, every caller
  must be a relay member (NIP-43) or present a valid NIP-OA attestation from a
  member owner.
- Relay/owner identities are minted by `scripts/generate-identities.sh`
  (`buzz-admin generate-key`) and live in Pulumi stack config on the deploy
  host — not in the repo. `RELAY_OWNER_PUBKEY` must be 64-hex lowercase;
  bech32 is silently ignored.

## 3. Relay protocol essentials (upstream buzz main)

- **WS endpoint**: single listener, `BUZZ_BIND_ADDR` default :3000
  (`crates/buzz-relay/src/config.rs:462`). Clients must dial the canonical host
  (tenant-bound by Host header).
- **NIP-42 auth is always required** for WS REQ/EVENT/COUNT: reply to
  `["AUTH","<challenge>"]` with kind **22242** (`challenge` + `relay` tags,
  ±60 s freshness) — `crates/buzz-auth/src/nip42.rs`.
- **HTTP bridge**: `POST /events`, `POST /query`, `POST /count` with NIP-98
  (kind **27235**) in `Authorization: Nostr <base64-event>`
  (`crates/buzz-acp/src/relay.rs:248-325`).
- **NIP-OA owner attestation** is the agent auth story (NOT NIP-FI, which is
  the orthogonal enterprise federated-identity stack):
  tag `["auth", owner_hex, conditions, schnorr_sig]` over
  `sha256("nostr:agent-auth:" + agent_hex + ":" + conditions)`
  (`docs/nips/NIP-OA.md:24-60`). Attach to the WS AUTH event and to HTTP via
  `x-auth-tag` header (`crates/buzz-relay/src/api/bridge.rs:804-816`).
- **Messages**: kind **9** stream messages, channel scope = `h` tag (channel
  UUID), mentions = `p` tag. Channel metadata kind **39000**, members list
  kind **39002** (`d` = channel id). Join/leave: kinds **9000/9001/9021**.
- Relay queries **must specify `kinds`** or they hit the p-gate 403.

## 4. Key model (nsec handling)

- **Owner nsec**: user-provided at connect time; stored in OS keychain
  (service `com.hypercli.desktop.buzz-owner`, key `buzz-owner/<uuid>`;
  `src-tauri/src/buzz_connections.rs:22,139`). The owner must be a relay
  member on a closed relay.
- **Agent nsec**: minted locally per agent — `AgentIdentity::generate()`
  (`buzz_connections.rs:517-522`). Never leaves the device except as the
  deployment secrets `BUZZ_PRIVATE_KEY` + `NOSTR_PRIVATE_KEY`.
- **Attestation**: owner key signs the NIP-OA auth tag at creation
  (`buzz_connections.rs:563-591`; upstream equivalent
  `buzz_sdk_pkg::nip_oa::compute_auth_tag`). Passed to the deployment as
  `BUZZ_AUTH_TAG`.
- Headless alternative: `buzz-admin generate-key` + `buzz-admin add-member
  --pubkey …` (publishes kind **13534**) — `crates/buzz-acp/README.md`.

## 5. Launch flow (current desktop2 implementation)

`create_buzz_agent` (`src-tauri/src/buzz_launch.rs:806-944`):

1. Load owner nsec from keychain; generate agent keypair; build NIP-OA tag.
2. `POST /deployments` with `CreateDeploymentRequest::new(runtime)`:
   - `name = canonical_deployment_name(name, agent_pubkey_hex)`
   - secrets: `BUZZ_PRIVATE_KEY`, `NOSTR_PRIVATE_KEY`
   - env: `BUZZ_RELAY_URL`, `BUZZ_ACP_AGENT_COMMAND/ARGS/MCP_COMMAND`,
     `BUZZ_ACP_LAZY_POOL=true`, `BUZZ_ACP_RELAY_OBSERVER=true`,
     `BUZZ_ACP_AGENTS=<parallelism>`, `BUZZ_ACP_MULTIPLE_EVENT_HANDLING=steer`,
     `BUZZ_ACP_DEDUP=queue`, plus `BUZZ_AUTH_TAG`, `BUZZ_ACP_DISPLAY_NAME`,
     `BUZZ_ACP_SYSTEM_PROMPT`, `BUZZ_ACP_MODEL`, `BUZZ_ACP_RESPOND_TO`,
     `BUZZ_ACP_RESPOND_TO_ALLOWLIST`
   - command `["/usr/local/bin/hyper-acp", "plugin", "buzz"]`, `restart:false`, buzz image family,
     sync uid/gid 1000
   - tags: `app=buzz`, `buzz_agent=<pubkey_hex>`, `buzz_channel=<id>` per channel
3. Wait for `stopped`; publish agent profile (kind 0 with auth tag) via NIP-98
   `POST https://<relay-host>/events` with `x-auth-tag` (buzz_launch.rs:585-624).
4. Publish owner-signed NIP-29 enrollment kind **9000** (role bot) per channel
   over WS (buzz_launch.rs:479-505). On failure: stop + `DELETE /deployments/{id}`
   + kind **9001** removals.
5. Record metadata in `~/.config/hypercli/buzz-connections.json`; start.

Channel discovery: NIP-98 `POST <relay>/query` — kinds 39002 (`#p`=owner) then
39000 (`#d`=channel ids) (buzz_launch.rs:160-210, 555-583).

## 6. Drift vs current SDK contract (must fix)

Audited against `ts-sdk/src/agents.ts` (most current of the three SDKs):

1. **Blank start payload (highest risk).** Both start paths send
   `StartDeploymentRequest::default()` (lib.rs:334, buzz_launch.rs:938) — an
   all-empty complete `launch_config`. The current contract treats START as a
   **full replacement**; the TS SDK rebuilds via `storedLaunchConfig()` with
   per-secret recovery (`GET /deployments/{id}/secrets[/key]`,
   agents.ts:5460-5524). desktop2 relies on the backend treating empty as
   "inherit stored" — not guaranteed.
2. **Buzz size contract.** TS SDK **forces `size:'large'`** for buzz launches
   and throws otherwise (agents.ts:4765-4767, 4812). desktop2 lets users pick
   small/medium (buzz_launch.rs:725-737).
3. **Parallelism defaults diverge.** desktop2: small=2/medium=5/large=10; TS:
   `parallelism ?? 1` (agents.ts:1145).
4. **No `OPENCLAW_GATEWAY_TOKEN`** in desktop2's OpenClaw create; current SDK
   always provisions it at create and re-asserts at start
   (agents.ts:2340-2343, 5541-5553).
5. **Control-UI origin lock** is a post-create PATCH in desktop2; the SDK
   bakes it into create-time env (`controlUiOriginLock`, agents.ts:2344-2347).
6. **Hardcoded size catalog** in CreateWindow.tsx:322-325; per repo policy,
   `/agents/types` + `/agents/plans` are the sole source of sizes/prices.
7. **Prompt drafting** uses raw `POST /v1/chat/completions` with hardcoded
   `kimi-k2.6` (lib.rs:489-543) instead of SDK `bootstrapInference()`.
8. **State model** is lowercase/loose; canonical states are uppercase
   `CREATING/STARTING/RESTORING/RUNNING/STOPPING/ARCHIVED/FAILED/DELETED`
   with no archive/restore surface in desktop2.
9. Missing entirely: `hermes-agent` runtime, plans/entitlements purchase
   flows, files/exec/logs APIs.

**Not drift (by design, app-local):** the whole nostr layer — keychain owner
nsec, per-agent key minting, NIP-OA attestation, NIP-98 relay HTTP, NIP-29
enrollment, channel discovery. The TS SDK deliberately consumes
`privateKeyNsec`/`authTag` as opaque caller-supplied strings
(`BuzzLaunchConfig`, agents.ts:1120-1136). Keep this layer in Rust.

## 7. buzz-acp spec (the in-pod harness)

Upstream crate `crates/buzz-acp` (lib `buzz_acp` + bin `buzz-acp`); the fork
patches it in place. Full env table: `crates/buzz-acp/README.md` +
`config.rs:197-504`. Key vars beyond §5: `BUZZ_ACP_SUBSCRIBE` (mentions|all),
`BUZZ_ACP_CHANNELS`, `BUZZ_ACP_KINDS` (default 9, 46010, 40007),
`BUZZ_ACP_IDLE_TIMEOUT` (620 s), `BUZZ_ACP_MAX_TURN_DURATION` (7200 s),
`BUZZ_ACP_SETUP_PAYLOAD` (setup-listener mode).

- Subscribes per channel: `{kinds:[9,…], "#h":[uuid], "#p":[agent_pubkey]}`;
  control subs kinds 44100/44101; publishes typing (20002), observer frames
  (24200, p-gated to owner), turn metrics (44200, NIP-44 to owner).
  **Chat replies are sent by the agent subprocess via the `buzz` CLI**, not by
  buzz-acp itself.
- Owner control in-band: kind 9 `!shutdown` / `!cancel` / `!rotate` mentioning
  the agent.
- Fork additions (`hypercli/hypercli`, see `DRIFT.md` there):
  `BUZZ_ACP_TEXT_MENTIONS` + `BUZZ_ACP_DISPLAY_NAME` (textual @-mentions,
  omits `#p` filter), `BUZZ_ACP_REQUIRE_REPLY` (reply guard),
  stricter interactive `buzz-acp authenticate` validation.
- Fork delta is small (~953 LOC, 23 files, 15 commits on merge-base
  be95a8a98); **zero changes to `crates/buzz-relay`** — the closed-relay flags
  are all upstream. Upstream main is ~369 commits ahead of the fork.

### Lift-ability (extracting buzz-acp standalone)

Verdict: highly liftable. Checklist:
1. Vendor/extract `buzz-sdk` (`nip_oa::{compute,verify,parse}_auth_tag`,
   `build_message`, `build_reaction`, `build_agent_observer_frame`,
   `ThreadRef`). NIP-OA itself is ~100 lines if reimplemented.
2. Vendor `buzz-core::kind` constants + `verify_event` (kinds: 9, 20002,
   24200, 39000, 39002, 44100, 44101, 44200, 46010, 40007).
3. Port fork-only `buzz-core/src/reply_guard.rs` (13 lines).
4. Drop the declared-but-unused `buzz-persona` dep.
5. Carry the fork patches (text mentions, reply guard, auth validation) —
   all env-gated.
6. No relay coupling: stock NIP-01/42/98/29 + `x-auth-tag`.
7. Build: `cargo build --release -p buzz-acp`; musl cross-build pattern in
   benchmarks; no Dockerfile exists for it in either branch.
8. Watch-out: ACP `protocolVersion: 2` request with v1 auth shapes (DRIFT.md
   "Known Compatibility Risk") — pin adapter versions.

## 8. Open questions / gaps

- **Agent onboarding on the closed relay**: nothing documents how an
  agent-only nsec joins beyond NIP-OA inheritance from a member owner; desktop2
  currently assumes the owner is already a member of each channel and signs
  kind 9000 enrollments itself. Verify this is sufficient on
  community/internal.
- **Invite-token mechanics**: tokens derive from `relay_private_key`;
  mint/redeem flow lives in the buzz app source (`buzz-admin` subcommands
  beyond `generate-key` not enumerated).
- **Pairing relay** (`/pair`, `buzz-pair-relay:5000`): protocol undocumented;
  only needed for device pairing, not agents.
- Actual deployed pubkeys/stack config live on the deploy host (gilfoyle) in
  the Pulumi S3 backend, not in any local checkout.
