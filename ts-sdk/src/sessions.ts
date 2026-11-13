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
 * Explicit multiparty rooms (docs/MULTIPARTY.md) are the one REST write
 * surface here (`POST /rooms`, `GET/PATCH /rooms/{room_id}`,
 * `POST /rooms/{room_id}/messages`, backend `session_room_routes.py`):
 * deliberate room creation and owner-authored messages, never native ACP
 * session mutation.
 *
 * Pagination contract (§15 "Type & pagination"): every list is keyset over a
 * server-issued opaque cursor — never OFFSET. Messages page BACKWARDS from
 * last-seen (`seq < cursor`, newest first), extending whole chunk runs and tool
 * dependencies; has_more says older eligible rows exist. Sessions page over
 * `(updated_at, id)`.
 */
import type { HTTPClient } from './http.js';
import type { McpServer } from '@agentclientprotocol/sdk';

/** Stored standard setup for one platform session's agent leg. */
export interface AcpSessionSetup {
  session_id: string;
  agent_id: string;
  setup: { cwd: string; mcpServers: McpServer[]; [key: string]: unknown } | null;
}

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
  protocol_version: 1 | null;
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
  /** Client JSON object; defaults empty on older servers. Not message reaction metadata. */
  meta?: Record<string, unknown>;
  /** Persisted product permission mode; distinct from native ACP session modes. */
  mode?: 'ask' | 'auto' | 'none' | null;
  /** Descriptive creation provenance; unknown values are preserved. */
  source: string | null;
  /** Opaque external reference, independent of source; absent on older servers. */
  externalUrl?: string | null;
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
 * already-rendered messages without paging message rows. Merged per
 * participant, role and message id: earliest created_at, first non-null delivery
 * and user completion (latest assistant completion). Missing scope stays unknown.
 */
