import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { Agent, Deployments } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';
import { CodingAgentAcpConnectionError, CodingAgentSessionStartupError, type CodingAgentAcpConnectOptions, type CodingAgentAcpDiagnostic } from '../src/acp.js';
import { CodingAgentAcpPool } from '../src/acp-pool.js';
import { buildAdditionalMcpEnv, buildSessionMcpServers } from '../src/mcp.js';
import type { McpServer } from '@agentclientprotocol/sdk';

type Frame = { jsonrpc: string; id?: number | string; method?: string; params?: any; result?: any; error?: any };
const cleanup: Array<() => void | Promise<void>> = [];
const platformServers = buildSessionMcpServers('https://product.example.test', 'product-key');
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
afterEach(() => vi.useRealTimers());

// Raw loopback peer: transport/lifecycle assertions are independent of a backend.
async function fixture() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.clients.forEach(s => s.terminate()); server.close(() => resolve()); }));
  const peers: WebSocket[] = [], frames: Frame[] = [], urls: URL[] = [];
  const sessions = new Map<string, string>();
  const hooks = new Map<string, (frame: Frame, socket: WebSocket) => void>();
  const send = (socket: WebSocket, frame: object) => socket.send(JSON.stringify({ jsonrpc: '2.0', ...frame }));
  const result = (socket: WebSocket, frame: Frame, value: unknown) => send(socket, { id: frame.id, result: value });
  server.on('connection', (socket, request) => {
    peers.push(socket); urls.push(new URL(request.url!, 'http://localhost'));
    socket.on('message', raw => {
      const frame: Frame = JSON.parse(raw.toString()); frames.push(frame);
      if (hooks.has(frame.method!)) { hooks.get(frame.method!)!(frame, socket); return; }
      if (frame.id === undefined || !frame.method) return;
      switch (frame.method) {
        case 'initialize': result(socket, frame, { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fixture', version: '1' } }); break;
        case 'session/new': {
          const sessionId = `session-${sessions.size + 1}`;
          sessions.set(sessionId, frame.params.cwd); result(socket, frame, { sessionId }); break;
        }
        case 'session/list': result(socket, frame, { sessions: [...sessions].map(([sessionId, cwd]) => ({ sessionId, cwd })) }); break;
        case 'session/resume': result(socket, frame, {}); break;
        case 'session/prompt': result(socket, frame, { stopReason: 'end_turn' }); break;
        default: send(socket, { id: frame.id, error: { code: -32601, message: 'Method not found', data: { method: frame.method } } });
      }
    });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const runtimePaths = vi.fn(async () => ({ cwd: '/platform' }));
  const deployments = new Deployments({ base: 'https://product.example.test', credential: 'product-key', get: runtimePaths } as unknown as HTTPClient, 'test-token', base);
  const agent = Agent.fromDict({ id: 'agent', runtime: 'opencode', state: 'RUNNING', user_id: 'owner' });
  agent._deployments = deployments;
  const connect = async (options: CodingAgentAcpConnectOptions = {}) => {
    const client = await agent.acpConnect(options); cleanup.push(() => client.close()); return client;
  };
  return { peers, frames, urls, hooks, send, result, sessions, connect, agent, runtimePaths,
    calls: (method: string) => frames.filter(f => f.method === method) };
}

it('constructs exact v1 initialize/new/prompt/resume requests with no private window fields', async () => {
  const f = await fixture(), client = await f.connect();
  const { sessionId } = await client.newSession();
  const blocks = [{ type: 'text' as const, text: '  /compact\n' }, { type: 'image' as const, mimeType: 'image/png', data: 'AA==' }];
  expect(await client.prompt(sessionId, blocks)).toEqual({ stopReason: 'end_turn' });
  await client.resumeSession(sessionId);
  expect(f.calls('initialize')[0].params).toEqual({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'hypercli-ts-sdk', version: '' } });
  expect(f.calls('session/new')[0].params).toEqual({ cwd: '/platform', mcpServers: platformServers });
  expect(f.calls('session/prompt')[0].params).toEqual({ sessionId, prompt: blocks });
  expect(f.calls('session/resume')[0].params).toEqual({ sessionId, cwd: '/platform', mcpServers: platformServers });
  expect(client.negotiatedProtocolVersion).toBe(1);
  expect(client.initializeResponse?.agentInfo?.name).toBe('fixture');
  expect(f.urls[0].pathname).toBe('/ws/acp');
  expect(f.urls[0].searchParams.get('token')).toBe('test-token');
  expect(f.urls[0].searchParams.has('session_id')).toBe(false);
});

it('keeps source in the platform query only', async () => {
  const f = await fixture(), client = await f.connect({ source: 'future client/slack' });
  await client.newSession();
  expect(f.urls[0].searchParams.get('source')).toBe('future client/slack');
  for (const frame of f.frames) { expect(frame.params).not.toHaveProperty('_meta'); expect(frame.params).not.toHaveProperty('source'); }
});

it('owns one proxy product heartbeat per socket, consumes pong, and never times out missing pong', async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const onClose = vi.fn();
  const client = await f.connect({ transport: 'proxy', productHeartbeat: true, reconnect: false, onClose });
  const products = () => f.frames.filter(frame => 'event' in frame);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(14_999);
  await client.listSessions();
  expect(products()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await client.listSessions();
  expect(products()).toEqual([{ event: 'ping' }]);
  f.peers[0].send('{"event":"pong"}');
  expect(await client.listSessions()).toEqual({ sessions: [] });
  // No pong for subsequent intervals: keepalive is not a liveness deadline.
  await vi.advanceTimersByTimeAsync(60_000);
  await client.listSessions();
  expect(products()).toHaveLength(5);
  expect(client.connected).toBe(true);
  const closed = new Promise<void>(resolve => client.addCloseListener(() => resolve()));
  f.peers[0].terminate();
  await closed;
  expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: '' });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.peers).toHaveLength(1);
  const replacement = await f.connect({ transport: 'proxy', productHeartbeat: true, reconnect: false });
  expect(vi.getTimerCount()).toBe(1);
  replacement.close();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  {},
  { transport: 'proxy' as const },
  { productHeartbeat: true },
  { transport: 'direct' as const, productHeartbeat: true },
])('keeps unspecified and direct transports heartbeat-free: %j', async options => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const client = await f.connect(options);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  await client.listSessions();
  expect(f.frames.every(frame => frame.jsonrpc === '2.0')).toBe(true);
});

