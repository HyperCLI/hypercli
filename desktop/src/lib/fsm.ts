/**
 * The one global machine: user/session readiness. FSM.md §4.
 *
 * This replaces `App.tsx`'s `auth`/`agents` `useState` pair and the six
 * hand-rolled generation counters that grew around it. Two things here are
 * load-bearing and neither is cosmetic:
 *
 * 1. **`UNREACHABLE` goes to `degraded`, never to `unauthenticated`.** A
 *    `TypeError: Failed to fetch` in a packaged webview is a CORS or CSP
 *    problem — the request never left the app. `App.tsx:145` currently
 *    collapses *every* failure of `authStatus()` into `{signed_in:false}` and
 *    renders the sign-in screen, which is how a `connect-src` regression
 *    disguises itself as an expired key: the user re-enters a perfectly good
 *    API key, it is rejected the same way, and the actual cause never appears.
 *    {@link classifyConnectionError} is the only thing that can tell those
 *    apart from JS, so it decides the edge.
 *
 * 2. **`session.epoch` is the single "everything before this is stale" token.**
 *    It advances on every credential resolution and on every sign-out. Late
 *    promises are discarded by epoch mismatch and subscriptions register their
 *    `AbortController` against it, replacing `sessionNonce`, `retryNonce`,
 *    `reconnectNonce`, `nonce`, `loadNonceRef` and `previewNonceRef`.
 *
 *    **`epoch` alone is not a liveness check.** `expired` deliberately does not
 *    advance it (the credential is dead, but no new one has been resolved), so
 *    between a 401 and the next successful resolution a holder comparing
 *    `machine.epoch === myEpoch` still believes it is current against a
 *    credential the backend has already rejected. Any holder deciding whether
 *    to *act* must consult {@link isReady} or {@link mayOpenSubscriptions} as
 *    well; `epoch` only answers "was this minted before the last cut-over".
 *
 * Guarantee 6 ("empty is never indistinguishable from broken") is structural
 * here: `roster-loaded` with an empty array is a real empty account,
 * `degraded` always carries the {@link ConnectionIssue} that explains why its
 * roster is stale, and `unauthenticated` names *which* kind of signed-out it
 * is. Nothing in this module can produce a silent empty list.
 *
 * Every state that waits on I/O arms a deadline ({@link CREDENTIAL_DEADLINE_MS},
 * {@link ROSTER_DEADLINE_MS}, {@link SIGN_OUT_DEADLINE_MS}) and fails with a
 * stated reason when it lapses. Guarantee 5 is not "most states name a reason";
 * a promise that never settles is exactly how a state becomes a silent dead
 * end, and `api.ts` memoises `sdkPromise`, so one hung `acp_credentials` IPC
 * would otherwise wedge every later `sdk()` caller behind a permanent splash.
 *
 * React bindings do not live here (see `use-machine.ts`); nothing in this file
 * imports React, so the whole thing is testable in plain node.
 */
import {
  Backoff,
  Machine,
  assertNever,
  systemClock,
  type Attempt,
  type BackoffOptions,
  type Clock,
} from "./machine";
import {
  listAgents as apiListAgents,
  logout as apiLogout,
  sdk,
  type AgentSummary,
} from "../api";
import { MissingCredentialError, resolveCredentials, type AcpCredentials } from "./credentials";
import { resolveEndpoints, type Endpoints } from "./endpoints";
import {
  classifyConnectionError,
  clearConnectionIssue,
  reportConnectionIssue,
  type ConnectionIssue,
} from "./connection-errors";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** The SDK client `src/api.ts` builds. Typed through `api.ts` deliberately: no
 *  component or library module outside it constructs one (AGENTS.md rule 1). */
export type SessionClient = Awaited<ReturnType<typeof sdk>>;

/**
 * Everything downstream code needs to talk to the backend, plus the epoch that
 * says when it stopped being current.
 */
export interface Session {
  readonly credentials: AcpCredentials;
  readonly endpoints: Endpoints;
  readonly client: SessionClient;
  /** Advances on every credential resolution and every sign-out. */
  readonly epoch: number;
}

/**
 * Why there is no session. Distinct reasons because the sign-in screen should
 * not accuse a first-run user of having been signed out.
 */
export type UnauthenticatedReason = "no-credential" | "signed-out" | "rejected";

// ---------------------------------------------------------------------------
// States and events
// ---------------------------------------------------------------------------

