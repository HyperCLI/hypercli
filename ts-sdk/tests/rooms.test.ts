import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsAPI, type RoomRecord } from '../src/sessions.js';
import { HTTPClient } from '../src/http.js';

const ROOM_ID = '2f5d8a10-97c3-4a1e-8b4d-9a2f6c0e7d31';
const AGENT_A = '3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45';
const AGENT_B = '8d1f2b34-56a7-48b9-9c01-d23e4f5a6b7c';
const OWNER_ID = '81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d';

/** Mirror of the backend `RoomRecord` (`agents/backend/agents/session_room_routes.py`). */
function roomRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOM_ID,
    kind: 'room',
    title: 'Build triage',
    purpose: 'Investigate CI failures.',
    style: 'Concise technical discussion.',
    rules: ['Respond with new information only.'],
    owner_id: OWNER_ID,
    agents: [
      { agent_id: AGENT_A, name: 'Atlas', internal_session_id: 'claude-9f2e' },
      { agent_id: AGENT_B, name: 'Maya', internal_session_id: null },
    ],
    token_limit: null,
    agent_turn_limit: 25,
    configured_agent_turn_limit: null,
    status: 'live',
    setup_revision: 3,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: ROOM_ID,
    message_id: 'msg-1',
    seq: 7,
    epoch_id: 'epoch-1',
    sender_id: OWNER_ID,
    sender_kind: 'user',
    sender_name: 'Dmitry',
    body: 'Can you look at the build failure?',
    reply_to: null,
    created_at: '2026-11-12T10:05:00Z',
    fanout: { [AGENT_A]: true, [AGENT_B]: false },
    ...overrides,
  };
}

describe('explicit room creation and readback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the documented create body and reads the default policy back', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(roomRow()), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const api = new SessionsAPI(new HTTPClient('https://example.test/agents', 'caller-key'));
    const room = await api.createRoom([AGENT_A, AGENT_B], {
      title: 'Build triage', purpose: 'Investigate CI failures.',
      style: 'Concise technical discussion.', rules: ['Respond with new information only.'],
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.test/agents/rooms', {
      method: 'POST', headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Build triage', purpose: 'Investigate CI failures.',
        style: 'Concise technical discussion.', rules: ['Respond with new information only.'],
        agents: [AGENT_A, AGENT_B], token_limit: null, agent_turn_limit: null,
      }),
      signal: expect.any(AbortSignal),
    });
    expect(room).toEqual({
      id: ROOM_ID, kind: 'room', title: 'Build triage', purpose: 'Investigate CI failures.',
      style: 'Concise technical discussion.', rules: ['Respond with new information only.'],
      ownerId: OWNER_ID,
      agents: [
        { agentId: AGENT_A, name: 'Atlas', internalSessionId: 'claude-9f2e' },
        { agentId: AGENT_B, name: 'Maya', internalSessionId: null },
      ],
      tokenLimit: null, agentTurnLimit: 25, configuredAgentTurnLimit: null,
      status: 'live', setupRevision: 3,
      createdAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:00:00Z',
    } satisfies RoomRecord);
  });

  it('sends the documented defaults when no brief is supplied', async () => {
    const http = { get: vi.fn(), post: vi.fn().mockResolvedValue(roomRow()) };
    await new SessionsAPI(http).createRoom([AGENT_A]);
    expect(http.post).toHaveBeenCalledExactlyOnceWith('/rooms', {
      title: null, purpose: '', style: '', rules: [],
      agents: [AGENT_A], token_limit: null, agent_turn_limit: null,
    });
  });

  it('preserves explicit policy knobs, including the disable sentinel 0', async () => {
    const http = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(roomRow({ token_limit: 100000, agent_turn_limit: 0, configured_agent_turn_limit: 0 })),
    };
    const room = await new SessionsAPI(http).createRoom([AGENT_A], { tokenLimit: 100000, agentTurnLimit: 0 });
    expect(http.post).toHaveBeenCalledWith('/rooms', expect.objectContaining({ token_limit: 100000, agent_turn_limit: 0 }));
    expect(room.tokenLimit).toBe(100000);
    expect(room.agentTurnLimit).toBe(0);
    expect(room.configuredAgentTurnLimit).toBe(0);
  });

  it('rejects non-room payloads instead of fabricating a room', async () => {
    const http = { get: vi.fn(), post: vi.fn().mockResolvedValue({ ...roomRow(), kind: 'dm' }) };
    await expect(new SessionsAPI(http).createRoom([AGENT_A])).rejects.toThrow('Invalid room record response');
  });

  it('rejects reads that drop required policy facts rather than defaulting them', async () => {
    const { agent_turn_limit: omittedTurns, setup_revision: omittedRevision, ...without } = roomRow();
    expect(omittedTurns).toBe(25);
    expect(omittedRevision).toBe(3);
    const http = { get: vi.fn().mockResolvedValue(without) };
    await expect(new SessionsAPI(http).getRoom(ROOM_ID)).rejects.toThrow('Invalid room record response');
  });
});

