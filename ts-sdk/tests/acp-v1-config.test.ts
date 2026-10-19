import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import * as acp from '@agentclientprotocol/sdk';
import { CodingAgentAcpClient } from '../src/acp.js';

it.each([
  ['session/list', true], ['session/resume', true],
  ['session/resume', false],
] as const)('retains native model config updates during %s (warm=%s)', async (method, warm) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const requests: any[] = [];
  const options = [{ id: 'native-model-option', category: 'model', name: 'Model', type: 'select',
    currentValue: 'first', options: [{ value: 'first', name: 'First' }, { value: 'next', name: 'Next' }] }];
  server.on('connection', socket => socket.on('message', bytes => {
    const frame = JSON.parse(bytes.toString());
    requests.push(frame);
    let result: unknown = {};
    if (frame.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {} };
    if (frame.method === 'session/new') result = { sessionId: 'native-session' };
    if (frame.method === 'session/set_config_option') result = { configOptions: options };
    if (frame.method === method) {
      socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: 'native-session', update: { sessionUpdate: 'config_option_update', configOptions: options } } }));
      result = method === 'session/list' ? { sessions: [] } : {};
    }
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
  }));
  const client = await CodingAgentAcpClient.connect({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' }, { cwd: '/workspace' });
  try {
    if (warm) await client.newSession();
    if (method === 'session/list') await client.listSessions();
    else await client.resumeSession('native-session');
    await client.setModel('native-session', 'next');
    expect(requests.at(-1).params).toEqual({ sessionId: 'native-session', configId: 'native-model-option', value: 'next' });
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('constructs native v1 boolean config requests and preserves the string and object APIs', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const requests: any[] = [];
  const options: acp.SessionConfigOption[] = [{ id: 'auto', name: 'Auto', type: 'boolean', currentValue: true }];
  const handled: acp.SetSessionConfigOptionRequest[] = [];
  const connections: Array<{ close(): Promise<void> }> = [];
  server.on('connection', socket => {
    const agent = acp.agent({ name: 'native-config-fixture' })
      .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {} }))
      .onRequest('session/new', () => ({ sessionId: 'native', configOptions: options }))
      .onRequest('session/set_config_option', ({ params }) => {
        handled.push(params);
        if (params.configId === 'refuse') throw new acp.RequestError(-32012, 'native refusal', { detail: 'preserved' });
        return { configOptions: options };
      });
    let closed = false;
    connections.push(agent.connect({
      readable: new ReadableStream<acp.AnyMessage>({ start(controller) {
        socket.on('message', raw => { if (!closed) { const frame = JSON.parse(raw.toString()); requests.push(frame); controller.enqueue(frame); } });
        socket.on('close', () => { if (!closed) { closed = true; controller.close(); } });
      }, cancel() { closed = true; } }),
      writable: new WritableStream<acp.AnyMessage>({ write(frame) { socket.send(JSON.stringify(frame)); } }),
    }));
  });
  const client = await CodingAgentAcpClient.connect({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' }, { cwd: '/workspace' });
  try {
    await client.newSession();
    for (const value of [true, false, 'next']) {
      expect(await client.setConfigOption('native', 'auto', value)).toEqual({ configOptions: options });
      const expected = { sessionId: 'native', configId: 'auto', value,
        ...(typeof value === 'boolean' ? { type: 'boolean' } : {}) };
      expect(requests.at(-1).params).toEqual(expected);
      expect(handled.at(-1)).toEqual(expected);
    }
    const native = { sessionId: 'native', configId: 'auto', type: 'boolean' as const, value: true };
    await client.setConfigOption(native);
    expect(requests.at(-1).params).toEqual(native);
    await client.setConfigOption({ sessionId: 'native', configId: 'auto', value: 'next' });
    expect(requests.at(-1).params).toEqual({ sessionId: 'native', configId: 'auto', value: 'next' });
    await expect(client.setConfigOption('native', 'refuse', true)).rejects.toMatchObject({
      code: -32012, message: 'native refusal', data: { detail: 'preserved' },
    });
  } finally {
    client.close();
    for (const connection of connections) await connection.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