it.each([
  ['image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC'],
  ['application/zip', 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=='],
])('delivers live %s attachments independently of native ACP updates', async (mimeType, data) => {
  const f = await fixture(), client = await f.connect();
  const updates = vi.fn();
  client.addUpdateListener(updates);
  const publication = { type: 'attachment', id: 'publication', sessionId: 'session-1', agentId: 'agent', nativeSessionId: 'native',
    file: { type: 'resource_link', uri: 'file:///workspace/.outbox/bytes.bin', name: 'bytes.bin', mimeType, size: Buffer.from(data, 'base64').length, sha256: 'test-hash' } };
  const received = new Promise<unknown>(resolve => { client.addAttachmentListener(resolve); });
  f.peers[0].send(JSON.stringify(publication));
  expect(await received).toEqual(publication);
  expect(updates).not.toHaveBeenCalled();
  expect(await client.newSession()).toMatchObject({ sessionId: 'session-1' });
});

it.each([null, 'a'.repeat(40)])('delivers product snapshots without changing native ACP (%s)', async fingerprint => {
  const f = await fixture(), client = await f.connect();
  const updates = vi.fn();
  client.addUpdateListener(updates);
  const snapshot = { type: 'sessionSnapshot', sessionId: 'session-1', fingerprint };
  const received = new Promise(resolve => { client.addSnapshotListener(resolve); });
  f.peers[0].send(JSON.stringify(snapshot));
  expect(await received).toEqual(snapshot);
  expect(updates).not.toHaveBeenCalled();
  expect(await client.newSession()).toMatchObject({ sessionId: 'session-1' });
});

it('settles only the exact startup waiter locally, ignores stale IDs, and retains the usable socket', async () => {
  const f = await fixture(), client = await f.connect();
  f.hooks.set('session/new', () => {});
  const first = client.newSession().catch(error => error);
  const second = client.newSession();
  let secondSettled = false;
  void second.then(() => { secondSettled = true; });
  await vi.waitFor(() => expect(f.calls('session/new')).toHaveLength(2));
  const [a, b] = f.calls('session/new');
  const fail = (requestId: unknown, error = { code: 'unavailable', message: 'All worker slots are occupied (3/3).' }) =>
    f.peers[0].send(JSON.stringify({ type: 'sessionStartupError', requestId, error }));
  // Exact JSON ID identity matters: the numeric ID's string spelling is unknown.
  fail(String(a.id));
  fail(99999);
  fail(a.id, { code: 'other', message: 'Malformed product failure' });
  await client.listSessions(); // Ordered round trip proves the ignored frames were consumed.
  expect(secondSettled).toBe(false);
  fail(a.id);
  const error = await first;
  expect(error).toBeInstanceOf(CodingAgentSessionStartupError);
  expect(error).toMatchObject({ requestId: a.id, code: 'unavailable', message: 'All worker slots are occupied (3/3).' });
  expect(error).not.toHaveProperty('cause');
  fail(a.id); // Already settled.
  expect(secondSettled).toBe(false);
  f.result(f.peers[0], b, { sessionId: 'second', _meta: { opaque: true } });
  expect(await second).toEqual({ sessionId: 'second', _meta: { opaque: true } });
  fail(b.id); // Native success already settled.
  f.hooks.delete('session/new');
  expect(await client.newSession()).toEqual({ sessionId: 'session-1' });
  expect(client.connected).toBe(true);
  expect(f.peers).toHaveLength(1);
  expect(f.frames.every(frame => frame.method && !frame.error)).toBe(true);
  expect(f.calls('session/new')).toHaveLength(3); // No replay.
});

it('keeps genuinely unsent input intact when another operation has a startup refusal', async () => {
  const f = await fixture();
  let resolveCwd!: (cwd: string) => void;
  const client = await f.connect({ resolveDefaultCwd: () => new Promise(resolve => { resolveCwd = resolve; }) });
  const unsent = client.newSession();
  f.hooks.set('session/resume', (frame, socket) => socket.send(JSON.stringify({
    type: 'sessionStartupError', requestId: frame.id, error: { code: 'unavailable', message: 'Capacity full' },
  })));
  await expect(client.resumeSession('existing', { cwd: '/existing' })).rejects.toBeInstanceOf(CodingAgentSessionStartupError);
  expect(f.calls('session/new')).toHaveLength(0);
  resolveCwd('/unsent');
  expect(await unsent).toEqual({ sessionId: 'session-1' });
  expect(f.calls('session/new')[0].params.cwd).toBe('/unsent');
  expect(f.peers).toHaveLength(1);
});

it('sends explicit standard MCP setup, retains omitted values, and preserves peer refusal', async () => {
  const entries: McpServer[] = [
    { name: 'stdio', command: '/bin/tool', args: ['a:b'], env: [{ name: 'KEY', value: 'value' }] },
    { name: 'http', type: 'http', url: 'https://example.test/mcp', headers: [{ name: 'Authorization', value: 'Bearer explicit' }] },
    { name: 'sse', type: 'sse', url: 'https://example.test/events', headers: [] },
  ];
  const f = await fixture(), client = await f.connect();
  const { sessionId } = await client.newSession({ mcpServers: entries });
  const original = structuredClone(entries);
  entries[0].name = 'caller-mutated';
  await client.resumeSession(sessionId);
  expect(f.calls('session/resume').at(-1)?.params.mcpServers).toEqual(original);
  await client.resumeSession(sessionId, { mcpServers: [] });
  await client.resumeSession(sessionId);
  expect(f.calls('session/resume').at(-1)?.params.mcpServers).toEqual([]);
  await client.resumeSession(sessionId, { mcpServers: original });
  f.hooks.set('session/resume', (frame, socket) => f.send(socket, { id: frame.id, error: { code: -32602, message: 'HTTP unsupported' } }));
  await expect(client.resumeSession(sessionId, { mcpServers: [] })).rejects.toMatchObject({ code: -32602 });
  f.hooks.delete('session/resume');
  await client.resumeSession(sessionId, { mcpServers: original });
  expect(f.calls('session/resume').at(-1)?.params.mcpServers).toEqual(original);
  f.hooks.set('session/fork', (frame, socket) => f.result(socket, frame, { sessionId: 'fork' }));
  await client.unstableForkSession(sessionId, { mcpServers: [] });
  await client.resumeSession('fork');
  expect(f.calls('session/fork')[0].params.mcpServers).toEqual([]);
  expect(f.calls('session/resume').at(-1)?.params.mcpServers).toEqual([]);
  for (const frame of f.frames) expect(frame.params).not.toHaveProperty('HYPER_ADDITIONAL_MCP_SERVERS');

  const post = vi.fn(async () => ({ id: 'agent', state: 'CREATING' }));
  const deployments = new Deployments({ post } as unknown as HTTPClient, 'account-token', 'https://api.example.test');
  const env = buildAdditionalMcpEnv(original.slice(0, 1), original.slice(1));
  await deployments.create({ env });
  const body = (post.mock.calls[0] as unknown as [string, any])[1];
  expect(JSON.parse(body.env.HYPER_ADDITIONAL_MCP_SERVERS)).toEqual(original);
  expect(JSON.stringify(body)).not.toContain('account-token');
  expect(buildAdditionalMcpEnv([])).toEqual({ HYPER_ADDITIONAL_MCP_SERVERS: '[]' });
});

it('uses per-call > connection > lazy platform cwd, preserving native refusal', async () => {
  const f = await fixture(), resolveDefaultCwd = vi.fn(async () => '/default');
  const client = await f.connect({ cwd: '/connection', resolveDefaultCwd });
  await client.newSession(); await client.newSession({ cwd: '/override' });
  expect(resolveDefaultCwd).not.toHaveBeenCalled();
  f.hooks.set('session/new', (frame, socket) => f.send(socket, { id: frame.id, error: { code: -32602, message: 'cwd rejected' } }));
  await expect(client.newSession({ cwd: 'relative' })).rejects.toMatchObject({ code: -32602 });
  expect(f.calls('session/new').map(f => f.params.cwd)).toEqual(['/connection', '/override', 'relative']);
});

it('uses original catalog cwd after a fresh connection, never a replacement launch default', async () => {
  const f = await fixture(), first = await f.connect();
  const { sessionId } = await first.newSession({ cwd: '/original' }); first.close();
  const resolveDefaultCwd = vi.fn(async () => '/wrong');
  await f.connect({ sessionId, resolveDefaultCwd });
  expect(f.calls('session/resume')[0].params.cwd).toBe('/original');
  expect(resolveDefaultCwd).not.toHaveBeenCalled();
});

it('exposes exact session cwd from tracked state or paginated catalog, never a connection default', async () => {
  const f = await fixture(), client = await f.connect({ cwd: '/not-the-selected-session' });
  const { sessionId } = await client.newSession({ cwd: '/original/tracked' });
  expect(await client.sessionCwd(sessionId)).toBe('/original/tracked');
  expect(f.calls('session/list')).toHaveLength(0);
  f.hooks.set('session/list', (frame, socket) => f.result(socket, frame, frame.params.cursor
    ? { sessions: [{ sessionId: 'selected', cwd: '/original/catalog' }] }
    : { sessions: [{ sessionId: 'other', cwd: '/wrong' }], nextCursor: 'next' }));
  expect(await client.sessionCwd('selected')).toBe('/original/catalog');
  await expect(client.sessionCwd('missing')).rejects.toThrow(/original session cwd is unavailable/);
  expect(f.calls('session/resume')).toHaveLength(0);
  expect(f.calls('session/load')).toHaveLength(0);
});

it('explicit cwd bypasses unavailable listing; catalog errors propagate without launch fallback', async () => {
  const f = await fixture();
  f.hooks.set('session/list', (frame, socket) => f.send(socket, { id: frame.id, error: { code: -32000, message: 'Not authorized' } }));
  const client = await f.connect();
  await expect(client.resumeSession('original')).rejects.toThrow('Not authorized');
  await client.resumeSession('original', { cwd: '/original' });
  expect(f.calls('session/resume')).toHaveLength(1);
});

it('reports cwd failure before session/new and keeps diagnostic payloads content-free', async () => {
  const f = await fixture(), events: CodingAgentAcpDiagnostic[] = [];
  const failure = Object.assign(new Error('secret URL'), { code: 'ETIMEDOUT' });
  const client = await f.connect({ resolveDefaultCwd: async () => { throw failure; }, onDiagnostic: e => events.push(e) });
  await expect(client.newSession()).rejects.toBe(failure);
  expect(f.calls('session/new')).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ stage: 'cwd', phase: 'failed', error: { code: 'ETIMEDOUT' } });
  expect(JSON.stringify(events)).not.toContain('secret');
});

