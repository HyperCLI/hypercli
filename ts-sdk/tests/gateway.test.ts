import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPENCLAW_DASHBOARD_SESSION_PREFIX,
  OPENCLAW_INTERNAL_MAIN_SESSION_KEY,
  OPENCLAW_SDK_SESSION_PREFIX,
  createOpenClawSdkSessionKey,
  createOpenClawSessionKey,
  GatewayChatStreamInterruptedError,
  GatewayClient,
  NodeServer,
  isOpenClawInternalMainSessionKey,
  isOpenClawSdkSessionKey,
  normalizeGatewayChatMessage,
} from "../src/openclaw/gateway.js";

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

class ToggleWriteLocalStorage extends MockLocalStorage {
  failWrites = true;

  override setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage unavailable");
    super.setItem(key, value);
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

  emitHello(
    id: string,
    deviceToken = "device-token-1",
    overrides: {
      version?: string;
      methods?: string[];
      capabilities?: string[];
      scopes?: string[];
    } = {},
  ) {
    this.emit({
      type: "res",
      id,
      ok: true,
      payload: {
        protocol: 3,
        server: { version: overrides.version ?? "test-version" },
        features: {
          methods: overrides.methods ?? [],
          events: [],
          capabilities: overrides.capabilities ?? [],
        },
        auth: {
          deviceToken,
          role: "operator",
          scopes: overrides.scopes ?? ["operator.admin"],
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

describe("OpenClaw session key helpers", () => {
  it("creates SDK session keys with an hcli prefix by default", () => {
    const key = createOpenClawSdkSessionKey();

    expect(key).toMatch(/^hcli:[0-9a-f-]+$/i);
    expect(key.startsWith(OPENCLAW_SDK_SESSION_PREFIX)).toBe(true);
    expect(key).not.toBe(OPENCLAW_INTERNAL_MAIN_SESSION_KEY);
  });

  it("creates caller-prefixed and bare session keys", () => {
    const dashboardKey = createOpenClawSessionKey([], OPENCLAW_DASHBOARD_SESSION_PREFIX);
    const bareKey = createOpenClawSessionKey([], "");

    expect(dashboardKey).toMatch(/^dashboard:[0-9a-f-]+$/i);
    expect(bareKey).toMatch(/^[0-9a-f-]+$/i);
    expect(bareKey).not.toContain(":");
  });

  it("classifies internal main and SDK sessions through agent-scoped keys", () => {
    const sdkKey = "hcli:550e8400-e29b-41d4-a716-446655440000";

    expect(isOpenClawInternalMainSessionKey("main")).toBe(true);
    expect(isOpenClawInternalMainSessionKey("agent:default:main")).toBe(true);
    expect(isOpenClawInternalMainSessionKey(sdkKey)).toBe(false);
    expect(isOpenClawSdkSessionKey(sdkKey)).toBe(true);
    expect(isOpenClawSdkSessionKey(`agent:default:${sdkKey}`)).toBe(true);
    expect(isOpenClawSdkSessionKey("dashboard:550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });
});

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

  async function connectClientWithHello(overrides: Parameters<MockWebSocket["emitHello"]>[2]) {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connectPromise = client.connect();
    await flushMicrotasks();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge();
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id, "device-token-1", overrides);
    await connectPromise;
    return { client, ws };
  }

  async function parseLatestRequest(ws: MockWebSocket) {
    await waitForSentFrame(ws);
    return JSON.parse(ws.sent.at(-1) ?? "{}") as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
  }

  it("retains authenticated Gateway methods and granted scopes", async () => {
    const { client } = await connectClientWithHello({
      version: "2026.8.1-beta.3",
      methods: ["skills.read", "skills.proposals.list"],
      scopes: ["operator.read"],
    });

    expect(client.hello).toMatchObject({
      server: { version: "2026.8.1-beta.3" },
      features: { methods: ["skills.read", "skills.proposals.list"] },
      auth: { scopes: ["operator.read"] },
    });
    expect(client.supportsMethod("skills.read")).toBe(true);
    expect(client.skillsProposalDialect).toBe("revision-bound");
  });

  it("uses the authenticated revision capability when the server version is ambiguous", async () => {
    const { client } = await connectClientWithHello({
      version: "2026.8.0",
      methods: ["skills.proposals.apply"],
      capabilities: ["skill-proposals-revision-bound-v1"],
      scopes: ["operator.admin"],
    });

    expect(client.skillsProposalDialect).toBe("revision-bound");
  });

  it("uses the deployed legacy proposal decision payload without replaying a mutation", async () => {
    const { client, ws } = await connectClientWithHello({
      version: "2026.7.1-2",
      methods: ["skills.proposals.apply"],
      scopes: ["operator.admin"],
    });
    const promise = client.skillsProposalApply({
      agentId: "default",
      proposalId: "weather-20260824-abcdef0123",
      expectedRevisionHash: "ignored-on-legacy",
      correlationId: "ignored-on-legacy",
      reason: "Reviewed",
    });
    const request = await parseLatestRequest(ws);

    expect(request).toMatchObject({
      method: "skills.proposals.apply",
      params: {
        agentId: "default",
        proposalId: "weather-20260824-abcdef0123",
        reason: "Reviewed",
      },
    });
    expect(request.params).not.toHaveProperty("expectedRevisionHash");
    expect(request.params).not.toHaveProperty("correlationId");
    ws.emit({ type: "res", id: request.id, ok: true, payload: { record: {}, targetSkillFile: "SKILL.md" } });
    await promise;
  });

  it("requires and sends the reviewed revision on current proposal decisions", async () => {
    const { client, ws } = await connectClientWithHello({
      version: "2026.8.1",
      methods: ["skills.proposals.apply"],
      scopes: ["operator.admin"],
    });

    await expect(client.skillsProposalApply({ proposalId: "weather" })).rejects.toThrow(/expectedRevisionHash/i);
    expect(ws.sent).toHaveLength(1);

    const promise = client.skillsProposalApply({
      proposalId: "weather",
      expectedRevisionHash: "a".repeat(64),
      correlationId: "review-1",
    });
    const request = await parseLatestRequest(ws);
    expect(request.params).toMatchObject({
      proposalId: "weather",
      expectedRevisionHash: "a".repeat(64),
      correlationId: "review-1",
    });
    ws.emit({ type: "res", id: request.id, ok: true, payload: { record: {}, targetSkillFile: "SKILL.md" } });
    await promise;
  });

  it("fails closed when proposal methods or mutation scopes were not granted", async () => {
    const { client } = await connectClientWithHello({
      version: "2026.8.1",
      methods: ["skills.proposals.list", "skills.proposals.apply"],
      scopes: ["operator.read"],
    });

    await expect(client.skillsProposalApply({
      proposalId: "weather",
      expectedRevisionHash: "a".repeat(64),
    })).rejects.toThrow(/operator\.admin/i);
    await expect(client.skillsProposalInspect({ proposalId: "weather" })).rejects.toThrow(/did not advertise/i);
  });

  it("reads authoritative skill instructions only when advertised", async () => {
    const { client, ws } = await connectClientWithHello({
      version: "2026.8.1",
      methods: ["skills.read"],
      scopes: ["operator.read"],
    });
    const promise = client.skillsRead({ agentId: "default", skillKey: "hypercli" });
    const request = await parseLatestRequest(ws);
    expect(request).toMatchObject({
      method: "skills.read",
      params: { agentId: "default", skillKey: "hypercli" },
    });
    ws.emit({
      type: "res",
      id: request.id,
      ok: true,
      payload: {
        schema: "openclaw.skills.read.v1",
        skillKey: "hypercli",
        path: "/opt/hypercli/skills/hypercli/SKILL.md",
        source: "openclaw-extra",
        sizeBytes: 11,
        content: "# HyperCLI\n",
      },
    });
    await expect(promise).resolves.toMatchObject({ content: "# HyperCLI\n" });
  });

  it("removes request abort listeners after an RPC timeout", async () => {
    vi.useFakeTimers();
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN, send: vi.fn() };
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const request = client.request("status", {}, { timeoutMs: 25, signal: controller.signal });
    const rejected = expect(request).rejects.toThrow("RPC timeout: status");

    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect((client as any).pending.size).toBe(0);
  });


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

  it("keeps an authenticated socket connected when an onHello observer throws", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onHello: () => {
        throw new Error("observer failed");
      },
    });

    const { ws } = await connectClient(client);

    expect(client.state).toBe("connected");
    expect(client.isConnected).toBe(true);
    expect(ws.closedWith).toBeNull();
  });

  it("rejects a synchronous socket construction failure and permits explicit retry", async () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("socket construction failed");
      }
    }
    vi.stubGlobal("WebSocket", ThrowingWebSocket as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });

    await expect(client.connect()).rejects.toThrow("socket construction failed");
    expect(client.state).toBe("disconnected");

    vi.stubGlobal("WebSocket", MockWebSocket as any);
    const retry = client.connect();
    await flushMicrotasks();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing retry websocket instance");
    ws.emitChallenge("nonce-retry-after-construction");
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await expect(retry).resolves.toBeUndefined();
  });

