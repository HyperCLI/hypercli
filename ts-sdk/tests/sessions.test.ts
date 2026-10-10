import { afterEach, describe, it, expect, vi } from 'vitest';
import { HyperCLI, APIError, type AcpSessionRecord } from '../src/index.js';
import { SessionsAPI, type AcpSessionState, type SessionDiscoveryStatus, type SessionImportOutcome } from '../src/sessions.js';

describe('durable session import evidence', () => {
  it.each(['retained', 'empty', 'filtered', 'unsupported', 'malformed', 'failed'] as const)(
    'preserves %s even on an empty messages page', async (status) => {
      const outcome: SessionImportOutcome = {
        status, protocol_version: 1, generation: 3, recorded_at: '2026-10-06T12:00:00Z',
        observed_updates: 5, valid_updates: 2, filtered_updates: 1,
        invalid_updates: 1, foreign_updates: 2, retained_rows: 1,
      };
      const get = vi.fn().mockResolvedValue({ id: 's', import_outcome: outcome,
        items: [{ id: 's', import_outcome: outcome }], has_more: false });
      const api = new SessionsAPI({ get });
      expect((await api.getSession('s')).importOutcome).toEqual(outcome);
      expect((await api.listSessions()).items[0].importOutcome).toEqual(outcome);
      get.mockResolvedValue({ items: [], has_more: false, import_outcome: outcome });
      const page = await api.getMessages('s', { cursor: 'older' });
      expect(page.items).toEqual([]);
      expect(page.importOutcome).toEqual(outcome);
    });
  it('keeps absent evidence unknown for old servers and live sessions', async () => {
    const api = new SessionsAPI({ get: vi.fn().mockResolvedValue({ id: 's', items: [], has_more: false }) });
    expect((await api.getSession('s')).importOutcome).toBeNull();
    expect((await api.getMessages('s')).importOutcome).toBeNull();
  });
});

describe('native session discovery REST', () => {
  it.each(['pending', 'running', 'complete', 'error', 'unsupported'] as const)('preserves %s independently of catalog rows', async (status) => {
    const payload: SessionDiscoveryStatus = {
      status, error_code: status === 'error' ? 'discovery_failed' : null,
      discovered_count: status === 'complete' ? 0 : null,
      queued_count: 0, importing_count: 0, last_attempt_at: null, last_completed_at: null,
    };
    const http = { get: vi.fn().mockResolvedValue(payload), post: vi.fn().mockResolvedValue(payload) };
    const api = new SessionsAPI(http);
    expect(await api.getDiscoveryStatus('agent/id')).toEqual(payload);
    expect(http.get).toHaveBeenCalledWith('/sessions/discovery', { agent_id: 'agent/id' });
    expect(await api.requestDiscovery('agent/id')).toEqual(payload);
    expect(http.post).toHaveBeenCalledWith('/sessions/discovery?agent_id=agent%2Fid');
  });

  it('propagates denied/unavailable responses rather than creating empty success', async () => {
    const http = { get: vi.fn().mockRejectedValue(new Error('403')), post: vi.fn().mockRejectedValue(new Error('503')) };
    const api = new SessionsAPI(http);
    await expect(api.getDiscoveryStatus('agent')).rejects.toThrow('403');
    await expect(api.requestDiscovery('agent')).rejects.toThrow('503');
  });
});

/**
 * §15 REST read surface (sessions/README §15). These fixtures mirror the
 * landed backend contract — `agents/backend/agents/session_routes.py`
 * `SessionListPage` / `SessionMessagePage` (`{ items, next_cursor, has_more }`
 * envelopes, snake_case fields, UUID ids, participants embedded on session rows) —
 * and pin the client half of it: paths, opaque-cursor pagination args, LIMIT
 * N+1 has_more sentinel.
 */

function fakeHttp(payload: unknown) {
  return { get: vi.fn(async () => payload) };
}

const SESSION_ID = 'b7a3d1e2-4f50-4c6a-9d2b-8c1f0a5e6d7b';
const AGENT_ID = '3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45';
const USER_ID = '81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d';

const sessionRow = {
  id: SESSION_ID,
  summary_text: 'investigate flaky vitest run',
  summary_keywords: ['vitest', 'flake'],
  created_at: '2026-09-25T12:00:00+00:00',
  updated_at: '2026-09-26T08:30:00+00:00',
  participants: [
    {
      kind: 'agent',
      participant_id: AGENT_ID,
      internal_session_id: 'claude-session-9f2e',
      cursor_pos: 14,
    },
    {
      kind: 'user',
      participant_id: USER_ID,
      internal_session_id: null,
      cursor_pos: 14,
    },
  ],
};

