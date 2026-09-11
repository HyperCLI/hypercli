# FSM.md

Connection and lifecycle state lives in explicit state machines, never in
`useEffect` closures. Read [AGENTS.md](AGENTS.md) for *where* to connect; this is
*when*.

Two machines:

| File | Instances | Owns |
|---|---|---|
| `src/lib/fsm.ts` — **sessionMachine** | one, global | is a key set, is it valid, the roster |
| `src/lib/agentFsm.ts` — **agentMachine** | one per agent, pooled | that agent's lifecycle and capabilities |

Both build on `src/lib/machine.ts`, which supplies the one-in-flight guard,
backoff, timers and the pool. All three are built and tested; wiring into the app
is in progress.

Still owned by ad-hoc effects, and next in line: **chat**, **logs**, **shell**,
**files**, and the **session index**. Do not design those here until the first
two have survived a packaged build — the point of this document is to describe
what is true, not what is intended.

---

## Why

Connections used to be owned by effects with ad-hoc `cancelled` booleans, nonce
counters and inline retries. That produced: a token minted and a socket dialled
2-3×/second forever; chat re-dialling on every roster poll; two ACP sockets per
agent; an orphaned log socket per agent switch; a sessions panel that could not
tell empty from broken; and the sign-in screen appearing on a network blip.

Each is unrepresentable once the state is explicit.

---

## sessionMachine — global

```
booting → resolving-credentials → authenticated → roster-loaded ⇄ degraded
                ↓                                        ↓
        unauthenticated | expired  ←─────────────── signing-out
```

- **`Failed to fetch` → `degraded`, never `unauthenticated`.** It is a CORS, CSP
  or offline problem, not a sign-out. Routing it to the sign-in screen is how a
  packaged CSP regression disguises itself as an auth failure.
- **`degraded` keeps the last-known roster**, backs off its refresh, and opens no
  new subscriptions until it recovers.
- **`epoch`** increments on every credential resolution and sign-out. Every
  subscription registers its `AbortController` against it, so sign-out aborts all
  of them and late promises are discarded. It replaces six hand-rolled nonces.
- Nothing agent-scoped mounts before `roster-loaded`.

These state names are **deliberately ours**. Auth and connectivity are an app
concern — the SDK has no opinion on whether a key is set, rejected, or merely
unreachable, and that three-way distinction is the whole point of this machine.
Hand-rolling here is correct; the SDK-owns-the-vocabulary rule applies to agent
state, not to this.

## agentMachine — one per agent

This machine exists for one reason: **the SDK tells you a command was accepted,
not that it took effect.** `startAgent` returns when the control plane says yes;
the agent is then starting, and something has to hold that gap. That gap is the
machine's entire job.

So it owns the *verb*, never the *noun*:

| | Owner |
|---|---|
| What the agent **is** — its state, whether that state is transitional, which runtimes exist | **ts-sdk.** Read it; never shadow it. |
| What we **asked for**, whether it landed, whether the agent got there, and what to do when it didn't | **agentMachine.** |

And be precise about what we even hold: **we do not own the state, we hold a copy
of a projection.** `observed` is not what the agent is — it is the last thing the
backend told the SDK, which told us, at some past moment. It is stale the instant
it is read.

Three consequences, and every one of them has already been got wrong here:

- **Our copy drives display and affordances, never permission.** The backend
  decides what is allowed. Pre-refusing a command because our snapshot looks
  wrong invents a rule we are not entitled to — that is how a `FAILED` agent
  ended up with archive and delete both disabled and the message "stop the agent
  first", with no way out.
- **Send the command and let it be rejected.** A rejection is information from
  the authority; a disabled button is a guess. Guard only where a request is
  incoherent on its face, not where the answer merely looks unlikely.
- **`ABSENT` and `null` describe our copy, not the agent.** "Not in the roster we
  just read" and "we have never read one" are facts about us. Neither is a claim
  about what exists.

The machine keeps no vocabulary of its own for agent state. It does not define a
transitional set, does not re-list runtimes, and does not decide what a state
means — it consumes the SDK's types and predicates, so a state the SDK adds
cannot silently fall through a stale local copy. A parallel vocabulary is the
drift this document exists to prevent, and it is not less dangerous for being
ours.

