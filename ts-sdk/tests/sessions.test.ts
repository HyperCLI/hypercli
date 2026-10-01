import { afterEach, describe, it, expect, vi } from 'vitest';
import { HyperCLI, APIError, type AcpSessionRecord } from '../src/index.js';
import { SessionsAPI } from '../src/sessions.js';

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

    const detail: AcpSessionRecord = await client.sessions.getSession(SESSION_ID);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://example.com/agents/sessions/${SESSION_ID}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
    expect(detail).toEqual({
      id: SESSION_ID, source,
      summaryText: sessionRow.summary_text, summaryKeywords: sessionRow.summary_keywords,
      createdAt: sessionRow.created_at, updatedAt: sessionRow.updated_at,
      participants: [
        { kind: 'agent', participantId: AGENT_ID, internalSessionId: 'claude-session-9f2e', cursorPos: 14 },
        { kind: 'user', participantId: USER_ID, internalSessionId: null, cursorPos: 14 },
      ],
    });
    expect((await client.sessions.listSessions()).items[0]).toEqual(detail);
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
      id: SESSION_ID, source: null, summaryText: null, summaryKeywords: [],
      createdAt: sessionRow.created_at, updatedAt: sessionRow.updated_at, participants: [],
    });
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

describe('SessionsAPI (§15)', () => {
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
    const http = fakeHttp({ items: [messageRow], next_cursor: 'sess-1:41', has_more: true });
    const api = new SessionsAPI(http as never);

    const page = await api.getMessages('sess-1', { cursor: 'sess-1:50', limit: 50 });

    expect(http.get).toHaveBeenCalledWith('/sessions/sess-1/messages', { cursor: 'sess-1:50', limit: 50 });
    expect(page.nextCursor).toBe('sess-1:41');
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toEqual({
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

    expect(http.get).toHaveBeenCalledWith('/sessions/sess%2Fodd%20id/messages', {});
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
