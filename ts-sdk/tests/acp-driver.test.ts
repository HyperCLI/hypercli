import { describe, it, expect } from 'vitest';
import { AcpTurnDriver } from '../src/acp-driver.js';
import {
  type CodingAgentAcpClient,
  type CodingAgentAcpTurnEvent,
  type CodingAgentAcpTurnId,
  type ContentBlock,
} from '../src/acp.js';

const SESSION_ID = 'session-1';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await tick();
  }
  throw new Error('timed out waiting for condition');
}

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void; reject(error: unknown): void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RecordedPrompt {
  sessionId: string;
  blocks: ContentBlock[];
}

/**
 * Structural stand-in for CodingAgentAcpClient: records prompts (each held
 * until the test settles it — the prompt response is the ONLY turn-end
 * evidence), records outbound notifications (must stay empty: no acks on the
 * wire), and replays registered turn-event listeners for frame-injection.
 */
class FakeAcpClient {
  public readonly prompts: RecordedPrompt[] = [];
  public readonly notifications: { method: string; params: unknown }[] = [];
  /** When set, the next prompt() rejects with this error (AmbiguousDelivery fence). */
  public promptFailure: Error | null = null;
  private readonly gates: { resolve(response: { stopReason: string }): void }[] = [];
  private readonly turnListeners = new Set<(event: CodingAgentAcpTurnEvent) => void>();

  prompt(sessionId: string, blocks: ContentBlock[]): Promise<{ stopReason: string }> {
    this.prompts.push({ sessionId, blocks });
    if (this.promptFailure) {
      const failure = this.promptFailure;
      this.promptFailure = null;
      return Promise.reject(failure);
    }
    const gate = deferred<{ stopReason: string }>();
    this.gates.push(gate);
    return gate.promise;
  }

  /** Settle prompt `index`'s RPC response — this, not a frame, completes the turn. */
  resolvePrompt(index: number, stopReason = 'end_turn'): void {
    this.gates[index].resolve({ stopReason });
  }

  notify(method: string, params?: unknown): Promise<void> {
    this.notifications.push({ method, params });
    return Promise.resolve();
  }

  onTurnEvent(listener: (event: CodingAgentAcpTurnEvent) => void): () => void {
    this.turnListeners.add(listener);
    return () => {
      this.turnListeners.delete(listener);
    };
  }

  emit(event: CodingAgentAcpTurnEvent): void {
    for (const listener of [...this.turnListeners]) listener(event);
  }

  turnStarted(turnId: CodingAgentAcpTurnId, sessionId = SESSION_ID): void {
    this.emit({ kind: 'turn_started', sessionId, turnId });
  }

  turnEnded(turnId: CodingAgentAcpTurnId, stopReason = 'end_turn', sessionId = SESSION_ID): void {
    this.emit({ kind: 'turn_ended', sessionId, turnId, stopReason });
  }
}

interface DriverHarness {
  client: FakeAcpClient;
  driver: AcpTurnDriver;
  commits: { turnId: CodingAgentAcpTurnId | null; stopReason: string }[];
  errors: Error[];
  bundles: string[][];
  /** Hold the durable-commit hook until the test resolves it. */
  gateCommits(): { resolve(): void; reject(error: unknown): void };
}

function makeDriver(options: { commitFailure?: Error } = {}): DriverHarness {
  const client = new FakeAcpClient();
  const commits: DriverHarness['commits'] = [];
  const errors: Error[] = [];
  const bundles: string[][] = [];
  let gate: ReturnType<typeof deferred> | null = null;
  const driver = new AcpTurnDriver(client as unknown as CodingAgentAcpClient, {
    sessionId: SESSION_ID,
    commit: async (turnId, stopReason) => {
      commits.push({ turnId, stopReason });
      if (options.commitFailure) throw options.commitFailure;
      if (gate) await gate.promise;
    },
    onBundleOpen: (bundle) => bundles.push(bundle.messages),
    onError: (error) => errors.push(error),
  });
  return {
    client,
    driver,
    commits,
    errors,
    bundles,
    gateCommits: () => {
      gate = deferred();
      return { resolve: () => gate?.resolve(), reject: (error: unknown) => gate?.reject(error) };
    },
  };
}