it('retains code zero, opaque error data, method and cause without poisoning subsequent prompts', async () => {
  const f = await fixture(), events: CodingAgentAcpDiagnostic[] = [];
  const client = await f.connect({ onDiagnostic: e => events.push(e) });
  const data = { nested: ['opaque', null], secret: 'not-in-diagnostics' };
  f.hooks.set('session/prompt', (frame, socket) => f.send(socket, { id: frame.id, error: { code: 0, message: 'native refusal', data } }));
  await expect(client.prompt('s', 'bad')).rejects.toMatchObject({ method: 'session/prompt', code: 0, data, cause: { code: 0, data } });
  expect(JSON.stringify(events)).not.toContain('not-in-diagnostics');
  f.hooks.delete('session/prompt');
  expect(await client.prompt('s', 'good')).toEqual({ stopReason: 'end_turn' });
});

it.each([2, 99])('rejects unsupported negotiated version %s', async protocolVersion => {
  const f = await fixture();
  f.hooks.set('initialize', (frame, socket) => f.result(socket, frame, { protocolVersion, agentCapabilities: {} }));
  await expect(f.connect()).rejects.toThrow('v1');
});

it('retains initialize peer refusal and closes the pending transport', async () => {
  const f = await fixture();
  f.hooks.set('initialize', (frame, socket) => f.send(socket, { id: frame.id, error: { code: -32602, message: 'initialize rejected' } }));
  await expect(f.connect()).rejects.toMatchObject({ code: -32602, message: 'initialize rejected' });
  await vi.waitFor(() => expect(f.peers[0].readyState).toBe(3));
});

