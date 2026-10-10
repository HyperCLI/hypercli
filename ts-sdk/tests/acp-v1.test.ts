import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import * as acp from '@agentclientprotocol/sdk';
import { CodingAgentAcpClient } from '../src/acp.js';
import { AcpTurnDriver } from '../src/acp-driver.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function peer() {
  const frames: any[] = [], updates: acp.SessionUpdate[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.clients.forEach(s => s.terminate()); server.close(() => resolve()); }));
  const pending: Array<(result: acp.PromptResponse) => void> = [];
  let emit!: (update: acp.SessionUpdate) => Promise<void>;
  server.on('connection', socket => {
    const app = acp.agent({ name: 'native-v1-fixture' })
      .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }))
      .onRequest('session/new', () => ({ sessionId: 'opaque/session' }))
      .onRequest('session/resume', () => ({}))
      .onRequest('session/load', () => ({}))
      .onRequest('session/set_config_option', () => ({ configOptions: [] }))
      .onRequest('session/prompt', async ({ params, client }) => {
        emit = update => client.notify('session/update', { sessionId: params.sessionId, update });
        return new Promise<acp.PromptResponse>(resolve => pending.push(resolve));
      })
      .onNotification('session/cancel', () => { pending.shift()?.({ stopReason: 'cancelled' }); });
    let closed = false;
    const connection = app.connect({
      readable: new ReadableStream<acp.AnyMessage>({ start(controller) {
        socket.on('message', raw => { if (!closed) { const frame = JSON.parse(raw.toString()); frames.push(frame); controller.enqueue(frame); } });
        socket.on('close', () => { if (!closed) { closed = true; controller.close(); } });
      }, cancel() { closed = true; } }),
      writable: new WritableStream<acp.AnyMessage>({ write(frame) { socket.send(JSON.stringify(frame)); } }),
    });
    cleanup.push(() => connection.close());
  });
  const client = await CodingAgentAcpClient.connect({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' },
    { cwd: '/workspace', onUpdate: notification => updates.push(notification.update) });
  cleanup.push(() => client.close());
  return { client, frames, updates, pending,
    emit: async (update: acp.SessionUpdate) => { await vi.waitFor(() => expect(emit).toBeDefined()); await emit(update); },
    finish: async () => { await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0)); pending.shift()!({ stopReason: 'end_turn' }); } };
}

it('uses the real upstream v1 router and only the correlated terminal response completes a prompt', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  let settled = false;
  const prompt = [{ type: 'text' as const, text: '  /compact\n[context]\n' }];
  const turn = p.client.prompt(sessionId, prompt).then(result => { settled = true; return result; });
  await p.emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
  await p.emit({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thought' } });
  await p.emit({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Edit', kind: 'edit', status: 'in_progress' });
  await p.emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content: [{ type: 'diff', path: '/x', oldText: 'old', newText: 'new' }], rawOutput: { opaque: [1, null] } });
  await p.emit({ sessionUpdate: 'plan', entries: [{ content: 'Done', priority: 'high', status: 'completed' }] });
  await vi.waitFor(() => expect(p.updates).toHaveLength(5)); expect(settled).toBe(false);
  await p.finish(); expect(await turn).toEqual({ stopReason: 'end_turn' });
  expect(p.frames.find(f => f.method === 'session/prompt').params).toEqual({ sessionId, prompt });
  expect(p.updates[3]).toMatchObject({ content: [{ type: 'diff', oldText: 'old', newText: 'new' }], rawOutput: { opaque: [1, null] } });
});

it('does not confuse concurrent same-content prompt results', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  const first = p.client.prompt(sessionId, 'same'), second = p.client.prompt(sessionId, 'same');
  await vi.waitFor(() => expect(p.pending).toHaveLength(2));
  p.pending[1]({ stopReason: 'max_tokens' }); p.pending[0]({ stopReason: 'end_turn' });
  expect(await first).toEqual({ stopReason: 'end_turn' }); expect(await second).toEqual({ stopReason: 'max_tokens' });
});

it('emits exact v1 config, resume and load payloads without private cursor authoring', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  await p.client.setConfigOption(sessionId, 'model', 'native');
  await p.client.resumeSession(sessionId); await p.client.loadSession(sessionId);
  expect(p.frames.find(f => f.method === 'session/set_config_option').params).toEqual({ sessionId, configId: 'model', value: 'native' });
  for (const method of ['session/resume', 'session/load']) expect(p.frames.find(f => f.method === method).params).toEqual({ sessionId, cwd: '/workspace', mcpServers: [] });
  for (const frame of p.frames) {
    for (const key of ['_meta', 'replayFrom', 'from', 'limit']) expect(frame.params).not.toHaveProperty(key);
  }
});

it('cancels through native notification and holds queued turns for an explicit caller action', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  const driver = new AcpTurnDriver(p.client, { sessionId, commit: async () => {} }); cleanup.push(() => driver.close());
  const active = driver.submit('active'), queued = driver.submit('queued');
  await vi.waitFor(() => expect(p.pending).toHaveLength(1)); await p.client.cancel(sessionId);
  expect((await active).stopReason).toBe('cancelled'); expect(driver.pendingCount).toBe(1);
  expect(p.frames.filter(f => f.method === 'session/prompt')).toHaveLength(1);
  const explicit = driver.submit('explicit'); await p.finish(); await queued; await p.finish(); await explicit;
  expect(p.frames.filter(f => f.method === 'session/prompt').map(f => f.params.prompt[0].text)).toEqual(['active', 'queued', 'explicit']);
  expect(p.frames.find(f => f.method === 'session/cancel')).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
});
