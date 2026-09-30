/**
 * Sessions REST client — the §15 memory-shaped session model
 * (sessions/README §15) as a read surface for console/desktop/CLI.
 *
 * The backend proxy (`/ws/acp`, see acp.ts) is the write/turn path; this
 * namespace is the typed read path over the durable `agent_sessions` /
 * `session_messages` tables: session catalog with summaries and participants,
 * backwards-paginated history per session, and the backend-owned label PATCH
 * (the rename pencil — backend-owned until ACP grows a client→agent rename).
 * The wire contract is owned by the backend routes
 * (`agents/backend/agents/session_routes.py` — `SessionListPage` /
 * `SessionMessagePage` / `SessionListItem`), and both pages are the same
 * envelope: `{ items, next_cursor, has_more }`.
 *
 * Pagination contract (§15 "Type & pagination"): every list is keyset over a
 * server-issued opaque cursor with a LIMIT N+1 `has_more` sentinel — never
 * OFFSET. Messages page BACKWARDS from last-seen (`seq < cursor`, newest
 * first); sessions page over `(updated_at, id)`.
 */
import type { HTTPClient } from './http.js';

/** One `session_participants` row as embedded in the session catalog (backend `SessionParticipant`). */
export interface AcpSessionParticipant {
  kind: 'user' | 'agent';
  participantId: string;
  /** The agent leg's harness-side session id; null for user participants and legs without one. */
  internalSessionId: string | null;
  /** Participant's durable delivery cursor (seq) in this session. */
  cursorPos: number;
}

/** One `agent_sessions` row as the catalog sees it (backend `SessionListItem`). summaryText doubles as the display title. */
export interface AcpSessionRecord {
  id: string;
  createdAt: string | null;
  /** Last-activity timestamp; bumps on every message append, not on row touch. */
  updatedAt: string | null;
  summaryText: string | null;
  summaryKeywords: string[];
  participants: AcpSessionParticipant[];
}

/** One `session_messages` row (backend `SessionMessage`): the durable full-fidelity truth for a session. */
export interface AcpSessionMessage {
  sessionId: string;
  /** Per-session ordering; the store's "where are we" value (the ACP wire has no ordinals). */
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  /** ACP-style settled payload at FULL fidelity — tool calls retained. */
  acp: Record<string, unknown>;
  /** Assistant-side end-of-turn marker; turns derive prompt→stop. */
  stopReason: string | null;
  createdAt: string | null;
  /** Null until delivery is durable: user rows stamp at turn commit, agent rows at persist (§15). */
  deliveredAt: string | null;
  /** Null until the covering turn commits; on user rows this is the "agent acted on this" receipt (§15). */
  completedAt: string | null;
  /** Author tuple; resolve via the session's participants. */
  participantKind: 'user' | 'agent' | null;
  participantId: string | null;
}

/** One page of a cursor-paginated endpoint. */
export interface AcpSessionPage<T> {
  items: T[];
  /** Opaque server cursor for the next page; null when exhausted. */
  nextCursor: string | null;
  /** LIMIT N+1 sentinel: the server saw one more row than the page. */
  hasMore: boolean;
}

