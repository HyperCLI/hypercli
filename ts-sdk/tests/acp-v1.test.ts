import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
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

it('receives 25,000,000 decoded PNG bytes including the native duplicated tool attachment', async () => {
  const small = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC', 'base64');
  const png = Buffer.alloc(25_000_000);
  small.copy(png, 0, 0, small.length - 12);
  png.writeUInt32BE(24_999_916, small.length - 12);
  png.write('npAD', small.length - 8);
  // CRC32 of npAD plus the zero-filled ancillary data; shared Python/Rust fixture.
  png.writeUInt32BE(0xd63aed4d, png.length - 16);
  small.subarray(-12).copy(png, png.length - 12);
  const digest = 'c0e33652298ddd7f7a95429fd3b117bb9c45a45113bfecd965c611b206e58c26';
  expect(createHash('sha256').update(png).digest('hex')).toBe(digest);
  const image = { type: 'image' as const, mimeType: 'image/png', data: png.toString('base64') };
  const p = await peer(), { sessionId } = await p.client.newSession();
  const turn = p.client.prompt(sessionId, 'offline fixture');
  await p.emit({ sessionUpdate: 'agent_message_chunk', content: image });
  await p.emit({ sessionUpdate: 'tool_call_update', toolCallId: 'read-image', status: 'completed',
    content: [{ type: 'content', content: image }, { type: 'diff', path: '/tmp/a', oldText: 'old', newText: 'new' }],
    rawOutput: { output: 'native output', metadata: { data: 'opaque' }, attachments: [{ mime: 'image/png', filename: 'two.png', url: `data:image/png;base64,${image.data}` }] } });
  await p.finish();
  expect(await turn).toEqual({ stopReason: 'end_turn' });
  await vi.waitFor(() => expect(p.updates).toHaveLength(2));
  const first = p.updates[0] as Extract<acp.SessionUpdate, { sessionUpdate: 'agent_message_chunk' }>;
  const tool = p.updates[1] as acp.ToolCallUpdate & { rawOutput: { output: string; metadata: { data: string }; attachments: Array<{ url: string }> } };
  type Image = Extract<acp.ContentBlock, { type: 'image' }>;
  const received = [first.content, (tool.content![0] as { type: 'content'; content: Image }).content];
  for (const block of received) {
    const bytes = Buffer.from((block as Image).data, 'base64');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2, 1]);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  }
  expect(tool.status).toBe('completed');
  expect(tool.content![1]).toEqual({ type: 'diff', path: '/tmp/a', oldText: 'old', newText: 'new' });
  expect(tool.rawOutput.output).toBe('native output');
  expect(tool.rawOutput.metadata).toEqual({ data: 'opaque' });
  expect(createHash('sha256').update(Buffer.from(tool.rawOutput.attachments[0].url.split(',')[1], 'base64')).digest('hex')).toBe(digest);
}, 30_000);

it('does not confuse concurrent same-content prompt results', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  const first = p.client.prompt(sessionId, 'same'), second = p.client.prompt(sessionId, 'same');
  await vi.waitFor(() => expect(p.pending).toHaveLength(2));
  p.pending[1]({ stopReason: 'max_tokens' }); p.pending[0]({ stopReason: 'end_turn' });
  expect(await first).toEqual({ stopReason: 'end_turn' }); expect(await second).toEqual({ stopReason: 'max_tokens' });
});

it('emits exact v1 config and resume payloads without private cursor authoring', async () => {
  const p = await peer(), { sessionId } = await p.client.newSession();
  await p.client.setConfigOption(sessionId, 'model', 'native');
  await p.client.resumeSession(sessionId);
  expect(p.frames.find(f => f.method === 'session/set_config_option').params).toEqual({ sessionId, configId: 'model', value: 'native' });
  expect(p.frames.find(f => f.method === 'session/resume').params).toEqual({ sessionId, cwd: '/workspace', mcpServers: [] });
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
