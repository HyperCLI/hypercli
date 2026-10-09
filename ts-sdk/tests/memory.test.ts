import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIError, HyperCLI, MemoryAPI } from '../src/index.js';

const summary = {
  session_id: 'session-1', title: 'Release', summary_text: 'Decided to ship.', pending: false,
  summary_cursor: 0, summarized_at: '2026-10-01T00:00:00Z', imported_at: null,
};
const chunk = {
  id: 'chunk-1', session_id: 'session-1', seq_start: 1, seq_end: 9,
  text: 'The release plan',
};

function setup(payload: unknown) {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  const client = new HyperCLI({ apiKey: 'caller-key', apiUrl: 'https://product.example' });
  return { fetch, api: client.memory };
}

afterEach(() => vi.unstubAllGlobals());

describe('MemoryAPI HTTP contract', () => {
  it('exports and wires the namespace to the existing agents HTTP client', async () => {
    const { fetch, api } = setup({ items: [{ ...chunk, score: 0.9 }] });
    expect(api).toBeInstanceOf(MemoryAPI);
    const result = await api.search('release & notes?', { sessionId: 'id/with spaces', limit: 3 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://product.example/agents/memory/search?q=release+%26+notes%3F&session_id=id%2Fwith+spaces&limit=3',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' } }),
    );
    // Legacy `{ items }` shape decodes as a terminal page with no session join.
    expect(result).toEqual({ items: [{
      id: 'chunk-1', sessionId: 'session-1', seqStart: 1, seqEnd: 9,
      text: chunk.text, score: 0.9, title: null, summaryText: null, summaryKeywords: [],
    }], nextCursor: null, hasMore: false });
  });

  it('pages with the agent filter and cursor, decoding the enriched envelope', async () => {
    const { fetch, api } = setup({
      items: [
        { ...chunk, score: 0.9, title: 'Release', summary_text: 'Decided to ship.', summary_keywords: ['release', 'ship'] },
        { ...chunk, id: 'chunk-2', score: 0.5, title: null, summary_text: null, summary_keywords: null },
      ],
      next_cursor: 'opaque+/=', has_more: true,
    });
    const page = await api.search('launch plan', { agentId: 'agent/1', cursor: 'prev+/=', limit: 5 });
    expect(fetch.mock.calls[0][0]).toBe('https://product.example/agents/memory/search?q=launch+plan&agent_id=agent%2F1&cursor=prev%2B%2F%3D&limit=5');
    expect(page).toEqual({
      items: [
        { id: 'chunk-1', sessionId: 'session-1', seqStart: 1, seqEnd: 9, text: chunk.text, score: 0.9, title: 'Release', summaryText: 'Decided to ship.', summaryKeywords: ['release', 'ship'] },
        { id: 'chunk-2', sessionId: 'session-1', seqStart: 1, seqEnd: 9, text: chunk.text, score: 0.5, title: null, summaryText: null, summaryKeywords: [] },
      ],
      nextCursor: 'opaque+/=', hasMore: true,
    });
  });

  it('tolerates a bare-array legacy response as a terminal page', async () => {
    const { api } = setup([{ ...chunk, score: 0.5 }]);
    expect(await api.search('plan')).toEqual({
      items: [{ id: 'chunk-1', sessionId: 'session-1', seqStart: 1, seqEnd: 9, text: chunk.text, score: 0.5, title: null, summaryText: null, summaryKeywords: [] }],
      nextCursor: null, hasMore: false,
    });
  });

  it('omits unspecified search options and respects an explicit agents base', async () => {
    const { fetch } = setup({ items: [] });
    const client = new HyperCLI({ apiKey: 'key', agentsApiBaseUrl: 'https://agents.example/custom' });
    expect(await client.memory.search('hello')).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(fetch.mock.calls[0][0]).toBe('https://agents.example/custom/agents/memory/search?q=hello');
  });

  it('decodes summary metadata, including a zero cursor and nullable timestamps', async () => {
    const { fetch, api } = setup(summary);
    expect(await api.getSummary('id/ ?#%')).toEqual({
      sessionId: 'session-1', title: 'Release', summaryText: summary.summary_text, pending: false,
      summaryCursor: 0, summarizedAt: summary.summarized_at, importedAt: null,
      summaryState: null, summaryFailureReason: null,
    });
    expect(fetch.mock.calls[0][0]).toBe('https://product.example/agents/sessions/id%2F%20%3F%23%25/summary');
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...summary, summary_text: null, summary_cursor: null, summarized_at: null })));
    expect(await api.getSummary('session-1')).toMatchObject({ summaryText: null, summaryCursor: null, summarizedAt: null, importedAt: null });
  });

  it('preserves worker failure diagnostics for summary inspection', async () => {
    const { api } = setup({ ...summary, summary_state: 'failed', summary_failure_reason: 'chunk-invalid-output' });
    expect(await api.getSummary('session-1')).toMatchObject({
      summaryState: 'failed', summaryFailureReason: 'chunk-invalid-output', pending: false,
    });
  });

  it('preserves chunk pagination and encodes opaque cursors', async () => {
    const { fetch, api } = setup({ items: [chunk], next_cursor: 'next+/=', has_more: true });
    const page = await api.getChunks('session/1', { cursor: 'opaque+/=', limit: 4 });
    expect(fetch.mock.calls[0][0]).toBe('https://product.example/agents/sessions/session%2F1/chunks?cursor=opaque%2B%2F%3D&limit=4');
    expect(page).toEqual({ items: [{ id: 'chunk-1', sessionId: 'session-1', seqStart: 1, seqEnd: 9, text: chunk.text }], nextCursor: 'next+/=', hasMore: true });
  });

  it('requests tail n=20 by default and decodes logical text messages', async () => {
    const { fetch, api } = setup({ session_id: 's', items: [{ seq_start: 8, seq_end: 12, role: 'assistant', text: 'hello\nworld', participant_id: null }] });
    expect(await api.getTail('s')).toEqual({ sessionId: 's', items: [{ seqStart: 8, seqEnd: 12, role: 'assistant', text: 'hello\nworld', participantId: null }] });
    expect(fetch.mock.calls[0][0]).toBe('https://product.example/agents/sessions/s/tail?n=20');
    await api.getTail('s', 5);
    expect(fetch.mock.calls[1][0]).toBe('https://product.example/agents/sessions/s/tail?n=5');
  });

  it('posts a rebuild without a body or client-side cooldown', async () => {
    const { fetch, api } = setup(null);
    const response = () => new Response(JSON.stringify({ session_id: 'session/1', status: 'pending' }), { status: 202 });
    fetch.mockImplementation(async () => response());
    expect(await api.rebuild('session/1')).toEqual({ sessionId: 'session/1', status: 'pending' });
    await api.rebuild('session/1');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('https://product.example/agents/sessions/session%2F1/summary/rebuild', expect.objectContaining({ method: 'POST', body: undefined }));
  });

  it.each([401, 403, 404, 422, 429])('preserves HTTP %s errors and server cooldown details', async (status) => {
    const { fetch, api } = setup(null);
    fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Rebuild unavailable' }), { status }));
    const result = api.rebuild('s');
    await expect(result).rejects.toBeInstanceOf(APIError);
    await expect(result).rejects.toMatchObject({ statusCode: status, message: expect.stringContaining('Rebuild unavailable'), retryAfterSeconds: undefined });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('captures the Retry-After header on a 429 cooldown', async () => {
    const { fetch, api } = setup(null);
    fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Rebuild unavailable' }), { status: 429, headers: { 'Retry-After': '86400' } }));
    const result = api.rebuild('s');
    await expect(result).rejects.toMatchObject({ statusCode: 429, detail: 'Rebuild unavailable', retryAfterSeconds: 86400 });
  });

  it('does not retry an uncertain rebuild transport failure', async () => {
    const { fetch, api } = setup(null);
    const error = Object.assign(new Error('connection reset'), { cause: { code: 'ECONNRESET' } });
    fetch.mockRejectedValue(error);
    await expect(api.rebuild('s')).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['search', 'getSummary', 'getChunks', 'getTail'] as const)('propagates %s read errors without swallowing them', async (method) => {
    const { fetch, api } = setup(null);
    fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Session access denied' }), { status: 403 }));
    await expect(api[method]('s')).rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining('Session access denied') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves exhausted chunk and empty tail envelopes', async () => {
    const { fetch, api } = setup({ items: [], next_cursor: null, has_more: false });
    expect(await api.getChunks('s')).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(fetch.mock.calls[0][0]).toBe('https://product.example/agents/sessions/s/chunks');
    fetch.mockResolvedValue(new Response(JSON.stringify({ session_id: 's', items: [] })));
    expect(await api.getTail('s')).toEqual({ sessionId: 's', items: [] });
  });
});
