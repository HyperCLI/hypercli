/**
 * ACP (Agent Client Protocol) client connectivity for coding agents.
 *
 * Every hosted coding-agent pod runs `hyper-acp`, which bridges the pod-side
 * ACP child (`opencode acp`, `claude-code acp`, ...) onto an outbound
 * WebSocket to the backend bridge at `/ws`. This module dials that bridge as
 * the client side (`?agent_id=<uuid>&token=<api key>`), runs the ACP
 * `initialize` handshake, and exposes typed session helpers plus a raw
 * JSON-RPC escape hatch.
 *
 * The default frontend profile is schema-v2.0.0-alpha.5 using the actual
 * upstream experimental/v2 SDK runtime. An explicit protocolVersion: 1 selects
 * the separate stable runtime. A connection never parses one version through
 * the other's handlers. The backend independently negotiates its runtime legs.
 * submitPrompt returns the v2 inserted messageId; prompt is a convenience that
 * additionally waits for the session's foreground idle transition. Neither
 * helper retries input after uncertain delivery.
 * On v2 there is no `session/load` — reattach and history replay go through
 * `session/resume` with a `replayFrom` cursor instead.
 *
 * Reconnect mirrors the ACP reattach contract used by the bridge: the runtime
 * side is long-lived, the client re-dials, re-initializes (re-negotiating),
 * and replays each known session (`session/load` on v1, `session/resume` with
 * `replayFrom: { type: 'start' }` on v2). In-flight prompt turns are never
 * retried mid-turn; replay failures surface as soft
 * {@link CodingAgentAcpReplayGapError}s while the connection stays alive.
 */
