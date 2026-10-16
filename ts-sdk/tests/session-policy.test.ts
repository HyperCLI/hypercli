import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { BrowserHyperCLI } from '../src/browser.js';
import {
  SessionPolicyClient, type SessionPolicyConnectOptions, type SessionPolicyRequest,
  type SessionPolicySnapshot, type SessionPolicySocket,
} from '../src/session-policy.js';

const target = { sessionId: '00000000-0000-4000-8000-000000000001', agentId: '00000000-0000-4000-8000-000000000002' };
const generation = '00000000-0000-4000-8000-000000000003';
const binding = '00000000-0000-4000-8000-000000000004';
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Real loopback WebSocket, mock product platform; no runtime or ACP enforcement simulated.
async function platform() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.clients.forEach(socket => socket.terminate()); server.close(() => resolve()); }));
  let state: SessionPolicySnapshot = {
    type: 'session.policy.snapshot', session_id: target.sessionId, agent_id: target.agentId,
    desired: { mode: 'ask', revision: 0 },
    applied: { status: 'pending', runtime_generation: generation, binding_id: binding },
  };
  const peers: WebSocket[] = [], frames: SessionPolicyRequest[] = [], urls: URL[] = [];
  let hold = false;
  const send = (socket: WebSocket, event: unknown) => socket.send(JSON.stringify(event));
  const broadcast = (type: SessionPolicySnapshot['type']) => {
    for (const peer of peers) if (peer.readyState === WebSocket.OPEN) send(peer, { ...state, type });
  };
  server.on('connection', (socket, request) => {
    peers.push(socket); urls.push(new URL(request.url!, 'http://localhost'));
    const origin = randomUUID();
    socket.on('message', data => {
      const frame = JSON.parse(String(data)) as SessionPolicyRequest;
      frames.push(frame);
      if (hold) return;
      if (frame.type === 'session.policy.set') {
        const outcome = frame.expected_revision === state.desired.revision ? 'accepted' : 'conflict';
        send(socket, { type: 'session.policy.result', request_id: frame.request_id, origin, outcome });
        if (outcome === 'accepted') {
          state = { ...state, desired: { mode: frame.mode, revision: state.desired.revision + 1 }, applied: { ...state.applied, status: 'pending' } };
          broadcast('session.policy.changed');
        }
      }
      send(socket, { ...state, type: 'session.policy.snapshot', request_id: frame.request_id, origin });
    });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connect = async (options: Partial<SessionPolicyConnectOptions> = {}) => {
    const client = await SessionPolicyClient.connect({
      url: base.replace('http:', 'ws:') + '/ws/session-policy', token: 'synthetic-token',
      createWebSocket: url => new WebSocket(url), createRequestId: randomUUID,
      reconnectDelaysMs: [5, 10], timeoutMs: 500, ...options,
    });
    cleanup.push(() => client.close()); return client;
  };
  return { connect, base, peers, frames, urls, send, broadcast,
    get state() { return state; }, set state(value: SessionPolicySnapshot) { state = value; },
    hold: () => { hold = true; }, release: () => { hold = false; },
  };
}

it('uses the exact product frames, broadcasts across callers, and keeps accepted separate from applied', async () => {
  const p = await platform(), first = await p.connect(), second = await p.connect();
  const changes = vi.fn(), a = await first.subscribe(target), b = await second.subscribe(target, { onSnapshot: changes });
  const accepted = await a.set('auto', { expectedRevision: 0 });
  expect(accepted.desired).toEqual({ mode: 'auto', revision: 1 });
  expect(accepted.applied.status).toBe('pending');
  await vi.waitFor(() => expect(b.snapshot?.desired.revision).toBe(1));
  expect(p.frames[0]).toEqual({ type: 'session.policy.subscribe', request_id: expect.any(String), session_id: target.sessionId, agent_id: target.agentId });
  expect(p.frames[2]).toEqual({ type: 'session.policy.set', request_id: expect.any(String), session_id: target.sessionId, agent_id: target.agentId, mode: 'auto', expected_revision: 0 });
  expect(p.urls[0].pathname).toBe('/ws/session-policy');
  expect(p.urls[0].searchParams.get('token')).toBe('synthetic-token');
  let done = false;
  const applied = a.waitApplied({ revision: 1, runtimeGeneration: generation, bindingId: binding }).then(value => { done = true; return value; });
  await Promise.resolve(); expect(done).toBe(false);
  p.state = { ...p.state, applied: { ...p.state.applied, status: 'applied', mode: 'auto', revision: 0 } };
  p.broadcast('session.policy.applied');
  await vi.waitFor(() => expect(a.snapshot?.applied.status).toBe('applied'));
  expect(done).toBe(false);
  p.state = { ...p.state, applied: { ...p.state.applied, revision: 1 } };
  p.broadcast('session.policy.applied');
  await expect(applied).resolves.toMatchObject({ applied: { revision: 1 } });
  await expect(b.set('none', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'conflict' });
  expect(changes.mock.calls.some(([snapshot]) => snapshot.desired.mode === 'auto')).toBe(true);
});

it.each(['revision', 'generation', 'binding', 'unsupported', 'unavailable', 'failed'])(
  'settles applied waiters explicitly on %s changes', async change => {
    const p = await platform(), client = await p.connect(), subscription = await client.subscribe(target);
    const waiting = expect(subscription.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding })).rejects.toMatchObject({
      code: ['revision', 'generation', 'binding'].includes(change) ? 'superseded' : change,
    });
    if (change === 'revision') p.state = { ...p.state, desired: { mode: 'none', revision: 1 } };
    else p.state = { ...p.state, applied: { ...p.state.applied,
      ...(change === 'generation' ? { runtime_generation: randomUUID() }
        : change === 'binding' ? { binding_id: randomUUID() } : { status: change as 'unsupported' | 'unavailable' | 'failed' }),
    } };
    p.broadcast('session.policy.applied'); await waiting;
  },
);

