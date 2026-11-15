import { expect, it, vi } from 'vitest';
import type { CreateElicitationResponse } from '../src/acp.js';

const wire = vi.hoisted(() => ({ socket: null as any, frames: [] as any[] }));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class Socket extends EventEmitter {
    readyState = 0;
    constructor() {
      super(); wire.socket = this;
      queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
    }
    send(text: string) {
      const frame = JSON.parse(text); wire.frames.push(frame);
      if (frame.method === 'initialize') queueMicrotask(() => this.emit('message', JSON.stringify({
        jsonrpc: '2.0', id: frame.id, result: { protocolVersion: 1, agentCapabilities: {} },
      })));
    }
    close() { this.readyState = 3; this.emit('close', 1000, ''); }
  } };
});

import { CodingAgentAcpClient } from '../src/acp.js';

it('carries concurrent standard forms, exact numeric/string IDs, responses, cancellation and no handler errors over the real SDK stream', async () => {
  const client = await CodingAgentAcpClient.connect({ url: 'ws://fixture.invalid', token: '' }, {
    reconnect: false, clientCapabilities: { elicitation: { form: {} } },
  });
  try {
    expect(wire.frames[0].params.clientCapabilities).toEqual({ elicitation: { form: {} } });
    const pending: { resolve: (response: CreateElicitationResponse) => void; signal?: AbortSignal; params: unknown }[] = [];
    client.setElicitationHandler((params, signal) => new Promise(resolve => { pending.push({ params, signal, resolve }); }));
    const params = { sessionId: 'opaque/session', toolCallId: 'same', mode: 'form', message: 'Choose',
      requestedSchema: { type: 'object', properties: { q0: { type: 'string', enum: ['native-value'] }, q0_custom: { type: 'string' } } } };
    const receive = (frame: object) => wire.socket.emit('message', JSON.stringify({ jsonrpc: '2.0', ...frame }));
    for (const id of [7, '7', 'cancel']) receive({ id, method: 'elicitation/create', params });
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(pending.map(item => item.params)).toEqual([params, params, params]);
    pending[1].resolve({ action: 'decline' });
    pending[0].resolve({ action: 'accept', content: { q0: 'native-value', q0_custom: 'verbatim' } });
    pending[2].resolve({ action: 'cancel' });
    await vi.waitFor(() => expect(wire.frames.filter(frame => frame.result)).toHaveLength(3));
    expect(wire.frames.find(frame => frame.id === 7 && frame.result)?.result).toEqual({ action: 'accept', content: { q0: 'native-value', q0_custom: 'verbatim' } });
    expect(wire.frames.find(frame => frame.id === '7')?.result).toEqual({ action: 'decline' });
    expect(wire.frames.find(frame => frame.id === 'cancel')?.result).toEqual({ action: 'cancel' });
    receive({ id: 'abort', method: 'elicitation/create', params });
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    receive({ method: '$/cancel_request', params: { requestId: 'abort' } });
    await vi.waitFor(() => expect(pending[3].signal?.aborted).toBe(true));
    pending[3].resolve({ action: 'cancel' });
    client.setElicitationHandler(null);
    receive({ id: 'absent', method: 'elicitation/create', params });
    await vi.waitFor(() => expect(wire.frames.find(frame => frame.id === 'absent')?.error?.code).toBe(-32603));
  } finally { await client.close(); }
});
