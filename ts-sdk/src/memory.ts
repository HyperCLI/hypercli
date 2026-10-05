/** Durable session memory, relative to the agents API base.
 * Wire contract: agents/backend/agents/memory_routes.py. Public fields use camelCase.
 */
import type { HTTPClient } from './http.js';

export interface MemorySummary {
  sessionId: string;
  title: string | null;
  summaryText: string | null;
  /** Last sequence covered by indexed chunks; zero is a valid cursor. */
  summaryCursor: number | null;
  summarizedAt: string | null;
  importedAt: string | null;
  pending: boolean;
}

export interface MemoryChunk {
  id: string;
  sessionId: string;
  seqStart: number;
  seqEnd: number;
  text: string;
}

export interface MemorySearchResult extends MemoryChunk {
  score: number;
  /** Joined from the owning session; null when unset or on pre-envelope deployments. */
  title: string | null;
  summaryText: string | null;
  /** Owning session's summary keywords; empty on pre-envelope deployments. */
  summaryKeywords: string[];
}

export interface MemorySearchResponse {
  items: MemorySearchResult[];
  /** Opaque keyset cursor over {distance, id} pairs; null when the page is exhausted. */
  nextCursor: string | null;
  /** LIMIT N+1 sentinel; false on pre-envelope deployments (single terminal page). */
  hasMore: boolean;
}

export interface MemoryChunkPage {
  items: MemoryChunk[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MemoryTailMessage {
  seqStart: number;
  seqEnd: number;
  role: string;
  text: string;
  participantId: string | null;
}

export interface MemoryTail {
  sessionId: string;
  items: MemoryTailMessage[];
}

export interface MemoryRebuildResponse {
  sessionId: string;
  /** The server currently returns "pending" (HTTP 202), not a completed summary. */
  status: string;
}

export interface MemorySearchOptions {
  sessionId?: string;
  /** Restrict to sessions of one agent (UUID). */
  agentId?: string;
  /** Opaque cursor from a previous page's nextCursor; omitted starts at the best matches. */
  cursor?: string | null;
  limit?: number;
}

export interface MemoryChunksOptions {
  /** Opaque cursor from a previous chunk page. */
  cursor?: string | null;
  limit?: number;
}

interface SummaryWire {
  session_id: string;
  title: string | null;
  summary_text: string | null;
  summary_cursor: number | null;
  summarized_at: string | null;
  imported_at: string | null;
  pending: boolean;
}

interface ChunkWire {
  id: string;
  session_id: string;
  seq_start: number;
  seq_end: number;
  text: string;
}

function summaryFromWire(row: SummaryWire): MemorySummary {
  return {
    sessionId: row.session_id,
    title: row.title,
    summaryText: row.summary_text,
    summaryCursor: row.summary_cursor,
    summarizedAt: row.summarized_at,
    importedAt: row.imported_at,
    pending: row.pending,
  };
}

function chunkFromWire(row: ChunkWire): MemoryChunk {
  return {
    id: row.id, sessionId: row.session_id, seqStart: row.seq_start,
    seqEnd: row.seq_end, text: row.text,
  };
}

interface SearchHitWire extends ChunkWire {
  score: number;
  title?: string | null;
  summary_text?: string | null;
  summary_keywords?: string[] | null;
}

function searchHitFromWire(row: SearchHitWire): MemorySearchResult {
  return {
    ...chunkFromWire(row), score: row.score,
    title: row.title ?? null,
    summaryText: row.summary_text ?? null,
    summaryKeywords: Array.isArray(row.summary_keywords) ? row.summary_keywords.map(String) : [],
  };
}

function searchPageFromWire(payload: unknown): MemorySearchResponse {
  // Rollout tolerance: pre-envelope deployments answer a bare array or { items }
  // without pagination keys; both decode to a single terminal page.
  const envelope = (Array.isArray(payload) ? { items: payload } : payload ?? {}) as {
    items?: SearchHitWire[]; next_cursor?: string | null; has_more?: boolean;
  };
  return {
    items: (Array.isArray(envelope.items) ? envelope.items : []).map(searchHitFromWire),
    nextCursor: envelope.next_cursor ?? null,
    hasMore: envelope.has_more === true,
  };
}

export class MemoryAPI {
  constructor(private readonly http: Pick<HTTPClient, 'get' | 'post'>) {}

  /** Best-first page over indexed chunks; feed nextCursor back via options.cursor. */
  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResponse> {
    const payload = await this.http.get<unknown>('/memory/search', {
      q: query,
      ...(options.sessionId !== undefined ? { session_id: options.sessionId } : {}),
      ...(options.agentId !== undefined ? { agent_id: options.agentId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    return searchPageFromWire(payload);
  }

  async getSummary(sessionId: string): Promise<MemorySummary> {
    return summaryFromWire(await this.http.get<SummaryWire>(`/sessions/${encodeURIComponent(sessionId)}/summary`));
  }

  /** Indexed chunks in ascending sequence order. */
  async getChunks(sessionId: string, options: MemoryChunksOptions = {}): Promise<MemoryChunkPage> {
    const payload = await this.http.get<{ items: ChunkWire[]; next_cursor: string | null; has_more: boolean }>(
      `/sessions/${encodeURIComponent(sessionId)}/chunks`, {
        ...(options.cursor != null ? { cursor: options.cursor } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      },
    );
    return { items: payload.items.map(chunkFromWire), nextCursor: payload.next_cursor, hasMore: payload.has_more };
  }

  /** Latest logical text messages in chronological order, not raw event frames. */
  async getTail(sessionId: string, n = 20): Promise<MemoryTail> {
    const payload = await this.http.get<{ session_id: string; items: { seq_start: number; seq_end: number; role: string; text: string; participant_id: string | null }[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/tail`, { n },
    );
    return { sessionId: payload.session_id, items: payload.items.map((row) => ({
      seqStart: row.seq_start, seqEnd: row.seq_end, role: row.role, text: row.text, participantId: row.participant_id,
    })) };
  }

  /** User rebuild; the server enforces the once-per-24-hours limit. Never retry an uncertain write. */
  async rebuild(sessionId: string): Promise<MemoryRebuildResponse> {
    const payload = await this.http.post<{ session_id: string; status: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/summary/rebuild`, undefined, { retries: 1 },
    );
    return { sessionId: payload.session_id, status: payload.status };
  }
}
