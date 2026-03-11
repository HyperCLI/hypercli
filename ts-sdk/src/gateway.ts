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
  /** JWT Bearer token for authentication */
  token: string;
  /** Gateway auth token for challenge-response (default: "traefik-forwarded-auth-not-used") */
  gatewayToken?: string;
  /** Client ID (default: "openclaw-control-ui") */
  clientId?: string;
  /** Client mode (default: "webchat") */
  clientMode?: string;
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

export type GatewayEventHandler = (event: GatewayEvent) => void;

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT = 15000;
const CHAT_TIMEOUT = 120000;

function makeId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export class GatewayClient {
  private url: string;
  private token: string;
  private gatewayToken: string;
  private clientId: string;
  private clientMode: string;
  private origin: string;
  private defaultTimeout: number;
  private ws: WebSocket | null = null;
  private pending: Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private eventHandlers: Set<GatewayEventHandler> = new Set();
  private connected = false;
  private _version: string | null = null;
  private _protocol: number | null = null;

  constructor(options: GatewayOptions) {
    this.url = options.url;
    this.token = options.token;
    this.gatewayToken = options.gatewayToken ?? 'traefik-forwarded-auth-not-used';
    this.clientId = options.clientId ?? 'openclaw-control-ui';
    this.clientMode = options.clientMode ?? 'webchat';
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
    const wsUrl = `${this.url}${this.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;

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
                version: 'hypercli-ts-sdk',
                platform: 'browser',
                mode: this.clientMode,
              },
              auth: { token: this.gatewayToken },
              role: 'operator',
              scopes: ['operator.admin'],
              caps: ['tool-events'],
            },
          };
          ws.send(JSON.stringify(connectReq));
          return;
        }

        if (handshakePhase === 'hello') {
          if (msg.type === 'res') {
            if (msg.ok) {
              this._version = msg.payload?.version ?? null;
              this._protocol = msg.payload?.protocol ?? null;
              this.connected = true;
              // Switch to normal message handling
              ws.onmessage = this.handleMessage.bind(this);
              resolve();
            } else {
              reject(new Error(`Gateway connect failed: ${msg.error?.message ?? JSON.stringify(msg.error)}`));
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
        this.connected = false;
        // Reject all pending requests
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Connection closed'));
        }
        this.pending.clear();
      };
    });
  }

  /** Close the connection */
  close(): void {
    this.connected = false;
    this.ws?.close();
    this.ws = null;
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

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async configGet(): Promise<Record<string, any>> {
    return this.rpc('config.get');
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

  async filesList(agentId: string = 'main'): Promise<string[]> {
    const res = await this.rpc('agents.files.get', { agentId });
    return res?.files ?? [];
  }

  async fileGet(agentId: string, path: string): Promise<string> {
    const res = await this.rpc('agents.files.get', { agentId, path });
    return res?.content ?? '';
  }

  async fileSet(agentId: string, path: string, content: string): Promise<void> {
    await this.rpc('agents.files.set', { agentId, path, content });
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  async agentsList(): Promise<any[]> {
    const res = await this.rpc('agents.list');
    return res?.agents ?? res ?? [];
  }

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  async cronList(): Promise<any[]> {
    const res = await this.rpc('cron.list');
    return res?.jobs ?? res ?? [];
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async status(): Promise<Record<string, any>> {
    return this.rpc('status');
  }
}
