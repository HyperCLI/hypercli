# HyperCLI Desktop

A Tauri 2 desktop client for the HyperCLI agent platform. It lists your agents,
starts/stops them, chats with them (ACP, OpenClaw, Hermes), and gives you a
shell, live logs, a file browser, a remote desktop view, scheduled jobs
(routines), plan and usage panels.

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
│  Rust (src-tauri/src/lib.rs, ~140 lines)                        │
│    auth_status · save_api_key · logout · acp_credentials        │
│    is_auto_update_supported                                     │
│    + single-instance, opener, updater plugins                   │
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

> **Planned.** `src/api.ts` is currently one 666-line file that mixes client
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
- `tsconfig.json` sets `"exclude": ["../ts-sdk"]`, so `npm run typecheck` does
  **not** type-check SDK sources — only the parts your imports touch.
- The SDK is a Node-first library. Vite externalizes its Node builtins for the
  browser bundle. `npm run build` prints these today and still succeeds:
  `fs` and `path` (`ts-sdk/src/files.ts`), `dns` (`ts-sdk/src/jobs.ts`),
  `node:crypto` and `node:fs/promises` (`ts-sdk/src/agents.ts`). They resolve to
  `__vite-browser-external`, which throws on **any** property access. Every one
  of those code paths is currently guarded or unused by this app, but a new SDK
  call that reaches one is a packaged-only crash that the build only warns about.
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

### Why `npm run dev` alone is not enough

`npm run dev` starts Vite on `http://localhost:1420` in your browser. The app
gets its credential from the Tauri command `acp_credentials`, and `src/api.ts`
calls `invoke()` unconditionally (`src/api.ts:1`, `src/api.ts:172`). Outside a
Tauri window there is no `__TAURI_INTERNALS__`, so that throws and the app never
signs in. Use `npm run tauri dev`.

`vite.config.ts` still contains a ~700-line dev-server bridge (`devBridge()`,
serving `/__desktop_ng/invoke`, `/__desktop_ng/stream`, `/__desktop_ng/shell`,
`/__desktop_ng/logs`) that runs ts-sdk **in Node**, server-side. It exists for
the pre-migration frontend, which POSTed every call to `/__desktop_ng/invoke`.

> **Planned (removal).** The current `src/api.ts` no longer calls the bridge at
> all. The bridge is dead code that still boots on every `vite` run and still
> imports ts-sdk. It should be deleted. Until it is, do not "fix" a bug by
> editing the bridge — the packaged app does not run it.

### Dev, packaged, and the API base

Which API host you talk to comes from `~/.hypercli/config` (`discover_agents_api_base()`
in the Rust SDK), surfaced to the webview as `AcpCredentials.api_base` and passed
to the SDK as `agentsApiBaseUrl` (`src/api.ts:35-39`).

**`npm run tauri dev` against the production API does not work.** The dev origin
is `http://localhost:1420`, and `https://api.hypercli.com` does not include that
origin in its CORS allowlist. For a working dev loop, point your config at the
dev API base (`https://api.dev.hypercli.com/agents`), which does allow
`http://localhost:1420`.

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
The CLI works. The Vite dev bridge works. None of those are browsers, and CORS is
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
parameters (`src/api.ts:531-537`).

### CSP (`src-tauri/tauri.conf.json`)

```
default-src 'self';
connect-src ipc: http://ipc.localhost
  https://api.hypercli.com  https://api.dev.hypercli.com
  https://api.agents.hypercli.com  https://api.agents.dev.hypercli.com
  wss://api.hypercli.com    wss://api.dev.hypercli.com
  wss://api.agents.hypercli.com    wss://api.agents.dev.hypercli.com;
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

#### Known CSP gaps

Agent-scoped traffic goes to the agent's own Cloudflare-proxied hostname,
`<agent>.hypercli.app`, which is **not** in `connect-src`:

- **Agent files** (`filesList`, `fileRead`, `fileWriteBytes`) fetch
  `https://<agent>.hypercli.app/_reef/...` (`ts-sdk/src/agents.ts:4644-4670`).
  Blocked in the packaged build. CORS at that edge for the packaged origin is
  also unverified — adding the CSP entry is necessary but may not be sufficient.
- **OpenClaw / Hermes gateway chat** dials `wss://<agent>.hypercli.app`
  (`ts-sdk/src/agents.ts:3518-3520`). Blocked in the packaged build.

`frame-src https://*.hypercli.app` already covers the remote-desktop iframe and
the `blob:` file previews.

#### Entries that no longer earn their place

- `https://api.agents.hypercli.com` and `https://api.agents.dev.hypercli.com` in
  `connect-src` grant permission for HTTP calls that can never succeed (no CORS).
  Leaving them in implies those hosts are a supported HTTP target. They are not.
- `wss://api.hypercli.com` / `wss://api.dev.hypercli.com` only backstop
  `agentsBridgeWsBase()` (`src/api.ts:498`, used at `src/api.ts:539-548`), which
  produces `wss://api.hypercli.com/ws`. That path is **404 on the gateway** — the
  real bridge is `/agents/ws*`. The fallback is only reached when a logs token
  omits `ws_url`, and when it is reached it fails.

---

## Dev-vs-packaged divergences that exist today

| Thing | Dev | Packaged |
| --- | --- | --- |
| Credential source | Tauri IPC (`tauri dev`) / broken (plain `vite`) | Tauri IPC |
| API host reachable | `api.dev.hypercli.com` only (CORS) | `api.hypercli.com` |
| `vite.config.ts` dev bridge | boots, unused | absent |
| OpenClaw / Hermes chat | enabled | enabled — both use the SDK's canonical session clients (`runtime-client.ts`) |
| Agent files panel | works | blocked by CSP (`*.hypercli.app` missing) |
| Auto-updater | plugin compiled out | active in release builds |
| `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` baked into a started agent | `http://localhost:1420` | `http://tauri.localhost` / `tauri://localhost` (`src/api.ts:227`) |

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
- CI (`.github/workflows/desktop-ci.yml`) runs `cargo fmt/clippy/test` and, for
  the frontend, `npm run typecheck && npm run build`. It does **not** run
  `npm test` and does **not** exercise a packaged binary.