export interface AcpSessionListOptions {
  /** Restrict the catalog to sessions this agent participates in (`agent_id` query). */
  agentId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AcpSessionMessagesOptions {
  /** Opaque cursor from a previous page's nextCursor; omitted starts at the newest message. */
  cursor?: string | null;
  limit?: number;
}

function pick<T>(row: Record<string, unknown>, snake: string, camel: string): T | undefined {
  const value = row[snake] ?? row[camel];
  return value === undefined ? undefined : (value as T);
}

function participantFromWire(row: Record<string, unknown>): AcpSessionParticipant {
  const kind = row.kind;
  const cursorPos = pick<unknown>(row, 'cursor_pos', 'cursorPos');
  return {
    kind: kind === 'user' ? 'user' : 'agent',
    participantId: String(pick<unknown>(row, 'participant_id', 'participantId') ?? ''),
    internalSessionId: (pick<string>(row, 'internal_session_id', 'internalSessionId') ?? null) as string | null,
    cursorPos: typeof cursorPos === 'number' ? cursorPos : Number(cursorPos ?? 0),
  };
}

function sessionFromWire(row: Record<string, unknown>): AcpSessionRecord {
  const keywords = pick<unknown>(row, 'summary_keywords', 'summaryKeywords');
  const participants = row.participants;
  return {
    id: String(row.id ?? ''),
    createdAt: (pick<string>(row, 'created_at', 'createdAt') ?? null) as string | null,
    updatedAt: (pick<string>(row, 'updated_at', 'updatedAt') ?? null) as string | null,
    summaryText: (pick<string>(row, 'summary_text', 'summaryText') ?? null) as string | null,
    summaryKeywords: Array.isArray(keywords) ? keywords.map(String) : [],
    participants: Array.isArray(participants)
      ? participants.filter((participant) => participant && typeof participant === 'object').map(participantFromWire)
      : [],
  };
}

function messageFromWire(row: Record<string, unknown>): AcpSessionMessage {
  const seq = row.seq;
  const role = row.role;
  return {
    sessionId: String(pick<unknown>(row, 'session_id', 'sessionId') ?? ''),
    seq: typeof seq === 'number' ? seq : Number(seq ?? 0),
    role: role === 'user' || role === 'tool' ? role : 'assistant',
    acp: (row.acp && typeof row.acp === 'object' ? row.acp : {}) as Record<string, unknown>,
    stopReason: (pick<string>(row, 'stop_reason', 'stopReason') ?? null) as string | null,
    createdAt: (pick<string>(row, 'created_at', 'createdAt') ?? null) as string | null,
    deliveredAt: (pick<string>(row, 'delivered_at', 'deliveredAt') ?? null) as string | null,
    completedAt: (pick<string>(row, 'completed_at', 'completedAt') ?? null) as string | null,
    participantKind: (pick<string>(row, 'participant_kind', 'participantKind') ?? null) as AcpSessionMessage['participantKind'],
    participantId: (pick<string>(row, 'participant_id', 'participantId') ?? null) as string | null,
  };
}

function pageFromWire<T>(payload: Record<string, unknown>, parse: (row: Record<string, unknown>) => T): AcpSessionPage<T> {
  const rows = payload.items;
  const cursor = pick<unknown>(payload, 'next_cursor', 'nextCursor');
  const more = pick<unknown>(payload, 'has_more', 'hasMore');
  return {
    items: Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object').map(parse) : [],
    nextCursor: typeof cursor === 'string' && cursor ? cursor : null,
    hasMore: more === true,
  };
}

/**
 * Session read surface scoped to the caller's identity (user key: sessions
 * of owned agents; runtime key: sessions §15 exposes to the pod). Bound to
 * the agents API base, so `/sessions` resolves to `/agents/sessions`.
 */
export class SessionsAPI {
  constructor(private readonly http: Pick<HTTPClient, 'get' | 'patch'>) {}

  /** Session catalog page, newest activity first (`(updated_at, id)` keyset). */
  async listSessions(options: AcpSessionListOptions = {}): Promise<AcpSessionPage<AcpSessionRecord>> {
    const payload = await this.http.get<Record<string, unknown>>('/sessions', {
      ...(options.agentId ? { agent_id: options.agentId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    return pageFromWire(payload ?? {}, sessionFromWire);
  }

  /**
   * History page for one session, BACKWARDS from the cursor (or from the
   * newest message when omitted): `seq < cursor`, `ORDER BY seq DESC`,
   * LIMIT N+1. Feed `nextCursor` back in to walk further into the past.
   */
  async getMessages(sessionId: string, options: AcpSessionMessagesOptions = {}): Promise<AcpSessionPage<AcpSessionMessage>> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      },
    );
    return pageFromWire(payload ?? {}, messageFromWire);
  }

  /**
   * Set or clear the caller-visible session label (the rename pencil) via
   * `PATCH /sessions/{id}`. A null title clears the label; the backend also
   * strips and clears whitespace-only titles and caps the stripped title at
   * 256 characters. Returns the session row (`SessionListItem`) verbatim.
   */
  async renameSession(sessionId: string, title: string | null): Promise<AcpSessionRecord> {
    const payload = await this.http.patch<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { title },
    );
    return sessionFromWire(payload ?? {});
  }
}
