import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { Agent, Deployments } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';
import { CodingAgentAcpClient, CodingAgentAcpConnectionError, type CodingAgentAcpConnectOptions, type CodingAgentAcpDiagnostic } from '../src/acp.js';
import { CodingAgentAcpPool } from '../src/acp-pool.js';

type Frame = { jsonrpc: string; id?: number | string; method?: string; params?: any; result?: any; error?: any };
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

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
        case 'session/resume': case 'session/load': result(socket, frame, {}); break;
        case 'session/prompt': result(socket, frame, { stopReason: 'end_turn' }); break;
        default: send(socket, { id: frame.id, error: { code: -32601, message: 'Method not found', data: { method: frame.method } } });
      }
    });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const runtimePaths = vi.fn(async () => ({ cwd: '/platform' }));
  const deployments = new Deployments({ get: runtimePaths } as unknown as HTTPClient, 'test-token', base);
  const agent = Agent.fromDict({ id: 'agent', runtime: 'opencode', state: 'RUNNING', user_id: 'owner' });
  agent._deployments = deployments;
  const connect = async (options: CodingAgentAcpConnectOptions = {}) => {
    const client = await agent.acpConnect(options); cleanup.push(() => client.close()); return client;
  };
  return { peers, frames, urls, hooks, send, result, sessions, connect, agent, runtimePaths,
    calls: (method: string) => frames.filter(f => f.method === method) };
}

it('constructs exact v1 initialize/new/prompt/resume/load requests with no private window fields', async () => {
  const f = await fixture(), client = await f.connect();
  const { sessionId } = await client.newSession();
  const blocks = [{ type: 'text' as const, text: '  /compact\n' }, { type: 'image' as const, mimeType: 'image/png', data: 'AA==' }];
  expect(await client.prompt(sessionId, blocks)).toEqual({ stopReason: 'end_turn' });
  await client.resumeSession(sessionId); await client.loadSession(sessionId);
  expect(f.calls('initialize')[0].params).toEqual({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'hypercli-ts-sdk', version: '' } });
  expect(f.calls('session/new')[0].params).toEqual({ cwd: '/platform', mcpServers: [] });
  expect(f.calls('session/prompt')[0].params).toEqual({ sessionId, prompt: blocks });
  for (const method of ['session/resume', 'session/load']) expect(f.calls(method)[0].params).toEqual({ sessionId, cwd: '/platform', mcpServers: [] });
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
  expect(f.calls('session/resume')[0].params).toEqual({ sessionId, cwd: '/original', mcpServers: [] });
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
