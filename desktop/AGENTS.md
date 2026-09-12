# AGENTS.md — HyperCLI Desktop

Rules for anyone (human or agent) changing code under `desktop/`.

Read [`README.md`](./README.md) first for the architecture and the origin/CORS/CSP
model. This file is the anti-footgun list: each rule states **why**, because the
failure modes here are invisible in dev and only appear in a packaged build.

Repo-wide conventions still apply — see [`../AGENTS.md`](../AGENTS.md). Scope
guardrails for features live in [`FEATURES.md`](./FEATURES.md); visual rules in
[`SPEC.md`](./SPEC.md).

---

## The one-paragraph summary

All backend HTTP and WebSocket traffic runs **in the webview**, through `ts-sdk`,
from an origin that is `http://localhost:1420` in dev and `tauri://localhost` /
`http://tauri.localhost` when packaged. Rust is credentials plus OS integration
and nothing else. The `npm run dev` Vite server proxies REST same-origin, which
the shipped app does not have, so anything that only works through that origin
difference will fail in the packaged app, silently, with
`TypeError: Failed to fetch`.

---

## Connections

### 0. Connection lifecycle is governed by [FSM.md](FSM.md).

Every socket, token mint, and retry belongs to a state machine defined there.
If you are about to write a `cancelled` boolean, a nonce counter, or a
`setTimeout` retry inside a component, stop and read it first — that is the
exact pattern that produced a reconnect storm, two ACP sockets per agent, an
orphaned log socket, and a sessions panel that could not tell empty from broken.

## Layering

### 1. Never call the backend from a component or hook. Go through `src/api.ts`.

`src/api.ts` is this app's client layer. It owns SDK construction, credential
plumbing, URL derivation, transport choice, and the snake_case DTO shapes the
components expect.

**Why:** the CORS/CSP/host rules below are only enforceable if there is exactly
one place that decides which host gets contacted. A `fetch()` in a component is
invisible to review and untestable, and it will be the thing that breaks the
packaged build.

Concretely, do not add to a component or hook:
- `new HyperCLI(...)` or any SDK client construction,
- a literal `https://`/`wss://` backend URL,
- `fetch()` or `new WebSocket()` against a backend host.

Constructing `new WebSocket(url)` from a URL that `src/api.ts` produced is fine
(that is what `useAgentLogs.ts:66` and `ContextPanel.tsx:473` do); deriving that
URL locally is not.

### 2. Do not put desktop client policy into `ts-sdk/`.

SDKs define the *interactions*. They are not meant to be full-blown
do-everythings. Credential source, base-URL policy, transport selection, and the
app's wire shapes belong in the app's own library layer.

**Why:** `ts-sdk` is shared with the console, the CLI, and CI. A previous attempt
to fix desktop's URL problems inside `ts-sdk` was fully reverted. Changing SDK
defaults to make desktop work moves the breakage to another consumer.

**Hard constraint: do not modify anything under `ts-sdk/` as part of a desktop
change.** If the SDK genuinely cannot express what you need, wrap or override it
in `src/api.ts` and say so in the PR.

### 3. `src/api.ts` is the boundary, not the destination.

The intended shape is a small `src/lib/` layer (client factory, URL policy,
transport policy) with thin domain modules on top. Until that exists, add to
`src/api.ts` rather than routing around it. Do not create a second client layer.

---

## Hosts, CORS, and CSP

### 4. All REST goes through the gateway. The only direct backing-service connection is `/ws`.

This is the architecture, not a workaround:

| Traffic | Host | Why |
|---|---|---|
| **All REST** | `api.hypercli.com` (`api.dev.hypercli.com`) | The gateway is where browser CORS is maintained. Measured: it allows both packaged origins on every route the app calls, preflight and actual. |
| **WebSockets only** | `wss://api.agents.hypercli.com/ws*` | Dialled directly and deliberately. WS handshakes are not CORS-gated, so the backing service needs no CORS policy for this app. |

Consequences worth stating, because each has already been got wrong once:

- **Never make an HTTP request to `api.agents.hypercli.com`.** Not because it
  would necessarily fail — some of its routes do send CORS — but because it is
  not the contract. `api.agents.hypercli.com` carries no CORS guarantee, and a
  route that works today may not tomorrow.
- **`ts-sdk` breaks this rule in one place.** `resolveHyperAgentBaseUrl()`
  discards the base URL it is given and rewrites `api.hypercli.com` →
  `https://api.agents.hypercli.com/v1`, so anything reached via
  `client.agent.baseUrl` (models, `discovery/*`, completions) is HTTP to the
  backing service. Pin it to the gateway in the client layer rather than
  letting the SDK choose the host.
- **`https://api.agents.hypercli.com` does not belong in CSP `connect-src`.**
  There is no HTTP to that host by design. `wss://api.agents.hypercli.com` is
  essential and must stay.
