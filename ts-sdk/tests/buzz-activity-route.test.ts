import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeBuzzActivityRoute,
  resolveBuzzActivityRouteTarget,
  BuzzActivityGapError,
  BuzzActivityRouteUnavailableError,
  HYPER_ACP_ROUTE_NAME,
  type BuzzObserverFrame,
} from '../src/buzz-activity.js';
import type { AgentSecretResponse, Deployments } from '../src/agents.js';
import { APIError } from '../src/errors.js';

const HOSTNAME = 'fizz.agents.example.test';
const WS_TOKEN_SECRET = 'HYPER_ACP_WS_TOKEN';

function frameJson(seq: number, timestamp: string, kind = 'acp_read', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    seq,
    timestamp,
    kind,
    agentIndex: 0,
    channelId: 'channel-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    payload: { direction: 'read' },
    ...extra,
  });
}

/**
 * A socket the test drives by hand, mirroring the relay-transport harness:
 * delivery is explicit so ordering relative to handler attachment stays
 * deterministic. `instances` records every construction for reconnect tests;
 * `sent` records every frame the client pushed (auth handshake assertions).
 */
class ControllableWebSocket {
  public static instances: ControllableWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public readonly sent: string[] = [];
  public close = vi.fn();

  constructor(public readonly url: string) {
    ControllableWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  end(code = 1006, reason = '') {
    this.onclose?.({ code, reason });
  }
}

type SecretStub = { value: string; launch_epoch?: number } | Error;

function routeDeployments(options: {
  routes?: Record<string, unknown>;
  hostname?: string | null;
  launchEpoch?: number;
  secrets?: SecretStub[];
}) {
  const get = vi.fn().mockResolvedValue({
    id: 'agent-1',
    routes: options.routes ?? {
      [HYPER_ACP_ROUTE_NAME]: { port: 7799, auth: false },
    },
    hostname: 'hostname' in options ? options.hostname : HOSTNAME,
    launchEpoch: options.launchEpoch ?? 1,
  });
  const secrets = options.secrets ?? [{ value: 'token-1', launch_epoch: 1 }];
  const secret = vi.fn().mockImplementation(async (): Promise<AgentSecretResponse> => {
    const index = Math.min(secret.mock.calls.length, secrets.length) - 1;
    const stub = secrets[index];
    if (stub instanceof Error) throw stub;
    return {
      agent_id: 'agent-1',
      key: WS_TOKEN_SECRET,
      launch_epoch: 1,
      ...stub,
    };
  });
  const deployments = { get, secret } as unknown as Pick<Deployments, 'get' | 'secret'>;
  return { deployments, get, secret };
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('resolveBuzzActivityRouteTarget', () => {
  it('derives the pinned prefixed edge host', () => {
    const target = resolveBuzzActivityRouteTarget({
      routes: { 'hyper-acp': { port: 7799, auth: false } },
      hostname: HOSTNAME,
    });
    expect(target).toEqual({
      wsUrl: `wss://hyper-acp-${HOSTNAME}/`,
      port: 7799,
    });
  });

  it('honors an explicit prefix and a bare prefix root host', () => {
    expect(
      resolveBuzzActivityRouteTarget({
        routes: { 'hyper-acp': { port: 7799, prefix: 'act' } },
        hostname: HOSTNAME,
      })?.wsUrl,
    ).toBe(`wss://act-${HOSTNAME}/`);
    expect(
      resolveBuzzActivityRouteTarget({
        routes: { 'hyper-acp': { port: 7799, prefix: '' } },
        hostname: HOSTNAME,
      })?.wsUrl,
    ).toBe(`wss://${HOSTNAME}/`);
  });

  it('returns null without the route or a ready hostname', () => {
    expect(resolveBuzzActivityRouteTarget({ routes: {}, hostname: HOSTNAME })).toBeNull();
    expect(
      resolveBuzzActivityRouteTarget({
        routes: { 'hyper-acp': { port: 7799 } },
        hostname: null,
      }),
    ).toBeNull();
  });
});

describe('subscribeBuzzActivityRoute', () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    ControllableWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', ControllableWebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalWebSocket) vi.stubGlobal('WebSocket', originalWebSocket);
    else delete (globalThis as Record<string, unknown>).WebSocket;
  });

