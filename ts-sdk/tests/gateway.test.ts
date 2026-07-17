import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayClient, NodeServer, normalizeGatewayChatMessage } from "../src/openclaw/gateway.js";

const STORAGE_KEY = "openclaw.device.auth.v1";
const URL_SCOPE_KEY = "wss://openclaw-agent.example|operator";
const DEPLOYMENT_SCOPE_KEY = "deployment-123|operator";

class MockLocalStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  clear() {
    this.data.clear();
  }
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  public readonly url: string;
  public readyState = MockWebSocket.CONNECTING;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  public sent: string[] = [];
  public closedWith: { code?: number; reason?: string } | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitChallenge(nonce = "nonce-123") {
    this.emit({
      type: "event",
      event: "connect.challenge",
      payload: { nonce },
    });
  }

  emitHello(id: string, deviceToken = "device-token-1") {
    this.emit({
      type: "res",
      id,
      ok: true,
      payload: {
        protocol: 3,
        server: { version: "test-version" },
        auth: {
          deviceToken,
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    });
  }

  emitConnectError(
    id: string,
    code: string,
    message = "connect failed",
    details: Record<string, unknown> = { code },
  ) {
    this.emit({
      type: "res",
      id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message,
        details,
      },
    });
  }
}

async function flushMicrotasks(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function waitForSentFrame(ws: MockWebSocket) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ws.sent.length > 0) {
      return;
    }
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(ws.sent.length).toBeGreaterThan(0);
}

async function parseFirstRequest(ws: MockWebSocket) {
  await waitForSentFrame(ws);
  return JSON.parse(ws.sent[0] ?? "{}") as {
    id: string;
    method: string;
    params: Record<string, any>;
  };
}