- **Do not "fix" a WS problem by looking for a gateway path.** The gateway does
  not front `/ws` and is not meant to: `/agents/ws` and `/ws` both refuse the
  upgrade. Dial the backing service.

**How to check CORS at the real origin** (never test from `localhost:1420` — it
is a different origin with a different answer):

```bash
curl -si -X OPTIONS 'https://<host>/<path>' \
  -H 'Origin: http://tauri.localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' | grep -i '^access-control'
```

No `access-control-allow-origin` in the response means the webview cannot call
it, whatever the CSP says. Repeat for `tauri://localhost` (macOS/Linux). Note
that a request carrying `Authorization` always triggers a preflight, so the
`OPTIONS` response is what fails first — check it, not just the GET.

`api.hypercli.com` is a **gateway** in front of `api.agents.hypercli.com`.

CORS on the backing service is decided **per route, not per host**. Some routes
send CORS headers and are browser-reachable (`/v1/*` echoes the request origin);
the agents control-plane routes are only exposed through the gateway. A route
that does not exist returns 404 with no CORS headers at all, which is easy to
misread as "this host has no CORS" — measure the exact path you intend to call,
not a neighbouring one.

The rule stands regardless: **address the gateway.** It is the host whose CORS
posture is maintained deliberately for browser clients, and the only one whose
route set matches what this app calls. A blocked call surfaces as
`TypeError: Failed to fetch` — no status code, no body, no useful message.

**Why this keeps getting reintroduced.** `api.agents.hypercli.com` is not a
typo or a dead host. It is the real backing service, it is reachable, and it
answers correctly — so every instinctive check a developer runs says it is fine.
For a route that lacks browser CORS, every check below still passes and only the
webview fails:

| What you'd try | Result | Enforces CORS? |
|---|---|---|
| `curl https://api.agents.hypercli.com/...` | works | no |
| a Node script / `.mjs` probe | works | no |
| the `hypercli` CLI | works | no |
| the Vite dev proxy (`npm run dev`) | same-origin, works | no |
| **the packaged webview** | **fails** | **yes** |

CORS is a *browser* rule. Nothing in that list except the packaged webview is a
browser, so the one context that breaks is the one context nobody tests until
ship. Treat "I verified the host responds" as evidence of nothing.

**The failure is partial, which disguises it.** Sign-in and the agent roster go
through the gateway and keep working; only the calls that resolve to the backing
service break. It presents as one broken feature, not as a networking problem —
so the investigation starts in the wrong place.

**Token responses smuggle the host back in.** The backend's WS token endpoints
return an *absolute* `ws_url` pointing at the backing service, e.g.
`POST /agents/deployments/events/token` → `wss://api.agents.hypercli.com/ws/deployments`.
So the host re-enters the app through **data**, not through code, and grepping
the source for it will not find it. WS is not CORS-gated so this still works, but
it is CSP-gated — see rule 6.

**Known-good gateway mapping** (verified against the live gateway):

| Path | Gateway `api.hypercli.com` | Notes |
|---|---|---|
| `/agents/*` | served | REST only: deployments, routines, plans, usage |
| `/v1/*` | served | `/v1/models` 200 (and CORS-enabled on both hosts); `/v1/usage/*` is 404 on *both* |
| `/workspaces` | served | workspaces REST |
| `/routines` | served | routines REST |
| `/slack` | served | slack REST |
| `/ws` | **404** | the gateway proxies no WS at all; WS goes to the backing service |

**Why it looks fine in dev:** dev REST rides the same-origin Vite proxy (and,
historically, the Node dev bridge and the Rust proxy), where CORS does not
exist.

Watch for: `ts-sdk`'s `resolveHyperAgentBaseUrl()` maps `api.hypercli.com` →
`https://api.agents.hypercli.com/v1`, discarding the base URL the caller passed.
Those `/v1` routes do send CORS, so this is not an outage — but it silently
moves traffic off the gateway, which is the host we intend to depend on.
`client.agent.controlBaseUrl` and `client.deployments` resolve to the gateway.

### 5. Every new host gets **two** checks: CSP `connect-src` **and** CORS at the packaged origin.

Add the host to `connect-src` in `src-tauri/tauri.conf.json`, then verify the
host actually allows the packaged origin. Both are required; neither implies the
other.

**Why:** CSP failures and CORS failures look identical from JS (`TypeError:
Failed to fetch`) and both are absent in dev. Adding only the CSP entry produces
a config that *claims* the host is supported when it is not — the state
`https://api.agents.hypercli.com` was in until it was dropped from
`connect-src`.

How to check CORS at the real origin (do not test from `localhost:1420` — it is
a different origin with a different answer):