const messageRow = {
  session_id: SESSION_ID,
  seq: 42,
  role: 'assistant',
  participant_kind: 'agent',
  participant_id: AGENT_ID,
  acp: { stopReason: 'end_turn', text: 'done' },
  stop_reason: 'end_turn',
  created_at: '2026-09-26T08:30:00+00:00',
  delivered_at: '2026-09-26T08:30:05+00:00',
  completed_at: '2026-09-26T08:30:07+00:00',
};

describe('session detail HTTP contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([null, 'slack', 'future-client'])('hydrates all metadata with source %s using caller auth', async (source) => {
    const row = { ...sessionRow, source };
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/sessions') ? { items: [row], has_more: false } : row,
    ), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new HyperCLI({ apiKey: 'caller-key', apiUrl: 'https://example.com' });

    const detail: AcpSessionState = await client.sessions.getSession(SESSION_ID);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://example.com/agents/sessions/${SESSION_ID}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
    const record: AcpSessionRecord = {
      importOutcome: null,
      id: SESSION_ID, source,
      summaryText: sessionRow.summary_text, summaryKeywords: sessionRow.summary_keywords,
      createdAt: sessionRow.created_at, updatedAt: sessionRow.updated_at,
      participants: [
        { kind: 'agent', participantId: AGENT_ID, internalSessionId: 'claude-session-9f2e', cursorPos: 14 },
        { kind: 'user', participantId: USER_ID, internalSessionId: null, cursorPos: 14 },
      ],
    };
    // sessionRow carries no state fields, like a pre-state backend: absent means empty.
    expect(detail).toEqual({ ...record, lastMessageId: null, messageCount: 0, headSeq: 0, receipts: [], agentState: null });
    // The catalog read never carries state fields; only the detail read does.
    expect((await client.sessions.listSessions()).items[0]).toEqual(record);
  });

  it('encodes the supplied platform ID without resolving runtime IDs and preserves null metadata', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      id: SESSION_ID, source: null, summary_text: null, summary_keywords: null,
      created_at: sessionRow.created_at, updated_at: sessionRow.updated_at, participants: [],
    })));
    vi.stubGlobal('fetch', fetch);
    const client = new HyperCLI({ apiKey: 'caller-key', apiUrl: 'https://example.com' });
    const detail = await client.sessions.getSession('platform/odd id?#%');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/agents/sessions/platform%2Fodd%20id%3F%23%25');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(detail).toEqual({
      importOutcome: null,
      id: SESSION_ID, source: null, summaryText: null, summaryKeywords: [],
      createdAt: sessionRow.created_at, updatedAt: sessionRow.updated_at, participants: [],
      lastMessageId: null, messageCount: 0, headSeq: 0, receipts: [], agentState: null,
    });
  });

  it('hydrates the state fields when the backend serves them', async () => {
    const receipt = {
      message_id: 'm-user-3', role: 'user',
      created_at: '2026-09-26T08:30:00+00:00', delivered_at: '2026-09-26T08:30:05+00:00',
      completed_at: null,
    };
    const api = new SessionsAPI({ get: vi.fn().mockResolvedValue({ ...sessionRow,
      last_message_id: 'm-agent-7', message_count: 7, head_seq: 64, receipts: [receipt] }) });
    const detail: AcpSessionState = await api.getSession(SESSION_ID);
    expect(detail.lastMessageId).toBe('m-agent-7');
    expect(detail.messageCount).toBe(7);
    expect(detail.headSeq).toBe(64);
    expect(detail.receipts).toEqual([{ messageId: 'm-user-3', role: 'user',
      createdAt: receipt.created_at, deliveredAt: receipt.delivered_at, completedAt: null }]);
  });

  it.each(['live', 'archived', 'deleted'] as const)('hydrates agent connection state %s computed per request', async (agentState) => {
    const api = new SessionsAPI({ get: vi.fn().mockResolvedValue({ ...sessionRow, agent_state: agentState }) });
    expect((await api.getSession(SESSION_ID)).agentState).toBe(agentState);
  });

  it.each(['draining', null])('defaults unknown or absent agent state %s to null', async (agentState) => {
    const wire = agentState === null ? { ...sessionRow } : { ...sessionRow, agent_state: agentState };
    const api = new SessionsAPI({ get: vi.fn().mockResolvedValue(wire) });
    expect((await api.getSession(SESSION_ID)).agentState).toBeNull();
  });

  it.each([401, 403, 404, 422])('propagates HTTP %s without ACP fallback', async (status) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'Denied or invalid session' }), { status }));
    vi.stubGlobal('fetch', fetch);
    const client = new HyperCLI({ apiKey: 'caller-key', apiUrl: 'https://example.com' });
    const result = client.sessions.getSession(SESSION_ID);
    await expect(result).rejects.toBeInstanceOf(APIError);
    await expect(result).rejects.toMatchObject({ statusCode: status, message: expect.stringContaining('Denied or invalid session') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('transcript search and window reads', () => {
  const hitRow = {
    session_id: SESSION_ID, seq: 42, role: 'assistant', message_id: 'agent-msg-7',
    excerpt: 'the flaky vitest run', score: null,
  };

  it('searches transcripts globally with the opaque page envelope', async () => {
    const http = fakeHttp({ items: [hitRow], next_cursor: 'k1', has_more: true });
    const api = new SessionsAPI(http as never);

    const page = await api.searchTranscript('flaky & run?', { cursor: 'cur/+=', limit: 25 });

    expect(http.get).toHaveBeenCalledWith('/sessions/search', { q: 'flaky & run?', cursor: 'cur/+=', limit: 25 });
    expect(page).toEqual({
      items: [{
        sessionId: SESSION_ID, seq: 42, role: 'assistant',
        messageId: 'agent-msg-7', excerpt: 'the flaky vitest run', score: null,
      }],
      nextCursor: 'k1',
      hasMore: true,
    });
  });

  it('scopes a transcript search to one session and omits absent options', async () => {
    const http = fakeHttp({ items: [], next_cursor: null, has_more: false });
    const api = new SessionsAPI(http as never);

    const page = await api.searchTranscript('needle', { sessionId: 'sess/1' });

    expect(http.get).toHaveBeenCalledWith('/sessions/search', { q: 'needle', session_id: 'sess/1' });
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('fetches an ascending window around a focus seq', async () => {
    const http = fakeHttp({ session_id: 'sess/1', focus_seq: 10, items: [messageRow] });
    const api = new SessionsAPI(http as never);

    const window = await api.getMessagesAround('sess/1', 10, { radius: 5 });

    expect(http.get).toHaveBeenCalledWith('/sessions/sess%2F1/messages/around', { seq: 10, radius: 5 });
    expect(window.sessionId).toBe('sess/1');
    expect(window.focusSeq).toBe(10);
    expect(window.items[0].seq).toBe(42);
    expect(window.items[0].participantId).toBe(AGENT_ID);
  });

  it('hits the real agents gateway base with the bearer key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], has_more: false }))));
    const client = new HyperCLI({ apiKey: 'caller-key', apiUrl: 'https://example.com' });
    const page = await client.sessions.searchTranscript('rollback');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/agents/sessions/search?q=rollback',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' } }),
    );
    expect(page.items).toEqual([]);
  });
});

