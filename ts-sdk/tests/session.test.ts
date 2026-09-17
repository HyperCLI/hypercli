import { describe, expect, it, vi } from 'vitest';

import { HermesSessionClient } from '../src/session.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('HermesSessionClient', () => {
  it('connects by proving liveness and authorization, then reports connected', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', platform: 'hermes-agent', version: '0.20.0' });
      if (url.endsWith('/v1/capabilities')) return jsonResponse({ platform: 'hermes-agent', model: 'kimi-k2.6', auth: { type: 'bearer', required: true }, features: {}, endpoints: {} });
      return jsonResponse({}, 404);
    });
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'server-secret',
      fetch: fetchMock as typeof fetch,
    });

    expect(client.state).toBe('disconnected');
    await client.connect();

    expect(urls).toEqual([
      'https://hermes.example.test/health',
      'https://hermes.example.test/v1/capabilities',
    ]);
    expect(client.state).toBe('connected');
    expect(client.connected).toBe(true);

    client.close();
    expect(client.state).toBe('disconnected');
  });

  it('resets to disconnected when the key is rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', platform: 'hermes-agent', version: '0.20.0' });
      return jsonResponse({ error: { message: 'bad key', type: 'gateway_auth_error' } }, 401);
    });
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'wrong',
      fetch: fetchMock as typeof fetch,
    });

    await expect(client.connect()).rejects.toMatchObject({ statusCode: 401 });
    expect(client.state).toBe('disconnected');
  });

  it('maps sessions between the canonical and hermes shapes', async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (url.endsWith('/api/sessions') && init?.method === 'POST') {
        return jsonResponse({ object: 'hermes.session', session: { id: 'sess-1', title: 'Research', source: 'api_server', model: 'kimi-k2.6' } });
      }
      if (url.includes('/api/sessions')) {
        return jsonResponse({
          object: 'list',
          data: [{ id: 'sess-1', title: 'Research', source: 'api_server', model: 'kimi-k2.6' }],
          limit: 50,
          offset: 0,
          has_more: false,
        });
      }
      return jsonResponse({}, 404);
    });
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const created = await client.sessionsCreate({ label: 'Research', model: 'kimi-k2.6' });
    expect(created).toMatchObject({ key: 'sess-1', sessionId: 'sess-1', label: 'Research', model: 'kimi-k2.6' });
    expect(bodies[0]).toMatchObject({ title: 'Research', model: 'kimi-k2.6', source: 'api_server' });

    const sessions = await client.sessionsList();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ key: 'sess-1', label: 'Research' });
    expect(sessions[0].raw).toMatchObject({ id: 'sess-1' });
  });

  it('maps session messages into canonical history messages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [
        { id: 'm1', role: 'user', content: 'hello', created_at: '2026-08-22T10:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'hi there', reasoning: 'thinking...' },
      ],
    }));
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const history = await client.chatHistory('sess-1');

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', text: 'hello', messageId: 'm1' });
    expect(history[1]).toMatchObject({ role: 'assistant', text: 'hi there', thinking: 'thinking...' });
  });

  it('requires a session key for history and chat', async () => {
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: vi.fn() as unknown as typeof fetch,
    });

    await expect(client.chatHistory()).resolves.toEqual([]);
    const stream = client.chatSend('hi', '');
    await expect(stream.next()).rejects.toThrow('session key');
  });

  it('canonicalizes the hermes chat SSE lifecycle', async () => {
    const frames = [
      sseFrame('run.started', { run_id: 'run_1', session_id: 'sess-1', user_message: { role: 'user', content: 'hi' } }),
      sseFrame('message.started', { run_id: 'run_1', session_id: 'sess-1', message: { id: 'msg-1', role: 'assistant' } }),
      sseFrame('assistant.delta', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', delta: 'Hel' }),
      sseFrame('assistant.delta', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', delta: 'lo' }),
      sseFrame('tool.progress', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', tool_name: '_thinking', delta: 'reasoning' }),
      sseFrame('tool.started', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', tool_name: 'terminal', args: { command: 'ls' } }),
      sseFrame('tool.completed', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', tool_name: 'terminal', preview: 'file.txt' }),
      sseFrame('assistant.completed', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', content: 'Hello', completed: true, partial: false, interrupted: false }),
      sseFrame('run.completed', { run_id: 'run_1', session_id: 'sess-1', message_id: 'msg-1', completed: true, usage: { total_tokens: 12 } }),
      sseFrame('done', {}),
    ].join('');
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return sseResponse(frames);
    });
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const events = [];
    for await (const event of client.chatSend('hi', 'sess-1')) events.push(event);

    expect(bodies[0]).toMatchObject({ message: 'hi' });
    expect(events.map((event) => event.type)).toEqual([
      'content',
      'content',
      'thinking',
      'tool_call',
      'tool_result',
      'content',
      'done',
    ]);
    expect(events[0]).toMatchObject({ text: 'Hel', runId: 'run_1', messageId: 'msg-1', sessionKey: 'sess-1' });
    expect(events[1]).toMatchObject({ text: 'lo' });
    expect(events[2]).toMatchObject({ text: 'reasoning' });
    expect(events[3]).toMatchObject({ data: { name: 'terminal', args: { command: 'ls' } } });
    expect(events[4]).toMatchObject({ data: { name: 'terminal', preview: 'file.txt' } });
    expect(events[5]).toMatchObject({ text: 'Hello', replace: true });
    expect(events[6]).toMatchObject({ data: { usage: { total_tokens: 12 } } });
  });

  it('surfaces run failures as error events and clears the active run', async () => {
    const frames = [
      sseFrame('run.started', { run_id: 'run_2', session_id: 'sess-1' }),
      sseFrame('error', { run_id: 'run_2', session_id: 'sess-1', message: 'model exploded' }),
      sseFrame('done', {}),
    ].join('');
    const fetchMock = vi.fn(async () => sseResponse(frames));
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const events = [];
    for await (const event of client.chatSend('hi', 'sess-1')) events.push(event);

    expect(events).toEqual([
      expect.objectContaining({ type: 'error', text: 'model exploded', runId: 'run_2' }),
    ]);
    await expect(client.chatAbort('sess-1')).rejects.toThrow('active run id');
  });

  it('aborts the tracked run through the stop endpoint', async () => {
    const frames = sseFrame('run.started', { run_id: 'run_9', session_id: 'sess-1' });
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/stop')) return jsonResponse({ run_id: 'run_9', status: 'stopping' });
      const response = sseResponse(frames);
      return response;
    });
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const stream = client.chatSend('hi', 'sess-1');
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(true);

    await client.chatAbort('sess-1');
    expect(calls).toContain('POST https://hermes.example.test/v1/runs/run_9/stop');
  });

  it('lists models in the canonical shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      object: 'list',
      data: [{ id: 'kimi-k2.6', object: 'model', owned_by: 'hermes' }],
    }));
    const client = new HermesSessionClient('https://hermes.example.test', {
      apiKey: 'k',
      fetch: fetchMock as typeof fetch,
    });

    const models = await client.modelsList();
    expect(models).toEqual([
      expect.objectContaining({ id: 'kimi-k2.6', label: 'kimi-k2.6' }),
    ]);
  });
});
