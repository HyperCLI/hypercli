/** Vanilla ACP v1. Platform history/receipts are separate from native turns. */
import NodeWebSocket from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { createWebSocketStream, MemoryAcpCookieStore, type WebSocketConstructor, type WebSocketLike } from '@agentclientprotocol/sdk/experimental/ws-client';

export type { ContentBlock, SessionNotification, RequestPermissionRequest } from '@agentclientprotocol/sdk';
export type CodingAgentAcpProtocolVersion = 1;
export type CodingAgentAcpPromptResult = acp.PromptResponse;
export type CodingAgentAcpTransport = 'proxy' | 'direct';
export const ACP_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
export const ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE = 4404;
const TERMINAL_CODES = new Set([4401, 4403, 4404, 4408]);

export class CodingAgentAcpUnavailableError extends Error {
  constructor(public readonly capability: string, detail: string) {
    super(`${capability} is not available: ${detail}`);
    this.name = 'CodingAgentAcpUnavailableError';
  }
}
export class CodingAgentAcpConnectionError extends Error {
  public readonly code: number | null;
  constructor(message: string, options: { code?: number | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CodingAgentAcpConnectionError';
    this.code = options.code ?? null;
  }
}
export class CodingAgentAcpRequestError extends Error {
  constructor(public readonly method: string, public readonly code: number, message: string,
    public readonly data?: unknown, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CodingAgentAcpRequestError';
  }
}
export class CodingAgentAcpReplayGapError extends Error {
  constructor(public readonly sessionId: string, detail: string, options: { cause?: unknown } = {}) {
    super(`ACP session ${sessionId} could not be reattached: ${detail}`, options);
    this.name = 'CodingAgentAcpReplayGapError';
  }
}
export interface CodingAgentAcpReplayEvent {
  sessionId: string;
  phase: 'start' | 'end';
  epoch: number;
  ok?: boolean;
}
export type CodingAgentAcpStage = 'connect' | 'initialize' | 'cwd' | 'new' | 'list' | 'resume' | 'prompt';
export interface CodingAgentAcpDiagnosticError {
  name: string;
  code?: number | string;
  statusCode?: number;
  cause?: CodingAgentAcpDiagnosticError;
}
export type CodingAgentAcpDiagnostic = {
  stage: CodingAgentAcpStage; operationId: number; timestamp: number; elapsedMs: number;
  phase: 'started' | 'succeeded' | 'failed'; error?: CodingAgentAcpDiagnosticError;
} | { stage: 'transport'; phase: 'closed'; timestamp: number; code: number | null; reasonPresent: boolean };

function diagnosticError(error: unknown, depth = 0): CodingAgentAcpDiagnosticError {
  const value = error as { constructor?: { name?: unknown }; code?: unknown; statusCode?: unknown; cause?: unknown } | null;
  const name = value?.constructor?.name;
  return {
    name: typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) ? name : 'Error',
    ...(typeof value?.code === 'number' || (typeof value?.code === 'string' && /^(?:E[A-Z]+|UND_ERR_[A-Z_]+)$/.test(value.code)) ? { code: value.code } : {}),
    ...(typeof value?.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
    ...(value?.cause !== undefined && depth < 3 ? { cause: diagnosticError(value.cause, depth + 1) } : {}),
  };
}
type PermissionHandler = (params: acp.RequestPermissionRequest, signal?: AbortSignal) => acp.MaybePromise<acp.RequestPermissionResponse>;
export interface CodingAgentAcpConnectOptions {
  onDiagnostic?: (event: CodingAgentAcpDiagnostic) => void;
  resolveDefaultCwd?: () => Promise<string>;
  signal?: AbortSignal;
  token?: string;
  cwd?: string;
  clientInfo?: { name?: string; version?: string };
  mcpServers?: acp.McpServer[];
  transport?: CodingAgentAcpTransport;
  sessionId?: string;
  source?: string | null;
  onUpdate?: (notification: acp.SessionNotification) => void;
  onPermissionRequest?: PermissionHandler;
  onError?: (error: Error) => void;
  onClose?: (event: { code: number; reason: string }) => void;
}
export interface CodingAgentAcpTarget { url: string; token: string }
interface Session { cwd: string; mcpServers: acp.McpServer[]; configOptions: acp.SessionConfigOption[] | null }
interface Deferred { resolve(): void; reject(error: Error): void }

export class CodingAgentAcpClient {
  private readonly target: CodingAgentAcpTarget;
  private readonly cookieStore = new MemoryAcpCookieStore();
  private connection: acp.ClientConnection | null = null;
  private pendingConnection: acp.ClientConnection | null = null;
  private initializeValue: acp.InitializeResponse | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly connectedWaiters = new Set<Deferred>();
  private readonly updateListeners = new Set<(notification: acp.SessionNotification) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<(event: { code: number; reason: string }) => void>();
  private readonly replayListeners = new Set<(event: CodingAgentAcpReplayEvent) => void>();
  private readonly loads = new Map<string, number>();
  private nextLoad = 0;
  private permissionHandler: PermissionHandler | null = null;
  private closedFlag = false;
  private terminalError: CodingAgentAcpConnectionError | null = null;
  private failures = 0;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextDiagnosticOperation = 0;
  private readonly onAbort = () => this.close();

