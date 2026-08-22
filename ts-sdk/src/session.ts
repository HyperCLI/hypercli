/**
 * Canonical runtime-neutral agent session surface.
 *
 * Every managed runtime that offers an interactive chat/session API exposes
 * the same verbs here: connect/close, sessions list-create-patch-delete,
 * chat history, streaming chat send, and abort. OpenClaw implements this over
 * its WebSocket gateway (see OpenClawSessionClient); Hermes implements it over
 * its HTTP/SSE API server (see HermesSessionClient). Event and message shapes
 * are canonicalized so consumers never branch on the runtime.
 */
import {
  HermesApiClient,
  type HermesApiClientOptions,
  type HermesSession,
  type HermesSseEvent,
} from './hermes/gateway.js';
import type {
  ChatAttachment,
  ChatEvent,
  GatewayChatToolCall,
  GatewayClient,
} from './openclaw/gateway.js';

export type AgentSessionState = 'disconnected' | 'connecting' | 'connected';

export interface AgentSessionSummary extends Record<string, unknown> {
  /** Canonical session identifier used by every other method. */
  key: string;
  sessionId?: string;
  label?: string | null;
  model?: string | null;
  /** The runtime-native session record, verbatim. */
  raw?: unknown;
}

export interface AgentSessionCreateParams {
  key?: string;
  label?: string;
  model?: string;
  systemPrompt?: string;
}

export interface AgentSessionPatch {
  key: string;
  label?: string | null;
  model?: string;
}

export interface AgentSessionMessage extends Record<string, unknown> {
  role: string;
  text: string;
  thinking?: string;
  toolCalls?: GatewayChatToolCall[];
  timestamp?: number;
  messageId?: string;
  /** The runtime-native message record, verbatim. */
  raw?: unknown;
}

export interface AgentSessionModel extends Record<string, unknown> {
  id: string;
  label?: string;
  raw?: unknown;
}

export interface AgentChatSendOptions {
  attachments?: ChatAttachment[];
  model?: string;
  systemMessage?: string;
  signal?: AbortSignal;
}

export interface AgentSessionConnectOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injected fetch implementation (tests, non-standard runtimes). */
  fetch?: typeof globalThis.fetch;
}

/**
 * The canonical session client contract. Both runtime clients satisfy this;
 * `native` exposes the underlying transport client for runtime-specific
 * operations outside the canonical surface.
 */