it('reconnects with a fresh snapshot and never retries an uncertain mutation', async () => {
  const p = await platform(), client = await p.connect(), sub = await client.subscribe(target);
  p.hold();
  const mutation = expect(sub.set('none', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'transport_closed' });
  await vi.waitFor(() => expect(p.frames.filter(frame => frame.type === 'session.policy.set')).toHaveLength(1));
  p.peers[0].terminate(); await mutation;
  expect(sub.fresh).toBe(false);
  const applied = sub.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding });
  p.state = { ...p.state, applied: { ...p.state.applied, status: 'applied', revision: 0, mode: 'ask' } };
  p.release();
  await expect(applied).resolves.toMatchObject({ desired: { mode: 'ask' } });
  expect(p.frames.filter(frame => frame.type === 'session.policy.set')).toHaveLength(1);
  expect(p.frames.filter(frame => frame.type === 'session.policy.subscribe')).toHaveLength(2);
});

it('ignores frames for other participants and stale revisions, and isolates sync/async observers', async () => {
  const p = await platform(), client = await p.connect({ onError: async () => { throw new Error('observer'); } });
  const observations = vi.fn(), errors = vi.fn();
  const first = await client.subscribe(target, {
    onSnapshot: () => { throw new Error('observer'); }, onError: () => { throw new Error('observer'); },
  });
  await client.subscribe(target, { onSnapshot: async () => { throw new Error('async observer'); } });
  const last = await client.subscribe(target, { onSnapshot: observations, onError: errors });
  await first.set('none', { expectedRevision: 0 });
  p.send(p.peers[0], { ...p.state, agent_id: randomUUID(), desired: { mode: 'auto', revision: 99 } });
  p.send(p.peers[0], { ...p.state, desired: { mode: 'ask', revision: 0 } });
  p.peers[0].send('{ invalid synthetic-token');
  await vi.waitFor(() => expect(errors).toHaveBeenCalled());
  expect(last.snapshot?.desired).toEqual({ mode: 'none', revision: 1 });
  expect(errors.mock.calls[0][0].message).not.toContain('synthetic-token');
  first.close(); const calls = observations.mock.calls.length;
  await last.set('ask', { expectedRevision: 1 });
  expect(observations.mock.calls.length).toBeGreaterThan(calls);
});

it('forwards nonactionable host resolution observations without answering ACP', async () => {
  const p = await platform(), client = await p.connect(), observed = vi.fn();
  await client.subscribe(target, { onResolution: observed });
  const event = { type: 'session.policy.result', session_id: target.sessionId, agent_id: target.agentId,
    resolution_id: randomUUID(), revision: 0, runtime_generation: generation, binding_id: binding,
    origin: randomUUID(), outcome: 'retired', actionable: false };
  p.send(p.peers[0], event);
  await vi.waitFor(() => expect(observed).toHaveBeenCalledWith(event));
  expect(p.frames).toHaveLength(1);
});

it('settles request/wait ownership on abort, timeout, subscription close, and client close', async () => {
  const p = await platform(), client = await p.connect(), a = await client.subscribe(target), b = await client.subscribe(target);
  const controller = new AbortController();
  const aborted = expect(a.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  controller.abort(); await aborted;
  await expect(a.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding, timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' });
  const closed = expect(a.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding })).rejects.toMatchObject({ code: 'closed' });
  a.close(); a.close(); await closed;
  expect(b.fresh).toBe(true);
  p.hold();
  const pending = expect(b.set('auto', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'closed' });
  const waiting = expect(b.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding })).rejects.toMatchObject({ code: 'closed' });
  client.close(); client.close(); await Promise.all([pending, waiting]);
});

it('reuses Node client URL/auth configuration', async () => {
  const p = await platform(), sdk = new HyperCLI({ apiKey: 'product-key', agentsApiBaseUrl: p.base });
  const client = await sdk.sessions.connectPolicy(); cleanup.push(() => client.close());
  await client.subscribe(target);
  expect(p.urls[0].pathname).toBe('/ws/session-policy');
  expect(p.urls[0].searchParams.get('token')).toBe('product-key');
});