```bash
curl -si -X OPTIONS 'https://<host>/<path>' \
  -H 'Origin: http://tauri.localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' | grep -i '^access-control'
```

No `access-control-allow-origin` in the response means the webview cannot call
it, whatever the CSP says. Repeat for `tauri://localhost` (macOS/Linux).

### 6. WebSockets are not CORS-gated, but they **are** CSP-gated.

A `wss://` URL needs a matching `connect-src` entry or the connection is blocked
before the handshake. `wss://api.agents.hypercli.com` works fine from the
packaged app *because* it is in `connect-src` — its lack of CORS headers is
irrelevant for WS.

**Corollary:** backend token endpoints return **absolute** `ws_url`s pointing at
`wss://api.agents.hypercli.com/...`. Use them verbatim. Do not "correct" them to
the gateway host — the gateway has no WS bridge; `/ws` (and the historical
`/agents/ws*`) refuse the upgrade there.

### 7. Agent-scoped hosts (`*.hypercli.app`) are in CSP — keep them there.

Agent files go to `https://<agent>.hypercli.app/_reef/...`; the OpenClaw/Hermes
gateway is `wss://<agent>.hypercli.app`. Both are covered by the
`https://*.hypercli.app` / `wss://*.hypercli.app` `connect-src` entries (added
when the files panel shipped). If you touch the files panel or runtime chat,
still verify CORS at the Cloudflare edge for the packaged origin — CSP alone
never implies the host answers our origin.

### 8. CSP has no `script-src`, so `eval` is blocked.

Do not add a dependency that needs `eval`/`new Function` at runtime, and do not
add `'unsafe-eval'` to make one work. `ts-sdk/src/config.ts`'s `(0, eval)('require')`
Node probe is already handled — it throws, is caught, and returns `null`.

---

## Dev-vs-packaged discipline

### 9. `npm run dev` passing proves nothing about the packaged build.

Neither does `npm run typecheck`, `npm run build`, or `npm test`. None of them
exercise the packaged origin, CORS, CSP, Tauri IPC, or the browser bundle at
runtime. `vite build` *succeeds* today while externalizing the not-aliased
Node builtins (`dns`, `node:fs/promises`) into modules that throw on access —
the aliased ones (`fs`, `path`, `node:crypto`) resolve to real shims under
`src/shims/`.

**How to actually verify a network-touching change:**

1. `npm run tauri build`, then run the produced binary. Not `tauri dev` — the dev
   origin is `http://localhost:1420` and gets different CORS answers.
2. Open the webview devtools (right-click → Inspect; on Windows/WebView2 and
   macOS this is available in debug bundles).
3. Exercise the changed screen and watch the console for
   `Refused to connect to ...` (CSP) and `TypeError: Failed to fetch` (CORS or
   CSP), and the network tab for requests that never leave.
4. If you cannot run a packaged build, say so in the PR rather than claiming the
   change is verified.

Note: dev works against the **production** API because REST rides the same-origin
Vite proxy (`/api` prefix), so the `http://localhost:1420` origin never reaches
the gateway. Point `~/.hypercli/config` at
`https://api.dev.hypercli.com/agents` to exercise the dev backend instead.

### 10. Do not rebuild the dev bridge.

`vite.config.ts` once carried a ~700-line `devBridge()` that ran ts-sdk in Node
and served the frontend a parallel implementation of the API over
`/__desktop_ng/*`. It is gone; the file is now ~90 lines and is a plain
pass-through proxy.

The principle it leaves behind is the important part: **dev must not have its own
implementation of anything.** That bridge is why "works in dev, broken when
packaged" was possible at all — Node has no CORS, no CSP, and no custom-protocol
origin, so every class of packaging bug was invisible there.

If dev needs something the packaged app does not have, the answer is a transport
shim (a proxy, an injected credential), never a second implementation. Anything
that answers an API call differently in dev is the bug, not the fix.

### 11. Do not add new `hasTauriInvoke()` / `__TAURI_INTERNALS__` capability gates.

**Why:** every such gate is a feature that exists in exactly one of the two modes,
and the shipped mode is the one that loses. For a while `runtime-client.ts`
returned `!hasTauriInvoke()` for `canChat`, which disabled OpenClaw and Hermes
chat in **every packaged build** — a leftover from when streaming only existed in
the Node bridge. Detecting the shell is fine for cosmetics
(`main.tsx` adds a `tauri-shell` / `browser-shell` class); it is not fine for
deciding whether a feature exists.

### 12. Origin-derived values get baked into agents — be aware of the blast radius.

An OpenClaw agent records the browser origins allowed to drive its control UI
in `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN`. A previous single-origin write
(`window.location.origin` at start) pinned agents to whichever window pressed
Start: `tauri dev` locked out the packaged app until restart. Now
`startOpenClaw()` passes every origin this app can legitimately run at
(`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`), and
the SDK **merges** them into the recorded set instead of replacing it — one
start no longer evicts the other mode. If you touch this, keep the merge
policy: add to the explicit set, never write the ambient origin alone.

