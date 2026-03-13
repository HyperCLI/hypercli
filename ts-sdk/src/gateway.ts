/**
 * OpenClaw Gateway WebSocket Client
 * 
 * Connects to an agent's OpenClaw gateway over WebSocket for real-time
 * configuration, chat, session management, and file operations.
 * 
 * Protocol: OpenClaw Gateway v3
 */

export interface GatewayOptions {
  /** WebSocket URL (wss://openclaw-{agent}.hypercli.com) */
  url: string;
  /** Optional legacy query token for edge/proxy auth. Gateway auth uses `gatewayToken`. */
  token?: string;
  /** Shared gateway auth token used in the WebSocket connect handshake. */
  gatewayToken?: string;
  /** Client ID (default: "gateway-client") */
  clientId?: string;
  /** Client mode (default: "ui") */
  clientMode?: string;
  /** Optional client display name */
  clientDisplayName?: string;
  /** Client version sent to the gateway */
  clientVersion?: string;
  /** Client platform sent to the gateway */
  platform?: string;
  /** Optional client instance ID */
  instanceId?: string;
  /** Optional gateway capability list */
  caps?: string[];
  /** Origin header (default: "https://hypercli.com") */
  origin?: string;
  /** Default RPC timeout in ms (default: 15000) */
  timeout?: number;
}

export interface GatewayEvent {
  type: string;
  event: string;
  payload: Record<string, any>;
  seq?: number;
}

export interface ChatEvent {
  type: 'content' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error';
  text?: string;
  data?: Record<string, any>;
}

export interface ChatAttachment {
  type: string;
  mimeType: string;
  content: string;
  fileName?: string;
}

export type GatewayEventHandler = (event: GatewayEvent) => void;

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT = 15000;
const CHAT_TIMEOUT = 120000;
const DEFAULT_CLIENT_ID = 'gateway-client';
const DEFAULT_CLIENT_MODE = 'ui';
const DEFAULT_CLIENT_VERSION = '@hypercli/sdk';
const DEFAULT_CAPS = ['tool-events'];
const VALID_CLIENT_IDS = new Set([
  'webchat-ui',
  'openclaw-control-ui',
  'webchat',
  'cli',
  'gateway-client',
  'openclaw-macos',
  'openclaw-ios',
  'openclaw-android',
  'node-host',
  'test',
  'fingerprint',
  'openclaw-probe',
]);
const VALID_CLIENT_MODES = new Set([
  'webchat',
  'cli',
  'ui',
  'backend',
  'node',
  'probe',
  'test',
]);

function makeId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function normalizeClientId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_IDS.has(normalized) ? normalized : DEFAULT_CLIENT_ID;
}

function normalizeClientMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_MODES.has(normalized) ? normalized : DEFAULT_CLIENT_MODE;
}

function resolvePlatform(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  const browserNavigator = (globalThis as typeof globalThis & {
    navigator?: { platform?: string };
  }).navigator;
  if (browserNavigator?.platform) return browserNavigator.platform;
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  return 'unknown';
}