import NodeWebSocket from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import * as acp2 from '@agentclientprotocol/sdk/experimental/v2';
import type {
  InitializeResponse as AcpV2InitializeResponse,
  ReplayFrom as AcpReplayFrom,
} from '@agentclientprotocol/sdk/experimental/v2';
import {
  createWebSocketStream,
  MemoryAcpCookieStore,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@agentclientprotocol/sdk/experimental/ws-client';

export type { ContentBlock, RequestPermissionRequest, SessionNotification } from '@agentclientprotocol/sdk';
export type { AcpReplayFrom };

/** ACP major protocol versions this client can negotiate. */
export type CodingAgentAcpProtocolVersion = 1 | 2;

/** Observed foreground stop, not a per-message execution receipt. */
export interface CodingAgentAcpPromptResult {
  messageId?: string;
  stopReason?: string | null;
  _meta?: Record<string, unknown> | null;
}

interface ForegroundObservation {
  running: boolean;
  inputs: Set<string>;
  messageId?: string;
  idle?: CodingAgentAcpPromptResult;
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

/**
 * Vendor turn-lifecycle frames from sessions/README §4. The deployed
 * hyper-acp is a pure passthrough and emits NONE of these — the registrations
 * and the `onTurnEvent` listener are forward-compat for pods that may emit
 * them later (frames are confirmation-only there; the `session/prompt`
 * response remains the turn-end evidence). `turnId` is the JSON-RPC request
 * id of the `session/prompt` the turn belongs to. All frames are
 * notifications. `_hypercli.dev/turn_ended_ack` was dropped from the wire
 * contract: no pod-side retention, no acks.
 */
export const ACP_TURN_STARTED_METHOD = '_hypercli.dev/turn_started';
export const ACP_TURN_ENDED_METHOD = '_hypercli.dev/turn_ended';

// USER READ RECEIPTS ARE BACKEND-OWNED (2026-09-27): the REST history read
// advances the caller's participant cursor — there is NO client→proxy
// read-ack frame, and this client emits none. (Earlier versions sent a
// `_hypercli.dev/session_read_ack` request and treated its response as a
// durability ack: the proxy never handled that frame — it leg-passthrough'd
// it to the pod, which moved no cursor, so the "confirmed" receipt was a
// silent no-op lie. The proxy now pins the retired frame at dispatch.)
// The proxy's `_meta["hypercli.dev"].seq` tee annotation is GONE (removed
// 2026-09-29): the proxy tee is 100% vanilla ACP (owner ruling, final
// 2026-09-28), so teed frames arrive unannotated and delivery gaps are
// recovered with a keyset re-read over the REST history endpoint.

/** JSON-RPC request id of a `session/prompt`, used to key a turn. */
export type CodingAgentAcpTurnId = string | number;

export interface CodingAgentAcpTurnStartedEvent {
  kind: 'turn_started';
  sessionId: string;
  turnId: CodingAgentAcpTurnId;
}

export interface CodingAgentAcpTurnEndedEvent {
  kind: 'turn_ended';
  sessionId: string;
  turnId: CodingAgentAcpTurnId;
  stopReason: string;
  partial?: boolean;
}

export type CodingAgentAcpTurnEvent = CodingAgentAcpTurnStartedEvent | CodingAgentAcpTurnEndedEvent;

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

/**
 * Soft error delivered via `onError` when a session cannot be replayed after
 * a reconnect (`session/load` rejected, or the child stopped advertising
 * `loadSession`). The connection stays alive; the session is dropped from
 * the replay set and its pre-reconnect state may be lost.
 */
/**
 * Replay-boundary signal for `session/load` history replays. ACP v1 streams
 * the session's entire history as ordinary `session/update` notifications
 * before the load response resolves, with no replay marker on the wire — a
 * consumer folding updates into an existing transcript cannot otherwise tell
 * replayed history from live traffic and duplicates it. `start` fires before
 * the load request is sent (so it precedes every replayed notification of
 * that load); `end` fires after the load response settles, which per the
 * protocol is after the full history has been streamed. Overlapping loads
 * for one session increment `epoch` — the newest load owns the transcript
 * ("latest wins"); a stale `end` is identifiable by its older epoch.
 */
export interface CodingAgentAcpReplayEvent {
  sessionId: string;
  phase: 'start' | 'end';
  epoch: number;
  /** `end` only: whether the load resolved. */
  ok?: boolean;
}

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

export interface CodingAgentAcpConnectOptions {
  /** Abort before connect rejects the promise; abort after connect closes the client. */
  signal?: AbortSignal;
  /**
   * Pre-minted `/ws/acp` credential. Defaults to the client API key; pass
   * the `token` from `Deployments.mintAcpWsToken(agentId)` to dial with the
   * short-lived, agent-scoped ticket instead of the raw account credential.
   */
  token?: string;
  /** Session working directory; defaults to the agent workspace root. */
  cwd?: string;
  /** Override the `clientInfo` sent with `initialize`. */
  clientInfo?: { name?: string; version?: string };
  /**
   * Concrete frontend protocol profile. Defaults to v2 alpha.5. Explicitly
   * choose 1 for a v1 endpoint; this client does not silently downgrade the
   * frontend or mix handlers after initialize.
   */
  protocolVersion?: CodingAgentAcpProtocolVersion;
  /** MCP servers attached to every session created or replayed by this client. */
  mcpServers?: acp.McpServer[];
  /**
   * Which backend socket `CodingAgent.acpConnect` dials; see
   * {@link CodingAgentAcpTransport}. Defaults to `'proxy'`. `'direct'` is an
   * infra/debug-only escape hatch to the agent-keyed `/ws` bridge.
   */
  transport?: CodingAgentAcpTransport;
  /**
   * Proxy transport only: the backend session id to attach at dial time
   * (create-or-attach semantics — no `sessionId` means the socket starts
   * session-less and `newSession()` mints one through the proxy; a provided
   * id dials `/ws/acp?agent_id&token&session_id=…`, joining the session's live
   * tee before any replay call so a following `loadSession`/`resumeSession`
   * history stream actually reaches this connection). An id the store does
   * not hold closes the socket with
   * {@link ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE} (4404). Combining it with
   * `transport: 'direct'` throws — the `/ws` bridge has no session binding.
   */
  sessionId?: string;
  /** Proxy creation provenance, carried in the WS query (not ACP). Applies only
   * to newly created sessions on this connection; attaching never changes it. */
  source?: string | null;
  /** Receives every `session/update` notification. */
  onUpdate?: (notification: acp.SessionNotification) => void;
  /**
   * Permission handler. When omitted, every `session/request_permission`
   * request is answered with the `cancelled` outcome — a raw SDK never
   * auto-approves.
   */
  onPermissionRequest?: (
    params: acp.RequestPermissionRequest,
  ) => acp.MaybePromise<acp.RequestPermissionResponse>;
  /** Full standard v2 permission surface, including command and absent subjects. */
  onV2PermissionRequest?: (params: acp2.RequestPermissionRequest) => acp2.MaybePromise<acp2.RequestPermissionResponse>;
  /** Opt-in `fs/read_text_file` handler; unhandled by default (method-not-found). */
  onReadTextFile?: (
    params: acp.ReadTextFileRequest,
  ) => acp.MaybePromise<acp.ReadTextFileResponse>;
  /** Opt-in `fs/write_text_file` handler; unhandled by default (method-not-found). */
  onWriteTextFile?: (
    params: acp.WriteTextFileRequest,
  ) => acp.MaybePromise<acp.WriteTextFileResponse | void>;
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
  modes: acp.SessionModeState | null;
  configOptions: acp.SessionConfigOption[] | null;
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
  private readonly cwd: string;
  private readonly mcpServers: acp.McpServer[];
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly cookieStore = new MemoryAcpCookieStore();
  private readonly offeredProtocolVersion: CodingAgentAcpProtocolVersion;
  private connection: WireConnection | null = null;
  private readonly foreground = new Map<string, ForegroundObservation>();
  private readonly foregroundStates = new Map<string, string>();
  private initializeResponseValue: acp.InitializeResponse | AcpV2InitializeResponse | null = null;
  private negotiatedVersionValue: CodingAgentAcpProtocolVersion | null = null;
  private readonly sessions = new Map<string, TrackedAcpSession>();
  private readonly connectedWaiters = new Set<Deferred>();
  private readonly updateListeners = new Set<(notification: acp.SessionNotification) => void>();
  private readonly turnListeners = new Set<(event: CodingAgentAcpTurnEvent) => void>();
  private readonly replayListeners = new Set<(event: CodingAgentAcpReplayEvent) => void>();
  /** In-memory only: sessionId → latest epoch + in-flight load count. */
  private readonly replayEpochs = new Map<string, { epoch: number; inFlight: number }>();
  private readonly closeListeners = new Set<(event: { code: number; reason: string }) => void>();
  private permissionHandler: ((request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>) | null = null;
  private closedFlag = false;
  private terminalError: CodingAgentAcpConnectionError | null = null;
  private lastCloseCode: number | null = null;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly onAbort: () => void;

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
    this.cwd = options.cwd ?? '/home/node';
    this.mcpServers = options.mcpServers ?? [];
    this.clientName = options.clientInfo?.name ?? 'hypercli-ts-sdk';
    this.clientVersion = options.clientInfo?.version ?? '';
    this.offeredProtocolVersion = options.protocolVersion ?? 2;
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
   * Latest `initialize` response; refreshed on every (re)connect. The shape
   * follows the negotiated version: v1 responses carry
   * `agentCapabilities`/`agentInfo`, v2 responses carry
   * `capabilities`/`info`.
   */
  get initializeResponse(): acp.InitializeResponse | AcpV2InitializeResponse | null {
    return this.initializeResponseValue;
  }

  /** Session IDs this client created or loaded, in creation order. */
  get sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Register a listener for every `session/update` notification. Listeners
   * fire in addition to the legacy single `options.onUpdate` callback, which
   * makes one shared connection usable by multiple subscribers (chat, session
   * sweep, ...). Returns an unsubscribe function; a throwing listener is
   * logged and does not break the others. `close()` clears all listeners.
   */
  addUpdateListener(listener: (notification: acp.SessionNotification) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  /**
   * Register a listener for the vendor turn-lifecycle frames
   * (`_hypercli.dev/turn_started` / `_hypercli.dev/turn_ended`) emitted by
   * the pod-side hyper-acp. Frames for sessions other than the caller's are
   * included; listeners key off `sessionId`/`turnId`. Returns an unsubscribe
   * function; a throwing listener is logged and does not break the others.
   * `close()` clears all listeners.
   */
  onTurnEvent(listener: (event: CodingAgentAcpTurnEvent) => void): () => void {
    this.turnListeners.add(listener);
    return () => {
      this.turnListeners.delete(listener);
    };
  }

  /**
   * Register a listener for replay-boundary events (see
   * {@link CodingAgentAcpReplayEvent}). Fires for both explicit `loadSession`
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

  /**
   * The current replay epoch for a session: 0 when no `session/load` is in
   * flight for it, otherwise the epoch of the newest in-flight load.
   */
  replayEpoch(sessionId: string): number {
    const state = this.replayEpochs.get(sessionId);
    return state && state.inFlight > 0 ? state.epoch : 0;
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
    handler: ((request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>) | null,
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

  async newSession(options: { cwd?: string; mcpServers?: acp.McpServer[] } = {}): Promise<acp.NewSessionResponse> {
    if ('systemPrompt' in options || 'title' in options) {
      throw new CodingAgentAcpUnavailableError('session/new', 'system instructions use native configuration; titles use platform REST');
    }
    const context = this.requireContext();
    const cwd = options.cwd ?? this.cwd;
    const mcpServers = options.mcpServers ?? this.mcpServers;
    const response = this.localSessionState(await context.request<acp.NewSessionResponse>(acp.methods.agent.session.new, {
      cwd,
      mcpServers: this.wireMcpServers(mcpServers),
    }));
    this.sessions.set(response.sessionId, {
      cwd,
      mcpServers,
      modes: response.modes ?? null,
      configOptions: response.configOptions ?? null,
      title: null,
    });
    return response;
  }

  async listSessions(options: { cwd?: string | null; cursor?: string | null } = {}): Promise<acp.ListSessionsResponse> {
    const context = this.requireContext();
    this.requireSessionCapability('session/list', 'list');
    return context.request(acp.methods.agent.session.list, {
      cwd: options.cwd ?? null,
      cursor: options.cursor ?? null,
    });
  }

  /**
   * Reattach a session with full history replay (`session/load`). v1 only:
   * ACP v2 removed `session/load` — on a v2-negotiated connection callers use
   * {@link resumeSession} with a `replayFrom` cursor instead.
   */
  async loadSession(sessionId: string): Promise<acp.LoadSessionResponse> {
    const context = this.requireContext();
    if (this.negotiatedVersionValue === 2) {
      throw new CodingAgentAcpUnavailableError(
        'session/load',
        'the connection negotiated ACP v2, which removed session/load; use resumeSession(sessionId, { replayFrom: { type: \'start\' } }) to reattach with history replay',
      );
    }
    if (!this.v1Capabilities().load) {
      throw new CodingAgentAcpUnavailableError(
        'session/load',
        'the agent did not advertise agentCapabilities.loadSession in its initialize response',
      );
    }
    const previous = this.sessions.get(sessionId);
    const cwd = previous?.cwd ?? this.cwd;
    const mcpServers = previous?.mcpServers ?? this.mcpServers;
    const response = await this.performLoad(context, sessionId, cwd, mcpServers);
    this.sessions.set(sessionId, {
      cwd,
      mcpServers,
      modes: response?.modes ?? null,
      configOptions: response?.configOptions ?? null,
      title: previous?.title ?? null,
    });
    return response;
  }

  /**
   * Restore a session's context (`session/resume`). Without `replayFrom` no
   * history is replayed. On a v2-negotiated connection `replayFrom` requests
   * retained history (`{ type: 'start' }` replays everything) — this is the
   * v2 replacement for the removed `session/load`; replayed history streams
   * as `session/update` notifications before the resume response resolves, so
   * the call runs inside a replay-epoch bracket exactly like a v1 load. On v1
   * `replayFrom` is unsupported (loadSession replays history there).
   */
  async resumeSession(
    sessionId: string,
    options: { replayFrom?: AcpReplayFrom | null } = {},
  ): Promise<acp.ResumeSessionResponse> {
    const context = this.requireContext();
    this.requireSessionCapability('session/resume', 'resume');
    if (options.replayFrom !== undefined && options.replayFrom !== null && this.negotiatedVersionValue !== 2) {
      throw new CodingAgentAcpUnavailableError(
        'session/resume',
        'replayFrom is an ACP v2 parameter; the connection negotiated v1 — use loadSession for history replay',
      );
    }
    const previous = this.sessions.get(sessionId);
    const params: Record<string, unknown> = {
      sessionId,
      cwd: previous?.cwd ?? this.cwd,
      mcpServers: this.wireMcpServers(previous?.mcpServers ?? this.mcpServers),
    };
    if (options.replayFrom !== undefined) params.replayFrom = options.replayFrom;
    const requestResume = () => context.request<acp.ResumeSessionResponse>(acp.methods.agent.session.resume, params);
    // A replaying resume streams history before its response resolves (the
    // same boundary problem as v1 session/load), so it gets an epoch bracket.
    const replaying = options.replayFrom !== undefined && options.replayFrom !== null;
    const response = this.localSessionState(replaying
      ? await this.performReplayBracket(sessionId, requestResume)
      : await requestResume());
    this.sessions.set(sessionId, {
      cwd: previous?.cwd ?? this.cwd,
      mcpServers: previous?.mcpServers ?? this.mcpServers,
      modes: response?.modes ?? null,
      configOptions: response?.configOptions ?? null,
      title: previous?.title ?? null,
    });
    return response;
  }

  /** Cancel ongoing work and free the session's resources (`session/close`). */
  async closeSession(sessionId: string): Promise<void> {
    const context = this.requireContext();
    this.requireSessionCapability('session/close', 'close');
    await context.request(acp.methods.agent.session.close, { sessionId });
    this.sessions.delete(sessionId);
  }

  /** Permanently delete a session (`session/delete`). */
  async deleteSession(sessionId: string): Promise<void> {
    const context = this.requireContext();
    this.requireSessionCapability('session/delete', 'delete');
    await context.request(acp.methods.agent.session.delete, { sessionId });
    this.sessions.delete(sessionId);
  }

  /** Unstable: fork a session into a new session ID (`session/fork`). */
  async unstableForkSession(sessionId: string): Promise<acp.ForkSessionResponse> {
    const context = this.requireContext();
    this.requireSessionCapability('session/fork', 'fork');
    const previous = this.sessions.get(sessionId);
    const response = await context.request<acp.ForkSessionResponse>(acp.methods.agent.session.fork, {
      sessionId,
      cwd: previous?.cwd ?? this.cwd,
      mcpServers: previous?.mcpServers ?? this.mcpServers,
    });
    this.sessions.set(response.sessionId, {
      cwd: previous?.cwd ?? this.cwd,
      mcpServers: previous?.mcpServers ?? this.mcpServers,
      modes: response.modes ?? previous?.modes ?? null,
      configOptions: response.configOptions ?? previous?.configOptions ?? null,
      title: previous?.title ?? null,
    });
    return response;
  }

  /**
   * Run one prompt turn. Strings become a single text block. Streams
   * `session/update` notifications to `onUpdate`. Resolves with the full
   * response (stop reason, usage); if the socket dies mid-turn the promise
   * rejects with {@link CodingAgentAcpConnectionError} and the turn is NOT
   * retried.
   */
  async prompt(
    sessionId: string,
    prompt: string | acp.ContentBlock | acp.ContentBlock[],
  ): Promise<CodingAgentAcpPromptResult> {
    const connection = this.requireConnection();
    const blocks: acp.ContentBlock[] = typeof prompt === 'string'
      ? [{ type: 'text', text: prompt }]
      : Array.isArray(prompt)
        ? prompt
        : [prompt];
    if (this.negotiatedVersionValue === 2) {
      if (this.foreground.has(sessionId) || ['running', 'requires_action'].includes(this.foregroundStates.get(sessionId) ?? '')) {
        throw new Error('Session foreground is active; use submitPrompt for concurrent admission');
      }
      let resolve!: (result: CodingAgentAcpPromptResult) => void;
      let reject!: (error: Error) => void;
      const completed = new Promise<CodingAgentAcpPromptResult>((res, rej) => { resolve = res; reject = rej; });
      // Both lanes can arrive before acceptance; register first.
      const pending: ForegroundObservation = { running: false, inputs: new Set<string>(), resolve, reject };
      this.foreground.set(sessionId, pending);
      void completed.catch(() => {});
      try {
        const acceptance = this.requireContext().request<acp2.PromptResponse>('session/prompt', { sessionId, prompt: blocks });
        return await Promise.race([completed, acceptance.then(async (accepted) => {
          pending.messageId = accepted.messageId;
          this.settleForeground(sessionId);
          return completed;
        })]);
      } finally {
        this.foreground.delete(sessionId);
      }
    }
    try {
      return await connection.agent.request<acp.PromptResponse>(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: blocks,
      });
    } catch (error) {
      if (this.connection !== connection || connection.signal.aborted) {
        throw new CodingAgentAcpConnectionError(
          'ACP connection lost mid-prompt; the turn did not complete and is not retried',
          { code: this.lastCloseCode, cause: error },
        );
      }
      throw error;
    }
  }

  /** V2 insertion acknowledgement, not foreground completion. */
  async submitPrompt(sessionId: string, prompt: acp.ContentBlock[]): Promise<acp2.PromptResponse> {
    if (this.negotiatedVersionValue !== 2) throw new CodingAgentAcpUnavailableError('session/prompt', 'insertion acknowledgements require v2');
    if (this.foreground.has(sessionId)) throw new Error('Cannot mix submitPrompt with an isolated prompt observation');
    return this.requireContext().request<acp2.PromptResponse>('session/prompt', { sessionId, prompt });
  }

  private settleForeground(sessionId: string): void {
    const pending = this.foreground.get(sessionId);
    if (!pending?.messageId) return;
    if ([...pending.inputs].some((id) => id !== pending.messageId)) {
      pending.reject(new Error('Concurrent admission prevents isolated foreground observation; use submitPrompt and session updates'));
    } else if (pending.idle && pending.inputs.has(pending.messageId)) {
      pending.resolve({ ...pending.idle, messageId: pending.messageId });
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.requireContext().notify(acp.methods.agent.session.cancel, { sessionId });
  }

  /** `session/set_mode`; ungated — agents may accept modes outside the tracked state. */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const context = this.requireContext();
    if (this.negotiatedVersionValue === 2) {
      const option = this.sessions.get(sessionId)?.configOptions?.find((entry) => entry.category === 'mode');
      if (!option) throw new CodingAgentAcpUnavailableError('session/set_config_option', 'no mode option advertised');
      await this.setConfigOption(sessionId, option.id, modeId);
    } else {
      await context.request(acp.methods.agent.session.setMode, { sessionId, modeId });
    }
    const tracked = this.sessions.get(sessionId);
    if (tracked?.modes) tracked.modes = { ...tracked.modes, currentModeId: modeId };
  }

  /** Generic `session/set_config_option`; setModel delegates here. */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | { value: boolean; type: 'boolean' },
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const context = this.requireContext();
    const payload =
      typeof value === 'string'
        ? { sessionId, configId, value }
        : { sessionId, configId, value: value.value, type: value.type };
    const response = this.localSessionState(await context.request<acp.SetSessionConfigOptionResponse>(
      acp.methods.agent.session.setConfigOption,
      payload,
    ));
    const tracked = this.sessions.get(sessionId);
    if (tracked) tracked.configOptions = response.configOptions ?? tracked.configOptions;
    return response;
  }

  /** Set the session model through the `model` config option the session advertised. */
  async setModel(sessionId: string, modelId: string): Promise<acp.SetSessionConfigOptionResponse> {
    const options = this.sessions.get(sessionId)?.configOptions ?? null;
    const modelOption = options?.find(
      (option) => option.category === 'model' || option.id === 'model',
    );
    if (!modelOption) {
      throw new CodingAgentAcpUnavailableError(
        'session/set_config_option',
        `session ${sessionId} advertised no model configuration option`,
      );
    }
    return this.setConfigOption(sessionId, modelOption.id, modelId);
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

  /** Raw request escape hatch for `_hyper/*` and other extension methods. */
  request<Response = unknown>(method: string, params?: unknown): Promise<Response> {
    return this.requireContext().request<Response>(method, params);
  }

  /** Raw notification escape hatch for `_hyper/*` and other extension methods. */
  notify(method: string, params?: unknown): Promise<void> {
    return this.requireContext().notify(method, params);
  }

  close(): void {
    for (const pending of this.foreground.values()) pending.reject(new CodingAgentAcpConnectionError('ACP connection closed; delivery is unresolved'));
    this.foreground.clear();
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.updateListeners.clear();
    this.turnListeners.clear();
    this.replayListeners.clear();
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
    let dialed: {
      connection: WireConnection;
      initializeResponse: acp.InitializeResponse | AcpV2InitializeResponse;
      negotiatedVersion: CodingAgentAcpProtocolVersion;
    };
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
    const { connection, initializeResponse, negotiatedVersion } = dialed;
    this.connection = connection;
    this.initializeResponseValue = initializeResponse;
    this.negotiatedVersionValue = negotiatedVersion;
    this.failures = 0;
    this.resolveConnectedWaiters();
  }

  /**
   * Version-specific initialization; v2 has no client fs/terminal methods.
   */
  private initializeParams(): acp.InitializeRequest | acp2.InitializeRequest {
    if (this.offeredProtocolVersion === 2) return {
      protocolVersion: 2, capabilities: {}, info: { name: this.clientName, version: this.clientVersion },
    };
    return {
      protocolVersion: this.offeredProtocolVersion,
      clientCapabilities: {
        fs: {
          readTextFile: this.options.onReadTextFile !== undefined,
          writeTextFile: this.options.onWriteTextFile !== undefined,
        },
        terminal: false,
      },
      clientInfo: { name: this.clientName, version: this.clientVersion },
    } as acp.InitializeRequest;
  }

  private wireMcpServers(servers: acp.McpServer[]): unknown[] {
    return servers.map((server) => this.negotiatedVersionValue === 2 && !('type' in server)
      ? { ...server, type: 'stdio' } : server);
  }

  /** Local compatibility view only; configId remains unchanged on the wire. */
  private localSessionState<T extends { configOptions?: acp.SessionConfigOption[] | null }>(response: T): T {
    if (this.negotiatedVersionValue !== 2 || !response?.configOptions) return response;
    return { ...response, configOptions: response.configOptions.map((option) => {
      const raw = option as unknown as acp2.SessionConfigOption;
      return { ...option, id: raw.configId };
    }) };
  }

  private buildV2App(): acp2.ClientApp {
    const app = acp2.client({ name: this.clientName });
    app.onRequest('session/request_permission', async (context) => {
      const request = context.params;
      if (this.options.onV2PermissionRequest) return this.options.onV2PermissionRequest(request);
      const handler = this.permissionHandler ?? this.options.onPermissionRequest;
      if (!handler) return { outcome: { outcome: 'cancelled' as const } };
      // Local compatibility view for existing UIs. The actual request and
      // response remain v2, including command and subject-less approvals.
      const subject = request.subject;
      if (!request.options.every((option) => ['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind))) {
        return { outcome: { outcome: 'cancelled' as const } };
      }
      return handler({ sessionId: request.sessionId, options: request.options as acp.PermissionOption[],
        toolCall: subject?.type === 'tool_call' ? subject.toolCall as acp.ToolCallUpdate
          : { toolCallId: '', title: request.title, rawInput: subject ?? undefined } });
    });
    app.onNotification('session/update', (context) => {
      const notification = context.params;
      const update = notification.update;
      const pending = this.foreground.get(notification.sessionId);
      if (pending && (update.sessionUpdate === 'user_message' || update.sessionUpdate === 'user_message_chunk') && typeof update.messageId === 'string') {
        pending.inputs.add(update.messageId);
      }
      if (pending && update.sessionUpdate === 'notice' && update.severity === 'error') {
        pending.reject(new Error(`ACP session error: ${update.title}: ${update.description ?? ''}`));
      }
      if (acp2.SessionUpdate.isStateUpdate(update)) {
        this.foregroundStates.set(notification.sessionId, update.state);
        if (pending && update.state === 'running') pending.running = true;
        if (pending && update.state === 'idle' && pending.running) {
          pending.idle = { ...(update.stopReason !== undefined ? { stopReason: update.stopReason as string | null } : {}),
            ...(update._meta !== undefined ? { _meta: update._meta as Record<string, unknown> | null } : {}) };
        }
      }
      this.settleForeground(notification.sessionId);
      // Existing subscribers accept structurally open session updates. Do not
      // rewrite v2 snapshots into append-only v1 chunks.
      this.options.onUpdate?.(notification as unknown as acp.SessionNotification);
      for (const listener of [...this.updateListeners]) listener(notification as unknown as acp.SessionNotification);
    });
    return app;
  }

  private buildApp(): acp.ClientApp {
    const app = acp.client({ name: this.clientName });
    app.onRequest(acp.methods.client.session.requestPermission, (context) => {
      if (this.permissionHandler) {
        return this.permissionHandler(context.params);
      }
      if (this.options.onPermissionRequest) {
        return this.options.onPermissionRequest(context.params);
      }
      return { outcome: { outcome: 'cancelled' as const } };
    });
    app.onNotification(acp.methods.client.session.update, (context) => {
      this.options.onUpdate?.(context.params);
      for (const listener of [...this.updateListeners]) {
        try {
          listener(context.params);
        } catch (error) {
          console.error('ACP session/update listener threw', error);
        }
      }
    });
    // Vendor turn frames use the params-parser overload with an identity
    // parser: they are hyper-acp extensions the generated ACP schemas do not
    // know. Malformed frames are dropped rather than thrown into the
    // connection's notification pipeline.
    app.onNotification(ACP_TURN_STARTED_METHOD, (params: unknown) => params, (context) => {
      const params = context.params as { sessionId?: unknown; turnId?: unknown } | null;
      if (
        typeof params?.sessionId !== 'string'
        || (typeof params.turnId !== 'string' && typeof params.turnId !== 'number')
      ) {
        return;
      }
      this.emitTurnEvent({ kind: 'turn_started', sessionId: params.sessionId, turnId: params.turnId });
    });
    app.onNotification(ACP_TURN_ENDED_METHOD, (params: unknown) => params, (context) => {
      const params = context.params as {
        sessionId?: unknown;
        turnId?: unknown;
        stopReason?: unknown;
        partial?: unknown;
      } | null;
      if (
        typeof params?.sessionId !== 'string'
        || (typeof params.turnId !== 'string' && typeof params.turnId !== 'number')
      ) {
        return;
      }
      this.emitTurnEvent({
        kind: 'turn_ended',
        sessionId: params.sessionId,
        turnId: params.turnId,
        stopReason: typeof params.stopReason === 'string' ? params.stopReason : 'unknown',
        partial: params.partial === true ? true : undefined,
      });
    });
    if (this.options.onReadTextFile) {
      const handler = this.options.onReadTextFile;
      app.onRequest(acp.methods.client.fs.readTextFile, (context) => handler(context.params));
    }
    if (this.options.onWriteTextFile) {
      const handler = this.options.onWriteTextFile;
      app.onRequest(acp.methods.client.fs.writeTextFile, (context) => handler(context.params));
    }
    return app;
  }

  private dial(): { connection: WireConnection; closeInfo: { code?: number; reason: string } } {
    const closeInfo: { code?: number; reason: string } = { reason: '' };
    const WebSocketImpl = (NodeWebSocket ?? globalThis.WebSocket) as unknown as WebSocketConstructor;
    const TrackedWebSocket = class {
      constructor(
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ) {
        const socket = new WebSocketImpl(url, protocols, options) as WebSocketLike;
        trackSocketClose(socket, closeInfo);
        return socket;
      }
    } as unknown as WebSocketConstructor;
    const headers = this.target.token ? { Authorization: `Bearer ${this.target.token}` } : undefined;
    const stream = createWebSocketStream(this.target.url, {
      WebSocket: TrackedWebSocket,
      headers,
      cookieStore: this.cookieStore,
    });
    const connection: WireConnection = this.offeredProtocolVersion === 2
      ? this.buildV2App().connect(stream)
      : this.buildApp().connect(stream);
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
    initializeResponse: acp.InitializeResponse | AcpV2InitializeResponse;
    negotiatedVersion: CodingAgentAcpProtocolVersion;
  }> {
    const { connection, closeInfo } = this.dial();
    // Until initialize finishes this.connection is deliberately unpublished.
    // close() alone therefore cannot interrupt a peer that accepts WS but
    // never answers initialize. Bind cancellation to this pending dial too.
    const abortDial = () => connection.close(new CodingAgentAcpConnectionError('ACP connect aborted'));
    this.options.signal?.addEventListener('abort', abortDial, { once: true });
    if (this.options.signal?.aborted) abortDial();
    try {
      const initializeResponse = await connection.agent.request<acp.InitializeResponse | AcpV2InitializeResponse>(
        acp.methods.agent.initialize,
        this.initializeParams(),
      );
      const answered = (initializeResponse as { protocolVersion?: unknown }).protocolVersion;
      if ((answered !== 1 && answered !== 2) || answered !== this.offeredProtocolVersion) {
        // Per the ACP version-negotiation contract the client closes a
        // connection whose answered version it does not support.
        connection.close(new CodingAgentAcpConnectionError(`unsupported ACP protocol version ${String(answered)}`));
        const code = closeInfo.code ?? null;
        this.lastCloseCode = code;
        throw new CodingAgentAcpConnectionError(
          `ACP initialize failed: the agent answered protocol version ${String(answered)}, which this client does not support (it speaks 1 and 2)`,
          { code },
        );
      }
      return { connection, initializeResponse, negotiatedVersion: answered };
    } catch (error) {
      if (error instanceof CodingAgentAcpConnectionError) throw error;
      connection.close(error instanceof Error ? error : undefined);
      const code = closeInfo.code ?? null;
      this.lastCloseCode = code;
      throw new CodingAgentAcpConnectionError(
        `ACP initialize failed${code !== null ? ` (bridge closed with code ${code})` : ''}`,
        { code, cause: error },
      );
    } finally {
      this.options.signal?.removeEventListener('abort', abortDial);
    }
  }

  private onConnectionClosed(
    connection: WireConnection,
    closeInfo: { code?: number; reason: string },
  ): void {
    if (this.closedFlag || connection !== this.connection) return;
    this.connection = null;
    const code = closeInfo.code ?? 1006;
    for (const pending of this.foreground.values()) pending.reject(new CodingAgentAcpConnectionError('Connection lost during foreground work; input is not retried', { code }));
    this.foreground.clear();
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
    let initializeResponse: acp.InitializeResponse | AcpV2InitializeResponse;
    let negotiatedVersion: CodingAgentAcpProtocolVersion;
    try {
      ({ connection, initializeResponse, negotiatedVersion } = await this.dialAndInitialize());
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
    this.negotiatedVersionValue = negotiatedVersion;
    this.failures = 0;
    this.resolveConnectedWaiters();
    await this.replaySessions(connection, generation);
  }

  /**
   * Reattach every tracked session after a reconnect, version-aware: v1
   * replays with `session/load` (gated on the `loadSession` capability), v2
   * resumes with `replayFrom: { type: 'start' }` (gated on the v2 session
   * surface — there is no `session/load` in v2). Either way a session that
   * cannot be replayed is dropped with a soft
   * {@link CodingAgentAcpReplayGapError} and the connection stays alive.
   */
  private async replaySessions(connection: WireConnection, generation: number): Promise<void> {
    const useV2Resume = this.negotiatedVersionValue === 2;
    const canReplay = useV2Resume ? this.v2SessionSurface() !== null : this.v1Capabilities().load;
    for (const [sessionId, tracked] of [...this.sessions]) {
      if (this.closedFlag || generation !== this.generation || connection !== this.connection) return;
      if (!canReplay) {
        this.sessions.delete(sessionId);
        this.softError(new CodingAgentAcpReplayGapError(
          sessionId,
          useV2Resume
            ? 'the v2 agent no longer advertises a session surface (capabilities.session)'
            : 'the agent no longer advertises agentCapabilities.loadSession',
        ));
        continue;
      }
      try {
        const response = useV2Resume
          ? await this.performResumeReplay(connection.agent, sessionId, tracked.cwd, tracked.mcpServers)
          : await this.performLoad(connection.agent, sessionId, tracked.cwd, tracked.mcpServers);
        tracked.modes = response?.modes ?? null;
        tracked.configOptions = response?.configOptions ?? null;
      } catch (error) {
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
   * One history-replaying round-trip (`session/load` on v1, `session/resume`
   * with `replayFrom` on v2) bracketed by a replay epoch: `start` fires
   * before the request goes on the wire (ahead of every replayed history
   * notification), `end` fires once the response settles (after the full
   * history has streamed, per the protocol's replay contract).
   */
  private async performReplayBracket<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const epoch = this.beginReplay(sessionId);
    try {
      const response = await run();
      this.endReplay(sessionId, epoch, true);
      return response;
    } catch (error) {
      this.endReplay(sessionId, epoch, false);
      throw error;
    }
  }

  private performLoad(
    context: WireContext,
    sessionId: string,
    cwd: string,
    mcpServers: acp.McpServer[],
  ): Promise<acp.LoadSessionResponse> {
    return this.performReplayBracket(sessionId, () =>
      context.request<acp.LoadSessionResponse>(acp.methods.agent.session.load, {
        sessionId,
        cwd,
        mcpServers,
      }));
  }

  private performResumeReplay(
    context: WireContext,
    sessionId: string,
    cwd: string,
    mcpServers: acp.McpServer[],
  ): Promise<acp.ResumeSessionResponse> {
    return this.performReplayBracket(sessionId, () =>
      context.request<acp.ResumeSessionResponse>(acp.methods.agent.session.resume, {
        sessionId,
        cwd,
        mcpServers: this.wireMcpServers(mcpServers),
        replayFrom: { type: 'start' },
      }));
  }

  private beginReplay(sessionId: string): number {
    const state = this.replayEpochs.get(sessionId) ?? { epoch: 0, inFlight: 0 };
    state.epoch += 1;
    state.inFlight += 1;
    this.replayEpochs.set(sessionId, state);
    this.emitReplay({ sessionId, phase: 'start', epoch: state.epoch });
    return state.epoch;
  }

  private endReplay(sessionId: string, epoch: number, ok: boolean): void {
    const state = this.replayEpochs.get(sessionId);
    if (state) {
      state.inFlight -= 1;
      if (state.inFlight <= 0) this.replayEpochs.delete(sessionId);
    }
    this.emitReplay({ sessionId, phase: 'end', epoch, ok });
  }

  private emitTurnEvent(event: CodingAgentAcpTurnEvent): void {
    for (const listener of [...this.turnListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('ACP turn event listener threw', error);
      }
    }
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
    this.options.onError?.(error);
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

  /**
   * v1 `loadSession` capability view. v2 has no `session/load`, so this is
   * only consulted on v1-negotiated connections.
   */
  private v1Capabilities(): { load: boolean } {
    const response = this.initializeResponseValue;
    if (!response || this.negotiatedVersionValue === 2) return { load: false };
    return { load: (response as acp.InitializeResponse).agentCapabilities?.loadSession === true };
  }

  /**
   * The v2 session surface advertised in `capabilities.session`. Present
   * (even as `{}`) means the baseline v2 session methods — `session/new`,
   * `session/list`, `session/resume`, `session/close`, `session/prompt`,
   * `session/cancel`, `session/update` — are supported; `null` means the
   * agent supports no `session/*` methods at all.
   */
  private v2SessionSurface(): { delete: unknown; fork: unknown } | null {
    const response = this.initializeResponseValue;
    if (!response || this.negotiatedVersionValue !== 2) return null;
    const session = (response as AcpV2InitializeResponse).capabilities?.session;
    if (session === null || session === undefined) return null;
    return { delete: session.delete ?? null, fork: session.fork ?? null };
  }

  private requireSessionCapability(
    method: string,
    capability: 'list' | 'delete' | 'fork' | 'resume' | 'close',
  ): void {
    if (this.negotiatedVersionValue === 2) {
      const surface = this.v2SessionSurface();
      if (surface === null) {
        throw new CodingAgentAcpUnavailableError(
          method,
          'the agent negotiated ACP v2 without a session surface (no capabilities.session in its initialize response)',
        );
      }
      const gated = capability === 'delete' ? surface.delete : capability === 'fork' ? surface.fork : {};
      if (gated === null || gated === undefined) {
        throw new CodingAgentAcpUnavailableError(
          method,
          `the v2 agent did not advertise capabilities.session.${capability} in its initialize response`,
        );
      }
      return;
    }
    const response = this.initializeResponseValue as acp.InitializeResponse | null;
    const caps = response?.agentCapabilities?.sessionCapabilities;
    if (!caps || caps[capability] === null || caps[capability] === undefined) {
      throw new CodingAgentAcpUnavailableError(
        method,
        `the agent did not advertise sessionCapabilities.${capability} in its initialize response`,
      );
    }
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