export interface AcpSessionReceipt {
  messageId: string;
  role: 'user' | 'assistant' | 'tool';
  /** Author scope, matching messages-page participantId; absent on older servers. */
  participantId?: string | null;
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

/** Current product metadata on an existing session message, never ACP metadata. */
export interface SessionMessageMeta {
  /** Keys are exact `unicode:${value}` or `custom:${scopedReference}`. */
  reactions: Record<string, SessionReactionGroup>;
  reactionSupport: 'supported' | 'unsupported' | 'unknown';
  reactionsComplete: boolean;
  /** Canonical UTC, six fractional digits. Compare strings, not JS milliseconds. */
  reactionUpdatedAt: string | null;
}

export interface SessionReactionGroup {
  /** Null means unknown, not zero or the number of known actors. */
  count: number | null;
  actors: Record<string, { isBot: boolean; receipt: string | null }>;
  actorsComplete: boolean;
}

/** Rollout read compatibility only; new operations already carry dictionary metadata. */
export function sessionMessageMetaFromWire(value: unknown, legacyRead = true): SessionMessageMeta | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new TypeError('Invalid session reaction metadata'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const closed = (v: unknown, keys: string[], optional: string[] = []): v is Record<string, unknown> =>
    record(v) && keys.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => keys.includes(k) || optional.includes(k));
  const reference = (v: string) => /^[a-z0-9-]+:.+$/u.test(v) && new TextEncoder().encode(v).length <= 1024 &&
    !/[\s\x00-\x20\x7f\u0085\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(v);
  if (!closed(value, ['reactions', 'reactionSupport', 'reactionsComplete'], ['reactionUpdatedAt'])) return fail();
  const meta = value as unknown as SessionMessageMeta;
  if (!Array.isArray(meta.reactions)) {
    if (!record(meta.reactions) || !['supported', 'unsupported', 'unknown'].includes(meta.reactionSupport) ||
        typeof meta.reactionsComplete !== 'boolean' || (meta.reactionSupport !== 'supported' && meta.reactionsComplete)) return fail();
    const stamp = meta.reactionUpdatedAt;
    if (stamp !== undefined && stamp !== null) {
      if (typeof stamp !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(stamp)) return fail();
      const millis = stamp.slice(0, 23) + 'Z';
      const date = new Date(millis);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== millis) return fail();
    }
    for (const [key, group] of Object.entries(meta.reactions)) {
      const colon = key.indexOf(':');
      const kind = key.slice(0, colon), reaction = key.slice(colon + 1);
      if (!reaction || [...reaction].length > 1024 || !(kind === 'custom' ? reference(reaction) :
          kind === 'unicode' && !/[\s\x00-\x20\x7f\u0085]/u.test(reaction))) return fail();
      if (!closed(group, ['count', 'actors', 'actorsComplete']) || !record(group.actors) || typeof group.actorsComplete !== 'boolean') return fail();
      const count = group.count, size = Object.keys(group.actors).length;
      if (count !== null && (typeof count !== 'number' || !Number.isInteger(count) || count < size || count > 2 ** 64 - 1)) return fail();
      if (group.actorsComplete && count !== size) return fail();
      for (const [id, member] of Object.entries(group.actors)) {
        if (!reference(id) || !closed(member, ['isBot', 'receipt']) || typeof member.isBot !== 'boolean' ||
            !(member.receipt === null || typeof member.receipt === 'string' && [...member.receipt].length > 0 && [...member.receipt].length <= 4096)) return fail();
      }
    }
    return { ...meta, reactionUpdatedAt: stamp ?? null };
  }
  if (!legacyRead) return fail();
  const legacy = meta.reactions as { reaction: { kind: string; value: string }; count: number | null;
    actors: { actor: { id: string; isBot: boolean }; receipt: string | null }[]; actorsComplete: boolean }[];
  const keys = new Set<string>();
  for (const group of legacy) {
    if (!closed(group, ['reaction', 'count', 'actors', 'actorsComplete']) ||
        !closed(group.reaction, ['kind', 'value']) || typeof group.reaction.value !== 'string' || !Array.isArray(group.actors)) return fail();
    const key = `${group.reaction.kind}:${group.reaction.value}`;
    if (keys.has(key)) return fail();
    keys.add(key);
    const actors = new Set<string>();
    for (const member of group.actors) {
      if (!closed(member, ['actor', 'receipt']) || !closed(member.actor, ['id', 'isBot']) || typeof member.actor.id !== 'string' || actors.has(member.actor.id)) return fail();
      actors.add(member.actor.id);
    }
  }
  return sessionMessageMetaFromWire({ ...meta, reactionUpdatedAt: meta.reactionUpdatedAt ?? null,
    reactions: Object.fromEntries(legacy.map(group => [`${group.reaction.kind}:${group.reaction.value}`, {
      count: group.count, actorsComplete: group.actorsComplete,
      actors: Object.fromEntries(group.actors.map(member => [member.actor.id, { isBot: member.actor.isBot, receipt: member.receipt }])),
    }])),
  });
}

/** Retain the freshest current projection; equal timestamps preserve object identity. */
export function newerSessionMessageMeta(current: SessionMessageMeta | undefined, incoming: SessionMessageMeta | undefined): SessionMessageMeta | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  if (current.reactionUpdatedAt !== null && (incoming.reactionUpdatedAt === null || incoming.reactionUpdatedAt <= current.reactionUpdatedAt)) return current;
  return incoming;
}

/** Read-only subscriber operation, separate from ACP and from native write requests. */
export interface SessionReactionOperation {
  type: 'addReaction' | 'removeReaction';
  agent_id: string;
  session_id: string;
  seq: number;
  message_id: string;
  target: { source: string; account: string; workspace: string | null; channel: string | null; thread: string | null; message: string };
  actor: { id: string; isBot: boolean };
  reaction: { kind: 'unicode' | 'custom'; value: string };
  receipt: string | null;
  meta: SessionMessageMeta;
}

/** Apply the resulting snapshot, never increment counts or replay actor deltas. */
export function applySessionReactionOperation<T extends AcpSessionMessage>(rows: T[], event: SessionReactionOperation): T[] {
  const index = rows.findIndex(row => row.sessionId === event.session_id && row.seq === event.seq && row.messageId === event.message_id);
  if (index < 0) return rows;
  const row = rows[index];
  const meta = newerSessionMessageMeta(row.meta, event.meta);
  if (meta === row.meta) return rows;
  const next = rows.slice();
  next[index] = { ...row, meta };
  return next;
}

export function sessionReactionDisplay(key: string): string {
  return key.startsWith('unicode:') ? key.slice('unicode:'.length) : `Custom reaction ${key.slice('custom:'.length)}`;
}

