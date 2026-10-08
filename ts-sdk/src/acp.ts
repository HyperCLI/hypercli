/**
 * ACP (Agent Client Protocol) client connectivity for coding agents.
 *
 * Hosted runtimes connect to the backend bridge through `hyper-acp`.
 * Product clients default to the backend session authority at `/ws/acp`;
 * this module initializes that connection and exposes typed session helpers
 * plus raw JSON-RPC access.
 *
 * The frontend profile is schema-v2.0.0-alpha.5 using the actual
 * upstream experimental/v2 SDK runtime. There is no v1 opt-in: the client
 * closes the connection when the agent answers anything other than version 2.
 * The backend independently negotiates its runtime legs.
 * submitPrompt returns the v2 inserted messageId; prompt is a convenience that
 * additionally verifies completion through a platform REST receipt reader. Neither
 * helper retries input after uncertain delivery.
 * On v2 there is no `session/load` — reattach and history replay go through
 * `session/resume` with a `replayFrom` cursor instead.
 *
 * Reconnect mirrors the ACP reattach contract used by the bridge: the runtime
 * side is long-lived, the client re-dials, re-initializes (re-negotiating),
 * and replays each known session with `session/resume` and
 * `replayFrom: { type: 'start' }`. In-flight prompt turns are never
 * retried mid-turn; replay failures surface as soft
 * {@link CodingAgentAcpReplayGapError}s while the connection stays alive.
 *
 * Replayed notifications rebuild the transcript only. In particular, replayed
 * `state_update` frames are retained history — a completed turn's `running`
 * marker is retained while its terminal `idle` is not — so they never move
 * the live foreground marker. Only live state transitions (outside a replay
 * epoch) do; `waitForIdle` reads exclusively that live view.
 */