export class GatewayClient {
  private url: string;
  private token?: string;
  private gatewayToken?: string;
  private clientId: string;
  private clientMode: string;
  private clientDisplayName?: string;
  private clientVersion: string;
  private clientPlatform: string;
  private clientInstanceId?: string;
  private caps: string[];
  private origin: string;
  private defaultTimeout: number;
  private ws: WebSocket | null = null;
  private pending: Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private eventHandlers: Set<GatewayEventHandler> = new Set();
  private expectedCloseSockets = new WeakSet<WebSocket>();
  private connected = false;
  private _version: string | null = null;
  private _protocol: number | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(options: GatewayOptions) {
    this.url = options.url;
    this.token = options.token?.trim() || undefined;
    this.gatewayToken = options.gatewayToken?.trim() || undefined;
    this.clientId = normalizeClientId(options.clientId);
    this.clientMode = normalizeClientMode(options.clientMode);
    this.clientDisplayName = options.clientDisplayName?.trim() || undefined;
    this.clientVersion = options.clientVersion?.trim() || DEFAULT_CLIENT_VERSION;
    this.clientPlatform = resolvePlatform(options.platform);
    this.clientInstanceId = options.instanceId?.trim() || makeId();
    this.caps = Array.isArray(options.caps)
      ? options.caps.map((cap) => cap.trim()).filter(Boolean)
      : [...DEFAULT_CAPS];
    this.origin = options.origin ?? 'https://hypercli.com';
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  get version() { return this._version; }
  get protocol() { return this._protocol; }
  get isConnected() { return this.connected; }

  /** Subscribe to server-sent events */
  onEvent(handler: GatewayEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Connect and perform challenge-response handshake */
  async connect(): Promise<void> {
    if (!this.gatewayToken) {
      throw new Error('Gateway token required. Resolve OPENCLAW_GATEWAY_TOKEN before connecting.');
    }
    const wsUrl = this.token
      ? `${this.url}${this.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`
      : this.url;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let handshakePhase: 'challenge' | 'hello' = 'challenge';

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (handshakePhase === 'challenge') {
          // Expect connect.challenge
          if (msg.event !== 'connect.challenge') {
            reject(new Error(`Expected connect.challenge, got ${msg.event}`));
            this.expectedCloseSockets.add(ws);
            ws.close();
            return;
          }
          handshakePhase = 'hello';

          // Send connect request
          const connectReq = {
            type: 'req',
            id: makeId(),
            method: 'connect',
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: this.clientId,
                ...(this.clientDisplayName ? { displayName: this.clientDisplayName } : {}),
                version: this.clientVersion,
                platform: this.clientPlatform,
                mode: this.clientMode,
                ...(this.clientInstanceId ? { instanceId: this.clientInstanceId } : {}),
              },
              auth: { token: this.gatewayToken },
              role: 'operator',
              scopes: ['operator.admin'],
              caps: this.caps,
            },
          };
          ws.send(JSON.stringify(connectReq));
          return;
        }

        if (handshakePhase === 'hello') {
          if (msg.type === 'res') {
            if (msg.ok) {
              this._version = msg.payload?.server?.version ?? msg.payload?.version ?? null;
              this._protocol = msg.payload?.protocol ?? null;
              this.connected = true;
              // Switch to normal message handling
              ws.onmessage = this.handleMessage.bind(this);
              resolve();
            } else {
              reject(new Error(`Gateway connect failed: ${msg.error?.message ?? JSON.stringify(msg.error)}`));
              this.expectedCloseSockets.add(ws);
              ws.close();
            }
          }
          return;
        }
      };

      ws.onerror = (err) => {
        reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = () => {
        const expectedClose = this.expectedCloseSockets.has(ws);
        this.expectedCloseSockets.delete(ws);
        const shouldFinalizeCurrentConnection =
          this.ws === ws || (expectedClose && this.ws === null);

        if (shouldFinalizeCurrentConnection) {
          this.connected = false;
          this.ws = null;
          for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error('Connection closed'));
          }
          this.pending.clear();
        }