describe('AcpTurnDriver', () => {
  it('flushes immediately when idle and completes on the prompt response', async () => {
    const harness = makeDriver();

    const submitted = harness.driver.submit('hello world');

    expect(harness.client.prompts).toHaveLength(1);
    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.bundles).toEqual([['hello world']]);
    expect(harness.client.prompts[0].blocks).toEqual([
      { type: 'text', text: 'hello world' },
    ]);

    // The submit promise pends until the RPC response arrives and commits.
    harness.client.resolvePrompt(0);
    const outcome = await submitted;
    expect(outcome).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    expect(harness.driver.turnState).toBe('idle');
    expect(harness.driver.pendingCount).toBe(0);
    // No ack frames exist on the wire contract.
    expect(harness.client.notifications).toEqual([]);
    harness.driver.close();
  });

  it('serializes mid-turn submissions into distinct prompts, in order', async () => {
    const harness = makeDriver();
    const first = harness.driver.submit('first');
    harness.client.turnStarted(11);

    const second = harness.driver.submit('second');
    const third = harness.driver.submit('third');

    // One-in-flight: nothing else goes on the wire while the turn runs.
    expect(harness.client.prompts).toHaveLength(1);
    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.driver.pendingCount).toBe(3);

    // The frame bound the turnId but did not complete the turn — the
    // prompt response does.
    harness.client.resolvePrompt(0);
    await waitFor(() => harness.client.prompts.length === 2);

    expect(await first).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    expect(harness.client.prompts[1].blocks).toEqual([
      { type: 'text', text: 'second' },
    ]);
    expect(harness.driver.pendingCount).toBe(2);

    harness.client.resolvePrompt(1);
    expect(await second).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.client.prompts[2].blocks).toEqual([{ type: 'text', text: 'third' }]);
    harness.client.resolvePrompt(2);
    expect(await third).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.driver.pendingCount).toBe(0);
    expect(harness.driver.turnState).toBe('idle');
    harness.driver.close();
  });

  it('settles nothing until the durable commit hook resolves (commit-before-settlement)', async () => {
    const harness = makeDriver();
    const gate = harness.gateCommits();
    harness.driver.submit('work');
    harness.driver.submit('queued');

    // The RPC response arrived: the turn is evidence-complete, but the window
    // must not advance and the follow-up must not flush before commit lands.
    harness.client.resolvePrompt(0);
    await tick();
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    expect(harness.client.prompts).toHaveLength(1);
    expect(harness.driver.pendingCount).toBe(2);
    expect(harness.driver.turnState).not.toBe('idle');

    gate.resolve();
    await waitFor(() => harness.client.prompts.length === 2);
    expect(harness.driver.pendingCount).toBe(1);
    expect(harness.client.notifications).toEqual([]);
    harness.driver.close();
  });

  it('commit failure: no settlement, waiters reject, window intact; the caller owns any retry', async () => {
    const harness = makeDriver({ commitFailure: new Error('db down') });
    const submitted = harness.driver.submit('work');

    harness.client.resolvePrompt(0);
    await expect(submitted).rejects.toThrow('db down');
    await waitFor(() => harness.errors.length === 1);

    expect(harness.driver.pendingCount).toBe(1);
    await expect(harness.driver.submit('again')).rejects.toThrow('db down');
    expect(harness.commits).toHaveLength(1);
    expect(harness.client.prompts).toHaveLength(1);
    harness.driver.close();
  });

  it('settles cancelled input without resending or automatically flushing queued input', async () => {
    const harness = makeDriver();
    const active = harness.driver.submit('long task');
    const queued = harness.driver.submit('queued while running');

    harness.client.resolvePrompt(0, 'cancelled');
    expect(await active).toEqual({ turnId: null, stopReason: 'cancelled' });
    await tick();
    expect(harness.client.prompts).toHaveLength(1);
    expect(harness.driver.pendingCount).toBe(1);

    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'cancelled' }]);
    const explicit = harness.driver.submit('explicit new input');
    expect(harness.client.prompts[1].blocks).toEqual([
      { type: 'text', text: 'queued while running' },
    ]);
    harness.client.resolvePrompt(1);
    await queued;
    expect(harness.client.prompts[2].blocks).toEqual([{ type: 'text', text: 'explicit new input' }]);
    harness.client.resolvePrompt(2);
    await explicit;
    expect(harness.client.prompts).toHaveLength(3);
    harness.driver.close();
  });

  it('prompt send failure: window NOT advanced, error surfaced, no auto-retry', async () => {
    const harness = makeDriver();
    harness.client.promptFailure = new Error('ACP connection lost mid-prompt');

    const submitted = harness.driver.submit('maybe delivered');
    await expect(submitted).rejects.toThrow('ACP connection lost mid-prompt');
    await waitFor(() => harness.errors.length === 1);

    expect(harness.driver.pendingCount).toBe(1);
    await expect(harness.driver.submit('next')).rejects.toThrow('ACP connection lost mid-prompt');
    expect(harness.client.prompts).toHaveLength(1);
    harness.driver.close();
  });

  it('a caller-side timeout is not turn end: settlement completes via the late response', async () => {
    const harness = makeDriver();
    const submitted = harness.driver.submit('slow turn');

    // The caller walks away after 20ms. The driver must keep tracking.
    const raced = await Promise.race([
      submitted.then(() => 'settled' as const),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 20)),
    ]);
    expect(raced).toBe('timed out');
    expect(harness.driver.turnState).not.toBe('idle');
    expect(harness.commits).toEqual([]);

    // The real response arrives whenever it arrives: commit + settle normally.
    harness.client.resolvePrompt(0);
    expect(await submitted).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    expect(harness.driver.turnState).toBe('idle');
    expect(harness.driver.pendingCount).toBe(0);
    harness.driver.close();
  });

  it('private frames cannot change state, bind identifiers, or complete a turn', async () => {
    const harness = makeDriver();
    const submitted = harness.driver.submit('framed turn');
    harness.client.turnStarted(42);
    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.driver.currentTurnId).toBe(null);

    // turn_ended from a future pod: confirmation, not completion.
    harness.client.turnEnded(42, 'end_turn');
    await tick();
    expect(harness.commits).toEqual([]);
    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.driver.pendingCount).toBe(1);

    // Only the prompt response completes, exactly once, committing the
    // frame-bound turnId and the response's stopReason.
    harness.client.resolvePrompt(0);
    expect(await submitted).toEqual({ turnId: null, stopReason: 'end_turn' });
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    expect(harness.driver.turnState).toBe('idle');
    expect(harness.client.notifications).toEqual([]);
    harness.driver.close();
  });

  it('blocks a second in-flight prompt even if submissions race the submitted state', async () => {
    const harness = makeDriver();
    harness.driver.submit('one');
    // Still `submitted` (no turn_started ever, per the passthrough contract):
    // the window must not flush.
    harness.driver.submit('two');

    expect(harness.client.prompts).toHaveLength(1);
    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.driver.pendingCount).toBe(2);

    harness.client.resolvePrompt(0);
    await waitFor(() => harness.client.prompts.length === 2);
    expect(harness.commits).toEqual([{ turnId: null, stopReason: 'end_turn' }]);
    // Only the head-at-submit bundle advanced; 'two' flushes next (§4.5).
    expect(harness.client.prompts[1].blocks).toEqual([
      { type: 'text', text: 'two' },
    ]);
    harness.driver.close();
  });

  it('ignores frames for other sessions', async () => {
    const harness = makeDriver();
    harness.driver.submit('mine');
    harness.client.turnStarted(3, 'someone-else');
    harness.client.turnEnded(3, 'end_turn', 'someone-else');
    await tick();

    expect(harness.driver.turnState).toBe('submitted');
    expect(harness.driver.currentTurnId).toBeNull();
    expect(harness.commits).toEqual([]);
    expect(harness.driver.pendingCount).toBe(1);
    harness.driver.close();
  });

  it('preserves slash commands exactly', () => {
    const harness = makeDriver();

    harness.driver.submit('/plan refactor the driver');

    const blocks = harness.client.prompts[0].blocks;
    expect(blocks).toHaveLength(1);
    if (blocks[0].type !== 'text') throw new Error('expected a text block');
    expect(blocks[0].text).toBe('/plan refactor the driver');
    harness.driver.close();
  });

  it('close() rejects outstanding submit promises and stops consuming settlement', async () => {
    const harness = makeDriver();
    const submitted = harness.driver.submit('orphaned');

    harness.driver.close();
    await expect(submitted).rejects.toThrow('AcpTurnDriver is closed');

    // A late response after close commits nothing and advances nothing.
    harness.client.resolvePrompt(0);
    await tick();
    expect(harness.commits).toEqual([]);
    await expect(harness.driver.submit('nope')).rejects.toThrow('AcpTurnDriver is closed');
  });

  it.each([
    [{ type: 'text', text: ' \n[hypercli conversation context] (resuming after interruption — previous turn stopped)\n<system>literal</system>  ' }],
    [{ type: 'image', data: 'aA==', mimeType: 'image/png' }],
    [{ type: 'resource_link', uri: 'file:///a', name: 'a', _meta: { custom: 1 } }, { type: 'text', text: '/compact\n ' }],
  ])('preserves full content blocks without synthetic text: %j', (...blocks) => {
    const harness = makeDriver();
    harness.driver.submit(blocks as ContentBlock[]);
    expect(harness.client.prompts[0].blocks).toEqual(blocks);
    harness.driver.close();
  });
});
