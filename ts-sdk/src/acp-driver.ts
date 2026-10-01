/**
 * Serializes original messages through CodingAgentAcpClient.prompt(), which
 * waits for version-specific foreground completion. Commit precedes settlement.
 * Cancelled completion pauses queued input until a new explicit submission;
 * uncertain delivery or commit failure fences this driver without resending.
 */
import {
  type CodingAgentAcpClient,
  type CodingAgentAcpTurnId,
  type ContentBlock,
} from './acp.js';
import type { AcpLease } from './acp-pool.js';

export type AcpTurnDriverState = 'idle' | 'submitted' | 'running';

/** Settlement of one turn covering a submitted message. */
export interface AcpTurnOutcome {
  /**
   * The session/prompt JSON-RPC request id. Only recoverable when the pod
   * emitted a vendor turn frame for this turn; pure-passthrough pods (the
   * current hyper-acp) complete with `null`.
   */
  turnId: CodingAgentAcpTurnId | null;
  stopReason: string | null;
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
  commit: (turnId: CodingAgentAcpTurnId | null, stopReason: string | null) => Promise<void>;
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
  blocks: ContentBlock[];
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
  private readonly window: PendingMessage[] = [];
  private state: AcpTurnDriverState = 'idle';
  private inFlight: InFlightTurn | null = null;
  private closed = false;
  private failure: Error | null = null;

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

  /** Queue one original message; a new explicit submission resumes paused input. */
  submit(content: string | ContentBlock[]): Promise<AcpTurnOutcome> {
    if (this.closed) return Promise.reject(new Error('AcpTurnDriver is closed'));
    if (this.failure) return Promise.reject(this.failure);
    const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    if (blocks.length === 0) {
      return Promise.reject(new Error('AcpTurnDriver.submit() expects a non-empty content-block array'));
    }
    const waiter = newTurnWaiter();
    this.window.push({ blocks: structuredClone(blocks), waiter });
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
    // Every in-flight bundle entry is still in the window (entries leave only
    // on commit), so rejecting the whole window settles every live waiter.
    const error = new Error('AcpTurnDriver is closed');
    for (const entry of this.window) entry.waiter.reject(error);
    this.inFlight = null;
    this.state = 'idle';
    this.leaseRelease?.();
  }

  private flush(): void {
    if (this.closed || this.state !== 'idle' || this.window.length === 0 || this.inFlight !== null) return;
    const entries = this.window.slice(0, 1);
    const blocks = structuredClone(entries[0].blocks);
    const texts = blocks.filter((block) => block.type === 'text').map((block) => block.text);
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

  /** The client's prompt helper waits for completion, not just v2 acceptance. */
  private onPromptResponse(flight: InFlightTurn, response: { stopReason?: string | null }): void {
    if (this.closed || this.inFlight !== flight) return;
    void this.completeTurn(flight, response.stopReason ?? null);
  }

  private onPromptFailed(flight: InFlightTurn, error: unknown): void {
    if (this.closed || this.inFlight !== flight) return;
    // Delivery is uncertain. Retain the flight as a fence until the caller
    // reconciles/closes this driver; later submissions must not resend it.
    const failure = toError(error);
    this.failure = failure;
    for (const entry of this.window) entry.waiter.reject(failure);
    this.emitError(failure);
  }

  private async completeTurn(flight: InFlightTurn, stopReason: string | null): Promise<void> {
    try {
      await this.options.commit(flight.turnId, stopReason);
    } catch (error) {
      if (this.closed || this.inFlight !== flight) return;
      // The runtime completed but persistence failed. Never resend its input.
      const failure = toError(error);
      this.failure = failure;
      for (const entry of this.window) entry.waiter.reject(failure);
      this.emitError(failure);
      return;
    }
    if (this.closed || this.inFlight !== flight) return;
    this.inFlight = null;
    this.state = 'idle';
    this.window.splice(0, flight.entries.length);
    const outcome: AcpTurnOutcome = { turnId: flight.turnId, stopReason };
    for (const entry of flight.entries) entry.waiter.resolve(outcome);
    if (stopReason !== 'cancelled') this.flush();
  }

  private emitError(error: Error): void {
    try {
      this.options.onError?.(error);
    } catch (listenerError) {
      console.error('AcpTurnDriver onError listener threw', listenerError);
    }
  }
}