export interface AgentSessionClient {
  readonly runtimeKind: 'openclaw' | 'hermes';
  readonly state: AgentSessionState;
  readonly connected: boolean;
  readonly native: unknown;
  connect(options?: AgentSessionConnectOptions): Promise<void>;
  close(): void;
  sessionsList(): Promise<AgentSessionSummary[]>;
  sessionsCreate(params?: AgentSessionCreateParams): Promise<AgentSessionSummary>;
  sessionsPatch(patch: AgentSessionPatch): Promise<AgentSessionSummary>;
  sessionsDelete(sessionKey: string): Promise<void>;
  chatHistory(sessionKey?: string, limit?: number): Promise<AgentSessionMessage[]>;
  chatSend(
    message: string,
    sessionKey: string,
    options?: AgentChatSendOptions,
  ): AsyncGenerator<ChatEvent>;
  chatAbort(sessionKey?: string, runId?: string): Promise<void>;
  modelsList(): Promise<AgentSessionModel[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function timestampFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function mapHermesSession(session: HermesSession): AgentSessionSummary {
  return {
    key: session.id,
    sessionId: session.id,
    label: session.title ?? null,
    model: session.model ?? null,
    source: session.source,
    raw: session,
  };
}

function mapHermesMessage(message: Record<string, unknown>): AgentSessionMessage {
  const content = message.content ?? message.text;
  return {
    role: typeof message.role === 'string' ? message.role : 'assistant',
    text: textFromUnknown(content),
    ...(typeof message.reasoning === 'string' && message.reasoning
      ? { thinking: message.reasoning }
      : {}),
    ...(timestampFromUnknown(message.created_at ?? message.ts ?? message.timestamp) !== undefined
      ? { timestamp: timestampFromUnknown(message.created_at ?? message.ts ?? message.timestamp) }
      : {}),
    ...(typeof message.id === 'string' ? { messageId: message.id } : {}),
    raw: message,
  };
}

function mapOpenClawSession(session: unknown): AgentSessionSummary {
  const record = isRecord(session) ? session : {};
  const key = typeof record.key === 'string'
    ? record.key
    : typeof record.sessionKey === 'string'
      ? record.sessionKey
      : typeof record.sessionId === 'string'
        ? record.sessionId
        : '';
  return {
    ...record,
    key,
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
    label: typeof record.label === 'string'
      ? record.label
      : typeof record.displayName === 'string'
        ? record.displayName
        : null,
    model: typeof record.model === 'string' ? record.model : null,
    raw: session,
  };
}

function mapOpenClawMessage(message: unknown): AgentSessionMessage {
  if (!isRecord(message)) return { role: 'assistant', text: '', raw: message };
  return {
    ...message,
    role: typeof message.role === 'string' ? message.role : 'assistant',
    text: textFromUnknown(message.text ?? message.content),
    raw: message,
  };
}

/**
 * Canonical session client for a Hermes agent, backed by its HTTP/SSE API
 * server. The transport is stateless; `connect()` proves reachability and
 * authorization once, and every later call stands alone.
 */
export class HermesSessionClient implements AgentSessionClient {
  readonly runtimeKind = 'hermes' as const;
  readonly native: HermesApiClient;
  private currentState: AgentSessionState = 'disconnected';
  private activeRunId: string | null = null;

  constructor(baseUrl: string, options: HermesApiClientOptions = {}) {
    this.native = new HermesApiClient(baseUrl, options);
  }

  get state(): AgentSessionState {
    return this.currentState;
  }

  get connected(): boolean {
    return this.currentState === 'connected';
  }

  async connect(options: AgentSessionConnectOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Hermes session connect cancelled');
    }
    this.currentState = 'connecting';
    try {
      // /health is unauthenticated liveness; /v1/capabilities proves the
      // bearer key is accepted before any chat surface opens.
      await this.native.health();
      await this.native.capabilities();
      this.currentState = 'connected';
    } catch (error) {
      this.currentState = 'disconnected';
      throw error;
    }
  }

  close(): void {
    this.activeRunId = null;
    this.currentState = 'disconnected';
  }

  async sessionsList(): Promise<AgentSessionSummary[]> {
    const response = await this.native.listSessions({ includeChildren: true });
    return (response.data ?? []).map(mapHermesSession);
  }

  async sessionsCreate(params: AgentSessionCreateParams = {}): Promise<AgentSessionSummary> {
    const response = await this.native.createSession({
      ...(params.key ? { id: params.key } : {}),
      ...(params.label ? { title: params.label } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.systemPrompt ? { system_prompt: params.systemPrompt } : {}),
      source: 'api_server',
    });
    return mapHermesSession(response.session);
  }

  async sessionsPatch(patch: AgentSessionPatch): Promise<AgentSessionSummary> {
    let session: HermesSession | null = null;
    if (patch.label !== undefined) {
      session = (await this.native.updateSession(patch.key, { title: patch.label })).session;
    }
    if (patch.model !== undefined) {
      await this.native.lockSessionModel(patch.key, { model: patch.model });
      session = (await this.native.getSession(patch.key)).session;
    }
    if (!session) session = (await this.native.getSession(patch.key)).session;
    return mapHermesSession(session);
  }

  async sessionsDelete(sessionKey: string): Promise<void> {
    await this.native.deleteSession(sessionKey);
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<AgentSessionMessage[]> {
    if (!sessionKey) return [];
    const response = await this.native.sessionMessages(sessionKey);
    const records = response.data ?? response.messages ?? [];
    const mapped = records.filter(isRecord).map(mapHermesMessage);
    return limit > 0 && mapped.length > limit ? mapped.slice(mapped.length - limit) : mapped;
  }

  async *chatSend(
    message: string,
    sessionKey: string,
    options: AgentChatSendOptions = {},
  ): AsyncGenerator<ChatEvent> {
    if (!sessionKey) throw new Error('Hermes chat send requires a session key');
    let runId = '';
    let messageId: string | undefined;
    const identity = (): Pick<ChatEvent, 'runId' | 'messageId' | 'sessionKey'> => ({
      ...(runId ? { runId } : {}),
      ...(messageId ? { messageId } : {}),
      sessionKey,
    });
    const stream = this.native.streamSessionChat(sessionKey, {
      message,
      ...(options.model ? { model: options.model } : {}),
      ...(options.systemMessage ? { system_message: options.systemMessage } : {}),
    });
    for await (const frame of stream) {
      if (options.signal?.aborted) {
        await this.chatAbort(sessionKey, runId || undefined).catch(() => undefined);
        return;
      }
      const payload = isRecord(frame.data) ? frame.data : {};
      if (frame.event === 'run.started') {
        if (typeof payload.run_id === 'string' && payload.run_id) {
          runId = payload.run_id;
          this.activeRunId = runId;
        }
        continue;
      }
      if (frame.event === 'message.started') {
        const started = isRecord(payload.message) ? payload.message : {};
        if (typeof started.id === 'string' && started.id) messageId = started.id;
        continue;
      }
      if (frame.event === 'done') continue;
      const event = this.mapStreamEvent(frame, identity);
      if (!event) continue;
      yield event;
      if (event.type === 'done' || event.type === 'error') return;
    }
  }

  /**
   * Map one Hermes SSE frame to the canonical chat event vocabulary.
   * Terminal handling: `run.completed` emits `done`; the trailing `done`
   * frame and lifecycle frames (`run.started`, `message.started`) only
   * update correlation identity.
   */
  private mapStreamEvent(
    frame: HermesSseEvent,
    identity: () => Pick<ChatEvent, 'runId' | 'messageId' | 'sessionKey'>,
  ): ChatEvent | null {
    const payload = isRecord(frame.data) ? frame.data : {};
    switch (frame.event) {
      case 'run.started': {
        if (typeof payload.run_id === 'string' && payload.run_id) {
          this.activeRunId = payload.run_id;
        }
        return null;
      }
      case 'message.started': {
        return null;
      }
      case 'assistant.delta': {
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        return delta ? { type: 'content', text: delta, ...identity() } : null;
      }
      case 'assistant.completed': {
        const content = typeof payload.content === 'string' ? payload.content : '';
        return { type: 'content', text: content, replace: true, ...identity() };
      }
      case 'tool.progress': {
        const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        if (toolName === '_thinking') {
          return delta ? { type: 'thinking', text: delta, ...identity() } : null;
        }
        return {
          type: 'tool_call',
          data: { name: toolName, progress: delta },
          ...identity(),
        };
      }
      case 'tool.started': {
        return {
          type: 'tool_call',
          data: { name: payload.tool_name, args: payload.args, preview: payload.preview },
          ...identity(),
        };
      }
      case 'tool.completed':
      case 'tool.failed': {
        return {
          type: 'tool_result',
          data: {
            name: payload.tool_name,
            preview: payload.preview,
            ...(frame.event === 'tool.failed' ? { error: true } : {}),
          },
          ...identity(),
        };
      }
      case 'run.completed': {
        this.activeRunId = null;
        return {
          type: 'done',
          data: {
            usage: payload.usage,
            runtime: payload.runtime,
            messages: payload.messages,
            ...(payload.pending_steer !== undefined ? { pending_steer: payload.pending_steer } : {}),
          },
          ...identity(),
        };
      }
      case 'error': {
        this.activeRunId = null;
        return {
          type: 'error',
          text: typeof payload.message === 'string' ? payload.message : 'Hermes run failed',
          ...identity(),
        };
      }
      case 'done': {
        return null;
      }
      default: {
        // Unknown future events surface verbatim instead of vanishing.
        return { type: 'content', text: '', data: { event: frame.event, payload: frame.data }, ...identity() };
      }
    }
  }

  async chatAbort(_sessionKey?: string, runId?: string): Promise<void> {
    const resolvedRunId = runId ?? this.activeRunId;
    if (!resolvedRunId) {
      throw new Error('Hermes chat abort requires an active run id');
    }
    await this.native.stopRun(resolvedRunId);
    this.activeRunId = null;
  }

  async modelsList(): Promise<AgentSessionModel[]> {
    const response = await this.native.models();
    return (response.data ?? []).map((model) => ({
      id: model.id,
      label: model.id,
      owned_by: model.owned_by,
      raw: model,
    }));
  }
}

/**
 * Canonical view over an OpenClaw WebSocket gateway client. The native client
 * remains reachable through `native` for OpenClaw-only operations (config,
 * channels, skills, desktop).
 */
export class OpenClawSessionClient implements AgentSessionClient {
  readonly runtimeKind = 'openclaw' as const;
  readonly native: GatewayClient;

  constructor(native: GatewayClient) {
    this.native = native;
  }

  get state(): AgentSessionState {
    const nativeState = this.native.state;
    if (nativeState === 'connected') return 'connected';
    if (nativeState === 'disconnected') return 'disconnected';
    return 'connecting';
  }

  get connected(): boolean {
    return this.native.isConnected;
  }

  async connect(options: AgentSessionConnectOptions = {}): Promise<void> {
    await this.native.connect({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  close(): void {
    this.native.close();
  }

  async sessionsList(): Promise<AgentSessionSummary[]> {
    return (await this.native.sessionsList()).map(mapOpenClawSession);
  }

  async sessionsCreate(params: AgentSessionCreateParams = {}): Promise<AgentSessionSummary> {
    const result = await this.native.sessionsCreate({
      ...(params.key ? { key: params.key } : {}),
      ...(params.label ? { label: params.label } : {}),
      ...(params.model ? { model: params.model } : {}),
    });
    return {
      key: result.key,
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      label: params.label ?? null,
      model: params.model ?? null,
      raw: result,
    };
  }

  async sessionsPatch(patch: AgentSessionPatch): Promise<AgentSessionSummary> {
    await this.native.sessionsPatch({
      key: patch.key,
      ...(patch.model !== undefined ? { model: patch.model } : {}),
    });
    return { key: patch.key, label: patch.label ?? null, model: patch.model ?? null };
  }

  async sessionsDelete(sessionKey: string): Promise<void> {
    await this.native.sessionsReset(sessionKey, 'new');
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<AgentSessionMessage[]> {
    return (await this.native.chatHistory(sessionKey, limit)).map(mapOpenClawMessage);
  }

  async *chatSend(
    message: string,
    sessionKey: string,
    options: AgentChatSendOptions = {},
  ): AsyncGenerator<ChatEvent> {
    yield* this.native.chatSend(message, sessionKey, options.attachments);
  }

  async chatAbort(sessionKey?: string, runId?: string): Promise<void> {
    await this.native.chatAbort(sessionKey, runId);
  }

  async modelsList(): Promise<AgentSessionModel[]> {
    return (await this.native.modelsList()).map((model: unknown) => {
      const record = isRecord(model) ? model : {};
      const id = typeof record.id === 'string'
        ? record.id
        : typeof record.value === 'string'
          ? record.value
          : '';
      return {
        ...record,
        id,
        label: typeof record.label === 'string' ? record.label : id,
        raw: model,
      };
    });
  }
}