  it("contains a synchronous socket construction failure during reconnect", async () => {
    let attempts = 0;
    class ReconnectThrowingWebSocket {
      constructor(url: string) {
        attempts += 1;
        if (attempts === 2) throw new Error("reconnect construction failed");
        return new MockWebSocket(url);
      }
    }
    vi.stubGlobal("WebSocket", ReconnectThrowingWebSocket as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });

    const connected = client.connect({ timeoutMs: 5_000 });
    await flushMicrotasks();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-before-reconnect-construction");
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await connected;

    ws.close(1012, "restart");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushMicrotasks();

    expect(attempts).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(client.state).toBe("connecting");
    client.close();
  });

  it("validates gateway envelopes before publishing events", () => {
    const protocolErrors: Array<{ code: string; event?: string }> = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onProtocolError: (info) => protocolErrors.push(info),
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event as unknown as Record<string, unknown>));

    for (const raw of [
      "not-json",
      "null",
      JSON.stringify({ type: "event", event: 42, payload: {} }),
      JSON.stringify({ type: "event", event: "status.updated", payload: {}, seq: 1.5 }),
    ]) {
      (client as any).handleMessage(raw);
    }
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "provider.status",
      payload: "provider-defined",
      stateVersion: 7,
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { role: "assistant", content: [{ type: "future", value: 42 }] },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "future.event",
    }));

    expect(events).toEqual([
      {
        type: "event",
        event: "provider.status",
        payload: "provider-defined",
        stateVersion: 7,
      },
      {
        type: "event",
        event: "chat.content",
        payload: { role: "assistant", content: [{ type: "future", value: 42 }] },
      },
      {
        type: "event",
        event: "future.event",
      },
    ]);
    expect(protocolErrors.map((error) => error.code)).toEqual([
      "INVALID_JSON",
      "INVALID_FRAME",
      "INVALID_EVENT",
      "INVALID_EVENT",
    ]);
    expect(protocolErrors[3]).toMatchObject({ event: "status.updated" });
  });

  it("rejects a pending RPC immediately when its response envelope is malformed", async () => {
    const protocolErrors: Array<{ code: string; requestId?: string }> = [];
    const sent: string[] = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onProtocolError: (info) => protocolErrors.push(info),
    });
    (client as any).connected = true;
    (client as any).ws = {
      readyState: MockWebSocket.OPEN,
      send: (raw: string) => sent.push(raw),
    };

    const requestPromise = client.request("status", {}, 5_000);
    await flushMicrotasks();
    const request = JSON.parse(sent[0] ?? "{}");
    const rejection = expect(requestPromise).rejects.toMatchObject({
      name: "GatewayRequestError",
      gatewayCode: "PROTOCOL_ERROR",
    });

    (client as any).handleMessage(JSON.stringify({
      type: "res",
      id: request.id,
      ok: "false",
      error: { code: "FAILED", message: "failed" },
    }));

    await rejection;
    expect(protocolErrors).toEqual([
      expect.objectContaining({
        code: "INVALID_RESPONSE",
        requestId: request.id,
      }),
    ]);
    expect((client as any).pending.size).toBe(0);
  });

  it("preserves legacy string errors from failed RPC responses", async () => {
    const sent: string[] = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = {
      readyState: MockWebSocket.OPEN,
      send: (raw: string) => sent.push(raw),
    };

    const requestPromise = client.request("cron.add", {}, 5_000);
    await flushMicrotasks();
    const request = JSON.parse(sent[0] ?? "{}");
    const rejection = expect(requestPromise).rejects.toMatchObject({
      name: "GatewayRequestError",
      gatewayCode: "UNAVAILABLE",
      message: "invalid cron request",
    });

    (client as any).handleMessage(JSON.stringify({
      type: "res",
      id: request.id,
      ok: false,
      error: "invalid cron request",
    }));

    await rejection;
  });

  it("drops duplicate and out-of-order sequences and reports forward gaps", () => {
    const gaps: Array<{ expected: number; received: number }> = [];
    const protocolErrors: string[] = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onGap: (info) => gaps.push(info),
      onProtocolError: (info) => protocolErrors.push(info.code),
    });
    const events: string[] = [];
    client.onEvent((event) => events.push(String(event.payload.text ?? "")));

    const emit = (seq: number, text: string) => {
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "status.updated",
        payload: { text },
        seq,
      }));
    };
    emit(1, "one");
    emit(1, "duplicate");
    emit(0, "old");
    emit(3, "three");

    expect(events).toEqual(["one", "three"]);
    expect(gaps).toEqual([{ expected: 2, received: 3 }]);
    expect(protocolErrors).toEqual(["DUPLICATE_SEQUENCE", "OUT_OF_ORDER_SEQUENCE"]);
  });

  it("accepts a new sequence baseline after opening a replacement socket", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const sequences: number[] = [];
    client.onEvent((event) => sequences.push(event.seq ?? -1));

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "status.updated",
      payload: {},
      seq: 100,
    }));
    (client as any).openSocket();
    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "status.updated",
      payload: {},
      seq: 1,
    }));

    expect(sequences).toEqual([100, 1]);
    client.stop();
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
      "operator.read",
      "operator.write",
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

  it("preserves browser device identity in memory when localStorage writes fail", async () => {
    const storage = new ToggleWriteLocalStorage();
    vi.stubGlobal("localStorage", storage as any);
    const first = await connectClient();
    const deviceId = first.request.params.device.id;
    first.client.close();
    await flushMicrotasks();

    const secondClient = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connecting = secondClient.connect();
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing websocket after failed storage write");
    socket.emitChallenge("nonce-memory-fallback");
    const request = await parseFirstRequest(socket);
    expect(request.params.device.id).toBe(deviceId);

    storage.failWrites = false;
    socket.emitHello(request.id, "device-token-after-storage-recovery");
    await connecting;
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.deviceId).toBe(deviceId);
    expect(stored.tokens[URL_SCOPE_KEY].token).toBe("device-token-after-storage-recovery");
  });

  it("does not crash when the browser localStorage getter throws", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage access denied");
      },
    });
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connecting = client.connect();
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing websocket with inaccessible localStorage");
    socket.emitChallenge("nonce-storage-getter");
    const request = await parseFirstRequest(socket);
    expect(request.params.device.id).toMatch(/^[0-9a-f]{64}$/);

    const recoveredStorage = new MockLocalStorage();
    vi.stubGlobal("localStorage", recoveredStorage as any);
    socket.emitHello(request.id, "device-token-after-getter-recovery");
    await connecting;
    const stored = JSON.parse(recoveredStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.deviceId).toBe(request.params.device.id);
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

  it("awaits the gateway token provider before authenticating a reconnect", async () => {
    let resolveGatewayToken: ((token: string) => void) | null = null;
    const refreshedGatewayToken = new Promise<string>((resolve) => {
      resolveGatewayToken = resolve;
    });
    const refreshGatewayToken = vi.fn(() => refreshedGatewayToken);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-1",
      refreshGatewayToken,
    });

    const connectPromise = client.connect();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing websocket instance");
    firstSocket.emitChallenge("nonce-initial");
    const firstRequest = await parseFirstRequest(firstSocket);
    expect(firstRequest.params.auth.token).toBe("gw-token-1");
    expect(refreshGatewayToken).not.toHaveBeenCalled();
    firstSocket.emitHello(firstRequest.id);
    await connectPromise;

    firstSocket.close(1012, "restart");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushMicrotasks();
    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) throw new Error("Missing reconnect websocket instance");
    secondSocket.emitChallenge("nonce-reconnect");
    await flushMicrotasks();

    expect(refreshGatewayToken).toHaveBeenCalledTimes(1);
    expect(secondSocket.sent).toHaveLength(0);

    resolveGatewayToken?.("gw-token-2");
    queueMicrotask(() => client.setGatewayToken("gw-token-stale"));
    await waitForSentFrame(secondSocket);
    const secondRequest = await parseFirstRequest(secondSocket);
    expect(secondRequest.params.auth.token).toBe("gw-token-2");

    secondSocket.emitConnectError(secondRequest.id, "AUTH_TOKEN_MISMATCH", "token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });
    for (let attempt = 0; attempt < 20 && secondSocket.sent.length < 2; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(refreshGatewayToken).toHaveBeenCalledTimes(1);
    const fallbackRequest = JSON.parse(secondSocket.sent[1] ?? "{}");
    expect(fallbackRequest.params.auth.token).toBe("gw-token-2");
    expect(fallbackRequest.params.auth.deviceToken).toBe("device-token-1");
    secondSocket.emitHello(fallbackRequest.id, "device-token-2");
  });

  it("does not authenticate after stopping during gateway token refresh", async () => {
    let resolveGatewayToken: ((token: string) => void) | null = null;
    let refreshSignal: AbortSignal | null = null;
    const refreshedGatewayToken = new Promise<string>((resolve) => {
      resolveGatewayToken = resolve;
    });
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-1",
      refreshGatewayToken: (signal) => {
        refreshSignal = signal;
        return refreshedGatewayToken;
      },
    });

    const connectPromise = client.connect();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing websocket instance");
    firstSocket.emitChallenge("nonce-initial");
    const firstRequest = await parseFirstRequest(firstSocket);
    firstSocket.emitHello(firstRequest.id);
    await connectPromise;

    firstSocket.close(1012, "restart");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushMicrotasks();
    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) throw new Error("Missing reconnect websocket instance");
    secondSocket.emitChallenge("nonce-reconnect");
    await flushMicrotasks();

    client.stop();
    resolveGatewayToken?.("gw-token-2");
    await flushMicrotasks();

    expect(secondSocket.sent).toHaveLength(0);
    expect(refreshSignal?.aborted).toBe(true);
    expect(client.state).toBe("disconnected");
  });

  it("stops automatic reconnect after the gateway token provider fails", async () => {
    const refreshGatewayToken = vi.fn().mockRejectedValue(new Error("gateway Secret unavailable"));
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-1",
      refreshGatewayToken,
    });

    const connectPromise = client.connect();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing websocket instance");
    firstSocket.emitChallenge("nonce-initial");
    const firstRequest = await parseFirstRequest(firstSocket);
    firstSocket.emitHello(firstRequest.id);
    await connectPromise;

    vi.useFakeTimers();
    firstSocket.close(1012, "restart");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(800);
    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) throw new Error("Missing reconnect websocket instance");
    secondSocket.emitChallenge("nonce-reconnect");
    await flushMicrotasks();

    expect(refreshGatewayToken).toHaveBeenCalledTimes(1);
    expect(secondSocket.sent).toHaveLength(0);
    expect(secondSocket.closedWith?.reason).toBe("connect failed");
    expect(client.state).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    vi.useRealTimers();
    refreshGatewayToken.mockResolvedValueOnce("gw-token-2");
    const retryPromise = client.connect();
    await flushMicrotasks();
    const retrySocket = MockWebSocket.instances.at(-1);
    if (!retrySocket || retrySocket === secondSocket) throw new Error("Missing explicit retry websocket instance");
    retrySocket.emitChallenge("nonce-explicit-retry");
    const retryRequest = await parseFirstRequest(retrySocket);
    expect(retryRequest.params.auth.token).toBe("gw-token-2");
    retrySocket.emitHello(retryRequest.id);
    await retryPromise;
  });

  it("bounds a stalled gateway token provider and aborts its work", async () => {
    let refreshSignal: AbortSignal | null = null;
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-1",
      timeout: 25,
      refreshGatewayToken: (signal) => {
        refreshSignal = signal;
        return new Promise<string>(() => undefined);
      },
    });

    const connectPromise = client.connect();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing websocket instance");
    firstSocket.emitChallenge("nonce-initial");
    const firstRequest = await parseFirstRequest(firstSocket);
    firstSocket.emitHello(firstRequest.id);
    await connectPromise;

    vi.useFakeTimers();
    firstSocket.close(1012, "restart");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(800);
    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket) throw new Error("Missing reconnect websocket instance");
    secondSocket.emitChallenge("nonce-reconnect");
    await flushMicrotasks();

    expect(refreshSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();

    expect(refreshSignal?.aborted).toBe(true);
    expect(secondSocket.sent).toHaveLength(0);
    expect(secondSocket.closedWith?.reason).toBe("connect failed");
    expect(client.state).toBe("disconnected");
  });

  it("retries with the cached device token when connect fails with a shared-token mismatch", async () => {
    await connectClient();

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    void client.start().catch(() => undefined);
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

  it("settles terminally when the device-token fallback also has a shared-token mismatch", async () => {
    await connectClient();

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connecting = client.connect({ timeoutMs: 5_000 });
    const rejected = expect(connecting).rejects.toThrow("token mismatch after fallback");
    await flushMicrotasks();

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-terminal-device-token");
    const firstRequest = await parseFirstRequest(ws);
    ws.emitConnectError(firstRequest.id, "AUTH_TOKEN_MISMATCH", "token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });

    for (let attempt = 0; attempt < 20 && ws.sent.length < 2; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const fallbackRequest = JSON.parse(ws.sent[1] ?? "{}");
    ws.emitConnectError(fallbackRequest.id, "AUTH_TOKEN_MISMATCH", "token mismatch after fallback", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });

    await rejected;
    await flushMicrotasks();
    expect(ws.closedWith).not.toBeNull();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("clears only the current deployment after an exhausted stored-token fallback", async () => {
    const firstAgent = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-a",
      deploymentId: "deployment-a",
    }));
    firstAgent.client.close();
    await flushMicrotasks();
    const secondAgent = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token-b",
      deploymentId: "deployment-b",
    }));
    secondAgent.client.close();
    await flushMicrotasks();

    const before = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    before.pendingPairings = {
      "deployment-a|operator": { requestId: "pair-a", role: "operator" },
      "deployment-b|operator": { requestId: "pair-b", role: "operator" },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(before));

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "stale-shared-token-a",
      deploymentId: "deployment-a",
    });
    const connecting = client.connect({ timeoutMs: 5_000 });
    const rejected = expect(connecting).rejects.toThrow("stored token mismatch");
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing deployment-a websocket instance");
    socket.emitChallenge("nonce-exhausted-a");
    const sharedRequest = await parseFirstRequest(socket);
    socket.emitConnectError(sharedRequest.id, "AUTH_TOKEN_MISMATCH", "shared token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });
    for (let attempt = 0; attempt < 20 && socket.sent.length < 2; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const storedTokenRequest = JSON.parse(socket.sent[1] ?? "{}");
    expect(storedTokenRequest.params.auth.deviceToken).toBe("device-token-1");
    socket.emitConnectError(storedTokenRequest.id, "AUTH_TOKEN_MISMATCH", "stored token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });
    await rejected;

    const after = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(after.deviceId).toBe(before.deviceId);
    expect(after.privateKey).toBe(before.privateKey);
    expect(after.tokens["deployment-a|operator"]).toBeUndefined();
    expect(after.tokens["deployment-b|operator"].token).toBe("device-token-1");
    expect(after.pendingPairings?.["deployment-a|operator"]).toBeUndefined();
    expect(after.pendingPairings?.["deployment-b|operator"].requestId).toBe("pair-b");
    expect(socket.sent).toHaveLength(2);
  });

  it("clears the cached device token when connect fails with a device-token auth error", async () => {
    await connectClient();

    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    void client.start().catch(() => undefined);
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

  it("drops an issued in-memory device token before retrying a mismatch", async () => {
    const { client, ws: firstSocket } = await connectClient();
    firstSocket.close(1012, "restart");
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushMicrotasks();

    const socket = MockWebSocket.instances.at(-1);
    if (!socket || socket === firstSocket) throw new Error("Missing reconnect websocket instance");
    socket.emitChallenge("nonce-issued-token-mismatch");
    const request = await parseFirstRequest(socket);
    expect(request.params.auth.deviceToken).toBe("device-token-1");
    socket.emitConnectError(request.id, "AUTH_DEVICE_TOKEN_MISMATCH");

    for (let attempt = 0; attempt < 20 && socket.sent.length < 2; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const retryRequest = JSON.parse(socket.sent[1] ?? "{}");
    expect(retryRequest.params.auth.token).toBe("gw-token");
    expect(retryRequest.params.auth.deviceToken).toBeUndefined();
    client.close();
  });

  it("preserves an explicitly configured device token while clearing scoped cached auth", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deviceToken: "caller-device-token",
      deploymentId: "deployment-explicit",
    });
    void client.start().catch(() => undefined);
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing explicit-token websocket instance");
    socket.emitChallenge("nonce-explicit-token");
    const request = await parseFirstRequest(socket);
    expect(request.params.auth.deviceToken).toBe("caller-device-token");
    socket.emitConnectError(request.id, "AUTH_DEVICE_TOKEN_MISMATCH");
    for (let attempt = 0; attempt < 20 && socket.sent.length < 2; attempt += 1) {
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const retryRequest = JSON.parse(socket.sent[1] ?? "{}");
    expect(retryRequest.params.auth.deviceToken).toBe("caller-device-token");
    client.close();
  });

  it("does not reconnect-loop after a rate-limited auth failure", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const connectPromise = client.connect();
    const connectRejection = expect(connectPromise).rejects.toMatchObject({
      name: "GatewayRequestError",
      message: "too many failed authentication attempts (retry later)",
    });
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

    await connectRejection;
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not open a socket for an already-aborted connect waiter", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });

    await expect(client.connect({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(client.state).toBe("disconnected");
  });

  it("bounds one connect waiter without stopping a shared transport", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const shortWaiter = client.connect({ timeoutMs: 25 });
    const shortRejection = expect(shortWaiter).rejects.toThrow("gateway connect timed out after 25ms");
    const longWaiter = client.connect({ timeoutMs: 1_000 });

    await shortRejection;
    expect(client.state).toBe("connecting");

    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error("Missing websocket instance");
    ws.emitChallenge("nonce-after-waiter-timeout");
    const request = await parseFirstRequest(ws);
    ws.emitHello(request.id);
    await expect(longWaiter).resolves.toBeUndefined();
    expect(client.state).toBe("connected");
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

  it("sends sessions.create with the typed creation payload", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const response = {
      ok: true as const,
      key: "agent:main:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      sessionId: "session-id-1",
    };
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue(response);

    await expect(client.sessionsCreate({
      key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      model: "openai/gpt-5.2",
    })).resolves.toBe(response);

    expect(rpc).toHaveBeenCalledWith("sessions.create", {
      key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      model: "openai/gpt-5.2",
    });
  });

  it("subscribes to session change events", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ subscribed: true });

    await expect(client.sessionsSubscribe()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("sessions.subscribe", {});
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
            authToken: { source: "env", provider: "default", id: "HYPER_AGENTS_API_KEY" },
            gatewayId: "agent:11111111-1111-1111-1111-111111111111",
          },
        },
      },
    });
  });

  it("patches typed channel runtime config helpers", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const patch = vi.spyOn(client, "configPatch").mockResolvedValue(undefined);

    await client.configureSlackSocket({ botToken: "xoxb-token", appToken: "xapp-token" }, "work");
    await client.configureSlackRelay({
      botToken: "xoxb-token",
      relay: { url: "wss://relay.example.test/slack", authToken: "relay-token", gatewayId: "gateway-1" },
    });
    await client.configureTelegram({ enabled: true, botToken: { provider: "env", id: "TELEGRAM_BOT_TOKEN" } });
    await client.configureWhatsapp({ enabled: true }, "default");

    expect(patch).toHaveBeenNthCalledWith(1, {
      channels: { slack: { accounts: { work: { botToken: "xoxb-token", appToken: "xapp-token", mode: "socket" } } } },
    });
    expect(patch).toHaveBeenNthCalledWith(2, {
      channels: {
        slack: {
          botToken: "xoxb-token",
          enterpriseOrgInstall: false,
          relay: { url: "wss://relay.example.test/slack", authToken: "relay-token", gatewayId: "gateway-1" },
          mode: "relay",
        },
      },
    });
    expect(patch).toHaveBeenNthCalledWith(3, {
      channels: { telegram: { enabled: true, botToken: { provider: "env", id: "TELEGRAM_BOT_TOKEN" } } },
    });
    expect(patch).toHaveBeenNthCalledWith(4, {
      channels: { whatsapp: { accounts: { default: { enabled: true } } } },
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

  it("accepts direct and wrapped chat.history message arrays", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const directMessages = [{ role: "assistant", content: "direct" }];
    const wrappedMessages = [{ role: "assistant", content: "wrapped" }];
    const wrappedResult = {
      messages: wrappedMessages,
      sessionInfo: {
        status: "running",
        hasActiveRun: true,
        activeRunIds: ["run-1"],
      },
      inFlightRun: { runId: "run-1", text: "partial response" },
    };
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce(directMessages)
      .mockResolvedValueOnce(wrappedResult)
      .mockResolvedValueOnce(wrappedResult);

    await expect(client.chatHistory("main", 12)).resolves.toBe(directMessages);
    await expect(client.chatHistory(undefined, 5)).resolves.toBe(wrappedMessages);
    await expect(client.chatHistoryResult("main", 20)).resolves.toEqual(wrappedResult);
    expect(rpc).toHaveBeenNthCalledWith(1, "chat.history", { sessionKey: "main", limit: 12 });
    expect(rpc).toHaveBeenNthCalledWith(2, "chat.history", { limit: 5 });
    expect(rpc).toHaveBeenNthCalledWith(3, "chat.history", { sessionKey: "main", limit: 20 });
  });

  it("loads a full persisted chat message by transcript id", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Complete response" }],
      __openclaw: { id: "message-1" },
    };
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue({ ok: true, message });

    await expect(client.chatMessageGet("main", "message-1", { maxChars: 500_000 })).resolves.toEqual({
      ok: true,
      message,
    });
    expect(rpc).toHaveBeenCalledWith("chat.message.get", {
      sessionKey: "main",
      messageId: "message-1",
      maxChars: 500_000,
    });
  });

  it.each([
    ["null", null],
    ["a string", "not history"],
    ["an object without messages", {}],
    ["an object with non-array messages", { messages: {} }],
  ])("rejects %s chat.history responses", async (_description, response) => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    vi.spyOn(client as any, "rpc").mockResolvedValue(response);

    await expect(client.chatHistory()).rejects.toMatchObject({
      name: "GatewayRequestError",
      gatewayCode: "PROTOCOL_ERROR",
      message: "Gateway protocol error: chat.history response must be an array or an object with an array `messages` property",
    });
  });

  it("targets an exact active run when aborting chat", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue({ ok: true });

    await client.chatAbort("session-alpha", "run-reload");

    expect(rpc).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "session-alpha",
      runId: "run-reload",
    });
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

  it.each([
    ["key", { key: "agent:default:session-one" }],
    ["sessionKey", { sessionKey: "agent:default:session-one" }],
    ["nested session key", { session: { key: "agent:default:session-one" } }],
  ])("uses the canonical sessions.reset key from %s", async (_description, response) => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    vi.spyOn(client, "rpc").mockResolvedValue(response);

    await expect(client.sessionsReset("session-one", "new")).resolves.toBe("agent:default:session-one");
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

  it("starts and waits for web login while forwarding the current QR code", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const startResult = {
      connected: false,
      message: "Scan this QR code.",
      qrDataUrl: "data:image/png;base64,cXItMQ==",
    };
    const waitResult = {
      connected: false,
      message: "QR refreshed.",
      qrDataUrl: "data:image/png;base64,cXItMg==",
    };
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce(startResult)
      .mockResolvedValueOnce(waitResult);

    await expect(client.webLoginStart({
      force: true,
      timeoutMs: 25_000,
      verbose: true,
      accountId: "work",
    })).resolves.toBe(startResult);
    await expect(client.webLoginWait({
      timeoutMs: 30_000,
      accountId: "work",
      currentQrDataUrl: startResult.qrDataUrl,
    })).resolves.toBe(waitResult);

    expect(rpc).toHaveBeenNthCalledWith(1, "web.login.start", {
      force: true,
      timeoutMs: 25_000,
      verbose: true,
      accountId: "work",
    }, 30_000);
    expect(rpc).toHaveBeenNthCalledWith(2, "web.login.wait", {
      timeoutMs: 30_000,
      accountId: "work",
      currentQrDataUrl: startResult.qrDataUrl,
    }, 120_000);
  });

  it("sends message actions with generated or supplied idempotency keys", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce({ messageId: "generated" })
      .mockResolvedValueOnce({ messageId: "supplied" });

    await client.messageAction({
      channel: "slack",
      action: "react",
      params: { messageId: "1712345.678", emoji: "thumbsup" },
      accountId: "workspace",
      sessionKey: "main",
      conversationReadOrigin: "direct-operator",
      toolContext: { currentChannelId: "C123" },
      requesterAccountId: "untrusted-account",
      requesterSenderId: "untrusted-sender",
      senderIsOwner: true,
    } as any);
    await client.messageAction({
      channel: "slack",
      action: "react",
      params: { messageId: "1712345.678", emoji: "eyes" },
      idempotencyKey: "message-action-key",
    });

    const generatedParams = rpc.mock.calls[0]?.[1];
    expect(rpc).toHaveBeenNthCalledWith(1, "message.action", {
      channel: "slack",
      action: "react",
      params: { messageId: "1712345.678", emoji: "thumbsup" },
      accountId: "workspace",
      sessionKey: "main",
      conversationReadOrigin: "direct-operator",
      idempotencyKey: expect.any(String),
    });
    expect(generatedParams.idempotencyKey).not.toBe("");
    expect(generatedParams.toolContext).toBeUndefined();
    expect(generatedParams.requesterAccountId).toBeUndefined();
    expect(generatedParams.requesterSenderId).toBeUndefined();
    expect(generatedParams.senderIsOwner).toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(2, "message.action", {
      channel: "slack",
      action: "react",
      params: { messageId: "1712345.678", emoji: "eyes" },
      idempotencyKey: "message-action-key",
    });
  });

  it("sends outbound messages with generated or supplied idempotency keys", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue({
      runId: "send-run",
      messageId: "1712345.678",
      channel: "slack",
    });

    await client.send({
      to: "C123",
      message: "hello",
      channel: "slack",
      threadId: "1712000.000",
    });
    await client.send({
      to: "C123",
      mediaUrl: "https://example.com/image.png",
      channel: "slack",
      idempotencyKey: "send-key",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "send", {
      to: "C123",
      message: "hello",
      channel: "slack",
      threadId: "1712000.000",
      idempotencyKey: expect.any(String),
    });
    expect(rpc.mock.calls[0]?.[1].idempotencyKey).not.toBe("");
    expect(rpc).toHaveBeenNthCalledWith(2, "send", {
      to: "C123",
      mediaUrl: "https://example.com/image.png",
      channel: "slack",
      idempotencyKey: "send-key",
    });
  });

  it("starts, stops, and logs out channels while preserving explicit account ids", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce({ channel: "slack", accountId: "default", started: true })
      .mockResolvedValueOnce({ channel: "slack", accountId: "workspace", stopped: true })
      .mockResolvedValueOnce({ channel: "slack", accountId: "", cleared: false });

    await client.channelsStart("slack");
    await client.channelsStop("slack", "workspace");
    await client.channelsLogout("slack", "");

    expect(rpc).toHaveBeenNthCalledWith(1, "channels.start", { channel: "slack" });
    expect(rpc).toHaveBeenNthCalledWith(2, "channels.stop", {
      channel: "slack",
      accountId: "workspace",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "channels.logout", { channel: "slack", accountId: "" });
  });

  it("preserves sessions.list defaults while retaining the rows-only helper", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const response = {
      count: 1,
      defaults: {
        modelProvider: "openai",
        model: "gpt-5-mini",
        thinkingLevels: [{ id: "low", label: "Fast" }],
        thinkingDefault: "low",
      },
      sessions: [{ key: "main" }],
    };
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue(response);

    await expect(client.sessionsListResult()).resolves.toEqual(response);
    await expect(client.sessionsList()).resolves.toEqual([{ key: "main" }]);
    expect(rpc).toHaveBeenNthCalledWith(1, "sessions.list");
    expect(rpc).toHaveBeenNthCalledWith(2, "sessions.list");
  });

  it("sends plugin catalog and lifecycle RPC payloads", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc").mockResolvedValue({ ok: true });

    await client.pluginsList();
    await client.pluginsInstall({
      source: "clawhub",
      packageName: "@community/slack-tools",
      version: "1.2.3",
      acknowledgeClawHubRisk: true,
    });
    await client.pluginsInstall({ source: "official", pluginId: "slack" });
    await client.pluginsSetEnabled({ pluginId: "slack", enabled: true });
    await client.pluginsUninstall({ pluginId: "slack" });
    await client.pluginsRefresh();

    expect(rpc).toHaveBeenNthCalledWith(1, "plugins.list", {});
    expect(rpc).toHaveBeenNthCalledWith(2, "plugins.install", {
      source: "clawhub",
      packageName: "@community/slack-tools",
      version: "1.2.3",
      acknowledgeClawHubRisk: true,
    }, 300_000);
    expect(rpc).toHaveBeenNthCalledWith(3, "plugins.install", {
      source: "official",
      pluginId: "slack",
    }, 300_000);
    expect(rpc).toHaveBeenNthCalledWith(4, "plugins.setEnabled", {
      pluginId: "slack",
      enabled: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(5, "plugins.uninstall", { pluginId: "slack" }, 300_000);
    expect(rpc).toHaveBeenNthCalledWith(6, "plugins.refresh", {});
  });

  it("sends tools RPCs and passes invoke failures through", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const failure = {
      ok: false,
      toolName: "slack_history",
      error: { code: "forbidden", message: "Conversation read is not allowed" },
    };
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce({ agentId: "main", profiles: [], groups: [] })
      .mockResolvedValueOnce({ agentId: "main", profile: "messaging", groups: [] })
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ ok: true, toolName: "slack_history", output: [] });

    await client.toolsCatalog({ agentId: "main", includePlugins: true });
    await client.toolsEffective({ sessionKey: "main", agentId: "main" });
    await expect(client.toolsInvoke({
      name: "slack_history",
      args: { channelId: "C123" },
      conversationReadOrigin: "direct-operator",
    })).resolves.toBe(failure);
    await client.toolsInvoke({
      name: "slack_history",
      sessionKey: "main",
      idempotencyKey: "tools-key",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "tools.catalog", {
      agentId: "main",
      includePlugins: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "tools.effective", {
      sessionKey: "main",
      agentId: "main",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "tools.invoke", {
      name: "slack_history",
      args: { channelId: "C123" },
      conversationReadOrigin: "direct-operator",
      idempotencyKey: expect.any(String),
    });
    expect(rpc.mock.calls[2]?.[1].idempotencyKey).not.toBe("");
    expect(rpc).toHaveBeenNthCalledWith(4, "tools.invoke", {
      name: "slack_history",
      sessionKey: "main",
      idempotencyKey: "tools-key",
    });
  });

  it("sends commands and config schema lookup RPC payloads", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    const rpc = vi.spyOn(client as any, "rpc")
      .mockResolvedValueOnce({ commands: [] })
      .mockResolvedValueOnce({
        path: "channels.slack",
        schema: { type: "object" },
        children: [],
      });

    await client.commandsList({
      agentId: "main",
      provider: "slack",
      scope: "native",
      includeArgs: true,
    });
    await client.configSchemaLookup("channels.slack");

    expect(rpc).toHaveBeenNthCalledWith(1, "commands.list", {
      agentId: "main",
      provider: "slack",
      scope: "native",
      includeArgs: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "config.schema.lookup", {
      path: "channels.slack",
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

  it("settles chatSend from a terminal ok acknowledgement without waiting for stream events", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      (client as any).connected = true;
      (client as any).ws = { readyState: MockWebSocket.OPEN };
      vi.spyOn(client as any, "rpc").mockResolvedValue({
        runId: "terminal-run",
        status: "ok",
      });
      const chatHistory = vi.spyOn(client, "chatHistory").mockResolvedValue([{
        role: "assistant",
        runId: "terminal-run",
        content: [{ type: "text", text: "Already finished" }],
      }]);

      const completion = (async () => {
        const events = [];
        for await (const event of client.chatSend("Finish immediately", "main")) events.push(event);
        return events;
      })();

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(900_000);

      await expect(completion).resolves.toEqual([
        expect.objectContaining({ type: "content", text: "Already finished", runId: "terminal-run" }),
        expect.objectContaining({ type: "done", runId: "terminal-run" }),
      ]);
      expect(chatHistory).toHaveBeenCalledWith("main", 20);
      expect((client as any).internalEventHandlers.size).toBe(0);
      expect((client as any).internalStreamCloseHandlers.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a terminal timeout acknowledgement without tracking a non-running stream", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      (client as any).connected = true;
      (client as any).ws = { readyState: MockWebSocket.OPEN };
      vi.spyOn(client as any, "rpc").mockResolvedValue({
        runId: "timed-out-run",
        status: "timeout",
      });

      const completion = (async () => {
        const events = [];
        for await (const event of client.chatSend("Do not keep waiting", "main")) events.push(event);
        return events;
      })();

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(900_000);

      await expect(completion).resolves.toEqual([
        expect.objectContaining({
          type: "error",
          text: "The run ended before the message was accepted.",
          runId: "timed-out-run",
        }),
      ]);
      expect((client as any).activeNormalChatStreams.size).toBe(0);
      expect((client as any).internalEventHandlers.size).toBe(0);
      expect((client as any).internalStreamCloseHandlers.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes three concurrent normal chat streams by session and accepted run", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method === "chat.send") return { runId: `${params.message}-run` };
      throw new Error(`unexpected RPC ${method}`);
    });
    const first = { message: "first", sessionKey: "conversation-a", response: "first response" };
    const second = { message: "second", sessionKey: "conversation-a", response: "second response" };
    const third = { message: "third", sessionKey: "conversation-b", response: "third response" };
    const conversations = [first, second, third];
    const completions = conversations.map(({ message, sessionKey }) => (async () => {
      const events = [];
      for await (const event of client.chatSend(message, sessionKey)) events.push(event);
      return events;
    })());

    await flushMicrotasks();
    expect((client as any).activeNormalChatStreams.size).toBe(3);
    for (const conversation of [second, third, first]) {
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.content",
        payload: {
          runId: `${conversation.message}-run`,
          sessionKey: conversation.sessionKey,
          text: conversation.response,
        },
      }));
    }
    for (const conversation of [third, first, second]) {
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.done",
        payload: {
          runId: `${conversation.message}-run`,
          sessionKey: conversation.sessionKey,
        },
      }));
    }

    const results = await Promise.all(completions);
    expect(results.map((events) => events.filter(({ type }) => type === "content").map(({ text }) => text))).toEqual(
      conversations.map(({ response }) => [response]),
    );
    expect(results.map((events) => events.map(({ type }) => type))).toEqual([
      ["content", "done"],
      ["content", "done"],
      ["content", "done"],
    ]);
    expect((client as any).activeNormalChatStreams.size).toBe(0);
    expect((client as any).internalEventHandlers.size).toBe(0);
    expect((client as any).internalStreamCloseHandlers.size).toBe(0);
  });

  it("interrupts concurrent normal streams instead of fanning out an identity-less event", async () => {
    const protocolErrors: string[] = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onProtocolError: (info) => protocolErrors.push(info.code),
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method === "chat.send") return { runId: `${params.message}-run` };
      throw new Error(`unexpected RPC ${method}`);
    });
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.event));
    const first = client.chatSend("first", "conversation-a");
    const second = client.chatSend("second", "conversation-b");
    const firstEvent = first.next();
    const secondEvent = second.next();
    await flushMicrotasks();

    expect((client as any).activeNormalChatStreams.size).toBe(2);
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { text: "ambiguous" },
    }));

    const errors = await Promise.all([
      firstEvent.then(() => null, (error) => error),
      secondEvent.then(() => null, (error) => error),
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(GatewayChatStreamInterruptedError);
      expect(error).toMatchObject({
        code: "GATEWAY_CHAT_STREAM_INTERRUPTED",
        reason: "ambiguous-event",
      });
    }
    expect(protocolErrors).toEqual(["AMBIGUOUS_CHAT_STREAM_EVENT"]);
    expect(publicEvents).toEqual([]);
    expect((client as any).activeNormalChatStreams.size).toBe(0);
    expect((client as any).activeStrictChatStreams.size).toBe(0);
    expect((client as any).internalEventHandlers.size).toBe(0);
    expect((client as any).internalStreamCloseHandlers.size).toBe(0);
  });

  it("delivers a post-gap terminal frame before interrupting remaining streams", async () => {
    const gaps: Array<{ expected: number; received: number }> = [];
    const order: string[] = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      onGap: (info) => {
        gaps.push(info);
        order.push("gap");
      },
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method === "chat.send") return { runId: `${params.message}-run` };
      throw new Error(`unexpected RPC ${method}`);
    });
    client.onEvent((event) => {
      if (event.seq === 3) order.push("event");
    });
    const completedStream = (async () => {
      const events = [];
      for await (const event of client.chatSend("completed", "conversation-a")) events.push(event);
      return events;
    })();
    const interruptedStream = client.chatSend("interrupted", "conversation-b");
    const interruptedEvent = interruptedStream.next();
    await flushMicrotasks();

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      seq: 1,
      payload: {
        runId: "completed-run",
        sessionKey: "conversation-a",
        text: "complete response",
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      seq: 3,
      payload: {
        runId: "completed-run",
        sessionKey: "conversation-a",
      },
    }));

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const interruption = await Promise.race([
      interruptedEvent.then(() => null, (error) => error),
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 250);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    expect(interruption).toBeInstanceOf(GatewayChatStreamInterruptedError);
    expect(interruption).toMatchObject({
      code: "GATEWAY_CHAT_STREAM_INTERRUPTED",
      reason: "sequence-gap",
      expectedSequence: 2,
      receivedSequence: 3,
    });
    await expect(completedStream).resolves.toMatchObject([
      { type: "content", text: "complete response" },
      { type: "done" },
    ]);
    expect(order).toEqual(["event", "gap"]);
    expect(gaps).toEqual([{ expected: 2, received: 3 }]);
    expect((client as any).activeNormalChatStreams.size).toBe(0);
    expect((client as any).activeStrictChatStreams.size).toBe(0);
    expect((client as any).internalEventHandlers.size).toBe(0);
    expect((client as any).internalStreamCloseHandlers.size).toBe(0);
  });

  it("chatSend marks explicit replacements and divergent cumulative snapshot corrections", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "correction-run" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Correct this", "main")) {
        events.push(event);
      }
      return events;
    })();

    await flushMicrotasks();
    for (const frame of [
      {
        event: "chat.content",
        payload: { runId: "correction-run", text: "draft" },
      },
      {
        event: "chat.content",
        payload: { runId: "correction-run", text: "corrected", replace: true },
      },
      {
        event: "chat",
        payload: {
          runId: "correction-run",
          sessionKey: "main",
          state: "delta",
          message: { role: "assistant", content: "corrected answer" },
        },
      },
      {
        event: "chat",
        payload: {
          runId: "correction-run",
          sessionKey: "main",
          state: "delta",
          message: { role: "assistant", content: "final answer" },
        },
      },
      {
        event: "chat.done",
        payload: { runId: "correction-run", sessionKey: "main" },
      },
    ]) {
      (client as any).handleMessage(JSON.stringify({ type: "event", ...frame }));
    }

    const events = await streamPromise;
    const contentEvents = events.filter((event) => event.type === "content");
    expect(contentEvents.map(({ text, replace }) => ({ text, replace }))).toEqual([
      { text: "draft", replace: undefined },
      { text: "corrected", replace: true },
      { text: " answer", replace: undefined },
      { text: "final answer", replace: true },
    ]);
    expect(contentEvents.reduce(
      (text, event) => event.replace === true ? event.text ?? "" : text + (event.text ?? ""),
      "",
    )).toBe("final answer");
  });

  it("does not replace a long streamed response with OpenClaw's truncated history projection", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const projectedPrefix = "a".repeat(8_000);
    const complete = `${projectedPrefix}\nThis ending must remain visible.`;
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "stale-history-run" };
      if (method === "chat.history") {
        return {
          messages: [{
            role: "assistant",
            runId: "stale-history-run",
            content: `${projectedPrefix}\n...(truncated)...`,
          }],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Check channels", "main")) events.push(event);
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "stale-history-run", sessionKey: "main", text: complete },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "stale-history-run",
        sessionKey: "main",
        stream: "lifecycle",
        data: { phase: "end" },
      },
    }));

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "content").reduce(
      (text, event) => event.replace === true ? event.text ?? "" : text + (event.text ?? ""),
      "",
    )).toBe(complete);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("does not duplicate chat.content when lifecycle history contains the same text", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpc = vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "lifecycle-content-run" };
      if (method === "chat.history") {
        return {
          messages: [{
            role: "assistant",
            runId: "lifecycle-content-run",
            content: "identical response",
          }],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Reply", "main")) events.push(event);
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "lifecycle-content-run", sessionKey: "main", text: "identical response" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "lifecycle-content-run",
        sessionKey: "main",
        stream: "lifecycle",
        data: { phase: "end" },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "done"]);
    expect(events.filter((event) => event.type === "content").map((event) => event.text)).toEqual([
      "identical response",
    ]);
    expect(rpc.mock.calls.filter(([method]) => method === "chat.history")).toHaveLength(1);
  });

  it.each(["chat.done", "lifecycle end"] as const)(
    "reconciles partial streamed text after tool activity on %s",
    async (terminalEvent) => {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      (client as any).connected = true;
      (client as any).ws = { readyState: MockWebSocket.OPEN };
      const partial = "Let me check which channel plugins are available:";
      const complete = `${partial}\n\nTelegram, Slack, and Discord are ready to configure.`;
      vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
        if (method === "chat.send") return { runId: "tool-reconcile-run" };
        if (method === "chat.history") {
          return {
            messages: [{
              role: "assistant",
              runId: "tool-reconcile-run",
              content: complete,
            }],
          };
        }
        throw new Error(`unexpected RPC ${method}`);
      });

      const streamPromise = (async () => {
        const events = [];
        for await (const event of client.chatSend("Check channels", "main")) events.push(event);
        return events;
      })();

      await flushMicrotasks();
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.content",
        payload: { runId: "tool-reconcile-run", sessionKey: "main", text: partial },
      }));
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.tool_call",
        payload: { runId: "tool-reconcile-run", sessionKey: "main", toolCallId: "tool-1", name: "channels_status", args: {} },
      }));
      (client as any).handleMessage(JSON.stringify(terminalEvent === "chat.done" ? {
        type: "event",
        event: "chat.done",
        payload: { runId: "tool-reconcile-run", sessionKey: "main" },
      } : {
        type: "event",
        event: "agent",
        payload: {
          runId: "tool-reconcile-run",
          sessionKey: "main",
          stream: "lifecycle",
          data: { phase: "end" },
        },
      }));

      const events = await streamPromise;
      expect(events.filter((event) => event.type === "content").reduce(
        (text, event) => event.replace === true ? event.text ?? "" : text + (event.text ?? ""),
        "",
      )).toBe(complete);
      expect(events.at(-1)?.type).toBe("done");
    },
  );

  it("does not reuse a prior runless assistant as textless-terminal fallback", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      (client as any).connected = true;
      (client as any).ws = { readyState: MockWebSocket.OPEN };
      let historyCalls = 0;
      vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
        if (method === "chat.send") return { runId: "baseline-run" };
        if (method === "chat.history") {
          historyCalls += 1;
          return {
            messages: [{
              role: "assistant",
              content: historyCalls === 1 ? "Previous answer" : "Fresh answer",
            }],
          };
        }
        throw new Error(`unexpected RPC ${method}`);
      });

      const streamPromise = (async () => {
        const events = [];
        for await (const event of client.chatSend("New question", "main", undefined, {
          priorAssistantTexts: ["Previous answer"],
        })) events.push(event);
        return events;
      })();

      await flushMicrotasks();
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.done",
        payload: { runId: "baseline-run", sessionKey: "main" },
      }));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(500);

      const events = await streamPromise;
      expect(events.filter((event) => event.type === "content").map((event) => event.text)).toEqual([
        "Fresh answer",
      ]);
      expect(historyCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves protocol identity from chat event payloads", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "identity-run" });
    const identity = {
      eventId: "event-1",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "identity-run",
      canonicalSessionKey: "agent:default:main",
      sessionKey: "main",
      revision: 7,
    };

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("Identity", "main")) events.push(event);
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { ...identity, text: "identified" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: identity,
    }));

    const events = await streamPromise;
    for (const event of events) {
      expect(event).toMatchObject({
        eventId: "event-1",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "identity-run",
        sessionKey: "agent:default:main",
        revision: 7,
      });
    }
  });

  it("stops an acknowledged chatSend stream and removes its handlers when the socket closes", async () => {
    const { client, ws } = await connectClient();
    let acknowledged = false;
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method !== "chat.send") throw new Error(`unexpected RPC ${method}`);
      acknowledged = true;
      return { runId: "closed-run" };
    });
    const stream = client.chatSend("Wait for reply", "main");
    const nextEvent = stream.next();
    await flushMicrotasks();

    expect(acknowledged).toBe(true);
    expect((client as any).internalEventHandlers.size).toBe(1);
    expect((client as any).internalStreamCloseHandlers.size).toBe(1);

    try {
      ws.close(1006, "network lost");
      await expect(nextEvent).rejects.toThrow("gateway closed (1006): network lost");
      expect((client as any).internalEventHandlers.size).toBe(0);
      expect((client as any).internalStreamCloseHandlers.size).toBe(0);
    } finally {
      client.close();
    }
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

  it("reuses an ephemeral session for sequential turns without intermediate resets", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => (
      reason === "new" ? `agent:default:${key}` : key
    ));
    const chatSend = vi.spyOn(client, "chatSend").mockImplementation(async function* (message) {
      yield { type: "content", text: `${message} response` };
      yield { type: "done" };
    });

    const session = await client.createEphemeralChatSession();
    const firstStream = session.chatSend("first");
    expect(() => session.chatSend("concurrent")).toThrow(/active turn/i);
    const firstEvents = [];
    for await (const event of firstStream) firstEvents.push(event);

    expect(firstEvents).toEqual([
      { type: "content", text: "first response" },
      { type: "done" },
    ]);
    expect(sessionsReset).toHaveBeenCalledTimes(1);

    const secondEvents = [];
    for await (const event of session.chatSend("second")) secondEvents.push(event);

    expect(secondEvents).toEqual([
      { type: "content", text: "second response" },
      { type: "done" },
    ]);
    expect(chatSend.mock.calls.map(([message, sessionKey]) => [message, sessionKey])).toEqual([
      ["first", session.sessionKey],
      ["second", session.sessionKey],
    ]);
    expect(sessionsReset).toHaveBeenCalledTimes(1);

    await session.close();
    expect(sessionsReset).toHaveBeenCalledTimes(2);
    expect(sessionsReset).toHaveBeenLastCalledWith(session.sessionKey, "reset");
  });

  it("uses strict correlation and forwards attachments for every ephemeral session turn", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const chatSend = vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "done" };
    });
    const attachments = [{
      type: "image",
      mimeType: "image/png",
      content: "cG5n",
      fileName: "diagram.png",
    }];

    const session = await client.createEphemeralChatSession();
    for await (const _event of session.chatSend("Inspect", attachments)) {
      // Consume the turn so the session can accept another one.
    }

    expect(chatSend).toHaveBeenCalledWith(
      "Inspect",
      session.sessionKey,
      attachments,
      { strictCorrelation: true, ephemeralSession: true },
    );
    await session.close();
  });

  it("closes an ephemeral session idempotently and resets it exactly once", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const session = await client.createEphemeralChatSession();

    const firstClose = session.close();
    const secondClose = session.close();

    expect(session.closed).toBe(true);
    expect(secondClose).toBe(firstClose);
    await Promise.all([firstClose, secondClose, session.close()]);
    expect(sessionsReset).toHaveBeenCalledTimes(2);
    expect(sessionsReset).toHaveBeenNthCalledWith(1, session.sessionKey, "new");
    expect(sessionsReset).toHaveBeenNthCalledWith(2, session.sessionKey, "reset");
  });

  it("rejects ephemeral session sends after close", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const chatSend = vi.spyOn(client, "chatSend");
    const session = await client.createEphemeralChatSession();
    await session.close();

    expect(() => session.chatSend("too late")).toThrow(/closed/i);
    expect(chatSend).not.toHaveBeenCalled();
  });

  it("keeps an ephemeral session reusable after aborting its active turn", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    vi.spyOn(client, "chatSend").mockImplementation(async function* (message) {
      yield { type: "content", text: message };
      await new Promise<void>(() => undefined);
    });
    const session = await client.createEphemeralChatSession();
    const firstTurn = session.chatSend("first");
    await expect(firstTurn.next()).resolves.toMatchObject({ value: { type: "content", text: "first" } });

    await session.chatAbort();
    await flushMicrotasks();

    const secondTurn = session.chatSend("second");
    await expect(secondTurn.next()).resolves.toMatchObject({ value: { type: "content", text: "second" } });
    await secondTurn.return(undefined);
    await session.close();
  });

  it("requires aborting a locally closed turn before starting another ephemeral turn", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    vi.spyOn(client, "chatSend").mockImplementation(async function* (message) {
      yield { type: "content", text: message };
    });
    const session = await client.createEphemeralChatSession();
    const firstTurn = session.chatSend("first");
    await firstTurn.next();
    await firstTurn.return(undefined);

    expect(() => session.chatSend("overlap")).toThrow(/active turn/i);
    await session.chatAbort();
    const secondTurn = session.chatSend("second");
    await expect(secondTurn.next()).resolves.toMatchObject({ value: { type: "content", text: "second" } });
    await session.chatAbort();
    await session.close();
  });

  it("aborts and closes an active turn before resetting its ephemeral session", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const lifecycle: string[] = [];
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => {
      lifecycle.push(`reset:${reason}`);
      return key;
    });
    let releaseTurn: (() => void) | undefined;
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      try {
        yield { type: "content", text: "partial" };
        await new Promise<void>((resolve) => { releaseTurn = resolve; });
        yield { type: "done" };
      } finally {
        lifecycle.push("iterator:closed");
      }
    });
    const chatAbort = vi.spyOn(client, "chatAbort").mockImplementation(async () => {
      lifecycle.push("abort");
      releaseTurn?.();
    });
    const session = await client.createEphemeralChatSession();
    const stream = session.chatSend("Generate");
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "content", text: "partial" } });
    const pending = stream.next();
    await flushMicrotasks();

    await session.close();

    await expect(pending).resolves.toMatchObject({ value: { type: "done" } });
    expect(chatAbort).toHaveBeenCalledWith(session.sessionKey);
    expect(sessionsReset).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(["reset:new", "abort", "iterator:closed", "reset:reset"]);
  });

  it("does not report cleanup success when aborting the active turn fails", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const chatAbort = vi.spyOn(client, "chatAbort")
      .mockRejectedValueOnce(new Error("abort unavailable"))
      .mockResolvedValue(undefined);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: "partial" };
    });
    const session = await client.createEphemeralChatSession();
    const stream = session.chatSend("private");
    await stream.next();

    await expect(session.close()).rejects.toThrow(/did not stop/i);
    expect(sessionsReset.mock.calls.filter(([, reason]) => reason === "reset")).toHaveLength(0);
    await expect(session.close()).resolves.toBeUndefined();
    expect(chatAbort).toHaveBeenCalledTimes(2);
    expect(sessionsReset.mock.calls.filter(([, reason]) => reason === "reset")).toHaveLength(1);
  });

  it("suppresses reserved ephemeral session events after the session closes", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => (
      reason === "new" ? `agent:default:${key}` : key
    ));
    const session = await client.createEphemeralChatSession();
    const unscopedSessionKey = session.sessionKey.slice(session.sessionKey.lastIndexOf(":") + 1);
    await session.close();
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));

    for (const sessionKey of [unscopedSessionKey, session.sessionKey]) {
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.content",
        payload: { sessionKey, text: "private" },
      }));
    }
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { sessionKey: "main", text: "public" },
    }));

    expect(publicEvents).toEqual(["public"]);
  });

  it("retries an ephemeral reset after cleanup fails", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    let resetAttempts = 0;
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => {
      if (reason === "reset" && resetAttempts++ === 0) throw new Error("reset unavailable");
      return key;
    });
    const session = await client.createEphemeralChatSession();

    await expect(session.close()).rejects.toThrow("reset unavailable");
    await expect(session.close()).resolves.toBeUndefined();

    expect(sessionsReset.mock.calls.filter(([, reason]) => reason === "reset")).toHaveLength(2);
  });

  it("suppresses late run-only events from a closed ephemeral session", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "private-late-run" };
      throw new Error(`unexpected RPC ${method}`);
    });
    const session = await client.createEphemeralChatSession();
    const completion = (async () => {
      const events = [];
      for await (const event of session.chatSend("private")) events.push(event);
      return events;
    })();
    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "private-late-run", text: "response" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "private-late-run" },
    }));
    await completion;
    await session.close();
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "private-late-run", text: "private" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-late-run", text: "public" },
    }));

    expect(publicEvents).toEqual(["public"]);
  });

  it("re-publishes an unrelated run-only event deferred before ephemeral acknowledgement", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    let resolveAck: ((value: { runId: string }) => void) | undefined;
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method !== "chat.send") throw new Error(`unexpected RPC ${method}`);
      return await new Promise<{ runId: string }>((resolve) => { resolveAck = resolve; });
    });
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));
    const session = await client.createEphemeralChatSession();
    const stream = session.chatSend("private");
    const firstEvent = stream.next();
    await flushMicrotasks();

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "unacknowledged-private-run", sessionKey: session.sessionKey, text: "private early" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-concurrent-run", text: "normal" },
    }));
    expect(publicEvents).toEqual([]);
    resolveAck?.({ runId: "private-run" });
    await flushMicrotasks();

    expect(publicEvents).toEqual(["normal"]);
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "private-run", text: "private response" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "private-run" },
    }));
    await firstEvent;
    await stream.return(undefined);
    await session.close();
  });

  it("does not publish one private stream while concurrent ephemeral acknowledgements are pending", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    const acknowledge = new Map<string, (value: { runId: string }) => void>();
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method !== "chat.send") throw new Error(`unexpected RPC ${method}`);
      return await new Promise<{ runId: string }>((resolve) => acknowledge.set(params.message, resolve));
    });
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));
    const firstSession = await client.createEphemeralChatSession();
    const secondSession = await client.createEphemeralChatSession();
    const firstStream = firstSession.chatSend("first");
    const secondStream = secondSession.chatSend("second");
    const firstEvent = firstStream.next();
    const secondEvent = secondStream.next();
    await flushMicrotasks();

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "first-run", text: "first private" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-run", text: "normal" },
    }));
    acknowledge.get("second")?.({ runId: "second-run" });
    await flushMicrotasks();
    expect(publicEvents).toEqual([]);

    acknowledge.get("first")?.({ runId: "first-run" });
    await flushMicrotasks();
    expect(publicEvents).toEqual(["normal"]);
    await expect(firstEvent).resolves.toMatchObject({ value: { type: "content", text: "first private" } });

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "first-run" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "second-run", text: "second private" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "second-run" },
    }));
    await expect(secondEvent).resolves.toMatchObject({ value: { type: "content", text: "second private" } });
    await firstStream.return(undefined);
    await secondStream.return(undefined);
    await firstSession.close();
    await secondSession.close();
  });

  it("quarantines unknown run-only events after an ephemeral acknowledgement fails", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") throw new Error("acknowledgement lost");
      throw new Error(`unexpected RPC ${method}`);
    });
    const session = await client.createEphemeralChatSession();
    const stream = session.chatSend("private");
    await expect(stream.next()).rejects.toThrow("acknowledgement lost");
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "unknown-private-run", text: "private leak" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-run", sessionKey: "main", text: "normal" },
    }));

    expect(publicEvents).toEqual(["normal"]);
    await session.close();
  });

  it("does not quarantine public events when an ephemeral attachment fails local validation", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const session = await client.createEphemeralChatSession();

    expect(() => session.chatSend("private", [{
      dataUrl: "not-a-data-url",
      mimeType: "image/png",
    }])).toThrow(/invalid chat attachment/i);
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.payload.text));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-run", text: "normal" },
    }));

    expect(publicEvents).toEqual(["normal"]);
    await session.close();
  });

  it("suppresses nested session updates and identity-less activity while an ephemeral session is active", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const session = await client.createEphemeralChatSession();
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(event.event));

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "sessions.updated",
      payload: { sessions: [{ key: session.sessionKey, title: "Private chat" }] },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "activity.log",
      payload: { text: "private activity" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "status.updated",
      payload: { state: "ready" },
    }));

    expect(publicEvents).toEqual(["status.updated"]);
    await session.close();
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
    expect(sessionKey).toMatch(/^session-hypercli-ephemeral-[0-9a-f-]+$/);
    expect(sessionsReset).toHaveBeenNthCalledWith(1, sessionKey, "new");
    expect(sessionsReset).toHaveBeenNthCalledWith(2, `agent:default:${sessionKey}`, "reset");
    expect(chatSend).toHaveBeenCalledWith(
      "Generate JSON",
      `agent:default:${sessionKey}`,
      undefined,
      { strictCorrelation: true, ephemeralSession: true },
    );
    expect(chatAbort).not.toHaveBeenCalled();
  });

  it("rejects a completed ephemeral run when its session cannot be reset", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => {
      if (reason === "reset") throw new Error("cleanup unavailable");
      return key;
    });
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "content", text: "private result" };
      yield { type: "done" };
    });

    await expect(client.runEphemeralChat("Generate JSON")).rejects.toThrow("cleanup unavailable");
  });

  it.each([
    "main",
    "agent:default:main",
    "unrelated-session",
  ])("rejects unsafe ephemeral canonical key %s without using it", async (canonicalKey) => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => (
      reason === "new" ? canonicalKey : key
    ));
    const chatSend = vi.spyOn(client, "chatSend");
    const chatAbort = vi.spyOn(client, "chatAbort").mockResolvedValue(undefined);

    await expect(client.runEphemeralChat("Generate JSON")).rejects.toThrow(/unsafe ephemeral session key/i);

    const requestedKey = sessionsReset.mock.calls[0]?.[0];
    expect(requestedKey).toMatch(/^session-hypercli-ephemeral-[0-9a-f-]+$/);
    expect(chatSend).not.toHaveBeenCalled();
    expect(chatAbort).not.toHaveBeenCalled();
    expect(sessionsReset.mock.calls).not.toContainEqual([canonicalKey, "reset"]);
    expect(sessionsReset).toHaveBeenLastCalledWith(requestedKey, "reset");
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

  it("fails the ephemeral run when fast mode emits an error", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    const chatSend = vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "error", text: "fast mode unavailable" };
    });

    await expect(client.runEphemeralChat("Generate JSON", { fastMode: true })).rejects.toThrow(
      "fast mode unavailable",
    );
    expect(chatSend).toHaveBeenCalledTimes(1);
  });

  it("keeps ephemeral and identity-less stream events internal while publishing other sessions", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "ephemeral-run" };
      throw new Error(`unexpected RPC ${method}`);
    });
    const publicEvents: string[] = [];
    client.onEvent((event) => publicEvents.push(`${event.event}:${event.payload.text ?? ""}`));

    const completion = client.runEphemeralChat("Generate JSON");
    await flushMicrotasks();
    const sessionKey = sessionsReset.mock.calls.find(([, reason]) => reason === "new")?.[0];
    expect(sessionKey).toMatch(/^session-hypercli-ephemeral-/);

    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { text: "unkeyed leak" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: { stream: "tool", data: { phase: "start", name: "leaked-tool" } },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "normal-run", sessionKey: "main", text: "normal" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { sessionKey, text: "safe" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { sessionKey },
    }));

    await expect(completion).resolves.toBe("safe");
    expect(publicEvents).toEqual(["chat.content:normal"]);
  });

  it("routes four concurrent ephemeral streams only by their accepted run IDs", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method === "chat.send") return { runId: `${params.message}-run` };
      throw new Error(`unexpected RPC ${method}`);
    });

    const labels = ["first", "second", "third", "fourth"];
    const completions = labels.map((label) => client.runEphemeralChat(label));
    await flushMicrotasks();

    for (const label of [...labels].reverse()) {
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.content",
        payload: { runId: `${label}-run`, text: `${label} response` },
      }));
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "chat.done",
        payload: { runId: `${label}-run` },
      }));
    }

    await expect(Promise.all(completions)).resolves.toEqual(
      labels.map((label) => `${label} response`),
    );
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
    const sessionsReset = vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "error", text: "workflow failed" };
    });
    const events: string[] = [];

    await expect(client.runEphemeralChat("Inspect", {
      onEvent: (event) => events.push(`${event.type}:${event.text}`),
    })).rejects.toThrow("workflow failed");

    expect(events).toEqual(["error:workflow failed"]);
    expect(sessionsReset.mock.calls.filter(([, reason]) => reason === "reset")).toHaveLength(1);
  });

  it("reports both a terminal ephemeral error and a cleanup failure", async () => {
    const client = new GatewayClient({ url: "wss://openclaw-agent.example", gatewayToken: "gw-token" });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key, reason) => {
      if (reason === "reset") throw new Error("reset unavailable");
      return key;
    });
    vi.spyOn(client, "chatSend").mockImplementation(async function* () {
      yield { type: "error", text: "workflow failed" };
    });

    await expect(client.runEphemeralChat("Inspect")).rejects.toThrow(
      "workflow failed Private chat cleanup also failed: reset unavailable",
    );
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
      yield { type: "done" };
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

  it("waits for fresh uncorrelated history on a reused ephemeral session", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client, "sessionsReset").mockImplementation(async (key) => key);
    let secondTurnStarted = false;
    let secondTurnHistoryReads = 0;
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: Record<string, any>) => {
      if (method === "chat.send") {
        if (params.message === "second") secondTurnStarted = true;
        return { runId: `${params.message}-run` };
      }
      if (method === "chat.history") {
        if (!secondTurnStarted) {
          throw new Error("history temporarily unavailable");
        }
        secondTurnHistoryReads += 1;
        return {
          messages: secondTurnHistoryReads === 1
            ? [{ role: "assistant", content: "first response" }]
            : [
                { role: "assistant", content: "first response" },
                { role: "assistant", content: "second response" },
              ],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });
    const session = await client.createEphemeralChatSession();
    const firstCompletion = (async () => {
      const events = [];
      for await (const event of session.chatSend("first")) events.push(event);
      return events;
    })();
    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.content",
      payload: { runId: "first-run", text: "first response" },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "first-run" },
    }));
    await firstCompletion;

    const secondCompletion = (async () => {
      const events = [];
      for await (const event of session.chatSend("second")) events.push(event);
      return events;
    })();
    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.done",
      payload: { runId: "second-run" },
    }));

    const secondEvents = await secondCompletion;
    expect(secondEvents.filter((event) => event.type === "content").map((event) => event.text)).toEqual([
      "second response",
    ]);
    await session.close();
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

  it("sendChat creates an SDK session key when omitted", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpcSpy = vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "generated-session-run" });

    await expect(client.sendChat("hello")).resolves.toEqual({ runId: "generated-session-run" });

    expect(rpcSpy).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "hello",
        deliver: false,
        sessionKey: expect.stringMatching(/^hcli:[0-9a-f-]+$/i),
      }),
      expect.any(Number),
    );
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
      reasoning: "Plan A",
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

  it("normalizes payload reasoning_content and Anthropic thinking blocks", () => {
    expect(normalizeGatewayChatMessage({
      role: "assistant",
      reasoning_content: "Inspect the current state first.",
      content: "Final answer.",
    })).toMatchObject({
      text: "Final answer.",
      reasoning: "Inspect the current state first.",
      thinking: "Inspect the current state first.",
    });

    expect(normalizeGatewayChatMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Check the deployment.", signature: "provider-signature" },
        { type: "text", text: "Deployment is healthy." },
      ],
    })).toMatchObject({
      text: "Deployment is healthy.",
      reasoning: "Check the deployment.",
      thinking: "Check the deployment.",
    });
  });

  it("preserves protocol identity in normalized chat history summaries", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      content: "Stored response",
      messageId: "message-history-1",
      turnId: "turn-history-1",
      runId: "run-history-1",
      canonicalSessionKey: "agent:default:main",
      sessionKey: "main",
      revision: 4,
    });

    expect(normalized).toMatchObject({
      messageId: "message-history-1",
      turnId: "turn-history-1",
      runId: "run-history-1",
      sessionKey: "agent:default:main",
      revision: 4,
    });
  });

  it("normalizes Responses-style function call records into tool calls", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      timestamp: 123,
      content: [
        { type: "function_call", call_id: "call-1", name: "memory_search", arguments: { query: "demo memory" } },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: {
            results: [],
            disabled: true,
            error: "index provider settings changed",
          },
        },
      ],
    });

    expect(normalized?.toolCalls).toEqual([
      {
        id: "call-1",
        name: "memory_search",
        args: { query: "demo memory" },
        result: JSON.stringify({
          results: [],
          disabled: true,
          error: "index provider settings changed",
        }, null, 2),
      },
    ]);
  });

  it("preserves result fields embedded in top-level tool_calls", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      timestamp: 123,
      tool_calls: [
        {
          id: "call-search",
          name: "web_search",
          arguments: { query: "demo docs" },
          result: { status: 429, error: "rate limit" },
        },
      ],
    });

    expect(normalized?.toolCalls).toEqual([
      {
        id: "call-search",
        name: "web_search",
        args: { query: "demo docs" },
        result: JSON.stringify({ status: 429, error: "rate limit" }, null, 2),
      },
    ]);
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
      reasoning: "",
      thinking: "",
      toolCalls: [],
      mediaUrls: ["data:audio/mpeg;base64,AAAA"],
      timestamp: 123,
    });
  });

  it("normalizes direct and nested TTS output audio shapes", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      content: [
        { type: "output_audio", data: "AAAA", format: "wav" },
        { type: "output_audio", output_audio: { data: "BBBB", mime_type: "audio/ogg" } },
        { type: "output_audio", output_audio: { data: "CCCC", mime_type: "audio/webm;codecs=opus" } },
        { type: "audio", audio: { url: "https://cdn.example.test/reply.mp3" } },
      ],
    });

    expect(normalized?.mediaUrls).toEqual([
      "data:audio/wav;base64,AAAA",
      "data:audio/ogg;base64,BBBB",
      "data:audio/webm;base64,CCCC",
      "https://cdn.example.test/reply.mp3",
    ]);
  });

  it("does not trust non-audio mime types on TTS payloads", () => {
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      content: [{ type: "output_audio", data: "AAAA", media_type: "text/html" }],
    });

    expect(normalized?.mediaUrls).toEqual(["data:audio/mpeg;base64,AAAA"]);
  });

  it("normalizes OpenClaw managed outgoing image blocks as media urls", () => {
    const mediaUrl = "/api/chat/media/outgoing/agent%3Adefault%3Amain/11111111-1111-4111-8111-111111111111/full";
    const normalized = normalizeGatewayChatMessage({
      role: "assistant",
      timestamp: 123,
      content: [
        {
          type: "image",
          url: mediaUrl,
          openUrl: mediaUrl,
          alt: "cat.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(normalized).toEqual({
      role: "assistant",
      text: "",
      reasoning: "",
      thinking: "",
      toolCalls: [],
      mediaUrls: [mediaUrl],
      timestamp: 123,
    });
  });

  it("reads gateway managed media over authenticated HTTP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example/ws",
      gatewayToken: "gw-token",
    });

    const bytes = await client.readMediaBytes("/api/chat/media/outgoing/session/11111111-1111-4111-8111-111111111111/full");

    expect([...bytes]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openclaw-agent.example/api/chat/media/outgoing/session/11111111-1111-4111-8111-111111111111/full",
      { headers: { Authorization: "Bearer gw-token" } },
    );
  });

  it("chatSend emits reasoning and tool events from final structured snapshots", async () => {
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
      "reasoning",
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

  it("keeps streaming through a provider lifecycle error and replaces the failed attempt", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") {
        return { runId: "fallback-run-1" };
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
      event: "chat",
      payload: {
        runId: "fallback-run-1",
        sessionKey: "main",
        seq: 1,
        state: "delta",
        deltaText: "Draft",
        message: { role: "assistant", content: "Draft" },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "fallback-run-1",
        sessionKey: "main",
        seq: 2,
        stream: "lifecycle",
        data: { phase: "error", error: "provider unavailable" },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "fallback-run-1",
        sessionKey: "main",
        seq: 2,
        state: "delta",
        deltaText: " tail",
        message: { role: "assistant", content: "Draft tail" },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "fallback-run-1",
        sessionKey: "main",
        seq: 3,
        state: "delta",
        deltaText: "Draft",
        message: { role: "assistant", content: "Draft" },
      },
    }));
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat",
      payload: {
        runId: "fallback-run-1",
        sessionKey: "main",
        seq: 4,
        state: "final",
        message: { role: "assistant", content: "Draft complete" },
      },
    }));

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toEqual(["content", "content", "content", "content", "done"]);
    expect(events.filter((event) => event.type === "content").map(({ text, replace }) => ({ text, replace }))).toEqual([
      { text: "Draft", replace: undefined },
      { text: " tail", replace: undefined },
      { text: "Draft", replace: true },
      { text: " complete", replace: undefined },
    ]);
  });

  it("reconciles fallback history when the terminal event has no message", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "fallback-history-run" };
      if (method === "chat.history") {
        return {
          messages: [{
            role: "assistant",
            runId: "fallback-history-run",
            content: "Fallback answer from history",
          }],
        };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("retry please", "main")) events.push(event);
      return events;
    })();

    await flushMicrotasks();
    for (const frame of [
      {
        event: "chat",
        payload: {
          runId: "fallback-history-run",
          sessionKey: "main",
          seq: 1,
          state: "delta",
          deltaText: "Failed draft",
          message: { role: "assistant", content: "Failed draft" },
        },
      },
      {
        event: "agent",
        payload: {
          runId: "fallback-history-run",
          sessionKey: "main",
          seq: 2,
          stream: "lifecycle",
          data: { phase: "error", error: "provider unavailable" },
        },
      },
      {
        event: "chat",
        payload: {
          runId: "fallback-history-run",
          sessionKey: "main",
          seq: 3,
          state: "final",
        },
      },
    ]) {
      (client as any).handleMessage(JSON.stringify({ type: "event", ...frame }));
    }

    await expect(streamPromise).resolves.toMatchObject([
      { type: "content", text: "Failed draft" },
      { type: "content", text: "Fallback answer from history", replace: true },
      { type: "done" },
    ]);
  });

  it("times out a legacy lifecycle-only error after waiting for fallback", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "wss://openclaw-agent.example",
        gatewayToken: "gw-token",
      });
      (client as any).connected = true;
      (client as any).ws = { readyState: MockWebSocket.OPEN };
      vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "legacy-error-run" });
      const streamPromise = (async () => {
        const events = [];
        for await (const event of client.chatSend("fail please", "main")) events.push(event);
        return events;
      })();

      await flushMicrotasks();
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "agent",
        payload: {
          runId: "legacy-error-run",
          sessionKey: "main",
          seq: 2,
          stream: "lifecycle",
          data: { phase: "error", error: "legacy failure" },
        },
      }));
      (client as any).handleMessage(JSON.stringify({
        type: "event",
        event: "agent",
        payload: {
          runId: "legacy-error-run",
          sessionKey: "main",
          seq: 3,
          stream: "tool",
          data: { phase: "result", toolCallId: "late-tool", name: "shell", result: "done" },
        },
      }));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(streamPromise).resolves.toMatchObject([
        { type: "tool_result", runId: "legacy-error-run" },
        { type: "error", text: "legacy failure" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chatSend terminates on a legacy chat.aborted event", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "aborted-run-1" });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("stop please", "main")) events.push(event);
      return events;
    })();

    await flushMicrotasks();
    (client as any).handleMessage(JSON.stringify({
      type: "event",
      event: "chat.aborted",
      payload: { runId: "aborted-run-1", sessionKey: "main" },
    }));

    await expect(streamPromise).resolves.toMatchObject([
      { type: "error", text: "aborted", runId: "aborted-run-1" },
    ]);
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
      json: async () => ({
        agent_id: "deployment-123",
        jwt: "jwt-exec",
        expires_at: "2026-08-15T00:05:00Z",
        ws_url: "wss://socket.example.test/product/ws/exec/deployment-123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const pairingUpdates: Array<string | null> = [];
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
      onPairing: (pairing) => pairingUpdates.push(pairing?.status ?? null),
    });
    const connectionStates: string[] = [];
    client.onConnectionState((state) => connectionStates.push(state));

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
      {
        code: "PAIRING_REQUIRED",
        requestId: "pairing-req-'$(touch /tmp/pwn)",
        reason: "not-paired",
      },
    );
    await flushMicrotasks();

    const execSocket = MockWebSocket.instances.at(-1);
    if (!execSocket || execSocket === firstSocket) throw new Error("Missing exec websocket");
    await waitForSentFrame(execSocket);
    expect(execSocket.url).toBe(
      "wss://socket.example.test/product/ws/exec/deployment-123?jwt=jwt-exec",
    );
    const execFrame = JSON.parse(execSocket.sent[0] ?? "{}") as Record<string, unknown>;
    expect(execFrame.timeout).toBe(30);
    expect(execFrame.dry_run).toBe(false);
    // Exec is an exact argv list, so a request id carrying shell syntax travels
    // as one literal argument and there is no shell to expand it. The old
    // string form had to hand-quote this to stay safe.
    expect(execFrame.command).toEqual([
      "openclaw",
      "devices",
      "approve",
      "pairing-req-'$(touch /tmp/pwn)",
      "--json",
    ]);
    execSocket.emit({
      event: "agent_exec_result",
      ok: true,
      exit_code: 0,
      stdout: "approved",
      stderr: "",
    });
    execSocket.close(1000, "");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dev.hypercli.com/deployments/deployment-123/exec/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer app-token",
        }),
      }),
    );
    expect((fetchMock.mock.calls[0] ?? [])[1]?.body).toBeUndefined();

    expect(pairingUpdates).toEqual(["approving", null]);
    expect(connectionStates).toEqual(["connecting", "pairing", "connecting"]);
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
    expect(connectionStates).toEqual(["connecting", "pairing", "connecting", "connected"]);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.pendingPairings).toBeUndefined();
    expect(stored.tokens[DEPLOYMENT_SCOPE_KEY].token).toBe("device-token-after-pair");
  });

  it.each([
    ["malformed", "not-json", "invalid exec JSON", false],
    ["non-text", new Uint8Array([1, 2, 3]), "non-text exec result", false],
    [
      "multiple",
      JSON.stringify({
        event: "agent_exec_result",
        ok: true,
        exit_code: 0,
        stdout: "approved",
        stderr: "",
      }),
      "multiple exec results",
      true,
    ],
  ])("closes rejected %s pairing exec frames before failing", async (_label, data, error, twice) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agent_id: "deployment-123",
        jwt: "jwt-exec",
        expires_at: "2026-08-15T00:05:00Z",
        ws_url: "wss://socket.example.test/ws/exec/deployment-123",
      }),
    }) as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const connecting = client.connect();
    const rejection = expect(connecting).rejects.toThrow(error as string);
    await flushMicrotasks();

    const gatewaySocket = MockWebSocket.instances.at(-1);
    if (!gatewaySocket) throw new Error("Missing gateway websocket");
    gatewaySocket.emitChallenge("nonce-invalid-exec");
    const request = await parseFirstRequest(gatewaySocket);
    gatewaySocket.emitConnectError(
      request.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-invalid-exec", reason: "not-paired" },
    );
    await flushMicrotasks();

    const execSocket = MockWebSocket.instances.at(-1);
    if (!execSocket || execSocket === gatewaySocket) throw new Error("Missing exec websocket");
    await waitForSentFrame(execSocket);
    execSocket.onmessage?.({ data: data as string });
    if (twice) execSocket.onmessage?.({ data: data as string });

    await rejection;
    expect(execSocket.closedWith).toEqual({ code: 1008, reason: expect.any(String) });
  });

  it("reuses the browser identity for a warm deployment on one fresh socket", async () => {
    const first = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
    }));
    const deviceId = first.request.params.device.id;
    first.client.close();
    await flushMicrotasks();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);
    const socketCountBeforeWarmConnect = MockWebSocket.instances.length;
    const warmClient = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const connecting = warmClient.connect();
    await flushMicrotasks();

    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing warm websocket instance");
    socket.emitChallenge("nonce-warm-device");
    const request = await parseFirstRequest(socket);
    expect(request.params.device.id).toBe(deviceId);
    expect(request.params.auth.token).toBe("gw-token");
    expect(request.params.auth.deviceToken).toBeUndefined();
    socket.emitHello(request.id, "device-token-2");
    await connecting;

    expect(MockWebSocket.instances).toHaveLength(socketCountBeforeWarmConnect + 1);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens[DEPLOYMENT_SCOPE_KEY].token).toBe("device-token-2");
  });

  it("singleflights browser identity creation across concurrent cold deployments", async () => {
    const first = new GatewayClient({
      url: "wss://openclaw-a.example",
      gatewayToken: "gw-token-a",
      deploymentId: "deployment-a",
    });
    const second = new GatewayClient({
      url: "wss://openclaw-b.example",
      gatewayToken: "gw-token-b",
      deploymentId: "deployment-b",
    });
    const firstConnecting = first.connect();
    const secondConnecting = second.connect();
    await flushMicrotasks();
    const [firstSocket, secondSocket] = MockWebSocket.instances.slice(-2);
    if (!firstSocket || !secondSocket) throw new Error("Missing concurrent gateway sockets");

    firstSocket.emitChallenge("nonce-cold-a");
    secondSocket.emitChallenge("nonce-cold-b");
    const [firstRequest, secondRequest] = await Promise.all([
      parseFirstRequest(firstSocket),
      parseFirstRequest(secondSocket),
    ]);
    expect(firstRequest.params.device.id).toBe(secondRequest.params.device.id);

    firstSocket.emitHello(firstRequest.id, "device-token-a");
    secondSocket.emitHello(secondRequest.id, "device-token-b");
    await Promise.all([firstConnecting, secondConnecting]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.deviceId).toBe(firstRequest.params.device.id);
    expect(stored.tokens["deployment-a|operator"].token).toBe("device-token-a");
    expect(stored.tokens["deployment-b|operator"].token).toBe("device-token-b");
  });

  it("does not reuse a persisted device token for another deployment", async () => {
    const first = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
    }));
    const deviceId = first.request.params.device.id;
    first.client.close();
    await flushMicrotasks();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);
    const otherClient = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-456",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const connecting = otherClient.connect();
    const rejected = expect(connecting).rejects.toThrow("token mismatch");
    await flushMicrotasks();

    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing other-deployment websocket instance");
    socket.emitChallenge("nonce-other-deployment");
    const request = await parseFirstRequest(socket);
    expect(request.params.device.id).toBe(deviceId);
    expect(request.params.auth.deviceToken).toBeUndefined();
    socket.emitConnectError(request.id, "AUTH_TOKEN_MISMATCH", "token mismatch", {
      code: "AUTH_TOKEN_MISMATCH",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });
    await rejected;

    expect(socket.sent).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens[DEPLOYMENT_SCOPE_KEY].token).toBe("device-token-1");
    expect(stored.tokens["deployment-456|operator"]).toBeUndefined();
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

  it("moves through pairing without disconnecting when approval outlives the first socket", async () => {
    const prior = await connectClient(new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
    }));
    prior.client.close();
    await flushMicrotasks();
    const priorStore = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    priorStore.tokens[DEPLOYMENT_SCOPE_KEY].token = "stale-device-token";
    priorStore.pendingPairings = {
      [DEPLOYMENT_SCOPE_KEY]: { requestId: "stale-pairing-request", role: "operator" },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(priorStore));

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
    const seen: string[] = [];
    client.onConnectionState((state) => seen.push(state));

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
    expect(client.state).toBe("pairing");
    expect(seen).toEqual(["connecting", "pairing"]);
    if (!resolveFetch) throw new Error("Missing pending approval request");
    resolveFetch({
      ok: true,
      json: async () => ({
        agent_id: "deployment-123",
        jwt: "jwt-exec",
        expires_at: "2026-08-15T00:05:00Z",
        ws_url: "wss://socket.example.test/ws/exec/deployment-123",
      }),
    });
    await flushMicrotasks();
    const approvalSocket = MockWebSocket.instances.at(-1);
    if (!approvalSocket || approvalSocket === firstSocket) {
      throw new Error("Missing late approval exec websocket");
    }
    await waitForSentFrame(approvalSocket);
    approvalSocket.emit({
      event: "agent_exec_result",
      ok: true,
      exit_code: 0,
      stdout: "approved",
      stderr: "",
    });
    approvalSocket.close(1000, "");
    await flushMicrotasks(8);

    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket || secondSocket === approvalSocket) {
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
    expect(seen).toEqual(["connecting", "pairing", "connecting", "connected"]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens[DEPLOYMENT_SCOPE_KEY].token).toBe("device-token-after-late-approval");
    expect(stored.pendingPairings?.[DEPLOYMENT_SCOPE_KEY]).toBeUndefined();
  });

  it("terminates a failed pairing approval without reconnecting", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("approval denied"));
    vi.stubGlobal("fetch", fetchMock as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const seen: string[] = [];
    client.onConnectionState((state) => seen.push(state));

    const connecting = client.connect();
    const rejected = expect(connecting).rejects.toThrow("approval denied");
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing pairing websocket instance");
    socket.emitChallenge("nonce-failed-pairing");
    const request = await parseFirstRequest(socket);
    socket.emitConnectError(
      request.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-failed", reason: "not-paired" },
    );
    await rejected;
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.state).toBe("disconnected");
    expect(client.pendingPairing).toEqual(expect.objectContaining({
      requestId: "pairing-req-failed",
      status: "failed",
    }));
    expect(seen).toEqual(["connecting", "pairing", "disconnected"]);
  });

  it("aborts an in-flight pairing approval when the client stops", async () => {
    let approvalSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => {
      approvalSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        approvalSignal?.addEventListener("abort", () => reject(approvalSignal?.reason), { once: true });
      });
    }) as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const connecting = client.connect();
    const rejected = expect(connecting).rejects.toThrow("gateway client stopped");
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing pairing websocket instance");
    socket.emitChallenge("nonce-stopped-pairing");
    const request = await parseFirstRequest(socket);
    socket.emitConnectError(
      request.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-stopped", reason: "not-paired" },
    );
    await flushMicrotasks();

    expect(approvalSignal?.aborted).toBe(false);
    client.stop();
    await rejected;
    expect(approvalSignal?.aborted).toBe(true);
    expect(client.state).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("terminates a pairing approval that exceeds its HTTP deadline", async () => {
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }) as any);
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
    });
    const connecting = client.connect();
    const rejected = expect(connecting).rejects.toThrow("Pairing approval timed out");
    await flushMicrotasks();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing pairing websocket instance");
    socket.emitChallenge("nonce-timeout-pairing");
    const request = await parseFirstRequest(socket);
    vi.useFakeTimers();
    socket.emitConnectError(
      request.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-timeout", reason: "not-paired" },
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(35_000);

    await rejected;
    expect(client.state).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("keeps a signal-only waiter alive while pairing approval exceeds the RPC timeout", async () => {
    let resolveApproval!: (value: unknown) => void;
    const approval = new Promise((resolve) => {
      resolveApproval = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => approval) as any);
    const controller = new AbortController();
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
      deploymentId: "deployment-123",
      apiKey: "app-token",
      apiBase: "https://api.dev.hypercli.com",
      autoApprovePairing: true,
      timeout: 10,
    });

    let settled = false;
    const connecting = client.connect({ signal: controller.signal }).finally(() => {
      settled = true;
    });
    await flushMicrotasks();

    const firstSocket = MockWebSocket.instances.at(-1);
    if (!firstSocket) throw new Error("Missing first websocket instance");
    firstSocket.emitChallenge("nonce-slow-pairing");
    const firstRequest = await parseFirstRequest(firstSocket);
    firstSocket.emitConnectError(
      firstRequest.id,
      "PAIRING_REQUIRED",
      "pairing required",
      { code: "PAIRING_REQUIRED", requestId: "pairing-req-slow", reason: "not-paired" },
    );
    firstSocket.close(1008, "pairing required");

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(1);

    resolveApproval({
      ok: true,
      json: async () => ({
        agent_id: "deployment-123",
        jwt: "jwt-exec",
        expires_at: "2026-08-15T00:05:00Z",
        ws_url: "wss://socket.example.test/ws/exec/deployment-123",
      }),
    });
    await flushMicrotasks();
    const approvalSocket = MockWebSocket.instances.at(-1);
    if (!approvalSocket || approvalSocket === firstSocket) {
      throw new Error("Missing slow approval exec websocket");
    }
    await waitForSentFrame(approvalSocket);
    approvalSocket.emit({
      event: "agent_exec_result",
      ok: true,
      exit_code: 0,
      stdout: "approved",
      stderr: "",
    });
    approvalSocket.close(1000, "");
    await flushMicrotasks(8);

    const secondSocket = MockWebSocket.instances.at(-1);
    if (!secondSocket || secondSocket === firstSocket || secondSocket === approvalSocket) {
      throw new Error("Missing websocket after slow pairing approval");
    }
    secondSocket.emitChallenge("nonce-after-slow-pairing");
    const secondRequest = await parseFirstRequest(secondSocket);
    secondSocket.emitHello(secondRequest.id, "device-token-after-slow-pairing");

    await connecting;
    expect(client.isConnected).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(3);
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

describe("GatewayClient OpenClaw commentary chat events", () => {
  // Contract evidence: the live gateway emits explicit user-facing progress
  // commentary as `agent` events with payload.stream "assistant" and
  // payload.data.phase "commentary" (cumulative `text`, `delta`, `replace`).
  // These frames are distinct from raw reasoning (`stream "thinking"`, which
  // must stay private) and are mirrored through ordinary `chat` deltas, so the
  // SDK must surface a dedicated typed event instead of discarding the marker.
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as any);
    vi.stubGlobal("localStorage", new MockLocalStorage() as any);
    vi.stubGlobal("crypto", webcrypto as any);
    vi.useRealTimers();
  });

  function newChatClient() {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, _params?: Record<string, any>) => {
      if (method === "chat.send") return { runId: "run-commentary" };
      if (method === "chat.history") return { messages: [] };
      throw new Error(`unexpected RPC ${method}`);
    });
    return client;
  }

  function emit(client: GatewayClient, frame: unknown) {
    (client as any).handleMessage(JSON.stringify(frame));
  }

  function commentaryFrame(text: string, overrides: Record<string, unknown> = {}) {
    return {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "commentary", text, delta: "", replace: true },
        ...overrides,
      },
    };
  }

  async function collectChatSend(client: GatewayClient, message = "inspect", sessionKey = "main") {
    return (async () => {
      const events: Array<Record<string, unknown> & { type: string }> = [];
      for await (const event of client.chatSend(message, sessionKey)) {
        events.push(event as unknown as Record<string, unknown> & { type: string });
      }
      return events;
    })();
  }

  it("surfaces explicit assistant commentary frames as typed commentary chat events", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, commentaryFrame("Inspecting the workspace"));
    emit(client, commentaryFrame("Inspecting the workspace sources"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Inspection complete." }],
        },
      },
    });

    const events = await streamPromise;
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "commentary")).toHaveLength(2);
    expect(types.at(-1)).toBe("done");
    const commentary = events.filter((event) => event.type === "commentary");
    expect(commentary[0]).toMatchObject({
      type: "commentary",
      text: "Inspecting the workspace",
      replace: true,
      runId: "run-commentary",
      sessionKey: "main",
    });
    expect(commentary[1]).toMatchObject({
      text: "Inspecting the workspace sources",
      replace: true,
    });
    // Commentary must not overload the private thinking channel.
    for (const event of events) {
      expect(event.type).not.toBe("thinking");
    }
    // The final answer still arrives as ordinary terminal content.
    const finalContent = events.filter((event) => event.type === "content").at(-1);
    expect(finalContent?.text).toBe("Inspection complete.");
  });

  it("streams payload reasoning_content separately from answer content", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        choices: [{ delta: { reasoning_content: "Inspecting the workspace" } }],
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", reasoning_content: "Inspecting the workspace configuration" },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Configuration is valid" }] },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", reasoning_content: "This late reasoning remains a separate lane" },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Configuration is valid." }] },
      },
    });

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "reasoning").map((event) => event.text)).toEqual([
      "Inspecting the workspace",
      " configuration",
      "This late reasoning remains a separate lane",
    ]);
    expect(events.filter((event) => event.type === "commentary")).toHaveLength(0);
    expect(events.filter((event) => event.type === "content").map((event) => event.text).join("")).toBe("Configuration is valid.");
  });

  it("streams Anthropic thinking_delta frames through the reasoning channel", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    for (const thinking of ["Checking ", "the deployment"] as const) {
      emit(client, {
        type: "event",
        event: "chat",
        payload: {
          runId: "run-commentary",
          sessionKey: "main",
          state: "delta",
          delta: { type: "thinking_delta", thinking },
        },
      });
    }
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Deployment checked." }] },
      },
    });

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "reasoning").map((event) => event.text)).toEqual([
      "Checking ",
      "the deployment",
    ]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("keeps the mirrored ordinary chat deltas flowing alongside commentary events", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, commentaryFrame("Checking credentials"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Checking credentials" }] },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Checking credentials\nCredentials verified." }],
        },
      },
    });

    const events = await streamPromise;
    expect(events.map((event) => event.type)).toContain("commentary");
    const contentEvents = events.filter((event) => event.type === "content");
    expect(contentEvents.length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("respects replace flags and keeps repeated identical replacements stable", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    for (let update = 0; update < 8; update += 1) {
      emit(client, commentaryFrame("Same cumulative commentary text"));
    }
    emit(client, commentaryFrame("Short replacement"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Short replacement\nDone." }],
        },
      },
    });

    const events = await streamPromise;
    const commentary = events.filter((event) => event.type === "commentary");
    expect(commentary).toHaveLength(9);
    expect(commentary.every((event) => event.replace === true)).toBe(true);
    expect(commentary.at(-1)?.text).toBe("Short replacement");
  });

  it("falls back to delta text when a commentary frame carries no cumulative text", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "commentary", delta: "Reading files", },
      },
    });
    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "commentary", delta: " and parsing them" },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Parsed." }],
        },
      },
    });

    const events = await streamPromise;
    const commentary = events.filter((event) => event.type === "commentary");
    expect(commentary.map((event) => event.text)).toEqual(["Reading files", " and parsing them"]);
    expect(commentary.every((event) => event.replace !== true)).toBe(true);
  });

  it("skips commentary frames whose text and delta are both empty", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "commentary", text: "", delta: "", replace: true },
      },
    });
    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "commentary", text: "   ", delta: "  ", replace: true },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Done." }],
        },
      },
    });

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "commentary")).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("ignores assistant-stream frames without an explicit commentary phase", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { delta: "tok", text: "tok" },
      },
    });
    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "main",
        data: { phase: "notes", delta: "internal note", text: "internal note" },
      },
    });
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "tok complete" }],
        },
      },
    });

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "commentary")).toHaveLength(0);
    expect(events.filter((event) => event.type === "thinking")).toHaveLength(0);
  });

  it("never surfaces raw thinking-stream frames as commentary or content", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "thinking",
        runId: "run-commentary",
        sessionKey: "main",
        data: { delta: "PRIVATE_REASONING_SENTINEL", text: "PRIVATE_REASONING_SENTINEL" },
      },
    });
    emit(client, commentaryFrame("Visible working note"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Final answer." }],
        },
      },
    });

    const events = await streamPromise;
    expect(events.filter((event) => event.type === "thinking")).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_REASONING_SENTINEL");
  });

  it("does not leak commentary across sessions or to unaccepted runs", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    // Commentary for another session and for a run this stream never accepted.
    emit(client, {
      ...commentaryFrame("foreign session commentary"),
      payload: {
        stream: "assistant",
        runId: "run-commentary",
        sessionKey: "other-session",
        data: { phase: "commentary", text: "foreign session commentary", delta: "", replace: true },
      },
    });
    emit(client, {
      type: "event",
      event: "agent",
      payload: {
        stream: "assistant",
        runId: "foreign-run",
        sessionKey: "main",
        data: { phase: "commentary", text: "foreign run commentary", delta: "", replace: true },
      },
    });
    emit(client, commentaryFrame("Owned commentary"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Owned answer." }],
        },
      },
    });

    const events = await streamPromise;
    const commentary = events.filter((event) => event.type === "commentary");
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("Owned commentary");
    expect(JSON.stringify(events)).not.toContain("foreign session commentary");
    expect(JSON.stringify(events)).not.toContain("foreign run commentary");
  });

  it("tolerates commentary arriving after the mirrored chat prefix and after completion", async () => {
    const client = newChatClient();
    const streamPromise = collectChatSend(client);
    await flushMicrotasks();

    // Mirrored chat text first, marker late.
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Reviewing settings" }] },
      },
    });
    emit(client, commentaryFrame("Reviewing settings"));
    emit(client, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-commentary",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Reviewing settings\nSettings are valid." }],
        },
      },
    });
    // A straggler after the terminal frame must not reopen the stream.
    emit(client, commentaryFrame("Late duplicate commentary"));

    const events = await streamPromise;
    expect(events.at(-1)?.type).toBe("done");
    const commentary = events.filter((event) => event.type === "commentary");
    expect(commentary.map((event) => event.text)).toEqual(["Reviewing settings"]);
  });
});