  it('throws BuzzActivityRouteUnavailableError when the agent has no route', async () => {
    const { deployments } = routeDeployments({ routes: {} });
    const promise = subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} });
    await expect(promise).rejects.toBeInstanceOf(BuzzActivityRouteUnavailableError);
    await expect(promise).rejects.toThrow('agent has no hyper-acp route');
  });

  it('sends the auth frame first, then handles auth_ok, replay, replay_end, and live frames', async () => {
    const { deployments, secret } = routeDeployments({});
    const events: string[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => events.push(`frame:${frame.seq}`),
      onHistoryEnd: () => events.push('history-end'),
    });
    await flushMicrotasks();
    expect(secret).toHaveBeenCalledWith('agent-1', WS_TOKEN_SECRET);
    const socket = ControllableWebSocket.instances[0];
    expect(socket.url).toBe(`wss://hyper-acp-${HOSTNAME}/`);
    // The first frame on the wire is exactly the pinned auth frame, and the
    // client never sends anything else.
    expect(socket.sent).toEqual(['{"type":"auth","token":"token-1"}']);

    socket.emit('{"type":"auth_ok"}');
    socket.emit(frameJson(1, '2026-08-25T10:00:00Z'));
    socket.emit(frameJson(2, '2026-08-25T10:00:01Z'));
    socket.emit('{"type":"replay_end"}');
    // A duplicate marker must not re-fire history end.
    socket.emit('{"type":"replay_end"}');
    socket.emit(frameJson(3, '2026-08-25T10:00:02Z'));

    expect(events).toEqual(['frame:1', 'frame:2', 'history-end', 'frame:3']);
    expect(socket.sent).toEqual(['{"type":"auth","token":"token-1"}']);
    sub.close();
  });

  it('rejects the subscribe promise when the ws token secret is empty', async () => {
    const { deployments, secret } = routeDeployments({ secrets: [{ value: '   ' }] });
    await expect(subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} }))
      .rejects.toThrow('activity ws token secret is empty');
    expect(secret).toHaveBeenCalledTimes(1);
    expect(ControllableWebSocket.instances).toHaveLength(0);
  });

  it('propagates a secret-fetch APIError (404) from the subscribe promise', async () => {
    const { deployments, secret } = routeDeployments({
      secrets: [new APIError(404, 'secret not found', 'GET', '/deployments/agent-1/secrets/x')],
    });
    await expect(subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} }))
      .rejects.toBeInstanceOf(APIError);
    expect(secret).toHaveBeenCalledTimes(1);
    expect(ControllableWebSocket.instances).toHaveLength(0);
  });

  it('rejects a stale launch-epoch token without hiding it as route-unavailable', async () => {
    const { deployments } = routeDeployments({
      launchEpoch: 3,
      secrets: [{ value: 'token-old', launch_epoch: 2 }],
    });
    const promise = subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} });
    await expect(promise).rejects.toThrow('activity ws token belongs to an older launch epoch');
    await expect(promise).rejects.not.toBeInstanceOf(BuzzActivityRouteUnavailableError);
    expect(ControllableWebSocket.instances).toHaveLength(0);
  });

  it('treats a missing agent launch epoch as no epoch guard', async () => {
    const { deployments } = routeDeployments({
      launchEpoch: 0,
      secrets: [{ value: 'token-zero', launch_epoch: 0 }],
    });
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} });
    await flushMicrotasks();
    expect(ControllableWebSocket.instances[0].sent).toEqual(['{"type":"auth","token":"token-zero"}']);
    sub.close();
  });

  it('drops protocol noise before auth_ok without poisoning the dedup map or history state', async () => {
    const { deployments } = routeDeployments({});
    const frames: BuzzObserverFrame[] = [];
    const historyEnds: string[] = [];
    const errors: Error[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onHistoryEnd: () => historyEnds.push('end'),
      onError: (error) => errors.push(error),
    });
    await flushMicrotasks();
    const socket = ControllableWebSocket.instances[0];

    // Pre-handshake garbage: a non-JSON text frame stays silent — no
    // onError, no onFrame, nothing.
    socket.emit('this is not json');
    expect(frames).toHaveLength(0);
    expect(errors).toHaveLength(0);

    // ...but a recognizable observer-shaped frame the real server would
    // never send before auth_ok is a protocol violation: ONE onError, still
    // no onFrame/onHistoryEnd, dedup untouched.
    const early = frameJson(50, '2026-08-25T10:00:50Z');
    socket.emit(early);
    socket.emit(early); // the notice is one-shot even for repeat violations
    expect(frames).toHaveLength(0);
    expect(historyEnds).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/spoke before completing the auth handshake/);

    // After auth_ok the very same observer frame (same timestamp+seq) MUST
    // deliver — the pre-auth copy must never have entered the dedup map.
    socket.emit('{"type":"auth_ok"}');
    socket.emit(early);
    socket.emit('{"type":"replay_end"}');
    socket.emit('{"type":"replay_end"}'); // duplicate marker: still one history end
    socket.emit(frameJson(51, '2026-08-25T10:00:51Z'));

    expect(frames.map((frame) => frame.seq)).toEqual([50, 51]);
    expect(historyEnds).toHaveLength(1);
    expect(errors).toHaveLength(1);
    sub.close();
  });

  it('surfaces a protocol violation when replay_end arrives before auth_ok', async () => {
    vi.useFakeTimers();
    const { deployments } = routeDeployments({});
    const frames: BuzzObserverFrame[] = [];
    const historyEnds: string[] = [];
    const errors: Error[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onHistoryEnd: () => historyEnds.push('end'),
      onError: (error) => errors.push(error),
    });
    await flushMicrotasks();

    // The skewed-deployment signature: replay markers without a handshake.
    // No history end, no frames, exactly one error (the latch holds even
    // across repeated violations and reconnects).
    ControllableWebSocket.instances[0].emit('{"type":"replay_end"}');
    ControllableWebSocket.instances[0].emit('{"type":"replay_gap","dropped":3}');
    expect(historyEnds).toHaveLength(0);
    expect(frames).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/spoke before completing the auth handshake/);

    // First retry burns backoff slot 0 (1s).
    ControllableWebSocket.instances[0].end(1006, 'still skewed');
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(2);

    // Skewed again pre-auth: no second error, and — critically — the
    // pre-auth replay_end must NOT reset the budget. Under a reset bug the
    // next close would re-use slot 0 (1s); correct behavior uses slot 1
    // (2s), so nothing may reconnect after only 1s of waiting.
    ControllableWebSocket.instances[1].emit('{"type":"replay_end"}');
    ControllableWebSocket.instances[1].end(1006, 'still skewed');
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(3);

    // The pod heals: handshake completes, replay runs, normal completion.
    const healed = ControllableWebSocket.instances[2];
    healed.emit('{"type":"auth_ok"}');
    healed.emit(frameJson(1, '2026-08-25T10:00:00Z'));
    healed.emit('{"type":"replay_end"}');
    healed.emit(frameJson(2, '2026-08-25T10:00:01Z'));
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(historyEnds).toHaveLength(1);
    expect(errors).toHaveLength(1);
    sub.close();
  });

  it('treats a 4401 close before auth_ok as terminal — onClose once, no retry, no more secret calls', async () => {
    vi.useFakeTimers();
    const { deployments, secret } = routeDeployments({});
    const closes: Array<{ code: number; reason: string }> = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      onClose: (event) => closes.push(event),
    });
    await flushMicrotasks();
    expect(secret).toHaveBeenCalledTimes(1);
    expect(ControllableWebSocket.instances[0].sent).toEqual(['{"type":"auth","token":"token-1"}']);

    ControllableWebSocket.instances[0].end(4401, 'unauthorized');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);
    expect(ControllableWebSocket.instances).toHaveLength(1);
    expect(secret).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it('dedups replay/live overlap on (timestamp, seq)', async () => {
    const { deployments } = routeDeployments({});
    const frames: BuzzObserverFrame[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
    });
    await flushMicrotasks();
    const socket = ControllableWebSocket.instances[0];
    socket.emit('{"type":"auth_ok"}');
    const dup = frameJson(7, '2026-08-25T10:00:07Z');
    socket.emit(dup);
    socket.emit(dup);
    socket.emit('{"type":"replay_end"}');
    socket.emit(dup);
    expect(frames).toHaveLength(1);
    expect(frames[0].seq).toBe(7);
    sub.close();
  });

  it('unwraps batch envelopes and drops malformed frames silently', async () => {
    const { deployments } = routeDeployments({});
    const frames: BuzzObserverFrame[] = [];
    const errors: Error[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error),
    });
    await flushMicrotasks();
    const socket = ControllableWebSocket.instances[0];
    socket.emit('{"type":"auth_ok"}');
    socket.emit(JSON.stringify({
      seq: 1,
      timestamp: '2026-08-25T10:00:00Z',
      kind: 'batch',
      agentIndex: null,
      channelId: null,
      sessionId: null,
      turnId: null,
      payload: {
        events: [
          JSON.parse(frameJson(2, '2026-08-25T10:00:01Z')),
          JSON.parse(frameJson(3, '2026-08-25T10:00:02Z')),
        ],
      },
    }));
    socket.emit('this is not json');
    socket.emit('{"type":"unknown-envelope"}');
    expect(frames.map((frame) => frame.seq)).toEqual([2, 3]);
    expect(errors).toHaveLength(0);
    sub.close();
  });

  it('maps replay_gap to a soft BuzzActivityGapError and keeps streaming', async () => {
    const { deployments } = routeDeployments({});
    const frames: BuzzObserverFrame[] = [];
    const errors: Error[] = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error),
    });
    await flushMicrotasks();
    const socket = ControllableWebSocket.instances[0];
    socket.emit('{"type":"auth_ok"}');
    socket.emit('{"type":"replay_gap","dropped":7}');
    socket.emit(frameJson(30, '2026-08-25T10:00:30Z'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(BuzzActivityGapError);
    expect((errors[0] as BuzzActivityGapError).dropped).toBe(7);
    expect(frames).toHaveLength(1);
    sub.close();
  });

  it('fetches the token fresh per attempt and honors the new value on reconnect', async () => {
    vi.useFakeTimers();
    const { deployments, secret } = routeDeployments({
      secrets: [
        { value: 'token-a', launch_epoch: 1 },
        { value: 'token-b', launch_epoch: 1 },
      ],
    });
    const frames: BuzzObserverFrame[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onClose: (event) => closes.push(event),
    });
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(1);
    const first = ControllableWebSocket.instances[0];
    expect(first.sent).toEqual(['{"type":"auth","token":"token-a"}']);
    first.emit('{"type":"auth_ok"}');
    first.emit(frameJson(1, '2026-08-25T10:00:00Z'));

    first.end(1006, 'edge restarted');
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(ControllableWebSocket.instances).toHaveLength(2);
    expect(secret).toHaveBeenCalledTimes(2);
    const second = ControllableWebSocket.instances[1];
    // The second attempt authenticates with the freshly revealed token.
    expect(second.sent).toEqual(['{"type":"auth","token":"token-b"}']);
    second.emit('{"type":"auth_ok"}');
    // Replay ring re-delivers seq 1 on reconnect; exactly-once for the caller.
    second.emit(frameJson(1, '2026-08-25T10:00:00Z'));
    second.emit('{"type":"replay_end"}');
    second.emit(frameJson(2, '2026-08-25T10:00:01Z'));
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(closes).toHaveLength(0);
    sub.close();
  });

  it('gives up after the bounded backoff budget and reports onClose once', async () => {
    vi.useFakeTimers();
    const { deployments } = routeDeployments({});
    const closes: Array<{ code: number; reason: string }> = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      onClose: (event) => closes.push(event),
    });
    await flushMicrotasks();
    // Initial + 3 retries, then give up on the next close.
    ControllableWebSocket.instances[0].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(1_000);
    ControllableWebSocket.instances[1].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(2_000);
    ControllableWebSocket.instances[2].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(4_000);
    ControllableWebSocket.instances[3].end(1006, 'down for good');
    await flushMicrotasks();

    expect(ControllableWebSocket.instances).toHaveLength(4);
    expect(closes).toEqual([{ code: 1006, reason: 'down for good' }]);
    // Nothing reconnects after the budget is spent.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ControllableWebSocket.instances).toHaveLength(4);
    sub.close();
  });

  it('resets the reconnect budget when a reconnect serves replay_end again', async () => {
    vi.useFakeTimers();
    const { deployments } = routeDeployments({});
    const closes: Array<{ code: number; reason: string }> = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      onClose: (event) => closes.push(event),
    });
    await flushMicrotasks();

    // Two failures burn the first two backoff slots (1s, then 2s).
    ControllableWebSocket.instances[0].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    ControllableWebSocket.instances[1].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    // The third attempt auths and serves history: the budget resets.
    const healthy = ControllableWebSocket.instances[2];
    healthy.emit('{"type":"auth_ok"}');
    healthy.emit('{"type":"replay_end"}');
    healthy.end(1006, 'down');

    // The next retry uses the FIRST backoff slot again, not the third.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(4);
    expect(closes).toHaveLength(0);

    // Two more failures still do not exhaust the reset budget...
    ControllableWebSocket.instances[3].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(5);
    ControllableWebSocket.instances[4].end(1006, 'down');
    await vi.advanceTimersByTimeAsync(4_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(6);
    expect(closes).toHaveLength(0);

    // ...and only the post-reset fourth failure gives up.
    ControllableWebSocket.instances[5].end(1006, 'down for good');
    await flushMicrotasks();
    expect(closes).toEqual([{ code: 1006, reason: 'down for good' }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ControllableWebSocket.instances).toHaveLength(6);
    sub.close();
  });

  it('terminates with onError + onClose when a mid-life token fetch fails', async () => {
    vi.useFakeTimers();
    const { deployments } = routeDeployments({
      secrets: [
        { value: 'token-a', launch_epoch: 1 },
        new APIError(404, 'secret gone', 'GET', '/deployments/agent-1/secrets/x'),
      ],
    });
    const errors: Error[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      onError: (error) => errors.push(error),
      onClose: (event) => closes.push(event),
    });
    await flushMicrotasks();
    ControllableWebSocket.instances[0].emit('{"type":"auth_ok"}');
    ControllableWebSocket.instances[0].end(1006, 'edge restarted');
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    // The APIError surfaces as-is, then the subscription ends terminally.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(APIError);
    expect(closes).toHaveLength(1);
    expect(closes[0].code).toBe(1006);
    // No retry, no further socket.
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(1);
    sub.close();
  });

  it('does not reconnect after close() or signal abort', async () => {
    vi.useFakeTimers();
    const { deployments } = routeDeployments({});
    const sub = await subscribeBuzzActivityRoute(deployments, 'agent-1', { onFrame: () => {} });
    await flushMicrotasks();
    const first = ControllableWebSocket.instances[0];
    sub.close();
    expect(first.close).toHaveBeenCalled();
    first.end(1006, 'down');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ControllableWebSocket.instances).toHaveLength(1);

    const controller = new AbortController();
    const sub2 = await subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      signal: controller.signal,
    });
    await flushMicrotasks();
    const second = ControllableWebSocket.instances[1];
    controller.abort();
    expect(second.close).toHaveBeenCalled();
    second.end(1006, 'down');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ControllableWebSocket.instances).toHaveLength(2);
    void sub2;
  });

  it('sends nothing further when aborted while the token fetch is in flight', async () => {
    let resolveSecret: (value: AgentSecretResponse) => void = () => {};
    const secretPromise = new Promise<AgentSecretResponse>((resolve) => {
      resolveSecret = resolve;
    });
    const get = vi.fn().mockResolvedValue({
      id: 'agent-1',
      routes: { [HYPER_ACP_ROUTE_NAME]: { port: 7799, auth: false } },
      hostname: HOSTNAME,
      launchEpoch: 1,
    });
    const secret = vi.fn().mockReturnValue(secretPromise);
    const deployments = { get, secret } as unknown as Pick<Deployments, 'get' | 'secret'>;

    const controller = new AbortController();
    const subPromise = subscribeBuzzActivityRoute(deployments, 'agent-1', {
      onFrame: () => {},
      signal: controller.signal,
    });
    await flushMicrotasks();
    expect(secret).toHaveBeenCalledTimes(1);
    // The abort lands mid-auth-wait; the late token resolution must not
    // produce a socket or any wire traffic.
    controller.abort();
    resolveSecret({ agent_id: 'agent-1', key: WS_TOKEN_SECRET, value: 'token-late', launch_epoch: 1 });
    const sub = await subPromise;
    await flushMicrotasks();
    expect(ControllableWebSocket.instances).toHaveLength(0);
    sub.close();
  });

  it('uses the same in-band auth frame on the ws-package (Node) path, without headers', async () => {
    const constructed: Array<{ url: string; options?: unknown }> = [];
    const sent: string[] = [];
    class FakeNodeWebSocket {
      public onopen: (() => void) | null = null;
      public onmessage: unknown = null;
      public onerror: unknown = null;
      public onclose: unknown = null;

      constructor(url: string, options?: unknown) {
        constructed.push({ url, options });
        queueMicrotask(() => this.onopen?.());
      }

      send(data: string) {
        sent.push(data);
      }

      close() {}
    }
    vi.doMock('ws', () => ({ default: FakeNodeWebSocket }));
    vi.resetModules();
    const module = await import('../src/buzz-activity.js');
    delete (globalThis as Record<string, unknown>).WebSocket;
    try {
      const { deployments } = routeDeployments({});
      const sub = await module.subscribeBuzzActivityRoute(deployments, 'agent-1', {
        onFrame: () => {},
      });
      await flushMicrotasks();
      // Bare-URL construction (no request options), auth purely in-band.
      expect(constructed).toEqual([{ url: `wss://hyper-acp-${HOSTNAME}/`, options: undefined }]);
      expect(sent).toEqual(['{"type":"auth","token":"token-1"}']);
      sub.close();
    } finally {
      vi.doUnmock('ws');
      vi.resetModules();
    }
  });
});
