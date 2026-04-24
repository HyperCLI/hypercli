import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayClient, normalizeGatewayChatMessage } from "../src/openclaw/gateway.js";

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

  it("sends the CLI gateway handshake and stores the issued device token", async () => {
    const { client, request } = await connectClient();

    expect(request.method).toBe("connect");
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

    await client.sessionsReset("agent:main:main", "new");

    expect(rpc).toHaveBeenCalledWith("sessions.reset", {
      key: "agent:main:main",
      reason: "new",
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

  it("chatSend accepts server runId events and ends on chat.done", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    vi.spyOn(client as any, "rpc").mockResolvedValue({ runId: "server-run-1" });

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
    expect(events.map((event) => event.type)).toEqual(["content", "content", "done"]);
    expect(events.filter((event) => event.type === "content").map((event) => event.text).join("")).toBe("SMOKE_OK");
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
