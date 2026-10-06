import { afterEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { CodingAgentAcpClient } from '../src/acp.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function peer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>((resolve) => {
    server.clients.forEach((socket) => socket.terminate());
    server.close(() => resolve());
  }));
  const prompted = deferred<Record<string, any>>();
  const cancelled = deferred<Record<string, any>>();
  let reply!: (frame: Record<string, unknown>) => void;
  server.on('connection', (socket) => {
    reply = (frame) => socket.send(JSON.stringify(frame));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === 'initialize') reply({ jsonrpc: '2.0', id: frame.id,
        result: { protocolVersion: 2, info: { name: 'vanilla-fixture', version: '1' }, capabilities: { session: {} } } });
      if (frame.method === 'session/prompt') prompted.resolve(frame); // never accepts
      if (frame.method === 'session/cancel') cancelled.resolve(frame); // never confirms
      if (frame.method === 'session/list') reply({ jsonrpc: '2.0', id: frame.id, result: { sessions: [] } });
    });
  });
  const client = await CodingAgentAcpClient.connect({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' },
    { getPromptCompletion: async () => null });
  cleanup.push(() => client.close());
  return { client, prompted, cancelled, reply: (frame: Record<string, unknown>) => reply(frame) };
}

it('sends exact-session cancellation while prompt acceptance is unresolved, without manufacturing completion', async () => {
  const { client, prompted, cancelled } = await peer();
  let settled = false;
  const observation = client.prompt('native:Case/A', 'never answers');
  void observation.then(() => { settled = true; }, () => { settled = true; });
  await prompted.promise;
  await client.cancel('native:Case/A');
  expect(await cancelled.promise).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'native:Case/A' } });
  await client.listSessions(); // responsive peer after cancel, not an execution receipt
  expect(settled).toBe(false);
  const rejected = expect(observation).rejects.toThrow();
  client.close();
  await rejected;
});

it('cannot treat v2 idle as a per-message cancellation receipt', async () => {
  const { client, prompted, cancelled, reply } = await peer();
  const observation = client.prompt('A', 'original');
  const rejected = expect(observation).rejects.toThrow('completion receipt');
  const prompt = await prompted.promise;
  reply({ jsonrpc: '2.0', id: prompt.id, result: { messageId: 'accepted-A' } });
  await client.cancel('A');
  await cancelled.promise;
  reply({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'A',
    update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' } } });
  await rejected;
});

it('reports closed transport cancellation rather than silently succeeding', async () => {
  const { client } = await peer();
  client.close();
  await expect(client.cancel('A')).rejects.toThrow();
});

it('does not retarget an old session cancellation to a newer foreground', async () => {
  const { client, prompted, cancelled } = await peer();
  const observation = client.prompt('B', 'new foreground');
  void observation.catch(() => {});
  await prompted.promise;
  await client.cancel('A');
  expect((await cancelled.promise).params).toEqual({ sessionId: 'A' });
  const rejected = expect(observation).rejects.toThrow();
  client.close();
  await rejected;
});