/**
 * Which of the two independent channels failed.
 *
 * - `"request"` — a request/response call (the credential probe or the roster
 *   GET) failed. The retry loop re-runs that same call, so its own success is
 *   full proof of recovery and resets the backoff.
 * - `"socket"` — a live subscription dropped. The machine has no socket of its
 *   own to re-dial, so the only thing it can probe is HTTP, and HTTP being
 *   healthy says nothing about the socket. Recovery therefore needs its own
 *   signal: {@link SessionEvent} `SOCKET_UP`, sent by whoever owns the
 *   subscription once its socket is actually open. Until that arrives the
 *   backoff keeps growing, so the redial that follows each return to
 *   `roster-loaded` stays paced instead of flapping once a second forever.
 */
export type DegradedCause = "request" | "socket";

export type SessionState =
  | { readonly name: "booting" }
  | {
      readonly name: "resolving-credentials";
      readonly attempt: number;
      /** When this attempt started. It lapses at `since + CREDENTIAL_DEADLINE_MS`. */
      readonly since: number;
    }
  | {
      readonly name: "unauthenticated";
      readonly reason: UnauthenticatedReason;
      /** Present for `no-credential`: what the credential probe actually said. */
      readonly detail: string | null;
    }
  | { readonly name: "authenticated"; readonly session: Session }
  | {
      readonly name: "roster-loaded";
      readonly session: Session;
      readonly roster: AgentSummary[];
      /** When this roster was read. An empty roster here is a real empty one. */
      readonly at: number;
    }
  | {
      readonly name: "degraded";
      /** Null only when the very first credential resolution never completed. */
      readonly session: Session | null;
      /** Last known good roster, retained so the workspace keeps rendering. */
      readonly roster: AgentSummary[];
      readonly issue: ConnectionIssue;
      /**
       * What broke. `"socket"` means a *live channel* dropped while HTTP may be
       * perfectly healthy, which is why a roster success is not proof of
       * recovery for it. See {@link DegradedCause}.
       */
      readonly cause: DegradedCause;
      readonly failures: number;
      readonly retryDelay: number;
      readonly retryAt: number;
    }
  | { readonly name: "expired"; readonly issue: ConnectionIssue }
  | { readonly name: "signing-out"; readonly previous: Session | null };

export type SessionStateName = SessionState["name"];

export type SessionEvent =
  /** Boot probe. Ignored unless `booting`, so StrictMode cannot double-probe. */
  | { readonly type: "BOOT" }
  | { readonly type: "RESOLVED"; readonly attempt: number; readonly session: Session }
  | { readonly type: "ABSENT"; readonly attempt: number; readonly detail: string }
  | { readonly type: "REJECTED"; readonly attempt: number; readonly issue: ConnectionIssue }
  | { readonly type: "UNREACHABLE"; readonly attempt: number; readonly issue: ConnectionIssue }
  | {
      readonly type: "ROSTER_OK";
      readonly epoch: number;
      readonly roster: AgentSummary[];
      /** Set by the machine's own load; absent when pushed from outside. */
      readonly attempt?: number;
    }
  | {
      readonly type: "ROSTER_FAIL";
      readonly epoch: number;
      readonly issue: ConnectionIssue;
      readonly attempt?: number;
    }
  | {
      readonly type: "UNAUTHORIZED";
      readonly epoch: number;
      readonly issue: ConnectionIssue;
      readonly attempt?: number;
    }
  /** A live subscription dropped. Same destination as `ROSTER_FAIL`. */
  | { readonly type: "SOCKET_DOWN"; readonly epoch: number; readonly issue: ConnectionIssue }
  /**
   * A live subscription opened. The counterpart to `SOCKET_DOWN` and the only
   * proof the machine ever gets that the live channel recovered — a roster GET
   * cannot supply it. Sent by the subscription's owner, not by this machine.
   */
  | { readonly type: "SOCKET_UP"; readonly epoch: number }
  /** Refresh on the existing session. Consults backoff; never resets it. */
  | { readonly type: "REFRESH" }
  /** User-initiated retry. Resets backoff, then re-runs the failed work. */
  | { readonly type: "RETRY" }
  /** Internal: the backoff timer came due. */
  | { readonly type: "RETRY_TICK" }
  /** Internal: the in-flight attempt outlived its deadline. */
  | { readonly type: "DEADLINE"; readonly attempt: number; readonly phase: DeadlinePhase }
  | { readonly type: "KEY_SAVED" }
  | { readonly type: "SIGN_OUT" }
  | { readonly type: "TORN_DOWN"; readonly attempt: number };

/** Which piece of I/O a {@link SessionEvent} `DEADLINE` belongs to. */
export type DeadlinePhase = "credentials" | "roster" | "sign-out";