it.each(['initial', 'reconnect'])('aborts a stalled %s initialize', async stage => {
  const f = await fixture(), controller = new AbortController();
  if (stage === 'initial') f.hooks.set('initialize', () => {});
  const connecting = f.connect({ signal: controller.signal });
  if (stage === 'initial') {
    const rejected = expect(connecting).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    await vi.waitFor(() => expect(f.calls('initialize')).toHaveLength(1)); controller.abort(); await rejected;
  } else {
    const client = await connecting; f.hooks.set('initialize', () => {}); f.peers[0].terminate();
    await vi.waitFor(() => expect(f.calls('initialize')).toHaveLength(2), { timeout: 3000 });
    const rejected = expect(client.waitConnected()).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    controller.abort(); await rejected;
  }
  await vi.waitFor(() => expect(f.peers.at(-1)!.readyState).toBe(3));
});

it('rejects uncertain prompt on disconnect, resumes exact session without history or resend', async () => {
  const f = await fixture(), client = await f.connect();
  const { sessionId } = await client.newSession({ cwd: '/original' });
  f.hooks.set('session/prompt', () => {});
  const pending = client.prompt(sessionId, 'original'), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.calls('session/prompt')).toHaveLength(1)); f.peers[0].terminate(); await rejected;
  await vi.waitFor(() => expect(f.calls('session/resume')).toHaveLength(1), { timeout: 3000 }); await client.waitConnected();
  expect(f.calls('session/resume')[0].params).toEqual({ sessionId, cwd: '/original', mcpServers: platformServers });
  expect(f.calls('session/load')).toHaveLength(0); expect(f.calls('session/new')).toHaveLength(1);
  expect(f.calls('session/prompt')).toHaveLength(1);
  f.hooks.delete('session/prompt'); await client.prompt(sessionId, 'caller resubmission');
  expect(f.calls('session/prompt')).toHaveLength(2);
});

