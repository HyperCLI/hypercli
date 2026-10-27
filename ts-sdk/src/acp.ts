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
/** Product startup refusal: the associated native operation was not forwarded. */
export class CodingAgentSessionStartupError extends Error {
  readonly code = 'unavailable';
  constructor(public readonly requestId: string | number, message: string) {
    super(message);
    this.name = 'CodingAgentSessionStartupError';
  }
}

// SDK 1.5.0 has no public single-waiter rejection API. Reuse its owned waiter
// and cleanup rather than inventing an ACP response or a second pending map.
function rejectStartup(connection: acp.ClientConnection, requestId: string | number, message: string): void {
  const context = connection.agent as unknown as {
    cx: { connection: { pendingResponses: Map<string | number, { cleanup?(): void; reject(error: Error): void }> } };
  };
  const pending = context.cx.connection.pendingResponses;
  const waiter = pending.get(requestId);
  if (!waiter) return;
  pending.delete(requestId);
  waiter.cleanup?.();
  waiter.reject(new CodingAgentSessionStartupError(requestId, message));
}
export class CodingAgentAcpAttachmentError extends Error {
  constructor(public readonly sessionId: string, detail: string, options: { cause?: unknown } = {}) {
    super(`ACP session ${sessionId} could not be reattached: ${detail}`, options);
    this.name = 'CodingAgentAcpAttachmentError';
  }
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
/** Observers never own protocol settlement, including accidentally async observers. */
function callObserver<T>(observer: ((value: T) => void) | undefined, value: T): void {
  try { void Promise.resolve(observer?.(value)).catch(() => {}); } catch { /* Isolate consumer observers. */ }
}
export interface CodingAgentAcpConnectOptions {
  /** Disable automatic reconnect/resume for explicitly opened app attachments. */
  reconnect?: boolean;
  onDiagnostic?: (event: CodingAgentAcpDiagnostic) => void;
  resolveDefaultCwd?: () => Promise<string>;
  signal?: AbortSignal;
  token?: string;
  cwd?: string;
  clientInfo?: { name?: string; version?: string };
  clientCapabilities?: acp.ClientCapabilities;
  mcpServers?: acp.McpServer[];
  transport?: CodingAgentAcpTransport;
  sessionId?: string;
  source?: string | null;
  onUpdate?: (notification: acp.SessionNotification) => void;
  onPermissionRequest?: PermissionHandler;
  onError?: (error: Error) => void;
  onClose?: (event: { code: number; reason: string }) => void;
  /** Refresh platform history before reconnect resumes the tracked sessions. */
  onReconnect?: () => void | Promise<void>;
}
export interface CodingAgentAcpTarget { url: string; token: string }
/** Retained product publication, independent of native ACP. */
export interface SessionSnapshot {
  type: 'sessionSnapshot';
  sessionId: string;
  fingerprint: string | null;
}

export interface SessionAttachment {
  type: 'attachment'; id: string; sessionId: string; agentId: string; nativeSessionId: string;
  file: { type: 'resource_link'; uri: string; name: string; mimeType: string; size: number; sha256: string };
}
interface Session { cwd: string; mcpServers: acp.McpServer[] }
interface Deferred { resolve(): void; reject(error: Error): void }

export class CodingAgentAcpClient {
  private readonly target: CodingAgentAcpTarget;
  private readonly cookieStore = new MemoryAcpCookieStore();
  private connection: acp.ClientConnection | null = null;
  private pendingConnection: acp.ClientConnection | null = null;
  private initializeValue: acp.InitializeResponse | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionConfig = new Map<string, acp.SessionConfigOption[]>();
  private ready = false;
  private readonly connectedWaiters = new Set<Deferred>();
  private readonly pendingPrompts = new Set<{ sessionId: string; controller: AbortController }>();
  private readonly updateListeners = new Set<(notification: acp.SessionNotification) => void>();
  private readonly attachmentListeners = new Set<(attachment: SessionAttachment) => void>();
  private readonly snapshotListeners = new Set<(snapshot: SessionSnapshot) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<(event: { code: number; reason: string }) => void>();
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
    if (options.source !== undefined && options.source !== null) {
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
  get connected(): boolean { return this.ready && this.connection !== null && !this.closedFlag; }
  get closed(): boolean { return this.closedFlag; }
  get negotiatedProtocolVersion(): CodingAgentAcpProtocolVersion | null { return this.initializeValue ? 1 : null; }
  get initializeResponse(): acp.InitializeResponse | null { return this.initializeValue; }
  get sessionIds(): string[] { return [...this.sessions.keys()]; }
  /** Latest native configuration advertised for an attached session. */
  sessionConfigOptions(sessionId: string): readonly acp.SessionConfigOption[] {
    return this.sessionConfig.get(sessionId) ?? [];
  }
  addUpdateListener(listener: (notification: acp.SessionNotification) => void): () => void {
    this.updateListeners.add(listener); return () => { this.updateListeners.delete(listener); };
  }
  addAttachmentListener(listener: (attachment: SessionAttachment) => void): () => void {
    this.attachmentListeners.add(listener); return () => { this.attachmentListeners.delete(listener); };
  }

  addSnapshotListener(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => { this.snapshotListeners.delete(listener); };
  }
  addErrorListener(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener); return () => { this.errorListeners.delete(listener); };
  }
  addCloseListener(listener: (event: { code: number; reason: string }) => void): () => void {
    this.closeListeners.add(listener); return () => { this.closeListeners.delete(listener); };
  }
  setPermissionHandler(handler: PermissionHandler | null): void { this.permissionHandler = handler; }
  waitConnected(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.connected) return Promise.resolve();
    if (this.closedFlag) return Promise.reject(this.terminalError ?? new CodingAgentAcpConnectionError('ACP client closed'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.connectedWaiters.delete(waiter); signal?.removeEventListener('abort', abort); };
      const waiter = { resolve: () => { cleanup(); resolve(); }, reject: (error: Error) => { cleanup(); reject(error); } };
      const abort = () => waiter.reject(signal!.reason);
      this.connectedWaiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  private diagnostic(event: CodingAgentAcpDiagnostic): void {
    callObserver(this.options.onDiagnostic, event);
  }
  private async observe<T>(stage: CodingAgentAcpStage, run: () => Promise<T>): Promise<T> {
    const operationId = ++this.nextDiagnosticOperation;
    const started = globalThis.performance.now();
    this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: 0, phase: 'started' });
    try {
      const result = await run();
      this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: Math.round(globalThis.performance.now() - started), phase: 'succeeded' });
      return result;
    } catch (error) {
      this.diagnostic({ stage, operationId, timestamp: Date.now(), elapsedMs: Math.round(globalThis.performance.now() - started), phase: 'failed', error: diagnosticError(error) });
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
    const mcpServers = structuredClone(options.mcpServers ?? this.options.mcpServers ?? []);
    const result = await this.observe('new', () => this.request<acp.NewSessionResponse>('session/new', { cwd, mcpServers }));
    this.sessions.set(result.sessionId, { cwd, mcpServers });
    if (result.configOptions) this.sessionConfig.set(result.sessionId, result.configOptions);
    return result;
  }
  async listSessions(options: { cwd?: string | null; cursor?: string | null } = {}): Promise<acp.ListSessionsResponse> {
    return this.observe('list', () => this.request('session/list', options));
  }
  private async originalSessionCwd(sessionId: string): Promise<string> {
    return this.sessions.get(sessionId)?.cwd ?? this.options.cwd ?? this.sessionCwd(sessionId);
  }
  /** Exact tracked/catalog session cwd, without a launch/connection default fallback. */
  async sessionCwd(sessionId: string): Promise<string> {
    const tracked = this.sessions.get(sessionId);
    if (tracked) return tracked.cwd;
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
    throw new CodingAgentAcpUnavailableError('session/list', 'original session cwd is unavailable');
  }
  async resumeSession(sessionId: string, options: { cwd?: string; mcpServers?: acp.McpServer[] } = {}): Promise<acp.ResumeSessionResponse> {
    const previous = this.sessions.get(sessionId);
    const cwd = await this.observe('cwd', () => options.cwd !== undefined ? Promise.resolve(options.cwd) : this.originalSessionCwd(sessionId));
    const mcpServers = structuredClone(options.mcpServers ?? previous?.mcpServers ?? this.options.mcpServers ?? []);
    const connection = this.connection, generation = this.generation;
    const result = await this.observe('resume', () => this.request<acp.ResumeSessionResponse>('session/resume', { sessionId, cwd, mcpServers }));
    if (connection !== this.connection || generation !== this.generation || this.closedFlag) throw new CodingAgentAcpConnectionError('ACP attachment interrupted');
    this.sessions.set(sessionId, { cwd, mcpServers });
    if (result.configOptions) this.sessionConfig.set(sessionId, result.configOptions);
    return result;
  }
  async prompt(sessionId: string, prompt: string | acp.ContentBlock | acp.ContentBlock[]): Promise<acp.PromptResponse> {
    const pending = { sessionId, controller: new AbortController() };
    this.pendingPrompts.add(pending);
    try {
      await this.waitConnected(pending.controller.signal);
      pending.controller.signal.throwIfAborted();
    } finally { this.pendingPrompts.delete(pending); }
    const blocks = typeof prompt === 'string' ? [{ type: 'text' as const, text: prompt }] : Array.isArray(prompt) ? prompt : [prompt];
    return this.observe('prompt', () => this.request<acp.PromptResponse>('session/prompt', { sessionId, prompt: blocks }));
  }
  async cancel(sessionId: string): Promise<void> {
    for (const pending of this.pendingPrompts) {
      if (pending.sessionId === sessionId) pending.controller.abort(new Error('ACP prompt cancelled before delivery'));
    }
    await this.notify('session/cancel', { sessionId });
  }
  async closeSession(sessionId: string): Promise<void> { await this.request('session/close', { sessionId }); this.sessions.delete(sessionId); this.sessionConfig.delete(sessionId); }
  async deleteSession(sessionId: string): Promise<void> { await this.request('session/delete', { sessionId }); this.sessions.delete(sessionId); this.sessionConfig.delete(sessionId); }
  async unstableForkSession(sessionId: string, options: { cwd?: string; mcpServers?: acp.McpServer[] } = {}): Promise<acp.ForkSessionResponse> {
    const cwd = options.cwd ?? await this.originalSessionCwd(sessionId);
    const mcpServers = structuredClone(options.mcpServers ?? this.sessions.get(sessionId)?.mcpServers ?? this.options.mcpServers ?? []);
    const result = await this.request<acp.ForkSessionResponse>('session/fork', { sessionId, cwd, mcpServers });
    this.sessions.set(result.sessionId, { cwd, mcpServers });
    return result;
  }
  async setMode(sessionId: string, modeId: string): Promise<void> { await this.request('session/set_mode', { sessionId, modeId }); }
  async setConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse>;
  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<acp.SetSessionConfigOptionResponse>;
  async setConfigOption(...args: [acp.SetSessionConfigOptionRequest] | [string, string, string | boolean]): Promise<acp.SetSessionConfigOptionResponse> {
    const params = args.length === 1 ? args[0] : {
      sessionId: args[0], configId: args[1], value: args[2],
      ...(typeof args[2] === 'boolean' ? { type: 'boolean' as const } : {}),
    };
    const result = await this.request<acp.SetSessionConfigOptionResponse>('session/set_config_option', params);
    this.sessionConfig.set(params.sessionId, result.configOptions);
    return result;
  }
  async setModel(sessionId: string, modelId: string): Promise<acp.SetSessionConfigOptionResponse> {
    const option = this.sessionConfig.get(sessionId)?.find(o => o.category === 'model');
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
    this.updateListeners.clear(); this.errorListeners.clear(); this.closeListeners.clear();
    this.sessionConfig.clear();
    this.permissionHandler = null;
  }
  private async open(reconnecting = false): Promise<void> {
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
          ws.addEventListener?.('error', (error: unknown) => socketFailed(new CodingAgentAcpConnectionError('ACP socket failed before opening', { cause: error })));
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
      if (notification.update.sessionUpdate === 'config_option_update') {
        this.sessionConfig.set(notification.sessionId, notification.update.configOptions);
      }
      for (const listener of [this.options.onUpdate, ...this.updateListeners]) {
        callObserver(listener, notification);
      }
    };
    const productAttachment = (attachment: SessionAttachment) => {
      if (this.closedFlag || generation !== this.generation) return;
      for (const listener of this.attachmentListeners) callObserver(listener, attachment);
    };
    const productSnapshot = (snapshot: SessionSnapshot) => {
      if (this.closedFlag || generation !== this.generation) return;
      for (const listener of this.snapshotListeners) callObserver(listener, snapshot);
    };
    const connection = await this.observe('connect', async () => {
      const stream = createWebSocketStream(this.target.url, {
        WebSocket: TrackedSocket, cookieStore: this.cookieStore,
        headers: this.target.token ? { Authorization: `Bearer ${this.target.token}` } : undefined,
      });
      const pending = app.connect({ ...stream,
        // Upstream's active-session router validates an exhaustive update union.
        // Forward notifications untouched; RPCs/callbacks remain SDK-owned.
        readable: stream.readable.pipeThrough(new globalThis.TransformStream({ transform(frame, controller) {
          if (frame && typeof frame === 'object' && 'type' in frame && frame.type === 'sessionStartupError') {
            const failure = frame as unknown as { requestId?: unknown; error?: { code?: unknown; message?: unknown } };
            if ((typeof failure.requestId === 'string' || typeof failure.requestId === 'number')
                && failure.error?.code === 'unavailable' && typeof failure.error.message === 'string') {
              rejectStartup(pending, failure.requestId, failure.error.message);
            }
            return;
          }
          if (frame && typeof frame === 'object' && 'type' in frame && frame.type === 'sessionSnapshot') {
            const snapshot = frame as unknown as SessionSnapshot;
            if (typeof snapshot.sessionId === 'string'
                && (snapshot.fingerprint === null || typeof snapshot.fingerprint === 'string')) {
              productSnapshot(snapshot);
            }
            return;
          }
          if (frame && typeof frame === 'object' && 'type' in frame && frame.type === 'attachment') {
            const attachment = frame as unknown as SessionAttachment;
            if (typeof attachment.sessionId === 'string' && typeof attachment.id === 'string'
                && typeof attachment.agentId === 'string' && typeof attachment.file?.name === 'string'
                && typeof attachment.file.mimeType === 'string'
                && typeof attachment.file.uri === 'string' && typeof attachment.file.sha256 === 'string') {
              productAttachment(attachment);
            }
            return;
          }
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
      this.ready = false;
      ++this.generation;
      this.scheduleReconnect(closeInfo.code ?? 1006, closeInfo.reason);
    });
    try {
      const response = await this.observe('initialize', () => connection.agent.request('initialize', {
        protocolVersion: 1, clientCapabilities: this.options.clientCapabilities ?? {}, clientInfo: { name: this.options.clientInfo?.name ?? 'hypercli-ts-sdk', version: this.options.clientInfo?.version ?? '' },
      }));
      if (response.protocolVersion !== 1) throw new CodingAgentAcpConnectionError('ACP peer did not select v1');
      if (this.closedFlag || generation !== this.generation) throw new CodingAgentAcpConnectionError('ACP connect aborted');
      this.initializeValue = response;
      this.connection = connection;
      if (!reconnecting) this.markReady();
    } catch (error) { connection.close(error instanceof Error ? error : undefined); throw error; }
    finally { if (this.pendingConnection === connection) this.pendingConnection = null; }
  }
  private markReady(): void {
    this.ready = true;
    for (const waiter of this.connectedWaiters) waiter.resolve();
    this.connectedWaiters.clear();
  }
  private scheduleReconnect(code: number, reason: string): void {
    if (this.closedFlag) return;
    if (this.options.reconnect === false || TERMINAL_CODES.has(code) || this.failures >= ACP_RECONNECT_DELAYS_MS.length) {
      this.terminalError = new CodingAgentAcpConnectionError('ACP connection closed', { code });
      const listeners = [...this.closeListeners];
      this.close();
      for (const listener of [this.options.onClose, ...listeners]) callObserver(listener, { code, reason });
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open(true).then(async () => {
        const connection = this.connection, generation = this.generation;
        const ownsConnection = () => !this.closedFlag && connection === this.connection && generation === this.generation;
        this.failures = 0;
        try { await this.options.onReconnect?.(); }
        catch (error) {
          const failure = error instanceof Error ? error : new CodingAgentAcpConnectionError('ACP reconnect callback failed', { cause: error });
          if (ownsConnection()) for (const listener of [this.options.onError, ...this.errorListeners]) callObserver(listener, failure);
        }
        for (const [sid, setup] of this.sessions) {
          if (!ownsConnection()) return;
          try { await this.resumeSession(sid, { cwd: setup.cwd }); }
          catch (error) {
            if (!ownsConnection()) return;
            if (!(error instanceof CodingAgentAcpRequestError) && !(error instanceof CodingAgentSessionStartupError)) {
              connection?.close(error instanceof Error ? error : undefined);
              return;
            }
            this.sessions.delete(sid);
            const gap = new CodingAgentAcpAttachmentError(sid, error.message, { cause: error });
            for (const waiter of this.connectedWaiters) waiter.reject(gap);
            this.connectedWaiters.clear();
            for (const listener of [this.options.onError, ...this.errorListeners]) callObserver(listener, gap);
          }
        }
        if (ownsConnection()) this.markReady();
      }, () => this.scheduleReconnect(code, reason));
    }, ACP_RECONNECT_DELAYS_MS[this.failures++]);
  }
}
