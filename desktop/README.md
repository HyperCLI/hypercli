# HyperCLI Desktop

A Tauri 2 desktop client for the HyperCLI agent platform. It lists your agents,
starts/stops them, chats with them (ACP, OpenClaw, Hermes), and gives you a
shell, live logs, a file browser, a remote desktop view, voice dictation and
read-aloud replies, scheduled jobs (routines), plan and usage panels, and an
in-app update banner backed by the Tauri auto-updater.

- Design spec: [`SPEC.md`](./SPEC.md)
- Feature guardrails: [`FEATURES.md`](./FEATURES.md)
- Rules for changing this app: [`AGENTS.md`](./AGENTS.md) — **read this before
  editing code**
- Repo-wide conventions: [`../AGENTS.md`](../AGENTS.md)

---

## Architecture

Three pieces, with a deliberately thin native layer:

```
┌───────────────────────── Tauri window ──────────────────────────┐
│                                                                 │
│  Webview (React 19 + Vite 8 + Tailwind 4)                       │
│    src/App.tsx, src/components/**, src/useAgentChat.ts          │
│      │                                                          │
│      └── src/api.ts ── ts-sdk (TypeScript, imported from source)│
│              │            ../ts-sdk/src/client.ts, agents.ts,   │
│              │            acp.ts, agent-urls.ts, routines.ts    │
│              │                                                  │
│              └── ALL backend HTTP + WebSocket happens here,     │
│                  in the webview, subject to CORS and CSP.       │
│      │                                                          │
│      └── Tauri IPC (invoke) ─────────────────┐                  │
│                                              ▼                  │
│  Rust (src-tauri/src/lib.rs, ~300 lines)                        │
│    auth_status · save_api_key · logout · acp_credentials        │
│    start_login · mint_api_key · is_auto_update_supported        │
│    + single-instance, deep-link, opener, updater plugins        │
│                                                                 │
│  Rust does NOT proxy the API. It reads/writes ~/.hypercli/config│
│  and hands the credential to the webview.                       │
└─────────────────────────────────────────────────────────────────┘
```

### What lives where

| Concern | Location |
| --- | --- |
| Credential discovery/persistence (`~/.hypercli/config`) | `src-tauri/src/lib.rs` |
| OS integration (single instance, open URL, auto-update) | `src-tauri/src/lib.rs`, `src/useAppUpdate.ts` |
| SDK client construction, URL derivation, wire-shape mapping | `src/api.ts` |
| Transport choice per runtime family (ACP / OpenClaw / Hermes) | `src/runtime-client.ts`, `src/agent-utils.ts` |
| Chat state machine, tool-call trace folding | `src/useAgentChat.ts`, `src/chat-trace.ts`, `src/activity-trace.ts` |
| UI | `src/App.tsx`, `src/components/**` |

### The client layer

`src/api.ts` is the app's client layer. Nothing else in `src/` may construct a
`HyperCLI` client, derive a backend URL, or open a socket to a backend host.

This follows the project's SDK boundary rule: **the SDK defines interactions;
it is not a "do everything" client.** The app-specific client — credential
source, base-URL policy, transport choice, snake_case wire shapes the desktop
components expect — is built here, in the app's own sources, wrapping the SDK.
Do not push desktop policy back into `ts-sdk/`.

> **Planned.** `src/api.ts` is one ~1200-line file that mixes client
> construction, URL derivation, transport selection, and DTO mapping. The
> intended shape is a small `src/lib/` layer (client factory + URL policy +
> transport policy) with thin per-domain modules on top. Until that lands,
> treat `src/api.ts` as the boundary: add to it, do not route around it.

### ts-sdk is consumed from source, not from the package build

`src/api.ts` imports `../../ts-sdk/src/client.ts` directly (relative path, `.ts`
extension), not `@hypercli.com/sdk`. `package.json` still declares
`"@hypercli.com/sdk": "file:../ts-sdk"`, and CI builds the SDK before
typechecking desktop, because the SDK's own `.d.ts` files pull in its
dependencies.

Consequences you must know about:

- Editing `ts-sdk/src/**` changes this app immediately, with no rebuild.
- `tsconfig.json` sets `"exclude": ["../ts-sdk"]`, which only filters the
  `include` glob: SDK files reached through an import are still pulled into
  the program and type-checked by `npm run typecheck` (see
  [AGENTS.md](AGENTS.md) rule 14). What typecheck does **not** catch is an SDK
  function being Node-only at runtime.
