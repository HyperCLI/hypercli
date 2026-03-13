/**
 * Browser wrapper around the shared TS SDK gateway client.
 *
 * The app keeps its existing convenience methods, but the WebSocket handshake
 * and auth behavior come from the tested SDK implementation.
 */

import {
  GatewayClient as SDKGatewayClient,
  type ChatAttachment,
  type ChatEvent,
  type GatewayEvent,
  type GatewayOptions,
} from "@hypercli/sdk/gateway";

const CHAT_TIMEOUT = 300_000;
const DEFAULT_TIMEOUT = 15_000;

export type { ChatEvent };

export interface GatewayError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GatewayConfig {
  url: string;
  token?: string;
  gatewayToken?: string;
  clientId?: string;
  clientMode?: string;
}

type EventHandler = (event: string, payload: Record<string, unknown>) => void;

export class GatewayClient {
  private readonly sdk: SDKGatewayClient;

  constructor(config: GatewayConfig) {
    const options: GatewayOptions = {
      url: config.url,
      token: config.token,
      gatewayToken: config.gatewayToken,
      clientId: config.clientId,
      clientMode: config.clientMode,
      timeout: DEFAULT_TIMEOUT,
    };
    this.sdk = new SDKGatewayClient(options);
  }

  get connected() {
    return this.sdk.isConnected;
  }

  get version() {
    return this.sdk.version;
  }

  get protocol() {
    return this.sdk.protocol;
  }

  get onDisconnect() {
    return this.sdk.onDisconnect;
  }

  set onDisconnect(handler: (() => void) | null) {
    this.sdk.onDisconnect = handler;
  }

  connect(): Promise<void> {
    return this.sdk.connect();
  }

  close() {
    this.sdk.close();
  }

  onEvent(handler: EventHandler) {
    return this.sdk.onEvent((event: GatewayEvent) => {
      handler(event.event, event.payload ?? {});
    });
  }

  async call<T = any>(
    method: string,
    params?: Record<string, unknown>,
    timeout = DEFAULT_TIMEOUT,
  ): Promise<T> {
    return this.sdk.request<T>(method, params ?? {}, timeout);
  }

  async configGet(): Promise<Record<string, unknown>> {
    const r = await this.call<any>("config.get");
    if (r.parsed) return r.parsed;
    if (r.raw) {
      try {
        return JSON.parse(r.raw);
      } catch {
        // fall through
      }
    }
    return r.config ?? r;
  }

  async configSchema(): Promise<Record<string, unknown>> {
    return this.call("config.schema");
  }

  async configPatch(patch: Record<string, unknown>): Promise<void> {
    await this.call("config.patch", { patch }, 30_000);
  }

  async modelsList(): Promise<any[]> {
    const r = await this.call<any>("models.list");
    return r.models ?? [];
  }

  async agentsList(): Promise<any[]> {
    const r = await this.call<any>("agents.list");
    const agents = r.agents ?? [];
    return agents.map((a: any) => ({ ...a, id: a.agentId ?? a.id }));
  }

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

  async chatSend(
    message: string,
    sessionKey?: string,
    agentId?: string,
    attachments?: Array<{ type: string; mimeType: string; content: string; fileName?: string }>,
  ): Promise<any> {
    return this.sdk.sendChat(
      message,
      sessionKey ?? "main",
      agentId,
      attachments as ChatAttachment[] | undefined,
    );
  }

  async chatAbort(sessionKey?: string): Promise<void> {
    const params: Record<string, unknown> = {};
    if (sessionKey) params.sessionKey = sessionKey;
    await this.call("chat.abort", params);
  }

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

  async execApprove(execId: string): Promise<void> {
    await this.call("exec.approve", { execId });
  }

  async execDeny(execId: string): Promise<void> {
    await this.call("exec.deny", { execId });
  }
}