// ---------------------------------------------------------------------------
// Narrow accessors — misuse is a type error where possible, a loud throw where not
// ---------------------------------------------------------------------------

/** States in which a {@link Session} is guaranteed to exist. */
export type SessionfulState = Extract<
  SessionState,
  { name: "authenticated" | "roster-loaded" | "degraded" }
>;

export function hasSession(state: SessionState): state is SessionfulState {
  return state.name === "authenticated" || state.name === "roster-loaded" || state.name === "degraded";
}

/**
 * Throws outside `authenticated | roster-loaded | degraded`.
 *
 * Deliberate: it turns "this component mounted before its prerequisite" from a
 * detail-free `TypeError: Failed to fetch` inside a packaged webview into a
 * dev-time crash at the call site that caused it.
 */
export function sessionOf(state: SessionState): Session {
  if (state.name === "authenticated" || state.name === "roster-loaded") return state.session;
  if (state.name === "degraded") {
    if (state.session) return state.session;
    throw new Error(
      "sessionOf: degraded before any credential ever resolved, so there is no session to use. " +
        "Render the reconnecting splash from `degraded && !state.session`, not the workspace.",
    );
  }
  throw new Error(
    `sessionOf: no session exists in "${state.name}". ` +
      "Only authenticated | roster-loaded | degraded may perform session-scoped I/O.",
  );
}

/** Throws outside `roster-loaded | degraded`. In `degraded` this is the last known good roster. */
export function rosterOf(state: SessionState): AgentSummary[] {
  if (state.name === "roster-loaded" || state.name === "degraded") return state.roster;
  throw new Error(
    `rosterOf: no roster exists in "${state.name}". ` +
      "Only roster-loaded | degraded have one; every other state must render the splash or sign-in.",
  );
}

/**
 * FSM.md §4: `degraded` opens **no new subscription** until it recovers. A
 * socket dialled while the last HTTP call was blocked is a socket that will be
 * blocked too, and retrying it on its own schedule is how the reconnect storm
 * started.
 */
export function mayOpenSubscriptions(state: SessionState): boolean {
  return state.name === "authenticated" || state.name === "roster-loaded";
}

/**
 * The states in which {@link sessionOf} is total — `hasSession` minus the one
 * `degraded` shape that has no session yet, which is what a boot-time
 * `Failed to fetch` produces.
 */
export type ReadySessionState =
  | Extract<SessionState, { name: "authenticated" | "roster-loaded" }>
  | (Extract<SessionState, { name: "degraded" }> & { readonly session: Session });

/**
 * True where the shell (as opposed to splash or sign-in) should render, i.e.
 * exactly where {@link sessionOf} is safe to call.
 *
 * A type predicate rather than a `boolean` on purpose: `sessionOf` in a
 * sessionless `degraded` is a *runtime* crash, and returning `boolean` left
 * TypeScript unable to push callers through the check. Narrowing to
 * {@link ReadySessionState} means `if (isReady(state)) …` makes
 * `state.session` non-null to the compiler, so the guard is the cheap path and
 * skipping it is the one that needs an argument.
 */
export function isReady(state: SessionState): state is ReadySessionState {
  return hasSession(state) && (state.name !== "degraded" || state.session !== null);
}

// ---------------------------------------------------------------------------
// Injectable edges
// ---------------------------------------------------------------------------

export interface SessionDeps {
  /** Rejects when no credential exists at all — that is `unauthenticated`. */
  resolveCredentials(signal: AbortSignal): Promise<AcpCredentials>;
  resolveEndpoints(credentials: AcpCredentials): Endpoints;
  createClient(
    credentials: AcpCredentials,
    endpoints: Endpoints,
    signal: AbortSignal,
  ): Promise<SessionClient>;
  listAgents(session: Session, signal: AbortSignal): Promise<AgentSummary[]>;
  logout(): Promise<void>;
  report(issue: ConnectionIssue): void;
  clearIssue(id: string): void;
}

const defaultDeps: SessionDeps = {
  resolveCredentials: () => resolveCredentials(),
  resolveEndpoints,
  // `api.ts` memoises its client, so this is one extra local IPC per boot and
  // no extra network. Building the client here instead would put SDK
  // construction outside `src/api.ts`, which AGENTS.md rule 1 forbids.
  createClient: () => sdk(),
  listAgents: () => apiListAgents(),
  logout: () => apiLogout(),
  report: reportConnectionIssue,
  clearIssue: clearConnectionIssue,
};

export interface SessionMachineOptions extends Partial<SessionDeps> {
  clock?: Clock;
  /** Backoff for the `degraded` refresh. Defaults to 1s → 30s, doubling. */
  backoff?: BackoffOptions;
}