describe('room read and owner updates', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads one room over GET with the exact path', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(roomRow()), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const api = new SessionsAPI(new HTTPClient('https://example.test/agents', 'caller-key'));
    const room = await api.getRoom('room/odd id?#%');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.test/agents/rooms/room%2Fodd%20id%3F%23%25', {
      method: 'GET', headers: { Authorization: 'Bearer caller-key', 'Content-Type': 'application/json' },
      body: undefined, signal: expect.any(AbortSignal),
    });
    expect(room.id).toBe(ROOM_ID);
  });

  it('patches only supplied fields and maps them to the snake_case wire', async () => {
    const http = {
      get: vi.fn(),
      patch: vi.fn().mockResolvedValue(roomRow({ title: 'New focus', status: 'archived', setup_revision: 4 })),
    };
    const room = await new SessionsAPI(http).updateRoom(ROOM_ID, { title: 'New focus', status: 'archived' });
    expect(http.patch).toHaveBeenCalledExactlyOnceWith(`/rooms/${ROOM_ID}`, {
      title: 'New focus', status: 'archived',
    });
    expect(room.title).toBe('New focus');
    expect(room.status).toBe('archived');
    expect(room.setupRevision).toBe(4);
  });

  it.each([
    [{ purpose: null }, { purpose: null }],
    [{ rules: [] }, { rules: [] }],
    [{ tokenLimit: null }, { token_limit: null }],
    [{ agentTurnLimit: 5 }, { agent_turn_limit: 5 }],
    [{}, {}],
  ] as const)('update %j clears or sets exactly the supplied knob', async (patch, wire) => {
    const http = { get: vi.fn(), patch: vi.fn().mockResolvedValue(roomRow()) };
    await new SessionsAPI(http).updateRoom(ROOM_ID, patch);
    expect(http.patch).toHaveBeenCalledWith(`/rooms/${ROOM_ID}`, wire);
  });

  it('keeps the read-only client guard for writes', async () => {
    const api = new SessionsAPI({ get: vi.fn() });
    await expect(api.createRoom([AGENT_A])).rejects.toThrow('Room creation requires a writable HTTP client');
    await expect(api.updateRoom(ROOM_ID, { title: 'x' })).rejects.toThrow('Room updates require a writable HTTP client');
    await expect(api.createRoomMessage(ROOM_ID, 'hello')).rejects.toThrow('Room messages require a writable HTTP client');
  });
});

describe('canonical room messages', () => {
  it('posts the body and optional reply, reading fanout evidence back', async () => {
    const http = { get: vi.fn(), post: vi.fn().mockResolvedValue(messageRow({ reply_to: 'msg-0' })) };
    const message = await new SessionsAPI(http).createRoomMessage(
      ROOM_ID, 'Can you look at the build failure?', { replyTo: 'msg-0' },
    );
    expect(http.post).toHaveBeenCalledExactlyOnceWith(`/rooms/${ROOM_ID}/messages`, {
      body: 'Can you look at the build failure?', reply_to: 'msg-0',
    });
    expect(message).toEqual({
      sessionId: ROOM_ID, messageId: 'msg-1', seq: 7, epochId: 'epoch-1',
      senderId: OWNER_ID, senderKind: 'user', senderName: 'Dmitry',
      body: 'Can you look at the build failure?', replyTo: 'msg-0',
      createdAt: '2026-11-12T10:05:00Z', fanout: { [AGENT_A]: true, [AGENT_B]: false },
    });
  });

  it('omits reply_to when no reply is supplied', async () => {
    const http = { get: vi.fn(), post: vi.fn().mockResolvedValue(messageRow()) };
    await new SessionsAPI(http).createRoomMessage(ROOM_ID, 'hello');
    expect(http.post).toHaveBeenCalledWith(`/rooms/${ROOM_ID}/messages`, { body: 'hello' });
  });

  it('encodes odd room ids without touching the message body', async () => {
    const http = { get: vi.fn(), post: vi.fn().mockResolvedValue(messageRow()) };
    await new SessionsAPI(http).createRoomMessage('room/odd id?#%', 'hello');
    expect(http.post).toHaveBeenCalledWith('/rooms/room%2Fodd%20id%3F%23%25/messages', { body: 'hello' });
  });

  it('propagates server rejection rather than inventing a message', async () => {
    const error = new Error('422 room archived');
    const http = { get: vi.fn(), post: vi.fn().mockRejectedValue(error) };
    await expect(new SessionsAPI(http).createRoomMessage(ROOM_ID, 'hello')).rejects.toBe(error);
  });
});
