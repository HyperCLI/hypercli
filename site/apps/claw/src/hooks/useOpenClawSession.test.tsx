import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    configGet: vi.fn(async () => ({ llm: { model: "old-model" } })),
    configSchema: vi.fn(async () => ({
      schema: {
        type: "object",
        properties: {
          llm: { type: "object", properties: { model: { type: "string" } } },
        },
      },
      uiHints: {},
    })),
    chatHistory: vi.fn(async () => []),
    agentsList: vi.fn(async () => [{ id: "agent-1" }]),
    sessionsList: vi.fn(async () => []),
    cronList: vi.fn(async () => []),
    modelsList: vi.fn(async () => []),
    filesList: vi.fn(async () => []),
    sendChat: vi.fn(async () => ({ runId: "run-1" })),
    chatSend: vi.fn(async function* () {
      yield { type: "done" as const };
    }),
    configPatch: vi.fn(async () => undefined),
    configSet: vi.fn(async () => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
  };
  return gateway;
}

describe("useOpenClawSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    const agent = {
      id: "agent-1",
      connect: vi.fn(),
      waitForGatewayContext: vi.fn(async () => undefined),
      gateway: vi.fn(() => gateway),
    };

    const { result, unmount } = renderHookWithClient(() => useOpenClawSession(agent as any));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.config).toEqual({ llm: { model: "old-model" } }));

    await act(async () => {
      await result.current.saveConfig({ llm: { model: "new-model" } });
    });
    expect(gateway.configPatch).toHaveBeenCalledWith({ llm: { model: "new-model" } });

    await act(async () => {
      await result.current.saveFullConfig({ llm: { model: "full-model" } });
    });
    expect(gateway.configSet).toHaveBeenCalledWith({ llm: { model: "full-model" } });

    await act(async () => {
      await result.current.channelsStatus(true, 2500);
    });
    expect(gateway.channelsStatus).toHaveBeenCalledWith(true, 2500);

    expect(agent.gateway).toHaveBeenCalledTimes(1);
    expect(gateway.connect).toHaveBeenCalledTimes(1);
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
      gateway.emit({ event: "chat.content", payload: { text: "Hello" } });
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
      gateway.emit({ event: "chat.done", payload: {} });
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

  it("surfaces a retryable error when opening the gateway session stalls", async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) => {
      if (timeout === 30_000 && typeof handler === "function") {
        handler(...args);
        return 0;
      }
      return originalSetTimeout(handler, timeout, ...args);
    });
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

  it("keeps visible conversation history when the SDK reports a disconnect before reconnecting", async () => {
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