### The vocabulary

`ts-sdk`'s `AgentState`, in full. This app does not invent members of it and must
not handle a subset:

`CREATING` `STARTING` `RESTORING` `RUNNING` `STOPPING` `STOPPED` `ARCHIVING`
`ARCHIVED` `FAILED` `DELETED`

The union is forward-open (`| (string & {})`), so an unrecognised state must
degrade visibly, never crash and never be silently treated as stopped.

Two SDK predicates classify them, and they are the **only** classification this
app uses:

- `isAgentTransitionalState` → `CREATING STARTING RESTORING STOPPING ARCHIVING`
- `isAgentRuntimeInactiveState` → `STOPPED ARCHIVING ARCHIVED FAILED DELETED`

**These two sets overlap on `ARCHIVING`.** They do not partition, and code that
assumes they do is wrong.

Both predicates normalise case; the app does not. State is therefore normalised
**once**, where it enters the app, so every comparison downstream is correct by
construction rather than by everyone remembering.

The app adds exactly one member the SDK does not have: **`ABSENT`** — "an
authoritative roster did not list this agent". That is a property of a *listing*,
not of an agent, which is why it is ours and why the SDK should not have it.
`null` remains distinct: never observed. Do not confuse either with the SDK's
`DeploymentMetaObservedState`, which is `RUNNING | STOPPED` only and is an
infrastructure reading rather than a lifecycle state.

What the machine actually is:

```
stable ──request──► applying ──accepted──► settling ──roster confirms──► stable
                       │                      │
                       └──── rejected ────────┴──── deadline ────► failed
```

- **`settling` is the state the old code lacked.** A start command returns when
  the control plane *accepts* it, not when the agent runs. Without `settling` the
  button re-enables and lies. The machine waits for the roster to confirm, and on
  a deadline fails naming what it last saw — "still STARTING after 2 minutes" —
  rather than claiming success.
- **A roster refresh that changes nothing does nothing.** This is the property
  that killed the re-dial bug, and it must survive every change.
- **`restart` is one intent, two steps** — `start` only after the roster shows
  stopped. It exists to rewrite the OpenClaw origin allow-list for origin-lock
  recovery, so racing the halves defeats its purpose.
- **Retrying a rejected command is not the same as retrying one that timed out.**
  The first never landed; the second is still in flight, and re-sending it starts
  a second boot. Only the first may re-send.

Runtimes differ underneath — different transports, different capabilities — but
this shape and the table below are identical for all of them. A new runtime adds
no lifecycle logic.

### The contract between the two machines

`sessionMachine` owns the roster; `agentMachine` consumes it. One rule governs
the handoff:

> **A roster is only authoritative when `sessionMachine` says it is.**

Absence from the roster means *the agent is gone* — it confirms a delete and
refuses every other operation. So an empty or partial roster must never be
handed over as if it were complete. `degraded` retains its last-known-good
roster precisely so a failed refresh cannot be mistaken for "everything was
deleted."

---

## Capabilities

What the UI may do is a function of the agent's state, not of what happens to be
mounted. This table is the contract.

| Capability | Requires | Notes |
|---|---|---|
| **Files** | agent exists | Works for stopped agents — storage outlives the container. "Exists" excludes `ABSENT` **and** `DELETED`; a tombstone is not an agent |
| **Routines** | nothing | Backend-side; available even when the agent is archived |
| **Sessions** | `running` | A query on a connected machine — never its own dial |
| **Chat** | `running` | Transport differs per runtime family; availability does not |
| **Logs** | `running` | |
| **Shell** | `running` | |
| **Desktop** | `running` **and** enabled | The route applies at next start |

Two consequences worth stating, because the current code gets both wrong:

- **Files must not be gated on `running`.** Today `ContextPanel` only fetches
  when RUNNING, while its own caption promises stopped agents work.