- The SDK is a Node-first library. `vite.config.ts` aliases the bare `fs`,
  `path`, and `node:crypto` specifiers to real browser shims under
  `src/shims/`, so those imports behave the same in dev and packaged. The
  remaining Node-only paths are dynamic imports the aliases deliberately do
  not touch: `dns` (`ts-sdk/src/jobs.ts`) and `node:fs/promises`
  (`ts-sdk/src/agents.ts`), which Vite externalizes for the browser bundle.
  Those code paths are currently guarded or unused by this app, but a new SDK
  call that reaches one is a packaged-only crash.
- `vite.config.ts` aliases the `ws` package to `src/ws-browser-shim.ts` so the
  SDK's `NodeWebSocket ?? globalThis.WebSocket` selection falls through to the
  browser's native `WebSocket`.

---

## Running it

Prerequisites: Node 22, Rust stable (1.95 in CI), and the Tauri system deps for
your OS. You need a HyperCLI credential in `~/.hypercli/config` (or the
`HYPER_AGENTS_API_KEY` / `HYPER_API_KEY` / `HYPERCLI_API_KEY` env vars).

```bash
npm install
npm run tauri dev      # dev, inside a real Tauri window
npm run tauri build    # packaged app (runs `npm run build` first)

npm run typecheck      # tsc --noEmit
npm run build          # tsc && vite build  -> dist/, consumed by Tauri
npm test               # vitest (pure logic: schedule, usage, traces)
```

### Plain browser dev vs the Tauri window

`npm run dev` starts Vite on `http://localhost:1420` in your browser. Outside a
Tauri window there is no `__TAURI_INTERNALS__`, so credential resolution falls
back to the env vars `vite.config.ts` injects at serve time
(`__HYPER_DEV_API_KEY__` / `__HYPER_DEV_API_BASE__`, built from
`HYPER_API_KEY`/`HYPERCLI_API_KEY` and `HYPER_API_BASE`; see
`src/lib/credentials.ts`). With no injected key the app reports a missing
credential and signs out. Authoritative verification still means a packaged
build — see [AGENTS.md](AGENTS.md) rule 9.

`vite.config.ts` is a ~100-line plain pass-through proxy: the browser calls its
own origin under `/api/*` and Vite forwards upstream with the upstream's own
`Origin` header, which removes the dev-origin CORS gap instead of re-implementing
anything. The old ~700-line `devBridge()` that answered API calls by running
ts-sdk in Node is gone ([AGENTS.md](AGENTS.md) rule 10 is the standing rule).

### Shipped feature notes

- **Push-to-talk mic dictation** (`src/lib/dictation.ts`, `src/lib/mic-capture.ts`,
  `src/components/DictationButton.tsx`): a composer mic button streams
  MediaRecorder-encoded audio (opus-in-webm on Chromium, `audio/mp4` on
  WKWebView) as base64 frames over the agents `/ws/voice/transcribe` socket and
  splices only `transcript.final` into the draft at the caret; Esc discards. The
  socket protocol carries no container indicator — the worker identifies the
  container from the buffered bytes. Packaged macOS builds declare
  `NSMicrophoneUsageDescription` in `src-tauri/Info.plist` so the mic prompt can
  appear, and WKWebView needs macOS 13.3+ for `getUserMedia`; the machine
  (`idle/starting/recording/transcribing`) owns mic + socket lifecycle, denial
  surfaces on the error bar as a `permission` issue, and the button hides itself
  on webviews without `getUserMedia`/`MediaRecorder` support.
- **Read-aloud replies** (`src/lib/read-aloud.ts`, `src/lib/voice-player.ts`):
  `speechStream()` opens a request-scoped voice socket (`/ws/voice`) asking for
  PCM (24 kHz mono s16le), and the player schedules Web Audio chunks back-to-back
  on one `AudioContext` (CSP has no `media-src`, so `<audio>`/blob playback is
  out). A new read supersedes the old one. The voice chain is: upload reference
  audio in the agent identity modals → the backend stores `avatar_audio_url` →
  `hasAgentVoice(agent)` renders the header speaker button, and read-aloud
  speaks in that voice: `agentTtsOptions()` threads the URL through and
  `speechStream()` fetches the reference bytes (URL-cached) and clones with
  `speakClone`. Cloning is the only read-aloud voice mode — no preset fallback;
  an agent without reference audio has no read-aloud mode at all. Reference
  bytes come from the storage URL itself (public, CORS-open at both packaged
  origins, host in CSP `connect-src`): the gateway's
  `GET /agents/deployments/{id}/avatar-audio` serves only metadata, not bytes.
