/**
 * Per-leg turn driver for centrally managed ACP sessions (sessions/README §4).
 *
 * One {@link AcpTurnDriver} instance drives one (agent, sessionId) leg over a
 * {@link CodingAgentAcpClient} (or a pooled lease). It owns three disciplines
 * the adapters must never be relied on for:
 *
 * - **Pending-window-is-the-queue**: `submit()` appends to the window; an idle
 *   leg flushes the whole window as ONE `session/prompt`. Turn state per leg:
 *   `idle → submitted (prompt RPC sent) → running (turn_started, when a pod
 *   emits it) → idle`.
 * - **One in-flight turn per leg**, enforced here — codex corrupts cancel
 *   routing on concurrent prompts, so the window never sends prompt N+1 before
 *   turn N is committed.
 * - **Commit-before-settlement**: a turn completes on the `session/prompt`
 *   RESPONSE (stopReason) — hyper-acp is a pure passthrough and emits no
 *   vendor frames, so the response is the only turn-end evidence the RPC
 *   owner needs. The window's half-cursor advances (bundled messages leave
 *   the window, waiting `submit()` promises resolve, the next bundle
 *   flushes) ONLY after the caller's durable `commit` hook resolves.
 *
 * Vendor frames (`_hypercli.dev/turn_started` / `_hypercli.dev/turn_ended`)
 * are CONFIRMATION-ONLY when a pod emits them: they bind the turnId (the
 * prompt's JSON-RPC request id) for commit, but never complete a turn. The
 * driver is fully functional with zero vendor frames; `turn_ended_ack` is
 * not part of the wire contract and is never sent.
 *
 * Error semantics mirror the py-sdk AmbiguousDelivery fence: a prompt send
 * failure leaves the window UNTOUCHED (bundled messages re-bundle on the next
 * `submit()`), surfaces the error, and never auto-retries. Caller-side
 * timeouts are not turn end: the driver keeps awaiting the real response,
 * so abandoning the `submit()` promise never abandons completion tracking.
 *
 * Protocol-version awareness: the driver's whole surface (`session/prompt`,
 * `session/cancel`, `session/update`, vendor turn frames) is identical in
 * ACP v1 and v2, so the fallback-completion discipline above is
 * version-agnostic by construction.
 */
import {
  type CodingAgentAcpClient,
  type CodingAgentAcpTurnEvent,
  type CodingAgentAcpTurnId,
  type ContentBlock,
} from './acp.js';
import type { AcpLease } from './acp-pool.js';

/**
 * Framing header prepended to the first text block of every bundle so a
 * bundled transcript never STARTS with `/` — claude/codex/pi adapters parse
 * block 0 for slash commands with side effects (`/plan`, `/compact`,
 * `/clear`) and a window whose first message is a slash command would
 * misfire (sessions/README §4.2 step 4).
 */
export const ACP_BUNDLE_FRAMING_HEADER = '[hypercli conversation context]';

export type AcpTurnDriverState = 'idle' | 'submitted' | 'running';

/** Settlement of one turn covering a submitted message. */
export interface AcpTurnOutcome {
  /**
   * The session/prompt JSON-RPC request id. Only recoverable when the pod
   * emitted a vendor turn frame for this turn; pure-passthrough pods (the
   * current hyper-acp) complete with `null`.
   */
  turnId: CodingAgentAcpTurnId | null;
  stopReason: string;
}

export interface AcpTurnBundle {
  sessionId: string;
  /** Window messages bundled into this prompt, chronological. */
  messages: string[];
  /** The exact `session/prompt` payload sent: one text block per message. */
  blocks: ContentBlock[];
}

export interface AcpTurnDriverOptions {
  sessionId: string;
  /**
   * Durable-commit hook run when a turn completes (on the prompt response).
   * Window advance, submit-promise resolution, and the next bundle's flush
   * all happen only after this resolves. Receives the stopReason verbatim
   * (`end_turn`, `cancelled`, ...) and the turnId when a vendor frame bound
   * one (otherwise `null` — see {@link AcpTurnOutcome.turnId}); cancelled
   * turns commit normally — their bundled messages reached the model.
   */
  commit: (turnId: CodingAgentAcpTurnId | null, stopReason: string) => Promise<void>;
  /** Fired once per flush with the bundle going on the wire. */
  onBundleOpen?: (bundle: AcpTurnBundle) => void;
  /**
   * Soft errors: prompt send failure and commit failure. In both cases the
   * leg returns to idle with the window NOT advanced (messages re-bundle on
   * the next submit — there is no pod-side retention or re-delivery) and
   * nothing auto-retries.
   */
  onError?: (error: Error) => void;
}

