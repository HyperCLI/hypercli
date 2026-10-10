import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { CodingAgentAcpClient } from '../src/acp.js';

it.each(['session/list', 'session/resume', 'session/load'])('retains native model config updates delivered during %s', async method => {
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
    await client.newSession();
    if (method === 'session/list') await client.listSessions();
    else if (method === 'session/resume') await client.resumeSession('native-session');
    else await client.loadSession('native-session');
    await client.setModel('native-session', 'next');
    expect(requests.at(-1).params).toEqual({ sessionId: 'native-session', configId: 'native-model-option', value: 'next' });
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
