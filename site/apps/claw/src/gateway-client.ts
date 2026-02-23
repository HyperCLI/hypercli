/**
 * OpenClaw Gateway Client — Browser WebSocket client for OpenClaw Gateway protocol v3.
 *
 * Thin client (~200 lines) implementing the core RPC + event streaming protocol.
 * Designed for the HyperClaw frontend three-panel UI.
 */

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT = 15_000;
const CHAT_TIMEOUT = 300_000;

export interface GatewayError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ChatEvent {
  type: "content" | "thinking" | "tool_call" | "tool_result" | "done" | "error" | "status";
  text?: string;
  data?: Record<string, unknown>;
}

export interface GatewayConfig {
  url: string;
  token: string;
  gatewayToken?: string;
  clientId?: string;
  clientMode?: string;
}

type EventHandler = (event: string, payload: Record<string, unknown>) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private eventHandlers: EventHandler[] = [];
  private config: Required<GatewayConfig>;
  private _connected = false;
  private _version: string | null = null;
  private _protocol: number | null = null;

  constructor(config: GatewayConfig) {
    this.config = {
      gatewayToken: "traefik-forwarded-auth-not-used",
      clientId: "webchat-ui",
      clientMode: "webchat",
      ...config,
    };
  }

  get connected() { return this._connected; }
  get version() { return this._version; }
  get protocol() { return this._protocol; }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Append token as query param for browsers (no custom headers on WS)
      const sep = this.config.url.includes("?") ? "&" : "?";
      const url = `${this.config.url}${sep}token=${encodeURIComponent(this.config.token)}`;

      this.ws = new WebSocket(url);

      let handshakePhase: "challenge" | "hello" | "done" = "challenge";
      const timeout = setTimeout(() => {
        reject(new Error("Gateway handshake timeout"));
        this.ws?.close();
      }, DEFAULT_TIMEOUT);

      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);

        if (handshakePhase === "challenge") {
          if (msg.event !== "connect.challenge") {
            clearTimeout(timeout);
            reject(new Error(`Expected connect.challenge, got ${msg.event}`));
            return;
          }
          handshakePhase = "hello";
          this.ws!.send(JSON.stringify({
            type: "req",
            id: this.makeId(),
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: this.config.clientId,
                version: "hyperclaw-frontend",
                platform: "browser",
                mode: this.config.clientMode,
              },
              auth: { token: this.config.gatewayToken },
              role: "operator",
              scopes: ["operator.admin"],
              caps: ["tool-events"],
            },
          }));
          return;
        }

        if (handshakePhase === "hello") {
          clearTimeout(timeout);
          if (msg.ok) {
            this._connected = true;
            this._version = msg.payload?.version ?? null;
            this._protocol = msg.payload?.protocol ?? null;
            handshakePhase = "done";
            // Switch to normal message handler
            this.ws!.onmessage = (ev2) => this.handleMessage(JSON.parse(ev2.data));
            resolve();
          } else {
            reject(new Error(msg.error?.message ?? "Connection rejected"));
          }
          return;
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };

      this.ws.onclose = () => {
        this._connected = false;
        // Reject all pending
        for (const [, { reject: rej, timer }] of this.pending) {
          clearTimeout(timer);
          rej(new Error("Connection closed"));
        }
        this.pending.clear();
      };
    });
  }

  close() {
    this._connected = false;
    this.ws?.close();
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private makeId(): string {
    return crypto.randomUUID();
  }

  private handleMessage(msg: any) {
    if (msg.type === "res") {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);
        entry.resolve(msg);
      }
    } else if (msg.type === "event") {
      for (const h of this.eventHandlers) {
        try { h(msg.event, msg.payload ?? {}); } catch { /* ignore */ }
      }
    }
  }

  // -----------------------------------------------------------------------
  // RPC
  // -----------------------------------------------------------------------

  async call<T = any>(method: string, params?: Record<string, unknown>, timeout = DEFAULT_TIMEOUT): Promise<T> {
    if (!this._connected || !this.ws) throw new Error("Not connected");

    const id = this.makeId();
    const req = { type: "req", id, method, ...(params ? { params } : {}) };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timed out`));
      }, timeout);

      this.pending.set(id, {
        resolve: (resp: any) => {
          if (resp.ok) resolve(resp.payload);
          else reject(new Error(resp.error?.message ?? `RPC ${method} failed`));
        },
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(req));
    });
  }

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  async configGet(): Promise<Record<string, unknown>> {
    const r = await this.call<any>("config.get");
    return r.config ?? r;
  }

  async configSchema(): Promise<Record<string, unknown>> {
    return this.call("config.schema");
  }

  async configPatch(patch: Record<string, unknown>): Promise<void> {
    await this.call("config.patch", { patch }, 30_000);
  }

  // -----------------------------------------------------------------------
  // Models
  // -----------------------------------------------------------------------

  async modelsList(): Promise<any[]> {
    const r = await this.call<any>("models.list");
    return r.models ?? [];
  }

  // -----------------------------------------------------------------------
  // Agents
  // -----------------------------------------------------------------------

  async agentsList(): Promise<any[]> {
    const r = await this.call<any>("agents.list");
    return r.agents ?? [];
  }

  // -----------------------------------------------------------------------
  // Files
  // -----------------------------------------------------------------------

  async filesList(agentId: string): Promise<any[]> {
    const r = await this.call<any>("agents.files.list", { agentId });
    return r.files ?? [];
  }

  async fileGet(agentId: string, name: string): Promise<string> {
    const r = await this.call<any>("agents.files.get", { agentId, name });
    return r.content ?? "";
  }

  async fileSet(agentId: string, name: string, content: string): Promise<void> {
    await this.call("agents.files.set", { agentId, name, content });
  }

  // -----------------------------------------------------------------------
  // Sessions / Chat
  // -----------------------------------------------------------------------

  async sessionsList(limit = 20): Promise<any[]> {
    const r = await this.call<any>("sessions.list", { limit });
    return r.sessions ?? [];
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<any[]> {
    const params: Record<string, unknown> = { limit };
    if (sessionKey) params.sessionKey = sessionKey;
    const r = await this.call<any>("chat.history", params);
    return r.messages ?? [];
  }

  /**
   * Send a chat message. Subscribe to events before calling this
   * to receive streaming content.
   *
   * Events emitted: chat.content, chat.thinking, chat.tool_call,
   * chat.tool_result, chat.done, chat.error, chat.status
   */
  async chatSend(message: string, sessionKey?: string, agentId?: string): Promise<any> {
    const params: Record<string, unknown> = { message };
    if (sessionKey) params.sessionKey = sessionKey;
    if (agentId) params.agentId = agentId;
    return this.call("chat.send", params, CHAT_TIMEOUT);
  }

  async chatAbort(sessionKey?: string): Promise<void> {
    const params: Record<string, unknown> = {};
    if (sessionKey) params.sessionKey = sessionKey;
    await this.call("chat.abort", params);
  }

  // -----------------------------------------------------------------------
  // Cron
  // -----------------------------------------------------------------------

  async cronList(): Promise<any[]> {
    const r = await this.call<any>("cron.list");
    return r.jobs ?? [];
  }

  async cronAdd(job: Record<string, unknown>): Promise<any> {
    return this.call("cron.add", { job });
  }

  async cronRemove(jobId: string): Promise<void> {
    await this.call("cron.remove", { jobId });
  }

  // -----------------------------------------------------------------------
  // Exec approvals
  // -----------------------------------------------------------------------

  async execApprove(execId: string): Promise<void> {
    await this.call("exec.approve", { execId });
  }

  async execDeny(execId: string): Promise<void> {
    await this.call("exec.deny", { execId });
  }
}