describe('SessionsAPI (§15)', () => {
  it('returns one coherent canonical page without rewriting native identity or complete tool fields', async () => {
    const output = 'large output '.repeat(10000);
    const acp = { type: 'session/update', protocolVersion: 1, params: { sessionId: 'native-session', update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'native-tool', content: [], rawOutput: output,
    } } };
    const http = fakeHttp({ items: [
      { ...messageRow, seq: '43', message_id: 'platform-tool', acp },
      { ...messageRow, seq: 42, message_id: 'platform-tool', acp: { type: 'session/update', protocolVersion: 1,
        params: { update: { sessionUpdate: 'tool_call', toolCallId: 'native-tool', title: 'Read' } } } },
    ], next_cursor: 'opaque+/older=', has_more: true });
    const api = new SessionsAPI(http as never);
    const page = await api.getMessages('session');
    expect(http.get).toHaveBeenCalledWith('/sessions/session/messages', { limit: 20 });
    expect(page.nextCursor).toBe('opaque+/older='); expect(page.hasMore).toBe(true);
    expect(page.items.map(row => row.seq)).toEqual([43, 42]);
    expect(page.items[0].messageId).toBe('platform-tool');
    expect(page.items[0].acp).toBe(acp);
    expect(page.items[0].participantId).toBe(AGENT_ID);
    expect(page.items[0].acp).toEqual(acp);
    await api.getMessages('session', { cursor: page.nextCursor, limit: 1 });
    expect(http.get).toHaveBeenLastCalledWith('/sessions/session/messages', { cursor: 'opaque+/older=', limit: 1 });
  });
  it.each([undefined, null, 'slack', 'future-client'])('decodes nullable open-ended source %s', async (source) => {
    const http = fakeHttp({ items: [{ ...sessionRow, source }], has_more: false });
    const page = await new SessionsAPI(http as never).listSessions();
    expect(page.items[0].source).toBe(source ?? null);
    expect(page.items[0].summaryText).toBe(sessionRow.summary_text);
  });
  it('lists the session catalog against /sessions with cursor+limit and parses the items envelope', async () => {
    const http = fakeHttp({ items: [sessionRow], next_cursor: 'cur-2', has_more: true });
    const api = new SessionsAPI(http as never);

    const page = await api.listSessions({ cursor: 'cur-1', limit: 25 });

    expect(http.get).toHaveBeenCalledWith('/sessions', { cursor: 'cur-1', limit: 25 });
    expect(page.nextCursor).toBe('cur-2');
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual({
      importOutcome: null,
      id: SESSION_ID,
      source: null,
      createdAt: '2026-09-25T12:00:00+00:00',
      updatedAt: '2026-09-26T08:30:00+00:00',
      summaryText: 'investigate flaky vitest run',
      summaryKeywords: ['vitest', 'flake'],
      participants: [
        {
          kind: 'agent',
          participantId: AGENT_ID,
          internalSessionId: 'claude-session-9f2e',
          cursorPos: 14,
        },
        {
          kind: 'user',
          participantId: USER_ID,
          internalSessionId: null,
          cursorPos: 14,
        },
      ],
    });
  });

  it('omits cursor/limit params when not given (first page)', async () => {
    const http = fakeHttp({ items: [], next_cursor: null, has_more: false });
    const api = new SessionsAPI(http as never);

    const page = await api.listSessions();

    expect(http.get).toHaveBeenCalledWith('/sessions', {});
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('pages a session’s history via GET /sessions/{id}/messages with the opaque cursor', async () => {
    const http = fakeHttp({ items: [{ ...messageRow, message_id: 'platform-run' }], next_cursor: 'sess-1:41', has_more: true });
    const api = new SessionsAPI(http as never);

    const page = await api.getMessages('sess-1', { cursor: 'sess-1:50', limit: 50 });

    expect(http.get).toHaveBeenCalledWith('/sessions/sess-1/messages', { cursor: 'sess-1:50', limit: 50 });
    expect(page.nextCursor).toBe('sess-1:41');
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toEqual({
      messageId: 'platform-run',
      sessionId: SESSION_ID,
      seq: 42,
      role: 'assistant',
      acp: { stopReason: 'end_turn', text: 'done' },
      stopReason: 'end_turn',
      createdAt: '2026-09-26T08:30:00+00:00',
      deliveredAt: '2026-09-26T08:30:05+00:00',
      completedAt: '2026-09-26T08:30:07+00:00',
      participantKind: 'agent',
      participantId: AGENT_ID,
    });
  });

  it('leaves deliveredAt null until delivery is durable', async () => {
    const http = fakeHttp({ items: [{ ...messageRow, delivered_at: null }], next_cursor: null, has_more: false });
    const api = new SessionsAPI(http as never);

    const page = await api.getMessages('sess-1');

    expect(page.items[0].deliveredAt).toBeNull();
  });

  it('leaves completedAt null until the covering turn commits', async () => {
    const http = fakeHttp({ items: [{ ...messageRow, delivered_at: null, completed_at: null }], next_cursor: null, has_more: false });
    const api = new SessionsAPI(http as never);

    const page = await api.getMessages('sess-1');

    expect(page.items[0].completedAt).toBeNull();
    expect(page.items[0].deliveredAt).toBeNull();
  });

  it('decodes completed_at when only that receipt exists', async () => {
    const http = fakeHttp({ items: [{ ...messageRow, delivered_at: null }], next_cursor: null, has_more: false });
    const api = new SessionsAPI(http as never);

    const page = await api.getMessages('sess-1');

    expect(page.items[0].completedAt).toBe('2026-09-26T08:30:07+00:00');
  });

  it('url-encodes the session id', async () => {
    const http = fakeHttp({ items: [] });
    const api = new SessionsAPI(http as never);

    await api.getMessages('sess/odd id');

    expect(http.get).toHaveBeenCalledWith('/sessions/sess%2Fodd%20id/messages', { limit: 20 });
  });

  it('tolerates camelCase wire keys inside rows', async () => {
    const http = fakeHttp({
      items: [
        {
          id: 's',
          summaryText: 't',
          summaryKeywords: 'oops-not-an-array',
          participants: [{ kind: 'agent', participantId: 'p', cursorPos: 3 }],
        },
      ],
      nextCursor: 'c',
      hasMore: false,
    });
    const api = new SessionsAPI(http as never);

    const page = await api.listSessions();

    expect(page.nextCursor).toBe('c');
    expect(page.items[0].summaryText).toBe('t');
    expect(page.items[0].summaryKeywords).toEqual([]);
    expect(page.items[0].participants).toEqual([
      {
        kind: 'agent',
        participantId: 'p',
        internalSessionId: null,
        cursorPos: 3,
      },
    ]);
  });
});