  private constructor(target: CodingAgentAcpTarget, private readonly options: CodingAgentAcpConnectOptions) {
    const url = new URL(target.url);
    if (options.source != null) {
      if (options.transport === 'direct') throw new Error('source requires the ACP proxy transport');
      url.searchParams.set('source', options.source);
    }
    this.target = { ...target, url: url.toString() };
  }
  static async connect(target: CodingAgentAcpTarget, options: CodingAgentAcpConnectOptions = {}): Promise<CodingAgentAcpClient> {
    const client = new CodingAgentAcpClient(target, options);
    try {
      if (options.signal?.aborted) throw new CodingAgentAcpConnectionError('ACP connect aborted');
      options.signal?.addEventListener('abort', client.onAbort, { once: true });
      await client.open();
      return client;
    } catch (error) { client.close(); throw error; }
  }
  get connected(): boolean { return this.connection !== null && !this.closedFlag; }
  get closed(): boolean { return this.closedFlag; }
  get negotiatedProtocolVersion(): CodingAgentAcpProtocolVersion | null { return this.initializeValue ? 1 : null; }
  get initializeResponse(): acp.InitializeResponse | null { return this.initializeValue; }
  get sessionIds(): string[] { return [...this.sessions.keys()]; }
  addUpdateListener(listener: (notification: acp.SessionNotification) => void): () => void {
    this.updateListeners.add(listener); return () => { this.updateListeners.delete(listener); };
  }
  addErrorListener(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener); return () => { this.errorListeners.delete(listener); };
  }
  addCloseListener(listener: (event: { code: number; reason: string }) => void): () => void {
    this.closeListeners.add(listener); return () => { this.closeListeners.delete(listener); };
  }
  addReplayListener(listener: (event: CodingAgentAcpReplayEvent) => void): () => void {
    this.replayListeners.add(listener); return () => { this.replayListeners.delete(listener); };
  }
  replayEpoch(sessionId: string): number { return this.loads.get(sessionId) ?? 0; }
  setPermissionHandler(handler: PermissionHandler | null): void { this.permissionHandler = handler; }
  waitConnected(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.closedFlag) return Promise.reject(this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed'));
    return new Promise((resolve, reject) => { this.connectedWaiters.add({ resolve, reject }); });
  }
  private diagnostic(event: CodingAgentAcpDiagnostic): void {
    try { this.options.onDiagnostic?.(event); } catch { /* Observer failures do not change outcomes. */ }
  }
  private async observe<T>(stage: CodingAgentAcpStage, run: () => Promise<T>): Promise<T> {
    const operationId = ++this.nextDiagnosticOperation;
    const started = performance.now();
    this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: 0, phase: 'started' });
    try {
      const result = await run();
      this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: Math.round(performance.now() - started), phase: 'succeeded' });
      return result;
    } catch (error) {
      this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: Math.round(performance.now() - started), phase: 'failed', error: diagnosticError(error) });
      throw error;
    }
  }
  async newSession(options: { cwd?: string; mcpServers?: acp.McpServer[] } = {}): Promise<acp.NewSessionResponse> {
    const cwd = await this.observe('cwd', async () => {
      const supplied = options.cwd ?? this.options.cwd;
      if (supplied !== undefined) return supplied;
      if (!this.options.resolveDefaultCwd) throw new CodingAgentAcpUnavailableError('session/new', 'supply cwd or a runtime path resolver');
      return this.options.resolveDefaultCwd();
    });
    const mcpServers = options.mcpServers ?? this.options.mcpServers ?? [];
    const result = await this.observe('new', () => this.request<acp.NewSessionResponse>('session/new', { cwd, mcpServers }));
    this.sessions.set(result.sessionId, { cwd, mcpServers, configOptions: result.configOptions ?? null });
    return result;
  }
  async listSessions(options: { cwd?: string | null; cursor?: string | null } = {}): Promise<acp.ListSessionsResponse> {
    return this.observe('list', () => this.request('session/list', options));
  }
  private async originalSessionCwd(sessionId: string): Promise<string> {
    const tracked = this.sessions.get(sessionId);
    if (tracked) return tracked.cwd;
    if (this.options.cwd !== undefined) return this.options.cwd;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.listSessions({ cursor });
      const entry = page.sessions.find(s => s.sessionId === sessionId);
      if (entry) return entry.cwd;
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('session/list repeated a cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    throw new CodingAgentAcpUnavailableError('session/resume', 'original session cwd is unavailable; supply it explicitly');
  }
  async resumeSession(sessionId: string, options: { cwd?: string } = {}): Promise<acp.ResumeSessionResponse> {
    const previous = this.sessions.get(sessionId);
    const cwd = await this.observe('cwd', () => options.cwd !== undefined ? Promise.resolve(options.cwd) : this.originalSessionCwd(sessionId));
    const mcpServers = previous?.mcpServers ?? this.options.mcpServers ?? [];
    const result = await this.observe('resume', () => this.request<acp.ResumeSessionResponse>('session/resume', { sessionId, cwd, mcpServers }));
    this.sessions.set(sessionId, { cwd, mcpServers,
      configOptions: result.configOptions === undefined ? this.sessions.get(sessionId)?.configOptions ?? null : result.configOptions });
    return result;
  }
  /** Explicit full history load. Reconnect/attachment never invokes it. */
  async loadSession(sessionId: string): Promise<acp.LoadSessionResponse> {
    const cwd = await this.originalSessionCwd(sessionId);
    const mcpServers = this.sessions.get(sessionId)?.mcpServers ?? this.options.mcpServers ?? [];
    const epoch = ++this.nextLoad;
    this.loads.set(sessionId, epoch);
    const emit = (event: CodingAgentAcpReplayEvent) => { for (const listener of this.replayListeners) listener(event); };
    emit({ sessionId, epoch, phase: 'start' });
    let ok = false;
    try {
      const result = await this.request<acp.LoadSessionResponse>('session/load', { sessionId, cwd, mcpServers });
      this.sessions.set(sessionId, { cwd, mcpServers,
        configOptions: result.configOptions === undefined ? this.sessions.get(sessionId)?.configOptions ?? null : result.configOptions });
      ok = true;
      return result;
    } finally {
      if (this.loads.get(sessionId) === epoch) this.loads.delete(sessionId);
      emit({ sessionId, epoch, phase: 'end', ok });
    }
  }
  async prompt(sessionId: string, prompt: string | acp.ContentBlock | acp.ContentBlock[]): Promise<acp.PromptResponse> {
    const blocks = typeof prompt === 'string' ? [{ type: 'text' as const, text: prompt }] : Array.isArray(prompt) ? prompt : [prompt];
    return this.observe('prompt', () => this.request<acp.PromptResponse>('session/prompt', { sessionId, prompt: blocks }));
  }
  async submitPrompt(sessionId: string, prompt: acp.ContentBlock[]): Promise<acp.PromptResponse> { return this.prompt(sessionId, prompt); }
  async cancel(sessionId: string): Promise<void> { await this.notify('session/cancel', { sessionId }); }
  async closeSession(sessionId: string): Promise<void> { await this.request('session/close', { sessionId }); this.sessions.delete(sessionId); }
  async deleteSession(sessionId: string): Promise<void> { await this.request('session/delete', { sessionId }); this.sessions.delete(sessionId); }
  async unstableForkSession(sessionId: string): Promise<acp.ForkSessionResponse> {
    return this.request('session/fork', { sessionId, cwd: await this.originalSessionCwd(sessionId), mcpServers: this.options.mcpServers ?? [] });
  }
  async setMode(sessionId: string, modeId: string): Promise<void> { await this.request('session/set_mode', { sessionId, modeId }); }
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<acp.SetSessionConfigOptionResponse> {
    const result = await this.request<acp.SetSessionConfigOptionResponse>('session/set_config_option', { sessionId, configId, value });
    const session = this.sessions.get(sessionId);
    if (session) session.configOptions = result.configOptions;
    return result;
  }
  async setModel(sessionId: string, modelId: string): Promise<acp.SetSessionConfigOptionResponse> {
    const option = this.sessions.get(sessionId)?.configOptions?.find(o => o.category === 'model');
    if (!option) throw new CodingAgentAcpUnavailableError('session/set_config_option', 'no model configuration advertised');
    return this.setConfigOption(sessionId, option.id, modelId);
  }
  async unstableListProviders(): Promise<unknown> { return this.request('providers/list', {}); }
  async unstableSetProvider(params: acp.SetProviderRequest): Promise<unknown> { return this.request('providers/set', params); }
  async unstableDisableProvider(params: acp.DisableProviderRequest): Promise<unknown> { return this.request('providers/disable', params); }
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    try { return await this.context().request<T>(method, params); }
    catch (error) {
      if (error instanceof acp.RequestError) throw new CodingAgentAcpRequestError(method, error.code, error.message, error.data, error);
      throw error;
    }
  }
  notify(method: string, params?: unknown): Promise<void> { return this.context().notify(method, params); }
  private context(): acp.AgentContext {
    if (!this.connection || this.closedFlag) throw this.terminalError ?? new CodingAgentAcpConnectionError('ACP connection unavailable');
    return this.connection.agent;
  }
  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    ++this.generation;
    this.options.signal?.removeEventListener('abort', this.onAbort);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    const error = this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed; pending delivery is unresolved');
    this.pendingConnection?.close(error);
    this.connection?.close(error);
    this.connection = this.pendingConnection = null;
    for (const waiter of this.connectedWaiters) waiter.reject(error);
    this.connectedWaiters.clear();
    this.updateListeners.clear(); this.errorListeners.clear(); this.closeListeners.clear(); this.replayListeners.clear();
    this.permissionHandler = null;
  }
  private async open(): Promise<void> {
    const generation = this.generation;
    const closeInfo: { code?: number; reason: string } = { reason: '' };
    let socketOpened!: () => void;
    let socketFailed!: (error: Error) => void;
    const opened = new Promise<void>((resolve, reject) => { socketOpened = resolve; socketFailed = reject; });
    void opened.catch(() => {});
    const WebSocketImpl = (NodeWebSocket ?? globalThis.WebSocket) as unknown as WebSocketConstructor;
    const diagnostic = (event: CodingAgentAcpDiagnostic) => this.diagnostic(event);
    const TrackedSocket = class {
      constructor(url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) {
        const ws = new WebSocketImpl(url, protocols, options) as WebSocketLike;
        const closed = (code?: number, reason = '') => {
          closeInfo.code = code; closeInfo.reason = reason;
          socketFailed(new CodingAgentAcpConnectionError('ACP socket closed before opening', { code }));
          diagnostic({ stage: 'transport', phase: 'closed', timestamp: Date.now(), code: code ?? null, reasonPresent: reason.length > 0 });
        };
        if (typeof ws.on === 'function') {
          ws.on('open', socketOpened);
          ws.on('error', (error: unknown) => socketFailed(new CodingAgentAcpConnectionError('ACP socket failed before opening', { cause: error })));
          ws.on('close', (...args: unknown[]) => closed(typeof args[0] === 'number' ? args[0] : undefined, String(args[1] ?? '')));
        } else {
          ws.addEventListener?.('open', socketOpened);
          ws.addEventListener?.('close', (event: unknown) => { const e = event as { code: number; reason: string }; closed(e.code, e.reason); });
        }
        return ws;
      }
    } as unknown as WebSocketConstructor;
    const app = acp.client({ name: this.options.clientInfo?.name ?? 'hypercli-ts-sdk' });
    app.onRequest('session/request_permission', context => {
      const handler = this.permissionHandler ?? this.options.onPermissionRequest;
      return handler ? handler(context.params, context.signal) : { outcome: { outcome: 'cancelled' as const } };
    });
    const sessionUpdate = (notification: acp.SessionNotification) => {
      if (this.closedFlag || generation !== this.generation) return;
      const session = this.sessions.get(notification.sessionId);
      if (session && notification.update.sessionUpdate === 'config_option_update') {
        session.configOptions = notification.update.configOptions;
      }
      for (const listener of [this.options.onUpdate, ...this.updateListeners]) {
        try { listener?.(notification); } catch (error) { console.error('ACP update listener threw', error); }
      }
    };
    const connection = await this.observe('connect', async () => {
      const stream = createWebSocketStream(this.target.url, {
        WebSocket: TrackedSocket, cookieStore: this.cookieStore,
        headers: this.target.token ? { Authorization: `Bearer ${this.target.token}` } : undefined,
      });
      const pending = app.connect({ ...stream,
        // Upstream's active-session router validates an exhaustive update union.
        // Forward notifications untouched; RPCs/callbacks remain SDK-owned.
        readable: stream.readable.pipeThrough(new TransformStream({ transform(frame, controller) {
          if (frame && typeof frame === 'object' && 'method' in frame && frame.method === 'session/update' && !('id' in frame)) {
            sessionUpdate(frame.params as acp.SessionNotification);
          } else controller.enqueue(frame);
        } })),
      });
      this.pendingConnection = pending;
      void pending.closed.then(() => socketFailed(new CodingAgentAcpConnectionError('ACP connection closed before opening')));
      try { await opened; return pending; }
      catch (error) { pending.close(error instanceof Error ? error : undefined); throw error; }
    });
    this.pendingConnection = connection;
    void connection.closed.then(() => {
      if (this.closedFlag || this.connection !== connection) return;
      this.connection = null;
      ++this.generation;
      this.scheduleReconnect(closeInfo.code ?? 1006, closeInfo.reason);
    });
    try {
      const response = await this.observe('initialize', () => connection.agent.request('initialize', {
        protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: this.options.clientInfo?.name ?? 'hypercli-ts-sdk', version: this.options.clientInfo?.version ?? '' },
      }));
      if (response.protocolVersion !== 1) throw new CodingAgentAcpConnectionError('ACP peer did not select v1');
      if (this.closedFlag || generation !== this.generation) throw new CodingAgentAcpConnectionError('ACP connect aborted');
      this.initializeValue = response;
      this.connection = connection;
      for (const waiter of this.connectedWaiters) waiter.resolve();
      this.connectedWaiters.clear();
    } catch (error) { connection.close(error instanceof Error ? error : undefined); throw error; }
    finally { if (this.pendingConnection === connection) this.pendingConnection = null; }
  }
  private scheduleReconnect(code: number, reason: string): void {
    if (this.closedFlag) return;
    if (TERMINAL_CODES.has(code) || this.failures >= ACP_RECONNECT_DELAYS_MS.length) {
      this.terminalError = new CodingAgentAcpConnectionError('ACP connection closed', { code });
      const listeners = [...this.closeListeners];
      this.close();
      for (const listener of [this.options.onClose, ...listeners]) listener?.({ code, reason });
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open().then(async () => {
        this.failures = 0;
        for (const [sid, setup] of this.sessions) {
          try { await this.resumeSession(sid, { cwd: setup.cwd }); }
          catch (error) {
            this.sessions.delete(sid);
            const gap = new CodingAgentAcpReplayGapError(sid, String(error), { cause: error });
            for (const listener of [this.options.onError, ...this.errorListeners]) listener?.(gap);
          }
        }
      }, () => this.scheduleReconnect(code, reason));
    }, ACP_RECONNECT_DELAYS_MS[this.failures++]);
  }
}