const RETRY_TIMER = "roster-retry";
const DEADLINE_TIMER = "attempt-deadline";
const MANUAL_RETRY_TIMER = "manual-retry";

/** How long `resolving-credentials` may wait before it is a failure, not a wait. */
export const CREDENTIAL_DEADLINE_MS = 20_000;
/** How long a roster load may wait. Bounds `authenticated`, which is otherwise
 *  a dead end that also reports `mayOpenSubscriptions === true`. */
export const ROSTER_DEADLINE_MS = 20_000;
/** How long `signing-out` waits for the backend before dropping local state anyway. */
export const SIGN_OUT_DEADLINE_MS = 10_000;
/**
 * Minimum spacing between manual retries. FSM.md §3: a manual Retry *resets*
 * backoff, it does not *bypass* it — without a floor, twenty clicks on the
 * error bar are twenty `listAgents` calls at t=0. Clicks inside the floor are
 * not dropped; they collapse into one attempt at the end of it.
 */
export const MANUAL_RETRY_FLOOR_MS = 1000;

/**
 * "There is no credential here at all" — the one failure of the credential
 * probe that means `unauthenticated` rather than `degraded`.
 *
 * The classification is an allow-list, and the default is `degraded`. Testing
 * for the *specific* condition that means "no key" and degrading everything
 * else makes the dangerous edge the one that has to be proven: a positively
 * identified missing credential is a sign-out, while anything the classifier
 * cannot name falls to a retrying splash.
 *
 * The sentinel lives next to the throw, in `credentials.ts`, which also
 * normalises the known Rust `ConfigError` strings `acp_credentials` can
 * reject with (`rs-sdk/src/config.rs` — see
 * `RUST_ABSENT_CREDENTIAL_MESSAGES`). That is what this check *cannot* be:
 * a regex over message fragments. The messages used to be matched loosely
 * from here, and the first Rust rewording ("no HyperCLI credential found…")
 * silently re-routed fresh installs to an endless sessionless `degraded`
 * splash instead of the sign-in screen.
 */
