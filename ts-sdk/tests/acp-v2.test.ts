import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import * as v2 from '@agentclientprotocol/sdk/experimental/v2';
import { CodingAgentAcpClient } from '../src/acp.js';
import { AcpTurnDriver } from '../src/acp-driver.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function peer(withReceipts = true) {
  const frames: Record<string, unknown>[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.clients.forEach((socket) => socket.terminate()); server.close(() => resolve()); }));
  let finish: ((reason: 'end_turn' | 'cancelled') => Promise<void>) | undefined;
  let emit: ((update: v2.SessionUpdate) => Promise<void>) | undefined;
  let messages = 0;
  const updates: Array<Record<string, unknown>> = [];
  const receipts = new Map<string, { stopReason: string }>();
  server.on('connection', (socket) => {
    const app = v2.agent({ name: 'fixture' })
      .onRequest('initialize', () => ({ protocolVersion: 2, info: { name: 'fixture', version: '1' }, capabilities: { session: {} } }))
      .onRequest('session/new', () => ({ sessionId: 'opaque/session' }))
      .onRequest('session/resume', () => ({}))
      .onRequest('session/list', () => ({ sessions: [{ sessionId: 'opaque/session', cwd: '/workspace' }] }))
      .onRequest('session/close', () => ({}))
      .onRequest('session/set_config_option', () => ({ configOptions: [] }))
      .onRequest('session/prompt', async ({ params, client }) => {
        const messageId = `user-${++messages}`;
        emit = (update) => client.notify('session/update', { sessionId: params.sessionId, update });
        await client.notify('session/update', { sessionId: params.sessionId,
          update: { sessionUpdate: 'user_message', messageId, content: params.prompt } });
        await client.notify('session/update', { sessionId: params.sessionId,
          update: { sessionUpdate: 'state_update', state: 'running' } });
        finish = (stopReason) => {
          receipts.set(messageId, { stopReason });
          return client.notify('session/update', { sessionId: params.sessionId,
            update: { sessionUpdate: 'state_update', state: 'idle', stopReason } });
        };
        return { messageId };
      })
      .onNotification('session/cancel', async () => { await finish?.('cancelled'); });
    let streamClosed = false;
    const connection = app.connect({
      readable: new ReadableStream<v2.AnyWireMessage>({ start(controller) {
        socket.on('message', (data) => { if (streamClosed) return; const message = JSON.parse(data.toString()); frames.push(message); controller.enqueue(message); });
        socket.on('close', () => { if (!streamClosed) { streamClosed = true; controller.close(); } });
      }, cancel() { streamClosed = true; } }),
      writable: new WritableStream<v2.AnyWireMessage>({ write(message) { socket.send(JSON.stringify(message)); } }),
    });
    cleanup.push(() => connection.close());
  });
  const client = await CodingAgentAcpClient.connect({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' },
    { onUpdate: (notification) => updates.push(notification.update as unknown as Record<string, unknown>),
      ...(withReceipts ? { getPromptCompletion: async (_sid: string, mid: string) => receipts.get(mid) ?? null } : {}) });
  cleanup.push(() => client.close());
  return { client, frames, emit: async (update: v2.SessionUpdate) => { await vi.waitFor(() => expect(emit).toBeDefined()); await emit!(update); },
    finish: async (reason: 'end_turn' | 'cancelled') => {
      await vi.waitFor(() => expect(finish).toBeDefined());
      const count = updates.length;
      await finish!(reason);
      await vi.waitFor(() => expect(updates.slice(count).some((u) => u.state === 'idle')).toBe(true));
    } };
}

it('requires an explicit receipt reader for completion, while standard admission remains available', async () => {
  const { client, frames } = await peer(false);
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  await expect(client.prompt(sessionId, 'not sent')).rejects.toThrow('no per-message completion event');
  expect(frames.filter((f) => f.method === 'session/prompt')).toHaveLength(0);
  expect((await client.submitPrompt(sessionId, [{ type: 'text', text: 'accepted' }])).messageId).toBe('user-1');
});