- **Update banner** (`src/components/UpdateBanner.tsx`, `src/lib/update-banner.ts`,
  `src/useAppUpdate.ts`): the updater check runs once at startup (plus an
  explicit "Check now" in Settings → Updates); a newer release shows an
  accent-toned info card on the shared error-bar surface. Dismissal is persisted
  per version under the `desktop-ng-*` localStorage convention — a later, newer
  release re-shows the banner. "Update and restart" downloads, installs, and
  relaunches via the Tauri updater plugin.
- **Agent desktop view**: the iframe loads the SDK-derived signed URL
  (`client.deployments.desktopUrl()`), which defaults the noVNC target to the
  immediate-connect `vnc_lite.html` page with `scale=true` (see
  `ts-sdk/src/agents.ts`; `vnc.html` and other redirects stay selectable via the
  builder's `redirect` option).
- **Desktop minted keys and agent files**: the Rust shell mints machine keys with
  `agents:*`, `files:*`, `models:*`, and `user:self` scopes
  (`src-tauri/src/lib.rs`). Sign-ins from before the `files:*` grant get a
  hidden 404 from the files API; `src/api.ts` translates that into an explicit
  "sign in again to mint a file-enabled desktop key" message — signing out and
  back in is the migration.
- **Avatar/voice identity modals** (`src/components/IdentityPickerModals.tsx`)
  accept drag-and-drop files in addition to the file picker; the composer also
  accepts dropped files as attachments.

### Dev, packaged, and the API base

Which API host you talk to comes from `~/.hypercli/config` (`discover_agents_api_base()`
in the Rust SDK), surfaced to the webview as `AcpCredentials.api_base` and passed
to the SDK as `agentsApiBaseUrl` (`src/api.ts`).

The dev origin `http://localhost:1420` is not on the gateway's CORS allowlist, so
in dev the REST base is **same-origin** and Vite proxies it upstream under the
`/api` prefix (`src/lib/endpoints.ts`, `vite.config.ts`) — CORS drops out of the
picture entirely and the production API works from a dev window. WebSockets are
never proxied: they dial the real host directly in both modes. To exercise a dev
backend instead of prod, point your config at
`https://api.dev.hypercli.com/agents`.

---

## Origins, CORS, and CSP

This is the part that has bitten this app repeatedly. Read it before adding any
network call.

### Origins

| Mode | Webview origin |
| --- | --- |
| `npm run tauri dev` | `http://localhost:1420` |
| Packaged, macOS / Linux | `tauri://localhost` |
| Packaged, Windows (WebView2) | `http://tauri.localhost` |

There is no proxy in the packaged app. Every `fetch()` the SDK makes is a real
cross-origin request from one of those origins, and every one is subject to the
target's CORS policy and to this app's Content Security Policy.

### Which API host allows which origin

Verified by probing from a page served at the real packaged origin:

| Host | `http://tauri.localhost` | `tauri://localhost` | `http://localhost:1420` |
| --- | --- | --- | --- |
| `https://api.hypercli.com` | allowed | allowed | **not allowed** |
| `https://api.dev.hypercli.com` | — | — | allowed |
| `https://api.agents.hypercli.com` | **per route** — `/v1/*` echoes the origin; control-plane routes are gateway-only | route-dependent | route-dependent |

`https://api.hypercli.com` also allows `https://console.hypercli.com`.

### Gateway vs. backing service — the rule

**All REST goes through `api.hypercli.com`. The only direct connection to
`api.agents.hypercli.com` is the `wss://.../ws*` bridge.** WebSocket handshakes
are not CORS-gated, so the backing service needs no CORS policy for this app,
and the gateway does not front `/ws` (it refuses the upgrade) — that split is
intentional, not a gap to close.

`api.hypercli.com` is an **API gateway** that fronts `api.agents.hypercli.com`.

CORS on the backing service is decided **per route, not per host**: `/v1/*` sends
CORS headers on both hosts, while the agents control plane is exposed for browser
clients only through the gateway. A non-existent route returns 404 with no CORS
headers, which reads identically to "no CORS policy" — always measure the exact
path you mean to call.

> **The webview should only ever contact `https://api.hypercli.com` (or
> `https://api.dev.hypercli.com`) over HTTP.** The gateway is the host whose
> browser CORS posture is maintained deliberately and whose route set matches
> what this app calls. Calls that land on the backing service may work or may
> fail as a bare `TypeError: Failed to fetch`, depending on the route — which is
> exactly the kind of inconsistency worth designing out.

This is the most-repeated mistake in this codebase, and it is repeated in good
faith: `api.agents.hypercli.com` is a real, healthy, reachable host, and some of
its routes are browser-reachable. `curl` against it works. A Node probe works.
The CLI works. The Vite dev proxy works. None of those are browsers, and CORS is
a browser rule — so for a route that lacks it, every check a developer
instinctively runs passes, and the single context that fails is the packaged
webview, which is the last thing anyone tests. "I verified the host responds" is
not evidence that the app can call it from the webview.

It also fails *partially*, which sends the investigation the wrong way: sign-in
and the agent roster go through the gateway and keep working, so it reads as one
broken feature rather than as a networking problem.

See [AGENTS.md](AGENTS.md) rule 4 for the full rule, the verified gateway path
mapping, and the `curl` command to check any host at the packaged origin.

Note that `ts-sdk`'s `resolveHyperAgentBaseUrl()` (`ts-sdk/src/agent.ts:12-22`)
maps `api.hypercli.com` → `https://api.agents.hypercli.com/v1` and so bypasses
the gateway. Anything reached through `client.agent.baseUrl` (models, discovery)
is therefore unreachable from the webview. `client.agent.controlBaseUrl`
(plans, usage, subscriptions) correctly resolves back to
`https://api.hypercli.com/agents`, and `client.deployments` builds its own
HTTP client on the gateway base — those are fine.

Also note: `/v1/usage/*` is 404 on **both** hosts. The usage panel reads the
control-plane paths (`/agents/usage/history|keys|agents`) via
`client.agent.usageReport()`; do not "fix" a usage 404 by switching to `/v1`.

### WebSockets

WebSockets are **not** subject to CORS. They **are** subject to CSP `connect-src`.

Backend token endpoints return **absolute** `ws_url`s that point at
`wss://api.agents.hypercli.com/...`. That is expected and it works — the
gateway-only rule above is an HTTP rule, not a WS rule. Use the `ws_url` the
backend hands you; do not rewrite it.

The ACP chat socket is dialed at `defaultHyperAcpWsUrl(api_base)` =
`wss://api.agents.hypercli.com/ws`, with `agent_id` and `token` as query
parameters (`acpConnectTarget` in `src/api.ts`).

### CSP (`src-tauri/tauri.conf.json`)

```
default-src 'self';
connect-src ipc: http://ipc.localhost
  https://api.hypercli.com  https://api.dev.hypercli.com
  wss://api.hypercli.com    wss://api.dev.hypercli.com
  wss://api.agents.hypercli.com    wss://api.agents.dev.hypercli.com
  https://*.hypercli.app  wss://*.hypercli.app;
img-src 'self' data: blob: https:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
frame-src https://*.hypercli.app blob:
```

`ipc:` / `http://ipc.localhost` are Tauri's own IPC channels and must stay.

There is no `script-src`, so scripts fall back to `default-src 'self'` and
`eval` is blocked. `ts-sdk/src/config.ts` probes for Node with
`(0, eval)('require')` inside a `try`/`catch`; it fails safely, but it does emit
a CSP violation in the packaged console. That is expected noise, not a bug.

#### Agent-scoped hosts

Agent-scoped traffic goes to the agent's own Cloudflare-proxied hostname,
`<agent>.hypercli.app`:

- **Agent files** (`filesList`, `fileRead`, `fileWriteBytes`) fetch
  `https://<agent>.hypercli.app/_reef/...`. Covered by
  `https://*.hypercli.app` in `connect-src` (added when the files panel
  shipped). CORS at that edge for the packaged origin is still unverified —
  CSP alone never implies the host answers our origin.
- **OpenClaw / Hermes gateway chat** dials `wss://<agent>.hypercli.app`,
  covered by `wss://*.hypercli.app` in `connect-src`.

`frame-src https://*.hypercli.app` already covers the remote-desktop iframe and
the `blob:` file previews.

#### Entries that no longer earn their place

- `wss://api.hypercli.com` / `wss://api.dev.hypercli.com` only backstop
  `agentsBridgeWsBase()` (used by `agentLogsUrl` in `src/api.ts`), which
  produces `wss://api.hypercli.com/ws`. That path is **404 on the gateway** —
  the gateway proxies no WS at all (`/agents/ws*` and `/ws` both refuse the
  upgrade); the real bridge is `wss://api.agents.hypercli.com/ws`. The fallback
  is only reached when a logs token omits `ws_url`, and when it is reached it
  fails.

---

## Dev-vs-packaged divergences that exist today

| Thing | Dev | Packaged |
| --- | --- | --- |
| Credential source | Tauri IPC, or the injected `__HYPER_DEV_API_KEY__`/`__HYPER_DEV_API_BASE__` fallback in a plain browser tab (`src/lib/credentials.ts`) | Tauri IPC |
| REST path | same-origin under `/api`, proxied upstream by Vite | direct to the gateway |
| OpenClaw / Hermes chat | enabled | enabled — both use the SDK's canonical session clients (`runtime-client.ts`) |
| Agent files panel | works | CSP-covered (`*.hypercli.app` in `connect-src`); CORS at that edge for packaged origins still unverified |
| Auto-updater | plugin compiled out | active in release builds |
| `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` on a started agent | union-merged with the stored set, never replaces it | same — the app passes every legit origin (`http://tauri.localhost`, `tauri://localhost`, `http://localhost:1420`) and the SDK merges them into the agent's stored list |

OpenClaw chat runs over the SDK's pooled gateway connections; Hermes chat over
its HTTP/SSE session client. Both are transport-identical in dev and packaged —
OpenClaw needs `wss://*.hypercli.app` and Hermes needs `https://*.hypercli.app`
in CSP `connect-src`, and both entries are present. What is *not* live-verified
yet is CORS at the `*.hypercli.app` edge for the packaged origins (the Hermes
API and the Reef file endpoints are plain HTTP there); exercise them in a
packaged build before calling either done.

---

## Packaging and release

- `npm run tauri build` runs `npm run build` (`tsc && vite build` → `dist/`) and
  bundles it via `frontendDist: "../dist"`.
- `scripts/build-release-config.mjs` emits `src-tauri/tauri.release.conf.json`
  with updater-only overrides (`HYPERCLI_UPDATER_PUBLIC_KEY`,
  `HYPERCLI_UPDATER_ENDPOINT`). It is a **delta** merged on top of
  `tauri.conf.json` — never copy the base config into it.
- The updater plugin is registered only when `build.rs` sees both updater env
  vars at compile time (`hypercli_updater_enabled`), and only in release
  (`src-tauri/src/lib.rs:112-121`). Auto-update on Linux only works for
  AppImage; `is_auto_update_supported` detects that via `$APPIMAGE`.
- The updater's own network traffic runs in Rust (`reqwest`), so it is **not**
  governed by the webview CSP.
- `.github/workflows/release-desktop.yml` builds macOS as a **single universal
  leg**: one `darwin-universal` matrix entry on `macos-15` builds with
  `--target universal-apple-darwin` (both Rust targets installed; the tauri CLI
  lipos the arches into one fat `.app`), which is then codesigned, notarized,
  and stapled once and rebuilt into a single updater archive
  `HyperCLI_<version>_universal.app.tar.gz`. The rolling `latest.json` keeps
  `darwin-aarch64`, `darwin-x86_64`, and `darwin-universal` keys — installed
  clients request their own arch key — but all three resolve to that same
  universal archive + signature, which the updater extracts wholesale
  regardless of client arch.
- CI (`.github/workflows/desktop-ci.yml`) runs `cargo fmt/clippy/test` and, for
  the frontend, `npm run typecheck && npm run build`. It does **not** run
  `npm test` and does **not** exercise a packaged binary.
