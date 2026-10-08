/**
 * Serializes original messages through CodingAgentAcpClient.prompt(), which
 * verifies completion through platform REST receipts. Commit precedes settlement.
 * Cancelled completion pauses queued input until a new explicit submission;
 * uncertain delivery or commit failure fences this driver without resending.
 */
import {
  type CodingAgentAcpClient,
  type ContentBlock,
} from './acp.js';
import type { AcpLease } from './acp-pool.js';

export type AcpTurnDriverState = 'idle' | 'submitted' | 'running';

/** Settlement of one turn covering a submitted message. */
export interface AcpTurnOutcome {
  stopReason: string | null;
}

export interface AcpTurnBundle {
  sessionId: string;
  /** Text blocks from the single queued submission, in order. */
  messages: string[];
  /** The exact content blocks sent in `session/prompt`, including non-text content. */
  blocks: ContentBlock[];
}

export interface AcpTurnDriverOptions {
  sessionId: string;
  /**
   * Durable-commit hook run when the client's completion helper resolves.
   * Window advance, submit-promise resolution, and the next bundle's flush
   * all happen only after this resolves. Receives the stopReason verbatim
   * (`end_turn`, `cancelled`, ...); cancelled turns commit normally — their
   * bundled messages reached the model.
   */
  commit: (stopReason: string | null) => Promise<void>;
  /** Fired once per flush with the bundle going on the wire. */
  onBundleOpen?: (bundle: AcpTurnBundle) => void;
  /**
   * Prompt observation and commit failures fence this driver and reject all
   * pending submissions. The window is retained; later submissions reject
   * with the same failure without resending input.
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
  private inFlight: PendingMessage | null = null;
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

  /** Messages waiting in the pending window, including the in-flight bundle. */
  get pendingCount(): number {
    return this.window.length;
  }

  /** Queue one original message; a new explicit submission resumes paused input. */
  submit(content: string | ContentBlock[]): Promise<AcpTurnOutcome> {
    if (this.closed) return Promise.reject(new Error('AcpTurnDriver is closed'));
    if (this.failure) return Promise.reject(this.failure);
    const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    const waiter = newTurnWaiter();
    this.window.push({ blocks: structuredClone(blocks), waiter });
    this.flush();
    return waiter.promise;
  }

  /**
   * Stop consuming settlement and release the pool lease when this
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
    const flight = this.window[0];
    const blocks = structuredClone(flight.blocks);
    const texts = blocks.filter((block) => block.type === 'text').map((block) => block.text);
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
  private onPromptResponse(flight: PendingMessage, response: { stopReason?: string | null }): void {
    if (this.closed || this.inFlight !== flight) return;
    void this.completeTurn(flight, response.stopReason ?? null);
  }

  private onPromptFailed(flight: PendingMessage, error: unknown): void {
    if (this.closed || this.inFlight !== flight) return;
    // Delivery is uncertain. Retain the flight as a fence until the caller
    // reconciles/closes this driver; later submissions must not resend it.
    const failure = toError(error);
    this.failure = failure;
    for (const entry of this.window) entry.waiter.reject(failure);
    this.emitError(failure);
  }

  private async completeTurn(flight: PendingMessage, stopReason: string | null): Promise<void> {
    try {
      await this.options.commit(stopReason);
    } catch (error) {
      // The runtime completed but persistence failed. Never resend its input.
      this.onPromptFailed(flight, error);
      return;
    }
    if (this.closed || this.inFlight !== flight) return;
    this.inFlight = null;
    this.state = 'idle';
    this.window.splice(0, 1);
    const outcome: AcpTurnOutcome = { stopReason };
    flight.waiter.resolve(outcome);
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