it('reports reconnect resume refusal without creating a replacement session', async () => {
  const f = await fixture(), errors: Error[] = [], client = await f.connect({ onError: e => errors.push(e) });
  await client.newSession();
  f.hooks.set('session/resume', (frame, socket) => f.send(socket, { id: frame.id, error: { code: -32000, message: 'gone' } }));
  f.peers[0].terminate();
  await vi.waitFor(() => expect(errors.some(e => e.message.includes('gone'))).toBe(true), { timeout: 3000 });
  expect(f.calls('session/new')).toHaveLength(1); expect(f.calls('session/prompt')).toHaveLength(0);
});

it('reports product startup refusal during reconnect without recycling the healthy socket', async () => {
  const f = await fixture(), errors: Error[] = [], client = await f.connect({ onError: e => errors.push(e) });
  await client.newSession();
  f.hooks.set('session/resume', (frame, socket) => socket.send(JSON.stringify({
    type: 'sessionStartupError', requestId: frame.id, error: { code: 'unavailable', message: 'Capacity full' },
  })));
  f.peers[0].terminate();
  await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 3000 });
  expect(errors[0]).toMatchObject({ cause: { name: 'CodingAgentSessionStartupError', code: 'unavailable' } });
  expect(client.connected).toBe(true);
  await client.listSessions();
  expect(f.peers).toHaveLength(2);
  expect(f.calls('session/resume')).toHaveLength(1);
  expect(f.calls('session/new')).toHaveLength(1);
});

