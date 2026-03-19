import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayClient, normalizeGatewayChatMessage } from "../src/gateway.js";

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

  it("prefers a cached device token over the shared gateway token on reconnect", async () => {
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
    expect(request.params.auth.token).toBe("device-token-1");
    expect(request.params.device.nonce).toBe("nonce-456");

    ws.emitHello(request.id, "device-token-2");
    await connectPromise;

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens[URL_SCOPE_KEY].token).toBe("device-token-2");
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
    expect(request.params.auth.token).toBe("device-token-1");

    ws.emitConnectError(request.id, "AUTH_DEVICE_TOKEN_MISMATCH");
    await flushMicrotasks();

    expect(ws.closedWith).toEqual({ code: 4008, reason: "connect failed" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.tokens?.[URL_SCOPE_KEY]).toBeUndefined();
  });

  it("does not call onDisconnect for intentional local closes", async () => {
    const { client } = await connectClient();
    const onDisconnect = vi.fn();
    client.onDisconnect = onDisconnect;

    client.close();
    await flushMicrotasks();

    expect(onDisconnect).not.toHaveBeenCalled();
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

  it("chatSend forwards attachments in the chat.send request", async () => {
    const client = new GatewayClient({
      url: "wss://openclaw-agent.example",
      gatewayToken: "gw-token",
    });
    (client as any).connected = true;
    (client as any).ws = { readyState: MockWebSocket.OPEN };
    const rpcSpy = vi.spyOn(client as any, "rpc").mockImplementation(async (method: string, params: any) => {
      if (method === "chat.send") {
        expect(params.attachments).toEqual([{ type: "file", path: "/tmp/file.txt" }]);
        return { runId: "attachments-run" };
      }
      throw new Error(`unexpected RPC ${method}`);
    });

    const streamPromise = (async () => {
      const events = [];
      for await (const event of client.chatSend("With attachment", "main", [
        { type: "file", path: "/tmp/file.txt" },
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
      }),
    );

    const storedAfterPairingError = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(storedAfterPairingError.pendingPairings).toBeTruthy();

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
});