import NodeWebSocket from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import * as acp2 from '@agentclientprotocol/sdk/experimental/v2';
import type {
  InitializeResponse as AcpV2InitializeResponse,
  ReplayFrom as AcpReplayFrom,
  UpdateSessionNotification as SessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2';
import {
  createWebSocketStream,
  MemoryAcpCookieStore,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@agentclientprotocol/sdk/experimental/ws-client';

export type { ContentBlock } from '@agentclientprotocol/sdk';
export { RequestPermissionSubject } from '@agentclientprotocol/sdk/experimental/v2';
export type { RequestPermissionRequest } from '@agentclientprotocol/sdk/experimental/v2';
export type { AcpReplayFrom, SessionNotification };

/**
 * Existing platform-specific windowed resume cursor. These range fields
 * are not upstream ACP semantics; replacing them requires a coordinated
 * app/backend compatibility change. Retained behavior:
 * - `{ type: 'start', limit }`: the bounded mount — replay the run-atomic
 *   newest-`limit` window of retained rows.
 * - `{ type: 'start', from: '<messageId>', limit }`: page the window
 *   strictly older than the anchored message's first row; an empty page is
 *   the end-of-history signal. Paging requires the live leg — mount first.
 * A bare `{ type: 'start' }` (plain `AcpReplayFrom`) replays everything.
 */
export type WindowedReplayCursor = {
  type: 'start';
  /** Window size in replay-eligible retained rows. */
  limit: number;
  /** messageId anchor: replay rows strictly older than this message's first row. */
  from?: string;
};

/** Legacy public version union; this client only negotiates reference v2. */
export type CodingAgentAcpProtocolVersion = 1 | 2;

/** Completion result verified by the configured authoritative receipt reader. */
export interface CodingAgentAcpPromptResult {
  messageId?: string;
  stopReason?: string | null;
  _meta?: Record<string, unknown> | null;
}

interface ForegroundObservation {
  messageId?: string;
  idle?: boolean;
  reconcile?: boolean;
  checking?: boolean;
  resolve(result: CodingAgentAcpPromptResult): void;
  reject(error: Error): void;
}

/**
 * Which backend socket `acpConnect` dials (sessions/README §14):
 * - `'proxy'` (default): `/ws/acp`, the client-facing ACP session authority.
 *   Sessions are backend-keyed — the proxy owns `{session_id → legs}`, tees
 *   runtime frames to every attached session client, and answers
 *   `session/new` with the backend session id.
 * - `'direct'`: the agent-keyed `/ws` bridge. Infra/debug escape hatch only —
 *   the bridge is being hardened to runtime + backend-service identities
 *   (proxy, routines), so interactive consumers must not select it.
 */
export type CodingAgentAcpTransport = 'proxy' | 'direct';

/** Reconnect backoff budget, mirroring the buzz-activity subscriptions. */
export const ACP_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * Proxy (`/ws/acp`) close code for an attach whose `session_id` the backend
 * session store does not hold for this agent. Re-dialing the same id can
 * never succeed, so the code is terminal just like the auth refusals.
 */
export const ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE = 4404;

// User read receipts are backend-owned: session-detail GET advances the
// caller's participant cursor. This client emits no ACP read-ack frame.
// Updates carry no private sequence annotation; reconnect/resume recovers gaps.

/**
 * Bridge close codes that must not be retried: the identity/binding itself is
 * rejected, so re-dialing with the same credentials can never succeed. 4404
 * is the proxy's unknown-session attach — same permanence, the session the
 * URL pins does not exist. (4409, duplicate side, is transient — the other
 * client may disconnect.)
 */
const ACP_TERMINAL_CLOSE_CODES = new Set([4401, 4403, ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE, 4408]);

/** Thrown when a capability-gated helper hits a child that does not advertise it. */
export class CodingAgentAcpUnavailableError extends Error {
  public readonly capability: string;
  constructor(capability: string, detail: string) {
    super(`${capability} is not available: ${detail}`);
    this.name = 'CodingAgentAcpUnavailableError';
    this.capability = capability;
  }
}

/**
 * Thrown when the connection cannot be used: initial dial or handshake
 * failure, a call made while (re)connecting, an in-flight request killed by
 * a socket drop, or a reconnect budget exhausted. Carries the bridge close
 * `code` when one was observed.
 */
export class CodingAgentAcpConnectionError extends Error {
  public readonly code: number | null;
  constructor(message: string, options: { code?: number | null; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CodingAgentAcpConnectionError';
    this.code = options.code ?? null;
  }
}

/** Prompt was sent, but foreground observation failed; never resubmit it automatically. */
export class CodingAgentAcpObservationError extends Error {
  constructor(message: string, public readonly messageId?: string) {
    super(message);
    this.name = 'CodingAgentAcpObservationError';
  }
}

/** A correlated JSON-RPC rejection, not a transport or observation failure.
 * The code alone says nothing about whether input was inserted. Consumers of
 * platform-specific refusals must also check the exact method and message.
 */
export class CodingAgentAcpRequestError extends Error {
  constructor(public readonly method: string, public readonly code: number, message: string,
    public readonly data?: unknown, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CodingAgentAcpRequestError';
  }
}

/**
 * Local replay boundary for `session/resume` with history. `start` precedes
 * the request and its replayed notifications; `end` follows settlement.
 * Overlapping resumes increment `epoch`: the newest resume owns transcript
 * classification, and a stale `end` is identifiable by its older epoch.
 */
export interface CodingAgentAcpReplayEvent {
  sessionId: string;
  phase: 'start' | 'end';
  epoch: number;
  /** `end` only: whether the resume resolved. */
  ok?: boolean;
}

/** Soft reconnect replay failure; the connection stays alive and the session is untracked. */
export class CodingAgentAcpReplayGapError extends Error {
  public readonly sessionId: string;
  constructor(sessionId: string, detail: string, options: { cause?: unknown } = {}) {
    super(
      `replay_gap: ACP session ${sessionId} could not be reloaded after reconnect: ${detail}`,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'CodingAgentAcpReplayGapError';
    this.sessionId = sessionId;
  }
}

export type CodingAgentAcpStage = 'connect' | 'initialize' | 'cwd' | 'new' | 'list' | 'resume' | 'prompt';

/** Payload-free error evidence. Messages/data can contain credentials or user content. */
export interface CodingAgentAcpDiagnosticError {
  name: string;
  code?: number | string;
  statusCode?: number;
  cause?: CodingAgentAcpDiagnosticError;
}

/** Local operation IDs correlate events, NOT JSON-RPC wire request IDs. */
export type CodingAgentAcpDiagnostic = {
  stage: CodingAgentAcpStage;
  operationId: number;
  timestamp: number;
  elapsedMs: number;
  phase: 'started' | 'succeeded' | 'failed';
  error?: CodingAgentAcpDiagnosticError;
} | {
  stage: 'transport';
  phase: 'closed';
  timestamp: number;
  code: number | null;
  reasonPresent: boolean;
};

function diagnosticError(error: unknown, depth = 0): CodingAgentAcpDiagnosticError {
  const value = error as { constructor?: { name?: unknown }; code?: unknown; statusCode?: unknown; cause?: unknown } | null;
  const name = value?.constructor?.name;
  return {
    name: typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) ? name : 'Error',
    ...(typeof value?.code === 'number' || (typeof value?.code === 'string' && /^(?:E[A-Z]+|UND_ERR_[A-Z_]+)$/.test(value.code))
      ? { code: value.code } : {}),
    ...(typeof value?.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
    ...(value?.cause !== undefined && depth < 3 ? { cause: diagnosticError(value.cause, depth + 1) } : {}),
  };
}

export interface CodingAgentAcpConnectOptions {
  /** Opt-in, payload-free local stage/transport evidence. Observer failures are ignored.
   * No messages, URLs, paths, session content, credentials or wire IDs are emitted.
   * Failures belong to the operation; they do not change deployment health/state.
   */
  onDiagnostic?: (event: CodingAgentAcpDiagnostic) => void;
  /** Platform-owned default for new sessions only; never invoked by initialize/list/resume. */
  resolveDefaultCwd?: () => Promise<string>;
  /** Existing platform REST evidence, required by the v2 completion convenience. */
  getPromptCompletion?: (sessionId: string, messageId: string) => Promise<{ stopReason: string } | null>;
  /** Abort before connect rejects the promise; abort after connect closes the client. */
  signal?: AbortSignal;
  /**
   * `/ws/acp` credential. Defaults to the client API key.
   */
  token?: string;
  /** Absolute runtime-host working directory; defaults to its launch advertisement. */
  cwd?: string;
  /** Override the `clientInfo` sent with `initialize`. */
  clientInfo?: { name?: string; version?: string };
  /** MCP servers attached to every session created or replayed by this client. */
  mcpServers?: acp.McpServer[];
  /**
   * Which backend socket `CodingAgent.acpConnect` dials; see
   * {@link CodingAgentAcpTransport}. Defaults to `'proxy'`. `'direct'` is an
   * infra/debug-only escape hatch to the agent-keyed `/ws` bridge.
   */
  transport?: CodingAgentAcpTransport;
  /**
   * Proxy transport only: the backend session id this connection works with
   * (create-or-attach semantics — no `sessionId` means the socket stays
   * session-less and `newSession()` mints one through the proxy; a provided
   * id is resumed AFTER the initialize handshake, via `session/resume` on
   * v2, over the already-connected socket). Backend-side, an attach naming
   * an id the store does not hold is refused with
   * {@link ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE} (4404). Combining it with
   * `transport: 'direct'` throws — the `/ws` bridge has no session binding.
   */
  sessionId?: string;
  /** Proxy creation provenance, carried in the WS query (not ACP). Applies only
   * to newly created sessions on this connection; attaching never changes it. */
  source?: string | null;
  /** Receives every raw upstream v2 `session/update` notification. */
  onUpdate?: (notification: SessionNotification) => void;
  /**
   * Upstream v2 permission handler. When omitted, every `session/request_permission`
   * request is answered with the `cancelled` outcome — a raw SDK never
   * auto-approves. The optional signal follows standard per-request
   * cancellation and connection closure; use it to retire pending UI.
   */
  onPermissionRequest?: (
    params: acp2.RequestPermissionRequest,
    signal?: AbortSignal,
  ) => acp2.MaybePromise<acp2.RequestPermissionResponse>;
  /** Compatibility spelling for onPermissionRequest; both receive unmodified v2 shapes. */
  onV2PermissionRequest?: (params: acp2.RequestPermissionRequest, signal?: AbortSignal) => acp2.MaybePromise<acp2.RequestPermissionResponse>;
  /** Soft errors (replay gaps); the client stays alive. */
  onError?: (error: Error) => void;
  /** Terminal close: reconnect budget exhausted or a terminal bridge close code. */
  onClose?: (event: { code: number; reason: string }) => void;
}

/** Internal dial target; the URL/auth derivation lives on CodingAgent. */
export interface CodingAgentAcpTarget {
  url: string;
  token: string;
}

interface TrackedAcpSession {
  cwd: string;
  mcpServers: acp.McpServer[];
  configOptions: acp2.SessionConfigOption[] | null;
  title: string | null;
}

interface Deferred {
  resolve(): void;
  reject(error: Error): void;
}

// Version-neutral RPC plumbing. The concrete app below selects the actual
// versioned SDK handlers; this interface does not turn v1 schemas into v2.
interface WireContext {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
}
interface WireConnection {
  agent: WireContext;
  signal: AbortSignal;
  closed: Promise<unknown>;
  close(error?: Error): void;
}

function trackSocketClose(socket: WebSocketLike, closeInfo: { code?: number; reason: string }): void {
  if (typeof socket.on === 'function') {
    socket.on('close', (...args: unknown[]) => {
      closeInfo.code = typeof args[0] === 'number' ? args[0] : undefined;
      closeInfo.reason = args[1] === undefined || args[1] === null ? '' : String(args[1]);
    });
    return;
  }
  socket.addEventListener?.('close', (event: unknown) => {
    const detail = event as { code?: unknown; reason?: unknown } | undefined;
    closeInfo.code = typeof detail?.code === 'number' ? detail.code : undefined;
    closeInfo.reason = typeof detail?.reason === 'string' ? detail.reason : '';
  });
}

/**
 * ACP client bound to one coding agent. Instances are created by
 * `CodingAgent.acpConnect(...)`; `connect(...)` resolves after the first
 * successful `initialize` handshake and rejects when the initial dial,
 * auth, or handshake fails.
 */
export class CodingAgentAcpClient {
  private readonly target: CodingAgentAcpTarget;
  private readonly options: CodingAgentAcpConnectOptions;
  private readonly cwd: string | undefined;
  private readonly mcpServers: acp.McpServer[];
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly cookieStore = new MemoryAcpCookieStore();
  private connection: WireConnection | null = null;
  /** Owned for cancellation, but not usable until initialize succeeds. */
  private pendingConnection: WireConnection | null = null;
  private readonly foreground = new Map<string, Set<ForegroundObservation>>();
  private readonly foregroundStates = new Map<string, string>();
  private readonly idleWaiters = new Map<string, Set<Deferred>>();
  private initializeResponseValue: AcpV2InitializeResponse | null = null;
  private negotiatedVersionValue: 2 | null = null;
  private readonly sessions = new Map<string, TrackedAcpSession>();
  private readonly connectedWaiters = new Set<Deferred>();
  private readonly updateListeners = new Set<(notification: SessionNotification) => void>();
  private readonly replayListeners = new Set<(event: CodingAgentAcpReplayEvent) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  /** In-memory only: latest epoch and outstanding replay identities per session. */
  private readonly replayEpochs = new Map<string, {
    epoch: number; active: Set<number>; replaying: boolean; status: 'pending' | 'succeeded' | 'failed';
  }>();
  private nextReplayEpoch = 0;
  /** No-history resumes wait for untagged history traffic to finish first. */
  private readonly historyReplays = new Map<string, Set<Promise<void>>>();
  private readonly closeListeners = new Set<(event: { code: number; reason: string }) => void>();
  private permissionHandler: ((request: acp2.RequestPermissionRequest, signal?: AbortSignal) => Promise<acp2.RequestPermissionResponse>) | null = null;
  private closedFlag = false;
  private terminalError: CodingAgentAcpConnectionError | null = null;
  private lastCloseCode: number | null = null;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly onAbort: () => void;
  private nextDiagnosticOperation = 0;

  private diagnostic(event: CodingAgentAcpDiagnostic): void {
    try { this.options.onDiagnostic?.(event); } catch { /* Observers never change ACP outcomes. */ }
  }

  private beginDiagnostic(stage: CodingAgentAcpStage): (error?: unknown) => void {
    const operationId = ++this.nextDiagnosticOperation;
    const started = performance.now();
    this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: 0, phase: 'started' });
    let finished = false;
    return (error?: unknown) => {
      if (finished) return;
      finished = true;
      this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: Math.round(performance.now() - started),
        phase: error === undefined ? 'succeeded' : 'failed',
        ...(error === undefined ? {} : { error: diagnosticError(error) }) });
    };
  }

  private async observe<T>(stage: CodingAgentAcpStage, operation: () => Promise<T>): Promise<T> {
    const finish = this.beginDiagnostic(stage);
    try {
      const result = await operation();
      finish();
      return result;
    } catch (error) {
      finish(error);
      throw error;
    }
  }

  private constructor(target: CodingAgentAcpTarget, options: CodingAgentAcpConnectOptions) {
    if (options.source != null) {
      if (options.transport === 'direct') throw new Error('source requires the ACP proxy transport');
      const url = new URL(target.url);
      url.searchParams.set('source', options.source);
      this.target = { ...target, url: url.toString() };
    } else {
      this.target = target;
    }
    this.options = options;
    this.cwd = options.cwd;
    this.mcpServers = options.mcpServers ?? [];
    this.clientName = options.clientInfo?.name ?? 'hypercli-ts-sdk';
    this.clientVersion = options.clientInfo?.version ?? '';
    this.onAbort = () => this.close();
  }

  static async connect(
    target: CodingAgentAcpTarget,
    options: CodingAgentAcpConnectOptions = {},
  ): Promise<CodingAgentAcpClient> {
    const client = new CodingAgentAcpClient(target, options);
    try {
      await client.open();
    } catch (error) {
      client.close();
      throw error;
    }
    return client;
  }

  /** True while a dialed connection is usable. */
  get connected(): boolean {
    return this.connection !== null && !this.closedFlag;
  }

  /** True once the client is closed — explicitly or by a terminal failure. */
  get closed(): boolean {
    return this.closedFlag;
  }

  /**
   * The negotiated ACP protocol version for the session: the version the
   * agent answered in the latest `initialize` handshake. Refreshed on every
   * (re)connect; `null` before the first handshake completes.
   */
  get negotiatedProtocolVersion(): CodingAgentAcpProtocolVersion | null {
    return this.negotiatedVersionValue;
  }

  /**
   * Latest v2 `initialize` response (`capabilities`/`info`), refreshed on
   * every (re)connect. The legacy public union is retained for compatibility.
   */
  get initializeResponse(): acp.InitializeResponse | AcpV2InitializeResponse | null {
    return this.initializeResponseValue;
  }

  /** Session IDs this client created or loaded, in creation order. */
  get sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Register a listener for every raw upstream v2 `session/update` notification. Listeners
   * fire in addition to the legacy single `options.onUpdate` callback, which
   * makes one shared connection usable by multiple subscribers (chat, session
   * sweep, ...). Returns an unsubscribe function; a throwing listener is
   * logged and does not break the others. `close()` clears all listeners.
   */
  addUpdateListener(listener: (notification: SessionNotification) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  /**
   * Register a listener for replay-boundary events (see
   * {@link CodingAgentAcpReplayEvent}). Fires for both history-replaying `resumeSession`
   * calls and the internal reconnect replay. Returns an unsubscribe function;
   * a throwing listener is logged and does not break the others. `close()`
   * clears all listeners.
   */
  addReplayListener(listener: (event: CodingAgentAcpReplayEvent) => void): () => void {
    this.replayListeners.add(listener);
    return () => {
      this.replayListeners.delete(listener);
    };
  }

  /** Pooled counterpart to onError, including capability loss before replay starts. */
  addErrorListener(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  /**
   * The newest resume owns replay classification. Once its response settles,
   * older outstanding responses cannot quarantine its current-state updates.
   */
  replayEpoch(sessionId: string): number {
    const state = this.replayEpochs.get(sessionId);
    return state?.replaying && state.status === 'pending' ? state.epoch : 0;
  }

  /**
   * Pooled-connection counterpart to `options.onClose`: fired once when the
   * client goes terminal. Subscribers use it to tear down their own state
   * without racing the pool's bookkeeping. Returns an unsubscribe function.
   */
  addCloseListener(listener: (event: { code: number; reason: string }) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Pooled-connection counterpart to `options.onPermissionRequest`: exactly
   * one live permission responder. Re-registering replaces the previous one
   * (a chat pane remount superseding its stale handler); clearing with `null`
   * restores the default cancel-unanswered behavior. `close()` clears it.
   */
  setPermissionHandler(
    handler: ((request: acp2.RequestPermissionRequest, signal?: AbortSignal) => Promise<acp2.RequestPermissionResponse>) | null,
  ): void {
    this.permissionHandler = handler;
  }

  /** Resolves on the next established connection; rejects once the client is terminal. */
  waitConnected(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.closedFlag) {
      return Promise.reject(this.terminalError ?? new CodingAgentAcpConnectionError('ACP client is closed'));
    }
    return new Promise<void>((resolve, reject) => {
      this.connectedWaiters.add({ resolve, reject });
    });
  }

  async newSession(options: { cwd?: string; mcpServers?: acp.McpServer[] } = {}): Promise<acp2.NewSessionResponse> {
    if ('systemPrompt' in options || 'title' in options) {
      throw new CodingAgentAcpUnavailableError('session/new', 'system instructions use native configuration; titles use platform REST');
    }
    this.requireContext();
    const cwd = await this.observe('cwd', async () => {
      if (options.cwd !== undefined) return options.cwd;
      if (this.cwd !== undefined) return this.cwd;
      if (!this.options.resolveDefaultCwd) {
        throw new CodingAgentAcpUnavailableError('session/new', 'runtime path discovery is unavailable on this connection; supply cwd explicitly');
      }
      return this.options.resolveDefaultCwd();
    });
    const mcpServers = options.mcpServers ?? this.mcpServers;
    const response = await this.observe('new', () => this.request<acp2.NewSessionResponse>(acp.methods.agent.session.new, {
      cwd,
      mcpServers: this.wireMcpServers(mcpServers),
    }));
    this.sessions.set(response.sessionId, {
      cwd,
      mcpServers,
      configOptions: response.configOptions ?? null,
      title: null,
    });
    return response;
  }

  async listSessions(options: { cwd?: string | null; cursor?: string | null } = {}): Promise<acp2.ListSessionsResponse> {
    return this.observe('list', async () => {
      this.requireContext();
      return this.request<acp2.ListSessionsResponse>(acp.methods.agent.session.list, {
        cwd: options.cwd ?? null,
        cursor: options.cursor ?? null,
      });
    });
  }

  private async originalSessionCwd(sessionId: string): Promise<string> {
    const tracked = this.sessions.get(sessionId);
    if (tracked) return tracked.cwd;
    if (this.cwd !== undefined) return this.cwd;
    // The authority's standard catalog reads persisted setup, including custom
    // roots. A new connection's launch default cannot reconstruct old setup.
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.listSessions({ cursor });
      const session = page.sessions.find((entry) => entry.sessionId === sessionId);
      if (session) return session.cwd;
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('session/list repeated a cursor while resolving the original cwd');
      if (cursor) seen.add(cursor);
    } while (cursor);
    throw new CodingAgentAcpUnavailableError('session/resume',
      'the original session cwd is unavailable from the session catalog; supply its original cwd explicitly');
  }

  /**
   * Removed in ACP v2: the client only negotiates v2, in which
   * `session/load` does not exist. Use {@link resumeSession} with a
   * `replayFrom` cursor to reattach with history replay.
   */
  async loadSession(_sessionId: string): Promise<acp.LoadSessionResponse> {
    throw new CodingAgentAcpUnavailableError(
      'session/load',
      'the connection negotiated ACP v2, which removed session/load; use resumeSession(sessionId, { replayFrom: { type: \'start\' } }) to reattach with history replay',
    );
  }

  /**
   * Restore a session's context (`session/resume`). Without `replayFrom` no
   * history is replayed. `replayFrom` requests retained history — this is the
   * v2 replacement for the removed `session/load`; replayed history streams
   * as `session/update` notifications before the resume response resolves, so
   * the call runs inside a replay-epoch bracket. Supported `replayFrom`
   * forms: `{ type: 'start' }` replays everything; adding plain range
   * fields bounds or pages the window — `{ type: 'start', limit }`
   * replays the run-atomic newest-`limit` window (the bounded mount), and
   * `{ type: 'start', from: '<messageId>', limit }` replays the window
   * strictly older than the anchored message's first row, an empty page
   * marking the end of history (mount first — paging requires the live
   * leg). See {@link WindowedReplayCursor}.
   */
  async resumeSession(
    sessionId: string,
    options: { cwd?: string; replayFrom?: AcpReplayFrom | null } = {},
  ): Promise<acp2.ResumeSessionResponse> {
    this.requireContext();
    const previous = this.sessions.get(sessionId);
    const cwd = await this.observe('cwd', async () => options.cwd !== undefined ? options.cwd : this.originalSessionCwd(sessionId));
    const params: Record<string, unknown> = {
      sessionId,
      cwd,
      mcpServers: this.wireMcpServers(previous?.mcpServers ?? this.mcpServers),
    };
    if (options.replayFrom !== undefined) params.replayFrom = options.replayFrom;
    const requestResume = () => this.request<acp2.ResumeSessionResponse>(acp.methods.agent.session.resume, params);
    // A replaying resume streams history before its response resolves (the
    // same boundary problem as v1 session/load), so it gets an epoch bracket.
    const replaying = options.replayFrom !== undefined && options.replayFrom !== null;
    return this.observe('resume', () => this.performReplayBracket(sessionId, requestResume, (response) => {
      this.sessions.set(sessionId, {
        cwd,
        mcpServers: previous?.mcpServers ?? this.mcpServers,
        configOptions: response?.configOptions ?? null,
        title: previous?.title ?? null,
      });
    }, replaying));
  }

  /** Cancel ongoing work and free the session's resources (`session/close`). */
  async closeSession(sessionId: string): Promise<void> {
    const context = this.requireContext();
    await context.request(acp.methods.agent.session.close, { sessionId });
    this.sessions.delete(sessionId);
  }

  /** Permanently delete a session (`session/delete`). */
  async deleteSession(sessionId: string): Promise<void> {
    const context = this.requireContext();
    await context.request(acp.methods.agent.session.delete, { sessionId });
    this.sessions.delete(sessionId);
  }

  /** Unstable: fork a session into a new session ID (`session/fork`). */
  async unstableForkSession(sessionId: string): Promise<acp2.ForkSessionResponse> {
    const context = this.requireContext();
    const previous = this.sessions.get(sessionId);
    const cwd = await this.originalSessionCwd(sessionId);
    const response = await context.request<acp2.ForkSessionResponse>(acp.methods.agent.session.fork, {
      sessionId,
      cwd,
      mcpServers: this.wireMcpServers(previous?.mcpServers ?? this.mcpServers),
    });
    this.sessions.set(response.sessionId, {
      cwd,
      mcpServers: previous?.mcpServers ?? this.mcpServers,
      configOptions: response.configOptions ?? previous?.configOptions ?? null,
      title: previous?.title ?? null,
    });
    return response;
  }

  /**
   * Submit once and verify this exact input's completion through platform REST.
   * V2 refuses before sending when no receipt reader is configured. A live idle
   * triggers the lookup but proves nothing itself; absent proof rejects. Replay
   * exit also reconciles the exact accepted ID, since live idle can arrive among
   * history frames. An absent receipt at that boundary leaves observation open.
   * onAccepted exposes the standard insertion response before idle (useful
   * for binding an optimistic UI item by identity rather than equal text).
   * Agent.acpConnect supplies the existing SessionsAPI reader. Direct callers
   * may supply it explicitly or use submitPrompt + updates. Nothing is retried.
   */
  async prompt(
    sessionId: string,
    prompt: string | acp.ContentBlock | acp.ContentBlock[],
    options: { onAccepted?: (accepted: acp2.PromptResponse) => void } = {},
  ): Promise<CodingAgentAcpPromptResult> {
    return this.observe('prompt', () => this.promptAndObserve(sessionId, prompt, options));
  }

  private async promptAndObserve(
    sessionId: string,
    prompt: string | acp.ContentBlock | acp.ContentBlock[],
    options: { onAccepted?: (accepted: acp2.PromptResponse) => void },
  ): Promise<CodingAgentAcpPromptResult> {
    const blocks: acp.ContentBlock[] = typeof prompt === 'string'
      ? [{ type: 'text', text: prompt }]
      : Array.isArray(prompt)
        ? prompt
        : [prompt];
    if (!this.options.getPromptCompletion) throw new CodingAgentAcpUnavailableError('prompt', 'v2 has no per-message completion event; use submitPrompt, or supply an exact platform REST receipt reader');
    let resolve!: (result: CodingAgentAcpPromptResult) => void;
    let reject!: (error: Error) => void;
    const completed = new Promise<CodingAgentAcpPromptResult>((res, rej) => { resolve = res; reject = rej; });
    // Both lanes can arrive before acceptance; register first.
    const pending: ForegroundObservation = { resolve, reject };
    const observations = this.foreground.get(sessionId) ?? new Set<ForegroundObservation>();
    observations.add(pending);
    this.foreground.set(sessionId, observations);
    void completed.catch(() => {});
    try {
      const acceptance = this.request<acp2.PromptResponse>('session/prompt', { sessionId, prompt: blocks });
      return await Promise.race([completed, acceptance.then(async (accepted) => {
        pending.messageId = accepted.messageId;
        options.onAccepted?.(accepted);
        this.settleForeground(sessionId);
        return completed;
      })]);
    } finally {
      observations.delete(pending);
      if (observations.size === 0 && this.foreground.get(sessionId) === observations) this.foreground.delete(sessionId);
      this.settleIdleWaiters(sessionId);
    }
  }

  /**
   * Resolves once no foreground work is observed for the session: no
   * in-flight `prompt` observation of this client and no live `running` /
   * `requires_action` state. Resolves immediately when the session is
   * already quiet. Use after resuming a session whose previous turn may
   * still be live: the resume announces the current state, and this waits
   * the old epoch out when the caller chooses serialized turns.
   * Rejects on connection loss, terminal close, or
   * `close()`. An untracked session or a failed latest resume is unknown,
   * not quiet, and rejects; older resume results cannot restore that knowledge.
   */
  waitForIdle(sessionId: string): Promise<void> {
    if (!this.connected) {
      return Promise.reject(this.terminalError ?? new CodingAgentAcpConnectionError('ACP connection is unavailable; foreground state is unknown'));
    }
    if (!this.sessions.has(sessionId) || this.replayEpochs.get(sessionId)?.status === 'failed') {
      return Promise.reject(new CodingAgentAcpConnectionError('Session foreground state is unknown; resume the session successfully before waiting for idle'));
    }
    if (!this.foregroundBusy(sessionId)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let waiters = this.idleWaiters.get(sessionId);
      if (!waiters) {
        waiters = new Set();
        this.idleWaiters.set(sessionId, waiters);
      }
      waiters.add({ resolve, reject });
    });
  }

  private foregroundBusy(sessionId: string): boolean {
    return this.foreground.has(sessionId)
      || this.replayEpochs.get(sessionId)?.status === 'pending'
      || ['running', 'requires_action'].includes(this.foregroundStates.get(sessionId) ?? '');
  }

  private settleIdleWaiters(sessionId: string): void {
    const waiters = this.idleWaiters.get(sessionId);
    if (!waiters || this.foregroundBusy(sessionId) || this.replayEpochs.get(sessionId)?.status === 'failed') return;
    this.idleWaiters.delete(sessionId);
    for (const waiter of waiters) waiter.resolve();
  }

  private failIdleWaiters(error: Error): void {
    const waiters = [...this.idleWaiters.values()].flatMap((set) => [...set]);
    this.idleWaiters.clear();
    for (const waiter of waiters) waiter.reject(error);
  }

  /** V2 insertion acknowledgement, not foreground completion. */
  async submitPrompt(sessionId: string, prompt: acp.ContentBlock[]): Promise<acp2.PromptResponse> {
    return this.request<acp2.PromptResponse>('session/prompt', { sessionId, prompt });
  }

  private settleForeground(sessionId: string): void {
    for (const pending of this.foreground.get(sessionId) ?? []) this.settleObservation(sessionId, pending);
  }

  private settleObservation(sessionId: string, pending: ForegroundObservation): void {
    if (!pending?.messageId || this.replayEpoch(sessionId) !== 0) return;
    if ((pending.idle || pending.reconcile) && !pending.checking) {
      pending.checking = true;
      pending.reconcile = false;
      const observedIdle = pending.idle;
      const messageId = pending.messageId;
      const generation = this.generation;
      const epoch = this.replayEpochs.get(sessionId)?.epoch;
      const current = () => {
        if (generation !== this.generation || !this.foreground.get(sessionId)?.has(pending)) return false;
        pending.checking = false;
        if (epoch !== this.replayEpochs.get(sessionId)?.epoch) {
          this.settleForeground(sessionId);
          return false;
        }
        return true;
      };
      void Promise.resolve().then(() => this.options.getPromptCompletion!(sessionId, messageId)).then((proof) => {
        if (!current()) return;
        if (proof) pending.resolve({ stopReason: proof.stopReason, messageId });
        else if (observedIdle) pending.reject(new CodingAgentAcpObservationError('Input accepted, but no completion receipt exists for this message; follow session history without resubmitting', messageId));
        // A replay-exit read without a receipt is not terminal evidence. A
        // live idle or another replay exit arriving during the read checks again.
        else this.settleForeground(sessionId);
      }, (error: unknown) => {
        if (current()) pending.reject(new CodingAgentAcpObservationError(`Completion receipt unavailable: ${String(error)}`, messageId));
      });
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.requireContext().notify(acp.methods.agent.session.cancel, { sessionId });
  }

  /** @deprecated Use setConfigOption with the peer's explicit configId. */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const option = this.sessions.get(sessionId)?.configOptions?.find((entry) => entry.category === 'mode');
    if (!option) throw new CodingAgentAcpUnavailableError('session/set_config_option', 'no mode option advertised');
    await this.setConfigOption(sessionId, option.configId, modeId);
  }

  /** Generic `session/set_config_option`; setModel delegates here. */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | { value: boolean; type: 'boolean' },
  ): Promise<acp2.SetSessionConfigOptionResponse> {
    const context = this.requireContext();
    const payload =
      typeof value === 'string'
        ? { sessionId, configId, value, type: 'id' as const }
        : { sessionId, configId, value: value.value, type: value.type };
    const response = await context.request<acp2.SetSessionConfigOptionResponse>(
      acp.methods.agent.session.setConfigOption,
      payload,
    );
    const tracked = this.sessions.get(sessionId);
    if (tracked) tracked.configOptions = response.configOptions ?? tracked.configOptions;
    return response;
  }

  /** @deprecated Use setConfigOption with the peer's explicit configId. */
  async setModel(sessionId: string, modelId: string): Promise<acp2.SetSessionConfigOptionResponse> {
    const options = this.sessions.get(sessionId)?.configOptions ?? null;
    const modelOption = options?.find(
      (option) => option.category === 'model',
    );
    if (!modelOption) {
      throw new CodingAgentAcpUnavailableError(
        'session/set_config_option',
        `session ${sessionId} advertised no model configuration option`,
      );
    }
    return this.setConfigOption(sessionId, modelOption.configId, modelId);
  }

  /** Unstable: list the agent's auth/model providers (`providers/list`). */
  async unstableListProviders(): Promise<unknown> {
    return this.requireContext().request(acp.methods.agent.providers.list, {});
  }

  /** Unstable: select a provider (`providers/set`). */
  async unstableSetProvider(request: acp.SetProviderRequest): Promise<unknown> {
    return this.requireContext().request(acp.methods.agent.providers.set, request);
  }

  /** Unstable: disable a provider (`providers/disable`). */
  async unstableDisableProvider(request: acp.DisableProviderRequest): Promise<unknown> {
    return this.requireContext().request(acp.methods.agent.providers.disable, request);
  }

  /** Raw JSON-RPC request; callers are responsible for negotiated protocol support. */
  async request<Response = unknown>(method: string, params?: unknown): Promise<Response> {
    try {
      return await this.requireContext().request<Response>(method, params);
    } catch (error) {
      if (error instanceof acp2.RequestError) {
        throw new CodingAgentAcpRequestError(method, error.code, error.message, error.data, error);
      }
      throw error;
    }
  }

  /** Raw JSON-RPC notification; callers are responsible for negotiated protocol support. */
  notify(method: string, params?: unknown): Promise<void> {
    return this.requireContext().notify(method, params);
  }

  close(): void {
    const error = new CodingAgentAcpConnectionError('ACP connection closed; delivery is unresolved');
    for (const observations of this.foreground.values()) for (const pending of observations) pending.reject(error);
    this.foreground.clear();
    this.foregroundStates.clear();
    this.replayEpochs.clear();
    this.failIdleWaiters(error);
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.updateListeners.clear();
    this.replayListeners.clear();
    this.errorListeners.clear();
    this.closeListeners.clear();
    this.permissionHandler = null;
    this.generation += 1;
    this.options.signal?.removeEventListener('abort', this.onAbort);
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const connection = this.connection;
    this.connection = null;
    const pendingConnection = this.pendingConnection;
    this.pendingConnection = null;
    pendingConnection?.close(this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed'));
    if (connection) {
      connection.close(this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed'));
    }
    this.rejectConnectedWaiters(
      this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed'),
    );
  }

  private async open(): Promise<void> {
    if (this.options.signal?.aborted) {
      throw new CodingAgentAcpConnectionError('ACP connect aborted');
    }
    this.options.signal?.addEventListener('abort', this.onAbort, { once: true });
    let dialed: Awaited<ReturnType<CodingAgentAcpClient['dialAndInitialize']>>;
    try {
      dialed = await this.dialAndInitialize();
    } catch (error) {
      if (this.options.signal?.aborted) {
        throw new CodingAgentAcpConnectionError('ACP connect aborted', { cause: error });
      }
      throw error;
    }
    if (this.closedFlag) {
      dialed.connection.close(new CodingAgentAcpConnectionError('ACP client closed'));
      throw new CodingAgentAcpConnectionError('ACP connect aborted');
    }
    const { connection, initializeResponse } = dialed;
    this.connection = connection;
    this.initializeResponseValue = initializeResponse;
    this.negotiatedVersionValue = 2;
    this.failures = 0;
    this.resolveConnectedWaiters();
  }

  /**
   * The frontend speaks exactly one profile: schema v2 (`protocolVersion: 2`).
   * There is no v1 opt-in; an agent answering another version is closed as a
   * version mismatch (see `dialAndInitialize`) instead of negotiating down.
   */
  private initializeParams(): acp2.InitializeRequest {
    return {
      protocolVersion: 2, capabilities: {}, info: { name: this.clientName, version: this.clientVersion },
    };
  }

  private wireMcpServers(servers: acp.McpServer[]): unknown[] {
    return servers.map((server) => (!('type' in server) ? { ...server, type: 'stdio' } : server));
  }

  private buildV2App(): acp2.ClientApp {
    const generation = this.generation;
    const app = acp2.client({ name: this.clientName });
    app.onRequest('session/request_permission', async (context) => {
      const request = context.params;
      if (this.options.onV2PermissionRequest) return this.options.onV2PermissionRequest(request, context.signal);
      const handler = this.permissionHandler ?? this.options.onPermissionRequest;
      if (!handler) return { outcome: { outcome: 'cancelled' as const } };
      return handler(request, context.signal);
    });
    app.onNotification('session/update', (context) => {
      if (this.closedFlag || generation !== this.generation) return;
      const notification = context.params;
      const update = notification.update;
      const observations = this.foreground.get(notification.sessionId);
      if (this.replayEpoch(notification.sessionId) === 0 && update.sessionUpdate === 'notice' && update.severity === 'error') {
        for (const pending of observations ?? []) pending.reject(new CodingAgentAcpObservationError(`ACP session error: ${update.title}: ${update.description ?? ''}`, pending.messageId));
      }
      // Replayed history streams inside a replay epoch; its state frames are
      // retained past turns (a completed turn's `running` outlives its
      // unpersisted terminal `idle`), not the live foreground. Only live
      // transitions move the admission marker and observation idle flags.
      if (this.replayEpoch(notification.sessionId) === 0) {
        if (acp2.SessionUpdate.isStateUpdate(update)) {
          this.foregroundStates.set(notification.sessionId, update.state);
          if (update.state === 'idle') for (const pending of observations ?? []) pending.idle = true;
          this.settleIdleWaiters(notification.sessionId);
        }
        this.settleForeground(notification.sessionId);
      }
      // Deliver raw v2 updates, including message snapshots, to every subscriber.
      this.options.onUpdate?.(notification);
      for (const listener of [...this.updateListeners]) {
        try {
          listener(notification);
        } catch (error) {
          console.error('ACP session/update listener threw', error);
        }
      }
    });
    return app;
  }

  private dial(onOpen: () => void): { connection: WireConnection; closeInfo: { code?: number; reason: string } } {
    const closeInfo: { code?: number; reason: string } = { reason: '' };
    const diagnostic = (event: CodingAgentAcpDiagnostic) => this.diagnostic(event);
    const WebSocketImpl = (NodeWebSocket ?? globalThis.WebSocket) as unknown as WebSocketConstructor;
    const TrackedWebSocket = class {
      constructor(
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ) {
        const socket = new WebSocketImpl(url, protocols, options) as WebSocketLike;
        trackSocketClose(socket, closeInfo);
        const onClose = () => diagnostic({ stage: 'transport', phase: 'closed', timestamp: Date.now(),
          code: closeInfo.code ?? null, reasonPresent: closeInfo.reason.length > 0 });
        if (typeof socket.on === 'function') {
          socket.on('open', onOpen);
          socket.on('close', onClose);
        } else {
          socket.addEventListener?.('open', onOpen);
          socket.addEventListener?.('close', onClose);
        }
        return socket;
      }
    } as unknown as WebSocketConstructor;
    const headers = this.target.token ? { Authorization: `Bearer ${this.target.token}` } : undefined;
    const stream = createWebSocketStream(this.target.url, {
      WebSocket: TrackedWebSocket,
      headers,
      cookieStore: this.cookieStore,
    });
    const connection: WireConnection = this.buildV2App().connect(stream);
    void connection.closed.then(() => this.onConnectionClosed(connection, closeInfo));
    return { connection, closeInfo };
  }

  /**
   * The connection is not published to `this.connection` until `initialize`
   * succeeds, so a close racing the handshake never triggers the reconnect
   * loop mid-connect — the caller decides (initial connect rejects; reconnect
   * attempts consume backoff budget).
   */
  private async dialAndInitialize(): Promise<{
    connection: WireConnection;
    initializeResponse: AcpV2InitializeResponse;
  }> {
    const finishConnect = this.beginDiagnostic('connect');
    let finishInitialize: ((error?: unknown) => void) | undefined;
    let dialed: ReturnType<CodingAgentAcpClient['dial']>;
    try {
      dialed = this.dial(() => {
        finishConnect();
        finishInitialize = this.beginDiagnostic('initialize');
      });
    } catch (error) {
      finishConnect(error);
      throw error;
    }
    const { connection, closeInfo } = dialed;
    // Own the pending dial without publishing it as a usable connection.
    // Explicit close, pool release and the caller's abort all cancel it.
    this.pendingConnection = connection;
    if (this.closedFlag || this.options.signal?.aborted) {
      connection.close(new CodingAgentAcpConnectionError('ACP connect aborted'));
    }
    try {
      // The v2 runtime rejects any initialize answer whose protocolVersion is
      // not 2 before this promise resolves, closing the connection on the
      // version mismatch — there is nothing further to negotiate.
      const initializeResponse = await connection.agent.request<AcpV2InitializeResponse>(
        acp.methods.agent.initialize,
        this.initializeParams(),
      );
      finishInitialize?.();
      return { connection, initializeResponse };
    } catch (error) {
      (finishInitialize ?? finishConnect)(error);
      if (error instanceof CodingAgentAcpConnectionError) throw error;
      connection.close(error instanceof Error ? error : undefined);
      const code = closeInfo.code ?? null;
      this.lastCloseCode = code;
      throw new CodingAgentAcpConnectionError(
        `ACP initialize failed${code !== null ? ` (bridge closed with code ${code})` : ''}`,
        { code, cause: error },
      );
    } finally {
      if (this.pendingConnection === connection) this.pendingConnection = null;
    }
  }

  private onConnectionClosed(
    connection: WireConnection,
    closeInfo: { code?: number; reason: string },
  ): void {
    if (this.closedFlag || connection !== this.connection) return;
    this.connection = null;
    this.generation += 1;
    this.foregroundStates.clear();
    this.replayEpochs.clear();
    const code = closeInfo.code ?? 1006;
    const error = new CodingAgentAcpConnectionError('Connection lost during foreground work; input is not retried', { code });
    for (const observations of this.foreground.values()) for (const pending of observations) pending.reject(error);
    this.foreground.clear();
    this.failIdleWaiters(error);
    const reason = closeInfo.reason ?? '';
    this.lastCloseCode = code;
    if (ACP_TERMINAL_CLOSE_CODES.has(code)) {
      this.terminate(
        new CodingAgentAcpConnectionError(
          `ACP bridge rejected the connection with terminal code ${code}${reason ? `: ${reason}` : ''}`,
          { code },
        ),
        code,
        reason,
      );
      return;
    }
    this.scheduleReconnect(code, reason);
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (this.closedFlag) return;
    if (this.failures >= ACP_RECONNECT_DELAYS_MS.length) {
      this.terminate(
        new CodingAgentAcpConnectionError(
          `ACP reconnect budget exhausted after ${ACP_RECONNECT_DELAYS_MS.length} attempts`,
          { code },
        ),
        code,
        reason,
      );
      return;
    }
    const delay = ACP_RECONNECT_DELAYS_MS[this.failures];
    this.failures += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.closedFlag) return;
    const generation = ++this.generation;
    let connection: WireConnection;
    let initializeResponse: AcpV2InitializeResponse;
    try {
      ({ connection, initializeResponse } = await this.dialAndInitialize());
    } catch {
      if (this.closedFlag || generation !== this.generation) return;
      this.scheduleReconnect(this.lastCloseCode ?? 1006, 'reconnect attempt failed');
      return;
    }
    if (this.closedFlag || generation !== this.generation) {
      connection.close(new CodingAgentAcpConnectionError('ACP client closed'));
      return;
    }
    this.connection = connection;
    this.initializeResponseValue = initializeResponse;
    this.negotiatedVersionValue = 2;
    this.failures = 0;
    this.resolveConnectedWaiters();
    await this.replaySessions(connection, generation);
  }

  /**
   * Reattach every tracked session after a reconnect: v2 resumes with
   * `replayFrom: { type: 'start' }`. A session that cannot be replayed is dropped with a soft
   * {@link CodingAgentAcpReplayGapError} and the connection stays alive.
   */
  private async replaySessions(connection: WireConnection, generation: number): Promise<void> {
    for (const [sessionId, tracked] of [...this.sessions]) {
      if (this.closedFlag || generation !== this.generation || connection !== this.connection) return;
      let epoch: number | undefined;
      try {
        const replay = this.performResumeReplay(connection.agent, sessionId, tracked.cwd, tracked.mcpServers, (raw) => {
          if (this.closedFlag || generation !== this.generation || connection !== this.connection) return;
          tracked.configOptions = raw?.configOptions ?? null;
        });
        epoch = this.replayEpochs.get(sessionId)?.epoch;
        await replay;
      } catch (error) {
        if (this.closedFlag || generation !== this.generation || connection !== this.connection) return;
        if (epoch !== this.replayEpochs.get(sessionId)?.epoch) continue;
        this.sessions.delete(sessionId);
        this.softError(new CodingAgentAcpReplayGapError(
          sessionId,
          error instanceof Error ? error.message : 'session replay rejected',
          { cause: error },
        ));
      }
    }
  }

  private terminate(error: CodingAgentAcpConnectionError, code: number, reason: string): void {
    this.terminalError = error;
    const listeners = [...this.closeListeners];
    this.close();
    this.options.onClose?.({ code, reason });
    for (const listener of listeners) {
      try {
        listener({ code, reason });
      } catch (listenerError) {
        console.error('ACP close listener threw', listenerError);
      }
    }
  }

  /**
   * Each resume has an ownership epoch, including resumes without history.
   * A history-replaying round-trip also emits a bracket: `start` fires before the request goes on the
   * wire (ahead of every replayed history notification), `end` fires once the
   * response settles (after the full history has streamed, per the protocol's
   * replay contract).
   */
  private async performReplayBracket<T>(sessionId: string, run: () => Promise<T>, apply?: (response: T) => void, replaying = true): Promise<T> {
    const generation = this.generation;
    // ACP does not tag history notifications with their resume request. A
    // no-history resume must not reclassify an older replay's idle as live.
    while (!replaying && this.historyReplays.has(sessionId)) {
      await Promise.all(this.historyReplays.get(sessionId)!);
      if (this.closedFlag || generation !== this.generation) {
        throw new CodingAgentAcpConnectionError('Connection lost while waiting for session replay');
      }
    }
    let finishHistory: (() => void) | undefined;
    let history: Promise<void> | undefined;
    if (replaying) {
      history = new Promise<void>(resolve => { finishHistory = resolve; });
      const active = this.historyReplays.get(sessionId) ?? new Set<Promise<void>>();
      active.add(history);
      this.historyReplays.set(sessionId, active);
    }
    const epoch = this.beginReplay(sessionId, replaying);
    try {
      const response = await run();
      if (this.replayEpochs.get(sessionId)?.epoch === epoch) apply?.(response);
      this.endReplay(sessionId, epoch, true, replaying);
      return response;
    } catch (error) {
      this.endReplay(sessionId, epoch, false, replaying);
      throw error;
    } finally {
      if (history) {
        const active = this.historyReplays.get(sessionId);
        active?.delete(history);
        if (active?.size === 0) this.historyReplays.delete(sessionId);
        finishHistory!();
      }
    }
  }

  private performResumeReplay(
    context: WireContext,
    sessionId: string,
    cwd: string,
    mcpServers: acp.McpServer[],
    apply: (response: acp2.ResumeSessionResponse) => void,
  ): Promise<acp2.ResumeSessionResponse> {
    return this.performReplayBracket(sessionId, () =>
      context.request<acp2.ResumeSessionResponse>(acp.methods.agent.session.resume, {
        sessionId,
        cwd,
        mcpServers: this.wireMcpServers(mcpServers),
        replayFrom: { type: 'start' },
      }), apply);
  }

  private beginReplay(sessionId: string, replaying: boolean): number {
    const state = this.replayEpochs.get(sessionId) ?? { epoch: 0, active: new Set<number>(), replaying, status: 'pending' as const };
    state.epoch = ++this.nextReplayEpoch;
    state.replaying = replaying;
    state.status = 'pending';
    state.active.add(state.epoch);
    this.replayEpochs.set(sessionId, state);
    this.foregroundStates.delete(sessionId);
    for (const pending of this.foreground.get(sessionId) ?? []) pending.idle = false;
    if (replaying) this.emitReplay({ sessionId, phase: 'start', epoch: state.epoch });
    return state.epoch;
  }

  private endReplay(sessionId: string, epoch: number, ok: boolean, replaying: boolean): void {
    const state = this.replayEpochs.get(sessionId);
    if (!state?.active.delete(epoch)) return;
    if (state.epoch === epoch) {
      state.status = ok ? 'succeeded' : 'failed';
      if (!ok) {
        const waiters = this.idleWaiters.get(sessionId);
        this.idleWaiters.delete(sessionId);
        for (const waiter of waiters ?? []) waiter.reject(new CodingAgentAcpConnectionError('Session foreground state is unknown after failed resume'));
      }
      for (const pending of this.foreground.get(sessionId) ?? []) pending.reconcile = true;
      this.settleForeground(sessionId);
      // A no-history resume can announce live idle before its response. The
      // pending ownership gate blocked settlement then; reconsider it now.
      // Historical state frames never populate foregroundStates.
      if (ok && this.foregroundStates.get(sessionId) === 'idle') this.settleIdleWaiters(sessionId);
    }
    if (replaying) this.emitReplay({ sessionId, phase: 'end', epoch, ok });
  }

  private emitReplay(event: CodingAgentAcpReplayEvent): void {
    for (const listener of [...this.replayListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('ACP replay listener threw', error);
      }
    }
  }

  private softError(error: Error): void {
    for (const listener of [this.options.onError, ...this.errorListeners]) {
      try { listener?.(error); } catch (listenerError) {
        console.error('ACP error listener threw', listenerError);
      }
    }
  }

  private requireConnection(): WireConnection {
    const connection = this.connection;
    if (!connection || this.closedFlag) {
      throw (
        this.terminalError
        ?? new CodingAgentAcpConnectionError(
          this.closedFlag ? 'ACP client is closed' : 'ACP connection is down while reconnecting',
          { code: this.lastCloseCode },
        )
      );
    }
    return connection;
  }

  private requireContext(): WireContext {
    return this.requireConnection().agent;
  }

  private resolveConnectedWaiters(): void {
    for (const waiter of [...this.connectedWaiters]) {
      this.connectedWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  private rejectConnectedWaiters(error: Error): void {
    for (const waiter of [...this.connectedWaiters]) {
      this.connectedWaiters.delete(waiter);
      waiter.reject(error);
    }
  }
}