describe("GatewayClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as any);
    vi.stubGlobal("localStorage", new MockLocalStorage() as any);
    vi.stubGlobal("crypto", webcrypto as any);
    vi.useRealTimers();
  });

  async function connectClient(client = new GatewayClient({
    url: "wss://openclaw-agent.example",
    gatewayToken: "gw-token",
  })) {
    const connectPromise = client.connect();
    await flushMicrotasks();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");

    ws.emitChallenge();
    await waitForSentFrame(ws);

    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await connectPromise;

    return { client, ws, request };
  }


  it("exposes connection state transitions", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const seen: string[] = [];
    const unsubscribe = client.onConnectionState((state) => seen.push(state));

    const connectPromise = client.connect();
    expect(client.state).toBe("connecting");
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge();
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await connectPromise;

    expect(client.state).toBe("connected");
    ws.close(1000, "bye");
    await flushMicrotasks();
    expect(seen).toContain("connecting");
    expect(seen).toContain("connected");
    expect(seen).toContain("disconnected");
    expect(["connecting", "disconnected"]).toContain(client.state);
    unsubscribe();
  });
  it("sends the CLI gateway handshake and stores the issued device token", async () => {
    const { client, request } = await connectClient();

    expect(request.method).toBe("connect");
    expect(request.params.minProtocol).toBe(3);
    expect(request.params.maxProtocol).toBe(4);
    expect(request.params.client.id).toBe("cli");
    expect(request.params.client.mode).toBe("cli");
    expect(request.params.role).toBe("operator");
    expect(request.params.scopes).toEqual([
      "operator.admin",
      "operator.approvals",
      "operator.pairing",
    ]);
    expect(request.params.auth.token).toBe("gw-token");
    expect(request.params.device.id).toMatch(/^[0-9a-f]{64}$/);
    expect(request.params.device.publicKey).toEqual(expect.any(String));
    expect(request.params.device.signature).toEqual(expect.any(String));
    expect(request.params.device.nonce).toBe("nonce-123");
    expect(client.isConnected).toBe(true);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.deviceId).toBe(request.params.device.id);
    expect(stored.publicKey).toBe(request.params.device.publicKey);
    expect(stored.tokens[URL_SCOPE_KEY].token).toBe("device-token-1");
    expect(stored.tokens[URL_SCOPE_KEY].scopes).toEqual(["operator.admin"]);
  });

  it("passes upstream gateway client metadata and auth fields through the handshake", async () => {
    const { request } = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deviceToken: "explicit-device-token",
      password: "password-token",
      approvalRuntimeToken: "approval-runtime-token",
      agentRuntimeIdentityToken: "agent-runtime-token",
      clientId: "openclaw-worker",
      clientMode: "worker",
      deviceFamily: "Linux",
      permissions: {
        screen: true,
        shell: false,
      },
      pathEnv: "/usr/local/bin:/usr/bin",
      minProtocol: 4,
      maxProtocol: 4,
    }));

    expect(request.params.minProtocol).toBe(4);
    expect(request.params.maxProtocol).toBe(4);
    expect(request.params.client.id).toBe("openclaw-worker");
    expect(request.params.client.mode).toBe("worker");
    expect(request.params.client.deviceFamily).toBe("Linux");
    expect(request.params.permissions).toEqual({
      screen: true,
      shell: false,
    });
    expect(request.params.pathEnv).toBe("/usr/local/bin:/usr/bin");
    expect(request.params.auth).toMatchObject({
      token: "gw-token",
      deviceToken: "explicit-device-token",
      password: "password-token",
      approvalRuntimeToken: "approval-runtime-token",
      agentRuntimeIdentityToken: "agent-runtime-token",
    });
  });

  it("uses bootstrap auth when no shared or device token is available", async () => {
    const { request } = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example/bootstrap",
      bootstrapToken: "bootstrap-token",
    }));

    expect(request.params.auth).toEqual({
      bootstrapToken: "bootstrap-token",
    });
  });

  it("uses the shared gateway token on reconnect even when a cached device token exists", async () => {
    await connectClient();

    const secondClient = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connectPromise = secondClient.connect();
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-456");
    await waitForSentFrame(ws);

    const request = await parseFirstRequest(ws);
    expect(request.params.auth.token).toBe("gw-token");
    expect(request.params.auth.deviceToken).toBeUndefined();
    expect(request.params.device.nonce).toBe("nonce-456");

    ws.emitHello(request.id, "device-token-2");
    await connectPromise;

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens[URL_SCOPE_KEY].token).toBe("device-token-2");
  });

  it("uses a refreshed gateway token on reconnect when onClose updates it", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-1",
      onClose: () => {
        client.setGatewayToken("gw-token-2");
      },
    });

    const connectPromise = client.connect();
    await flushMicrotasks();

    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing websocket instance");
    firstSocket.emitChallenge("nonce-initial");
    await waitForSentFrame(firstSocket);

    const firstRequest = await parseFirstRequest(firstSocket);
    expect(firstRequest.params.auth.token).toBe("gw-token-1");
    firstSocket.emit({
      type: "res",
      id: firstRequest.id,
      ok: true,
      payload: {
        protocol: 3,
        server: { version: "test-version" },
        auth: {
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    });
    await connectPromise;

    firstSocket.close(1012, "restart");
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushMicrotasks();

    const secondSocket = MockWebSocket.instances.at(-1);
    expect(secondSocket).toBeDefined();
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket?.emitChallenge("nonce-reconnect");
    if (!secondSocket) throw new Error("Missing reconnect websocket instance");
    await waitForSentFrame(secondSocket);

    const secondRequest = await parseFirstRequest(secondSocket);
    expect(secondRequest.params.auth.token).toBe("gw-token-2");
  });

  it("retries with the cached device token when connect fails with a shared-token mismatch", async () => {
    await connectClient();

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    void client.connect();
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-retry-device-token");
    await waitForSentFrame(ws);

    const request = await parseFirstRequest(ws);
    expect(request.params.auth.token).toBe("gw-token");
    expect(request.params.auth.deviceToken).toBeUndefined();

    ws.emitConnectError(request.id, "AUTH_TOKEN_MISMATCH", "token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (ws.sent.length > 1) break;
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(ws.closedWith).toBeNull();
    expect(ws.sent.length).toBe(2);
    const retryRequest = JSON.parse(ws.sent[1] ?? "{}");
    expect(retryRequest.params.auth.token).toBe("gw-token");
    expect(retryRequest.params.auth.deviceToken).toBe("device-token-1");
  });

  it("clears the cached device token when connect fails with a device-token auth error", async () => {
    await connectClient();

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    void client.connect();
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-stale");
    await waitForSentFrame(ws);

    const request = await parseFirstRequest(ws);
    expect(request.params.auth.token).toBe("gw-token");

    ws.emitConnectError(request.id, "AUTH_DEVICE_TOKEN_MISMATCH");

    // After AUTH_DEVICE_TOKEN_MISMATCH the client retries sendConnect inline
    // on the same socket (no close) using the gatewayToken fallback.
    // Wait for the retry frame to be sent (async due to device identity loading).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (ws.sent.length > 1) break;
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(ws.closedWith).toBeNull();
    expect(ws.sent.length).toBe(2); // original + retry
    const retryRequest = JSON.parse(ws.sent[1] ?? "{}");
    expect(retryRequest.params.auth.token).toBe("gw-token");
    expect(retryRequest.params.auth.deviceToken).toBeUndefined();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens?.[URL_SCOPE_KEY]).toBeUndefined();
  });

  it("does not reconnect-loop after a rate-limited auth failure", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    void client.connect();
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-rate-limit");
    await waitForSentFrame(ws);

    const request = await parseFirstRequest(ws);
    ws.emitConnectError(
      request.id,
      "AUTH_RATE_LIMITED",
      "too many failed authentication attempts (retry later)",
      {
        code: "AUTH_RATE_LIMITED",
        authReason: "rate_limited",
        canRetryWithDeviceToken: false,
        recommendedNextStep: "wait_then_retry",
      },
    );

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not call onDisconnect for intentional local closes", async () => {
    const { client } = await connectClient();
    const onDisconnect = vi.fn();
    client.onDisconnect = onDisconnect;

    client.close();
    await flushMicrotasks();

    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("sends sessions.patch with the raw patch payload", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ ok: true, key: "agent:main:main" });

    const result = await client.sessionsPatch({
      key: "agent:main:main",
      model: "openai/gpt-5.2",
      thinkingLevel: "high",
    });

    expect(rpc).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:main",
      model: "openai/gpt-5.2",
      thinkingLevel: "high",
    });
    expect(result).toEqual({ ok: true, key: "agent:main:main" });
  });

  it("patches Slack relay runtime config", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const patch = vi.spyOn(client, "configPatch").mockResolvedValue(undefined);

    await client.configureSlackRelay({
      url: "wss://api.dev.hypercli.com/slack/ws",
      gatewayId: "agent:11111111-1111-1111-1111-111111111111",
    });

    expect(patch).toHaveBeenCalledWith({
      channels: {
        slack: {
          mode: "relay",
          relay: {
            url: "wss://api.dev.hypercli.com/slack/ws",
            authToken: { source: "env", provider: "default", id: "HYPER_API_KEY" },
            gatewayId: "agent:11111111-1111-1111-1111-111111111111",
          },
        },
      },
    });
  });

  it("adapts sessions.preview to the upstream keys/previews shape", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({
      previews: [{ key: "agent:main:main", items: [{ role: "assistant", text: "hello" }] }],
    });

    const items = await client.sessionsPreview("agent:main:main", 12);

    expect(rpc).toHaveBeenCalledWith("sessions.preview", {
      keys: ["agent:main:main"],
      limit: 12,
    });
    expect(items).toEqual([{ role: "assistant", text: "hello" }]);
  });

  it("sends sessions.reset with key and optional reason", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ ok: true });

    await expect(client.sessionsReset("agent:main:main", "new")).resolves.toBe("agent:main:main");

    expect(rpc).toHaveBeenCalledWith("sessions.reset", {
      key: "agent:main:main",
      reason: "new",
    });
  });

  it("sends skills read RPCs with protocol payloads", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc");
    rpc
      .mockResolvedValueOnce({ workspaceDir: "/workspace", managedSkillsDir: "/home/node/.openclaw/skills", skills: [] })
      .mockResolvedValueOnce({ results: [{ score: 1, slug: "calendar", displayName: "Calendar" }] })
      .mockResolvedValueOnce({ skill: { slug: "calendar", displayName: "Calendar", createdAt: 1, updatedAt: 2 } })
      .mockResolvedValueOnce({ schema: "openclaw.skills.security-verdicts.v1", items: [] })
      .mockResolvedValueOnce({
        schema: "openclaw.skills.skill-card.v1",
        skillKey: "calendar",
        path: "/workspace/skills/calendar/skill-card.md",
        sizeBytes: 12,
        content: "# Card",
      });

    await expect(client.skillsStatus({ agentId: "main" })).resolves.toMatchObject({ workspaceDir: "/workspace" });
    await expect(client.skillsSearch({ query: "calendar", limit: 10 })).resolves.toMatchObject({
      results: [{ slug: "calendar" }],
    });
    await expect(client.skillsDetail({ slug: "calendar" })).resolves.toMatchObject({
      skill: { slug: "calendar" },
    });
    await expect(client.skillsSecurityVerdicts({ agentId: "main" })).resolves.toMatchObject({
      schema: "openclaw.skills.security-verdicts.v1",
    });
    await expect(client.skillsSkillCard({ agentId: "main", skillKey: "calendar" })).resolves.toMatchObject({
      skillKey: "calendar",
      content: "# Card",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "skills.status", { agentId: "main" });
    expect(rpc).toHaveBeenNthCalledWith(2, "skills.search", { query: "calendar", limit: 10 });
    expect(rpc).toHaveBeenNthCalledWith(3, "skills.detail", { slug: "calendar" });
    expect(rpc).toHaveBeenNthCalledWith(4, "skills.securityVerdicts", { agentId: "main" });
    expect(rpc).toHaveBeenNthCalledWith(5, "skills.skillCard", { agentId: "main", skillKey: "calendar" });
  });

  it("sends skills mutation RPCs with install-safe timeouts", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc");
    rpc
      .mockResolvedValueOnce({ ok: true, slug: "calendar", version: "1.0.0", targetDir: "/workspace/skills/calendar" })
      .mockResolvedValueOnce({ ok: true, skillKey: "calendar", config: { source: "clawhub", results: [] } })
      .mockResolvedValueOnce({ ok: true, skillKey: "calendar", config: { enabled: true } });

    await client.skillsInstall({ source: "clawhub", slug: "calendar", version: "1.0.0" });
    await client.skillsUpdate({ source: "clawhub", slug: "calendar" });
    await client.skillsUpdate({ skillKey: "calendar", enabled: true, env: { GOOGLE_CALENDAR_ID: "primary" } });

    expect(rpc).toHaveBeenNthCalledWith(1, "skills.install", {
      source: "clawhub",
      slug: "calendar",
      version: "1.0.0",
    }, 300_000);
    expect(rpc).toHaveBeenNthCalledWith(2, "skills.update", {
      source: "clawhub",
      slug: "calendar",
    }, 300_000);
    expect(rpc).toHaveBeenNthCalledWith(3, "skills.update", {
      skillKey: "calendar",
      enabled: true,
      env: { GOOGLE_CALENDAR_ID: "primary" },
    }, undefined);
  });

  it("sends service integration auth and status RPCs", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc");
    rpc
      .mockResolvedValueOnce({ authId: "auth-1", verificationUri: "https://github.com/login/device", userCode: "ABCD-1234" })
      .mockResolvedValueOnce({ status: "authorized", connectionId: "conn-1" })
      .mockResolvedValueOnce({ integrations: { github: { configured: true, authenticated: true, usable: true } } })
      .mockResolvedValueOnce({ ok: true, integrationId: "github" });

    await expect(client.integrationsAuthStart({ integrationId: "github", scopes: ["repo"] })).resolves.toMatchObject({ authId: "auth-1" });
    await expect(client.integrationsAuthStatus({ authId: "auth-1", integrationId: "github" })).resolves.toMatchObject({ connectionId: "conn-1" });
    await expect(client.integrationsStatus({ integrationId: "github", probe: true })).resolves.toMatchObject({ integrations: { github: { usable: true } } });
    await expect(client.integrationsDisconnect({ integrationId: "github", revoke: true })).resolves.toMatchObject({ ok: true });

    expect(rpc).toHaveBeenNthCalledWith(1, "integrations.auth.start", { integrationId: "github", scopes: ["repo"] }, 30_000);
    expect(rpc).toHaveBeenNthCalledWith(2, "integrations.auth.status", { authId: "auth-1", integrationId: "github" });
    expect(rpc).toHaveBeenNthCalledWith(3, "integrations.status", { integrationId: "github", probe: true });
    expect(rpc).toHaveBeenNthCalledWith(4, "integrations.disconnect", { integrationId: "github", revoke: true });
  });

  it("sends channel-scoped status RPC parameters", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const result = {
      ts: 123,
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channels: { telegram: { configured: true } },
      channelAccounts: { telegram: [] },
      channelDefaultAccountId: { telegram: "default" },
    };
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue(result);

    await expect(client.channelsStatus(true, 2500, "telegram")).resolves.toBe(result);
    expect(rpc).toHaveBeenCalledWith("channels.status", {
      probe: true,
      timeoutMs: 2500,
      channel: "telegram",
    });
  });

  it("waitReady retries until configGet succeeds", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    let attempts = 0;
    vi.spyOn(client, "connect").mockImplementation(async () => {
      (client as any).connected = true;
    });
    vi.spyOn(client, "configGet").mockImplementation(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("warming up");
      }
      return { gateway: { mode: "local" } };
    });
    vi.spyOn(client, "close").mockImplementation(() => {
      (client as any).connected = false;
      (client as any).closed = false;
    });

    const result = await client.waitReady(100, { retryIntervalMs: 0 });

    expect(result.gateway.mode).toBe("local");
    expect(attempts).toBe(2);
  });

  it("sends cron.add job fields at the request params root", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const sent: string[] = [];
    (client as any).connected = true;
    (client as any).ws = {
      readyState: MockWebSocket.OPEN,
      send: (data: string) => sent.push(data),
    };

    const addPromise = client.cronAdd({
      name: "Daily summary",
      sessionTarget: "session:main",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize yesterday." },
    });

    expect(sent).toHaveLength(1);
    const request = JSON.parse(sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    expect(request.method).toBe("cron.add");
    expect(request.params).toEqual({
      name: "Daily summary",
      sessionTarget: "session:main",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize yesterday." },
    });

    (client as any).handleMessage(JSON.stringify({
      type: "res",
      id: request.id,
      ok: true,
      payload: { jobId: "cron-1" },
    }));
    await expect(addPromise).resolves.toEqual({ jobId: "cron-1" });
  });

  it("chatSend accepts server runId events and ends on chat.done", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "server-run-1" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Reply with exactly: SMOKE_OK", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "server-run-1", text: "SMOKE_" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "server-run-1", text: "OK" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "server-run-1" },
    }));

    const events = await streamPromise;
    expect(rpc).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "Reply with exactly: SMOKE_OK",
        sessionKey: "main",
      }),
      900_000,
    );
    expect(events.map((event) => event.type)).toEqual(["content", "content", "done"]);
    expect(events.filter((event) => event.type === "content").map((event) => event.text).join("")).toBe("SMOKE_OK");
  });

  it("request supports an upstream-style null timeout for long-lived RPCs", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      const ws = new MockWebSocket("wss://openclaw-agent.example");
      (client as any).connected = true;
      (client as any).ws = ws;
      ws.readyState = MockWebSocket.OPEN;

      const promise = client.request("slow.method", {}, null);
      await flushMicrotasks();

      expect(ws.sent).toHaveLength(1);
      const request = JSON.parse(ws.sent[0]!);
      let rejected: unknown;
      promise.catch((error) => {
        rejected = error;
      });

      await vi.advanceTimersByTimeAsync(60_000);
      await flushMicrotasks();
      expect(rejected).toBeUndefined();

      (client as any).handleMessage(JSON.stringify({
        type: "res",
        id: request.id,
        ok: true,
        payload: { ok: true },
      }));
      await expect(promise).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("request keeps expectFinal calls pending across accepted responses", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const ws = new MockWebSocket("wss://openclaw-agent.example");
    (client as any).connected = true;
    (client as any).ws = ws;
    ws.readyState = MockWebSocket.OPEN;
    const acceptedPayloads: unknown[] = [];

    const promise = client.request("slow.final", {}, {
      expectFinal: true,
      onAccepted: (payload) => acceptedPayloads.push(payload),
    });
    await flushMicrotasks();

    const request = JSON.parse(ws.sent[0]!);
    (client as any).handleMessage(JSON.stringify({
      type: "res",
      id: request.id,
      ok: true,
      payload: { status: "accepted", runId: "run-1" },
    }));
    await flushMicrotasks();

    expect(acceptedPayloads).toEqual([{ status: "accepted", runId: "run-1" }]);
    (client as any).handleMessage(JSON.stringify({
      type: "res",
      id: request.id,
      ok: true,
      payload: { status: "done", value: 42 },
    }));

    await expect(promise).resolves.toEqual({ status: "done", value: 42 });
  });

  it("request cleans up pending state when websocket send throws", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = {
      readyState: MockWebSocket.OPEN,
      send: () => {
        throw new Error("send failed");
      },
    };

    expect(() => client.request("broken.method")).toThrow("send failed");
    expect((client as any).pending.size).toBe(0);
  });

  it("runs an ephemeral chat and resets its hidden session after completion", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => (
      reason === "new" ? `agent:default:${key}` : key
    ));
    const chatSend = vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: '{"schema":' };
      yield { type: "content", text: '"test"}' };
      yield { type: "done" };
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);

    await expect(client.runEphemeralChat("Generate JSON")).resolves.toBe('{"schema":"test"}');
    expect(sessionsReset).toHaveBeenCalledTimes(2);
    const sessionKey = sessionsReset.mock.calls[0]?.[0];
    expect(sessionKey).toMatch(/^session-[0-9a-f-]+$/);
    expect(sessionsReset).toHaveBeenNthCalledWith(1, sessionKey, "new");
    expect(sessionsReset).toHaveBeenNthCalledWith(2, `agent:default:${sessionKey}`, "reset");
    expect(chatSend).toHaveBeenCalledWith("Generate JSON", `agent:default:${sessionKey}`);
    expect(chatAbort).not.toHaveBeenCalled();
  });

  it("enables fast mode with a directive-only turn before the ephemeral prompt", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const chatSend = vi.spyOn(client, "chatSend").mockImplementation(async function* (message) {
      if (message === "/fast on") {
        yield { type: "content", text: "Fast mode enabled." };
        yield { type: "done" };
        return;
      }
      yield { type: "content", text: '{"schema":"test"}' };
      yield { type: "done" };
    });

    await expect(client.runEphemeralChat("Generate JSON", { fastMode: true })).resolves.toBe('{"schema":"test"}');
    expect(chatSend.mock.calls.map(([message]) => message)).toEqual(["/fast on", "Generate JSON"]);
  });

  it("forwards ephemeral chat events including tool activity in order", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "thinking", text: "Inspect first" };
      yield { type: "tool_call", data: { toolCallId: "tool-1", name: "read", args: { path: "/tmp/a" } } };
      yield { type: "tool_result", data: { toolCallId: "tool-1", name: "read", result: "value" } };
      yield { type: "content", text: "Final answer" };
      yield { type: "done" };
    });
    const events: string[] = [];

    await expect(client.runEphemeralChat("Inspect", {
      onEvent: (event) => events.push(event.type),
    })).resolves.toBe("Final answer");

    expect(events).toEqual(["thinking", "tool_call", "tool_result", "content", "done"]);
  });

  it("awaits async ephemeral chat callbacks before dispatching the next event", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: "one" };
      yield { type: "content", text: " two" };
      yield { type: "done" };
    });
    const callbackOrder: string[] = [];

    await expect(client.runEphemeralChat("Generate", {
      onEvent: async (event) => {
        callbackOrder.push(`start:${event.type}:${event.text ?? ""}`);
        await Promise.resolve();
        callbackOrder.push(`end:${event.type}:${event.text ?? ""}`);
      },
    })).resolves.toBe("one two");

    expect(callbackOrder).toEqual([
      "start:content:one",
      "end:content:one",
      "start:content: two",
      "end:content: two",
      "start:done:",
      "end:done:",
    ]);
  });

  it("aborts and resets an ephemeral chat when its callback fails", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "tool_call", data: { name: "read" } };
      yield { type: "content", text: "unreachable" };
      yield { type: "done" };
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);

    await expect(client.runEphemeralChat("Inspect", {
      onEvent: async () => {
        throw new Error("callback failed");
      },
    })).rejects.toThrow("callback failed");

    const sessionKey = sessionsReset.mock.calls[0]?.[0];
    expect(chatAbort).toHaveBeenCalledWith(sessionKey);
    expect(sessionsReset).toHaveBeenLastCalledWith(sessionKey, "reset");
  });

  it("forwards an ephemeral chat error event before rejecting", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "error", text: "workflow failed" };
    });
    const events: string[] = [];

    await expect(client.runEphemeralChat("Inspect", {
      onEvent: (event) => events.push(`${event.type}:${event.text}`),
    })).rejects.toThrow("workflow failed");

    expect(events).toEqual(["error:workflow failed"]);
  });

  it("aborts and resets an ephemeral chat when its response exceeds the limit", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: "too large" };
      yield { type: "done" };
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);

    await expect(client.runEphemeralChat("Generate", { maxResponseChars: 4 })).rejects.toThrow(/exceeds/i);
    const sessionKey = sessionsReset.mock.calls[0]?.[0];
    expect(chatAbort).toHaveBeenCalledWith(sessionKey);
    expect(sessionsReset).toHaveBeenLastCalledWith(sessionKey, "reset");
  });

  it("cancels an in-flight ephemeral chat through chat.abort", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    let releaseStream: (() => void) | undefined;
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: "partial" };
      await new Promise<void>((resolve) => { releaseStream = resolve; });
      yield { type: "done" };
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockImplementation(async () => { releaseStream?.(); });
    const controller = new AbortController();
    const completion = client.runEphemeralChat("Generate", { signal: controller.signal });
    await flushMicrotasks();
    controller.abort();

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    const sessionKey = sessionsReset.mock.calls[0]?.[0];
    expect(chatAbort).toHaveBeenCalledWith(sessionKey);
    expect(sessionsReset).toHaveBeenLastCalledWith(sessionKey, "reset");
  });

  it("does not wait for a stalled stream after ephemeral cancellation", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => (
      reason === "new" ? `agent:default:${key}` : key
    ));
    let streamStarted: (() => void) | undefined;
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      streamStarted?.();
      await new Promise<void>(() => undefined);
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    const controller = new AbortController();
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    const completion = client.runEphemeralChat("Generate", { signal: controller.signal });
    await started;

    controller.abort();

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    const requestedKey = sessionsReset.mock.calls[0]?.[0];
    expect(chatAbort).toHaveBeenCalledWith(`agent:default:${requestedKey}`);
    expect(sessionsReset).toHaveBeenLastCalledWith(`agent:default:${requestedKey}`, "reset");
  });

  it("chatSend streams legacy chat deltas and treats final without message as done", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "legacy-run-1" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Say hello", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-1",
        sessionKey: "main",
        state: "final",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "content", "done"]);
    expect(events.filter((event) => event.type === "content").map((event) => event.text).join("")).toBe("Hello world");
  });

  it("chatSend streams v4 chat deltaText without message snapshots", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "delta-text-run-1" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Say hello", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "delta-text-run-1",
        sessionKey: "main",
        state: "delta",
        deltaText: "Hello ",
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "delta-text-run-1",
        sessionKey: "main",
        state: "delta",
        deltaText: "world",
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "delta-text-run-1",
        sessionKey: "main",
        state: "final",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "content", "done"]);
    expect(events.filter((event) => event.type === "content").map((event) => event.text).join("")).toBe("Hello world");
  });

  it("chatSend accepts canonical agent session key aliases", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "legacy-run-alias" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("alias test", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-alias",
        sessionKey: "agent:main:main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Alias OK" }] },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-alias",
        sessionKey: "agent:main:main",
        state: "final",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
    expect(events[0]?.text).toBe("Alias OK");
  });

  it("chatSend falls back to chat history when final has no message or streamed text", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "legacy-run-2" };
      }
      if (method === "chat.history") {
        return {
          messages: [
            { role: "user", content: [{ type: "text", text: "prompt" }] },
            {
              role: "assistant",
              runId: "legacy-run-2",
              content: [{ type: "text", text: "Recovered final answer" }],
            },
          ],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Recover answer", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "legacy-run-2",
        sessionKey: "main",
        state: "final",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
    expect(events[0]?.text).toBe("Recovered final answer");
  });

  it("chatSend falls back to chat history when done has no streamed text", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "done-run-1" };
      }
      if (method === "chat.history") {
        return {
          messages: [
            {
              role: "assistant",
              runId: "done-run-1",
              content: [{ type: "text", text: "SMOKE_OK" }],
            },
          ],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Reply with exactly: SMOKE_OK", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: {
        runId: "done-run-1",
        sessionKey: "main",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
    expect(events[0]?.text).toBe("SMOKE_OK");
  });

  it("chatSend forwards pre-normalized attachments in the chat.send request", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpcSpy = vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: any) => {
      if (method === "chat.send") {
        expect(params.attachments).toEqual([
          { type: "image", mimeType: "image/png", content: "YWJj" },
        ]);
        return { runId: "attachments-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("With attachment", "main", [
        { type: "image", mimeType: "image/png", content: "YWJj" },
      ])) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "attachments-run",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
    }));

    const events = await streamPromise;
    expect(rpcSpy).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
  });

  it("chatSend converts browser-style dataUrl attachments before sending", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpcSpy = vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: any) => {
      if (method === "chat.send") {
        expect(params.attachments).toEqual([
          { type: "image", mimeType: "image/png", content: "YWJj", fileName: "clip.png" },
        ]);
        return { runId: "data-url-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("With image", "main", [
        {
          id: "att-1",
          dataUrl: "data:image/png;base64,YWJj",
          mimeType: "image/png",
          fileName: "clip.png",
        },
      ])) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "data-url-run",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
    }));

    const events = await streamPromise;
    expect(rpcSpy).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
  });

  it("normalizes thinking-only and tool-rich assistant messages", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      timestamp: 123,
      content: [
        { type: "thinking", thinking: "Plan A" },
        { type: "tool_use", id: "tool-1", name: "exec", arguments: { command: "ls" } },
        { type: "tool_result", id: "tool-1", name: "exec", text: "file-a\nfile-b" },
      ],
    });

    expect(normalized).toEqual({
      role: "assistant",
      text: "",
      thinking: "Plan A",
      toolCalls: [
        {
          id: "tool-1",
          name: "exec",
          args: { command: "ls" },
          result: "file-a\nfile-b",
        },
      ],
      mediaUrls: [],
      timestamp: 123,
    });
  });

  it("normalizes base64 audio content blocks as media urls", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      timestamp: 123,
      content: [
        { type: "text", text: "Audio reply" },
        {
          type: "audio",
          source: {
            type: "base64",
            media_type: "audio/mpeg",
            data: "AAAA",
          },
        },
      ],
    });

    expect(normalized).toEqual({
      role: "assistant",
      text: "Audio reply",
      thinking: "",
      toolCalls: [],
      mediaUrls: ["data:audio/mpeg;base64,AAAA"],
      timestamp: 123,
    });
  });

  it("chatSend emits thinking and tool events from final structured snapshots", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "final-structured-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Need structured final", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "final-structured-run",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need a tool." },
            { type: "tool_use", id: "tool-1", name: "exec", arguments: { command: "ls" } },
            { type: "tool_result", id: "tool-1", name: "exec", text: "a\nb" },
          ],
        },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "done",
    ]);
    expect(events[0]?.text).toBe("Need a tool.");
    expect(events[1]?.data).toEqual({
      toolCallId: "tool-1",
      name: "exec",
      args: { command: "ls" },
    });
    expect(events[2]?.data).toEqual({
      toolCallId: "tool-1",
      name: "exec",
      result: "a\nb",
    });
  });

  it("chatSend maps agent tool result metadata as result content", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "agent-tool-meta-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Run true", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "agent-tool-meta-run",
        sessionKey: "main",
        stream: "tool",
        data: { phase: "result", name: "exec", meta: "" },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "agent-tool-meta-run",
        sessionKey: "main",
        stream: "lifecycle",
        data: { phase: "end" },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["tool_result", "done"]);
    expect(events[0]?.data).toMatchObject({ name: "exec", result: "" });
  });

  it("chatSend emits agent tool start events before results", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "agent-tool-stream-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Inspect this zip", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "agent-tool-stream-run",
        sessionKey: "main",
        stream: "tool",
        data: {
          phase: "start",
          tool_call_id: "tool-1",
          tool_name: "functions.read",
          args: { path: "/tmp/demo.zip" },
        },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "agent-tool-stream-run",
        sessionKey: "main",
        stream: "tool",
        data: {
          phase: "result",
          tool_call_id: "tool-1",
          tool_name: "functions.read",
          result: { ok: true },
          isError: false,
        },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: {
        runId: "agent-tool-stream-run",
        sessionKey: "main",
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["tool_call", "tool_result", "done"]);
    expect(events[0]?.data).toEqual({
      toolCallId: "tool-1",
      name: "functions.read",
      args: { path: "/tmp/demo.zip" },
    });
    expect(events[1]?.data).toEqual({
      toolCallId: "tool-1",
      name: "functions.read",
      result: { ok: true },
      isError: false,
    });
  });

  it("chatSend falls back to lifecycle end when chat final is missing", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "lifecycle-end-1" };
      }
      if (method === "chat.history") {
        return {
          messages: [
            {
              role: "assistant",
              runId: "lifecycle-end-1",
              content: [{ type: "text", text: "SMOKE_OK" }],
            },
          ],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Reply with exactly: SMOKE_OK", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "lifecycle-end-1",
        sessionKey: "main",
        stream: "lifecycle",
        data: { phase: "end" },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
    expect(events[0]?.text).toBe("SMOKE_OK");
  });

  it("chatSend falls back to lifecycle error when chat error is missing", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "lifecycle-error-1" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("fail please", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "lifecycle-error-1",
        sessionKey: "main",
        stream: "lifecycle",
        data: { phase: "error", error: "boom" },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(events[0]?.text).toBe("boom");
  });

  it("sends cron.run RPC with jobId", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ ok: true });

    await client.cronRun("cron-job-1");

    expect(rpc).toHaveBeenCalledWith("cron.run", { jobId: "cron-job-1" });
  });

  it("sends agents.get RPC and unwraps agent", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({
      agent: { id: "main", name: "default-agent" },
    });

    const result = await client.agentGet("main");

    expect(rpc).toHaveBeenCalledWith("agents.get", { agentId: "main" });
    expect(result).toEqual({ id: "main", name: "default-agent" });
  });

  it("agentGet defaults to 'main' agentId", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ agent: { id: "main" } });

    await client.agentGet();

    expect(rpc).toHaveBeenCalledWith("agents.get", { agentId: "main" });
  });

  it("auto-approves pairing through trusted exec and reconnects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exit_code: 0, stdout: "approved", stderr: "" }),
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });

    const connectPromise = client.connect();
    await flushMicrotasks();

    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing first websocket instance");
    firstSocket.emitChallenge("nonce-pair");
    await waitForSentFrame(firstSocket);
    const firstRequest = JSON.parse(firstSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    firstSocket.emitConnectError(
      firstRequest.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-1", reason: "not-paired" },
    );
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dev.hypercli.com/deployments/deployment-123/exec",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer app-token",
          "Content-Type": "application/json",
        }),
        body: expect.any(String),
      }),
    );
    const fetchBody = JSON.parse((fetchMock.mock.calls[0] ?? [])[1]?.body as string);
    expect(fetchBody.timeout).toBe(30);
    expect(fetchBody.command).toContain("openclaw devices approve ");
    expect(fetchBody.command).toContain(" --json");
    expect(fetchBody.command).toContain("pairing-req-1");

    // Auto-approve runs silently — no intermediate pendingPairings stored.
    const storedAfterPairingError = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(storedAfterPairingError.pendingPairings).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 850));
    await flushMicrotasks();

    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) {
      throw new Error("Missing reconnect websocket instance");
    }
    secondSocket.emitChallenge("nonce-reconnect");
    await waitForSentFrame(secondSocket);
    const secondRequest = JSON.parse(secondSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    secondSocket.emitHello(secondRequest.id, "device-token-after-pair");
    await connectPromise;

    expect(client.isConnected).toBe(true);
    expect(client.pendingPairing).toBeNull();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.pendingPairings).toBeUndefined();
    expect(stored.tokens[DEPLOYMENT_SCOPE_KEY].token).toBe("device-token-after-pair");
  });

  it("treats unknown requestId during auto-approve as concurrent approval and reconnects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unknown requestId"));
    vi.stubGlobal("fetch", fetchMock as any);

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });

    const connectPromise = client.connect();
    await flushMicrotasks();

    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing first websocket instance");
    firstSocket.emitChallenge("nonce-pair");
    await waitForSentFrame(firstSocket);
    const firstRequest = JSON.parse(firstSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    firstSocket.emitConnectError(
      firstRequest.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-race", reason: "not-paired" },
    );
    await flushMicrotasks();

    await new Promise((resolve) => setTimeout(resolve, 850));
    await flushMicrotasks();

    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) {
      throw new Error("Missing reconnect websocket instance");
    }
    secondSocket.emitChallenge("nonce-reconnect");
    await waitForSentFrame(secondSocket);
    const secondRequest = JSON.parse(secondSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    secondSocket.emitHello(secondRequest.id, "device-token-after-race");
    await connectPromise;

    expect(client.isConnected).toBe(true);
    expect(client.pendingPairing).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects when pairing approval succeeds after the first socket already closed", async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });

    const connectPromise = client.connect();
    await flushMicrotasks();

    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing first websocket instance");
    firstSocket.emitChallenge("nonce-pair");
    await waitForSentFrame(firstSocket);
    const firstRequest = JSON.parse(firstSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    firstSocket.emitConnectError(
      firstRequest.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-late-approval", reason: "not-paired" },
    );
    await flushMicrotasks();
    firstSocket.close(1008, "pairing required");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!resolveFetch) throw new Error("Missing pending approval request");
    resolveFetch({
      ok: true,
      json: async () => ({ exit_code: 0, stdout: "approved", stderr: "" }),
    });
    await flushMicrotasks(8);

    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) {
      throw new Error("Missing reconnect websocket instance after late approval");
    }
    secondSocket.emitChallenge("nonce-reconnect");
    await waitForSentFrame(secondSocket);
    const secondRequest = JSON.parse(secondSocket.sent[0] ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, any>;
    };
    secondSocket.emitHello(secondRequest.id, "device-token-after-late-approval");
    await connectPromise;

    expect(client.isConnected).toBe(true);
    expect(client.pendingPairing).toBeNull();
  });

});