it.each(['refresh', 'resume'])('isolates throwing error observers during reconnect %s settlement', async stage => {
  const f = await fixture(), errors: Error[] = [];
  const client = await f.connect({
    onReconnect: stage === 'refresh' ? () => { throw new globalThis.Event('error'); } : undefined,
    onError: () => { throw new Error('consumer observer'); },
  });
  client.addErrorListener(async () => { throw new Error('async consumer observer'); });
  client.addErrorListener(error => errors.push(error));
  await client.newSession();
  if (stage === 'resume') f.hooks.set('session/resume', (frame, socket) => f.send(socket, {
    id: frame.id, error: { code: -32000, message: 'gone' },
  }));
  f.peers[0].terminate();
  await vi.waitFor(() => expect(client.connected).toBe(false));
  const waiting = client.waitConnected();
  if (stage === 'resume') await expect(waiting).rejects.toThrow('gone');
  else await waiting;
  await vi.waitFor(() => expect(client.connected).toBe(true), { timeout: 3000 });
  expect(errors).toHaveLength(1);
  expect(errors[0].message).not.toContain('[object Event]');
  if (stage === 'refresh') expect(errors[0]).toMatchObject({
    message: 'ACP reconnect callback failed', cause: { type: 'error' },
  });
});

it('settles pending calls and notifies all close observers despite observer failures', async () => {
  const f = await fixture(), closed = vi.fn();
  const client = await f.connect({ onClose: () => { throw new Error('consumer observer'); } });
  client.addCloseListener(async () => { throw new Error('async consumer observer'); });
  client.addCloseListener(closed);
  f.hooks.set('session/prompt', () => {});
  const pending = expect(client.prompt('s', 'pending')).rejects.toThrow();
  await vi.waitFor(() => expect(f.calls('session/prompt')).toHaveLength(1));
  f.peers[0].close(4403, 'forbidden');
  await pending;
  await vi.waitFor(() => expect(closed).toHaveBeenCalledWith({ code: 4403, reason: 'forbidden' }));
  expect(client.closed).toBe(true);
});

it.each(['queued', 'uncertain', 'cancelled'])('fresh-client crash recovery never resubmits %s input', async state => {
  const f = await fixture(), original = await f.connect();
  const { sessionId } = await original.newSession({ cwd: '/original' });
  if (state === 'queued') {
    f.peers[0].terminate();
    await vi.waitFor(() => expect(original.connected).toBe(false));
  }
  if (state === 'uncertain') f.hooks.set('session/prompt', () => {});
  const rejected = expect(original.prompt(sessionId, 'old user work')).rejects.toThrow();
  if (state === 'uncertain') await vi.waitFor(() => expect(f.calls('session/prompt')).toHaveLength(1));
  if (state === 'cancelled') await original.cancel(sessionId);
  original.close();
  await rejected;
  f.hooks.delete('session/prompt');
  const recovered = await f.connect({ sessionId });
  await recovered.listSessions(); // response barrier after same-session restore
  expect(f.calls('session/prompt')).toHaveLength(state === 'uncertain' ? 1 : 0);
  expect(f.calls('session/new')).toHaveLength(1);
  expect(f.calls('session/resume').at(-1)?.params.sessionId).toBe(sessionId);
  await recovered.prompt(sessionId, 'new explicit user work');
  expect(f.calls('session/prompt').map(frame => frame.params.prompt[0].text)).toEqual(
    state === 'uncertain' ? ['old user work', 'new explicit user work'] : ['new explicit user work']);
});