- **Sessions is a query, not a connection.** The sidebar once opened a full
  ACP socket per agent to list sessions, while chat opened its own to the
  same agent — two clients sharing one stdio session through a tee'ing
  bridge poison each other's request-id space. Now: one connection per
  agent, owned by the `CodingAgentAcpPool` in `api.ts` (the SDK pool is the
  connection authority — refcounted leases, last release closes), shared by
  chat (lease + `addUpdateListener`/`setPermissionHandler`) and the sessions
  sweep (`listSessions` on a borrowed lease).

---

## Guarantees

Every machine satisfies all six. A design that cannot is wrong.

1. **One in-flight operation.** A new trigger supersedes the previous one
   *explicitly* (aborting it) or is rejected by a guard. Never abandon-and-restart.
2. **Teardown is idempotent and safe mid-connect.** Cancelling marks the attempt
   inactive so its completion cannot mutate state, and closes any socket already
   constructed — via `closeSocket`, which waits for `open` rather than yanking a
   handshake.
3. **Backoff belongs to the machine.** No path out of a connection may redial
   without consulting it, including a *clean* close. A manual Retry resets
   backoff; it does not bypass it.
4. **StrictMode must not double-connect.** Handled by `MachinePool` ref-counting
   with deferred disposal, not by suppressing the second invocation.
5. **No silent dead ends.** Every terminal state names a reason and offers a way
   out, publishing to [ErrorBar](src/components/ErrorBar.tsx) via
   [connection-errors.ts](src/lib/connection-errors.ts).
6. **Empty is never indistinguishable from broken.** A machine yielding no data
   must say whether that is a real empty result, an unsupported capability, or a
   failure.

### Worked example: why 5 and 6 are not style points

For weeks every ACP agent showed **"ACP initialize failed"** with a Retry button
that never worked. The actual cause, once someone read the handshake:

```
Sec-WebSocket-Protocol: undefined
Error during WebSocket handshake:
  Sent non-empty 'Sec-WebSocket-Protocol' header but no response was received
```

The app was sending the string `"undefined"` as a subprotocol, because
`ts-sdk`'s ACP client calls `new WebSocket(url, protocols, options)` — the Node
`ws` three-argument shape — and the browser's constructor breaks on the third
argument. No socket ever opened. The agent was healthy the whole time.

Three failures, all of them ours, and each one is a guarantee above:

- **The reason existed and we discarded it.** The browser said exactly what was
  wrong. We replaced it with "initialize failed", which describes a step, not a
  cause. A terminal state must carry the reason it was given.
- **Retry re-sent the identical broken request.** A retry that cannot change the
  outcome is not a way out, it is a loop with a button on it. Offer an action
  only when something about the next attempt differs.
- **"Failed" was indistinguishable from "not ready yet".** So the obvious reading
  — the agent is still booting — was wrong, and nothing in the UI could
  contradict it. That cost far more than the fix did.

The rule this leaves: **a failure that cannot name its cause is a bug in the
machine, not just in the thing that failed.** Anything shaped like `undefined`,
an empty string, or a swallowed `catch` must reach a state with a printable
reason, or it will present as something plausible and wrong.

---

## Rules

1. No `cancelled` booleans, nonce counters, or `setTimeout` retries in
   components. If you need one, you need a machine.
2. Never dial to answer a question. Query the machine that owns the connection.
3. Don't layer a reconnect loop over an SDK that has one. `CodingAgentAcpClient`
   owns reconnect; we own the dial and the mount.
4. A guard rejects; it does not queue. `send()` returning `false` is correct.
5. **The SDK owns agent vocabulary.** State names, transitional checks and
   runtime lists come from `ts-sdk`. If the app needs one the SDK does not
   export, add it there — do not define a local copy, and do not define it in
   more than one place if you must.
6. Machines are pooled at module level. `sessionMachine` starts and stops them;
   cross-machine reads are explicit (`pool.peek(agentId)`), not React context.
7. **`App.tsx` is a wiring layer.** It selects machines, renders by state, and
   passes handlers down. Logic that decides *when* to connect, retry or give up
   belongs in a machine; logic that decides what a panel shows belongs in that
   panel. If App grows a rule, it is in the wrong file.
8. `"WebSocket is closed before the connection is established"` in the console
   means **we** tore down our own in-flight dial — a refused handshake logs
   something else. Treat it as a regression alarm, not noise.