it('uses the pinned upstream experimental v2 SDK, preserving input and separating acceptance from foreground completion', async () => {
  const { client, frames, finish } = await peer();
  const created = await client.newSession({ cwd: '/workspace' });
  expect(client.negotiatedProtocolVersion).toBe(2);
  expect(frames[0].params).toEqual({ protocolVersion: 2, capabilities: {}, info: { name: 'hypercli-ts-sdk', version: '' } });
  const blocks = [{ type: 'text' as const, text: '  /compact\n[hypercli conversation context]\n' }];
  const accepted = await client.submitPrompt(created.sessionId, blocks);
  expect(accepted).toEqual({ messageId: 'user-1' });
  await finish('end_turn');
  let settled = false;
  let inserted: string | undefined;
  const completed = client.prompt(created.sessionId, blocks, { onAccepted: (ack) => { inserted = ack.messageId; } })
    .then((result) => { settled = true; return result; });
  await vi.waitFor(() => expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(2));
  await vi.waitFor(() => expect(inserted).toBe('user-2'));
  expect(settled).toBe(false);
  await finish('end_turn');
  expect(await completed).toEqual({ stopReason: 'end_turn', messageId: 'user-2' });
  expect(frames.filter((frame) => frame.method === 'session/prompt').map((frame) => frame.params)).toEqual([
    { sessionId: created.sessionId, prompt: blocks }, { sessionId: created.sessionId, prompt: blocks },
  ]);
  expect(frames.some((frame) => String(frame.method).startsWith('_'))).toBe(false);
});

it('cancels using the standard notification and waits for cancelled state without resubmission', async () => {
  const { client, frames } = await peer();
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  const completed = client.prompt(sessionId, 'original');
  await vi.waitFor(() => expect(frames.some((frame) => frame.method === 'session/prompt')).toBe(true));
  await client.cancel(sessionId);
  expect(await completed).toEqual({ stopReason: 'cancelled', messageId: 'user-1' });
  expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(1);
});

it('sends the standard v2 discriminator through the real SDK config router', async () => {
  const { client, frames } = await peer();
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  await client.setConfigOption(sessionId, 'mode', 'code');
  await client.setConfigOption(sessionId, 'confirm', { type: 'boolean', value: false });
  expect(frames.filter((f) => f.method === 'session/set_config_option').map((f) => f.params)).toEqual([
    { sessionId, configId: 'mode', type: 'id', value: 'code' },
    { sessionId, configId: 'confirm', type: 'boolean', value: false },
  ]);
});

it('rejects a foreground observation on backend failure notices rather than hanging', async () => {
  const { client, frames, emit } = await peer();
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  const observation = client.prompt(sessionId, 'original');
  const rejected = expect(observation).rejects.toThrow('Runtime input was not sent');
  await vi.waitFor(() => expect(frames.filter((f) => f.method === 'session/prompt')).toHaveLength(1));
  await emit({ sessionUpdate: 'notice', severity: 'error', title: 'Runtime input was not sent' });
  await rejected;
  expect(frames.filter((f) => f.method === 'session/prompt')).toHaveLength(1);
});

it('does not associate another admission with the next foreground idle', async () => {
  const { client, emit, frames } = await peer();
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  const observation = client.prompt(sessionId, 'original');
  const rejected = expect(observation).rejects.toThrow('completion receipt');
  await vi.waitFor(() => expect(frames.filter((f) => f.method === 'session/prompt')).toHaveLength(1));
  await emit({ sessionUpdate: 'user_message', messageId: 'another-client', content: [{ type: 'text', text: 'B' }] });
  await emit({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
  await rejected;
});

it('does not turn locally queued input into an automatic resume after v2 cancellation', async () => {
  const { client, frames, finish } = await peer();
  const { sessionId } = await client.newSession({ cwd: '/workspace' });
  const driver = new AcpTurnDriver(client, { sessionId, commit: async () => {} });
  cleanup.push(() => driver.close());
  const active = driver.submit('active');
  const queued = driver.submit('queued');
  await vi.waitFor(() => expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(1));
  await client.cancel(sessionId);
  expect((await active).stopReason).toBe('cancelled');
  expect(driver.pendingCount).toBe(1);
  expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(1);
  const explicit = driver.submit('explicit');
  await vi.waitFor(() => expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(2));
  await finish('end_turn');
  await queued;
  await vi.waitFor(() => expect(frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(3));
  await finish('end_turn');
  await explicit;
  expect(frames.filter((frame) => frame.method === 'session/prompt').map((frame) => frame.params)).toEqual(
    ['active', 'queued', 'explicit'].map((text) => ({ sessionId, prompt: [{ type: 'text', text }] })),
  );
});