it.each(['disconnected', 'history'])('cancel retires every first send held by %s, without affecting other sessions', async stage => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let refreshing = false;
  const client = await f.connect({ onReconnect: async () => { refreshing = true; await held; } });
  const { sessionId } = await client.newSession();
  f.peers[0].terminate();
  await vi.waitFor(() => expect(client.connected).toBe(false));
  if (stage === 'history') await vi.waitFor(() => expect(refreshing).toBe(true), { timeout: 3000 });
  const cancelled = Promise.allSettled([client.prompt(sessionId, 'old 1'), client.prompt(sessionId, 'old 2')]);
  const other = client.prompt('other', 'independent');
  if (stage === 'disconnected') await expect(client.cancel(sessionId)).rejects.toThrow('unavailable');
  else await client.cancel(sessionId);
  expect((await cancelled).map(result => result.status)).toEqual(['rejected', 'rejected']);
  const fresh = client.prompt(sessionId, 'new explicit input');
  release();
  await Promise.all([other, fresh]);
  expect(f.calls('session/prompt').map(frame => frame.params.prompt[0].text)).toEqual(['independent', 'new explicit input']);
  expect(f.calls('session/new')).toHaveLength(1);
});

it('retains the session across a second disconnect during resume and waits before first send', async () => {
  const f = await fixture(), errors: Error[] = [], refresh = vi.fn(async () => {});
  const client = await f.connect({ onError: error => errors.push(error), onReconnect: refresh });
  const { sessionId } = await client.newSession({ cwd: '/original' });
  f.hooks.set('session/resume', () => {});
  f.peers[0].terminate();
  await vi.waitFor(() => expect(f.calls('session/resume')).toHaveLength(1), { timeout: 3000 });
  expect(client.connected).toBe(false);
  const pending = client.prompt(sessionId, 'not yet sent');
  f.peers[1].terminate();
  await vi.waitFor(() => expect(f.calls('session/resume')).toHaveLength(2), { timeout: 3000 });
  expect(client.sessionIds).toEqual([sessionId]);
  expect(f.calls('session/prompt')).toHaveLength(0);
  expect(errors).toEqual([]);
  f.result(f.peers[2], f.calls('session/resume')[1], {});
  await expect(pending).resolves.toEqual({ stopReason: 'end_turn' });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(f.calls('session/new')).toHaveLength(1);
  expect(f.calls('session/load')).toHaveLength(0);
  expect(f.calls('session/prompt')).toHaveLength(1);
  expect(f.calls('session/resume').map(frame => frame.params.sessionId)).toEqual([sessionId, sessionId]);
});

it.each([false, true])('routes native permission toolCall and opaque peer extensions (handler=%s)', async handled => {
  const f = await fixture(), handler = vi.fn(async (_params: unknown) => ({ outcome: { outcome: 'selected' as const, optionId: 'allow' } }));
  await f.connect(handled ? { onPermissionRequest: handler } : {});
  const params = { sessionId: 's', toolCall: { toolCallId: 'tool', title: 'Shell', kind: 'execute' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }], _meta: { peer: { opaque: true } } };
  f.send(f.peers[0], { id: 'permission', method: 'session/request_permission', params });
  await vi.waitFor(() => expect(f.frames.some(f => f.id === 'permission' && f.result)).toBe(true));
  expect(f.frames.find(f => f.id === 'permission')!.result).toEqual({ outcome: handled ? { outcome: 'selected', optionId: 'allow' } : { outcome: 'cancelled' } });
  if (handled) expect(handler.mock.calls[0][0]).toEqual(params);
});

