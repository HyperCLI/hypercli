# HANDOFF.md

State of the desktop app as of the migration to running ts-sdk in the webview.
Rough, ranked, and honest about what is unverified.

Read [AGENTS.md](AGENTS.md) for host/CORS/CSP rules and [FSM.md](FSM.md) for
connection lifecycle before changing anything here.

**Nothing in this working tree is committed.** ~1,100 insertions / ~2,600
deletions across the app, plus new files under `src/lib/`, `src/shims/`, and the
three docs.

---

## 1. What is done and verified

| | Evidence |
|---|---|
| **ACP handshake fix** — the app sent `Sec-WebSocket-Protocol: undefined` and Chrome refused every dial. Cause: `ts-sdk/src/acp.ts:570` calls `new WebSocket(url, protocols, options)`, and a third argument breaks the native constructor. Fixed in `src/ws-browser-shim.ts`. | Measured in Chrome: 2-arg opens, 3-arg fails |
| **Deployment-events hot loop** — reconnected 2-3×/second forever, minting a token each time. The success path had no backoff. | Console went from ~450 warnings/2min to zero |
| **Agent logs** — dialled `?token=undefined`; the endpoint returns its credential as `jwt`, not `token` | Logs now stream |
| **CSP gaps** — `https://*.hypercli.app` (Reef files) and `wss://*.hypercli.app` (OpenClaw gateway) were missing from `connect-src` | Both hosts probed live |
| **Dev/packaged parity** — the ~900-line Vite bridge that ran ts-sdk in Node is gone, replaced by a pass-through proxy plus dev credential injection. Dev now runs the same client, same transport, same failures. | Verified against the live API |
| **Error surfacing** — `ErrorBar` + `connection-errors.ts` classify the opaque `TypeError: Failed to fetch` (CORS and CSP look identical from JS) and publish a reason with an action | Verified live: stubbed fetch → `degraded`, workspace stayed mounted, **no sign-in screen** |
| **State machines** — `machine.ts` (primitive), `fsm.ts` (`sessionMachine`), `agentFsm.ts` (`agentMachine`), all tested | 171 tests, typecheck clean, build green |

---

## 2. What is broken right now

Ranked by user impact. All diagnosed with evidence; none fixed.

### 2.1 OpenClaw chat is dead — one file, highest value
`src/api.ts:659` and `:684` duck-type the session as `{ history(), send(text) }`.
`OpenClawSessionClient` has neither — it has `chatHistory(sessionKey, limit)` and
`chatSend(message, sessionKey, options)` (`ts-sdk/src/session.ts:497, 501`). Both
calls throw `TypeError: session.history is not a function` at runtime, surfacing
as "History unavailable". The `as unknown as` casts hide it from `tsc`.

Also: `connectSession` opens an **unpooled** gateway socket per history load *and*
per send. Use `acquireConnectedGateway` (`agents.ts:3768`), which leases from a
pool keyed by `${id}:${launchEpoch}:${gatewayUrl}`.

### 2.2 Hermes chat is hidden, not missing
`runtime-client.ts:41` says Hermes has no chat because it looks for
`connectSession`. `HermesAgent.connect()` (`agents.ts:3446`) exists and returns a
`HermesSessionClient`; both it and the OpenClaw client implement
`AgentSessionClient`. Before enabling, **measure CORS at the Hermes route host** —
it dials `routeUrl('hermes')`, a third host with no measured posture.

### 2.3 `FAILED` and `DELETED` are handled nowhere
Zero grep hits in `src/`. The SDK has ten canonical states; the app handles five.
- `Sidebar` lists a `FAILED` agent as **live** and offers **Start** on a `DELETED` tombstone
- `ChatPane` renders `FAILED`, `DELETED` and `'unknown'` all as the word **"Stopped"**
- `DangerZone` disables archive *and* delete for a `FAILED` agent, telling the user to "stop the agent first" — a dead end
- Logs mints a JWT and dials for `FAILED`/`DELETED`/`ARCHIVING` agents; the app's inline inactive test covers 2 of the SDK's 5 members
- `targetReached("delete")` waits for absence only, so a `DELETED` tombstone hangs the full 120s

### 2.4 Capabilities are re-derived per panel instead of read
`agentCapabilities()` in `agentFsm.ts` is the single implementation of the
[FSM.md](FSM.md) capability table — and is **referenced only by its own test**.
Consequences: Files is gated on `RUNNING` (should be "agent exists"), and
`capabilities.desktop` is **permanently false** because `App.tsx` passes
`has_desktop` while the machine reads `desktopEnabled`.