async function collectResultFrames(ws: MockWebSocket, method: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const frames = ws.sent
      .map((raw) => JSON.parse(raw) as { id: string; method: string; params: Record<string, any> })
      .filter((frame) => frame.method === method);
    if (frames.length > 0) {
      return frames;
    }
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`No ${method} frame was sent`);
}

describe("NodeServer", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as any);
    vi.stubGlobal("localStorage", new MockLocalStorage() as any);
    vi.stubGlobal("crypto", webcrypto as any);
    vi.useRealTimers();
  });

  async function startNode(commands: Record<string, (params: any) => any>) {
    const server = new NodeServer(commands, {
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      nodeId: "node-abc",
    });
    const startPromise = server.start();
    await flushMicrotasks();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");

    ws.emitChallenge();
    await waitForSentFrame(ws);
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await startPromise;

    return { server, ws, request };
  }

  it("connects as a node and declares its command surface", async () => {
    const { server, request } = await startNode({ echo: (p: any) => p });

    expect(request.method).toBe("connect");
    expect(request.params.role).toBe("node");
    expect(request.params.client.mode).toBe("node");
    expect(request.params.client.instanceId).toBe("node-abc");
    expect(request.params.scopes).toEqual([]);
    expect(request.params.commands).toEqual(["echo"]);
    expect(server.gateway.isConnected).toBe(true);

    server.stop();
  });

  it("dispatches node.invoke.request and replies with the handler payload", async () => {
    const { server, ws } = await startNode({
      echo: (params: any) => ({ echoed: params.value }),
    });

    ws.emit({
      type: "event",
      event: "node.invoke.request",
      payload: {
        id: "inv-1",
        nodeId: "node-abc",
        command: "echo",
        paramsJSON: JSON.stringify({ value: 42 }),
      },
    });

    const [frame] = await collectResultFrames(ws, "node.invoke.result");
    expect(frame.params).toEqual({
      id: "inv-1",
      nodeId: "node-abc",
      ok: true,
      payloadJSON: JSON.stringify({ echoed: 42 }),
    });

    server.stop();
  });

  it("replies INVALID_REQUEST for an unknown command", async () => {
    const { server, ws } = await startNode({ echo: (p: any) => p });

    ws.emit({
      type: "event",
      event: "node.invoke.request",
      payload: { id: "inv-2", nodeId: "node-abc", command: "missing", paramsJSON: "{}" },
    });

    const [frame] = await collectResultFrames(ws, "node.invoke.result");
    expect(frame.params.ok).toBe(false);
    expect(frame.params.error.code).toBe("INVALID_REQUEST");

    server.stop();
  });

  it("replies UNAVAILABLE when the handler throws", async () => {
    const { server, ws } = await startNode({
      boom: () => {
        throw new Error("handler exploded");
      },
    });

    ws.emit({
      type: "event",
      event: "node.invoke.request",
      payload: { id: "inv-3", nodeId: "node-abc", command: "boom", paramsJSON: "{}" },
    });

    const [frame] = await collectResultFrames(ws, "node.invoke.result");
    expect(frame.params.ok).toBe(false);
    expect(frame.params.error).toEqual({ code: "UNAVAILABLE", message: "handler exploded" });

    server.stop();
  });
});