interface TurnWaiter {
  promise: Promise<AcpTurnOutcome>;
  resolve(outcome: AcpTurnOutcome): void;
  reject(error: Error): void;
}

interface PendingMessage {
  text: string;
  waiter: TurnWaiter;
}

interface InFlightTurn {
  /** Window entries covered by this turn (dropped from the window on commit). */
  entries: PendingMessage[];
  /** Bound by a vendor turn frame when one arrives; `null` on passthrough pods. */
  turnId: CodingAgentAcpTurnId | null;
}

function newTurnWaiter(): TurnWaiter {
  let resolve!: (outcome: AcpTurnOutcome) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AcpTurnOutcome>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The promise is optional for callers; never let an ignored rejection trip
  // the runtime's unhandled-rejection guard.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class AcpTurnDriver {
  private readonly client: CodingAgentAcpClient;
  private readonly leaseRelease: (() => void) | null = null;
  private readonly options: AcpTurnDriverOptions;
  private readonly unsubscribe: () => void;
  private readonly window: PendingMessage[] = [];
  private state: AcpTurnDriverState = 'idle';
  private inFlight: InFlightTurn | null = null;
  private closed = false;

  constructor(source: CodingAgentAcpClient | AcpLease, options: AcpTurnDriverOptions) {
    // Duck-typed: an AcpLease carries `client` + `release`, the bare client
    // does not. (Structural fakes therefore take the bare-client branch.)
    if (typeof (source as AcpLease).release === 'function' && (source as AcpLease).client !== undefined) {
      const lease = source as AcpLease;
      this.client = lease.client;
      this.leaseRelease = lease.release;
    } else {
      this.client = source as CodingAgentAcpClient;
    }
    this.options = options;
    this.unsubscribe = this.client.onTurnEvent((event) => this.handleTurnEvent(event));
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  /** `idle | submitted | running` — the per-leg turn state machine. */
  get turnState(): AcpTurnDriverState {
    return this.state;
  }

  /** turnId of the in-flight turn once a vendor frame has bound it. */
  get currentTurnId(): CodingAgentAcpTurnId | null {
    return this.inFlight?.turnId ?? null;
  }

  /** Messages waiting in the pending window, including the in-flight bundle. */
  get pendingCount(): number {
    return this.window.length;
  }

  /**
   * Append a message to the pending window. An idle leg flushes the whole
   * window as one bundle immediately; a busy leg picks it up as a single
   * follow-up bundle when the current turn commits.
   *
   * The returned promise resolves when the turn that first bundles this
   * message commits; it rejects when that attempt's send or commit fails
   * (the message stays queued and rides the next bundle's attempt). Callers
   * may always walk away — a caller-side timeout on this promise is NOT turn
   * end, the driver keeps awaiting the real response and settles normally.
   */
  submit(text: string): Promise<AcpTurnOutcome> {
    if (this.closed) return Promise.reject(new Error('AcpTurnDriver is closed'));
    if (text.length === 0) {
      return Promise.reject(new Error('AcpTurnDriver.submit() expects a non-empty text message'));
    }
    const waiter = newTurnWaiter();
    this.window.push({ text, waiter });
    this.flush();
    return waiter.promise;
  }

  /**
   * Detach from the client's turn events and release the pool lease when this
   * driver was built from one. A client passed directly is NOT closed.
   * Outstanding `submit()` promises reject; an in-flight turn keeps running
   * pod-side but its response is no longer consumed here (mirrors the py-sdk
   * driver's close dropping its prompt waiter).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    // Every in-flight bundle entry is still in the window (entries leave only
    // on commit), so rejecting the whole window settles every live waiter.
    const error = new Error('AcpTurnDriver is closed');
    for (const entry of this.window) entry.waiter.reject(error);
    this.inFlight = null;
    this.state = 'idle';
    this.leaseRelease?.();
  }

  private flush(): void {
    if (this.closed || this.state !== 'idle' || this.window.length === 0) return;
    const entries = [...this.window];
    const texts = entries.map((entry) => entry.text);
    const blocks: ContentBlock[] = texts.map((text) => ({ type: 'text', text }));
    blocks[0] = { type: 'text', text: `${ACP_BUNDLE_FRAMING_HEADER}\n${texts[0]}` };
    const flight: InFlightTurn = { entries, turnId: null };
    this.state = 'submitted';
    this.inFlight = flight;
    const bundle: AcpTurnBundle = {
      sessionId: this.options.sessionId,
      messages: texts,
      blocks,
    };
    try {
      this.options.onBundleOpen?.(bundle);
    } catch (error) {
      console.error('AcpTurnDriver onBundleOpen listener threw', error);
    }
    this.client.prompt(this.options.sessionId, blocks).then(
      (response) => this.onPromptResponse(flight, response),
      (error: unknown) => this.onPromptFailed(flight, error),
    );
  }

  /**
   * The prompt response IS turn end (pure-passthrough hyper-acp emits no
   * frames). It is awaited internally for as long as it takes — a caller who
   * timed out its `submit()` promise changes nothing here.
   */
  private onPromptResponse(flight: InFlightTurn, response: { stopReason: string }): void {
    if (this.closed || this.inFlight !== flight) return;
    void this.completeTurn(flight, response.stopReason);
  }

  /**
   * AmbiguousDelivery discipline: the prompt may or may not have landed, so
   * the window is NOT advanced (its messages re-bundle on the next submit),
   * the turn's waiters reject, the leg returns to idle with the error
   * surfaced, and nothing retries.
   */
  private onPromptFailed(flight: InFlightTurn, error: unknown): void {
    if (this.closed || this.inFlight !== flight) return;
    this.inFlight = null;
    this.state = 'idle';
    const failure = toError(error);
    for (const entry of flight.entries) entry.waiter.reject(failure);
    this.emitError(failure);
  }

  private async completeTurn(flight: InFlightTurn, stopReason: string): Promise<void> {
    try {
      await this.options.commit(flight.turnId, stopReason);
    } catch (error) {
      // The turn ran but its result is not durable. No pod-side retention or
      // re-delivery exists (hyper-acp is a pure passthrough), so settle the
      // leg back to idle with the window intact: waiters reject and the
      // messages re-bundle on the next submit. The caller owns any retry.
      if (this.closed || this.inFlight !== flight) return;
      this.inFlight = null;
      this.state = 'idle';
      const failure = toError(error);
      for (const entry of flight.entries) entry.waiter.reject(failure);
      this.emitError(failure);
      return;
    }
    if (this.closed || this.inFlight !== flight) return;
    this.inFlight = null;
    this.state = 'idle';
    this.window.splice(0, flight.entries.length);
    const outcome: AcpTurnOutcome = { turnId: flight.turnId, stopReason };
    for (const entry of flight.entries) entry.waiter.resolve(outcome);
    // Messages accumulated mid-turn belong to the NEXT bundle (§4.5), flushed
    // now that the leg is idle.
    this.flush();
  }

  /**
   * Vendor frames are confirmation/dedupe only (forward-compat with pods
   * that may emit them): they bind the turnId so `commit` can carry the
   * prompt's request id, but they never complete the turn — the
   * `session/prompt` response does.
   */
  private handleTurnEvent(event: CodingAgentAcpTurnEvent): void {
    if (this.closed || event.sessionId !== this.options.sessionId) return;
    const flight = this.inFlight;
    if (flight === null || this.state === 'idle') return;
    // Exact-one-in-flight: an unbound turn adopts the frame's id; a bound
    // turn keeps it (a mismatched frame is a stale re-delivery, ignored).
    if (flight.turnId === null) flight.turnId = event.turnId;
    if (event.kind === 'turn_started') this.state = 'running';
  }

  private emitError(error: Error): void {
    try {
      this.options.onError?.(error);
    } catch (listenerError) {
      console.error('AcpTurnDriver onError listener threw', listenerError);
    }
  }
}