function isMissingCredential(error: unknown): boolean {
  return error instanceof MissingCredentialError;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** A deadline lapse, as an issue. Built by hand rather than run through
 *  {@link classifyConnectionError}, which would read a plain timeout `Error`
 *  as `unknown` and, before R1, as "no credential". */
function timeoutIssue(
  phase: DeadlinePhase,
  detail: string,
  hint: string,
  host: string | null = null,
): ConnectionIssue {
  return {
    id: `timeout:${phase}`,
    kind: host ? "server" : "unknown",
    title: "The app gave up waiting",
    detail,
    hint,
    host,
    agentId: null,
    action: { label: "Retry", kind: "retry" },
    at: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// SessionMachine
// ---------------------------------------------------------------------------

export class SessionMachine extends Machine<SessionState, SessionEvent> {
  private readonly deps: SessionDeps;
  private readonly backoff: Backoff;

  /** Monotonic. The session's epoch is the value at the time it was built. */
  private epochCounter = 0;
  /** Survives a transient failure so `degraded` can retain both. */
  private live: Session | null = null;
  private lastRoster: AgentSummary[] = [];
  /** Clock time of the last manual retry that was actually performed. */
  private lastManualRetry: number | null = null;

  constructor(options: SessionMachineOptions = {}) {
    super({ name: "booting" }, options.clock ?? systemClock);
    const { clock: _clock, backoff, ...deps } = options;
    void _clock;
    this.deps = { ...defaultDeps, ...deps };
    this.backoff = new Backoff(backoff ?? { base: 1000, max: 30_000, factor: 2 });
  }

  /**
   * The current staleness token. Anything holding a lower one is stale.
   *
   * Not a liveness check: `expired` deliberately does not advance it, so a
   * holder that only compares epochs still believes it is current against a
   * just-401'd credential. Pair it with {@link isReady} or
   * {@link mayOpenSubscriptions} before acting.
   */
  get epoch(): number {
    return this.epochCounter;
  }

  /** Convenience for callers that only need the delay currently armed. */
  get retryFailures(): number {
    return this.backoff.failures;
  }

  protected reduce(state: SessionState, event: SessionEvent): void {
    switch (event.type) {
      // -- boot / credential resolution -------------------------------------
      case "BOOT":
        // Idempotent by construction. React <StrictMode> invokes the boot
        // effect twice; a second probe here would be a second `acp_credentials`
        // IPC and, worse, a second SDK client.
        if (state.name !== "booting") return;
        this.beginResolve();
        return;

      case "KEY_SAVED":
        if (state.name !== "unauthenticated" && state.name !== "expired") return;
        this.backoff.reset();
        this.beginResolve();
        return;

      case "RESOLVED": {
        if (!this.slot.owns(event.attempt)) return;
        if (state.name !== "resolving-credentials") return;
        this.live = event.session;
        this.backoff.reset();
        this.clearAfter(RETRY_TIMER);
        this.commit({ name: "authenticated", session: event.session });
        this.beginRoster(event.session);
        return;
      }

      case "ABSENT": {
        if (!this.slot.owns(event.attempt)) return;
        this.endAttempt();
        this.clearAfter();
        this.live = null;
        this.lastRoster = [];
        this.commit({ name: "unauthenticated", reason: "no-credential", detail: event.detail });
        return;
      }

      case "REJECTED": {
        if (!this.slot.owns(event.attempt)) return;
        this.toExpired(event.issue);
        return;
      }

      case "UNREACHABLE": {
        if (!this.slot.owns(event.attempt)) return;
        // The load-bearing edge. This is a reachability failure, not a
        // sign-out: sending it to `unauthenticated` is the bug FSM.md §1 names.
        this.toDegraded(event.issue, "request");
        return;
      }

      // -- roster -----------------------------------------------------------
      case "ROSTER_OK": {
        const session = this.sessionFor(state, event.epoch, event.attempt);
        if (!session) return;
        // Unconditionally, including for a pushed event that names no attempt.
        // An external push is by definition newer than whatever `listAgents`
        // call is still open; leaving that call running let the older read land
        // second and rewind the roster to a value the pusher had already
        // superseded.
        this.endAttempt();
        this.clearAfter(RETRY_TIMER);
        // A roster read proves the request channel works. It proves nothing
        // about a dropped socket, so a socket-caused degradation keeps its
        // backoff until `SOCKET_UP` says the live channel is actually back —
        // otherwise every redial-fail-recover cycle resets the pacing and the
        // "recovery" becomes a one-second reconnect loop.
        if (state.name !== "degraded" || state.cause === "request") this.backoff.reset();
        this.lastRoster = event.roster;
        this.commit({
          name: "roster-loaded",
          session,
          roster: event.roster,
          at: this.clock.now(),
        });
        return;
      }

      case "ROSTER_FAIL":
      case "SOCKET_DOWN": {
        const attempt = event.type === "ROSTER_FAIL" ? event.attempt : undefined;
        const session = this.sessionFor(state, event.epoch, attempt);
        if (!session) return;
        this.toDegraded(event.issue, event.type === "SOCKET_DOWN" ? "socket" : "request");
        return;
      }

      case "SOCKET_UP": {
        // The live channel is back. This is the only evidence that exists for
        // it, so it is also the only thing that may retire the pacing a
        // `SOCKET_DOWN` established.
        if (this.epochCounter !== event.epoch) return;
        this.backoff.reset();
        if (state.name === "degraded" && state.cause === "socket" && state.session) {
          // The channel came back on its own. Confirm the request channel and
          // leave through the normal door; this is evidence of recovery, not a
          // schedule being bypassed (guarantee 3).
          this.clearAfter(RETRY_TIMER);
          this.beginRoster(state.session);
        }
        return;
      }

      case "UNAUTHORIZED": {
        const session = this.sessionFor(state, event.epoch, event.attempt);
        if (!session) return;
        this.toExpired(event.issue);
        return;
      }

      case "REFRESH": {
        if (state.name === "authenticated" || state.name === "roster-loaded") {
          this.beginRoster(state.session);
        }
        // In `degraded` the backoff timer owns the schedule; a refresh request
        // must not bypass it (guarantee 3). Use RETRY for a user-driven retry.
        return;
      }

      case "RETRY": {
        // The guard runs *first*. A guard rejects; it does not queue (FSM.md §7
        // rule 4) — and a rejected event must leave no trace, so resetting the
        // backoff and cancelling the retry timer before deciding whether to
        // reject was a mutation on a path that does nothing else.
        if (state.name === "resolving-credentials" || state.name === "signing-out") return;

        // FSM.md §3: a manual retry resets backoff; it does not bypass it.
        // Without a floor, twenty clicks on the error bar are twenty
        // `listAgents` calls at t=0 — the very shape of the storm this module
        // was written to delete. Clicks inside the floor are not dropped: they
        // collapse into a single attempt armed for the end of it, so the last
        // click still produces one retry and the user sees an outcome.
        const now = this.clock.now();
        const sinceLast = this.lastManualRetry === null ? Infinity : now - this.lastManualRetry;
        if (sinceLast < MANUAL_RETRY_FLOOR_MS) {
          this.after(MANUAL_RETRY_TIMER, MANUAL_RETRY_FLOOR_MS - sinceLast, { type: "RETRY" });
          return;
        }

        this.lastManualRetry = now;
        this.clearAfter(MANUAL_RETRY_TIMER);
        this.backoff.reset();
        this.clearAfter(RETRY_TIMER);
        switch (state.name) {
          case "authenticated":
          case "roster-loaded":
            this.beginRoster(state.session);
            return;
          case "degraded":
            if (state.session) this.beginRoster(state.session);
            else this.beginResolve();
            return;
          case "unauthenticated":
          case "expired":
          case "booting":
            this.beginResolve();
            return;
          default:
            return assertNever(state, "Unhandled session state");
        }
      }

      case "RETRY_TICK": {
        if (state.name !== "degraded") return;
        if (state.session) this.beginRoster(state.session);
        else this.beginResolve();
        return;
      }

      /**
       * A promise that never settles is how a state becomes a silent dead end
       * (guarantee 5). Three of them were reachable: a hung `acp_credentials`
       * IPC or `sdk()` left `resolving-credentials` with no timer, no issue and
       * `RETRY` explicitly refused; a hung `listAgents` left `authenticated`
       * the same way *while still reporting `mayOpenSubscriptions === true`*;
       * and a hung `logout()` left `signing-out` with no event able to leave
       * it. Every one of them showed the user a splash forever.
       */
      case "DEADLINE": {
        if (!this.slot.owns(event.attempt)) return;
        switch (event.phase) {
          case "credentials":
            this.toDegraded(
              timeoutIssue(
                "credentials",
                `The sign-in check didn't answer within ${Math.round(CREDENTIAL_DEADLINE_MS / 1000)}s.`,
                "The credential lookup is local, so this usually means the app's IPC bridge or the SDK client is wedged rather than that anything is wrong with your key.",
              ),
              "request",
            );
            return;
          case "roster":
            this.toDegraded(
              timeoutIssue(
                "roster",
                `Loading agents didn't answer within ${Math.round(ROSTER_DEADLINE_MS / 1000)}s.`,
                "The last known list is still shown. This retries on its own.",
                // `isReady`, not `hasSession`: only the former rules out the
                // sessionless `degraded` shape (R4 — this is the narrowing).
                isReady(state) ? hostOf(state.session.endpoints.httpBase) : null,
              ),
              "request",
            );
            return;
          case "sign-out":
            // Local state drops regardless — the alternative is a session the
            // user believes is gone and a screen that never changes.
            this.deps.report(
              timeoutIssue(
                "sign-out",
                `Signing out didn't answer within ${Math.round(SIGN_OUT_DEADLINE_MS / 1000)}s, so this app signed out locally anyway.`,
                "The key may still be active on the server. Rotate it there if that matters.",
              ),
            );
            this.finishSignOut();
            return;
          default:
            return assertNever(event.phase, "Unhandled deadline phase");
        }
      }

      // -- sign-out ---------------------------------------------------------
      case "SIGN_OUT": {
        if (!hasSession(state) && state.name !== "expired") return;
        this.beginSignOut(hasSession(state) ? state.session : null);
        return;
      }

      case "TORN_DOWN": {
        if (!this.slot.owns(event.attempt)) return;
        this.endAttempt();
        this.clearAfter();
        this.commit({ name: "unauthenticated", reason: "signed-out", detail: null });
        return;
      }

      default:
        return assertNever(event, "Unhandled session event");
    }
  }

  // -------------------------------------------------------------------------
  // Effects. Every one takes the single attempt slot; every continuation is
  // guarded by `slot.owns(attempt)` before it touches state (guarantee 1).
  // -------------------------------------------------------------------------

  /**
   * Take the slot and arm the deadline for it in one step, so a state that
   * waits on I/O cannot be added without also bounding the wait.
   */
  private beginAttempt(phase: DeadlinePhase, ms: number): Attempt {
    const attempt = this.slot.begin();
    this.after(DEADLINE_TIMER, ms, { type: "DEADLINE", attempt: attempt.id, phase });
    return attempt;
  }

  /** Cancel the in-flight attempt and disarm its deadline. Idempotent. */
  private endAttempt(): void {
    this.slot.cancel();
    this.clearAfter(DEADLINE_TIMER);
  }

  private beginResolve(): void {
    this.clearAfter(RETRY_TIMER);
    const attempt = this.beginAttempt("credentials", CREDENTIAL_DEADLINE_MS);
    this.commit({ name: "resolving-credentials", attempt: attempt.id, since: this.clock.now() });
    void this.runResolve(attempt);
  }

  private async runResolve(attempt: Attempt): Promise<void> {
    try {
      const credentials = await this.deps.resolveCredentials(attempt.signal);
      if (!this.slot.owns(attempt)) return;
      const endpoints = this.deps.resolveEndpoints(credentials);
      const client = await this.deps.createClient(credentials, endpoints, attempt.signal);
      if (!this.slot.owns(attempt)) return;
      const session: Session = { credentials, endpoints, client, epoch: ++this.epochCounter };
      this.send({ type: "RESOLVED", attempt: attempt.id, session });
    } catch (error) {
      if (!this.slot.owns(attempt)) return;
      const issue = classifyConnectionError(error, { operation: "Sign-in check" });
      if (issue.kind === "auth") {
        this.send({ type: "REJECTED", attempt: attempt.id, issue });
        return;
      }
      // Only a *positively identified* missing credential is a sign-out. The
      // default is `degraded`, because the classifier cannot recognise every
      // reachability failure and the cost of the two mistakes is not
      // symmetric: a degraded first-run user sees a reconnecting splash and a
      // Retry, while an unauthenticated user with a blocked fetch is told to
      // re-enter a key that was never the problem (FSM.md §1). The nominal
      // check is {@link isMissingCredential}; the message normalisation that
      // feeds it lives in `credentials.ts`.
      if (isMissingCredential(error)) {
        this.send({ type: "ABSENT", attempt: attempt.id, detail: describe(error) });
        return;
      }
      this.send({ type: "UNREACHABLE", attempt: attempt.id, issue });
    }
  }

  private beginRoster(session: Session): void {
    const attempt = this.beginAttempt("roster", ROSTER_DEADLINE_MS);
    void this.runRoster(session, attempt);
  }

  private async runRoster(session: Session, attempt: Attempt): Promise<void> {
    try {
      const roster = await this.deps.listAgents(session, attempt.signal);
      if (!this.slot.owns(attempt) || this.epochCounter !== session.epoch) return;
      this.send({ type: "ROSTER_OK", epoch: session.epoch, attempt: attempt.id, roster });
    } catch (error) {
      if (!this.slot.owns(attempt) || this.epochCounter !== session.epoch) return;
      const issue = classifyConnectionError(error, {
        operation: "Load agents",
        url: session.endpoints.httpBase,
      });
      if (issue.kind === "auth") {
        this.send({ type: "UNAUTHORIZED", epoch: session.epoch, attempt: attempt.id, issue });
        return;
      }
      this.send({ type: "ROSTER_FAIL", epoch: session.epoch, attempt: attempt.id, issue });
    }
  }

  /**
   * Ordered teardown: cancel the in-flight attempt, `await logout()`, drop the
   * session, bump the epoch, *then* announce it. Bumping the epoch before the
   * logout resolves would let a component re-subscribe against a credential
   * the backend has already forgotten.
   */
  private beginSignOut(session: Session | null): void {
    this.clearAfter();
    // Aborts whatever was in flight, and bounds the logout itself: a backend
    // that never answers must not leave `signing-out` with no way out.
    const attempt = this.beginAttempt("sign-out", SIGN_OUT_DEADLINE_MS);
    this.commit({ name: "signing-out", previous: session });
    void this.runSignOut(attempt);
  }

  private async runSignOut(attempt: Attempt): Promise<void> {
    try {
      await this.deps.logout();
    } catch (error) {
      // A failed logout still drops local state: the alternative is a session
      // the user believes is gone. The reason is surfaced, not swallowed.
      this.deps.report(
        classifyConnectionError(error, { operation: "Sign out" }),
      );
    }
    if (!this.slot.owns(attempt)) return;
    this.clearAfter(DEADLINE_TIMER);
    this.live = null;
    this.lastRoster = [];
    this.backoff.reset();
    this.epochCounter += 1;
    this.send({ type: "TORN_DOWN", attempt: attempt.id });
  }

  /** The teardown half of a sign-out, for when the backend never answers. */
  private finishSignOut(): void {
    this.endAttempt();
    this.clearAfter();
    this.live = null;
    this.lastRoster = [];
    this.backoff.reset();
    this.epochCounter += 1;
    this.commit({ name: "unauthenticated", reason: "signed-out", detail: null });
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  /**
   * Accept a roster-scoped event only when it belongs to the live session and,
   * if it names one, to the live attempt. This is the whole of what six nonce
   * counters used to do.
   */
  private sessionFor(
    state: SessionState,
    epoch: number,
    attempt: number | undefined,
  ): Session | null {
    if (attempt !== undefined && !this.slot.owns(attempt)) return null;
    const session = hasSession(state) ? state.session : null;
    if (!session || session.epoch !== epoch) return null;
    if (this.epochCounter !== epoch) return null;
    return session;
  }

  private toDegraded(issue: ConnectionIssue, cause: DegradedCause): void {
    // **Cancel first.** Degrading while an attempt is still open is how a read
    // that started *before* the outage lands *after* it and un-degrades a live
    // failure: the roster rewinds to `roster-loaded`, the backoff that would
    // have paced recovery is reset, the retry timer is cleared and the issue is
    // dismissed — while whatever actually broke is still broken and nothing is
    // left to re-probe it. `toExpired` and the `ABSENT` edge always cancelled;
    // this one did not, which made `SOCKET_DOWN` racing a roster GET a
    // guarantee-3 hole inside the module written to close it.
    this.endAttempt();
    const previous = this.state;
    if (previous.name === "degraded" && previous.issue.id !== issue.id) {
      // A degraded→degraded hop with a different cause: the old issue has no
      // owner left to clear it.
      this.deps.clearIssue(previous.issue.id);
    }
    // Terminal-with-a-reason states publish; the bar is the one error surface.
    this.deps.report(issue);
    const delay = this.backoff.next();
    this.after(RETRY_TIMER, delay, { type: "RETRY_TICK" });
    this.commit({
      name: "degraded",
      session: this.live,
      roster: this.lastRoster,
      issue,
      cause,
      failures: this.backoff.failures,
      retryDelay: delay,
      retryAt: this.clock.now() + delay,
    });
  }

  private toExpired(issue: ConnectionIssue): void {
    this.endAttempt();
    this.clearAfter();
    this.deps.report(issue);
    // The credential itself was rejected, so the session and everything read
    // with it are worthless. Keeping them would let a stale roster render
    // behind a sign-in screen.
    this.live = null;
    this.lastRoster = [];
    this.commit({ name: "expired", issue });
  }

  /**
   * `degraded` owns its issue for exactly as long as it is `degraded`.
   *
   * Clearing it only on recovery left it pinned to the bar on every other
   * exit: "couldn't reach the server" behind the sign-in screen after
   * `SIGN_OUT`, `blocked:unknown` still up while the app tells a first-run user
   * they have no key, an orphaned blocked issue under an expiry. The bar is a
   * shared surface, so anything published here has to be retracted here.
   */
  protected onExit(previous: SessionState, next: SessionState): void {
    if (previous.name === "degraded" && next.name !== "degraded") {
      this.deps.clearIssue(previous.issue.id);
    }
  }

  protected onDispose(): void {
    if (this.state.name === "degraded") this.deps.clearIssue(this.state.issue.id);
    this.live = null;
    this.lastRoster = [];
  }
}

// ---------------------------------------------------------------------------
// Module singleton
// ---------------------------------------------------------------------------

/**
 * The app's one session machine. FSM.md §7 rule 6: machines are pooled at
 * module level and this is the only thing that starts the others.
 *
 * Declared `let` rather than `const` so {@link resetSessionMachine} can replace
 * it: ES module bindings are live, so importers see the replacement without
 * having to route through a getter.
 */
export let sessionMachine = new SessionMachine();

/** True in `vite dev` and under vitest; statically false in a production build,
 *  so the guard below folds away with the branch it protects. */
function isDevOrTest(): boolean {
  const env = import.meta.env as { DEV?: boolean; MODE?: string } | undefined;
  return Boolean(env?.DEV) || env?.MODE === "test";
}

/**
 * Dispose the current machine and install a fresh one. **Tests only**, and now
 * enforced rather than merely documented.
 *
 * Every live subscriber is bound to the old instance through
 * `useSyncExternalStore`, so calling this in a shipped build disposes the
 * machine the UI is watching and installs one nothing is subscribed to: the
 * app freezes on whatever it last rendered, with no error and no event able to
 * move it. A doc comment is not a guard against that.
 */
export function resetSessionMachine(options: SessionMachineOptions = {}): SessionMachine {
  if (!isDevOrTest()) {
    throw new Error(
      "resetSessionMachine is a test-only hatch: it disposes the machine every live " +
        "subscriber is bound to and installs one nothing is watching, which freezes the UI " +
        "silently. Send SIGN_OUT / KEY_SAVED instead.",
    );
  }
  sessionMachine.dispose();
  sessionMachine = new SessionMachine(options);
  return sessionMachine;
}