it('fans updates out, isolates listener errors, and unsubscribes without read-ack traffic', async () => {
  const f = await fixture(), first = vi.fn(), second = vi.fn(), client = await f.connect({ onUpdate: first });
  const remove = client.addUpdateListener(second);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {}); cleanup.push(() => log.mockRestore());
  client.addUpdateListener(() => { throw new Error('listener'); });
  const update = { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } } };
  f.send(f.peers[0], { method: 'session/update', params: update });
  await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1)); remove();
  f.send(f.peers[0], { method: 'session/update', params: update });
  await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(2));
  expect(second).toHaveBeenCalledTimes(1); expect(f.frames).toHaveLength(1);
});

it.each(['release', 'drop', 'close'])('shares pooled connection and cleans up on %s', async action => {
  const f = await fixture(), pool = new CodingAgentAcpPool({ connect: (_key, options) => f.connect(options) });
  cleanup.push(() => pool.close());
  const [a, b] = await Promise.all([pool.acquire('agent'), pool.acquire('agent')]);
  expect(a.client).toBe(b.client); expect(f.peers).toHaveLength(1);
  if (action === 'release') { a.release(); a.release(); expect(b.client.closed).toBe(false); b.release(); }
  else if (action === 'drop') pool.drop('agent'); else pool.close();
  expect(a.client.closed).toBe(true); expect(pool.size()).toBe(0);
});

it('retains three released connections and evicts the least recently accessed', async () => {
  const f = await fixture(), pool = new CodingAgentAcpPool({
    connect: (_key, options) => f.connect(options), retainConnections: 3,
    connectOptions: () => ({ reconnect: false }),
  });
  cleanup.push(() => pool.close());
  const a = await pool.acquire('a'); a.release();
  const b = await pool.acquire('b'); b.release();
  const c = await pool.acquire('c'); c.release();
  const revisit = await pool.acquire('a');
  expect(revisit.client).toBe(a.client); revisit.release();
  const d = await pool.acquire('d'); d.release();
  expect(pool.size()).toBe(3);
  expect(b.client.closed).toBe(true);
  expect(a.client.closed).toBe(false);
  expect(c.client.closed).toBe(false);
  expect(f.peers).toHaveLength(4);
  f.peers[0].close(1000, 'retired');
  await vi.waitFor(() => expect(a.client.closed).toBe(true));
  expect(pool.size()).toBe(2);
  expect(f.peers).toHaveLength(4);
});

it.each(['drop', 'close'])('cancels pending pooled initialize on %s', async action => {
  const f = await fixture(); f.hooks.set('initialize', () => {});
  const pool = new CodingAgentAcpPool({ connect: (_key, options) => f.connect(options) }); cleanup.push(() => pool.close());
  const a = pool.acquire('agent'), b = pool.acquire('agent');
  const failures = [expect(a).rejects.toThrow(), expect(b).rejects.toThrow()];
  await vi.waitFor(() => expect(f.calls('initialize')).toHaveLength(1));
  if (action === 'drop') pool.drop('agent'); else pool.close();
  await Promise.all(failures); await vi.waitFor(() => expect(f.peers[0].readyState).toBe(3));
});

it('terminal bridge close evicts the pooled client and never reconnects it', async () => {
  const f = await fixture(), pool = new CodingAgentAcpPool({ connect: () => f.connect() }); cleanup.push(() => pool.close());
  const a = await pool.acquire('agent'); f.peers[0].close(4404, 'unknown session');
  await vi.waitFor(() => expect(a.client.closed).toBe(true)); expect(pool.size()).toBe(0);
  const b = await pool.acquire('agent'); expect(b.client).not.toBe(a.client); expect(f.peers).toHaveLength(2);
});

it('forwards native message IDs and opaque future updates without a parallel event registry', async () => {
  const f = await fixture(), updates = vi.fn(); await f.connect({ onUpdate: updates });
  const notifications = [
    { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', messageId: 'native', content: { type: 'text', text: 'same' } } },
    { sessionId: 's', update: { sessionUpdate: 'future_native_update', payload: { opaque: [1, null] }, _meta: { peer: true } } },
  ];
  for (const params of notifications) f.send(f.peers[0], { method: 'session/update', params });
  await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  expect(updates.mock.calls.map(([notification]) => notification)).toEqual(notifications);
});