### 2.5 Vocabulary duplication
Four runtime lists (`agent-utils.ts`, `api.ts:228`, `NewAgentModal.tsx`, and the
if-chain in `api.ts:291`) and three state vocabularies. They agree on membership
today but not on labels — `runtimeLabel()` yields `"claude code"` while the create
modal says `"Claude Code"`, on the same agent. Nothing catches a miss: these are
`Set<string>` comparisons.

**One-line fix worth doing regardless:** normalise case in `agentSummary()`
(`api.ts:97`). The SDK's predicates uppercase their input; the app compares raw.
If the control plane ever emits `"running"`, every gate silently reads false.

### 2.6 Sessions panel cannot explain itself
`Sidebar.tsx:85` catches every failure and returns an empty list, so a refused
upgrade, an expired token and a genuinely empty list are identical. It also opens
a **full ACP socket per agent every 30s** to list sessions, while chat opens its
own to the same agent. Sessions should be a query on a connected machine.

### 2.7 `App.tsx` is not a wiring layer
406 → **565 lines** after the machine wiring. It carries roster overlays and a
hand-rolled roster-refresh nudge. [FSM.md](FSM.md) rule 7: if App grows a rule,
it is in the wrong file.

### 2.8 `SOCKET_UP` has no sender
`sessionMachine` accepts it to retire socket-caused backoff. Nothing sends it, so
a socket outage keeps inflated backoff (capped at 30s) until a manual retry.

---

## 3. Suggested order

1. **OpenClaw session API** (2.1) — one file, fixes a dead feature
2. **Case normalisation** (2.5) — one line, removes a whole class of silent failure
3. **`FAILED`/`DELETED`** (2.3) — correctness, and a dead-end UI today
4. **Capabilities pass-through** (2.4) — the implementation exists; route the panels through it
5. **Vocabulary consolidation** (2.5) — one table pinned by `satisfies Record<ManagedAgentRuntime, …>`
6. **Hermes** (2.2), gated on the CORS measurement
7. **`App.tsx` slimming** (2.7)
8. **Sessions as a query** (2.6) — needs the chat machine, so last

Then: trim `agentMachine` (769 lines is far more than the remaining job needs —
delete what the SDK does, keep observable state, guards, cancellation, error
publication and the accept→confirmed wait), and move the `acp.ts:570` fix upstream
so `ws-browser-shim.ts` can go back to a plain re-export.

---

## 4. Traps — each of these cost real time

- **Do not adopt `CodingAgent.acpConnect()`.** It derives from
  `deployments.agentApiBase`, which in dev is the Vite proxy base → `ws://localhost:1420/ws`,
  the Vite server, which does not proxy WebSockets. `api.ts:570` correctly uses
  `endpoints.apiBase`.
- **Do not adopt `Deployments.subscribe()`.** It dials without `?token=` and 403s.
- **Do not hold `Agent` instances as state.** `hydrateAgent` builds a new object
  per response with no cache (so `useEffect([agent])` refires on every poll), and
  `fromDict` nulls live credentials (`gatewayToken`, `apiServerKey`).
- **The `ws` alias in `vite.config.ts` is load-bearing.** `acp.ts:563` resolves
  `NodeWebSocket ?? globalThis.WebSocket` — it *prefers* the import. Removing it
  breaks chat.
- **Typecheck does cover ts-sdk.** `exclude` only filters the `include` glob;
  imported files join the program. Verified: 592 ts-sdk files. So a `satisfies`
  against an SDK union really does fail the build.
- **The packaged origin is `http://tauri.localhost` (Windows) / `tauri://localhost`
  (macOS, Linux)** — not derived from the app name, and shared by every Tauri app.
- **`"WebSocket is closed before the connection is established"`** in the console
  means *we* tore down our own in-flight dial. A refused handshake logs something
  else. Treat it as a regression alarm.

---

## 5. Verifying

```bash
npm run typecheck && npx vitest run && npm run build
npm run tauri build -- --no-bundle     # then run the binary
```

Dev proves nothing about CSP — Vite serves the page, so Tauri never injects the
header. Anything touching a host or a socket needs the packaged build.

For live diagnosis, Chrome with `--remote-debugging-port=9222` plus CDP's
`Network.webSocketWillSendHandshakeRequest` shows the actual handshake, which is
how the `undefined` subprotocol was found. Console alone would not have shown it.

---

## 6. Not ours

- **`tauri://` in the OpenClaw origin lock.** `normalizeControlUiOrigin` accepts
  only `http:`/`https:`, so a macOS/Linux packaged build **cannot** authorise
  itself to control an agent. Windows is fine via `http://tauri.localhost`. Needs
  a scheme allowance agent-side.
- The origin lock is also **single-valued and last-writer-wins**, so whoever
  started an agent evicts everyone else. The format already parses a list; only
  the writers collapse it.