        if (!expectedClose && shouldFinalizeCurrentConnection) {
          this.onDisconnect?.();
        }
      };
    });
  }

  /** Close the connection */
  close(): void {
    const ws = this.ws;
    this.connected = false;
    this.ws = null;
    if (!ws) return;
    this.expectedCloseSockets.add(ws);
    ws.close();
  }

  // ---------------------------------------------------------------------------
  // RPC
  // ---------------------------------------------------------------------------

  private handleMessage(event: MessageEvent): void {
    const msg = JSON.parse(event.data);

    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) {
          p.resolve(msg.payload);
        } else {
          p.reject(new Error(`[${msg.error?.code}] ${msg.error?.message}`));
        }
      }
    } else if (msg.type === 'event') {
      for (const handler of this.eventHandlers) {
        try { handler(msg); } catch {}
      }
    }
  }

  private rpc(method: string, params: Record<string, any> = {}, timeout?: number): Promise<any> {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('Not connected'));
    }

    const id = makeId();
    const req = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout ?? this.defaultTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(req));
    });
  }

  request<T = any>(method: string, params: Record<string, any> = {}, timeout?: number): Promise<T> {
    return this.rpc(method, params, timeout);
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async configGet(): Promise<Record<string, any>> {
    const res = await this.rpc('config.get');
    if (res?.parsed) return res.parsed;
    if (res?.raw) {
      try {
        return JSON.parse(res.raw);
      } catch {
        // Fall through to the raw payload.
      }
    }
    return res?.config ?? res ?? {};
  }

  async configSchema(): Promise<Record<string, any>> {
    return this.rpc('config.schema');
  }

  async configPatch(patch: Record<string, any>): Promise<void> {
    await this.rpc('config.patch', { patch });
  }

  async configSet(config: Record<string, any>): Promise<void> {
    await this.rpc('config.set', { config });
  }

  async modelsList(): Promise<any[]> {
    const res = await this.rpc('models.list');
    return res?.models ?? res ?? [];
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async sessionsList(): Promise<any[]> {
    const res = await this.rpc('sessions.list');
    return res?.sessions ?? res ?? [];
  }

  async sessionsPreview(sessionKey: string, limit = 20): Promise<any[]> {
    const res = await this.rpc('sessions.preview', { sessionKey, limit });
    return res?.messages ?? res ?? [];
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<any[]> {
    const params: Record<string, any> = { limit };
    if (sessionKey) params.sessionKey = sessionKey;
    const res = await this.rpc('chat.history', params);
    return res?.messages ?? res ?? [];
  }

  async chatAbort(sessionKey?: string): Promise<void> {
    const params: Record<string, any> = {};
    if (sessionKey) params.sessionKey = sessionKey;
    await this.rpc('chat.abort', params);
  }

  async sendChat(
    message: string,
    sessionKey = 'main',
    agentId?: string,
    attachments?: ChatAttachment[],
  ): Promise<any> {
    const params: Record<string, any> = {
      message,
      sessionKey,
      idempotencyKey: makeId(),
    };
    if (agentId) params.agentId = agentId;
    if (attachments && attachments.length > 0) params.attachments = attachments;
    return this.rpc('chat.send', params, CHAT_TIMEOUT);
  }

  async sessionsReset(sessionKey: string): Promise<void> {
    await this.rpc('sessions.reset', { sessionKey });
  }

  // ---------------------------------------------------------------------------
  // Chat (streaming via events)
  // ---------------------------------------------------------------------------

  async *chatSend(message: string, sessionKey: string): AsyncGenerator<ChatEvent> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }

    const id = makeId();
    const req = {
      type: 'req',
      id,
      method: 'chat.send',
      params: {
        message,
        sessionKey,
        idempotencyKey: makeId(),
      },
    };

    const events: ChatEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    // Temporary event handler for chat events
    const handler: GatewayEventHandler = (evt) => {
      if (evt.event?.startsWith('chat.')) {
        const payload = evt.payload ?? {};
        if (evt.event === 'chat.content') {
          events.push({ type: 'content', text: payload.text ?? '' });
        } else if (evt.event === 'chat.thinking') {
          events.push({ type: 'thinking', text: payload.text ?? '' });
        } else if (evt.event === 'chat.tool_call') {
          events.push({ type: 'tool_call', data: payload });
        } else if (evt.event === 'chat.tool_result') {
          events.push({ type: 'tool_result', data: payload });
        } else if (evt.event === 'chat.done') {
          events.push({ type: 'done' });
          done = true;
        } else if (evt.event === 'chat.error') {
          events.push({ type: 'error', text: payload.message ?? 'Unknown error' });
          done = true;
        }
        resolveWait?.();
      }
    };

    this.eventHandlers.add(handler);

    // Also listen for the RPC response
    const responsePromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        error = new Error('Chat timeout');
        done = true;
        resolveWait?.();
      }, CHAT_TIMEOUT);

      this.pending.set(id, {
        resolve: () => { clearTimeout(timer); done = true; resolveWait?.(); },
        reject: (e: any) => { clearTimeout(timer); error = e; done = true; resolveWait?.(); },
        timer,
      });
    });

    this.ws.send(JSON.stringify(req));

    try {
      while (!done || events.length > 0) {
        if (events.length > 0) {
          yield events.shift()!;
        } else if (!done) {
          await new Promise<void>((r) => { resolveWait = r; });
          resolveWait = null;
        }
      }
      if (error) throw error;
    } finally {
      this.eventHandlers.delete(handler);
      this.pending.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Files (agent workspace files)
  // ---------------------------------------------------------------------------

  async filesList(agentId: string = 'main'): Promise<any[]> {
    const res = await this.rpc('agents.files.list', { agentId });
    return res?.files ?? [];
  }

  async fileGet(agentId: string, name: string): Promise<string> {
    const res = await this.rpc('agents.files.get', { agentId, name });
    return res?.content ?? '';
  }

  async fileSet(agentId: string, name: string, content: string): Promise<void> {
    await this.rpc('agents.files.set', { agentId, name, content });
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  async agentsList(): Promise<any[]> {
    const res = await this.rpc('agents.list');
    const agents = res?.agents ?? res ?? [];
    return Array.isArray(agents)
      ? agents.map((agent: any) => ({ ...agent, id: agent?.agentId ?? agent?.id }))
      : [];
  }

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  async cronList(): Promise<any[]> {
    const res = await this.rpc('cron.list');
    return res?.jobs ?? res ?? [];
  }

  async cronAdd(job: Record<string, any>): Promise<any> {
    return this.rpc('cron.add', { job });
  }

  async cronRemove(jobId: string): Promise<void> {
    await this.rpc('cron.remove', { jobId });
  }

  async execApprove(execId: string): Promise<void> {
    await this.rpc('exec.approve', { execId });
  }

  async execDeny(execId: string): Promise<void> {
    await this.rpc('exec.deny', { execId });
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async status(): Promise<Record<string, any>> {
    return this.rpc('status');
  }
}