/** One `session_messages` row (backend `SessionMessage`): the durable full-fidelity truth for a session. */
export interface AcpSessionMessage {
  /** Stable platform history identity; never an ACP wire field. */
  messageId?: string | null;
  sessionId: string;
  /** Per-session ordering; the store's "where are we" value (the ACP wire has no ordinals). */
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  /** ACP-style settled payload at FULL fidelity — tool calls retained. */
  acp: Record<string, unknown>;
  /** Absent on older servers. Retain the authoritative snapshot without folding deltas. */
  meta?: SessionMessageMeta;
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
  /** The server has more eligible rows beyond this page. */
  hasMore: boolean;
}

export interface AcpSessionMessagePage extends AcpSessionPage<AcpSessionMessage> {
  importOutcome: SessionImportOutcome | null;
  /** Session event head read with the page's receipts; missing on older servers. */
  headSeq?: number | null;
}

export interface AcpSessionListOptions {
  agentId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AcpSessionUpdate {
  title?: string | null;
  mode?: 'ask' | 'auto' | 'none';
  /** Top-level merge; null values delete keys. Nested values replace. Stored limit: 16 KiB UTF-8 JSON. */
  meta?: Record<string, unknown>;
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
  /** Authorized platform navigation metadata; null on older servers. */
  agentId: string | null;
  title: string | null;
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

/**
 * One verified agent roster entry on a room read (backend `RoomAgent`). The
 * name is a display fact; `agentId` is the stable identity.
 */
export interface RoomAgent {
  agentId: string;
  name: string;
  /** The agent leg's native binding; null until Hyper-ACP binds it. */
  internalSessionId: string | null;
}

/** Explicit multiparty room (docs/MULTIPARTY.md) as the product API reads it. */
export interface RoomRecord {
  /** Stable platform room/session UUID; there is no separate room id. */
  id: string;
  kind: 'room';
  title: string | null;
  purpose: string;
  style: string;
  rules: string[];
  ownerId: string;
  agents: RoomAgent[];
  /** Aggregate per-epoch token budget; null means unlimited. */
  tokenLimit: number | null;
  /** Effective per-agent, per-epoch turn allowance the backend enforces (product default 25). */
  agentTurnLimit: number;
  /** The explicitly configured knob; null when the product default is in force. */
  configuredAgentTurnLimit: number | null;
  status: 'live' | 'archived' | 'deleted';
  setupRevision: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Room creation brief: the complete initial roster plus the two policy knobs. */
export interface RoomCreateOptions {
  /** null (or omitted) leaves the room untitled. */
  title?: string | null;
  purpose?: string;
  style?: string;
  rules?: string[];
  /** null (or omitted) means unlimited. 0 removes the automatic-turn token allowance. */
  tokenLimit?: number | null;
  /** null (or omitted) selects the product default. 0 disables automatic room turns. */
  agentTurnLimit?: number | null;
}

/**
 * Owner edits (`PATCH /rooms/{room_id}`). Omitted fields are preserved;
 * explicit null clears brief text and restores a policy knob's product
 * default. Policy changes take effect at the next human-message epoch.
 */
export interface RoomUpdateOptions {
  title?: string | null;
  purpose?: string | null;
  style?: string | null;
  rules?: string[] | null;
  tokenLimit?: number | null;
  agentTurnLimit?: number | null;
  status?: 'live' | 'archived';
}

/** One canonical room message committed by the authenticated owner. */
export interface RoomMessage {
  sessionId: string;
  messageId: string;
  seq: number;
  epochId: string;
  senderId: string;
  senderKind: 'user';
  senderName: string;
  body: string;
  replyTo: string | null;
  createdAt: string | null;
  /** Backend-owned per-agent delivery evidence; keys are agent UUIDs. */
  fanout: Record<string, boolean>;
}

function pick<T>(row: Record<string, unknown>, snake: string, camel: string): T | undefined {
  const value = row[snake] ?? row[camel];
  return value as T | undefined;
}

function participantFromWire(row: Record<string, unknown>): AcpSessionParticipant {
  const kind = row.kind;
  const cursorPos = pick<unknown>(row, 'cursor_pos', 'cursorPos');
  return {
    kind: kind === 'user' ? 'user' : 'agent',
    participantId: String(pick<unknown>(row, 'participant_id', 'participantId') ?? ''),
    internalSessionId: pick<string>(row, 'internal_session_id', 'internalSessionId') ?? null,
    cursorPos: typeof cursorPos === 'number' ? cursorPos : Number(cursorPos ?? 0),
  };
}

function sessionFromWire(row: Record<string, unknown>): AcpSessionRecord {
  const keywords = pick<unknown>(row, 'summary_keywords', 'summaryKeywords');
  const participants = row.participants;
  return {
    id: String(row.id ?? ''),
    meta: (row.meta ?? {}) as Record<string, unknown>,
    ...(row.mode !== undefined ? { mode: row.mode as AcpSessionRecord['mode'] } : {}),
    source: typeof row.source === 'string' ? row.source : null,
    externalUrl: pick<string>(row, 'external_url', 'externalUrl') ?? null,
    importOutcome: pick<SessionImportOutcome>(row, 'import_outcome', 'importOutcome') ?? null,
    createdAt: pick<string>(row, 'created_at', 'createdAt') ?? null,
    updatedAt: pick<string>(row, 'updated_at', 'updatedAt') ?? null,
    summaryText: pick<string>(row, 'summary_text', 'summaryText') ?? null,
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
    participantId: pick<string>(row, 'participant_id', 'participantId') ?? null,
    createdAt: pick<string>(row, 'created_at', 'createdAt') ?? null,
    deliveredAt: pick<string>(row, 'delivered_at', 'deliveredAt') ?? null,
    completedAt: pick<string>(row, 'completed_at', 'completedAt') ?? null,
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
    messageId: pick<string>(row, 'message_id', 'messageId') ?? null,
    sessionId: String(pick<unknown>(row, 'session_id', 'sessionId') ?? ''),
    seq: typeof seq === 'number' ? seq : Number(seq ?? 0),
    role: role === 'user' || role === 'tool' ? role : 'assistant',
    acp: (row.acp && typeof row.acp === 'object' ? row.acp : {}) as Record<string, unknown>,
    ...(row.meta !== undefined ? { meta: sessionMessageMetaFromWire(row.meta) } : {}),
    stopReason: pick<string>(row, 'stop_reason', 'stopReason') ?? null,
    createdAt: pick<string>(row, 'created_at', 'createdAt') ?? null,
    deliveredAt: pick<string>(row, 'delivered_at', 'deliveredAt') ?? null,
    completedAt: pick<string>(row, 'completed_at', 'completedAt') ?? null,
    participantKind: pick<AcpSessionMessage['participantKind']>(row, 'participant_kind', 'participantKind') ?? null,
    participantId: pick<string>(row, 'participant_id', 'participantId') ?? null,
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

function roomAgentFromWire(row: Record<string, unknown>): RoomAgent {
  const internalSessionId = pick<unknown>(row, 'internal_session_id', 'internalSessionId');
  return {
    agentId: String(pick<unknown>(row, 'agent_id', 'agentId') ?? ''),
    name: typeof row.name === 'string' ? row.name : '',
    internalSessionId: internalSessionId === undefined || internalSessionId === null ? null : String(internalSessionId),
  };
}

/** Normalize one backend `RoomRecord`; refuses non-room payloads. */
function roomFromWire(row: Record<string, unknown>): RoomRecord {
  if (row.kind !== 'room') throw new TypeError('Invalid room record response');
  const rules = row.rules;
  const agents = row.agents;
  const tokenLimit = pick<unknown>(row, 'token_limit', 'tokenLimit');
  const agentTurnLimit = pick<unknown>(row, 'agent_turn_limit', 'agentTurnLimit');
  const configured = pick<unknown>(row, 'configured_agent_turn_limit', 'configuredAgentTurnLimit');
  const setupRevision = pick<unknown>(row, 'setup_revision', 'setupRevision');
  const status = row.status;
  const integer = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) ? value : null;
  // agentTurnLimit and setupRevision are required on the wire; defaulting them
  // here would fabricate policy facts (0 disables turns).
  if (!Array.isArray(rules) || !rules.every((rule) => typeof rule === 'string') ||
      !Array.isArray(agents) || typeof status !== 'string' ||
      integer(agentTurnLimit) === null || integer(setupRevision) === null) {
    throw new TypeError('Invalid room record response');
  }
  return {
    id: String(row.id ?? ''),
    kind: 'room',
    title: row.title === undefined || row.title === null ? null : String(row.title),
    purpose: typeof row.purpose === 'string' ? row.purpose : '',
    style: typeof row.style === 'string' ? row.style : '',
    rules: rules.map(String),
    ownerId: String(pick<unknown>(row, 'owner_id', 'ownerId') ?? ''),
    agents: agents.filter((agent) => agent && typeof agent === 'object').map(roomAgentFromWire),
    tokenLimit: integer(tokenLimit),
    agentTurnLimit: agentTurnLimit as number,
    configuredAgentTurnLimit: integer(configured),
    status: status as RoomRecord['status'],
    setupRevision: setupRevision as number,
    createdAt: pick<string>(row, 'created_at', 'createdAt') ?? null,
    updatedAt: pick<string>(row, 'updated_at', 'updatedAt') ?? null,
  };
}

function roomMessageFromWire(row: Record<string, unknown>): RoomMessage {
  const seq = row.seq;
  const fanout = row.fanout;
  if (typeof fanout !== 'object' || fanout === null || Array.isArray(fanout)) {
    throw new TypeError('Invalid room message response');
  }
  return {
    sessionId: String(pick<unknown>(row, 'session_id', 'sessionId') ?? ''),
    messageId: String(pick<unknown>(row, 'message_id', 'messageId') ?? ''),
    seq: typeof seq === 'number' ? seq : Number(seq ?? 0),
    epochId: String(pick<unknown>(row, 'epoch_id', 'epochId') ?? ''),
    senderId: String(pick<unknown>(row, 'sender_id', 'senderId') ?? ''),
    // The REST surface commits authenticated owner messages only; the wire
    // kind is 'user' today and any other value is a contract change.
    senderKind: 'user',
    senderName: pick<string>(row, 'sender_name', 'senderName') ?? '',
    body: typeof row.body === 'string' ? row.body : '',
    replyTo: pick<string>(row, 'reply_to', 'replyTo') ?? null,
    createdAt: pick<string>(row, 'created_at', 'createdAt') ?? null,
    fanout: Object.fromEntries(
      Object.entries(fanout as Record<string, unknown>).map(([key, value]) => [key, value === true]),
    ),
  };
}

/**
 * Session read surface scoped to the caller's identity (user key: sessions
 * of owned agents; runtime key: sessions §15 exposes to the pod). Bound to
 * the agents API base, so `/sessions` resolves to `/agents/sessions`.
 */
export class SessionsAPI {
  constructor(private readonly http: Pick<HTTPClient, 'get'> & Partial<Pick<HTTPClient, 'post' | 'patch'>>) {}

  /** Unknown setup is null; lookup failures and malformed replies remain errors. */
  async getSetup(sessionId: string, agentId: string): Promise<AcpSessionSetup> {
    const payload = await this.http.get<AcpSessionSetup>(
      `/sessions/${encodeURIComponent(sessionId)}/setup`, { agent_id: agentId },
    );
    if (!payload || payload.session_id !== sessionId || payload.agent_id !== agentId ||
        (payload.setup !== null && (!payload.setup || typeof payload.setup !== 'object' || Array.isArray(payload.setup) ||
          typeof payload.setup.cwd !== 'string' || !Array.isArray(payload.setup.mcpServers)))) {
      throw new TypeError('Invalid session setup response');
    }
    return structuredClone(payload);
  }

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

  /** Persist product permission mode. A 503 can follow persistence; GET reads it back. */
  async setMode(platformSessionId: string, mode: 'ask' | 'auto' | 'none'): Promise<AcpSessionRecord> {
    if (!this.http.post) throw new Error('Session mode updates require a writable HTTP client');
    return this.updateSession(platformSessionId, { mode });
  }

  /** Update stored session fields; omitted fields are preserved. Whole-meta null is rejected by the server. */
  async updateSession(platformSessionId: string, patch: AcpSessionUpdate): Promise<AcpSessionRecord> {
    if (!this.http.post) throw new Error('Session updates require a writable HTTP client');
    const payload = await this.http.post<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(platformSessionId)}`, patch,
    );
    return sessionFromWire(payload);
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
   * Canonical complete history page, delivered as one coherent result.
   * Rows stay descending by seq; feed the opaque nextCursor back to read older
   * rows. Limit (default 20) is a target: the server extends chunk runs and tool
   * creation dependencies. Native ACP payloads/IDs and full tool content are
   * untouched; only platform DTO fields are normalized. This read does not
   * establish a transaction or gap-free boundary with a live subscription.
   */
  async getMessages(sessionId: string, options: AcpSessionMessagesOptions = {}): Promise<AcpSessionMessagePage> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        ...(options.cursor ? { cursor: options.cursor } : {}),
        limit: options.limit ?? 20,
      },
    );
    return { ...pageFromWire(payload ?? {}, messageFromWire),
      headSeq: pick<number>(payload ?? {}, 'head_seq', 'headSeq') ?? null,
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
        agentId: pick<string>(row, 'agent_id', 'agentId') ?? null,
        title: typeof row.title === 'string' ? row.title : null,
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

  /**
   * Create an explicit multiparty room (`POST /rooms`, docs/MULTIPARTY.md).
   * `agents` are agent UUID strings the authenticated owner is authorized to
   * use; the backend validates the roster, brief, and both policy knobs.
   * Omitted knobs select the product defaults (read back as the effective
   * `agentTurnLimit`, 25 today, with `configuredAgentTurnLimit` null).
   */
  async createRoom(agents: readonly string[], options: RoomCreateOptions = {}): Promise<RoomRecord> {
    if (!this.http.post) throw new Error('Room creation requires a writable HTTP client');
    const payload = await this.http.post<Record<string, unknown>>('/rooms', {
      title: options.title ?? null,
      purpose: options.purpose ?? '',
      style: options.style ?? '',
      rules: options.rules ?? [],
      agents: [...agents],
      token_limit: options.tokenLimit ?? null,
      agent_turn_limit: options.agentTurnLimit ?? null,
    });
    return roomFromWire(payload);
  }

  /** Read one room's brief, roster, policy, and status by room/session id. */
  async getRoom(roomId: string): Promise<RoomRecord> {
    const payload = await this.http.get<Record<string, unknown>>(
      `/rooms/${encodeURIComponent(roomId)}`,
    );
    return roomFromWire(payload);
  }

  /**
   * Owner-edit a room brief, policy knobs, or status (`PATCH /rooms/{room_id}`).
   * Omitted fields are preserved; explicit null clears brief text and restores
   * a policy knob's product default. Policy changes take effect at the next
   * human-message epoch.
   */
  async updateRoom(roomId: string, patch: RoomUpdateOptions = {}): Promise<RoomRecord> {
    if (!this.http.patch) throw new Error('Room updates require a writable HTTP client');
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.purpose !== undefined) body.purpose = patch.purpose;
    if (patch.style !== undefined) body.style = patch.style;
    if (patch.rules !== undefined) body.rules = patch.rules;
    if (patch.tokenLimit !== undefined) body.token_limit = patch.tokenLimit;
    if (patch.agentTurnLimit !== undefined) body.agent_turn_limit = patch.agentTurnLimit;
    if (patch.status !== undefined) body.status = patch.status;
    const payload = await this.http.patch<Record<string, unknown>>(
      `/rooms/${encodeURIComponent(roomId)}`, body,
    );
    return roomFromWire(payload);
  }

  /**
   * Commit one authenticated human room message
   * (`POST /rooms/{room_id}/messages`). Fanout stays backend-owned: the reply
   * carries the canonical message identity, its epoch, and the per-agent
   * delivery map; automatic agent turns are neither awaited nor relayed.
   */
  async createRoomMessage(roomId: string, body: string, options: { replyTo?: string | null } = {}): Promise<RoomMessage> {
    if (!this.http.post) throw new Error('Room messages require a writable HTTP client');
    const payload = await this.http.post<Record<string, unknown>>(
      `/rooms/${encodeURIComponent(roomId)}/messages`,
      { body, ...(options.replyTo !== undefined && options.replyTo !== null ? { reply_to: options.replyTo } : {}) },
    );
    return roomMessageFromWire(payload);
  }

}
