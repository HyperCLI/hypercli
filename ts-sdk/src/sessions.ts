/**
 * Sessions REST client — the §15 memory-shaped session model
 * (sessions/README §15) as a read surface for console/desktop/CLI.
 *
 * The backend proxy (`/ws/acp`, see acp.ts) is the write/turn path; this
 * namespace is the typed read path over the durable `agent_sessions` /
 * `session_messages` tables: session catalog with summaries and participants,
 * backwards-paginated history per session. The wire contract is owned by the
 * backend routes (`agents/backend/agents/session_routes.py` —
 * `SessionListPage` / `SessionMessagePage`), and both pages are the same
 * envelope: `{ items, next_cursor, has_more }`.
 *
 * Pagination contract (§15 "Type & pagination"): every list is keyset over a
 * server-issued opaque cursor with a LIMIT N+1 `has_more` sentinel — never
 * OFFSET. Messages page BACKWARDS from last-seen (`seq < cursor`, newest
 * first); sessions page over `(updated_at, id)`.
 */
import type { HTTPClient } from './http.js';

/** Native catalog discovery, independent of active conversation/turn state. */
export interface SessionDiscoveryStatus {
  status: 'pending' | 'running' | 'complete' | 'error' | 'unsupported';
  /** Catalog enumeration may succeed even when the runtime cannot replay history. */
  history_status?: 'unknown' | 'supported' | 'unsupported';
  error_code: 'runtime_unavailable' | 'discovery_failed' | 'catalog_unsupported' | null;
  discovered_count: number | null;
  queued_count: number;
  importing_count: number;
  last_attempt_at: string | null;
  last_completed_at: string | null;
}

/** Durable, content-free REST evidence for the current import generation.
 * Counts describe the attempt, not the requested history page. `empty` means
 * supported replay completed with zero updates; `filtered` means valid updates
 * were excluded by retention policy. Unknown/never-attempted evidence is null.
 */
export interface SessionImportOutcome {
  status: 'retained' | 'empty' | 'filtered' | 'unsupported' | 'malformed' | 'failed';
  protocol_version: 1 | 2 | null;
  generation: number;
  recorded_at: string;
  observed_updates: number;
  valid_updates: number;
  filtered_updates: number;
  invalid_updates: number;
  foreign_updates: number;
  retained_rows: number;
}

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
  /** Descriptive creation provenance; unknown values are preserved. */
  source: string | null;
  createdAt: string | null;
  /** Last-activity timestamp; bumps on every message append, not on row touch. */
  updatedAt: string | null;
  summaryText: string | null;
  summaryKeywords: string[];
  participants: AcpSessionParticipant[];
  importOutcome?: SessionImportOutcome | null;
}

/**
 * Per-logical-message delivery evidence from the session detail read (backend
 * `SessionStateDetail.receipts`): the settled markers a chat pane merges onto
 * already-rendered messages without paging message rows. Merged per message
 * id: earliest created_at, first non-null delivered_at / completed_at.
 */
export interface AcpSessionReceipt {
  messageId: string;
  role: 'user' | 'assistant' | 'tool';
  createdAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
}

/**
 * The session detail read (`GET /sessions/{id}`, backend `SessionStateDetail`):
 * the catalog record plus the state a chat pane needs to open on the session —
 * logical-message identity anchors and delivery receipts — without the
 * messages page. Fields absent on an older backend default empty.
 */