it('closing a subscription retires only its owned mutation waiters', async () => {
  const p = await platform(), client = await p.connect(), a = await client.subscribe(target), b = await client.subscribe(target);
  p.hold();
  const first = expect(a.set('auto', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'closed' });
  const second = b.set('none', { expectedRevision: 0 });
  await vi.waitFor(() => expect(p.frames.filter(frame => frame.type === 'session.policy.set')).toHaveLength(2));
  a.close(); await first;
  const request = p.frames.at(-1)!;
  p.send(p.peers[0], { ...p.state, request_id: request.request_id });
  await expect(second).resolves.toMatchObject({ desired: { revision: 0 } });
  expect(b.fresh).toBe(true);
});

it('does not settle an application wait from a stale pre-reconnect snapshot', async () => {
  const p = await platform(), client = await p.connect({ reconnectDelaysMs: [20] });
  p.state = { ...p.state, applied: { ...p.state.applied, status: 'applied', revision: 0, mode: 'ask' } };
  const sub = await client.subscribe(target);
  p.peers[0].terminate();
  await vi.waitFor(() => expect(sub.fresh).toBe(false), { interval: 1 });
  p.state = { ...p.state, applied: { ...p.state.applied, runtime_generation: randomUUID() } };
  await expect(sub.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding })).rejects.toMatchObject({ code: 'superseded' });
});

it('never overwrites another request waiter and does not replay aborted or timed out mutations', async () => {
  const p = await platform(), client = await p.connect({ createRequestId: () => target.sessionId, timeoutMs: 50 });
  const sub = await client.subscribe(target);
  p.hold();
  const controller = new AbortController();
  const first = expect(sub.set('auto', { expectedRevision: 0, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  await expect(sub.set('none', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'duplicate_request_id' });
  controller.abort(); await first;
  await expect(sub.set('none', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'timeout' });
  expect(p.frames.filter(frame => frame.type === 'session.policy.set')).toHaveLength(2);
});

it('stops reconnecting on a terminal policy channel close and settles application waits', async () => {
  const p = await platform(), errors = vi.fn(), client = await p.connect({ onError: errors });
  const sub = await client.subscribe(target);
  const waiting = expect(sub.waitApplied({ revision: 0, runtimeGeneration: generation, bindingId: binding })).rejects.toMatchObject({ code: 'disconnected' });
  p.peers[0].close(4403, 'secret token must not reach diagnostics');
  await waiting;
  expect(errors.mock.calls[0][0]).toMatchObject({ code: 'transport_closed', closeCode: 4403 });
  expect(JSON.stringify(errors.mock.calls)).not.toContain('secret');
  await expect(sub.set('auto', { expectedRevision: 0 })).rejects.toMatchObject({ code: 'closed' });
});

class BrowserSocket implements SessionPolicySocket {
  listeners = new Map<string, Set<(event: any) => void>>();
  sent: SessionPolicyRequest[] = [];
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  emit(type: string, event: unknown = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

it('supports native browser sockets and explicit bridge URLs, and cleans up listeners on abort', async () => {
  const sockets: BrowserSocket[] = [];
  vi.stubGlobal('WebSocket', class extends BrowserSocket { constructor(url: string) { super(url); sockets.push(this); } });
  const sdk = new BrowserHyperCLI({ apiUrl: 'https://product.example', agentsApiBaseUrl: 'https://control.example/prefix', token: 'jwt' });
  const controller = new AbortController();
  const connecting = sdk.sessions.connectPolicy({ url: 'wss://bridge.example/ws/session-policy?route=custom', signal: controller.signal });
  sockets[0].emit('open');
  const client = await connecting;
  expect(sockets[0].url).toBe('wss://bridge.example/ws/session-policy?route=custom&token=jwt');
  const subscribing = expect(client.subscribe(target)).rejects.toMatchObject({ code: 'closed' });
  controller.abort(); await subscribing;
  expect(sockets[0].closed).toBe(true);
  expect([...sockets[0].listeners.values()].every(set => set.size === 0)).toBe(true);
});

it('reports a browser Event failure with a sanitized useful error and settles a pending connect', async () => {
  const socket = new BrowserSocket('unused');
  const connecting = expect(SessionPolicyClient.connect({ url: 'wss://example.test?token=secret', createWebSocket: () => socket })).rejects.toMatchObject({
    code: 'transport_failed', message: 'Session policy transport failed',
  });
  socket.emit('error', new globalThis.Event('error')); await connecting;
  expect(socket.closed).toBe(true);
  expect([...socket.listeners.values()].every(set => set.size === 0)).toBe(true);
});

it('aborts a stalled browser connect without leaving listeners or timers', async () => {
  const socket = new BrowserSocket('unused'), controller = new AbortController();
  const connecting = expect(SessionPolicyClient.connect({
    url: 'wss://example.test', createWebSocket: () => socket, signal: controller.signal,
  })).rejects.toMatchObject({ code: 'closed' });
  controller.abort(); await connecting;
  expect(socket.closed).toBe(true);
  expect([...socket.listeners.values()].every(set => set.size === 0)).toBe(true);
});