---

## SDK usage

### 13. Assume `ts-sdk` is Node-first. Check every new call for Node builtins.

`vite.config.ts` aliases the bare `fs`, `path`, and `node:crypto` specifiers to
real shims under `src/shims/`. It deliberately does **not** alias the
`node:`-prefixed or remaining bare imports — `node:fs/promises`
(`ts-sdk/src/agents.ts`) and `dns` (`ts-sdk/src/jobs.ts`) still externalize into
`__vite-browser-external`, which throws on any property access. The build only
**warns**. If a new SDK call reaches one of those paths, the packaged app throws
at runtime and dev does not.

Before adding an SDK call, grep the implementation for those imports and confirm
the path you hit is guarded (e.g. `randomHexToken` prefers
`globalThis.crypto.getRandomValues` and only falls back to `node:crypto`).

### 14. Typecheck covers the SDK's *types*, and nothing else about it.

`tsconfig.json` has `exclude: ["../ts-sdk"]`, which is easy to misread as "the
SDK is unchecked". It is not: `exclude` only filters the `include` glob, and
files reached through an import are added to the program anyway. Measured:

```bash
npx tsc -p tsconfig.json --noEmit --listFiles | grep -c ts-sdk   # 592
```

So a `satisfies Record<ManagedAgentRuntime, …>` really does fail
`npm run typecheck` and `npm run build` when the SDK's union changes. That is the
mechanism the app's agent vocabulary relies on — see [FSM.md](FSM.md) rule 5.

What typecheck still will **not** tell you: that an SDK function is Node-only,
that it contacts a host you cannot reach, or that you mis-cast its result.
Several call sites in `src/api.ts` launder SDK results through
`as unknown as <DesktopType>`; those casts are unchecked assertions, not
guarantees. And `AgentState` is deliberately forward-open (`| (string & {})`),
so a new backend state can never be a compile error — only an exhaustive switch
at the point a state is shown to a user can make that visible.

### 15. Do not recreate SDK transport state machines in the app.

Reconnect logic, session lifecycle, and gateway connection management already
exist in the SDK. Compose SDK primitives and render SDK state. (Same rule as
`../AGENTS.md`.)

---

## The cross-language launch contract

### 16. `tests/fixtures/buzz-launch-contract.json` is shared with the Python SDK. Do not change agent launch URLs casually.

That fixture is the golden launch contract for coding-agent runtimes. It is
asserted by **both** `ts-sdk/tests/coding-agents.test.ts` and
`sdk/tests/test_coding_agents.py`. Among other things it pins:

```json
"common_env": { "HYPER_ACP_WS_URL": "wss://api.agents.hypercli.com/ws" }
```

**Why this matters here:** the desktop's ACP dial
(`defaultHyperAcpWsUrl()`, `src/api.ts:533`) resolves to the same URL. If you
change how agent launch URLs are derived to make the desktop happy, you change
what agents are launched with, you break the Python SDK's contract test, and you
break every other language client that relies on the same fixture. Changing that
fixture is a cross-language, multi-repo decision — not a desktop fix.

---

## Before you ship a change

- [ ] No new `fetch`/`WebSocket`/`new HyperCLI` outside `src/api.ts`.
- [ ] No edits under `ts-sdk/`.
- [ ] Every backend host the change can reach is listed in `connect-src` in
      `src-tauri/tauri.conf.json`.
- [ ] Every **HTTP** host it reaches is `api.hypercli.com` or
      `api.dev.hypercli.com` — never `api.agents.hypercli.com`.
- [ ] CORS verified at `http://tauri.localhost` (and `tauri://localhost`) for any
      newly reached HTTP host, with the `curl -X OPTIONS` probe above.
- [ ] Any new `wss://` URL has a matching `connect-src` entry.
- [ ] No new `hasTauriInvoke()` / `__TAURI_INTERNALS__` capability gate.
- [ ] No dev-only implementation added to `vite.config.ts` — proxying is fine, answering is not.
- [ ] New SDK calls checked for Node-builtin code paths; `npm run build` shows no
      *new* externalization warnings.
- [ ] `npm run typecheck`, `npm run build`, and `npm test` pass.
- [ ] `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` pass in
      `src-tauri/` if Rust changed.
- [ ] **A packaged build was run and the changed screen was exercised with the
      devtools console open** — or the PR states explicitly that it was not.
- [ ] `tests/fixtures/buzz-launch-contract.json` unchanged, unless the change is
      deliberately cross-language and the Python SDK test was updated too.
- [ ] `FEATURES.md` guardrails still hold (runtime-family separation, streaming
      chat only, shared tool-call trace).