export interface AcpSessionState extends AcpSessionRecord {
  /** Effective identity of the newest replay-eligible logical message; null on an empty session. */
  lastMessageId: string | null;
  /** Distinct logical message identities over replay-eligible rows. */
  messageCount: number;
  /** Highest stored seq; the read receipt advances to here. */
  headSeq: number;
  receipts: AcpSessionReceipt[];
  /** Agent connection state computed per request by the backend, never stored; null on a pre-state backend. */
  agentState: 'live' | 'archived' | 'deleted' | null;
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

export interface AcpSessionMessagePage extends AcpSessionPage<AcpSessionMessage> {
  importOutcome: SessionImportOutcome | null;
}

export interface AcpSessionListOptions {
  agentId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AcpSessionMessagesOptions {
  /** Opaque cursor from a previous page's nextCursor; omitted starts at the newest message. */
  cursor?: string | null;
  limit?: number;
}

/**
 * One full-text transcript hit (backend `GET /sessions/search`): the durable
 * message the query matched inside, with a server-built excerpt of the
 * surrounding transcript words. `score` is currently always null — full-text
 * match carries no rank.
 */
export interface AcpTranscriptSearchHit {
  sessionId: string;
  seq: number;
  role: string;
  /** ACP message identity when the matched frame carries one; resolve via the session's rendered messages. */
  messageId: string | null;
  excerpt: string;
  score: number | null;
}

export interface AcpTranscriptSearchOptions {
  /** Restrict the search to one session (in-transcript find); omitted searches every session the caller can read. */
  sessionId?: string;
  /** Opaque cursor from a previous page's nextCursor; omitted starts at the newest session activity. */
  cursor?: string | null;
  limit?: number;
}

/** Ascending durable-message window centered on `focusSeq` (backend `GET /sessions/{id}/messages/around`). */
export interface AcpSessionMessagesWindow {
  sessionId: string;
  focusSeq: number;
  items: AcpSessionMessage[];
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
    source: typeof row.source === 'string' ? row.source : null,
    importOutcome: pick<SessionImportOutcome>(row, 'import_outcome', 'importOutcome') ?? null,
    createdAt: (pick<string>(row, 'created_at', 'createdAt') ?? null) as string | null,
    updatedAt: (pick<string>(row, 'updated_at', 'updatedAt') ?? null) as string | null,
    summaryText: (pick<string>(row, 'summary_text', 'summaryText') ?? null) as string | null,
    summaryKeywords: Array.isArray(keywords) ? keywords.map(String) : [],
    participants: Array.isArray(participants)
      ? participants.filter((participant) => participant && typeof participant === 'object').map(participantFromWire)
      : [],
  };
}

function receiptFromWire(row: Record<string, unknown>): AcpSessionReceipt {
  const role = row.role;
  return {
    messageId: String(pick<unknown>(row, 'message_id', 'messageId') ?? ''),
    role: role === 'user' || role === 'tool' ? role : 'assistant',
    createdAt: (pick<string>(row, 'created_at', 'createdAt') ?? null) as string | null,
    deliveredAt: (pick<string>(row, 'delivered_at', 'deliveredAt') ?? null) as string | null,
    completedAt: (pick<string>(row, 'completed_at', 'completedAt') ?? null) as string | null,
  };
}

function sessionStateFromWire(row: Record<string, unknown>): AcpSessionState {
  const lastMessageId = pick<unknown>(row, 'last_message_id', 'lastMessageId');
  const messageCount = pick<unknown>(row, 'message_count', 'messageCount');
  const headSeq = pick<unknown>(row, 'head_seq', 'headSeq');
  const receipts = row.receipts;
  const agentState = pick<unknown>(row, 'agent_state', 'agentState');
  return {
    ...sessionFromWire(row),
    lastMessageId: typeof lastMessageId === 'string' && lastMessageId ? lastMessageId : null,
    messageCount: typeof messageCount === 'number' ? messageCount : Number(messageCount ?? 0) || 0,
    headSeq: typeof headSeq === 'number' ? headSeq : Number(headSeq ?? 0) || 0,
    receipts: Array.isArray(receipts)
      ? receipts.filter((receipt) => receipt && typeof receipt === 'object').map(receiptFromWire)
      : [],
    agentState: agentState === 'live' || agentState === 'archived' || agentState === 'deleted' ? agentState : null,
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
  constructor(private readonly http: Pick<HTTPClient, 'get'> & Partial<Pick<HTTPClient, 'post'>>) {}

  /** Read discovery evidence; an empty stored catalog alone is not discovery success. */
  async getDiscoveryStatus(agentId: string): Promise<SessionDiscoveryStatus> {
    return this.http.get<SessionDiscoveryStatus>('/sessions/discovery', { agent_id: agentId });
  }

  /** Explicitly request discovery. Unsupported runtimes remain unsupported. */
  async requestDiscovery(agentId: string): Promise<SessionDiscoveryStatus> {
    if (!this.http.post) throw new Error('Session discovery requires a writable HTTP client');
    return this.http.post<SessionDiscoveryStatus>(`/sessions/discovery?agent_id=${encodeURIComponent(agentId)}`);
  }

  /**
   * Stored metadata and chat-open state for one platform session ID (not an
   * agent/runtime session ID). Uses the caller's existing participation scope;
   * no runtime connection. Advances the caller's read receipt to the head.
   */
  async getSession(platformSessionId: string): Promise<AcpSessionState> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(platformSessionId)}`,
    );
    return sessionStateFromWire(payload);
  }

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
  async getMessages(sessionId: string, options: AcpSessionMessagesOptions = {}): Promise<AcpSessionMessagePage> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      },
    );
    return { ...pageFromWire(payload ?? {}, messageFromWire),
      importOutcome: pick<SessionImportOutcome>(payload ?? {}, 'import_outcome', 'importOutcome') ?? null };
  }

  /**
   * Full-text search over durable transcript payloads (`GET /sessions/search`),
   * keyset-paged over (session activity desc, seq desc). Feed `nextCursor`
   * back in to walk further. Read-only; no read-receipt effect.
   */
  async searchTranscript(query: string, options: AcpTranscriptSearchOptions = {}): Promise<AcpSessionPage<AcpTranscriptSearchHit>> {
    const payload = await this.http.get<Record<string, unknown>>('/sessions/search', {
      q: query,
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    return pageFromWire(payload ?? {}, (row) => {
      const seq = row.seq;
      return {
        sessionId: String(row.session_id ?? ''),
        seq: typeof seq === 'number' ? seq : Number(seq ?? 0),
        role: typeof row.role === 'string' ? row.role : 'assistant',
        messageId: typeof row.message_id === 'string' ? row.message_id : null,
        excerpt: typeof row.excerpt === 'string' ? row.excerpt : '',
        score: typeof row.score === 'number' ? row.score : null,
      };
    });
  }

  /**
   * One ascending window of durable messages around `seq` (`GET
   * /sessions/{id}/messages/around`) — for landing a search jump on history
   * the caller has not loaded. Never advances the read receipt.
   */
  async getMessagesAround(sessionId: string, seq: number, options: { radius?: number } = {}): Promise<AcpSessionMessagesWindow> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}/messages/around`,
      { seq, ...(options.radius !== undefined ? { radius: options.radius } : {}) },
    );
    const items = payload?.items;
    const focusSeq = payload?.focus_seq;
    return {
      sessionId: String(payload?.session_id ?? sessionId),
      focusSeq: typeof focusSeq === 'number' ? focusSeq : Number(focusSeq ?? seq),
      items: Array.isArray(items)
        ? items.filter((row) => row && typeof row === 'object').map(messageFromWire)
        : [],
    };
  }

  /** Exact Backend completion evidence. Session idle is deliberately not used. */
  async getPromptCompletion(sessionId: string, messageId: string, agentId: string): Promise<{ stopReason: string } | null> {
    const turns = new Map<number, AcpSessionMessage>();
    const visited = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page = await this.getMessages(sessionId, { cursor, limit: 100 });
      for (const row of page.items) {
        if (row.sessionId !== sessionId) continue;
        if (row.acp.type === 'turn_result' && row.participantKind === 'agent' && row.participantId === agentId &&
            typeof row.acp.messageSeq === 'number' && row.completedAt) turns.set(row.acp.messageSeq, row);
        if (row.acp.type === 'user_message' && row.acp.messageId === messageId && row.acp.agentId === agentId && row.role === 'user') {
          const terminal = turns.get(row.seq);
          return row.completedAt && terminal && typeof terminal.stopReason === 'string'
            ? { stopReason: terminal.stopReason } : null;
        }
      }
      if (!page.hasMore || !page.nextCursor || visited.has(page.nextCursor)) return null;
      cursor = page.nextCursor;
      visited.add(cursor);
    }
  }
}
