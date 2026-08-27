import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { OpenClawWhatsAppProgressEvent } from "@hypercli.com/sdk/openclaw/whatsapp";

import { renderHookWithClient } from "@/test/utils";
import {
  openClawChatHistoryCacheKey,
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "@/lib/openclaw-chat-history-cache";
import { useOpenClawSession } from "./useOpenClawSession";

type TestGatewayConnectionState = "connected" | "connecting" | "pairing" | "disconnected";

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
  const sessionsReset = vi.fn(async (sessionKey: string, _reason?: "new" | "reset"): Promise<string> => sessionKey);
  const sessionsCreate = vi.fn(async (params: { key?: string }) => {
    const key = params.key ?? "dashboard:test";
    return { ok: true as const, key: await sessionsReset(key, "new") };
  });
  const gateway = {
    get state() {
      return connectionState;
    },
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    releaseLease: vi.fn(),
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
    chatHistoryResult: vi.fn(async (sessionKey: string, limit?: number) => ({
      messages: await gateway.chatHistory(sessionKey, limit),
    })),
    sessionsPreview: vi.fn(async (_sessionKey: string, _limit?: number): Promise<unknown[]> => []),
    agentsList: vi.fn(async (): Promise<Array<Record<string, unknown>>> => [{ id: "agent-1" }]),
    sessionsList: vi.fn(async (): Promise<unknown[]> => []),
    sessionsSubscribe: vi.fn(async () => true),
    sessionsPatch: vi.fn(async (_patch: Record<string, unknown>): Promise<Record<string, unknown>> => ({ ok: true })),
    sessionsReset,
    sessionsCreate,
    cronList: vi.fn(async (): Promise<unknown[]> => []),
    cronAdd: vi.fn(async () => ({ id: "new-cron-job" })),
    cronRemove: vi.fn(async (): Promise<void> => undefined),
    cronRun: vi.fn(async () => ({ ok: true })),
    modelsList: vi.fn(async (): Promise<unknown[]> => []),
    filesList: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    sendChat: vi.fn(async () => ({ runId: "run-1" })),
    chatAbort: vi.fn(async (_sessionKey?: string, _runId?: string): Promise<void> => undefined),
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

async function acquireConnectedGatewayFixture(this: any, options: unknown) {
  await this.waitForGatewayContext?.();
  const client = this.gateway(options);
  await client.connect();
  return {
    client,
    release: client.releaseLease,
  };
}

function controlledChatStream() {
  type StreamResult = IteratorResult<ChatEvent, void>;
  const queuedResults: StreamResult[] = [];
  const pendingReads: Array<ReturnType<typeof deferred<StreamResult>>> = [];
  const returnResult = deferred<StreamResult>();
  const push = (result: StreamResult) => {
    const pendingRead = pendingReads.shift();
    if (pendingRead) pendingRead.resolve(result);
    else queuedResults.push(result);
  };
  const returnIterator = vi.fn(() => returnResult.promise);
  const iterator = {
    next: vi.fn(() => {
      const queuedResult = queuedResults.shift();
      if (queuedResult) return Promise.resolve(queuedResult);
      const pendingRead = deferred<StreamResult>();
      pendingReads.push(pendingRead);
      return pendingRead.promise;
    }),
    return: returnIterator,
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as AsyncGenerator<ChatEvent, void, unknown>;

  return {
    iterator,
    returnIterator,
    emit: (event: ChatEvent) => push({ done: false, value: event }),
    finish: () => push({ done: true, value: undefined }),
    releaseReturn: () => returnResult.resolve({ done: true, value: undefined }),
  };
}

describe("useOpenClawSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("connects with the canonical OpenClaw Control UI identity", async () => {
    const gateway = buildGateway();
    const release = vi.fn();
    const agent = {
      id: "agent-1",
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      acquireConnectedGateway: vi.fn(async () => ({ client: gateway, release })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(agent.acquireConnectedGateway).toHaveBeenCalledWith(expect.objectContaining({
      autoApprovePairing: true,
      clientId: "openclaw-control-ui",
      clientMode: "webchat",
    }), expect.objectContaining({ timeoutMs: 30_000 }));
    expect(agent.waitForGatewayContext).not.toHaveBeenCalled();
    expect(agent.gateway).not.toHaveBeenCalled();
    expect(gateway.connect).not.toHaveBeenCalled();
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it("routes skills through Gateway and AgentFiles without Agent exec", async () => {
    const gateway = buildGateway();
    const skillsStatus = vi.fn(async () => ({
      agentId: "agent-1",
      workspaceDir: "/home/node/.openclaw/workspace",
      managedSkillsDir: "/home/node/.openclaw/skills",
      skills: [],
    }));
    Object.assign(gateway, { skillsStatus });
    const files = {
      list: vi.fn(async () => []),
      readBytes: vi.fn(async () => new Uint8Array()),
      writeBytes: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    };
    const agent = {
      id: "agent-1",
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      files,
      exec: vi.fn(),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await expect(result.current.skillsProvider.list()).resolves.toEqual([]);
    await expect(result.current.skillsProvider.createSkill({ id: "release-helper", content: "# Release Helper" })).resolves.toEqual({
      skillId: "release-helper",
    });

    expect(skillsStatus).toHaveBeenCalledTimes(2);
    expect(files.writeBytes).toHaveBeenCalledWith(
      ".openclaw/workspace/skills/release-helper/SKILL.md",
      new TextEncoder().encode("# Release Helper"),
    );
    expect(agent.exec).not.toHaveBeenCalled();
    unmount();
  });

  it("routes ephemeral prompts through the connected SDK gateway client", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
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

  it("preserves outer whitespace in non-empty chat messages", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    const message = "    def validate():\n        return True\n";

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => result.current.setInput(message));
    await act(async () => result.current.sendMessage());

    expect(gateway.chatSend).toHaveBeenCalledWith(message, "main", undefined);
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: message }),
    ]));
    unmount();
  });

  it("refreshes active history and sessions after a gateway sequence gap", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const initialHistoryCalls = gateway.chatHistory.mock.calls.length;
    const initialSessionCalls = gateway.sessionsList.mock.calls.length;
    const gapSessions = deferred<unknown[]>();
    gateway.sessionsList.mockImplementation(() => gapSessions.promise);
    gateway.chatHistory.mockResolvedValue([
      { role: "assistant", content: "Recovered after sequence gap", timestamp: 123 },
    ]);

    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    expect(gatewayOptions?.onGap).toEqual(expect.any(Function));
    act(() => {
      gatewayOptions?.onGap?.({ expected: 4, received: 6 });
    });

    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(initialSessionCalls));
    expect(gateway.chatHistory.mock.calls).toHaveLength(initialHistoryCalls);
    await act(async () => {
      gapSessions.resolve([]);
      await gapSessions.promise;
    });
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(initialHistoryCalls));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Recovered after sequence gap",
      }),
    ]));
    unmount();
  });

  it("keeps mounted history when gap recovery returns an unconfirmed empty snapshot", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{
      key: "main",
      messageCount: 2,
      updatedAt: 10,
    }]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Question before sequence gap" },
      { role: "assistant", content: "Answer before sequence gap" },
    ]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    const initialHistoryCalls = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([]);
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => gatewayOptions?.onGap?.({ expected: 4, received: 6 }));

    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(initialHistoryCalls));
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question before sequence gap",
      "Answer before sequence gap",
    ]);
    unmount();
  });

  it("clears an adopted response when gap recovery confirms it ended", async () => {
    const gateway = buildGateway();
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "main",
      status: active ? "running" : "done",
      hasActiveRun: active,
      activeRunIds: active ? ["run-gap"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Long request" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-gap"] },
          inFlightRun: { runId: "run-gap", text: "Partial response" },
        } as any
      : {
          messages: [
            { role: "user", content: "Long request" },
            { role: "assistant", content: "Complete response", runId: "run-gap" },
          ],
          sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    const initialHistoryCalls = gateway.chatHistoryResult.mock.calls.length;
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    active = false;
    act(() => gatewayOptions?.onGap?.({ expected: 4, received: 6 }));

    await waitFor(() => expect(gateway.chatHistoryResult.mock.calls.length).toBeGreaterThan(initialHistoryCalls));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long request" }),
      expect.objectContaining({ role: "assistant", content: "Complete response" }),
    ]));
    unmount();
  });

  it("does not let gap recovery roll back a newer live reply", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const initialHistoryCalls = gateway.chatHistory.mock.calls.length;
    const initialSessionCalls = gateway.sessionsList.mock.calls.length;
    const gapSessions = deferred<unknown[]>();
    gateway.sessionsList.mockImplementation(() => gapSessions.promise);
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => {
      gatewayOptions?.onGap?.({ expected: 4, received: 6 });
    });
    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(initialSessionCalls));
    expect(gateway.chatHistory.mock.calls).toHaveLength(initialHistoryCalls);

    act(() => {
      gateway.emit({
        event: "chat.content",
        payload: { sessionKey: result.current.activeSessionKey, text: "Newer live reply" },
      });
    });
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Newer live reply" }),
    ]));

    await act(async () => {
      gapSessions.resolve([]);
      await gapSessions.promise;
    });
    expect(gateway.chatHistory.mock.calls).toHaveLength(initialHistoryCalls);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Newer live reply" }),
    ]);
    unmount();
  });

  it("does not let gap history clear newer lifecycle progress", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const gapSessions = deferred<unknown[]>();
    const gapHistory = deferred<any>();
    gateway.sessionsList.mockImplementation(() => gapSessions.promise);
    gateway.chatHistoryResult.mockImplementation(() => gapHistory.promise);
    const initialHistoryCalls = gateway.chatHistoryResult.mock.calls.length;
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => gatewayOptions?.onGap?.({ expected: 4, received: 6 }));
    await act(async () => {
      gapSessions.resolve([{ key: "main", status: "done", hasActiveRun: false, activeRunIds: [] }]);
      await gapSessions.promise;
    });
    await waitFor(() => expect(gateway.chatHistoryResult.mock.calls.length).toBeGreaterThan(initialHistoryCalls));

    act(() => gateway.emit({
      event: "agent",
      payload: {
        sessionKey: "main",
        runId: "run-lifecycle",
        stream: "lifecycle",
        data: { phase: "start", runId: "run-lifecycle" },
      },
    }));
    await act(async () => {
      gapHistory.resolve({
        messages: [],
        sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
      });
      await gapHistory.promise;
    });

    expect(result.current.activeSessionSending).toBe(true);
    unmount();
  });

  it("waits for canonical session routing before requesting history", async () => {
    const gateway = buildGateway();
    const freshSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(freshSessions.promise);
    gateway.chatHistory.mockImplementation((sessionKey: string) => (
      sessionKey === "visible"
        ? Promise.reject(new Error("provisional history unavailable"))
        : Promise.resolve([{ role: "assistant", content: "Canonical history", timestamp: 2 }])
    ));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "visible"));

    await waitFor(() => expect(result.current.historyPhase).toBe("loading"));
    expect(result.current.activeSessionCanSend).toBe(false);
    expect(gateway.chatHistory).not.toHaveBeenCalled();
    await act(async () => {
      freshSessions.resolve([
        { key: "visible", gatewaySessionKey: "gateway-canonical", title: "Visible", updatedAt: 2 },
      ]);
      await freshSessions.promise;
    });

    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Canonical history" }),
    ]));
    expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-canonical", 200);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("visible", 200);
    expect(result.current.historyPhase).toBe("ready");
    expect(result.current.activeSessionCanSend).toBe(true);
    unmount();
  });

  it("uses one canonical history request after refreshed sessions change the gateway key", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "visible", gatewaySessionKey: "gateway-old", title: "Visible", updatedAt: 1 },
    ]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "visible"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    gateway.chatHistory.mockClear();
    gateway.chatHistory.mockImplementation((sessionKey: string) => (
      Promise.resolve([{ role: "assistant", content: `${sessionKey} corrected history`, timestamp: 2 }])
    ));
    gateway.sessionsList.mockResolvedValue([
      { key: "visible", gatewaySessionKey: "gateway-new", title: "Visible", updatedAt: 2 },
    ]);

    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => {
      gatewayOptions?.onGap?.({ expected: 7, received: 9 });
    });

    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-new", 200));
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("gateway-old", 200);
    expect(gateway.chatHistory).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "gateway-new corrected history" }),
    ]));
    unmount();
  });

  it("does not drain a queued message through the old route during gap recovery", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "visible", gatewaySessionKey: "gateway-old", title: "Visible" },
    ]);
    const firstReply = deferred<void>();
    const sends: Array<{ message: string; sessionKey: string }> = [];
    gateway.chatSend.mockImplementation((async function* (message: string, sessionKey: string) {
      sends.push({ message, sessionKey });
      if (message === "first") await firstReply.promise;
      yield { type: "done" as const };
    }) as any);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sends.length > 0 || sessionKey === "gateway-new"
        ? [{ role: "user", content: "first" }]
        : []
    ));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "visible"));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    let firstSend!: Promise<void>;
    act(() => {
      result.current.setInput("first");
      firstSend = result.current.sendMessage();
    });
    await waitFor(() => expect(sends).toEqual([{ message: "first", sessionKey: "gateway-old" }]));
    act(() => result.current.addPendingMessage("second"));

    const gapSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(gapSessions.promise);
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => gatewayOptions?.onGap?.({ expected: 10, received: 12 }));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(false));

    await act(async () => {
      firstReply.resolve();
      await firstReply.promise;
    });
    expect(sends).toEqual([{ message: "first", sessionKey: "gateway-old" }]);
    expect(result.current.pendingInput).toEqual(["second"]);

    await act(async () => {
      gapSessions.resolve([
        { key: "visible", gatewaySessionKey: "gateway-new", title: "Visible" },
      ]);
      await gapSessions.promise;
      await firstSend;
    });

    await waitFor(() => expect(sends).toEqual([
      { message: "first", sessionKey: "gateway-old" },
      { message: "second", sessionKey: "gateway-new" },
    ]));
    unmount();
  });

  it("keeps current history when canonical gap recovery fails", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "visible", gatewaySessionKey: "gateway-old", title: "Visible", updatedAt: 1 },
    ]);
    gateway.chatHistory.mockResolvedValue([
      { role: "assistant", content: "Current history", timestamp: 1 },
    ]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "visible"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Current history" }),
    ]));
    gateway.chatHistory.mockRejectedValue(new Error("corrected history unavailable"));
    gateway.sessionsList.mockResolvedValue([
      { key: "visible", gatewaySessionKey: "gateway-new", title: "Visible", updatedAt: 2 },
    ]);

    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => {
      gatewayOptions?.onGap?.({ expected: 10, received: 12 });
    });
    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-new", 200));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Current history" }),
    ]);
    unmount();
  });

  it("refreshes sessions after a gateway sequence gap in sessions-only mode", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(
      agent as any,
      true,
      "main",
      { hydrationMode: "sessions" },
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const initialHistoryCalls = gateway.chatHistory.mock.calls.length;
    const initialSessionCalls = gateway.sessionsList.mock.calls.length;
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Recovered session", updatedAt: 2 },
    ]);

    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => {
      gatewayOptions?.onGap?.({ expected: 2, received: 4 });
    });

    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(initialSessionCalls));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "main", title: "Recovered session" }),
    ]));
    expect(gateway.chatHistory.mock.calls).toHaveLength(initialHistoryCalls);
    unmount();
  });

  it("takes a fresh session snapshot after a gateway sequence gap", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(
      agent as any,
      true,
      "main",
      { hydrationMode: "sessions" },
    ));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const initialSessionCalls = gateway.sessionsList.mock.calls.length;
    const preGapSessions = deferred<unknown[]>();
    gateway.sessionsList.mockImplementationOnce(() => preGapSessions.promise);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Post-gap session", updatedAt: 3 },
    ]);

    act(() => {
      void result.current.refreshSessions();
    });
    await waitFor(() => expect(gateway.sessionsList.mock.calls).toHaveLength(initialSessionCalls + 1));
    const gatewayOptions = agent.gateway.mock.calls[0]?.[0] as {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    act(() => {
      gatewayOptions?.onGap?.({ expected: 3, received: 5 });
    });
    expect(gateway.sessionsList.mock.calls).toHaveLength(initialSessionCalls + 1);

    await act(async () => {
      preGapSessions.resolve([{ key: "main", title: "Pre-gap session", updatedAt: 2 }]);
      await preGapSessions.promise;
    });
    await waitFor(() => expect(gateway.sessionsList.mock.calls).toHaveLength(initialSessionCalls + 2));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "main", title: "Post-gap session" }),
    ]));
    unmount();
  });

  it("keeps a multi-turn private chat in memory and restores the empty normal composer on end", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: `${message} reply` };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

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
    expect(result.current.input).toBe("");
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("creates exactly one ephemeral lease under rapid repeated start toggles", async () => {
    const gateway = buildGateway();
    const createGate = deferred<void>();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.createEphemeralChatSession.mockImplementationOnce(async () => {
      await createGate.promise;
      const sessionKey = "session-hypercli-ephemeral-019789ab-cdef-4abc-8def-000000000001";
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
      gateway.ephemeralSessions.push(session);
      return session;
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let firstStart!: Promise<void>;
    let secondStart!: Promise<void>;
    let thirdStart!: Promise<void>;
    act(() => {
      firstStart = result.current.startTemporaryChat();
      secondStart = result.current.startTemporaryChat();
      thirdStart = result.current.startTemporaryChat();
    });
    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      createGate.resolve();
      await Promise.all([firstStart, secondStart, thirdStart]);
    });

    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(1);
    expect(gateway.ephemeralSessions).toHaveLength(1);
    expect(result.current.temporaryChatActive).toBe(true);

    let firstEnd!: Promise<void>;
    let secondEnd!: Promise<void>;
    await act(async () => {
      firstEnd = result.current.endTemporaryChat();
      secondEnd = result.current.endTemporaryChat();
      await Promise.all([firstEnd, secondEnd]);
    });

    expect(gateway.ephemeralSessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(result.current.temporaryChatActive).toBe(false);
    unmount();
  });

  it("refuses to start a private chat while the ordinary session has a composer draft", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    act(() => result.current.setInput("unsent draft"));

    let startError: unknown;
    await act(async () => {
      startError = await result.current.startTemporaryChat().then(
        () => null,
        (cause: unknown) => cause,
      );
    });
    expect(startError).toBeInstanceOf(Error);
    expect((startError as Error).message).toMatch(/draft|clear/i);
    expect(gateway.createEphemeralChatSession).not.toHaveBeenCalled();
    expect(result.current.temporaryChatState).toBe("inactive");
    unmount();
  });

  it("refuses to start a private chat while a message is queued for the ordinary session", async () => {
    const gateway = buildGateway();
    const firstReply = deferred<void>();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation((async function* () {
      await firstReply.promise;
      yield { type: "done" as const };
    }) as any);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let firstSend!: Promise<void>;
    act(() => {
      firstSend = result.current.sendMessage("first");
    });
    await waitFor(() => expect(result.current.sending).toBe(true));
    act(() => {
      result.current.addPendingMessage("queued follow-up");
    });
    await waitFor(() => expect(result.current.pendingInput).toEqual(["queued follow-up"]));

    let startError: unknown;
    await act(async () => {
      startError = await result.current.startTemporaryChat().then(
        () => null,
        (cause: unknown) => cause,
      );
    });
    expect(startError).toBeInstanceOf(Error);
    expect((startError as Error).message).toMatch(/queued|pending|wait/i);
    expect(gateway.createEphemeralChatSession).not.toHaveBeenCalled();

    await act(async () => {
      firstReply.resolve();
      await firstSend;
    });
    unmount();
  });

  it("refuses to restart a private chat that already has content after it ends", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: `${message} reply` };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    await act(async () => result.current.startTemporaryChat());
    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(1);
    await act(async () => result.current.sendMessage("one-use secret"));
    await act(async () => result.current.endTemporaryChat());
    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.temporaryChatUsed).toBe(true);

    let restartError: unknown;
    await act(async () => {
      restartError = await result.current.startTemporaryChat().then(
        () => null,
        (cause: unknown) => cause,
      );
    });
    expect(restartError).toBeInstanceOf(Error);
    expect((restartError as Error).message).toMatch(/one-use|already|again|content/i);
    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.some((session) => (
      session.key === gateway.ephemeralSessions[0]?.sessionKey
    ))).toBe(false);
    unmount();
  });

  it("allows an unused empty private chat to be toggled back on after it ends", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    await act(async () => result.current.startTemporaryChat());
    expect(result.current.temporaryChatActive).toBe(true);
    await act(async () => result.current.endTemporaryChat());
    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));

    await act(async () => result.current.startTemporaryChat());
    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(2);
    expect(result.current.temporaryChatActive).toBe(true);
    unmount();
  });

  it("does not resurrect a used private session when the gateway list is refreshed", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* (message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: `${message} reply` };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    await act(async () => result.current.sendMessage("private turn"));
    await act(async () => result.current.endTemporaryChat());
    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.sessions.some((session) => session.key === ephemeralSession.sessionKey)).toBe(false);

    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main Session", updatedAt: 2 },
      { key: ephemeralSession.sessionKey, title: "Private chat", messageCount: 2, updatedAt: 3 },
    ]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(result.current.sessions.some((session) => session.key === ephemeralSession.sessionKey)).toBe(false);
    expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]);
    unmount();
  });

  it("does not hydrate a private session from the gateway list after a remount", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const first = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await waitFor(() => expect(first.result.current.sessionsFetched).toBe(true));
    await act(async () => first.result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    expect(first.result.current.temporaryChatActive).toBe(true);
    first.unmount();
    expect(ephemeralSession.close).toHaveBeenCalled();

    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main Session", updatedAt: 2 },
      { key: ephemeralSession.sessionKey, title: "Private chat", messageCount: 0, updatedAt: 3 },
    ]);
    const second = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(second.result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(second.result.current.sessions.map((session) => session.key)).toEqual(["main"]));

    expect(second.result.current.sessions.some((session) => session.key === ephemeralSession.sessionKey)).toBe(false);
    expect(second.result.current.temporaryChatActive).toBe(false);
    expect(window.localStorage.getItem("openclaw.sessions.v1:agent-1") ?? "").not.toContain(ephemeralSession.sessionKey);
    expect(window.localStorage.getItem("openclaw.sessionTitles.v1:agent-1") ?? "").not.toContain(ephemeralSession.sessionKey);
    second.unmount();
  });

  it("keeps the destination transcript and draft intact when a private chat ends on session switch", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha", updatedAt: 2 },
      { key: "session-beta", title: "Beta", updatedAt: 1 },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string): Promise<unknown[]> => (
      sessionKey === "session-beta" ? [{ role: "user", content: "beta history", timestamp: 5 }] : []
    ));
    gateway.chatSend.mockImplementation(async function* (message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: `${message} reply` };
      yield { type: "done" };
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    rerender({ sessionKey: "session-beta" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.messages.some((message) => message.content === "beta history")).toBe(true));
    act(() => result.current.setInput("beta draft"));

    rerender({ sessionKey: "session-alpha" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    await act(async () => result.current.sendMessage("private while beta has a draft"));

    rerender({ sessionKey: "session-beta" });

    await waitFor(() => expect(ephemeralSession.close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.activeSessionKey).toBe("session-beta");
    await waitFor(() => expect(result.current.messages.some((message) => message.content === "beta history")).toBe(true));
    expect(result.current.messages.some((message) => message.content.includes("private while beta has a draft"))).toBe(false);
    expect(result.current.input).toBe("beta draft");
    unmount();
  });

  it("closes and consumes a used ephemeral lease when the gateway connection drops", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await act(async () => result.current.startTemporaryChat());
    const ephemeralSession = gateway.ephemeralSessions[0];
    expect(result.current.temporaryChatActive).toBe(true);
    await act(async () => result.current.sendMessage("private content"));

    act(() => gateway.emitConnectionState("disconnected"));

    await waitFor(() => expect(result.current.temporaryChatActive).toBe(false));
    expect(result.current.temporaryChatUsed).toBe(true);
    expect(ephemeralSession.close).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.some((session) => session.key === ephemeralSession.sessionKey)).toBe(false);
    unmount();
  });

  it("leaves no ghost row and allows a fresh retry when private start fails", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main Session", updatedAt: 1 }]);
    gateway.createEphemeralChatSession.mockRejectedValueOnce(new Error("gateway rejected ephemeral session"));
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let startError: unknown;
    await act(async () => {
      startError = await result.current.startTemporaryChat().then(
        () => null,
        (cause: unknown) => cause,
      );
    });
    expect(startError).toBeInstanceOf(Error);
    expect((startError as Error).message).toContain("gateway rejected ephemeral session");
    expect(result.current.temporaryChatState).toBe("inactive");
    expect(result.current.temporaryChatActive).toBe(false);
    expect(result.current.temporaryChatError).toBeTruthy();
    expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]);

    await act(async () => result.current.startTemporaryChat());
    expect(gateway.createEphemeralChatSession).toHaveBeenCalledTimes(2);
    expect(result.current.temporaryChatActive).toBe(true);
    expect(result.current.activeSessionKey).toBe(gateway.ephemeralSessions[0]?.sessionKey);
    expect(result.current.sessions.every((session) => !session.key.includes("ephemeral") || (
      session.key === gateway.ephemeralSessions[0]?.sessionKey
    ))).toBe(true);
    unmount();
  });

  it("exposes web login operations through the connected gateway", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" })),
      webLoginWait: vi.fn(async () => ({ connected: true, message: "Connected" })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      webLoginStart: vi.fn()
        .mockRejectedValueOnce(new Error("web login provider is not available"))
        .mockResolvedValueOnce({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" }),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(),
      configPatch: vi.fn(async () => undefined),
      waitReady: vi.fn(async () => ({})),
      webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan QR", qrDataUrl: "data:image/png;base64,cXI=" })),
    };
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
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

  it("does not activate WhatsApp during pairing; config is managed by the runtime image", async () => {
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string[]) => ({
        exitCode: 0,
        stdout: command.join(" ") === "openclaw plugins list --json"
          ? JSON.stringify({ plugins: [{ id: "whatsapp", installed: true, enabled: true, state: "enabled" }] })
          : "",
        stderr: "",
      })),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.whatsAppPairingStart()).rejects.toThrow(/managed by the runtime image/);
    });

    expect(gateway.configPatch).not.toHaveBeenCalled();
    expect(agent.exec.mock.calls.map(([command]) => command)).toEqual([["openclaw", "plugins", "list", "--json"]]);
    unmount();
  });

  it("rejects WhatsApp support setup because it is managed by the runtime image", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      waitReady: vi.fn(async () => ({})),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.ensureWhatsAppSupport()).rejects.toThrow(/managed by the runtime image/);
    });

    expect(agent.exec).not.toHaveBeenCalled();
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string[]) => {
        const display = command.join(" ");
        if (display === "openclaw plugins install @openclaw/slack") installed = true;
        return {
          exitCode: 0,
          stdout: display === "openclaw plugins list --json"
            ? JSON.stringify({ plugins: installed ? [{ id: "slack", installed: true, enabled: true }] : [] })
            : display === "openclaw plugins inspect slack --runtime --json"
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
      [["openclaw", "plugins", "list", "--json"], { timeout: 60 }],
      [["openclaw", "plugins", "install", "@openclaw/slack"], { timeout: 300 }],
      [["openclaw", "plugins", "enable", "slack"], { timeout: 60 }],
      [["openclaw", "plugins", "list", "--json"], { timeout: 60 }],
      [["openclaw", "gateway", "restart"], { timeout: 60 }],
      [["openclaw", "plugins", "inspect", "slack", "--runtime", "--json"], { timeout: 60 }],
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      exec: vi.fn(async (command: string[]) => ({
        exitCode: 0,
        stdout: command.join(" ") === "openclaw plugins inspect slack --runtime --json"
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
      ["openclaw", "plugins", "list", "--json"],
      ["openclaw", "gateway", "restart"],
      ["openclaw", "plugins", "inspect", "slack", "--runtime", "--json"],
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      await expect(
        result.current.connectorsProvider?.configure("telegram", { enabled: true, dmPolicy: "allowlist" }),
      ).rejects.toThrow(/read-only in hosted mode/);
      await result.current.connectorsProvider?.approveAuthorization?.({
        connectorId: "telegram",
        protocol: "short-code",
        code: "ABCD2345",
      });
    });
    expect(gateway.configPatch).not.toHaveBeenCalled();
    expect(agent.exec).toHaveBeenCalledWith(
      ["openclaw", "pairing", "approve", "telegram", "ABCD2345"],
      { timeout: 120 },
    );
    unmount();
  });

  it("rejects connector approval when the OpenClaw command exits unsuccessfully", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      ["openclaw", "pairing", "approve", "telegram", "ABCD2345"],
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

      await act(async () => {
        const reader = readers[0]!;
        reader.result = "data:image/png;base64,aW1hZ2U=";
        reader.onload?.({} as ProgressEvent<FileReader>);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.pendingAttachmentReads).toBe(0);
        expect(result.current.pendingAttachments).toEqual([
          {
            type: "image",
            mimeType: "image/png",
            content: "aW1hZ2U=",
            fileName: "preview.png",
          },
        ]);
      });
      unmount();
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("reports an unreadable inline image with its folder-relative name", async () => {
    const originalFileReader = globalThis.FileReader;
    type FileReaderHandler = ((event: ProgressEvent<FileReader>) => void) | null;
    const readers: Array<{
      error: DOMException | null;
      onerror: FileReaderHandler;
      readAsDataURL: ReturnType<typeof vi.fn>;
    }> = [];
    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: FileReaderHandler = null;
      onloadend: FileReaderHandler = null;
      onerror: FileReaderHandler = null;
      onabort: FileReaderHandler = null;
      readAsDataURL = vi.fn(() => {
        readers.push(this);
      });
    }
    vi.stubGlobal("FileReader", FailingFileReader);

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(null, false));
      const file = new File(["image"], "photo.png", { type: "image/png" });
      let preparation: ReturnType<typeof result.current.addAttachments> | undefined;
      act(() => {
        preparation = result.current.addAttachments([file], ["photos/photo.png"]);
      });
      expect(readers).toHaveLength(1);

      let prepared: Awaited<NonNullable<typeof preparation>> | undefined;
      await act(async () => {
        const reader = readers[0]!;
        reader.error = new DOMException("File disappeared", "NotFoundError");
        reader.onerror?.({} as ProgressEvent<FileReader>);
        prepared = await preparation;
      });

      expect(prepared?.failures).toEqual([{
        name: "photos/photo.png",
        message: 'Could not read "photos/photo.png": File disappeared',
      }]);
      expect(result.current.pendingAttachmentReads).toBe(0);
      expect(result.current.pendingAttachments).toEqual([]);
      unmount();
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("prepares large image selections with bounded readers and preserves selection order", async () => {
    const originalFileReader = globalThis.FileReader;
    type FileReaderHandler = ((event: ProgressEvent<FileReader>) => void) | null;
    const readers: Array<{
      file: File | null;
      result: string | ArrayBuffer | null;
      onload: FileReaderHandler;
    }> = [];
    class DeferredFileReader {
      file: File | null = null;
      result: string | ArrayBuffer | null = null;
      onload: FileReaderHandler = null;
      onloadend: FileReaderHandler = null;
      onerror: FileReaderHandler = null;
      onabort: FileReaderHandler = null;
      readAsDataURL = vi.fn((file: File) => {
        this.file = file;
        readers.push(this);
      });
    }
    vi.stubGlobal("FileReader", DeferredFileReader);

    try {
      const { result, unmount } = renderHookWithClient(() => useOpenClawSession(null, false));
      const selectedFiles = Array.from({ length: 10 }, (_, index) => (
        new File([`image-${index}`], `image-${index}.png`, { type: "image/png" })
      ));

      act(() => {
        result.current.addAttachments(selectedFiles as unknown as FileList);
      });

      await waitFor(() => expect(readers).toHaveLength(4));
      const complete = async (batch: typeof readers) => {
        await act(async () => {
          for (const reader of [...batch].reverse()) {
            reader.result = `data:image/png;base64,${btoa(reader.file?.name ?? "")}`;
            reader.onload?.({} as ProgressEvent<FileReader>);
          }
          await Promise.resolve();
        });
      };

      await complete(readers.slice(0, 4));
      await waitFor(() => expect(readers).toHaveLength(8));
      await complete(readers.slice(4, 8));
      await waitFor(() => expect(readers).toHaveLength(10));
      await complete(readers.slice(8, 10));

      await waitFor(() => {
        expect(result.current.pendingAttachmentReads).toBe(0);
        expect(result.current.pendingAttachments.map((attachment) => attachment.fileName)).toEqual(
          selectedFiles.map((file) => file.name),
        );
      });
      unmount();
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("hydrates OpenClaw settings with read-only gateway config access", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({
      channels: { telegram: { enabled: true } },
      llm: { model: "old-model", temperature: 0.2 },
    });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      await result.current.channelsStatus(true, 2500);
    });
    expect(gateway.channelsStatus).toHaveBeenCalledWith(true, 2500);

    // Hosted surfaces must not write openclaw.json; only configGet reads are exposed.
    expect("saveConfig" in result.current).toBe(false);
    expect("saveFullConfig" in result.current).toBe(false);
    expect("saveFile" in result.current).toBe(false);
    expect(gateway.configGet).toHaveBeenCalledTimes(configGetCallsAfterHydrate);
    expect(gateway.configPatch).not.toHaveBeenCalled();
    expect(gateway.configSet).not.toHaveBeenCalled();

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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      await result.current.integrationsAuthStart({ integrationId: "github" });
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await expect(result.current.integrationsStatus({ integrationId: "github" })).resolves.toEqual({});
    await expect(result.current.integrationsStatus({ probe: true, integrationId: "github" })).resolves.toEqual({});
    unmount();
  });

  it("keeps the channel inventory untouched when a hosted config write is rejected", async () => {
    const gateway = buildGateway();
    gateway.channelsStatus.mockResolvedValue({ channels: { telegram: { configured: true, running: true } } });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.reportedChannelsReady).toBe(true));
    expect(result.current.reportedChannels).toEqual([
      expect.objectContaining({ channelId: "telegram", configured: true, running: true }),
    ]);

    await act(async () => {
      await expect(
        result.current.channelsProvider?.configure("telegram", { enabled: true }),
      ).rejects.toThrow(/read-only in hosted mode/);
    });

    expect(gateway.configPatch).not.toHaveBeenCalled();
    expect(result.current.reportedChannelsReady).toBe(true);
    expect(result.current.reportedChannels).toEqual([
      expect.objectContaining({ channelId: "telegram", configured: true, running: true }),
    ]);
    unmount();
  });

  it("forces a channel probe when hydrated saved configuration is missing from status", async () => {
    const gateway = buildGateway();
    gateway.configGet.mockResolvedValue({ channels: { slack: { enabled: true } } });
    gateway.channelsStatus.mockResolvedValue({ channels: {} });
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("resumes the latest existing user conversation instead of internal main", async () => {
    const gateway = buildGateway();
    const dashboardSessionKey = "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([
      {
        key: dashboardSessionKey,
        displayName: "Older conversation",
        updatedAt: 10,
      },
      {
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      },
    ]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => (
      sessionKey === dashboardSessionKey
        ? [{ role: "assistant", content: "User conversation restored" }]
        : []
    ));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.activeSessionSelectionResolved).toBe(true));
    await waitFor(() => expect(result.current.activeSessionKey).toBe(dashboardSessionKey));
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "User conversation restored" }),
    ]);
    expect(gateway.chatHistory).toHaveBeenLastCalledWith(dashboardSessionKey, 200);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:main", 200);
    expect(gateway.chatSend).not.toHaveBeenCalled();
    unmount();
  });

  it("streams chat through a new dashboard session when only internal main exists", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }, {
      key: "agent:default:heartbeat",
      updatedAt: 30,
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: activeSessionKey,
        clientDisplayName: "New Session",
        title: "New Session",
        messageCount: 0,
      }),
      expect.objectContaining({ key: "main", gatewaySessionKey: "agent:default:main" }),
    ]));
    expect(result.current.activeUnindexedInitialSession).toBeNull();
    expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: activeSessionKey });
    expect(result.current.creatingSessionKeys).not.toContain(activeSessionKey);

    act(() => {
      result.current.setInput("hello");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello", activeSessionKey, undefined);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:main", 200);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("agent:default:heartbeat", 200);
    expect(gateway.sendChat).not.toHaveBeenCalled();
    unmount();
  });

  it("reuses the materialized empty session instead of creating a second empty session", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.activeSessionSelectionResolved).toBe(true));
    const firstSessionKey = result.current.activeSessionKey;
    await waitFor(() => expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: firstSessionKey, title: "New Session", messageCount: 0 }),
    ])));
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);

    let secondSessionKey = "";
    await act(async () => {
      secondSessionKey = await result.current.createSession({ waitForCreation: true });
    });

    expect(secondSessionKey).toBe(firstSessionKey);
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.filter((session) => session.title === "New Session")).toEqual([
      expect.objectContaining({ key: firstSessionKey }),
    ]);
    expect(result.current.creatingSessionKeys).not.toContain(firstSessionKey);
    unmount();
  });

  it("reuses an existing eligible empty session instead of creating a duplicate", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-empty", title: "Empty", messageCount: 0, updatedAt: 5 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const sessionKeysBefore = result.current.sessions.map((session) => session.key);

    let reusedSessionKey = "";
    await act(async () => {
      reusedSessionKey = await result.current.createSession();
    });

    expect(reusedSessionKey).toBe("session-empty");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.sessions.map((session) => session.key)).toEqual(sessionKeysBefore);
    expect(result.current.sessions.filter((session) => session.key === "session-empty")).toHaveLength(1);
    expect(result.current.creatingSessionKeys).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}")).toEqual({});
    expect(result.current.activeSessionKey).toBe("main");
    unmount();
  });

  it("reuses the locally pending empty session from a first ordinary createSession call", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let firstCreation!: Promise<string>;
    let secondKey = "";
    await act(async () => {
      firstCreation = result.current.createSession();
      secondKey = await result.current.createSession();
    });
    const firstKey = await firstCreation;

    expect(firstKey).toMatch(/^dashboard:/);
    expect(secondKey).toBe(firstKey);
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.filter((session) => session.key === firstKey)).toHaveLength(1);
    expect(result.current.sessions.filter((session) => session.title === "New Session")).toHaveLength(1);

    await act(async () => {
      reset.resolve(`agent:default:${firstKey}`);
      await reset.promise;
    });

    let thirdKey = "";
    await act(async () => {
      thirdKey = await result.current.createSession();
    });

    expect(thirdKey).toBe(firstKey);
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.sessions.filter((session) => session.title === "New Session")).toHaveLength(1));
    unmount();
  });

  it("creates exactly one new session when every existing session already has messages", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main", messageCount: 7, updatedAt: 9 },
      { key: "session-full", title: "Full", messageCount: 4, updatedAt: 5 },
    ]);
    const release = deferred<void>();
    gateway.chatSend.mockImplementation((async function* () {
      await release.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-full"));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => {
      result.current.setInput("hello full");
    });
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: newSessionKey });
    expect(result.current.activeSessionKey).toBe("session-full");
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello full" }),
    ]);
    expect(result.current.sessions.filter((session) => session.key === newSessionKey)).toHaveLength(1);

    await act(async () => {
      release.resolve();
      await sendPromise;
    });
    expect(result.current.sending).toBe(false);
    unmount();
  });

  it("selects the first eligible empty session in the current session ordering", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-full", title: "Full", messageCount: 2, updatedAt: 9 },
      { key: "session-empty-b", title: "Empty B", messageCount: 0, updatedAt: 8 },
      { key: "session-empty-a", title: "Empty A", messageCount: 0, updatedAt: 7 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let reusedSessionKey = "";
    await act(async () => {
      reusedSessionKey = await result.current.createSession();
    });

    expect(reusedSessionKey).toBe("session-empty-b");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.sessions.map((session) => session.key)).toEqual([
      "main",
      "session-full",
      "session-empty-b",
      "session-empty-a",
    ]);
    unmount();
  });

  it("does not reuse read-only, ephemeral, subagent, or actively running empty sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-telegram", sourceChannelId: "telegram", messageCount: 0, updatedAt: 9 },
      { key: "session-hypercli-ephemeral-019789ab-cdef-4abc-8def-0123456789ab", title: "Private chat", messageCount: 0, updatedAt: 8 },
      { key: "session-spawned", title: "Spawned", spawnedBy: "run-9", messageCount: 0, updatedAt: 7 },
      { key: "session-running", title: "Running", status: "running", hasActiveRun: true, activeRunIds: ["run-1"], messageCount: 0, updatedAt: 6 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "session-telegram", readOnly: true }),
      expect.objectContaining({ key: "session-running", hasActiveRun: true }),
    ])));
    const sessionCountBefore = result.current.sessions.length;

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(result.current.sessions).toHaveLength(sessionCountBefore + 1);
    expect(result.current.sessions.filter((session) => session.key === newSessionKey)).toHaveLength(1);
    unmount();
  });

  it("does not reuse an empty session that has a local composer draft", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-empty", title: "Empty", messageCount: 0, updatedAt: 5 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-empty"));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => {
      result.current.setInput("drafted message in the empty session");
    });

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(newSessionKey).not.toBe("session-empty");
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.filter((session) => session.key === "session-empty")).toHaveLength(1);
    expect(result.current.input).toBe("drafted message in the empty session");
    unmount();
  });

  it("does not reuse an empty session with local live chat history, but picks the idle empty one", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-busy", title: "Busy", messageCount: 0, updatedAt: 9 },
      { key: "session-empty", title: "Empty", messageCount: 0, updatedAt: 5 },
    ]);
    gateway.chatSend.mockImplementation(async function* (_message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: "busy reply" };
      yield { type: "done" };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-busy"));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    await act(async () => {
      await result.current.sendMessage("question in busy session");
    });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "question in busy session" }),
    ])));

    let reusedSessionKey = "";
    await act(async () => {
      reusedSessionKey = await result.current.createSession();
    });

    expect(reusedSessionKey).toBe("session-empty");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.sessions.filter((session) => session.key === "session-busy")).toHaveLength(1);
    expect(result.current.sessions.filter((session) => session.key === "session-empty")).toHaveLength(1);
    expect(result.current.activeSessionKey).toBe("session-busy");
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "question in busy session" }),
    ]));
    unmount();
  });

  it("does not reuse an empty session that still has cached chat history", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-empty", title: "Empty", messageCount: 0, updatedAt: 5 },
    ]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "user", content: "cached earlier message" },
    ] as any, "session-empty");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(newSessionKey).not.toBe("session-empty");
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.filter((session) => session.key === "session-empty")).toHaveLength(1);
    unmount();
  });

  it("still creates a fresh session for an initial message even when an eligible empty session exists", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main" },
      { key: "session-empty", title: "Empty", messageCount: 0, updatedAt: 5 },
    ]);
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession({ initialMessage: "Test skill in new session" });
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(newSessionKey).not.toBe("session-empty");
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(gateway.chatSend).not.toHaveBeenCalled();

    await act(async () => {
      reset.resolve(`agent:default:${newSessionKey}`);
      await reset.promise;
    });

    await waitFor(() => {
      expect(gateway.chatSend).toHaveBeenCalledWith(
        "Test skill in new session",
        `agent:default:${newSessionKey}`,
        undefined,
      );
    });
    expect(gateway.chatSend.mock.calls.map(([, sessionKey]) => sessionKey)).not.toContain("session-empty");
    unmount();
  });

  it("does not expose a provisional row for an arbitrary unindexed session route", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const sessionKey = "session-primary-focus";

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.activeSessionKey).toBe(sessionKey);
    expect(result.current.activeUnindexedInitialSession).toBeNull();
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it("materializes an unindexed dashboard route without adopting main", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.sessionsCreate.mockResolvedValue({ ok: true, key: "agent:default:main" });
    gateway.sessionsReset.mockImplementation(async (key: string) => `agent:default:${key}`);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey });
    expect(gateway.sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: sessionKey,
        gatewaySessionKey,
        title: "New Session",
      }),
    ]));

    act(() => {
      result.current.setInput("hello after refresh");
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("hello after refresh", gatewaySessionKey, undefined);
    expect(gateway.chatSend).not.toHaveBeenCalledWith("hello after refresh", "agent:default:main", undefined);
    unmount();
  });

  it("keeps cached history when an existing dashboard route is temporarily unindexed", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const history = deferred<unknown[]>();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockImplementation(async () => history.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();

    await act(async () => {
      history.resolve([{ role: "assistant", content: "Saved transcript" }]);
      await history.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    unmount();
  });

  it("keeps live in-memory history when an existing dashboard route is temporarily unindexed", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([
      { key: sessionKey, displayName: "Live route", messageCount: 1, updatedAt: 30 },
      {
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      },
    ]);
    gateway.chatSend.mockImplementation(async function* (_message: string): AsyncGenerator<ChatEvent, void, unknown> {
      yield { type: "content", text: "live reply" };
      yield { type: "done" };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    await act(async () => {
      await result.current.sendMessage("live question");
    });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "live question" }),
    ])));
    // No localStorage cache survives for this route in this scenario: the
    // in-memory live conversation is the only local transcript.
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([]);

    // The route disappears from the indexed list (indexing lag) and the
    // canonical history fetch stalls; the live transcript must survive.
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    const stalledHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async () => stalledHistory.promise);

    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(result.current.activeSessionKey).toBe(sessionKey);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "live question" }),
    ]));
    unmount();
  });

  it("keeps cached history when canonical history resolves empty for a temporarily unindexed dashboard route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    // Canonical history resolves empty while the route is unindexed. The
    // gateway has not confirmed the cached tail, so transcript stability
    // requires keeping the cached transcript rather than treating the
    // temporarily unindexed route as a fresh empty session.
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.historyPhase).toBe("error");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    unmount();
  });

  it("keeps cached history when a passive history refresh resolves empty for a temporarily unindexed dashboard route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:11111111-2222-4333-8444-555555555555";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    // The initial (connected-effect) canonical history stays pending so the
    // cache-restored transcript is still unconfirmed when the passive refresh
    // runs. The passive refresh then resolves empty while the route is still
    // absent from the fetched index.
    const initialHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async () => initialHistory.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    const historyCallsBeforePassive = gateway.chatHistory.mock.calls.length;

    // A terminal run event queues a passive history refresh; switch the
    // canonical history to resolve empty before the debounce fires.
    gateway.chatHistory.mockResolvedValue([]);
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey } });
    });

    // The passive completion refresh is debounced (100ms) before it issues
    // the canonical history request; wait for that request rather than
    // sleeping on the transcript assertion.
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforePassive));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    // The passive refresh path must honor the same cache-restored,
    // still-unindexed protection as the connected-effect path: the cached
    // transcript and its localStorage backup survive, the phase does not
    // report a ready empty transcript, and no create/reset occurs.
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(result.current.historyPhase).not.toBe("ready");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps cached history when a passive empty refresh contradicts a populated session index", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:22222222-3333-4444-8555-666666666666";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const indexedSession = {
      key: gatewaySessionKey,
      displayName: "Indexed populated route",
      messageCount: 1,
      updatedAt: 30,
    };
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    const initialHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async () => initialHistory.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved indexed transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);
    const historyCallsBeforePassive = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([]);
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });

    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforePassive));
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);

    gateway.sessionsList.mockResolvedValue([{ ...indexedSession, messageCount: 0 }]);
    await act(async () => {
      await result.current.refreshSessions();
    });
    const historyCallsBeforeConfirmedEmpty = gateway.chatHistory.mock.calls.length;
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeConfirmedEmpty));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([]);
    unmount();
  });

  it("keeps cached history when sequence-gap recovery resolves empty for a temporarily unindexed dashboard route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:66666666-7777-4888-8999-000000000000";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    // Initial canonical history stays pending so the cache-restored
    // transcript is unconfirmed when gap recovery runs.
    const initialHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async () => initialHistory.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    let gatewayOptions: {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn((options?: typeof gatewayOptions) => {
        gatewayOptions = options;
        return gateway;
      }),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();

    // Gap recovery fetches a fresh session list that still omits the route,
    // then rehydrates with an empty canonical history.
    const gapSessions = deferred<unknown[]>();
    gateway.sessionsList.mockImplementation(async () => gapSessions.promise);
    gateway.chatHistory.mockResolvedValue([]);
    expect(gatewayOptions?.onGap).toEqual(expect.any(Function));
    act(() => {
      gatewayOptions?.onGap?.({ expected: 4, received: 6 });
    });

    await act(async () => {
      gapSessions.resolve([{
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      }]);
      await gapSessions.promise;
    });
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    // Gap recovery must honor the cache-restored, still-unindexed protection:
    // the cached transcript and its localStorage backup survive and no
    // create/reset occurs.
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps cached history when gap recovery sees empty history for a populated indexed session", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:77777777-8888-4999-8aaa-bbbbbbbbbbbb";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const indexedSession = {
      key: gatewaySessionKey,
      displayName: "Indexed populated route",
      messageCount: 1,
      updatedAt: 30,
    };
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    const initialHistory = deferred<unknown[]>();
    gateway.chatHistory.mockImplementation(async () => initialHistory.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved indexed transcript" },
    ], sessionKey);
    let gatewayOptions: {
      onGap?: (info: { expected: number; received: number }) => void;
    } | undefined;
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn((options?: typeof gatewayOptions) => {
        gatewayOptions = options;
        return gateway;
      }),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    gateway.chatHistory.mockResolvedValue([]);
    expect(gatewayOptions?.onGap).toEqual(expect.any(Function));
    act(() => {
      gatewayOptions?.onGap?.({ expected: 4, received: 6 });
    });

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved indexed transcript" }),
    ]);
    unmount();
  });

  it("keeps cached history when canonical history fails for a temporarily unindexed dashboard route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockRejectedValue(new Error("history unavailable"));
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.historyPhase).toBe("error");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    unmount();
  });

  it("does not materialize an unindexed dashboard route whose cache payload is not a valid conversation", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    const cacheKey = openClawChatHistoryCacheKey("deploy-123", sessionKey);
    expect(cacheKey).toBeTruthy();
    window.localStorage.setItem(cacheKey!, "not-json");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey }));
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
    unmount();
  });

  it.each([
    {
      name: "a wrong cache payload version",
      write: (cacheKey: string) => {
        window.localStorage.setItem(cacheKey, JSON.stringify({
          version: 999,
          updatedAt: Date.now(),
          messages: [{ role: "assistant", content: "stale transcript" }],
        }));
      },
    },
    {
      name: "cache entries without valid conversation messages",
      write: (cacheKey: string) => {
        window.localStorage.setItem(cacheKey, JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          messages: [
            { role: "tool", content: "tool frames are not a conversation" },
            { role: "assistant", content: 42 },
          ],
        }));
      },
    },
  ])("does not treat $name as a conversation for an unindexed dashboard route", async ({ write }) => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    const cacheKey = openClawChatHistoryCacheKey("deploy-123", sessionKey);
    expect(cacheKey).toBeTruthy();
    write(cacheKey!);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey }));
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("does not create or reset when a temporarily unindexed dashboard route is indexed after a delayed refresh", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Saved transcript" }]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);

    // The delayed index update now includes the route: still no
    // create/reset, and the transcript is unchanged.
    gateway.sessionsList.mockResolvedValue([
      { key: sessionKey, displayName: "Indexed route", messageCount: 1, updatedAt: 30 },
      {
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      },
    ]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    await waitFor(() => expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: sessionKey }),
    ])));
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.historyPhase).toBe("ready");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    unmount();
  });

  it("accepts authoritative empty history after a cache-restored dashboard route becomes indexed", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:22222222-3333-4444-8555-666666666666";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.historyPhase).toBe("error"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    const historyCallsBeforeIndexing = gateway.chatHistory.mock.calls.length;

    gateway.sessionsList.mockResolvedValue([
      { key: gatewaySessionKey, displayName: "Indexed route", messageCount: 0, updatedAt: 30 },
      {
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      },
    ]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeIndexing));
    expect(gateway.chatHistory).toHaveBeenCalledWith(gatewaySessionKey, 200);
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: gatewaySessionKey }),
    ]));
    expect(result.current.messages).toEqual([]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps cache-restored history when an indexed populated session briefly returns empty", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:33333333-4444-4555-8666-777777777777";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    gateway.sessionsList.mockResolvedValue([{
      key: gatewaySessionKey,
      displayName: "Indexed populated route",
      messageCount: 2,
      updatedAt: 30,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "user", content: "Saved question" },
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(gateway.chatHistory).toHaveBeenCalledWith(gatewaySessionKey, 200);
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Saved question" }),
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "user", content: "Saved question" }),
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);

    const historyCallsBeforeRecovery = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Canonical question" },
      { role: "assistant", content: "Canonical transcript" },
    ]);
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeRecovery));
    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual([
      "Canonical question",
      "Canonical transcript",
    ]));
    unmount();
  });

  it("keeps cache-restored history when the session index omits message count", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:33333333-4444-4555-8666-888888888888";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    gateway.sessionsList.mockResolvedValue([{
      key: gatewaySessionKey,
      displayName: "Indexed route with unknown count",
      updatedAt: 30,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript with unknown count" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Saved transcript with unknown count" }),
    ]);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ content: "Saved transcript with unknown count" }),
    ]);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    unmount();
  });

  it("accepts empty history for a populated index when there is no cached transcript", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:44444444-5555-4666-8777-888888888888";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    gateway.sessionsList.mockResolvedValue([{
      key: gatewaySessionKey,
      displayName: "Indexed route without local history",
      messageCount: 2,
      updatedAt: 30,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([]);
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([]);
    unmount();
  });

  it("restores a legacy scoped alias when populated indexed history briefly resolves empty", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const legacyCacheKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent("deploy-123"),
      "session",
      encodeURIComponent(gatewaySessionKey),
    ].join(":");
    window.localStorage.setItem(legacyCacheKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "Legacy scoped transcript" }],
    }));
    gateway.sessionsList.mockResolvedValue([{
      key: gatewaySessionKey,
      displayName: "Indexed legacy route",
      messageCount: 1,
      updatedAt: 30,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Legacy scoped transcript" }),
    ]);
    expect(window.localStorage.getItem(legacyCacheKey)).toBeNull();
    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Legacy scoped transcript" }),
    ]);
    unmount();
  });

  it("clears mounted history when the session index and gateway confirm a reset", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:55555555-6666-4777-8888-999999999999";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const indexedSession = {
      key: gatewaySessionKey,
      displayName: "Resettable indexed route",
      updatedAt: 30,
    };
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Question before reset" },
      { role: "assistant", content: "Answer before reset" },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question before reset",
      "Answer before reset",
    ]);
    gateway.sessionsList.mockResolvedValue([{ ...indexedSession, message_count: "0" }]);
    await act(async () => {
      await result.current.refreshSessions();
    });
    gateway.chatHistory.mockResolvedValue([]);
    const historyCallsBeforeReset = gateway.chatHistory.mock.calls.length;
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });

    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeReset));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.historyPhase).toBe("ready");
    unmount();
  });

  it("keeps mounted history when an empty refresh has no explicit indexed message count", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:55555555-6666-4777-8888-aaaaaaaaaaaa";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const indexedSession = {
      key: gatewaySessionKey,
      displayName: "Indexed route with optional count",
      messageCount: 0,
      updatedAt: 30,
    };
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Question before uncertain refresh" },
      { role: "assistant", content: "Answer before uncertain refresh" },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    gateway.sessionsList.mockResolvedValue([{
      key: gatewaySessionKey,
      displayName: "Indexed route with optional count",
      updatedAt: 30,
    }]);
    await act(async () => {
      await result.current.refreshSessions();
    });
    const emptyRefresh = deferred<unknown[]>();
    gateway.chatHistory.mockReturnValue(emptyRefresh.promise);
    const historyCallsBeforeRefresh = gateway.chatHistory.mock.calls.length;
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeRefresh));
    await act(async () => {
      emptyRefresh.resolve([]);
      await emptyRefresh.promise;
    });

    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question before uncertain refresh",
      "Answer before uncertain refresh",
    ]);
    expect(result.current.historyPhase).toBe("ready");
    unmount();
  });

  it("does not clear a live message that arrives during an authoritative-empty refresh", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:66666666-7777-4888-8999-aaaaaaaaaaaa";
    const gatewaySessionKey = `agent:default:${sessionKey}`;
    const indexedSession = {
      key: gatewaySessionKey,
      displayName: "Concurrently updated route",
      messageCount: 2,
      updatedAt: 30,
    };
    gateway.sessionsList.mockResolvedValue([indexedSession]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Question before refresh" },
      { role: "assistant", content: "Answer before refresh" },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    gateway.sessionsList.mockResolvedValue([{ ...indexedSession, messageCount: 0, updatedAt: 40 }]);
    await act(async () => {
      await result.current.refreshSessions();
    });
    const emptyRefresh = deferred<unknown[]>();
    gateway.chatHistory.mockReturnValue(emptyRefresh.promise);
    const historyCallsBeforeRefresh = gateway.chatHistory.mock.calls.length;
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: gatewaySessionKey } });
    });
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeRefresh));

    act(() => {
      gateway.emit({
        event: "chat.content",
        payload: {
          sessionKey: gatewaySessionKey,
          messageId: "message-during-refresh",
          text: "Live answer during refresh",
        },
      });
      emptyRefresh.resolve([]);
    });
    await act(async () => {
      await emptyRefresh.promise;
    });

    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "Live answer during refresh" }),
    ])));
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "Question before refresh" }),
      expect.objectContaining({ content: "Answer before refresh" }),
      expect.objectContaining({ content: "Live answer during refresh" }),
    ]));
    unmount();
  });

  it("does not let cached history from another agent suppress materializing the same new route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-other", [
      { role: "assistant", content: "Another agent transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey }));
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("does not let cached history from another session suppress materializing a genuinely new route", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const otherSessionKey = "dashboard:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockResolvedValue([]);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Sibling session transcript" },
    ], otherSessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, sessionKey)
    ));

    await waitFor(() => expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey }));
    expect(gateway.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledTimes(1);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("keeps the restored transcript stable across rerenders while canonical history is pending", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const history = deferred<unknown[]>();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:main",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      updatedAt: 20,
    }]);
    gateway.chatHistory.mockImplementation(async () => history.promise);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "assistant", content: "Saved transcript" },
    ], sessionKey);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ requestedKey }: { requestedKey: string }) => useOpenClawSession(agent as any, true, requestedKey),
      { initialProps: { requestedKey: sessionKey } },
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);

    // Rerender with an equivalent requested-key prop identity while the
    // canonical history fetch is still pending.
    rerender({ requestedKey: ` ${sessionKey} ` });
    rerender({ requestedKey: sessionKey });

    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);

    await act(async () => {
      history.resolve([{ role: "assistant", content: "Saved transcript" }]);
      await history.promise;
    });
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Saved transcript" }),
    ]);
    unmount();
  });

  it("does not materialize the internal main session when its route is unindexed without local history", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, "main")
    ));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.activeSessionKey).toBe("main");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    unmount();
  });

  it("restores the active initial row when the indexed record is temporarily omitted", async () => {
    const gateway = buildGateway();
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const sessionKey = result.current.activeSessionKey;
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: sessionKey, title: "New Session" }),
    ]));
    expect(result.current.activeUnindexedInitialSession).toBeNull();
    gateway.sessionsList.mockResolvedValue([{
      key: `agent:default:${sessionKey}`,
      displayName: "Release planning",
      updatedAt: 20,
      messageCount: 1,
    }]);

    await act(async () => {
      await result.current.refreshSessions();
    });

    await waitFor(() => expect(result.current.activeUnindexedInitialSession).toBeNull());
    expect(result.current.sessions).toEqual([
      expect.objectContaining({
        key: `agent:default:${sessionKey}`,
        clientDisplayName: "Release planning",
      }),
    ]);

    gateway.sessionsList.mockResolvedValue([]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.activeUnindexedInitialSession).toEqual(expect.objectContaining({
      key: sessionKey,
      title: "New Session",
    }));
    unmount();
  });

  it("sends a staged image collection as one manifest reference without hidden agent turns", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const collectionFile = {
      name: "image-collection-13.json",
      path: "/home/node/.openclaw/workspace/.hypercli/chat-image-collections/test/image-collection-13.json",
      type: "application/json",
      imageCollection: {
        count: 13,
        manifestPath: "/home/node/.openclaw/workspace/.hypercli/chat-image-collections/test/image-collection-13.json",
        manifestUploadPath: ".openclaw/workspace/.hypercli/chat-image-collections/test/image-collection-13.json",
        uploadPaths: Array.from(
          { length: 13 },
          (_, index) => `.openclaw/workspace/.hypercli/chat-image-collections/test/image-${index + 1}.png`,
        ),
      },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

    act(() => {
      result.current.setInput("Find duplicate screenshots and summarize the differences.");
      result.current.addPendingFiles([collectionFile]);
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    const [message, sessionKey, attachments] = gateway.chatSend.mock.calls.at(-1)!;
    expect(sessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);
    expect(attachments).toBeUndefined();
    expect(message).toBe(`file: ${collectionFile.path}\n\nFind duplicate screenshots and summarize the differences.`);
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "Find duplicate screenshots and summarize the differences.",
        files: [collectionFile],
      }),
    ]));
    unmount();
  });

  it("keeps staged collection files with a message queued behind an active reply", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const firstReply = deferred<void>();
    gateway.chatSend.mockImplementation((async function* (message: string) {
      if (message === "First message") await firstReply.promise;
      yield { type: "done" as const };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const collectionFile = {
      name: "image-collection-100.json",
      path: "/home/node/.openclaw/workspace/.hypercli/chat-image-collections/queued/image-collection-100.json",
      type: "application/json",
      imageCollection: {
        count: 100,
        manifestPath: "/home/node/.openclaw/workspace/.hypercli/chat-image-collections/queued/image-collection-100.json",
        manifestUploadPath: ".openclaw/workspace/.hypercli/chat-image-collections/queued/image-collection-100.json",
        uploadPaths: [],
      },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

    let firstSend: Promise<void> | undefined;
    act(() => {
      firstSend = result.current.sendMessage("First message");
    });
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => {
      result.current.setInput("Compare these screenshots.");
      result.current.addPendingFiles([collectionFile]);
    });
    await waitFor(() => expect(result.current.pendingFiles).toEqual([collectionFile]));
    act(() => {
      result.current.addPendingMessage(result.current.input, {
        files: result.current.pendingFiles,
        consumeDraft: true,
      });
    });

    expect(result.current.input).toBe("");
    expect(result.current.pendingFiles).toEqual([]);
    expect(result.current.pendingInput).toEqual(["Compare these screenshots."]);

    await act(async () => {
      firstReply.resolve();
      await firstSend;
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(2));
    expect(gateway.chatSend.mock.calls[1]?.slice(0, 3)).toEqual([
      `file: ${collectionFile.path}\n\nCompare these screenshots.`,
      activeSessionKey,
      undefined,
    ]);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("waits for the session catalog before hydrating an unresolved session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Session history" }]);
    const freshSessions = deferred<unknown[]>();
    gateway.sessionsList.mockReturnValue(freshSessions.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));
    expect(result.current.messages).toEqual([]);
    expect(result.current.historyPhase).toBe("loading");
    expect(result.current.activeSessionCanSend).toBe(false);
    expect(result.current.sessionsFetched).toBe(false);
    expect(gateway.chatHistory).not.toHaveBeenCalled();

    await act(async () => {
      freshSessions.resolve([{
        key: "session-alpha",
        gatewaySessionKey: "gateway-alpha",
        title: "Session Alpha",
        lastMessageAt: 20,
      }]);
      await freshSessions.promise;
    });

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Session history"]));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.historyPhase).toBe("ready");
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-alpha", 200);
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Session Alpha" }),
    ]);
    unmount();
  });

  it("filters heartbeat sessions and preview-like values from session names", async () => {
    window.localStorage.setItem("openclaw.sessionTitles.v1:deploy-123", JSON.stringify({
      main: "HEARTBEAT",
      "session-alpha": "Read HEARTBEAT.md if it exists",
    }));
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "HEARTBEAT", clientDisplayName: "HEARTBEAT_OK" },
      { key: "agent:default:heartbeat", updatedAt: 2 },
      { key: "session-alpha", summary: "Leaked chat preview", lastMessageAt: 1 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("keeps chat ready but marks history pending while switching fetched sessions", async () => {
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    expect(result.current.historyPhase).toBe("loading");
    expect(result.current.historyPending).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(gateway.chatHistory).toHaveBeenCalledWith("session-beta", 200);

    await act(async () => {
      betaHistory.resolve([]);
      await betaHistory.promise;
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.connected).toBe(true);
    expect(result.current.hydrating).toBe(false);
    expect(result.current.historyPhase).toBe("ready");
    expect(result.current.historyPending).toBe(false);
    unmount();
  });

  it("loads sessions without full gateway hydration in sessions-only mode", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    expect(gateway.channelsStatus).not.toHaveBeenCalled();
    unmount();
  });

  it("makes chat history ready before secondary gateway data in chat mode", async () => {
    const gateway = buildGateway();
    const config = deferred<Record<string, unknown>>();
    gateway.configGet.mockReturnValue(config.promise);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "History first" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => (
      useOpenClawSession(agent as any, true, "main", { hydrationMode: "chat" })
    ));

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["History first"]));
    expect(result.current.ready).toBe(true);
    expect(result.current.connected).toBe(true);
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.config).toBeNull();
    expect(gateway.chatHistory.mock.invocationCallOrder[0]).toBeLessThan(gateway.configGet.mock.invocationCallOrder[0]!);
    expect(gateway.filesList).not.toHaveBeenCalled();

    await act(async () => {
      config.resolve({ llm: { model: "history-first-model" } });
      await config.promise;
    });
    await waitFor(() => expect(result.current.config).toEqual({ llm: { model: "history-first-model" } }));
    expect(gateway.filesList).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("publishes completed background hydration after returning to chat mode", async () => {
    const gateway = buildGateway();
    const config = deferred<Record<string, unknown>>();
    const initialHistory = deferred<unknown[]>();
    gateway.configGet.mockReturnValue(config.promise);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    gateway.chatHistory.mockReturnValue(initialHistory.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ hydrationMode }: { hydrationMode: "chat" | "sessions" }) => (
        useOpenClawSession(agent as any, true, "main", { hydrationMode })
      ),
      { initialProps: { hydrationMode: "chat" as "chat" | "sessions" } },
    );

    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalled());
    await waitFor(() => expect(gateway.configGet).toHaveBeenCalledTimes(1));
    rerender({ hydrationMode: "sessions" });
    await act(async () => {
      config.resolve({ llm: { model: "background-model" } });
      initialHistory.resolve([]);
      await config.promise;
      await initialHistory.promise;
    });
    expect(result.current.config).toBeNull();

    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Recovered history" }]);
    rerender({ hydrationMode: "chat" });

    await waitFor(() => expect(result.current.config).toEqual({ llm: { model: "background-model" } }));
    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["Recovered history"]));
    unmount();
  });

  it("buffers live transcript events without publishing React state in sessions-only mode", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    const history = deferred<unknown[]>();
    gateway.chatHistory.mockReturnValue(history.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    let renders = 0;
    const { result, rerender, unmount } = renderHookWithClient(
      ({ hydrationMode }: { hydrationMode: "full" | "sessions" }) => {
        renders += 1;
        return useOpenClawSession(agent as any, true, "main", { hydrationMode });
      },
      { initialProps: { hydrationMode: "sessions" } },
    );

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    const rendersBeforeContent = renders;
    act(() => {
      gateway.emit({ event: "chat.content", payload: { sessionKey: "main", text: "Hidden live reply" } });
    });

    expect(result.current.messages).toEqual([]);
    expect(renders).toBe(rendersBeforeContent);

    rerender({ hydrationMode: "full" });
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Hidden live reply" }),
    ]));

    await act(async () => {
      history.resolve([]);
      await history.promise;
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Hidden live reply" }),
    ]);
    expect(result.current.historyPhase).toBe("error");
    expect(result.current.activeSessionCanSend).toBe(false);
    unmount();
  });

  it("does not cache the previous agent transcript after a sessions-only agent switch", async () => {
    const firstGateway = buildGateway();
    firstGateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 10 }]);
    firstGateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "First agent history" }]);
    const secondGateway = buildGateway();
    secondGateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main", lastMessageAt: 20 }]);
    const firstAgent = {
      id: "agent-first",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => firstGateway),
    };
    const secondAgent = {
      id: "agent-second",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => secondGateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ agent, hydrationMode }: { agent: typeof firstAgent; hydrationMode: "full" | "sessions" }) => (
        useOpenClawSession(agent as any, true, "main", { hydrationMode })
      ),
      { initialProps: { agent: firstAgent, hydrationMode: "full" as "full" | "sessions" } },
    );

    await waitFor(() => expect(result.current.messages.map((message) => message.content)).toEqual(["First agent history"]));
    await waitFor(() => expect(readCachedOpenClawChatHistory("agent-first").map((message) => message.content)).toEqual(["First agent history"]));

    rerender({ agent: secondAgent, hydrationMode: "sessions" });
    await waitFor(() => expect(secondGateway.sessionsList).toHaveBeenCalled());
    expect(result.current.messages).toEqual([]);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(readCachedOpenClawChatHistory("agent-second")).toEqual([]);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main", { hydrationMode: "sessions" }));

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey }),
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("restores an active response and buffered text after reload, then clears on completion", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      title: "Alpha",
      status: active ? "running" : "done",
      hasActiveRun: active,
      activeRunIds: active ? ["run-reload"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Long-running request" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
          inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
        } as any
      : {
          messages: [
            { role: "user", content: "Long-running request" },
            { role: "assistant", content: "Buffered partial response", runId: "run-reload" },
          ],
          sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({ role: "assistant", content: "Buffered partial response", runId: "run-reload" }),
    ]);

    active = false;
    act(() => gateway.emit({ event: "chat.done", payload: { sessionKey: "session-alpha", runId: "run-reload" } }));

    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    await waitFor(() => expect(result.current.thinkingSessionKeys).toEqual([]));
    unmount();
  });

  it("merges cached tool and reasoning activity into an adopted run after reload", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "session-alpha",
      title: "Alpha",
      status: "running",
      hasActiveRun: true,
      activeRunIds: ["run-reload"],
      messageCount: 1,
    }] as any);
    gateway.chatHistoryResult.mockResolvedValue({
      messages: [{ role: "user", content: "Inspect the workspace" }],
      sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
    } as any);
    writeCachedOpenClawChatHistory("deploy-123", [
      { role: "user", content: "Inspect the workspace", renderId: "cached-user" },
      {
        role: "assistant",
        content: "",
        renderId: "cached-activity",
        runId: "run-reload",
        reasoning: {
          text: "Checking the workspace structure",
          state: "active",
          startedAt: 10,
        },
        toolCalls: [{
          id: "tool-1",
          name: "functions.read",
          args: "{\"path\":\"README.md\"}",
          result: "Read complete",
        }],
      },
    ], "session-alpha");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Inspect the workspace" }),
      expect.objectContaining({
        role: "assistant",
        runId: "run-reload",
        reasoning: expect.objectContaining({ text: "Checking the workspace structure" }),
        toolCalls: [expect.objectContaining({ id: "tool-1", result: "Read complete" })],
      }),
    ]);
    unmount();
  });

  it("marks a buffered adopted response interrupted when the connection drops", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "session-alpha",
      title: "Alpha",
      status: "running",
      hasActiveRun: true,
      activeRunIds: ["run-reload"],
    }] as any);
    gateway.chatHistoryResult.mockResolvedValue({
      messages: [{ role: "user", content: "Long-running request" }],
      sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
      inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
    } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => {
      gateway.emitConnectionState("disconnected");
      gateway.emitConnectionState("connecting");
    });

    await waitFor(() => expect(result.current.status).toBe("connecting"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({
        role: "assistant",
        content: "Buffered partial response",
        runId: "run-reload",
        status: "interrupted",
      }),
    ]);
    unmount();
  });

  it("stops an active response adopted after reload", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "session-alpha",
      title: "Alpha",
      status: "running",
      hasActiveRun: true,
      activeRunIds: ["run-reload"],
    }] as any);
    gateway.chatHistoryResult.mockResolvedValue({
      messages: [{ role: "user", content: "Long-running request" }],
      sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
      inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
    } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    await act(async () => {
      await result.current.abortMessage();
    });

    expect(gateway.chatAbort).toHaveBeenCalledWith("session-alpha", "run-reload");
    expect(result.current.activeSessionSending).toBe(false);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({ role: "assistant", content: "Buffered partial response", status: "interrupted" }),
    ]);
    unmount();
  });

  it("keeps sibling runs active after aborting one adopted run", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let activeRunIds = ["run-reload", "run-sibling"];
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: activeRunIds.length > 0 ? "running" : "killed",
      hasActiveRun: activeRunIds.length > 0,
      activeRunIds,
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => ({
      messages: [
        { role: "user", content: "Long-running request" },
        { role: "assistant", content: "Buffered partial response", runId: "run-reload" },
        { role: "assistant", content: "Sibling response", runId: "run-sibling" },
      ],
      sessionInfo: {
        status: activeRunIds.length > 0 ? "running" : "killed",
        hasActiveRun: activeRunIds.length > 0,
        activeRunIds,
      },
      ...(activeRunIds.length > 0
        ? {
            inFlightRun: {
              runId: activeRunIds[0],
              text: activeRunIds[0] === "run-reload" ? "Buffered partial response" : "Sibling response",
            },
          }
        : {}),
    } as any));
    const firstAbortAck = deferred<void>();
    gateway.chatAbort.mockImplementation((_sessionKey?: string, runId?: string) => {
      activeRunIds = activeRunIds.filter((activeRunId) => activeRunId !== runId);
      return runId === "run-reload" ? firstAbortAck.promise : Promise.resolve();
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    let firstAbortPromise!: Promise<void>;
    act(() => {
      firstAbortPromise = result.current.abortMessage();
    });
    await waitFor(() => expect(result.current.aborting).toBe(true));
    act(() => gateway.emit({
      event: "chat.aborted",
      payload: { sessionKey: "session-alpha", runId: "run-reload" },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    await act(async () => {
      firstAbortAck.reject(new Error("late abort acknowledgement"));
      await firstAbortPromise;
    });

    expect(gateway.chatAbort).toHaveBeenNthCalledWith(1, "session-alpha", "run-reload");
    expect(result.current.activeSessionSending).toBe(true);
    await waitFor(() => expect(result.current.messages.find((message) => message.runId === "run-reload")).toEqual(
      expect.objectContaining({ role: "assistant", status: "interrupted" }),
    ));
    expect(result.current.messages.find((message) => message.runId === "run-sibling")?.status).toBeUndefined();
    expect(result.current.activityFeed).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "Stop failed" }),
    ]));

    await act(async () => result.current.abortMessage());

    expect(gateway.chatAbort).toHaveBeenNthCalledWith(2, "session-alpha", "run-sibling");
    expect(result.current.activeSessionSending).toBe(false);
    unmount();
  });

  it("keeps an adopted response interrupted when its abort event beats the acknowledgement", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: active ? "running" : "killed",
      hasActiveRun: active,
      activeRunIds: active ? ["run-reload"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Long-running request" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
          inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
        } as any
      : {
          messages: [
            { role: "user", content: "Long-running request" },
            { role: "assistant", content: "Buffered partial response", runId: "run-reload" },
          ],
          sessionInfo: { status: "killed", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const abortAck = deferred<void>();
    gateway.chatAbort.mockReturnValue(abortAck.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    let abortPromise!: Promise<void>;
    act(() => {
      abortPromise = result.current.abortMessage();
    });
    await waitFor(() => expect(result.current.aborting).toBe(true));
    active = false;
    act(() => gateway.emit({
      event: "chat",
      payload: { sessionKey: "session-alpha", runId: "run-reload", state: "aborted" },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));

    await act(async () => {
      abortAck.resolve();
      await abortPromise;
    });

    expect(result.current.aborting).toBe(false);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({ role: "assistant", content: "Buffered partial response", status: "interrupted" }),
    ]);
    unmount();
  });

  it("clears an adopted response when the gateway reports an error", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: active ? "running" : "error",
      hasActiveRun: active,
      activeRunIds: active ? ["run-reload"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Long-running request" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
          inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
        } as any
      : {
          messages: [
            { role: "user", content: "Long-running request" },
            { role: "assistant", content: "Buffered partial response", runId: "run-reload" },
          ],
          sessionInfo: { status: "error", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    active = false;
    act(() => gateway.emit({
      event: "chat",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-reload",
        state: "error",
        errorMessage: "Generation failed",
      },
    }));

    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: "Assistant response failed: Generation failed." }),
    ])));
    unmount();
  });

  it("keeps an adopted response active when another run in the session completes", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "session-alpha",
      status: "running",
      hasActiveRun: true,
      activeRunIds: ["run-reload", "run-other"],
    }] as any);
    gateway.chatHistoryResult.mockResolvedValue({
      messages: [{ role: "user", content: "Long-running request" }],
      sessionInfo: {
        status: "running",
        hasActiveRun: true,
        activeRunIds: ["run-reload", "run-other"],
      },
      inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
    } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-other" },
    }));
    expect(result.current.activeSessionSending).toBe(true);

    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-reload" },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    unmount();
  });

  it("keeps fallback replacement boundaries isolated between sibling runs", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let activeRunIds = ["run-a", "run-b"];
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: activeRunIds.length > 0 ? "running" : "done",
      hasActiveRun: activeRunIds.length > 0,
      activeRunIds,
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => ({
      messages: [
        { role: "user", content: "Run both" },
        { role: "assistant", content: "Failed A", runId: "run-a" },
        { role: "assistant", content: "Failed B", runId: "run-b" },
      ],
      sessionInfo: { status: "running", hasActiveRun: true, activeRunIds },
      inFlightRun: { runId: "run-a", text: "Failed A" },
    } as any));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => {
      gateway.emit({
        event: "agent",
        payload: {
          sessionKey: "session-alpha",
          runId: "run-a",
          seq: 2,
          stream: "lifecycle",
          data: { phase: "error", error: "provider A failed" },
        },
      });
      gateway.emit({
        event: "agent",
        payload: {
          sessionKey: "session-alpha",
          runId: "run-b",
          seq: 10,
          stream: "lifecycle",
          data: { phase: "error", error: "provider B failed" },
        },
      });
    });

    activeRunIds = ["run-a"];
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-b" },
    }));
    expect(result.current.activeSessionSending).toBe(true);

    act(() => gateway.emit({
      event: "chat",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-a",
        seq: 3,
        state: "delta",
        deltaText: "Fallback A",
        message: { role: "assistant", content: "Fallback A" },
      },
    }));

    await waitFor(() => expect(result.current.messages.find((message) => message.runId === "run-a")?.content)
      .toBe("Fallback A"));
    expect(result.current.activeSessionSending).toBe(true);
    unmount();
  });

  it("keeps unobserved sibling runs active when the observed run completes", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{
      key: "session-alpha",
      status: "running",
      hasActiveRun: true,
      activeRunIds: ["run-observed", "run-sibling"],
    }] as any);
    gateway.chatHistoryResult.mockResolvedValue({
      messages: [{ role: "user", content: "Run both tasks" }],
      sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
    } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.activeSessionSending).toBe(false);
    act(() => gateway.emit({
      event: "chat.content",
      payload: { sessionKey: "session-alpha", runId: "run-observed", text: "Observed partial" },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));

    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-observed" },
    }));

    expect(result.current.activeSessionSending).toBe(true);
    await waitFor(() => expect(result.current.sessions[0]?.activeRunIds).toEqual(["run-sibling"]));
    unmount();
  });

  it("keeps sessions-only activity until every reported run completes", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let activeRunIds = ["run-reload", "run-other"];
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: activeRunIds.length > 0 ? "running" : "done",
      hasActiveRun: activeRunIds.length > 0,
      activeRunIds,
    }] as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha", { hydrationMode: "sessions" }),
    );

    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    activeRunIds = ["run-reload"];
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-other" },
    }));
    await waitFor(() => expect(result.current.sessions[0]?.activeRunIds).toEqual(["run-reload"]));
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

    activeRunIds = [];
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-reload" },
    }));
    await waitFor(() => expect(result.current.thinkingSessionKeys).toEqual([]));
    expect(gateway.chatHistoryResult).not.toHaveBeenCalled();
    unmount();
  });

  it("refreshes an adopted response after switching away and back", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    let alphaActive = true;
    gateway.chatHistoryResult.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === "session-beta") {
        return {
          messages: [{ role: "assistant", content: "Beta history" }],
          sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
        } as any;
      }
      return alphaActive
        ? {
            messages: [{ role: "user", content: "Alpha request" }],
            sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-alpha"] },
            inFlightRun: { runId: "run-alpha", text: "Alpha partial" },
          } as any
        : {
            messages: [
              { role: "user", content: "Alpha request" },
              { role: "assistant", content: "Alpha complete", runId: "run-alpha" },
            ],
            sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
          } as any;
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    alphaActive = false;
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-alpha" },
    }));
    rerender({ sessionKey: "session-beta" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    rerender({ sessionKey: "session-alpha" });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Alpha request" }),
      expect.objectContaining({ role: "assistant", content: "Alpha complete" }),
    ]));
    expect(gateway.chatHistoryResult.mock.calls.filter(([key]) => key === "session-alpha").length).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it("does not re-adopt a stale active snapshot after a terminal event", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }] as any);
    const staleHistory = deferred<any>();
    let terminal = false;
    gateway.chatHistoryResult.mockImplementation(() => terminal
      ? Promise.resolve({
        messages: [
          { role: "user", content: "Long-running request" },
          { role: "assistant", content: "Completed response", runId: "run-reload" },
        ],
        sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
      } as any)
      : staleHistory.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(gateway.chatHistoryResult).toHaveBeenCalled());
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-reload" },
    }));
    terminal = true;
    await act(async () => {
      staleHistory.resolve({
        messages: [{ role: "user", content: "Long-running request" }],
        sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
        inFlightRun: { runId: "run-reload", text: "Stale partial response" },
      });
      await staleHistory.promise;
    });

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.activeSessionSending).toBe(false);
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({ role: "assistant", content: "Completed response" }),
    ]));
    unmount();
  });

  it("does not re-adopt a stale active snapshot requested after a terminal event", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      {
        key: "session-alpha",
        title: "Alpha",
        status: "running",
        hasActiveRun: true,
        activeRunIds: ["run-reload"],
      },
      { key: "session-beta", title: "Beta", status: "done", hasActiveRun: false, activeRunIds: [] },
    ] as any);
    let alphaHistoryCalls = 0;
    gateway.chatHistoryResult.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === "session-beta") {
        return {
          messages: [{ role: "assistant", content: "Beta history" }],
          sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
        } as any;
      }
      alphaHistoryCalls += 1;
      return {
        messages: [{ role: "user", content: "Long-running request" }],
        sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
        inFlightRun: { runId: "run-reload", text: "Stale partial response" },
      } as any;
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => gateway.emit({
      event: "chat.done",
      payload: { sessionKey: "session-alpha", runId: "run-reload" },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));

    rerender({ sessionKey: "session-beta" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    rerender({ sessionKey: "session-alpha" });
    await waitFor(() => expect(alphaHistoryCalls).toBeGreaterThanOrEqual(2));

    expect(result.current.activeSessionSending).toBe(false);
    unmount();
  });

  it("deduplicates live content that races an active history snapshot", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }] as any);
    const history = deferred<any>();
    gateway.chatHistoryResult.mockImplementation(() => history.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(gateway.chatHistoryResult).toHaveBeenCalled());
    act(() => gateway.emit({
      event: "chat.content",
      payload: { sessionKey: "session-alpha", runId: "run-reload", text: "Buffered response" },
    }));
    await act(async () => {
      history.resolve({
        messages: [{ role: "user", content: "Long-running request" }],
        sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
        inFlightRun: { runId: "run-reload", text: "Buffered response" },
      });
      await history.promise;
    });

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.messages.filter((message) => (
      message.role === "assistant" && message.content === "Buffered response"
    ))).toHaveLength(1);
    unmount();
  });

  it("keeps lifecycle progress active when an older history snapshot says idle", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }] as any);
    const history = deferred<any>();
    gateway.chatHistoryResult.mockImplementation(() => history.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(gateway.chatHistoryResult).toHaveBeenCalled());
    act(() => gateway.emit({
      event: "agent",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-lifecycle",
        stream: "lifecycle",
        data: { phase: "start", runId: "run-lifecycle" },
      },
    }));
    await act(async () => {
      history.resolve({
        messages: [{ role: "user", content: "Start work" }],
        sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
      });
      await history.promise;
    });

    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.activeSessionSending).toBe(true);
    unmount();
  });

  it("keeps an adopted run active through a provider lifecycle error", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: active ? "running" : "done",
      hasActiveRun: active,
      activeRunIds: active ? ["run-fallback"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Try every provider" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-fallback"] },
          inFlightRun: { runId: "run-fallback", text: "Draft" },
        } as any
      : {
          messages: [
            { role: "user", content: "Try every provider" },
            { role: "assistant", content: "Fallback complete", runId: "run-fallback" },
          ],
          sessionInfo: { status: "done", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    act(() => gateway.emit({
      event: "agent",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-fallback",
        seq: 2,
        stream: "lifecycle",
        data: { phase: "error", error: "first provider unavailable" },
      },
    }));

    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringMatching(/first provider unavailable/i) }),
    ]));

    act(() => gateway.emit({
      event: "chat",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-fallback",
        seq: 2,
        state: "delta",
        deltaText: " tail",
        message: { role: "assistant", content: "Draft tail" },
      },
    }));
    await waitFor(() => expect(result.current.messages.find((message) => message.runId === "run-fallback")?.content)
      .toBe("Draft tail"));

    act(() => gateway.emit({
      event: "chat",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-fallback",
        seq: 3,
        state: "delta",
        deltaText: "Draft",
        message: { role: "assistant", content: "Draft" },
      },
    }));
    await waitFor(() => expect(result.current.messages.find((message) => message.runId === "run-fallback")?.content)
      .toBe("Draft"));

    active = false;
    act(() => gateway.emit({
      event: "chat",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-fallback",
        seq: 4,
        state: "final",
        message: { role: "assistant", content: "Draft complete" },
      },
    }));
    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    unmount();
  });

  it("marks nested lifecycle cancellation interrupted without reporting an error", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let active = true;
    gateway.sessionsList.mockImplementation(async () => [{
      key: "session-alpha",
      status: active ? "running" : "killed",
      hasActiveRun: active,
      activeRunIds: active ? ["run-lifecycle"] : [],
    }] as any);
    gateway.chatHistoryResult.mockImplementation(async () => active
      ? {
          messages: [{ role: "user", content: "Start work" }],
          sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-lifecycle"] },
          inFlightRun: { runId: "run-lifecycle", text: "Partial work" },
        } as any
      : {
          messages: [
            { role: "user", content: "Start work" },
            { role: "assistant", content: "Partial work", runId: "run-lifecycle" },
          ],
          sessionInfo: { status: "killed", hasActiveRun: false, activeRunIds: [] },
        } as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(
      () => useOpenClawSession(agent as any, true, "session-alpha"),
    );

    await waitFor(() => expect(result.current.activeSessionSending).toBe(true));
    active = false;
    act(() => gateway.emit({
      event: "agent",
      payload: {
        sessionKey: "session-alpha",
        runId: "run-lifecycle",
        stream: "lifecycle",
        data: { phase: "error", status: "cancelled" },
      },
    }));

    await waitFor(() => expect(result.current.activeSessionSending).toBe(false));
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Partial work", status: "interrupted" }),
    ])));
    expect(result.current.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringMatching(/^Error:/) }),
    ]));
    unmount();
  });

  it("reuses an idle empty session without disturbing an in-flight send on another session", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta", messageCount: 0 },
    ] as any);
    gateway.chatHistory.mockResolvedValue([]);
    const release = deferred<void>();
    gateway.chatSend.mockImplementation((async function* () {
      await release.promise;
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

    let reusedSessionKey = "";
    await act(async () => {
      reusedSessionKey = await result.current.createSession();
    });

    expect(reusedSessionKey).toBe("session-beta");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(gateway.sessionsReset).not.toHaveBeenCalled();
    expect(result.current.activeSessionKey).toBe("session-alpha");
    expect(result.current.activeSessionSending).toBe(true);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello alpha" }),
    ]);
    expect(result.current.sessions.filter((session) => session.key === "session-beta")).toHaveLength(1);

    rerender({ sessionKey: reusedSessionKey });

    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.activeSessionSending).toBe(false);
    expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]);

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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "beta start" }),
    ]);
    unmount();
  });

  it("recovers every conversation after concurrent SDK streams are interrupted", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ] as any);
    let recoveryReady = false;
    gateway.chatHistory.mockImplementation((async (sessionKey: string) => {
      if (!recoveryReady) return [];
      return sessionKey === "session-alpha"
        ? [
            { role: "user", content: "alpha start" },
            { role: "assistant", content: "Alpha recovered reply" },
          ]
        : [
            { role: "user", content: "beta start" },
            { role: "assistant", content: "Beta recovered reply" },
          ];
    }) as any);
    const alphaStream = deferred<void>();
    const betaStream = deferred<void>();
    gateway.chatSend.mockImplementation((async function* (_message: string, sessionKey: string) {
      await (sessionKey === "session-alpha" ? alphaStream.promise : betaStream.promise);
      yield { type: "done" as const, data: {} };
    }) as any);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => result.current.setInput("alpha start"));
    let alphaSend!: Promise<void>;
    act(() => {
      alphaSend = result.current.sendMessage();
    });
    await waitFor(() => expect(result.current.thinkingSessionKeys).toEqual(["session-alpha"]));

    rerender({ sessionKey: "session-beta" });
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => result.current.setInput("beta start"));
    let betaSend!: Promise<void>;
    act(() => {
      betaSend = result.current.sendMessage();
    });
    await waitFor(() => expect(result.current.thinkingSessionKeys).toEqual([
      "session-alpha",
      "session-beta",
    ]));

    recoveryReady = true;
    const interruption = Object.assign(new Error("stream correlation was interrupted"), {
      code: "GATEWAY_CHAT_STREAM_INTERRUPTED",
      reason: "ambiguous-event",
    });
    await act(async () => {
      alphaStream.reject(interruption);
      betaStream.reject(interruption);
      await Promise.all([alphaSend, betaSend]);
    });

    await waitFor(() => expect(result.current.thinkingSessionKeys).toEqual([]));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "beta start" }),
      expect.objectContaining({ role: "assistant", content: "Beta recovered reply" }),
    ]));
    expect(result.current.messages.some((message) => message.content.startsWith("Error:"))).toBe(false);

    rerender({ sessionKey: "session-alpha" });
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "alpha start" }),
      expect.objectContaining({ role: "assistant", content: "Alpha recovered reply" }),
    ]));
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.messages.some((message) => message.content.startsWith("Error:"))).toBe(false);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      sessionKey === "main"
        ? [{ role: "assistant", content: "Main history" }]
        : []
    ));
    gateway.sessionsPreview.mockImplementation(async (sessionKey: string) => (
      sessionKey === "telegram:489595440"
        ? [{ role: "assistant", content: "Telegram history" }]
        : []
    ));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "telegram:489595440"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    expect(gateway.sessionsPreview).toHaveBeenCalledWith("telegram:489595440", 200);
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
      sessionKey === "main"
        ? [{ role: "assistant", content: "Main history" }]
        : []
    ));
    gateway.sessionsPreview.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    expect(result.current.activeSessionReadOnly).toBe(true);
    expect(result.current.messages).toEqual([]);
    unmount();
  });

  it("preserves live Telegram messages when the session becomes read-only", async () => {
    const gateway = buildGateway();
    const sessionsList = deferred<unknown[]>();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockImplementation(async () => sessionsList.promise);
    gateway.chatHistory.mockResolvedValue([]);
    gateway.sessionsPreview.mockResolvedValue([]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("does not expose or persist OpenClaw subagent sessions", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "main", title: "Main", updatedAt: 20 },
      { key: "agent:main:subagent:research", spawnedBy: "main", label: "Research task", updatedAt: 30 },
      { key: "agent:copilot:acp:opaque-child", spawnedBy: "main", label: "ACP task", updatedAt: 40 },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    expect(result.current.sessions.map((session) => session.key)).toEqual(["main"]);
    const cached = JSON.parse(window.localStorage.getItem("openclaw.sessions.v1:deploy-123") ?? "{}");
    expect(cached.sessions).toEqual([expect.objectContaining({ key: "main" })]);
    expect(JSON.stringify(cached)).not.toMatch(/subagent|opaque-child/);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(gateway.sessionsReset).toHaveBeenCalledWith(newSessionKey, "new");
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.creatingSessionKeys).toContain(newSessionKey);
    expect(result.current.messages).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({ [newSessionKey]: "New Session" });
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey }),
    ]));

    rerender({ sessionKey: newSessionKey });
    await waitFor(() => expect(result.current.activeSessionKey).toBe(newSessionKey));
    expect(result.current.connected).toBe(true);
    expect(result.current.hydrating).toBe(false);
    expect(gateway.chatHistory).not.toHaveBeenCalledWith(newSessionKey, 200);

    await act(async () => {
      reset.resolve(`agent:default:${newSessionKey}`);
      await reset.promise;
    });
    await waitFor(() => expect(result.current.creatingSessionKeys).not.toContain(newSessionKey));
    expect(result.current.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey }),
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
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      reset.resolve(`agent:default:${newSessionKey}`);
      await reset.promise;
    });

    await waitFor(() => {
      expect(gateway.chatSend).toHaveBeenCalledWith(
        "Test the weather skill safely.",
        `agent:default:${newSessionKey}`,
        undefined,
      );
    });
    expect(gateway.chatSend.mock.calls.map(([, sessionKey]) => sessionKey)).not.toContain("main");
    unmount();
  });

  it("queues the first draft until a new session has its canonical gateway key", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });
    rerender({ sessionKey: newSessionKey });
    await waitFor(() => expect(result.current.activeSessionKey).toBe(newSessionKey));
    expect(result.current.activeSessionCanSend).toBe(false);

    act(() => result.current.setInput("Send this first message once"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.input).toBe("Send this first message once");
    expect(result.current.pendingInput).toEqual([]);

    await act(async () => {
      reset.resolve(`agent:default:${newSessionKey}`);
      await reset.promise;
    });

    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledWith(
      "Send this first message once",
      `agent:default:${newSessionKey}`,
      undefined,
    ));
    expect(gateway.chatSend).toHaveBeenCalledTimes(1);
    expect(result.current.input).toBe("");
    await waitFor(() => expect(result.current.pendingInput).toEqual([]));
    unmount();
  });

  it("keeps a deferred first draft when session creation fails", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });
    rerender({ sessionKey: newSessionKey });
    act(() => result.current.setInput("Do not lose this draft"));
    await act(async () => {
      await result.current.sendMessage();
      reset.reject(new Error("reset failed"));
      await reset.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.creatingSessionKeys).not.toContain(newSessionKey));
    expect(result.current.input).toBe("Do not lose this draft");
    expect(result.current.pendingInput).toEqual([]);
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.historyPhase).toBe("error");
    unmount();
  });

  it("ignores a session creation result from an older gateway lifecycle", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const reset = deferred<string>();
    gateway.sessionsReset.mockReturnValueOnce(reset.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });
    rerender({ sessionKey: newSessionKey });
    act(() => result.current.setInput("Wait through reconnect"));
    await act(async () => {
      await result.current.sendMessage();
    });

    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.status).toBe("connecting"));
    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      reset.resolve(`agent:default:${newSessionKey}`);
      await reset.promise;
    });

    await waitFor(() => expect(result.current.creatingSessionKeys).not.toContain(newSessionKey));
    expect(gateway.chatSend).not.toHaveBeenCalled();
    expect(result.current.input).toBe("Wait through reconnect");
    expect(result.current.error).toMatch(/reconnected while creating/i);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

    const requestedSessionKey = gateway.sessionsReset.mock.calls[0]?.[0];
    expect(requestedSessionKey).toMatch(/^dashboard:/);
    reset.resolve(requestedSessionKey ?? "");
    let sessionKey = "";
    await act(async () => { sessionKey = await creation; });
    expect(settled).toBe(true);
    expect(sessionKey).toMatch(/^dashboard:/);
    expect(gateway.chatSend).toHaveBeenCalledWith("Test draft", sessionKey, undefined);
    unmount();
  });

  it("adopts native dashboard titles without running a hidden agent turn", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const replyDone = deferred<void>();
    let createdSessionKey = "";
    let durableLabel = "";
    gateway.sessionsReset.mockImplementation(async (sessionKey, reason) => {
      if (reason === "new") createdSessionKey = sessionKey;
      return sessionKey;
    });
    gateway.sessionsList.mockImplementation(async () => createdSessionKey
      ? [{
          key: `agent:default:${createdSessionKey}`,
          ...(durableLabel ? { displayName: durableLabel } : {}),
        }]
      : [{ key: "main", title: "Main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "The weather skill is ready to test." };
      await replyDone.promise;
      yield { type: "done" as const };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let sessionKey = "";
    await act(async () => {
      sessionKey = await result.current.createSession({ waitForCreation: true });
    });
    expect(gateway.sessionsSubscribe).toHaveBeenCalledOnce();
    expect(gateway.sessionsSubscribe.mock.invocationCallOrder[0])
      .toBeLessThan(gateway.sessionsCreate.mock.invocationCallOrder[0] ?? 0);
    expect(gateway.sessionsCreate).toHaveBeenCalledWith({ key: sessionKey });
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]);

    rerender({ sessionKey });
    await waitFor(() => expect(result.current.activeSessionKey).toBe(sessionKey));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("Test the weather skill safely."));
    let firstSend!: Promise<void>;
    act(() => {
      firstSend = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalled());
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]));
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();

    await act(async () => {
      replyDone.resolve();
      await firstSend;
    });
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    durableLabel = "Weather Planning";
    act(() => gateway.emit({
      event: "sessions.changed",
      payload: {
        sessionKey: `agent:default:${sessionKey}`,
        reason: "chat.title",
      },
    }));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Weather Planning" }),
    ]));
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});

    act(() => result.current.setInput("Run one more check"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    unmount();
  });

  it("does not launch title generation from refreshed assistant history", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let createdSessionKey = "";
    gateway.sessionsReset.mockImplementation(async (sessionKey, reason) => {
      if (reason === "new") {
        createdSessionKey = sessionKey;
        return `agent:default:${sessionKey}`;
      }
      return sessionKey;
    });
    gateway.sessionsList.mockImplementation(async () => createdSessionKey
      ? [{ key: createdSessionKey }]
      : [{ key: "main", title: "Main" }]);
    gateway.chatHistory.mockImplementation(async (sessionKey) => (
      createdSessionKey && sessionKey.includes(createdSessionKey)
        ? [
            { role: "user", content: "Summarize the release" },
            { role: "assistant", content: "The release is ready for review." },
          ]
        : []
    ));
    gateway.chatSend.mockImplementation(async function* () {
      yield {
        type: "done" as const,
        data: {
          stream: "lifecycle",
          data: { phase: "end" },
        },
      };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    await act(async () => {
      await result.current.createSession({
        initialMessage: "Summarize the release",
        waitForCreation: true,
      });
    });

    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]));
    unmount();
  });

  it("does not copy the first message into the title when native generation is unavailable", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let createdSessionKey = "";
    gateway.sessionsReset.mockImplementation(async (sessionKey, reason) => {
      if (reason === "new") createdSessionKey = sessionKey;
      return sessionKey;
    });
    gateway.sessionsList.mockImplementation(async () => createdSessionKey
      ? [{ key: `agent:default:${createdSessionKey}` }]
      : [{ key: "main", title: "Main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "The project is ready to launch." };
      yield { type: "done" as const };
    });
    gateway.runEphemeralChat.mockResolvedValue("Project Launch");
    gateway.sessionsPatch.mockRejectedValue(new Error("missing scope: operator.write"));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let sessionKey = "";
    await act(async () => {
      sessionKey = await result.current.createSession({ initialMessage: "Launch the project", waitForCreation: true });
    });

    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]));
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({ [sessionKey]: "New Session" });
    unmount();
  });

  it("keeps manual renames independent from hidden generation", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let createdSessionKey = "";
    let durableLabel = "";
    gateway.sessionsReset.mockImplementation(async (sessionKey, reason) => {
      if (reason === "new") createdSessionKey = sessionKey;
      return sessionKey;
    });
    gateway.sessionsList.mockImplementation(async () => createdSessionKey
      ? [{
          key: `agent:default:${createdSessionKey}`,
          ...(durableLabel ? { label: durableLabel } : {}),
        }]
      : [{ key: "main", title: "Main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "A complete assistant response." };
      yield { type: "done" as const };
    });
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      durableLabel = String(patch.label ?? "");
      return {
        ok: true,
        key: `agent:default:${createdSessionKey}`,
        entry: { label: durableLabel },
      };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let sessionKey = "";
    await act(async () => {
      sessionKey = await result.current.createSession({ initialMessage: "First question", waitForCreation: true });
    });
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]));

    await act(async () => {
      await result.current.renameSession(sessionKey, "Manual Conversation Name");
    });
    expect(gateway.sessionsPatch).toHaveBeenCalledOnce();
    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: `agent:default:${sessionKey}`,
      label: "Manual Conversation Name",
    });

    const sessionCallsBeforeTitleEvent = gateway.sessionsList.mock.calls.length;
    act(() => gateway.emit({
      event: "sessions.changed",
      payload: {
        sessionKey: `agent:default:${sessionKey}`,
        reason: "chat.title",
      },
    }));
    expect(gateway.sessionsPatch).toHaveBeenCalledOnce();
    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(sessionCallsBeforeTitleEvent));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Manual Conversation Name" }),
    ]));
    unmount();
  });

  it("does not let a title refresh started before a manual rename overwrite it", async () => {
    const gateway = buildGateway();
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const canonicalKey = `agent:default:${sessionKey}`;
    let durableLabel = "";
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: canonicalKey, displayName: "Generated Conversation" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      durableLabel = String(patch.label ?? "");
      return { ok: true, key: canonicalKey, entry: { label: durableLabel } };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, sessionKey));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Generated Conversation" }),
    ]));

    const sessionCallsBeforeTitleEvent = gateway.sessionsList.mock.calls.length;
    const staleTitleRefresh = deferred<unknown[]>();
    gateway.sessionsList
      .mockReturnValueOnce(staleTitleRefresh.promise)
      .mockImplementation(async () => [{ key: canonicalKey, label: durableLabel }]);
    act(() => gateway.emit({
      event: "sessions.changed",
      payload: { sessionKey: canonicalKey, reason: "chat.title" },
    }));
    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(sessionCallsBeforeTitleEvent));

    await act(async () => {
      await result.current.renameSession(sessionKey, "Manual Conversation Name");
    });
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Manual Conversation Name" }),
    ]);

    await act(async () => {
      staleTitleRefresh.resolve([{ key: canonicalKey, displayName: "Late Generated Conversation" }]);
      await staleTitleRefresh.promise;
      await Promise.resolve();
    });
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Manual Conversation Name" }),
    ]);
    await waitFor(() => expect(gateway.sessionsList.mock.calls.length).toBeGreaterThan(sessionCallsBeforeTitleEvent + 1));
    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Manual Conversation Name" }),
    ]));
    unmount();
  });

  it("never retries malformed hidden title responses because it does not request them", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    let createdSessionKey = "";
    let durableLabel = "";
    gateway.sessionsReset.mockImplementation(async (sessionKey, reason) => {
      if (reason === "new") createdSessionKey = sessionKey;
      return sessionKey;
    });
    gateway.sessionsList.mockImplementation(async () => createdSessionKey
      ? [{
          key: `agent:default:${createdSessionKey}`,
          ...(durableLabel ? { label: durableLabel } : {}),
        }]
      : [{ key: "main", title: "Main" }]);
    gateway.chatSend.mockImplementation(async function* () {
      yield { type: "content" as const, text: "A complete assistant response." };
      yield { type: "done" as const };
    });
    gateway.runEphemeralChat.mockResolvedValue("{}");
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      durableLabel = String(patch.label ?? "");
      return {
        ok: true,
        key: `agent:default:${createdSessionKey}`,
        entry: { label: durableLabel },
      };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "main" } },
    );
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    let sessionKey = "";
    await act(async () => {
      sessionKey = await result.current.createSession({ initialMessage: "First question", waitForCreation: true });
    });
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ sessionKey });
    await waitFor(() => expect(result.current.activeSessionKey).toBe(sessionKey));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("Second question"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(gateway.runEphemeralChat).not.toHaveBeenCalled();
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "New Session" }),
    ]);
    unmount();
  });

  it("does not keep a failed new session local and surfaces the gateway reset error", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    gateway.sessionsReset.mockRejectedValueOnce(new Error("Session reset failed"));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    let newSessionKey = "";
    await act(async () => {
      newSessionKey = await result.current.createSession();
    });

    expect(newSessionKey).toMatch(/^dashboard:/);
    expect(result.current.sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: newSessionKey }),
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("removes stale local titles when the gateway returns a durable label", async () => {
    window.localStorage.setItem("openclaw.sessionTitles.v1:deploy-123", JSON.stringify({
      "session-alpha": "Stale local title",
    }));
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{
      key: "agent:default:session-alpha",
      label: "Durable title",
    }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.sessions).toEqual([
      expect.objectContaining({ title: "Durable title" }),
    ]));
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});
    unmount();
  });

  it("persists renamed sessions and archives deleted sessions", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      if (patch.archived === true) {
        gateway.sessionsList.mockResolvedValue([]);
        return { ok: true, key: patch.key };
      }
      gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", label: patch.label }]);
      return { ok: true, key: patch.key, entry: { label: patch.label } };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await act(async () => {
      await result.current.renameSession("session-alpha", "Renamed");
    });
    expect(gateway.sessionsPatch).toHaveBeenCalledWith({ key: "session-alpha", label: "Renamed" });
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});

    await act(async () => {
      await result.current.deleteSession("session-alpha");
    });
    expect(gateway.sessionsPatch).toHaveBeenCalledWith({ key: "session-alpha", archived: true });
    expect(result.current.sessions).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});
    unmount();
  });

  it("deletes and hides scoped sessions selected by their unscoped key", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "agent:default:session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      if (patch.archived === true) gateway.sessionsList.mockResolvedValue([]);
      return { ok: true, key: patch.key };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:default:session-alpha",
      archived: true,
    });
    expect(result.current.sessions).toEqual([]);
    unmount();
  });

  it("keeps deleted sessions hidden after the hook remounts", async () => {
    const gateway = buildGateway();
    let archived = false;
    gateway.sessionsList.mockImplementation(async () => archived
      ? []
      : [{ key: "agent:default:session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      if (patch.archived === true) archived = true;
      return { ok: true, key: patch.key };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const first = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));
    await waitFor(() => expect(first.result.current.sessions).toEqual([
      expect.objectContaining({ key: "agent:default:session-alpha" }),
    ]));

    await act(async () => {
      await first.result.current.deleteSession("session-alpha");
    });
    first.unmount();

    const second = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(second.result.current.sessionsFetched).toBe(true));
    expect(second.result.current.sessions).toEqual([]);
    second.unmount();
  });

  it("rejects deletion of the main session", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.sessionsFetched).toBe(true));

    await expect(result.current.deleteSession("main")).rejects.toThrow("The main session cannot be deleted.");
    expect(gateway.sessionsPatch).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps an archived session hidden after the local tombstone expires", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      if (patch.archived === true) gateway.sessionsList.mockResolvedValue([]);
      return { ok: true, key: patch.key };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

      expect(result.current.sessions).toEqual([]);
      unmount();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("persists renamed scoped sessions through their gateway key", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "agent:default:session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockImplementation(async (patch) => {
      gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", label: patch.label }]);
      return { ok: true, key: "agent:default:session-alpha", entry: { label: patch.label } };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:default:session-alpha",
      label: "Renamed",
    });
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({});

    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    unmount();
  });

  it("falls back to local session titles when an older gateway rejects labels", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", title: "Alpha" }]);
    gateway.sessionsPatch.mockRejectedValue(new Error("invalid sessions.patch params: at root: unexpected property 'label'"));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "session-alpha"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    await act(async () => {
      await result.current.renameSession("session-alpha", "Renamed");
    });

    gateway.sessionsList.mockResolvedValue([{ key: "session-alpha", displayName: "Generated Conversation" }]);
    await act(async () => {
      await result.current.refreshSessions();
    });

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({ key: "session-alpha", label: "Renamed" });
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ key: "session-alpha", title: "Renamed" }),
    ]);
    expect(JSON.parse(window.localStorage.getItem("openclaw.sessionTitles.v1:deploy-123") ?? "{}"))
      .toEqual({ "session-alpha": "Renamed" });
    unmount();
  });

  it("dedupes concurrent session refreshes", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValueOnce([{ key: "main", title: "Main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    const dashboardSessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{ key: dashboardSessionKey, title: "Dashboard", lastMessageAt: 1 }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Initial history" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.activeSessionSelectionResolved).toBe(true));
    expect(result.current.activeSessionKey).toBe(dashboardSessionKey);
    const activeSessionKey = dashboardSessionKey;
    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith(activeSessionKey, 200));
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));
    const historyCallsAfterHydration = gateway.chatHistory.mock.calls.length;
    const sessionCallsAfterHydration = gateway.sessionsList.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Refreshed history" }]);

    act(() => {
      gateway.emit({ event: "chat", payload: { sessionKey: activeSessionKey, state: "final" } });
      gateway.emit({ event: "chat.done", payload: { sessionKey: activeSessionKey } });
      gateway.emit({ event: "agent", payload: { sessionKey: activeSessionKey, stream: "lifecycle", data: { phase: "end" } } });
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
    const dashboardSessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    gateway.sessionsList.mockResolvedValue([{ key: dashboardSessionKey, title: "Dashboard", lastMessageAt: 1 }]);
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Initial history" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.activeSessionSelectionResolved).toBe(true));
    expect(result.current.activeSessionKey).toBe(dashboardSessionKey);
    const activeSessionKey = dashboardSessionKey;
    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith(activeSessionKey, 200));
    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(1));
    const historyCallsAfterHydration = gateway.chatHistory.mock.calls.length;
    const sessionCallsAfterHydration = gateway.sessionsList.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([{ role: "assistant", content: "Refreshed history" }]);

    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: activeSessionKey } });
      gateway.emit({ event: "chat.done", payload: { sessionKey: activeSessionKey } });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(gateway.chatHistory).toHaveBeenCalledTimes(historyCallsAfterHydration + 1);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(sessionCallsAfterHydration + 1);
    unmount();
  });

  it("can resend an explicit attachment payload without relying on the composer draft", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const attachment = {
      type: "image" as const,
      mimeType: "image/png",
      content: "aW1hZ2U=",
      fileName: "reference.png",
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

    await act(async () => {
      await result.current.sendMessage("Retry image request", { attachments: [attachment] });
    });

    expect(gateway.chatSend).toHaveBeenCalledWith("Retry image request", activeSessionKey, [attachment]);
    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      role: "user",
      content: "Retry image request",
      attachments: [attachment],
    }));
    unmount();
  });

  it("can send voice-note instructions while showing only the attached audio file", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

    await act(async () => {
      await result.current.sendMessage(voiceMessage, { displayContent: "", files: [voiceFile] });
    });

    expect(gateway.chatSend).toHaveBeenCalledWith(
      `file: ${voiceFile.path}\n\n${voiceMessage}`,
      activeSessionKey,
      undefined,
    );
    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      role: "user",
      content: "",
      retryContent: voiceMessage,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("clears cached browser history when gateway history is authoritatively empty", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", messageCount: 0, updatedAt: 1 }]);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));

    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(result.current.messages).toEqual([]);
    expect(result.current.historyPhase).toBe("ready");
    expect(window.localStorage.getItem(cacheKey!)).toBeNull();
    unmount();
  });

  it("replaces a longer cached transcript with the shorter authoritative gateway history", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "current question", timestamp: 3 },
      { role: "assistant", content: "current answer", timestamp: 4 },
    ]);
    const cacheKey = openClawChatHistoryCacheKey("deploy-123");
    expect(cacheKey).toBeTruthy();
    window.localStorage.setItem(cacheKey!, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [
        { role: "user", content: "stale question", timestamp: 1 },
        { role: "assistant", content: "stale answer", timestamp: 2 },
        { role: "user", content: "current question", timestamp: 3 },
        { role: "assistant", content: "current answer", timestamp: 4 },
      ],
    }));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "current question",
      "current answer",
    ]);
    await waitFor(() => expect(readCachedOpenClawChatHistory("deploy-123").map((message) => message.content)).toEqual([
      "current question",
      "current answer",
    ]));
    unmount();
  });

  it("clears prior live mutations when a later hydration is authoritatively empty", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", messageCount: 1, updatedAt: 1 }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      gateway.emit({
        event: "chat.content",
        payload: { sessionKey: "main", messageId: "stale-message", text: "Stale live answer" },
      });
    });
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ content: "Stale live answer" }),
    ]));

    const emptyHydration = deferred<unknown[]>();
    const historyCallsBeforeReconnect = gateway.chatHistory.mock.calls.length;
    gateway.sessionsList.mockResolvedValue([{ key: "main", messageCount: 0, updatedAt: 2 }]);
    gateway.chatHistory.mockReturnValue(emptyHydration.promise);
    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.status).toBe("connecting"));
    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeReconnect));

    await act(async () => {
      emptyHydration.resolve([]);
      await emptyHydration.promise;
    });
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.historyPhase).toBe("ready");
    unmount();
  });

  it("clears an unconfirmed failed turn when reconnect history is authoritatively empty", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", messageCount: 0, updatedAt: 1 }]);
    gateway.chatSend.mockImplementation(async function* () {
      throw new Error("send interrupted");
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    act(() => result.current.setInput("Unconfirmed request"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(result.current.messages.some((message) => message.content === "Unconfirmed request")).toBe(true);

    const reconnectHistory = deferred<unknown[]>();
    gateway.chatHistory.mockReturnValue(reconnectHistory.promise);
    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(false));
    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(result.current.historyPhase).toBe("loading"));

    await act(async () => {
      reconnectHistory.resolve([]);
      await reconnectHistory.promise;
    });
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.activeSessionCanSend).toBe(true);
    unmount();
  });

  it("keeps mounted history when reconnect returns an unconfirmed empty snapshot", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([{ key: "main", messageCount: 2, updatedAt: 1 }]);
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: "Question before reconnect" },
      { role: "assistant", content: "Answer before reconnect" },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    const reconnectHistory = deferred<unknown[]>();
    const historyCallsBeforeReconnect = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockReturnValue(reconnectHistory.promise);
    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.status).toBe("connecting"));
    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeReconnect));

    await act(async () => {
      reconnectHistory.resolve([]);
      await reconnectHistory.promise;
    });
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question before reconnect",
      "Answer before reconnect",
    ]);
    unmount();
  });

  it("keeps an active partial reply until reconnect history contains the final response", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const stream = controlledChatStream();
    gateway.chatSend.mockReturnValue(stream.iterator);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    act(() => result.current.setInput("Write a long report"));
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(1));

    act(() => {
      stream.emit({ type: "content", text: "Partial report", runId: "run-long" });
    });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Partial report", runId: "run-long" }),
    ])));

    const historyCallsBeforeReconnect = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: [{ type: "text", text: "Write a long report" }] },
    ]);
    act(() => {
      gateway.emitConnectionState("disconnected");
      gateway.emitConnectionState("connecting");
    });
    await waitFor(() => expect(result.current.status).toBe("connecting"));
    expect(stream.returnIterator).toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Write a long report" }),
      expect.objectContaining({ role: "assistant", content: "Partial report", status: "interrupted" }),
    ]);

    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeReconnect));
    await waitFor(() => expect(result.current.historyPhase).toBe("ready"));
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Write a long report" }),
      expect.objectContaining({
        role: "assistant",
        content: "Partial report",
        runId: "run-long",
        status: "interrupted",
      }),
    ]);

    await act(async () => {
      stream.emit({ type: "content", text: "Ignored stale continuation", runId: "run-long" });
      stream.releaseReturn();
      await sendPromise;
    });
    expect(result.current.messages.map((message) => message.content)).not.toContain("Ignored stale continuation");

    const historyCallsBeforeCompletion = gateway.chatHistory.mock.calls.length;
    gateway.chatHistory.mockResolvedValue([
      { role: "user", content: [{ type: "text", text: "Write a long report" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "Partial report followed by the complete final response." }],
        runId: "run-long",
      },
    ]);
    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: "main", runId: "run-long" } });
    });

    await waitFor(() => expect(gateway.chatHistory.mock.calls.length).toBeGreaterThan(historyCallsBeforeCompletion));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Write a long report" }),
      expect.objectContaining({
        role: "assistant",
        content: "Partial report followed by the complete final response.",
        runId: "run-long",
      }),
    ]));
    expect(result.current.messages[1]?.status).toBeUndefined();
    expect(result.current.sending).toBe(false);
    unmount();
  });

  it("keeps cached browser history when gateway history fails", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.chatHistory.mockRejectedValue(new Error("history unavailable"));
    const cacheKey = openClawChatHistoryCacheKey("deploy-123");
    expect(cacheKey).toBeTruthy();
    window.localStorage.setItem(cacheKey!, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [
        { role: "user", content: "cached question", timestamp: 1 },
        { role: "assistant", content: "cached answer", timestamp: 2 },
      ],
    }));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.gatewayConnected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "cached question", timestamp: 1, renderId: expect.any(String) }),
      expect.objectContaining({ role: "assistant", content: "cached answer", timestamp: 2, renderId: expect.any(String) }),
    ]);
    expect(result.current.historyPhase).toBe("error");
    expect(result.current.activeSessionCanSend).toBe(false);
    expect(window.localStorage.getItem(cacheKey!)).not.toBeNull();
    unmount();
  });

  it("ignores an old iterator event and completion after the gateway reconnects", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const oldStream = controlledChatStream();
    const newStream = controlledChatStream();
    gateway.chatSend
      .mockReturnValueOnce(oldStream.iterator)
      .mockReturnValueOnce(newStream.iterator);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("first request"));
    let oldSendPromise!: Promise<void>;
    act(() => {
      oldSendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.sending).toBe(true));

    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.status).toBe("connecting"));
    expect(oldStream.returnIterator).toHaveBeenCalled();

    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("second request"));
    let newSendPromise!: Promise<void>;
    act(() => {
      newSendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.sending).toBe(true));

    await act(async () => {
      oldStream.emit({ type: "content", text: "Stale reply" });
      oldStream.releaseReturn();
      await oldSendPromise;
    });

    expect(result.current.messages.map((message) => message.content)).not.toContain("Stale reply");
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(true);

    await act(async () => {
      newStream.emit({ type: "content", text: "Fresh reply" });
      newStream.emit({ type: "done", data: {} });
      newStream.finish();
      await newSendPromise;
    });

    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Fresh reply" }),
    ]));
    expect(result.current.sending).toBe(false);
    unmount();
  });

  it("does not let an aborted iterator clear or update its replacement", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const oldStream = controlledChatStream();
    const replacementStream = controlledChatStream();
    gateway.chatSend
      .mockReturnValueOnce(oldStream.iterator)
      .mockReturnValueOnce(replacementStream.iterator);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("first request"));
    let oldSendPromise!: Promise<void>;
    act(() => {
      oldSendPromise = result.current.sendMessage();
    });
    oldStream.emit({ type: "content", text: "Partial reply" });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Partial reply" }),
    ])));

    await act(async () => {
      await result.current.abortMessage();
    });
    expect(result.current.sending).toBe(false);
    expect(oldStream.returnIterator).toHaveBeenCalled();

    act(() => result.current.setInput("replacement request"));
    let replacementSendPromise!: Promise<void>;
    act(() => {
      replacementSendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.sending).toBe(true));

    await act(async () => {
      oldStream.emit({ type: "content", text: "Late stale reply" });
      oldStream.releaseReturn();
      await oldSendPromise;
    });

    expect(result.current.messages.map((message) => message.content)).not.toContain("Late stale reply");
    expect(result.current.sending).toBe(true);
    expect(result.current.activeSessionSending).toBe(true);

    await act(async () => {
      replacementStream.emit({ type: "content", text: "Replacement reply" });
      replacementStream.emit({ type: "done", data: {} });
      replacementStream.finish();
      await replacementSendPromise;
    });

    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Replacement reply" }),
    ]));
    expect(result.current.sending).toBe(false);
    unmount();
  });

  it("uses unique local turn render ids while one turn keeps one identified assistant row", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const firstStream = controlledChatStream();
    const secondStream = controlledChatStream();
    gateway.chatSend
      .mockReturnValueOnce(firstStream.iterator)
      .mockReturnValueOnce(secondStream.iterator);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("first turn"));
    let firstSend!: Promise<void>;
    act(() => {
      firstSend = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(1));
    const firstUserRenderId = result.current.messages.find((message) => message.role === "user")?.renderId;
    const firstClientTurnId = result.current.messages.find((message) => message.role === "user")?.clientTurnId;
    expect(firstUserRenderId).toEqual(expect.any(String));
    expect(firstClientTurnId).toEqual(expect.any(String));

    act(() => firstStream.emit({
      type: "content",
      text: "Draft",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      sessionKey: "agent:default:main",
      revision: 1,
    }));
    await waitFor(() => expect(result.current.messages.find((message) => message.role === "assistant"))
      .toMatchObject({ content: "Draft", renderId: expect.any(String) }));
    const firstAssistantRenderId = result.current.messages.find((message) => message.role === "assistant")?.renderId;
    expect(result.current.messages.find((message) => message.role === "assistant")?.clientTurnId).toBe(firstClientTurnId);

    act(() => firstStream.emit({
      type: "content",
      text: "Corrected answer",
      replace: true,
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      sessionKey: "agent:default:main",
      revision: 2,
    }));
    await waitFor(() => expect(result.current.messages.find((message) => message.role === "assistant"))
      .toMatchObject({
        content: "Corrected answer",
        renderId: firstAssistantRenderId,
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        revision: 2,
      }));

    await act(async () => {
      firstStream.emit({ type: "done", messageId: "message-1", turnId: "turn-1", runId: "run-1" });
      firstStream.finish();
      await firstSend;
    });

    act(() => result.current.setInput("second turn"));
    let secondSend!: Promise<void>;
    act(() => {
      secondSend = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(2));
    const userMessages = result.current.messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1]?.renderId).toEqual(expect.any(String));
    expect(userMessages[1]?.renderId).not.toBe(firstUserRenderId);
    expect(userMessages[1]?.clientTurnId).not.toBe(firstClientTurnId);

    await act(async () => {
      secondStream.emit({ type: "content", text: "Second answer", messageId: "message-2", turnId: "turn-2", runId: "run-2" });
      secondStream.emit({ type: "done", messageId: "message-2", turnId: "turn-2", runId: "run-2" });
      secondStream.finish();
      await secondSend;
    });

    const assistantMessages = result.current.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]?.renderId).toBe(firstAssistantRenderId);
    expect(assistantMessages[1]?.renderId).not.toBe(firstAssistantRenderId);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

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
      const cachedMessages = readCachedOpenClawChatHistory("deploy-123", activeSessionKey);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("checkpoints an active reply to local history on pagehide", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    const stream = controlledChatStream();
    gateway.chatSend.mockReturnValue(stream.iterator);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    const sessionKey = result.current.activeSessionKey;
    act(() => result.current.setInput("Inspect before refresh"));
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage();
    });
    await waitFor(() => expect(gateway.chatSend).toHaveBeenCalledTimes(1));
    act(() => {
      stream.emit({ type: "reasoning", text: "Inspecting the workspace", runId: "run-live" });
      stream.emit({
        type: "tool_call",
        runId: "run-live",
        data: {
          tool_call_id: "tool-live",
          tool_name: "functions.read",
          args: { path: "README.md" },
        },
      });
    });
    await waitFor(() => expect(result.current.messages.some((message) => (
      message.role === "assistant" &&
      message.reasoning?.text === "Inspecting the workspace" &&
      message.toolCalls?.[0]?.id === "tool-live"
    ))).toBe(true));

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(readCachedOpenClawChatHistory("deploy-123", sessionKey)).toEqual([
      expect.objectContaining({ role: "user", content: "Inspect before refresh" }),
      expect.objectContaining({
        role: "assistant",
        reasoning: expect.objectContaining({ text: "Inspecting the workspace" }),
        toolCalls: [expect.objectContaining({ id: "tool-live" })],
      }),
    ]);

    await act(async () => {
      stream.finish();
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
      yield { type: "content" as const, text: "Partial answer", runId: "run-live" };
      await release.promise;
      yield { type: "done" as const, data: {} };
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

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
    expect(gateway.chatAbort).toHaveBeenCalledWith(activeSessionKey, "run-live");

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

  it("marks the captured session interrupted when abort acknowledgement arrives after a session switch", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    gateway.sessionsList.mockResolvedValue([
      { key: "session-alpha", title: "Alpha" },
      { key: "session-beta", title: "Beta" },
    ]);
    gateway.chatHistory.mockResolvedValue([]);
    const stream = controlledChatStream();
    const abortAck = deferred<void>();
    gateway.chatSend.mockReturnValue(stream.iterator);
    gateway.chatAbort.mockReturnValue(abortAck.promise);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, rerender, unmount } = renderHookWithClient(
      ({ sessionKey }: { sessionKey: string }) => useOpenClawSession(agent as any, true, sessionKey),
      { initialProps: { sessionKey: "session-alpha" } },
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setInput("stop alpha"));
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage();
    });
    stream.emit({ type: "content", text: "Alpha partial reply" });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: "Alpha partial reply" }),
    ])));

    let abortPromise!: Promise<void>;
    act(() => {
      abortPromise = result.current.abortMessage();
    });
    await waitFor(() => expect(result.current.aborting).toBe(true));
    expect(gateway.chatAbort).toHaveBeenCalledWith("session-alpha");

    rerender({ sessionKey: "session-beta" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-beta"));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.activeSessionAborting).toBe(false);
    expect(result.current.aborting).toBe(true);

    await act(async () => {
      abortAck.resolve();
      await abortPromise;
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.aborting).toBe(false);
    expect(result.current.sending).toBe(false);

    rerender({ sessionKey: "session-alpha" });
    await waitFor(() => expect(result.current.activeSessionKey).toBe("session-alpha"));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "stop alpha" }),
      expect.objectContaining({ role: "assistant", content: "Alpha partial reply", status: "interrupted" }),
    ]));

    await act(async () => {
      stream.finish();
      stream.releaseReturn();
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
          content: "",
          toolCalls: [
            expect.objectContaining({
              id: "tool-1",
              name: "functions.read",
              result: "Read complete",
            }),
          ],
        }),
        expect.objectContaining({
          role: "assistant",
          content: "History summary",
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

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
    expect(gateway.chatHistory).toHaveBeenLastCalledWith(activeSessionKey, 200);
    unmount();
  });

  it("keeps the legacy send path active until a live done event when chatSend is unavailable", async () => {
    const gateway = buildGateway();
    gateway.agentsList.mockResolvedValue([{ id: "main" }]);
    (gateway as any).chatSend = undefined;
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    const activeSessionKey = result.current.activeSessionKey;
    expect(activeSessionKey).toMatch(/^dashboard:[0-9a-f-]+$/i);

    act(() => {
      result.current.setInput("hello");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(gateway.sendChat).toHaveBeenCalledWith("hello", activeSessionKey, undefined, undefined);
    expect(result.current.sending).toBe(true);

    act(() => {
      gateway.emit({ event: "chat.done", payload: { sessionKey: activeSessionKey } });
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    expect(firstGateway.releaseLease).toHaveBeenCalledTimes(1);
    expect(firstGateway.close).not.toHaveBeenCalled();
    expect(secondGateway.connect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("refreshes canonical session routing before authorizing sends after reconnect", async () => {
    const gateway = buildGateway();
    gateway.sessionsList
      .mockResolvedValueOnce([{ key: "visible", gatewaySessionKey: "gateway-old", title: "Visible" }])
      .mockResolvedValue([{ key: "visible", gatewaySessionKey: "gateway-new", title: "Visible" }]);
    gateway.chatHistory.mockImplementation(async (sessionKey: string) => [
      { role: "assistant", content: `${sessionKey} history` },
    ]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "visible"));

    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-old", 200);
    gateway.chatHistory.mockClear();

    act(() => gateway.emitConnectionState("connecting"));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(false));
    act(() => gateway.emitConnectionState("connected"));

    await waitFor(() => expect(gateway.sessionsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(gateway.chatHistory).toHaveBeenCalledWith("gateway-new", 200));
    expect(gateway.chatHistory).not.toHaveBeenCalledWith("gateway-old", 200);
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));

    act(() => result.current.setInput("Use the refreshed route"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(gateway.chatSend).toHaveBeenCalledWith(
      "Use the refreshed route",
      "gateway-new",
      undefined,
      { captureHistoryBaseline: true },
    );
    unmount();
  });

  it("ignores duplicate connected notifications without invalidating send authority", async () => {
    const gateway = buildGateway();
    gateway.sessionsList.mockResolvedValue([{ key: "main", title: "Main" }]);
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));
    await waitFor(() => expect(result.current.activeSessionCanSend).toBe(true));
    const historyCalls = gateway.chatHistory.mock.calls.length;
    const sessionCalls = gateway.sessionsList.mock.calls.length;

    act(() => gateway.emitConnectionState("connected"));

    expect(result.current.activeSessionCanSend).toBe(true);
    expect(gateway.chatHistory).toHaveBeenCalledTimes(historyCalls);
    expect(gateway.sessionsList).toHaveBeenCalledTimes(sessionCalls);
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn()
        .mockReturnValueOnce(firstGateway)
        .mockReturnValueOnce(secondGateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

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
    const connectError = new Error("Timed out opening the agent session");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(),
      acquireConnectedGateway: vi.fn(async () => {
        throw connectError;
      }),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.error).toMatch(/Timed out opening the agent session/i));
    expect(result.current.connected).toBe(false);
    expect(result.current.connecting).toBe(false);
    expect(agent.gateway).not.toHaveBeenCalled();
    unmount();
  });

  it("explains gateway origin denials using the safe configured env origin", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue(Object.assign(new Error("Gateway request failed"), {
      gatewayCode: "CONTROL_UI_ORIGIN_NOT_ALLOWED",
      details: { token: "raw-gateway-token-must-not-leak" },
    }));
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      launchConfig: {
        env: {
          OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "https://agents.feat.hypercli.com/private?token=launch-secret",
        },
      },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe(
      `This agent allows connections from https://agents.feat.hypercli.com, but you opened it from ${window.location.origin}. Did you create it from the other dashboard?`,
    ));
    expect(result.current.error).not.toMatch(/raw-gateway-token|launch-secret|private/);
    expect(result.current.connecting).toBe(false);
    unmount();
  });

  it("lists multiple normalized config origins for an origin denial", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({ detail: "origin not allowed" });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      launchConfig: {
        config: {
          gateway: {
            controlUi: {
              allowedOrigins: [
                "https://agents.hypercli.com/path",
                "https://agents.feat.hypercli.com",
                "https://agents.hypercli.com/duplicate",
              ],
            },
          },
        },
      },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe(
      `This agent allows connections from https://agents.hypercli.com or https://agents.feat.hypercli.com, but you opened it from ${window.location.origin}. Did you create it from the other dashboard?`,
    ));
    unmount();
  });

  it("uses generic origin-denial copy when configured origins are unsafe", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({
      detail: "origin not allowed",
      token: "gateway-secret-must-not-leak",
    });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
      launchConfig: {
        env: {
          OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "javascript:alert('launch-secret-must-not-leak')",
        },
        config: {
          gateway: {
            controlUi: {
              allowedOrigins: ["not a URL with another-secret", "https://user:password@example.com"],
            },
          },
        },
      },
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true));

    await waitFor(() => expect(result.current.error).toBe(
      "This agent does not allow connections from this dashboard address. Did you create it from another dashboard?",
    ));
    expect(result.current.error).not.toMatch(/secret|password|javascript|gateway/);
    unmount();
  });

  it("keeps pairing-required closes in the connecting flow for auto-approval", async () => {
    let onClose: ((info: any) => void) | null = null;
    const gateway = buildGateway("connecting");
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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

  it("treats SDK pairing as connection progress without reacquiring or resetting drafts", async () => {
    const gateway = buildGateway();
    const release = vi.fn();
    const agent = {
      id: "deploy-123",
      acquireConnectedGateway: vi.fn(async () => ({ client: gateway, release })),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      result.current.setInput("Keep this draft");
      result.current.addPendingFiles([{ name: "draft.md", path: "/workspace/draft.md", type: "text/markdown" }]);
    });
    await waitFor(() => expect(result.current.input).toBe("Keep this draft"));

    act(() => {
      gateway.emitConnectionState("pairing");
    });

    expect(result.current.status).toBe("pairing");
    expect(result.current.connecting).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.input).toBe("Keep this draft");
    expect(result.current.pendingFiles).toEqual([
      { name: "draft.md", path: "/workspace/draft.md", type: "text/markdown" },
    ]);
    expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    act(() => gateway.emitConnectionState("connected"));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1);
    expect(result.current.input).toBe("Keep this draft");
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("surfaces pairing while the initial connected gateway acquisition is pending", async () => {
    const gateway = buildGateway();
    const pendingLease = deferred<{ client: ReturnType<typeof buildGateway>; release: ReturnType<typeof vi.fn> }>();
    const release = vi.fn();
    let onPairing: ((pairing: unknown | null) => void) | undefined;
    const agent = {
      id: "deploy-123",
      acquireConnectedGateway: vi.fn((options: { onPairing?: (pairing: unknown | null) => void }) => {
        onPairing = options.onPairing;
        return pendingLease.promise;
      }),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setInput("Keep this cold-start draft");
      onPairing?.({ requestId: "pair-1" });
    });
    await waitFor(() => expect(result.current.status).toBe("pairing"));
    expect(result.current.connecting).toBe(true);
    expect(result.current.input).toBe("Keep this cold-start draft");
    expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    act(() => onPairing?.(null));
    expect(result.current.status).toBe("connecting");
    expect(result.current.input).toBe("Keep this cold-start draft");
    expect(agent.acquireConnectedGateway).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingLease.resolve({ client: gateway, release });
      await pendingLease.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.input).toBe("Keep this cold-start draft");
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fences a late Agent A acquisition after switching to Agent B", async () => {
    const firstGateway = buildGateway();
    const secondGateway = buildGateway();
    const firstLease = deferred<{ client: ReturnType<typeof buildGateway>; release: ReturnType<typeof vi.fn> }>();
    const releaseFirst = vi.fn();
    const releaseSecond = vi.fn();
    const firstAgent = {
      id: "deploy-a",
      acquireConnectedGateway: vi.fn(() => firstLease.promise),
    };
    const secondAgent = {
      id: "deploy-b",
      acquireConnectedGateway: vi.fn(async () => ({ client: secondGateway, release: releaseSecond })),
    };

    const { result, rerender, unmount } = renderHookWithClient(
      ({ agent }: { agent: typeof firstAgent | typeof secondAgent }) => useOpenClawSession(agent as any, true, "main"),
      { initialProps: { agent: firstAgent } },
    );

    await waitFor(() => expect(firstAgent.acquireConnectedGateway).toHaveBeenCalledTimes(1));
    rerender({ agent: secondAgent });
    await waitFor(() => expect(secondAgent.acquireConnectedGateway).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.gateway).toBe(secondGateway));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      firstLease.resolve({ client: firstGateway, release: releaseFirst });
      await firstLease.promise;
    });

    expect(releaseFirst).toHaveBeenCalledTimes(1);
    expect(releaseSecond).not.toHaveBeenCalled();
    expect(result.current.gateway).toBe(secondGateway);
    expect(result.current.status).toBe("connected");
    unmount();
    expect(releaseSecond).toHaveBeenCalledTimes(1);
  });

  it("does not render object-shaped gateway errors as object strings", async () => {
    const gateway = buildGateway("connecting");
    gateway.connect.mockRejectedValue({ detail: { message: "Gateway handshake failed" } });
    const agent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };
    const refreshedAgent = {
      id: "deploy-123",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
    firstGateway.sessionsList.mockResolvedValue([{ key: "session-first", title: "First project", lastMessageAt: 10 }]);
    const secondGateway = buildGateway();
    secondGateway.sessionsList.mockResolvedValue([{ key: "session-second", title: "Second project", lastMessageAt: 20 }]);
    const firstAgent = {
      id: "deploy-1",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => firstGateway),
    };
    const secondAgent = {
      id: "deploy-2",
      connect: vi.fn(),
      acquireConnectedGateway: acquireConnectedGatewayFixture,
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
      acquireConnectedGateway: acquireConnectedGatewayFixture,
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any, true, "main"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await waitFor(() => expect(result.current.files).toHaveLength(1));

    act(() => {
      result.current.setInput("Keep this draft");
      result.current.addPendingFiles([{ name: "draft.md", path: "/workspace/draft.md", type: "text/markdown" }]);
      result.current.addPendingMessage("Keep this queued message");
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
    expect(result.current.input).toBe("Keep this draft");
    expect(result.current.pendingFiles).toEqual([{ name: "draft.md", path: "/workspace/draft.md", type: "text/markdown" }]);
    expect(result.current.pendingInput).toEqual(["Keep this queued message"]);
    unmount();
  });

});
