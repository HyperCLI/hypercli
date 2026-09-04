/**
 * ACP (Agent Client Protocol) client connectivity for coding agents.
 *
 * Every hosted coding-agent pod runs `hyper-acp`, which bridges the pod-side
 * ACP child (`opencode acp`, `claude-code acp`, ...) onto an outbound
 * WebSocket to the backend bridge at `/ws`. This module dials that bridge as
 * the client side (`?agent_id=<uuid>`, Bearer API key), runs the ACP
 * `initialize` handshake, and exposes typed session helpers plus a raw
 * JSON-RPC escape hatch.
 *
 * Reconnect mirrors the ACP v1 contract used by the bridge: the runtime side
 * is long-lived, the client re-dials, re-initializes, and replays each known
 * session with `session/load`. In-flight prompt turns are never retried
 * mid-turn; `session/load` failures surface as soft
 * {@link CodingAgentAcpReplayGapError}s while the connection stays alive.
 */
import NodeWebSocket from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import {
  createWebSocketStream,
  MemoryAcpCookieStore,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@agentclientprotocol/sdk/experimental/ws-client';

/** Reconnect backoff budget, mirroring the buzz-activity subscriptions. */
export const ACP_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * Bridge close codes that must not be retried: the identity/binding itself is
 * rejected, so re-dialing with the same credentials can never succeed.
 * (4409, duplicate side, is transient — the other client may disconnect.)
 */
const ACP_TERMINAL_CLOSE_CODES = new Set([4401, 4403, 4408]);

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
  /** Session working directory; defaults to the agent workspace root. */
  cwd?: string;
  /** Override the `clientInfo` sent with `initialize`. */
  clientInfo?: { name?: string; version?: string };
  /** MCP servers attached to every session created or replayed by this client. */
  mcpServers?: acp.McpServer[];
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
}

interface Deferred {
  resolve(): void;
  reject(error: Error): void;
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
  private connection: acp.ClientConnection | null = null;
  private initializeResponseValue: acp.InitializeResponse | null = null;
  private readonly sessions = new Map<string, TrackedAcpSession>();
  private readonly connectedWaiters = new Set<Deferred>();
  private closedFlag = false;
  private terminalError: CodingAgentAcpConnectionError | null = null;
  private lastCloseCode: number | null = null;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly onAbort: () => void;

