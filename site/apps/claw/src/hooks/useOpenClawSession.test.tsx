import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { OpenClawWhatsAppProgressEvent } from "@hypercli.com/sdk/openclaw/whatsapp";

import { renderHookWithClient } from "@/test/utils";
import {
  openClawChatHistoryCacheKey,
  readCachedOpenClawChatHistory,
} from "@/lib/openclaw-chat-history-cache";
import { useOpenClawSession } from "./useOpenClawSession";

type TestGatewayConnectionState = "connected" | "connecting" | "disconnected";

function buildGateway(initialState: TestGatewayConnectionState = "connected") {
  const eventHandlers: Array<(event: any) => void> = [];
  const connectionHandlers: Array<(state: TestGatewayConnectionState) => void> = [];
  const ephemeralSessions: Array<{
    sessionKey: string;
    chatSend: ReturnType<typeof vi.fn>;
    chatHistory: ReturnType<typeof vi.fn>;
    chatAbort: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  let connectionState = initialState;
  const gateway = {
    get state() {
      return connectionState;
    },
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    onConnectionState: vi.fn((handler: (state: TestGatewayConnectionState) => void) => {
      connectionHandlers.push(handler);
      if (connectionState === "connected") handler("connected");
      return vi.fn(() => {
        const index = connectionHandlers.indexOf(handler);
        if (index >= 0) connectionHandlers.splice(index, 1);
      });
    }),
    onEvent: vi.fn((handler: (event: any) => void) => {
      eventHandlers.push(handler);
      return vi.fn(() => {
        const index = eventHandlers.indexOf(handler);
        if (index >= 0) eventHandlers.splice(index, 1);
      });
    }),
    emit: (event: any) => {
      for (const handler of eventHandlers) handler(event);
    },
    emitConnectionState: (state: TestGatewayConnectionState) => {
      connectionState = state;
      for (const handler of connectionHandlers) handler(state);
    },
    configGet: vi.fn(async (): Promise<Record<string, unknown>> => ({ llm: { model: "old-model" } })),
    configSchema: vi.fn(async (): Promise<OpenClawConfigSchemaResponse> => ({
      schema: {
        type: "object",
        properties: {
          llm: { type: "object", properties: { model: { type: "string" } } },
        },
      },
      uiHints: {},
    })),
    chatHistory: vi.fn(async (_sessionKey: string, _limit?: number): Promise<unknown[]> => []),
    sessionsPreview: vi.fn(async (_sessionKey: string, _limit?: number): Promise<unknown[]> => []),
    agentsList: vi.fn(async (): Promise<Array<Record<string, unknown>>> => [{ id: "agent-1" }]),
    sessionsList: vi.fn(async (): Promise<unknown[]> => []),
    sessionsPatch: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true })),
    sessionsReset: vi.fn(async (sessionKey: string, _reason?: "new" | "reset"): Promise<string> => sessionKey),
    cronList: vi.fn(async (): Promise<unknown[]> => []),
    cronAdd: vi.fn(async () => ({ id: "new-cron-job" })),
    cronRemove: vi.fn(async (): Promise<void> => undefined),
    cronRun: vi.fn(async () => ({ ok: true })),
    modelsList: vi.fn(async (): Promise<unknown[]> => []),
    filesList: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    sendChat: vi.fn(async () => ({ runId: "run-1" })),
    chatAbort: vi.fn(async (_sessionKey?: string): Promise<void> => undefined),
    chatSend: vi.fn(async function* (
      _message: string,
      _sessionKey: string,
      _attachments?: unknown[],
      _options?: { strictCorrelation?: boolean },
    ): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "done" as const };
    }),
    ephemeralSessions,
    createEphemeralChatSession: vi.fn(async () => {
      const sessionKey = `session-hypercli-ephemeral-019789ab-cdef-4abc-8def-${String(ephemeralSessions.length + 1).padStart(12, "0")}`;
      let closed = false;
      await gateway.sessionsReset(sessionKey, "new");
      const session = {
        sessionKey,
        get closed() {
          return closed;
        },
        chatSend: vi.fn((message: string, attachments?: unknown[]) => (
          gateway.chatSend(message, sessionKey, attachments, { strictCorrelation: true })
        )),
        chatHistory: vi.fn((limit = 50) => gateway.chatHistory(sessionKey, limit)),
        chatAbort: vi.fn(() => gateway.chatAbort(sessionKey)),
        close: vi.fn(async () => {
          if (closed) return;
          closed = true;
          await gateway.sessionsReset(sessionKey, "reset");
        }),
      };
      ephemeralSessions.push(session);
      return session;
    }),
    runEphemeralChat: vi.fn(async (_message: string, _options?: unknown) => "generated response"),
    configPatch: vi.fn(async (): Promise<void> => undefined),
    configSet: vi.fn(async (): Promise<void> => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
    webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" })),
    webLoginWait: vi.fn(async () => ({ connected: true, message: "Connected" })),
    integrationsAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
    integrationsAuthStatus: vi.fn(async () => ({ status: "pending" })),
    integrationsStatus: vi.fn(async () => ({ integrations: {} })),
    integrationsDisconnect: vi.fn(async () => ({ ok: true })),
  };
  return gateway;
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("useOpenClawSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("routes ephemeral prompts through the connected SDK gateway client", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const controller = new AbortController();

    let response = "";
    await act(async () => {
      response = await result.current.runEphemeralPrompt("generate a skill", {
        signal: controller.signal,
        timeoutMs: 30_000,
      });
    });

    expect(response).toBe("generated response");
    expect(gateway.runEphemeralChat).toHaveBeenCalledWith("generate a skill", {
      signal: controller.signal,
      timeoutMs: 30_000,
    });
    unmount();
  });

  it("keeps a multi-turn private chat in memory and restores the normal draft on end", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: `${message} reply` };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    act(() => result.current.setInput("normal draft"));
    await act(async () => result.current.startTemporaryChat());

    const ephemeralSession = gateway.ephemeralSessions[0];
    expect(ephemeralSession).toBeDefined();
    expect(result.current.temporaryChatActive).toBe(true);
    expect(result.current.temporaryChatState).toBe("active");
    expect(result.current.activeSessionKey).toBe(ephemeralSession.sessionKey);
    expect(result.current.input).toBe("");
    expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]);
    expect(openClawChatHistoryCacheKey("agent-1", ephemeralSession.sessionKey)).toBeNull();
    const sessionListCallsBeforeSend = gateway.sessionsList.mock.calls.length;

    await act(async () => result.current.sendMessage("private secret"));
    await act(async () => result.current.sendMessage("second secret"));

    expect(ephemeralSession.chatSend).toHaveBeenCalledTimes(2);
    expect(gateway.chatSend.mock.calls.map(([message, sessionKey]) => [message, sessionKey])).toEqual([
      ["private secret", ephemeralSession.sessionKey],
      ["second secret", ephemeralSession.sessionKey],
    ]);
    expect(result.current.messages.some((message) => message.content.includes("second secret reply"))).toBe(true);
    expect(result.current.activityFeed).toEqual([]);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(sessionListCallsBeforeSend);
    const storedValues = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return key ? window.localStorage.getItem(key) : null;
    }).join("\n");
    expect(storedValues).not.toContain("private secret");
    expect(storedValues).not.toContain(ephemeralSession.sessionKey);

    await act(async () => result.current.endTemporaryChat());

    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.activeSessionKey).toBe("main");
    expect(result.current.input).toBe("normal draft");
    expect(result.current.messages).toEqual([]);
    expect(ephemeralSession.close).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenLastCalledWith(ephemeralSession.sessionKey, "reset");
    unmount();
  });

  it("does not send through the raw gateway while private cleanup is pending", async () => {
    const gateway = buildGateway();
    const resetGate = deferred<string>();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.sessionsReset.mockImplementation(async (sessionKey: string, reason?: "new" | "reset") => (
      reason === "reset" ? resetGate.promise : sessionKey
    ));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];

    let cleanup!: Promise<void>;
    act(() => {
      cleanup = result.current.endTemporaryChat();
    });
    await waitFor(() => expect(result.current.temporaryChatState).toBe("ending"));
    await act(async () => result.current.sendMessage("late private message"));

    expect(gateway.chatSend).not.toHaveBeenCalled();
    resetGate.resolve(ephemeralSession.sessionKey);
    await act(async () => cleanup);
    unmount();
  });

  it("discards a private chat when the requested normal session changes", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha", updatedAt: 2 },
      { key: "session-beta", title: "Beta", updatedAt: 1 },
    ]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(ephemeralSession.close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.activeSessionKey).toBe("session-beta");
    unmount();
  });

  it("discards private browser state on pagehide", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: "private response" };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    await act(async () => result.current.sendMessage("private request"));
    expect(result.current.messages.some((message) => message.content === "private response")).toBe(true);

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(ephemeralSession.close).toHaveBeenCalledTimes(1);
    expect(result.current.temporaryChatActive).toBe(false);
    expect(result.current.activeSessionKey).toBe("main");
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("ignores private history that arrives after the chat is discarded", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: "private response" };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    const historyGate = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sessionKey === ephemeralSession.sessionKey ? historyGate.promise : []
    ));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("private request");
    });
    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith(ephemeralSession.sessionKey, 200));
    await act(async () => result.current.endTemporaryChat());
    expect(result.current.messages).toEqual([]);

    await act(async () => {
      historyGate.resolve([{ role: "assistant", content: "late private history" }]);
      await sendPromise;
    });

    expect(result.current.temporaryChatActive).toBe(false);
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("exposes web login operations through the connected gateway", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" })),
      webLoginWait: vi.fn(async () => ({ connected: true, message: "Connected" })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.webLoginStart({ force: true, verbose: true });
      await result.current.webLoginWait({
        timeoutMs: 30_000,
        currentQrDataUrl: "data:image/png;base64,cXI=",
      });
    });

    expect(agent.webLoginStart).toHaveBeenCalledWith({ force: true, verbose: true });
    expect(agent.webLoginWait).toHaveBeenCalledWith({
      timeoutMs: 30_000,
      currentQrDataUrl: "data:image/png;base64,cXI=",
    });
    expect(gateway.webLoginStart).not.toHaveBeenCalled();
    expect(gateway.webLoginWait).not.toHaveBeenCalled();
    unmount();
  });

  it("returns provider-unavailable errors without hidden retries", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      webLoginStart: vi.fn()
        .mockRejectedValueOnce(new Error("web login provider is not available"))
        .mockResolvedValueOnce({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" }),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(result.current.webLoginStart({ force: true })).rejects.toThrow("web login provider is not available");
    expect(agent.webLoginStart).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("starts WhatsApp pairing through the SDK before inspecting plugin support", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({ channels: { whatsapp: { enabled: true } } });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(),
      configPatch: vi.fn(async () => undefined),
      waitReady: vi.fn(async () => ({})),
      webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" })),
    };
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.whatsAppPairingStart({}, (event) => events.push(event))).resolves.toMatchObject({
        qrDataUrl: "data:image/png;base64,cXI=",
      });
    });
    expect(gateway.webLoginStart).toHaveBeenCalledWith({ timeoutMs: 5_000 });
    expect(agent.webLoginStart).not.toHaveBeenCalled();
    expect(agent.exec).not.toHaveBeenCalled();
    expect(events.map((event) => [event.stage, event.status])).toEqual([
      ["requesting-qr", "running"],
      ["requesting-qr", "succeeded"],
      ["waiting-for-scan", "running"],
      ["waiting-for-scan", "succeeded"],
    ]);
    unmount();
  });

  it("atomically activates an installed WhatsApp plugin on the active gateway", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({
      plugins: { allow: ["brave"] },
    });
    gateway.webLoginStart
      .mockRejectedValueOnce(new Error("web login provider is not available"))
      .mockResolvedValueOnce({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command === "openclaw plugins list --json"
          ? JSON.stringify({ plugins: [{ id: "whatsapp", installed: true, enabled: true, state: "enabled" }] })
          : "",
        stderr: "",
      })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.whatsAppPairingStart();
    });

    expect(gateway.configPatch).toHaveBeenCalledWith({
      plugins: {
        entries: { whatsapp: { enabled: true } },
        allow: ["brave", "whatsapp"],
      },
      channels: { whatsapp: { enabled: true } },
    });
    expect(agent.exec.mock.calls.map(([command]) => command)).toEqual(["openclaw plugins list --json"]);
    expect(gateway.webLoginStart).toHaveBeenCalledTimes(2);
    expect(gateway.webLoginWait).toHaveBeenCalled();
    unmount();
  });

  it("installs and enables WhatsApp through gateway plugin management", async () => {
    const unavailablePlugin = {
      id: "whatsapp",
      name: "WhatsApp",
      installed: false,
      enabled: false,
      state: "not-installed" as const,
      install: { source: "official" as const, pluginId: "whatsapp" },
    };
    const installedPlugin = { ...unavailablePlugin, installed: true, state: "disabled" as const };
    const enabledPlugin = { ...installedPlugin, enabled: true, state: "enabled" as const };
    const gateway = Object.assign(buildGateway(), {
      pluginsList: vi.fn(async () => ({ plugins: [unavailablePlugin], diagnostics: [], mutationAllowed: true })),
      pluginsInstall: vi.fn(async () => ({ ok: true as const, plugin: installedPlugin, restartRequired: true as const })),
      pluginsSetEnabled: vi.fn(async () => ({ ok: true as const, plugin: enabledPlugin, restartRequired: false })),
      pluginsRefresh: vi.fn(async () => ({ ok: true as const })),
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.ensureWhatsAppSupport();
    });

    expect(gateway.pluginsInstall).toHaveBeenCalledWith({ source: "official", pluginId: "whatsapp" });
    expect(gateway.pluginsSetEnabled).toHaveBeenCalledWith({ pluginId: "whatsapp", enabled: true });
    expect(gateway.pluginsRefresh).toHaveBeenCalledTimes(1);
    expect(agent.exec).toHaveBeenCalledWith("openclaw gateway restart", { timeout: 60 });
    expect(agent.waitReady).toHaveBeenCalledWith(120_000, { probe: "config", retryIntervalMs: 2_000 });
    expect(gateway.configPatch).toHaveBeenCalledWith({ channels: { whatsapp: { enabled: true } } });
    expect(result.current.config).toEqual(expect.objectContaining({ channels: { whatsapp: { enabled: true } } }));
    unmount();
  });

  it("falls back to the OpenClaw CLI for WhatsApp support on older gateways", async () => {
    const gateway = buildGateway();
    const commandEvents: OpenClawWhatsAppProgressEvent[] = [];
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command === "openclaw plugins list --json" ? JSON.stringify({ plugins: [] }) : "",
        stderr: "",
      })),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.ensureWhatsAppSupport((event) => commandEvents.push(event));
    });

    expect(agent.exec.mock.calls.map(([command]) => command)).toEqual([
      "openclaw plugins list --json",
      "openclaw plugins install whatsapp",
      "openclaw plugins enable whatsapp",
      "openclaw gateway restart",
    ]);
    expect(agent.exec.mock.calls).toEqual([
      ["openclaw plugins list --json", { timeout: 60 }],
      ["openclaw plugins install whatsapp", { timeout: 300 }],
      ["openclaw plugins enable whatsapp", { timeout: 60 }],
      ["openclaw gateway restart", { timeout: 60 }],
    ]);
    expect(commandEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "checking-runtime", status: "running" }),
      expect.objectContaining({ command: "openclaw plugins list --json", status: "running" }),
      expect.objectContaining({ command: "openclaw plugins install whatsapp", status: "succeeded", detail: "Exit code 0" }),
      expect.objectContaining({ command: "openclaw plugins enable whatsapp", status: "succeeded", detail: "Exit code 0" }),
      expect.objectContaining({ command: "openclaw gateway restart", status: "succeeded", detail: "Exit code 0" }),
    ]));
    expect(agent.waitReady).toHaveBeenCalledWith(120_000, { probe: "config", retryIntervalMs: 2_000 });
    expect(gateway.configPatch).toHaveBeenCalledWith({ channels: { whatsapp: { enabled: true } } });
    unmount();
  });

  it("does not reinstall or restart when WhatsApp support is already enabled", async () => {
    const gateway = buildGateway();
    gateway.channelsStatus.mockResolvedValue({
      channels: { whatsapp: { configured: true, running: true } },
      channelOrder: ["whatsapp"],
    });
    gateway.configGet.mockResolvedValue({ channels: { whatsapp: { enabled: true } } });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ plugins: [{ id: "whatsapp", installed: true, enabled: true, state: "enabled" }] }),
        stderr: "",
      })),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.ensureWhatsAppSupport();
    });

    expect(agent.exec).not.toHaveBeenCalled();
    expect(agent.waitReady).not.toHaveBeenCalled();
    expect(gateway.configPatch).not.toHaveBeenCalled();
    unmount();
  });

  it("restarts without reinstalling when WhatsApp is enabled but missing from the live gateway", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command === "openclaw plugins list --json"
          ? JSON.stringify({ plugins: [{ id: "whatsapp", installed: true, enabled: true, state: "enabled" }] })
          : "",
        stderr: "",
      })),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.ensureWhatsAppSupport();
    });

    expect(agent.exec.mock.calls.map(([command]) => command)).toEqual([
      "openclaw plugins list --json",
      "openclaw gateway restart",
    ]);
    expect(agent.waitReady).toHaveBeenCalledWith(120_000, { probe: "config", retryIntervalMs: 2_000 });
    expect(gateway.configPatch).toHaveBeenCalledWith({ channels: { whatsapp: { enabled: true } } });
    unmount();
  });

  it("repairs an incompatible WhatsApp plugin through the OpenClaw catalog", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command === "openclaw plugins list --json" ? JSON.stringify({
          plugins: [{
            id: "whatsapp",
            installed: true,
            enabled: false,
            version: "2026.7.1",
            state: "error",
            error: "requires plugin API >=2026.7.1",
          }],
        }) : "",
        stderr: "",
      })),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.ensureWhatsAppSupport();
    });

    expect(agent.exec).toHaveBeenCalledWith(
      "openclaw plugins install whatsapp --force",
      { timeout: 300 },
    );
    expect(gateway.configPatch).toHaveBeenCalledWith({ channels: { whatsapp: { enabled: true } } });
    unmount();
  });

  it("does not configure WhatsApp when the official plugin installation fails", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => command === "openclaw plugins list --json"
        ? { exitCode: 0, stdout: JSON.stringify({ plugins: [] }), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "ClawHub is unavailable" }),
      waitReady: vi.fn(async () => ({})),
      configPatch: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(result.current.ensureWhatsAppSupport()).rejects.toThrow(
      "Could not install WhatsApp support. ClawHub is unavailable",
    );
    expect(agent.exec).toHaveBeenCalledTimes(2);
    expect(agent.waitReady).not.toHaveBeenCalled();
    expect(gateway.configPatch).not.toHaveBeenCalled();
    unmount();
  });

  it("installs Slack through the CLI once and restarts the gateway automatically", async () => {
    const gateway = buildGateway();
    let installed = false;
    const agent = {
      id: "agent-slack-install",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => {
        if (command === "openclaw plugins install @openclaw/slack") installed = true;
        return {
          exitCode: 0,
          stdout: command === "openclaw plugins list --json"
            ? JSON.stringify({ plugins: installed ? [{ id: "slack", installed: true, enabled: true }] : [] })
            : command === "openclaw plugins inspect slack --runtime --json"
              ? JSON.stringify({ plugin: { id: "slack", enabled: true, status: "loaded" } })
              : "ok",
          stderr: "",
        };
      }),
      waitReady: vi.fn(async () => ({})),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      const [first, second] = await Promise.all([
        result.current.ensureSlackSupport(),
        result.current.ensureSlackSupport(),
      ]);
      expect(first).toMatchObject({ changed: true, restartRequired: true, restarted: true });
      expect(second).toEqual(first);
    });

    expect(agent.exec.mock.calls).toEqual([
      ["openclaw plugins list --json", { timeout: 60 }],
      ["openclaw plugins install @openclaw/slack", { timeout: 300 }],
      ["openclaw plugins enable slack", { timeout: 60 }],
      ["openclaw plugins list --json", { timeout: 60 }],
      ["openclaw gateway restart", { timeout: 60 }],
      ["openclaw plugins inspect slack --runtime --json", { timeout: 60 }],
    ]);
    expect(agent.waitReady).toHaveBeenCalledWith(120_000, { probe: "config", retryIntervalMs: 2_000 });
    expect(result.current.activityFeed).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: expect.stringMatching(/Slack support/i) }),
    ]));
    unmount();
  });

  it("restarts once to load already-installed Slack support when runtime status is missing", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-slack-ready",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command === "openclaw plugins inspect slack --runtime --json"
          ? JSON.stringify({ plugin: { id: "slack", enabled: true, status: "loaded" } })
          : JSON.stringify({ plugins: [{ id: "slack", name: "Slack", installed: true, enabled: true }] }),
        stderr: "",
      })),
      waitReady: vi.fn(async () => ({})),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.ensureSlackSupport()).resolves.toMatchObject({
        changed: false,
        restartRequired: true,
        restarted: true,
      });
      await result.current.ensureSlackSupport();
    });

    expect(agent.exec.mock.calls.map(([command]) => command)).toEqual([
      "openclaw plugins list --json",
      "openclaw gateway restart",
      "openclaw plugins inspect slack --runtime --json",
    ]);
    unmount();
  });

  it("exposes starting connector guidance without generating background private sessions", async () => {
    const gateway = buildGateway();
    const pendingConfig = deferred<Record<string, unknown>>();
    gateway.configGet.mockImplementation(() => pendingConfig.promise);
    gateway.runEphemeralChat.mockImplementation(async (prompt: string) => {
      const connectorId = prompt.match(/Plan a (github|telegram|discord|slack|whatsapp) connector/)?.[1] ?? "telegram";
      const runtimeFingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      const officialUrl = {
        github: "https://github.com/settings/installations",
        telegram: "https://telegram.org",
        discord: "https://discord.com",
        slack: "https://api.slack.com/apps",
        whatsapp: "https://www.whatsapp.com",
      }[connectorId];
      return JSON.stringify({
        schema: "hypercli.connector-workflow.v1",
        connectorId,
        runtimeFingerprint,
        summary: `Connect ${connectorId}.`,
        steps: [
          { id: "open", title: "Open setup", instructions: "Open the official setup page.", kind: "instruction", url: officialUrl },
          { id: "create", title: "Create connection", instructions: "Create the connection.", kind: "instruction" },
          { id: "configure", title: "Configure access", instructions: "Configure protected access.", kind: "input" },
          { id: "verify", title: "Verify connection", instructions: "Check connection status.", kind: "verify" },
        ],
      });
    });
    const agent = {
      id: "agent-preload",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.gatewayConnected).toBe(true));
    await waitFor(() => expect(result.current.connectorsProvider).not.toBeNull());
    const onlineProvider = result.current.connectorsProvider;
    expect(Object.keys(result.current.connectorWorkflows ?? {})).toEqual([
      "github",
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);

    pendingConfig.resolve({ llm: { model: "old-model" } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.connectorsProvider).toBe(onlineProvider);
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    unmount();
  });

  it("exposes a runtime-provenanced connector provider backed by session operations", async () => {
    const gateway = Object.assign(buildGateway(), {
      version: "2026.7.16",
      protocol: 3,
    });
    const agent = {
      id: "agent-1",
      launchConfig: { image: "ghcr.io/hypercli/openclaw@sha256:exact" },
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.connectorRuntime).toEqual(expect.objectContaining({
      provider: "openclaw",
      version: "2026.7.16",
      protocol: "gateway-v3",
      image: "ghcr.io/hypercli/openclaw@sha256:exact",
    }));
    expect(result.current.connectorsProvider).not.toBeNull();

    await act(async () => {
      await result.current.connectorsProvider?.configure("telegram", { enabled: true, dmPolicy: "allowlist" });
      await result.current.connectorsProvider?.approveAuthorization?.({
        connectorId: "telegram",
        protocol: "short-code",
        code: "ABCD2345",
      });
    });
    expect(gateway.configPatch).toHaveBeenCalledWith({
      channels: { telegram: { enabled: true, dmPolicy: "allowlist" } },
    });
    expect(result.current.config).toEqual(expect.objectContaining({
      channels: { telegram: { enabled: true, dmPolicy: "allowlist" } },
    }));
    expect(agent.exec).toHaveBeenCalledWith(
      "openclaw pairing approve telegram ABCD2345",
      { timeout: 120 },
    );
    unmount();
  });

  it("rejects connector approval when the OpenClaw command exits unsuccessfully", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "No pending Telegram pairing request." })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(result.current.connectorsProvider?.approveAuthorization?.({
      connectorId: "telegram",
      protocol: "short-code",
      code: "ABCD2345",
    })).rejects.toThrow("No pending Telegram pairing request.");
    expect(agent.exec).toHaveBeenCalledWith(
      "openclaw pairing approve telegram ABCD2345",
      { timeout: 120 },
    );
    unmount();
  });

  it("tracks image attachment reads before the preview payload is ready", async () => {
    const originalFileReader = globalThis.FileReader;
    type FileReaderHandler = ((event: ProgressEvent<FileReader>) => void) | null;
    const readers: Array<{
      result: string | ArrayBuffer | null;
      onload: FileReaderHandler;
      onloadend: FileReaderHandler;
      readAsDataURL: ReturnType<typeof vi.fn>;
    }> = [];
    class DeferredFileReader {
      result: string | ArrayBuffer | null = null;
      onload: FileReaderHandler = null;
      onloadend: FileReaderHandler = null;
      onerror: FileReaderHandler = null;
      onabort: FileReaderHandler = null;
      readAsDataURL = vi.fn(() => {
        readers.push(this);
      });
    }
    vi.stubGlobal("FileReader", DeferredFileReader);

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(null, false));
      const files = [new File(["image"], "preview.png", { type: "image/png" })] as unknown as FileList;

      act(() => {
        result.current.addAttachments(files);
      });

      expect(result.current.pendingAttachmentReads).toBe(1);
      expect(result.current.pendingAttachments).toHaveLength(0);
      expect(readers).toHaveLength(1);

      act(() => {
        const reader = readers[0]!;
        reader.result = "data:image/png;base64,aW1hZ2U=";
        reader.onload?.({} as ProgressEvent<FileReader>);
        reader.onloadend?.({} as ProgressEvent<FileReader>);
      });

      expect(result.current.pendingAttachmentReads).toBe(0);
      expect(result.current.pendingAttachments).toEqual([
        {
          type: "image",
          mimeType: "image/png",
          content: "aW1hZ2U=",
          fileName: "preview.png",
        },
      ]);
      unmount();
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("routes OpenClaw settings operations through the SDK gateway client", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({
      channels: { telegram: { enabled: true } },
      llm: { model: "old-model", temperature: 0.2 },
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.config).toEqual({
      channels: { telegram: { enabled: true } },
      llm: { model: "old-model", temperature: 0.2 },
    }));
    const configGetCallsAfterHydrate = gateway.configGet.mock.calls.length;

    await act(async () => {
      await result.current.saveConfig({
        channels: { telegram: null },
        llm: { model: "new-model" },
      });
    });
    expect(gateway.configPatch).toHaveBeenCalledWith({
      channels: { telegram: null },
      llm: { model: "new-model" },
    });
    expect(gateway.configGet).toHaveBeenCalledTimes(configGetCallsAfterHydrate);
    expect(result.current.config).toEqual({
      channels: {},
      llm: { model: "new-model", temperature: 0.2 },
    });

    await act(async () => {
      await result.current.saveFullConfig({ llm: { model: "full-model" } });
    });
    expect(gateway.configSet).toHaveBeenCalledWith({ llm: { model: "full-model" } });
    expect(result.current.config).toEqual({ llm: { model: "full-model" } });

    await act(async () => {
      await result.current.channelsStatus(true, 2500);
    });
    expect(gateway.channelsStatus).toHaveBeenCalledWith(true, 2500);

    expect(agent.gateway).toHaveBeenCalledTimes(1);
    expect(gateway.connect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("patches the active gateway session model and updates local session state", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:session-alpha",
      title: "Alpha",
      modelProvider: "openai",
      model: "gpt-5-mini",
      thinkingLevel: "low",
      thinkingLevels: ["off", "low"],
      thinkingDefault: "low",
    }]);
    gateway.sessionsPatch.mockResolvedValue({
      ok: true,
      entry: { thinkingLevel: "medium" },
      resolved: {
        modelProvider: "openai",
        model: "gpt-5.2",
        thinkingLevel: "medium",
        thinkingLevels: ["off", { id: "medium", label: "Balanced" }],
      },
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.activeSessionModel).toBe("openai/gpt-5-mini"));

    await act(async () => {
      await result.current.setActiveSessionModel("openai/gpt-5.2");
    });

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:default:session-alpha",
      model: "openai/gpt-5.2",
    });
    expect(result.current.activeSessionModel).toBe("openai/gpt-5.2");
    expect(result.current.activeSessionThinkingLevel).toBe("medium");
    expect(result.current.activeSessionThinkingLevels).toEqual([
      { id: "off", label: "off" },
      { id: "medium", label: "Balanced" },
    ]);
    expect(result.current.activeSessionThinkingDefault).toBe("low");
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:agent-1") ?? "{}").sessions).toEqual([
      expect.objectContaining({
        key: "agent:default:session-alpha",
        model: "openai/gpt-5.2",
        thinkingLevel: "medium",
      }),
    ]));
    unmount();
  });

  it("updates only the selected row when main and a channel share a gateway key", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      {
        key: "main",
        modelProvider: "openai",
        model: "gpt-5-mini",
      },
      {
        key: "agent:default:main",
        origin: { provider: "telegram", from: "telegram:489595440" },
        modelProvider: "openai",
        model: "gpt-5-mini",
      },
    ]);
    gateway.sessionsPatch.mockResolvedValue({
      ok: true,
      resolved: {
        modelProvider: "openai",
        model: "gpt-5.2",
        thinkingLevel: "medium",
        thinkingLevels: [{ id: "medium", label: "Medium" }],
      },
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    await act(async () => {
      await result.current.setActiveSessionModel("openai/gpt-5.2");
    });

    expect(result.current.sessions.find((session) => session.key === "main")?.model).toBe("openai/gpt-5.2");
    expect(result.current.sessions.find((session) => session.key === "telegram:489595440")?.model).toBe("openai/gpt-5-mini");
    unmount();
  });

  it("patches the active session thinking level without changing its model", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:session-alpha",
      modelProvider: "anthropic",
      model: "claude-sonnet-4-5",
      thinkingLevel: "low",
      thinkingLevels: ["off", "low", "high"],
      thinkingDefault: "low",
    }]);
    gateway.sessionsPatch.mockResolvedValue({ ok: true, entry: { thinkingLevel: "high" } });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.activeSessionThinkingLevel).toBe("low"));

    await act(async () => {
      await result.current.setActiveSessionThinkingLevel("high");
    });

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:default:session-alpha",
      thinkingLevel: "high",
    });
    expect(result.current.activeSessionModel).toBe("anthropic/claude-sonnet-4-5");
    expect(result.current.activeSessionThinkingLevel).toBe("high");
    expect(result.current.activeSessionThinkingLevels).toEqual([
      { id: "off", label: "off" },
      { id: "low", label: "low" },
      { id: "high", label: "high" },
    ]);
    expect(result.current.activeSessionThinkingDefault).toBe("low");
    unmount();
  });

  it("does not let a session list started before a patch revert the selected model", async () => {
    const gateway = buildGateway();
    const oldSession = {
      key: "agent:default:session-alpha",
      modelProvider: "openai",
      model: "gpt-5-mini",
      thinkingLevel: "low",
      thinkingLevels: ["off", "low"],
      thinkingDefault: "low",
    };
    const newSession = {
      ...oldSession,
      model: "gpt-5.2",
      thinkingLevel: "medium",
      thinkingLevels: ["off", "medium"],
    };
    gateway.sessionsList.mockResolvedValue([oldSession]);
    gateway.sessionsPatch.mockResolvedValue({
      ok: true,
      resolved: {
        modelProvider: "openai",
        model: "gpt-5.2",
        thinkingLevel: "medium",
        thinkingLevels: ["off", "medium"],
      },
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.activeSessionModel).toBe("openai/gpt-5-mini"));
    const staleSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReset();
    gateway.sessionsList.mockReturnValueOnce(staleSessions.promise).mockResolvedValue([newSession]);
    let staleRefresh: Promise<unknown> = Promise.resolve();
    act(() => {
      staleRefresh = result.current.refreshSessions();
    });
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.setActiveSessionModel("openai/gpt-5.2");
    });
    expect(result.current.activeSessionModel).toBe("openai/gpt-5.2");

    await act(async () => {
      staleSessions.resolve([oldSession]);
      await staleRefresh;
    });

    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.activeSessionModel).toBe("openai/gpt-5.2"));
    unmount();
  });

  it("caches non-probe gateway status calls and invalidates them after changes", async () => {
    const gateway = buildGateway();
    gateway.channelsStatus.mockImplementation(async (probe?: boolean) => ({
      channels: { telegram: { probe: Boolean(probe), call: gateway.channelsStatus.mock.calls.length } },
    }));
    gateway.integrationsStatus.mockImplementation(async (params?: { probe?: boolean; integrationId?: string }) => ({
      integrations: { [params?.integrationId ?? "all"]: { probe: Boolean(params?.probe), call: gateway.integrationsStatus.mock.calls.length } },
    }));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    const backgroundChannelCalls = gateway.channelsStatus.mock.calls.length;
    const backgroundIntegrationCalls = gateway.integrationsStatus.mock.calls.length;

    await act(async () => {
      await result.current.channelsStatus(false);
      await result.current.channelsStatus(false);
      await result.current.integrationsStatus({ integrationId: "github" });
      await result.current.integrationsStatus({ probe: false, integrationId: "github" });
    });

    expect(gateway.channelsStatus).toHaveBeenCalledTimes(backgroundChannelCalls);
    expect(gateway.integrationsStatus).toHaveBeenCalledTimes(backgroundIntegrationCalls + 1);

    await act(async () => {
      await result.current.channelsStatus(true);
      await result.current.channelsStatus(true);
      await result.current.integrationsStatus({ probe: true, integrationId: "github" });
      await result.current.integrationsStatus({ probe: true, integrationId: "github" });
    });

    expect(gateway.channelsStatus).toHaveBeenCalledTimes(backgroundChannelCalls + 2);
    expect(gateway.integrationsStatus).toHaveBeenCalledTimes(backgroundIntegrationCalls + 3);

    await act(async () => {
      await result.current.saveConfig({ llm: { model: "new-model" } });
      await result.current.channelsStatus(false);
      await result.current.integrationsStatus({ integrationId: "github" });
    });

    expect(gateway.channelsStatus).toHaveBeenCalledTimes(backgroundChannelCalls + 3);
    expect(gateway.integrationsStatus).toHaveBeenCalledTimes(backgroundIntegrationCalls + 4);

    await act(async () => {
      await result.current.integrationsDisconnect({ integrationId: "github" });
      await result.current.integrationsStatus({ integrationId: "github" });
    });

    expect(gateway.integrationsStatus).toHaveBeenCalledTimes(backgroundIntegrationCalls + 5);
    unmount();
  });

  it("treats unsupported direct integration status as an empty inventory", async () => {
    const gateway = buildGateway();
    gateway.integrationsStatus.mockRejectedValue(new Error("unknown method: integrations.status"));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await expect(result.current.integrationsStatus({ integrationId: "github" })).resolves.toEqual({});
    await expect(result.current.integrationsStatus({ probe: true, integrationId: "github" })).resolves.toEqual({});
    unmount();
  });

  it("keeps the previous channel inventory while config changes are being refreshed", async () => {
    const gateway = buildGateway();
    const refreshedStatus = deferred<Record<string, unknown>>();
    gateway.channelsStatus
      .mockResolvedValueOnce({ channels: { telegram: { configured: true, running: true } } })
      .mockImplementationOnce(async () => refreshedStatus.promise);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.reportedChannelsReady).toBe(true));
    expect(result.current.reportedChannels).toEqual([
      expect.objectContaining({ channelId: "telegram", configured: true, running: true }),
    ]);

    await act(async () => {
      await result.current.saveConfig({ channels: { telegram: null } });
    });

    expect(result.current.reportedChannelsReady).toBe(false);
    expect(result.current.reportedChannels).toEqual([
      expect.objectContaining({ channelId: "telegram", configured: true, running: true }),
    ]);

    refreshedStatus.resolve({ channels: {} });
    await waitFor(() => expect(result.current.reportedChannelsReady).toBe(true));
    expect(result.current.reportedChannels).toEqual([]);
    unmount();
  });

  it("forces a channel probe when hydrated saved configuration is missing from status", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({ channels: { slack: { enabled: true } } });
    gateway.channelsStatus.mockResolvedValue({ channels: {} });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(gateway.channelsStatus).toHaveBeenCalledWith(true, undefined));

    expect(result.current.reportedChannels).toEqual([]);
    unmount();
  });

  it("updates cron jobs by adding a replacement before removing the old job", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const updatedJob = {
      name: "Updated summary",
      sessionTarget: "session:main",
      schedule: { kind: "cron", expr: "*/5 * * * *", tz: "UTC" },
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize updates." },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const listCallsBeforeUpdate = gateway.cronList.mock.calls.length;

    await act(async () => {
      await result.current.updateCron("old-cron-job", updatedJob);
    });

    expect(gateway.cronAdd).toHaveBeenCalledWith(updatedJob);
    expect(gateway.cronRemove).toHaveBeenCalledWith("old-cron-job");
    expect(gateway.cronList.mock.calls.length).toBeGreaterThan(listCallsBeforeUpdate);
    expect(result.current.activityFeed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "cron",
        action: "Cron updated",
        detail: expect.stringContaining("Updated summary"),
      }),
    ]));
    unmount();
  });

  it("refreshes cron jobs and reports when old-job removal fails after adding an update", async () => {
    const gateway = buildGateway();
    gateway.cronRemove.mockRejectedValueOnce(new Error("remove failed"));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const updatedJob = {
      name: "Updated summary",
      sessionTarget: "session:main",
      schedule: { kind: "cron", expr: "*/5 * * * *", tz: "UTC" },
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize updates." },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const listCallsBeforeUpdate = gateway.cronList.mock.calls.length;
    let thrown: unknown;

    await act(async () => {
      try {
        await result.current.updateCron("old-cron-job", updatedJob);
      } catch (err) {
        thrown = err;
      }
    });

    expect(gateway.cronAdd).toHaveBeenCalledWith(updatedJob);
    expect(gateway.cronRemove).toHaveBeenCalledWith("old-cron-job");
    expect(gateway.cronList.mock.calls.length).toBeGreaterThan(listCallsBeforeUpdate);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Saved the updated schedule, but could not remove the old one. Delete the old schedule manually.");
    unmount();
  });

  it("streams chat through the gateway root session without deployment id params", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello", "main", undefined);
    expect(gateway.sendChat).not.toHaveBeenCalled();
    unmount();
  });

  it("shows cached sessions while the fresh session list is loading", async () => {
    const firstGateway = buildGateway();
    firstGateway.sessionsList.mockResolvedValue([{
      key: "session-cached",
      title: "Cached session",
      lastMessageAt: 10,
      modelProvider: "openai",
      model: "gpt-5-mini",
      thinkingLevel: "low",
      thinkingLevels: [{ id: "low", label: "Fast" }],
      thinkingDefault: "low",
    }]);
    const firstAgent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => firstGateway),
    };

    const firstRender = renderHookWithClient(() => useOpenClawSession(firstAgent as any));

    await waitFor(() => expect(firstRender.result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(firstRender.result.current.sessions).toEqual([
      expect.objectContaining({
        key: "session-cached",
        title: "Cached session",
        model: "openai/gpt-5-mini",
        thinkingLevel: "low",
        thinkingLevels: [{ id: "low", label: "Fast" }],
        thinkingDefault: "low",
      }),
    ]));
    firstRender.unmount();

    const freshSessions = deferred<unknown[]>();
    const secondGateway = buildGateway();
    secondGateway.sessionsList.mockReturnValue(freshSessions.promise);
    const secondAgent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => secondGateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(secondAgent as any));

    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({
        key: "session-cached",
        title: "Cached session",
        model: "openai/gpt-5-mini",
        thinkingLevel: "low",
        thinkingLevels: [{ id: "low", label: "Fast" }],
        thinkingDefault: "low",
      }),
    ]));
    expect(result.current.sessionsFetched).toBe(false);

    await act(async () => {
      freshSessions.resolve([{ key: "session-fresh", title: "Fresh session", lastMessageAt: 20 }]);
      await freshSessions.promise;
    });

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-fresh", title: "Fresh session" }),
    ]));
    unmount();
  });

  it("ignores expired cached sessions while the fresh session list is loading", async () => {
    window.localStorage.setItem("openclaw.sessions.v1:deploy-123", JSON.stringify({
      version: 1,
      updatedAt: 0,
      sessions: [{ key: "session-stale", title: "Stale session", lastMessageAt: 10 }],
    }));
    const freshSessions = deferred<unknown[]>();
    const gateway = buildGateway();
    gateway.sessionsList.mockReturnValue(freshSessions.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.sessionsFetched).toBe(false);
    expect(window.localStorage.getItem("openclaw.sessions.v1:deploy-123")).not.toContain("session-stale");

    await act(async () => {
      freshSessions.resolve([{ key: "session-fresh", title: "Fresh session", lastMessageAt: 20 }]);
      await freshSessions.promise;
    });

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-fresh", title: "Fresh session" }),
    ]);
    unmount();
  });

  it("hydrates active chat history while the fresh session list is loading", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Session history" }]);
    const freshSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(freshSessions.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Session history"]));
    expect(result.current.hydrating).toBe(false);
    expect(result.current.sessionsFetched).toBe(false);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(1);
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-alpha", 200);

    await act(async () => {
      freshSessions.resolve([{ key: "session-fresh", title: "Fresh session", lastMessageAt: 20 }]);
      await freshSessions.promise;
    });

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-fresh", title: "Fresh session" }),
    ]);
    unmount();
  });

  it("filters heartbeat and preview-like values from stored and gateway session names", async () => {
    window.localStorage.setItem("openclaw.sessionTitles.v1:deploy-123", JSON.stringify({
      main: "HEARTBEAT",
      "session-alpha": "Read HEARTBEAT.md if it exists",
    }));
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "HEARTBEAT", clientDisplayName: "HEARTBEAT_OK" },
      { key: "session-alpha", summary: "Leaked chat preview", lastMessageAt: 1 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "main", title: "", clientDisplayName: "Main Session" }),
      expect.objectContaining({ key: "session-alpha", title: "", clientDisplayName: "session-alpha" }),
    ]);
    expect(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123")).toBe("{}");
    unmount();
  });

  it("keeps sessions unavailable when the session list fetch fails", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockRejectedValue(new Error("Session list unavailable"));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.sessionsFetched).toBe(false);
    expect(result.current.sessions).toEqual([]);
    await expect(result.current.createSession()).rejects.toThrow("Sessions are still loading.");
    unmount();
  });

  it("routes history and chat through the selected session key", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-alpha", 200);

    act(() => {
      result.current.setInput("hello session");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello session", "session-alpha", undefined);
    await waitFor(() => {
      expect(readCachedOpenClawChatHistory("deploy-123", "session-alpha").map((message) => message.content)).toContain("hello session");
    });
    unmount();
  });

  it("reuses connection-level gateway hydration when switching active sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.filesList.mockResolvedValue([{ name: "README.md", path: "README.md", size: 100 }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha", lastMessageAt: 10 },
      { key: "session-beta", title: "Beta", lastMessageAt: 20 },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => [
      { role: "assistant", content: `${sessionKey} history` },
    ]);
    const agent = {
      id: "main",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["session-alpha history"]));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["session-beta history"]));
    expect(gateway.configGet).toHaveBeenCalledTimes(1);
    expect(gateway.configSchema).toHaveBeenCalledTimes(1);
    expect(gateway.agentsList).toHaveBeenCalledTimes(1);
    expect(gateway.filesList).toHaveBeenCalledTimes(1);
    expect(gateway.cronList).toHaveBeenCalledTimes(1);
    expect(gateway.modelsList).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(1);
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-alpha", 200);
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-beta", 200);
    unmount();
  });

  it("keeps chat ready while switching between fetched sessions without message counts", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.filesList.mockResolvedValue([]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha", lastMessageAt: 10 },
      { key: "session-beta", title: "Beta", lastMessageAt: 20 },
    ]);
    const betaHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === "session-beta") return betaHistory.promise;
      return [];
    });
    const agent = {
      id: "main",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    expect(result.current.ready).toBe(true);
    expect(result.current.connected).toBe(true);
    expect(result.current.hydrating).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-beta", 200);

    await act(async () => {
      betaHistory.resolve([]);
      await betaHistory.promise;
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.connected).toBe(true);
    expect(result.current.hydrating).toBe(false);
    unmount();
  });

  it("loads sessions without full gateway hydration in sessions-only mode", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main", { hydrationMode: "sessions" }));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.connected).toBe(true);
    expect(result.current.ready).toBe(false);
    expect(result.current.sessions).toEqual([expect.objectContaining({ key: "main", title: "Main" })]);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(1);
    expect(gateway.configGet).not.toHaveBeenCalled();
    expect(gateway.configSchema).not.toHaveBeenCalled();
    expect(gateway.agentsList).not.toHaveBeenCalled();
    expect(gateway.filesList).not.toHaveBeenCalled();
    expect(gateway.cronList).not.toHaveBeenCalled();
    expect(gateway.modelsList).not.toHaveBeenCalled();
    expect(gateway.chatHistory).not.toHaveBeenCalled();
    unmount();
  });

  it("hydrates full gateway data after switching from sessions-only mode", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.filesList.mockResolvedValue([{ name: "README.md", path: "README.md", size: 100 }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Full history" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ hydrationMode }: { hydrationMode: "full" | "sessions" }) => useOpenClawSession(agent as any, true, "main", { hydrationMode }),
      { initialProps: { hydrationMode: "sessions" } },
    );

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(gateway.chatHistory).not.toHaveBeenCalled();

    rerender({ hydrationMode: "full" });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(gateway.configGet).toHaveBeenCalledTimes(1);
    expect(gateway.configSchema).toHaveBeenCalledTimes(1);
    expect(gateway.agentsList).toHaveBeenCalledTimes(1);
    expect(gateway.filesList).toHaveBeenCalledTimes(1);
    expect(gateway.cronList).toHaveBeenCalledTimes(1);
    expect(gateway.modelsList).toHaveBeenCalledTimes(1);
    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(result.current.messages.map((message) => message.content)).toEqual(["Full history"]);
    unmount();
  });

  it("can create a gateway session in sessions-only mode", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main", { hydrationMode: "sessions" }));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^session-/);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey, title: "New Session" }),
    ]));
    unmount();
  });

  it("refreshes the session list when switching to a session missing from the fetched snapshot", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.filesList.mockResolvedValue([{ name: "README.md", path: "README.md", size: 100 }]);
    gateway.sessionsList
      .mockResolvedValueOnce([{ key: "session-alpha", title: "Alpha", lastMessageAt: 10 }])
      .mockResolvedValueOnce([
        { key: "session-alpha", title: "Alpha", lastMessageAt: 10 },
        { key: "session-gamma", title: "Gamma", lastMessageAt: 30 },
      ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => [
      { role: "assistant", content: `${sessionKey} history` },
    ]);
    const agent = {
      id: "main",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(gateway.sessionsList).toHaveBeenCalledTimes(1);

    rerender({ sessionKey: "session-gamma" });

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["session-gamma history"]));
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "session-gamma", title: "Gamma" }),
    ])));
    unmount();
  });

  it("ignores stale post-send history refreshes after switching sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ]);
    const alphaRefresh = deferred<Array<{ role: string; content: string }>>();
    let alphaHistoryCalls = 0;
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === "session-alpha") {
        alphaHistoryCalls += 1;
        return alphaHistoryCalls === 1 ? [] : alphaRefresh.promise;
      }
      if (sessionKey === "session-beta") return [{ role: "assistant", content: "Beta history" }];
      return [];
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello alpha");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("session-alpha", 200));
    await waitFor(() => expect(alphaHistoryCalls).toBe(2));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Beta history"]));

    await act(async () => {
      alphaRefresh.resolve([
        { role: "user", content: "hello alpha" },
        { role: "assistant", content: "Alpha refreshed" },
      ]);
      await sendPromise;
    });

    expect(result.current.activeSessionKey).toBe("session-beta");
    expect(result.current.messages.map((message) => message.content)).toEqual(["Beta history"]);
    unmount();
  });

  it("keeps sending true globally but scoped to the sending session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    gateway.chatHistory.mockImplementation((async (sessionKey: string) => {
      if (sessionKey === "session-beta") return [{ role: "assistant", content: "Beta history" }];
      return [];
    }) as any);
    const release = deferred<void>();
    gateway.chatSend.mockImplementation((async function* () {
      await release.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello alpha");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.sending).toBe(true));
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(false);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    rerender({ sessionKey: "session-alpha" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    await act(async () => {
      release.resolve();
      await sendPromise;
    });

    expect(result.current.sending).toBe(false);
    expect(result.current.activeSessionSending).toBe(false);
    expect(result.current.thinkingSessionKeys).toEqual([]);
    unmount();
  });

  it("creates a new session while another session is sending", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    gateway.chatHistory.mockResolvedValue([]);
    const release = deferred<void>();
    const reset = deferred<void>();
    gateway.sessionsReset.mockReturnValue(reset.promise);
    gateway.chatSend.mockImplementation((async function* () {
      await release.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello alpha");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^session-/);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(result.current.activeSessionKey).toBe("session-alpha");
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello alpha" }),
    ]);

    rerender({ sessionKey: newSessionKey });

    await waitFor(() => expect(result.current.activeSessionKey).toBe(newSessionKey));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.activeSessionSending).toBe(false);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    await act(async () => {
      reset.resolve(undefined);
      await reset.promise;
    });
    await act(async () => {
      release.resolve();
      await sendPromise;
    });

    expect(result.current.sending).toBe(false);
    expect(result.current.thinkingSessionKeys).toEqual([]);
    unmount();
  });

  it("restores an in-flight hidden session transcript before the final response", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    gateway.chatHistory.mockImplementation((async (sessionKey: string) => {
      if (sessionKey === "session-beta") return [{ role: "assistant", content: "Beta history" }];
      return [];
    }) as any);
    const thinkingReady = deferred<void>();
    const thinkingProcessed = deferred<void>();
    const release = deferred<void>();
    gateway.chatSend.mockImplementation((async function* () {
      await thinkingReady.promise;
      yield { type: "thinking" as const, text: "Reviewing session context" };
      thinkingProcessed.resolve();
      await release.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello alpha");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello alpha" }),
    ]);

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(false);

    await act(async () => {
      thinkingReady.resolve();
      await thinkingProcessed.promise;
    });

    rerender({ sessionKey: "session-alpha" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello alpha" }),
    ]));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(true);

    await act(async () => {
      release.resolve();
      await sendPromise;
    });
    unmount();
  });

  it("keeps composer drafts scoped to the selected session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("alpha draft");
    });
    expect(result.current.input).toBe("alpha draft");

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.input).toBe(""));

    act(() => {
      result.current.setInput("beta draft");
    });
    expect(result.current.input).toBe("beta draft");

    rerender({ sessionKey: "session-alpha" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    await waitFor(() => expect(result.current.input).toBe("alpha draft"));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.input).toBe("beta draft"));
    unmount();
  });

  it("sends a draft immediately in another session while one session is streaming", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
      { key: "session-gamma", title: "Gamma" },
    ] as any);
    gateway.chatHistory.mockResolvedValue([]);
    const alphaRelease = deferred<void>();
    const betaRelease = deferred<void>();
    const chatSends: Array<{ message: string; sessionKey: string }> = [];
    gateway.chatSend.mockImplementation((async function* (message: string, sessionKey: string) {
      chatSends.push({ message, sessionKey });
      if (sessionKey === "session-alpha") await alphaRelease.promise;
      if (sessionKey === "session-beta") await betaRelease.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("alpha start");
    });

    let alphaSendPromise: Promise<void> | undefined;
    act(() => {
      alphaSendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(chatSends).toEqual([
      { message: "alpha start", sessionKey: "session-alpha" },
    ]));
    await waitFor(() => expect(result.current.sending).toBe(true));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.input).toBe(""));

    act(() => {
      result.current.setInput("beta start");
    });
    let betaSendPromise: Promise<void> | undefined;
    act(() => {
      betaSendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(chatSends).toEqual([
      { message: "alpha start", sessionKey: "session-alpha" },
      { message: "beta start", sessionKey: "session-beta" },
    ]));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "beta start" }),
    ]));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.pendingInput).toEqual([]);

    rerender({ sessionKey: "session-gamma" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-gamma"));
    await waitFor(() => expect(result.current.pendingInput).toEqual([]));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(false);

    await act(async () => {
      betaRelease.resolve();
      await betaSendPromise;
      alphaRelease.resolve();
      await alphaSendPromise;
    });

    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.activeSessionKey).toBe("session-gamma");

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "beta start" }),
    ]));
    unmount();
  });

  it("renders live events in the active session while another session is streaming", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    gateway.chatHistory.mockResolvedValue([]);
    const alphaRelease = deferred<void>();
    gateway.chatSend.mockImplementation((async function* (_message: string, sessionKey: string) {
      if (sessionKey === "session-alpha") await alphaRelease.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("alpha start");
    });
    let alphaSendPromise: Promise<void> | undefined;
    act(() => {
      alphaSendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(false);

    act(() => {
      gateway.emit({ event: "chat.content", payload: { sessionKey: "session-beta", text: "Beta live reply" } });
    });

    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Beta live reply" }),
    ]));

    await act(async () => {
      alphaRelease.resolve();
      await alphaSendPromise;
    });
    unmount();
  });

  it("keeps main and Telegram sessions separate when selecting the Telegram session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main Session", lastMessageAt: 10 },
      {
        key: "agent:default:main",
        title: "Telegram DM",
        origin: { provider: "telegram", from: { id: 489595440 } },
        deliveryContext: { channel: "telegram", chat: { id: 489595440 } },
        lastMessageAt: 20,
      },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sessionKey === "agent:default:main"
        ? [{ role: "assistant", content: "Main history from default gateway key" }]
        : [{ role: "assistant", content: "Main history" }]
    ));
    gateway.sessionsPreview.mockImplementation(async (sessionKey: string) => (
      sessionKey === "agent:default:main"
        ? [{ role: "assistant", content: "Telegram history" }]
        : []
    ));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "telegram:489595440"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    expect(gateway.sessionsPreview).toHaveBeenCalledWith("agent:default:main", 200);
    expect(gateway.sessionsPreview).not.toHaveBeenCalledWith("telegram:489595440", 200);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:main", 200);
    expect(result.current.messages.map((message) => message.content)).toEqual(["Telegram history"]);
    expect(result.current.activeSessionReadOnly).toBe(true);
    expect(result.current.activeSessionReadOnlyReason).toBe("Telegram conversations are read-only here. Reply from Telegram.");
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "main", title: "Main Session" }),
      expect.objectContaining({
        key: "telegram:489595440",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "telegram:489595440",
        title: "Telegram DM",
        sourceChannelId: "telegram",
        readOnly: true,
      }),
    ]));
    expect(result.current.sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "agent:default:main" }),
    ]));

    act(() => {
      result.current.setInput("reply from dashboard");
    });
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.messages.map((message) => message.content)).toEqual(["Telegram history"]);
    unmount();
  });

  it("does not keep main messages visible when switching to an empty Telegram session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main Session", lastMessageAt: 10 },
      {
        key: "agent:default:main",
        title: "Telegram DM",
        origin: { provider: "telegram", from: "telegram:489595440" },
        deliveryContext: { channel: "telegram", to: "telegram:489595440" },
        lastMessageAt: 20,
      },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sessionKey === "main" || sessionKey === "agent:default:main"
        ? [{ role: "assistant", content: "Main history" }]
        : []
    ));
    gateway.sessionsPreview.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Main history"]));

    rerender({ sessionKey: "telegram:489595440" });

    await waitFor(() => expect(gateway.sessionsPreview).toHaveBeenCalledWith("agent:default:main", 200));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:main", 200);
    expect(result.current.activeSessionReadOnly).toBe(true);
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("preserves live Telegram messages when the session becomes read-only", async () => {
    const gateway = buildGateway();
    const sessionsList = deferred<unknown[]>();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockImplementation(async () => sessionsList.promise);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Main history" }]);
    gateway.sessionsPreview.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "telegram:489595440"));

    await waitFor(() => expect(gateway.onEvent).toHaveBeenCalled());
    act(() => {
      gateway.emit({
        event: "chat",
        payload: {
          sessionKey: "agent:default:main",
          state: "final",
          origin: { provider: "telegram", from: "telegram:489595440" },
          deliveryContext: { channel: "telegram", to: "telegram:489595440" },
          message: { role: "user", content: "Incoming Telegram before metadata" },
        },
      });
    });

    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Incoming Telegram before metadata" }),
    ]));

    await act(async () => {
      sessionsList.resolve([
        {
          key: "agent:default:main",
          title: "Telegram DM",
          origin: { provider: "telegram", from: "telegram:489595440" },
          deliveryContext: { channel: "telegram", to: "telegram:489595440" },
          lastMessageAt: 20,
        },
      ]);
      await sessionsList.promise;
    });

    await waitFor(() => expect(result.current.activeSessionReadOnly).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:main", 200);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Incoming Telegram before metadata" }),
    ]);
    unmount();
  });

  it("does not hydrate synthetic main from a channel-backed default session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      {
        key: "agent:default:main",
        title: "Telegram DM",
        origin: { provider: "telegram", from: "telegram:489595440" },
        deliveryContext: { channel: "telegram", to: "telegram:489595440" },
        lastMessageAt: 20,
      },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sessionKey === "main"
        ? [{ role: "assistant", content: "Telegram history should not appear under main" }]
        : []
    ));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    expect(gateway.chatHistory).not.toHaveBeenCalledWith("main", 200);
    expect(result.current.activeSessionReadOnly).toBe(false);
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("does not restore or reconcile generated gateway sessions as main", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const mainGatewaySessionKey = "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab";
    window.localStorage.setItem("openclaw.sessions.v1:deploy-123", JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      sessions: [{ key: "main", gatewaySessionKey: mainGatewaySessionKey }],
    }));
    gateway.sessionsList
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          key: mainGatewaySessionKey,
          displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
          kind: "direct",
          chatType: "direct",
          origin: { provider: "webchat", surface: "webchat", chatType: "direct" },
          deliveryContext: { channel: "webchat" },
          lastChannel: "webchat",
          updatedAt: 1781271596266,
        },
      ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await waitFor(() => expect(result.current.sessions).toEqual([]));

    act(() => {
      result.current.setInput("hello main again");
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenLastCalledWith("hello main again", "main", undefined);
    unmount();
  });

  it("hides unclaimed generated sessions and skips persisted session cache", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const generatedSessionKey = "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha", updatedAt: 20 },
      { key: generatedSessionKey, updatedAt: 30 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha" }),
    ]);
    expect(result.current.sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: generatedSessionKey }),
    ]));
    expect(result.current.sessions.find((session) => session.key === "session-alpha")?.ephemeral).toBeUndefined();
    const cached = JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:deploy-123") ?? "{}");
    expect(cached.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha" }),
    ]);
    unmount();
  });

  it("never exposes or persists reserved ephemeral sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const ephemeralKey = "agent:default:session-hypercli-ephemeral-019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main", updatedAt: 20 },
      { key: ephemeralKey, updatedAt: 30 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]);
    const cached = JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:deploy-123") ?? "{}");
    expect(cached.sessions).toEqual([expect.objectContaining({ key: "main" })]);
    expect(JSON.stringify(cached)).not.toContain(ephemeralKey);
    unmount();
  });

  it("does not promote stale unclaimed generated sessions to main", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const mainGatewaySessionKey = "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab";
    window.localStorage.setItem("openclaw.sessionTitles.v1:deploy-123", JSON.stringify({
      [mainGatewaySessionKey]: "Hyper Agent Web (Chrome on Windows, localhost)",
      "session-019789ab-cdef-7abc-8def-0123456789ab": "Hyper Agent Web (Chrome on Windows, localhost)",
    }));
    window.localStorage.setItem("openclaw.sessions.v1:deploy-123", JSON.stringify({
      version: 1,
      sessions: [{
        key: mainGatewaySessionKey,
        clientMode: "openclaw",
        clientDisplayName: "Hyper Agent Web (Chrome on Windows, localhost)",
        createdAt: 1,
        lastMessageAt: 2,
        title: "",
        messageCount: 1,
      }],
    }));
    gateway.sessionsList.mockResolvedValue([{
      key: mainGatewaySessionKey,
      displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
      kind: "direct",
      chatType: "direct",
      origin: { provider: "webchat", surface: "webchat", chatType: "direct" },
      deliveryContext: { channel: "webchat" },
      lastChannel: "webchat",
      updatedAt: 1781271596266,
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:deploy-123") ?? "{}").sessions).toEqual([]);
    unmount();
  });

  it("does not reconcile generated gateway sessions for scoped main selections", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const mainGatewaySessionKey = "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab";
    window.localStorage.setItem("openclaw.sessions.v1:deploy-123", JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      sessions: [{ key: "main", gatewaySessionKey: mainGatewaySessionKey }],
    }));
    gateway.sessionsList.mockResolvedValue([{
      key: mainGatewaySessionKey,
      displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
      kind: "direct",
      chatType: "direct",
      origin: { provider: "webchat", surface: "webchat", chatType: "direct" },
      deliveryContext: { channel: "webchat" },
      lastChannel: "webchat",
      updatedAt: 1781271596266,
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "agent:default:main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([]));

    act(() => {
      result.current.setInput("hello scoped main");
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello scoped main", "agent:default:main", undefined);
    unmount();
  });

  it("normalizes non-channel scoped main sessions to one visible main session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      lastMessageAt: 20,
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]));
    expect(result.current.sessions[0]).toEqual(expect.objectContaining({
      key: "main",
      gatewaySessionKey: "agent:default:main",
      clientDisplayName: "Main Session",
    }));

    act(() => {
      result.current.setInput("hello main");
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello main", "agent:default:main", undefined);
    unmount();
  });

  it("updates the active session list before the post-send session fetch returns", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha", lastMessageAt: 1, messageCount: 0 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Alpha", messageCount: 0 }),
    ]));

    const postSendSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(postSendSessions.promise);

    act(() => {
      result.current.setInput("newest question");
    });
    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Alpha", messageCount: 1 }),
    ]));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:deploy-123") ?? "{}").sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Alpha", messageCount: 1 }),
    ]));

    await act(async () => {
      postSendSessions.resolve([{ key: "session-alpha", title: "Alpha", lastMessageAt: 3, messageCount: 2 }]);
      await sendPromise;
    });
    unmount();
  });

  it("creates a new gateway session and routes selection to that session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<void>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^session-/);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.creatingSessionKeys).toContain(newSessionKey);
    expect(result.current.messages).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({ [newSessionKey]: "New Session" });
    await waitFor(() => {
      expect(result.current.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: newSessionKey, title: "New Session" }),
      ]));
    });

    rerender({ sessionKey: newSessionKey });
    await waitFor(() => expect(result.current.activeSessionKey).toBe(newSessionKey));
    expect(result.current.connected).toBe(true);
    expect(result.current.hydrating).toBe(false);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith(newSessionKey, 200);

    await act(async () => {
      reset.resolve(undefined);
      await reset.promise;
    });
    await waitFor(() => expect(result.current.creatingSessionKeys).not.toContain(newSessionKey));
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey, title: "New Session" }),
    ]));

    gateway.sessionsList.mockResolvedValue([{
      key: `agent:default:${newSessionKey}`,
      clientDisplayName: `agent:default:${newSessionKey}`,
    }]);
    await act(async () => {
      await result.current.refreshSessions();
    });
    await waitFor(() => {
      expect(result.current.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: `agent:default:${newSessionKey}`,
          title: "New Session",
          clientDisplayName: "New Session",
        }),
      ]));
    });

    act(() => {
      result.current.setInput("hello new session");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello new session", `agent:default:${newSessionKey}`, undefined);
    unmount();
  });

  it("sends an initial message to a new session only after the session is created", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<void>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession({ initialMessage: "Test the weather skill safely." });
    });

    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(gateway.chatSend).not.toHaveBeenCalled();

    await act(async () => {
      reset.resolve(undefined);
      await reset.promise;
    });

    await waitFor(() => {
      expect(gateway.chatSend).toHaveBeenCalledWith("Test the weather skill safely.", newSessionKey, undefined);
    });
    expect(gateway.chatSend.mock.calls.map(([, sessionKey]) => sessionKey)).not.toContain("main");
    unmount();
  });

  it("can wait for gateway session creation before returning a test session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<void>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let settled = false;
    let creation!: Promise<string>;
    act(() => {
      creation = result.current.createSession({ initialMessage: "Test draft", waitForCreation: true }).then((key) => {
        settled = true;
        return key;
      });
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    reset.resolve(undefined);
    let sessionKey = "";
    await act(async () => { sessionKey = await creation; });
    expect(settled).toBe(true);
    expect(sessionKey).toMatch(/^session-/);
    expect(gateway.chatSend).toHaveBeenCalledWith("Test draft", sessionKey, undefined);
    unmount();
  });

  it("keeps a failed new session local and surfaces the gateway reset error", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsReset.mockRejectedValueOnce(new Error("Session reset failed"));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^session-/);
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey, title: "New Session" }),
    ]));
    await waitFor(() => expect(result.current.error).toBe("Session reset failed"));
    expect(result.current.creatingSessionKeys).not.toContain(newSessionKey);
    expect(gateway.chatSend).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores live chat events for non-selected sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      gateway.emit({ event: "chat.content", payload: { sessionKey: "session-beta", text: "Wrong session" } });
    });
    expect(result.current.messages).toEqual([]);

    act(() => {
      gateway.emit({ event: "chat.content", payload: { sessionKey: "agent:default:session-alpha", text: "Right session" } });
    });

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Right session"]));
    unmount();
  });

  it("ignores live chat events without a session identity", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      gateway.emit({ event: "chat.content", payload: { text: "Ephemeral prompt output" } });
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main" } });
    });

    expect(result.current.messages).toEqual([]);
    expect(gateway.chatHistory).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("renames sessions locally and deletes sessions through gateway session methods", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await act(async () => {
      await result.current.renameSession("session-alpha", "Renamed");
    });
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({ "session-alpha": "Renamed" });

    await act(async () => {
      await result.current.deleteSession("session-alpha");
    });
    expect(gateway.sessionsReset).toHaveBeenCalledWith("session-alpha", "reset");
    expect(result.current.sessions).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});
    unmount();
  });

  it("deletes and hides scoped sessions selected by their unscoped key", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "agent:default:session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "agent:default:session-alpha", title: "Alpha" }),
    ]));

    await act(async () => {
      await result.current.deleteSession("session-alpha");
    });

    expect(gateway.sessionsReset).toHaveBeenCalledWith("agent:default:session-alpha", "reset");
    expect(result.current.sessions).toEqual([]);
    unmount();
  });

  it("stops hiding a deleted session after the tombstone expires", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

      await waitFor(() => expect(result.current.sessions).toEqual([
        expect.objectContaining({ key: "session-alpha", title: "Alpha" }),
      ]));

      await act(async () => {
        await result.current.deleteSession("session-alpha");
      });
      expect(result.current.sessions).toEqual([]);

      await act(async () => {
        await result.current.refreshSessions();
      });
      expect(result.current.sessions).toEqual([]);

      nowSpy.mockReturnValue(1_031_000);
      await act(async () => {
        await result.current.refreshSessions();
      });

      await waitFor(() => expect(result.current.sessions).toEqual([
        expect.objectContaining({ key: "session-alpha", title: "Alpha" }),
      ]));
      unmount();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stores renamed scoped session titles under scoped and unscoped aliases", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "agent:default:session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "agent:default:session-alpha", title: "Alpha" }),
    ]));

    await act(async () => {
      await result.current.renameSession("agent:default:session-alpha", "Renamed");
    });

    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({
        "agent:default:session-alpha": "Renamed",
        "session-alpha": "Renamed",
      });

    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    unmount();
  });

  it("reapplies local session titles after session refresh", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await act(async () => {
      await result.current.renameSession("session-alpha", "Renamed");
    });

    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    unmount();
  });

  it("dedupes concurrent session refreshes", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValueOnce([{ key: "main", title: "Main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const callsAfterHydration = gateway.sessionsList.mock.calls.length;
    const refresh = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(refresh.promise);

    let firstRefresh: Promise<unknown> | undefined;
    let secondRefresh: Promise<unknown> | undefined;
    act(() => {
      firstRefresh = result.current.refreshSessions();
      secondRefresh = result.current.refreshSessions();
    });

    expect(gateway.sessionsList).toHaveBeenCalledTimes(callsAfterHydration + 1);

    await act(async () => {
      refresh.resolve([{ key: "session-fresh", title: "Fresh" }]);
      await Promise.all([firstRefresh, secondRefresh]);
    });

    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-fresh", title: "Fresh" }),
    ]);
    unmount();
  });

  it("does not rewrite unchanged fetched sessions on refresh", async () => {
    const storageKey = "openclaw.sessions.v1:deploy-123";
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionWrites = () => setItemSpy.mock.calls.filter(([key]) => key === storageKey).length;
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha", lastMessageAt: 10, messageCount: 1 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

      await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
      await waitFor(() => expect(result.current.sessions).toEqual([
        expect.objectContaining({ key: "session-alpha", title: "Alpha", messageCount: 1 }),
      ]));
      const writesAfterHydration = sessionWrites();

      await act(async () => {
        await result.current.refreshSessions();
      });

      expect(sessionWrites()).toBe(writesAfterHydration);
      unmount();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("rewrites fetched sessions when session metadata changes", async () => {
    const storageKey = "openclaw.sessions.v1:deploy-123";
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionWrites = () => setItemSpy.mock.calls.filter(([key]) => key === storageKey).length;
    const gateway = buildGateway();
    gateway.sessionsList
      .mockResolvedValueOnce([{ key: "session-alpha", title: "Alpha", lastMessageAt: 10, messageCount: 1 }])
      .mockResolvedValue([{ key: "session-alpha", title: "Alpha", lastMessageAt: 20, messageCount: 2 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

      await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
      await waitFor(() => expect(result.current.sessions).toEqual([
        expect.objectContaining({ key: "session-alpha", title: "Alpha", messageCount: 1 }),
      ]));
      const writesAfterHydration = sessionWrites();

      await act(async () => {
        await result.current.refreshSessions();
      });

      expect(sessionWrites()).toBe(writesAfterHydration + 1);
      expect(result.current.sessions).toEqual([
        expect.objectContaining({ key: "session-alpha", title: "Alpha", lastMessageAt: 20, messageCount: 2 }),
      ]);
      unmount();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("coalesces passive terminal gateway events into one history and session refresh", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Initial history" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200));
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));
    const historyCallsAfterHydration = gateway.chatHistory.mock.calls.length;
    const sessionCallsAfterHydration = gateway.sessionsList.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Refreshed history" }]);

    act(() => {
      gateway.emit({ event: "chat", payload: { sessionKey: "main", state: "final" } });
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main" } });
      gateway.emit({ event: "agent", payload: { sessionKey: "main", stream: "lifecycle", data: { phase: "end" } } });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(gateway.chatHistory).toHaveBeenCalledTimes(historyCallsAfterHydration + 1);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(sessionCallsAfterHydration + 1);
    unmount();
  });

  it("coalesces duplicate passive done events into one history and session refresh", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Initial history" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200));
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));
    const historyCallsAfterHydration = gateway.chatHistory.mock.calls.length;
    const sessionCallsAfterHydration = gateway.sessionsList.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Refreshed history" }]);

    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main" } });
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main" } });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(gateway.chatHistory).toHaveBeenCalledTimes(historyCallsAfterHydration + 1);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(sessionCallsAfterHydration + 1);
    unmount();
  });

  it("can send voice-note instructions while showing only the attached audio file", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const voiceFile = {
      name: "voice-1.webm",
      path: "/home/node/.openclaw/workspace/voice-1.webm",
      type: "audio/webm",
    };
    const voiceMessage = "I recorded a voice message. Run this command to transcribe it:\n`hyper voice transcribe /home/node/.openclaw/workspace/voice-1.webm`";

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await act(async () => {
      await result.current.sendMessage(voiceMessage, { displayContent: "", files: [voiceFile] });
    });

    expect(gateway.chatSend).toHaveBeenCalledWith(
      `file: ${voiceFile.path}\n\n${voiceMessage}`,
      "main",
      undefined,
    );
    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      role: "user",
      content: "",
      files: [voiceFile],
    }));
    unmount();
  });

  it("dedupes refreshed voice-note history and drops async transcription status", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const voicePath = "/home/node/.openclaw/workspace/voice-1779810830903.webm";
    const voiceMessage = `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${voicePath}\``;

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: `file: ${voicePath}\n\n${voiceMessage}` },
      { role: "user", content: `file: ${voicePath}\n\n${voiceMessage}` },
      {
        role: "assistant",
        content: [
          "System (untrusted): [2026-05-26 15:55:05 UTC] Exec completed (fast-kel, code 0) :: Model: turbo",
          `File: ${voicePath} (58.8 KB)`,
          "An async command you ran earlier has completed.",
        ].join("\n"),
      },
    ]);

    await act(async () => {
      await result.current.sendMessage(voiceMessage, {
        displayContent: "",
        files: [{ name: "voice-1779810830903.webm", path: voicePath, type: "audio/webm" }],
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]).toEqual(expect.objectContaining({
        role: "user",
        files: [{ name: "voice-1779810830903.webm", path: voicePath, type: "audio/webm" }],
      }));
    });
    expect(JSON.stringify(result.current.messages)).not.toContain("Exec completed");
    unmount();
  });

  it("restores cached browser history when gateway history is empty", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const cacheKey = openClawChatHistoryCacheKey("deploy-123");
    expect(cacheKey).toBeTruthy();
    window.localStorage.setItem(cacheKey!, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [
        { role: "user", content: "old question", timestamp: 1 },
        { role: "assistant", content: "old answer", timestamp: 2 },
      ],
    }));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(result.current.messages).toEqual([
      { role: "user", content: "old question", timestamp: 1 },
      { role: "assistant", content: "old answer", timestamp: 2 },
    ]);
    unmount();
  });

  it("suppresses duplicate live chat events while the streaming helper owns the response", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      gateway.emit({ event: "chat.content", payload: { sessionKey: "main", text: "Hello" } });
      yield { type: "content" as const, text: "Hello" };
      yield { type: "done" as const };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter((message) => message.role === "assistant");
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe("Hello");
    });
    await waitFor(() => {
      const cachedMessages = readCachedOpenClawChatHistory("deploy-123");
      expect(cachedMessages.map((message) => message.content)).toEqual(["hello", "Hello"]);
    });
    unmount();
  });

  it("shows pending streamed tool calls before the tool result arrives", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const toolResult = deferred<void>();
    gateway.chatSend.mockImplementation(async function* () {
      yield {
        type: "tool_call" as const,
        data: {
          tool_call_id: "tool-1",
          tool_name: "functions.read",
          args: { path: "/tmp/demo.zip" },
        },
      };
      await toolResult.promise;
      yield {
        type: "tool_result" as const,
        data: {
          tool_call_id: "tool-1",
          tool_name: "functions.read",
          result: "done",
        },
      };
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("inspect zip");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.role === "assistant");
      expect(assistant?.toolCalls?.[0]).toMatchObject({
        id: "tool-1",
        name: "functions.read",
      });
      expect(assistant?.toolCalls?.[0]?.result).toBeUndefined();
    });
    expect(result.current.sending).toBe(true);

    await act(async () => {
      toolResult.resolve();
      await sendPromise;
    });
    unmount();
  });

  it("shows aborting state and marks partial replies interrupted after abort acknowledgement", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const abortAck = deferred<void>();
    const release = deferred<void>();
    gateway.chatAbort.mockImplementation(async () => abortAck.promise);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "Partial answer" };
      await release.promise;
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("stop this reply");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.sending).toBe(true));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "stop this reply" }),
      expect.objectContaining({ role: "assistant", content: "Partial answer" }),
    ]));

    let abortPromise: Promise<void> | undefined;
    act(() => {
      abortPromise = result.current.abortMessage();
    });

    await waitFor(() => expect(result.current.aborting).toBe(true));
    expect(gateway.chatAbort).toHaveBeenCalledWith("main");

    await act(async () => {
      abortAck.resolve();
      await abortPromise;
    });

    expect(gateway.chatAbort).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.aborting).toBe(false);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "stop this reply" }),
      expect.objectContaining({ role: "assistant", content: "Partial answer", status: "interrupted" }),
    ]);

    await act(async () => {
      release.resolve();
      await sendPromise;
    });
    unmount();
  });

  it("adds a reply stopped notice when aborting before assistant content appears", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const release = deferred<void>();
    gateway.chatSend.mockImplementation(async function* () {
      await release.promise;
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("stop before content");
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage();
    });

    await waitFor(() => expect(result.current.sending).toBe(true));

    await act(async () => {
      await result.current.abortMessage();
    });

    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "stop before content" }),
      expect.objectContaining({ role: "system", content: "Reply stopped" }),
    ]);

    await act(async () => {
      release.resolve();
      await sendPromise;
    });
    unmount();
  });

  it("preserves streamed tool calls after post-send history refresh", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield {
        type: "tool_call" as const,
        data: {
          toolCallId: "tool-1",
          name: "functions.read",
          args: { path: "/tmp/demo.zip" },
        },
      };
      yield {
        type: "tool_result" as const,
        data: {
          toolCallId: "tool-1",
          name: "functions.read",
          result: "Read complete",
        },
      };
      yield { type: "content" as const, text: "Live summary" };
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "inspect zip" },
      { role: "assistant", content: "History summary" },
    ]);

    act(() => {
      result.current.setInput("inspect zip");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ role: "user", content: "inspect zip" }),
        expect.objectContaining({
          role: "assistant",
          content: "History summary",
          toolCalls: [
            expect.objectContaining({
              id: "tool-1",
              name: "functions.read",
              result: "Read complete",
            }),
          ],
        }),
      ]);
    });
    unmount();
  });

  it("refreshes persisted history after chatSend completes so generated media appears without reload", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "MEDIA:" };
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "make an image" },
      { role: "assistant", content: "MEDIA:/home/node/.openclaw/workspace/865621.jpg" },
    ]);

    act(() => {
      result.current.setInput("make an image");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ role: "user", content: "make an image" }),
        expect.objectContaining({ role: "assistant", content: "MEDIA:/home/node/.openclaw/workspace/865621.jpg" }),
      ]);
    });
    expect(gateway.chatHistory).toHaveBeenLastCalledWith("main", 200);
    unmount();
  });

  it("keeps the legacy send path active until a live done event when chatSend is unavailable", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    (gateway as any).chatSend = undefined;
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    act(() => {
      result.current.setInput("hello");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.sendChat).toHaveBeenCalledWith("hello", "main", undefined, undefined);
    expect(result.current.sending).toBe(true);

    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main" } });
    });

    await waitFor(() => expect(result.current.sending).toBe(false));
    unmount();
  });

  it("rebuilds the gateway client when retry is requested", async () => {
    const firstGateway = buildGateway();
    const secondGateway = buildGateway();
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn()
        .mockReturnValueOnce(firstGateway)
        .mockReturnValueOnce(secondGateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(agent.gateway).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(firstGateway.close).toHaveBeenCalledTimes(1);
    expect(secondGateway.connect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("refreshes the session list after a reconnect refresh request", async () => {
    const firstGateway = buildGateway();
    firstGateway.sessionsList.mockResolvedValue([]);
    const secondGateway = buildGateway();
    secondGateway.sessionsList.mockResolvedValueOnce([{ key: "agent:default:main", origin: { provider: "telegram", from: "telegram:489595440" } }] as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn()
        .mockReturnValueOnce(firstGateway)
        .mockReturnValueOnce(secondGateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    let refreshPromise!: ReturnType<typeof result.current.retryAndRefreshSessions>;
    act(() => {
      refreshPromise = result.current.retryAndRefreshSessions();
    });

    await waitFor(() => expect(agent.gateway).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.connected).toBe(true));
    const refreshedSessions = await refreshPromise;
    expect(refreshedSessions).toEqual([
      expect.objectContaining({ key: "telegram:489595440", sourceChannelId: "telegram" }),
    ]);
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "telegram:489595440", sourceChannelId: "telegram" }),
    ]));
    expect(secondGateway.sessionsList).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("waits for reconnect hydration before refreshing sessions", async () => {
    const firstGateway = buildGateway();
    firstGateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }] as any);
    const secondGateway = buildGateway();
    const configGet = deferred<{ llm: { model: string } }>();
    secondGateway.configGet.mockReturnValue(configGet.promise);
    secondGateway.sessionsList.mockResolvedValueOnce([
      { key: "main", title: "Main" },
      { key: "session-fresh", title: "Fresh" },
    ] as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn()
        .mockReturnValueOnce(firstGateway)
        .mockReturnValueOnce(secondGateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(firstGateway.sessionsList).toHaveBeenCalledTimes(1);

    let refreshPromise!: ReturnType<typeof result.current.retryAndRefreshSessions>;
    act(() => {
      refreshPromise = result.current.retryAndRefreshSessions();
    });

    await waitFor(() => expect(agent.gateway).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(secondGateway.configGet).toHaveBeenCalledTimes(1));
    expect(secondGateway.sessionsList).not.toHaveBeenCalled();

    let refreshedSessions: Awaited<ReturnType<typeof result.current.retryAndRefreshSessions>> | undefined;
    await act(async () => {
      configGet.resolve({ llm: { model: "reconnected-model" } });
      refreshedSessions = await refreshPromise;
    });

    expect(refreshedSessions).toEqual([
      expect.objectContaining({ key: "main", title: "Main" }),
      expect.objectContaining({ key: "session-fresh", title: "Fresh" }),
    ]);
    expect(secondGateway.sessionsList).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "session-fresh", title: "Fresh" }),
    ])));
    unmount();
  });

  it("surfaces a retryable error when opening the gateway session stalls", async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    type WindowSetTimeoutMock = Parameters<typeof setTimeoutSpy.mockImplementation>[0];
    const setTimeoutMock: WindowSetTimeoutMock = (handler, timeout) => {
      if (timeout === 30_000 && typeof handler === "function") {
        handler(undefined);
        return 0 as unknown as ReturnType<WindowSetTimeoutMock>;
      }
      return originalSetTimeout(handler, timeout) as unknown as ReturnType<WindowSetTimeoutMock>;
    };
    setTimeoutSpy.mockImplementation(setTimeoutMock);
    const gateway = buildGateway("connecting");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

      await waitFor(() => expect(agent.gateway).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.error).toMatch(/Timed out opening the agent session/i));
      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(gateway.connect).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("turns gateway origin denials into actionable UI copy", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({ detail: "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)" });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe("This agent was opened from another dashboard address. Stop and start it from this page, then retry."));
    expect(result.current.error).not.toMatch(/allowedOrigins/);
    expect(result.current.connecting).toBe(false);
    unmount();
  });

  it("keeps pairing-required closes in the connecting flow for auto-approval", async () => {
    let onClose: ((info: any) => void) | null = null;
    const gateway = buildGateway("connecting");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn((options: { onClose?: (info: any) => void }) => {
        onClose = options.onClose ?? null;
        return gateway;
      }),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(agent.gateway).toHaveBeenCalledTimes(1));
    act(() => {
      onClose?.({
        code: 4008,
        reason: "pairing required",
        error: { code: "PAIRING_REQUIRED", message: "pairing required" },
      });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.connecting).toBe(true);
    unmount();
  });

  it("does not render object-shaped gateway errors as object strings", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({ detail: { message: "Gateway handshake failed" } });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe("Gateway handshake failed"));
    expect(result.current.error).not.toBe("[object Object]");
    expect(result.current.connecting).toBe(false);
    unmount();
  });

  it("uses a readable fallback for opaque gateway error objects", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({ code: "gateway_failed" });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe("Could not connect to the agent session."));
    expect(result.current.error).not.toBe("[object Object]");
    expect(result.current.connecting).toBe(false);
    unmount();
  });

  it("keeps one SDK gateway client mounted across section changes while enabled", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ section }: { section: "chat" | "files" | "settings" | "logs" | "shell" }) => ({
        section,
        session: useOpenClawSession(agent as any, true),
      }),
      { initialProps: { section: "chat" } },
    );

    await waitFor(() => expect(result.current.session.connected).toBe(true));

    rerender({ section: "files" });
    rerender({ section: "settings" });
    rerender({ section: "logs" });
    rerender({ section: "shell" });

    expect(agent.gateway).toHaveBeenCalledTimes(1);
    expect(gateway.close).not.toHaveBeenCalled();
    unmount();
  });

  it("does not reconnect when the selected agent refreshes with the same id", async () => {
    const gateway = buildGateway();
    const firstAgent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const refreshedAgent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => buildGateway()),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ agent }: { agent: typeof firstAgent }) => useOpenClawSession(agent as any, true),
      { initialProps: { agent: firstAgent } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));

    rerender({ agent: refreshedAgent });

    expect(firstAgent.gateway).toHaveBeenCalledTimes(1);
    expect(refreshedAgent.gateway).not.toHaveBeenCalled();
    expect(gateway.close).not.toHaveBeenCalled();
    unmount();
  });

  it("does not expose stale projects while switching selected agents", async () => {
    const firstGateway = buildGateway();
    firstGateway.sessionsList.mockResolvedValue([{ key: "session-first", title: "First project" }]);
    const secondGateway = buildGateway();
    secondGateway.sessionsList.mockResolvedValue([{ key: "session-second", title: "Second project" }]);
    const firstAgent = {
      id: "deploy-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => firstGateway),
    };
    const secondAgent = {
      id: "deploy-2",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => secondGateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ agent }: { agent: typeof firstAgent | typeof secondAgent }) => useOpenClawSession(agent as any, true),
      { initialProps: { agent: firstAgent } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-first", title: "First project" }),
    ]));

    rerender({ agent: secondAgent });
    expect(result.current.sessions).toEqual([]);

    await waitFor(() => expect(secondAgent.gateway).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-second", title: "Second project" }),
    ]));
    expect(result.current.sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "session-first" }),
    ]));
    unmount();
  });

  it("keeps visible session history when the gateway reports a disconnect before reconnecting", async () => {
    const gateway = buildGateway();
    gateway.chatHistory.mockResolvedValue([
      { role: "assistant", content: [{ type: "text", text: "Persisted response" }] },
    ]);
    gateway.filesList.mockResolvedValue([{ name: "README.md", path: "README.md", size: 100 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await waitFor(() => expect(result.current.files).toHaveLength(1));

    act(() => {
      gateway.emitConnectionState("disconnected");
      gateway.emitConnectionState("connecting");
    });

    expect(result.current.status).toBe("connecting");
    expect(result.current.connected).toBe(false);
    expect(result.current.ready).toBe(false);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Persisted response" }),
    ]);
    expect(result.current.files).toEqual([]);
    expect(result.current.config).toBeNull();
    unmount();
  });

});