  private constructor(target: CodingAgentAcpTarget, options: CodingAgentAcpConnectOptions) {
    this.target = target;
    this.options = options;
    this.cwd = options.cwd ?? '/home/node';
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

  /** Latest `initialize` response; refreshed on every (re)connect. */
  get initializeResponse(): acp.InitializeResponse | null {
    return this.initializeResponseValue;
  }

  /** Session IDs this client created or loaded, in creation order. */
  get sessionIds(): string[] {
    return [...this.sessions.keys()];
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
    const context = this.requireContext();
    const cwd = options.cwd ?? this.cwd;
    const mcpServers = options.mcpServers ?? this.mcpServers;
    const response = await context.request(acp.methods.agent.session.new, { cwd, mcpServers });
    this.sessions.set(response.sessionId, {
      cwd,
      mcpServers,
      modes: response.modes ?? null,
      configOptions: response.configOptions ?? null,
    });
    return response;
  }

  async listSessions(options: { cwd?: string | null; cursor?: string | null } = {}): Promise<acp.ListSessionsResponse> {
    const context = this.requireContext();
    if (
      this.initializeResponseValue?.agentCapabilities?.sessionCapabilities?.list === null
      || this.initializeResponseValue?.agentCapabilities?.sessionCapabilities?.list === undefined
    ) {
      throw new CodingAgentAcpUnavailableError(
        'session/list',
        'the agent did not advertise sessionCapabilities.list in its initialize response',
      );
    }
    return context.request(acp.methods.agent.session.list, {
      cwd: options.cwd ?? null,
      cursor: options.cursor ?? null,
    });
  }

  async loadSession(sessionId: string): Promise<void> {
    const context = this.requireContext();
    if (this.initializeResponseValue?.agentCapabilities?.loadSession !== true) {
      throw new CodingAgentAcpUnavailableError(
        'session/load',
        'the agent did not advertise agentCapabilities.loadSession in its initialize response',
      );
    }
    const previous = this.sessions.get(sessionId);
    const cwd = previous?.cwd ?? this.cwd;
    const mcpServers = previous?.mcpServers ?? this.mcpServers;
    const response = await context.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers,
    });
    this.sessions.set(sessionId, {
      cwd,
      mcpServers,
      modes: response?.modes ?? null,
      configOptions: response?.configOptions ?? null,
    });
  }

  /**
   * Run one prompt turn. Strings become a single text block. Streams
   * `session/update` notifications to `onUpdate`. Resolves with the turn's
   * stop reason; if the socket dies mid-turn the promise rejects with
   * {@link CodingAgentAcpConnectionError} and the turn is NOT retried.
   */
  async prompt(
    sessionId: string,
    prompt: string | acp.ContentBlock | acp.ContentBlock[],
  ): Promise<acp.StopReason> {
    const connection = this.requireConnection();
    const blocks: acp.ContentBlock[] = typeof prompt === 'string'
      ? [{ type: 'text', text: prompt }]
      : Array.isArray(prompt)
        ? prompt
        : [prompt];
    try {
      const response = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: blocks,
      });
      return response.stopReason;
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

  async cancel(sessionId: string): Promise<void> {
    await this.requireContext().notify(acp.methods.agent.session.cancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const context = this.requireContext();
    if (!this.sessions.get(sessionId)?.modes) {
      throw new CodingAgentAcpUnavailableError(
        'session/set_mode',
        `session ${sessionId} advertised no modes in its session state`,
      );
    }
    await context.request(acp.methods.agent.session.setMode, { sessionId, modeId });
  }

  /** Set the session model through the `model` config option the session advertised. */
  async setModel(sessionId: string, modelId: string): Promise<acp.SetSessionConfigOptionResponse> {
    const context = this.requireContext();
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
    return context.request(acp.methods.agent.session.setConfigOption, {
      sessionId,
      configId: modelOption.id,
      value: modelId,
    });
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
    if (this.closedFlag) return;
    this.closedFlag = true;
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
    let dialed: { connection: acp.ClientConnection; initializeResponse: acp.InitializeResponse };
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
    this.failures = 0;
    this.resolveConnectedWaiters();
  }

  private initializeParams(): acp.InitializeRequest {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: this.options.onReadTextFile !== undefined,
          writeTextFile: this.options.onWriteTextFile !== undefined,
        },
        terminal: false,
      },
      clientInfo: { name: this.clientName, version: this.clientVersion },
    };
  }

  private buildApp(): acp.ClientApp {
    const app = acp.client({ name: this.clientName });
    app.onRequest(acp.methods.client.session.requestPermission, (context) => {
      if (this.options.onPermissionRequest) {
        return this.options.onPermissionRequest(context.params);
      }
      return { outcome: { outcome: 'cancelled' as const } };
    });
    app.onNotification(acp.methods.client.session.update, (context) => {
      this.options.onUpdate?.(context.params);
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

  private dial(): { connection: acp.ClientConnection; closeInfo: { code?: number; reason: string } } {
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
    const stream = createWebSocketStream(this.target.url, {
      WebSocket: TrackedWebSocket,
      headers: { Authorization: `Bearer ${this.target.token}` },
      cookieStore: this.cookieStore,
    });
    const connection = this.buildApp().connect(stream);
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
    connection: acp.ClientConnection;
    initializeResponse: acp.InitializeResponse;
  }> {
    const { connection, closeInfo } = this.dial();
    try {
      const initializeResponse = await connection.agent.request(
        acp.methods.agent.initialize,
        this.initializeParams(),
      );
      return { connection, initializeResponse };
    } catch (error) {
      connection.close(error instanceof Error ? error : undefined);
      const code = closeInfo.code ?? null;
      this.lastCloseCode = code;
      throw new CodingAgentAcpConnectionError(
        `ACP initialize failed${code !== null ? ` (bridge closed with code ${code})` : ''}`,
        { code, cause: error },
      );
    }
  }

  private onConnectionClosed(
    connection: acp.ClientConnection,
    closeInfo: { code?: number; reason: string },
  ): void {
    if (this.closedFlag || connection !== this.connection) return;
    this.connection = null;
    const code = closeInfo.code ?? 1006;
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
    let connection: acp.ClientConnection;
    let initializeResponse: acp.InitializeResponse;
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
    this.failures = 0;
    this.resolveConnectedWaiters();
    await this.replaySessions(connection, generation);
  }

  private async replaySessions(connection: acp.ClientConnection, generation: number): Promise<void> {
    const canLoad = this.initializeResponseValue?.agentCapabilities?.loadSession === true;
    for (const [sessionId, tracked] of [...this.sessions]) {
      if (this.closedFlag || generation !== this.generation || connection !== this.connection) return;
      if (!canLoad) {
        this.sessions.delete(sessionId);
        this.softError(new CodingAgentAcpReplayGapError(
          sessionId,
          'the agent no longer advertises agentCapabilities.loadSession',
        ));
        continue;
      }
      try {
        const response = await connection.agent.request(acp.methods.agent.session.load, {
          sessionId,
          cwd: tracked.cwd,
          mcpServers: tracked.mcpServers,
        });
        tracked.modes = response?.modes ?? null;
        tracked.configOptions = response?.configOptions ?? null;
      } catch (error) {
        this.sessions.delete(sessionId);
        this.softError(new CodingAgentAcpReplayGapError(
          sessionId,
          error instanceof Error ? error.message : 'session/load rejected',
          { cause: error },
        ));
      }
    }
  }

  private terminate(error: CodingAgentAcpConnectionError, code: number, reason: string): void {
    this.terminalError = error;
    this.close();
    this.options.onClose?.({ code, reason });
  }

  private softError(error: Error): void {
    this.options.onError?.(error);
  }

  private requireConnection(): acp.ClientConnection {
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

  private requireContext(): acp.ClientContext {
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
