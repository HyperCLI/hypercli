import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderHookWithClient } from "@/test/utils";
import { useOpenClawSession } from "./useOpenClawSession";

function buildGateway() {
  const eventHandlers: Array<(event: any) => void> = [];
  const gateway = {
    state: "connected" as const,
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    onConnectionState: vi.fn((handler: (state: "connected" | "connecting" | "disconnected") => void) => {
      handler("connected");
      return vi.fn();
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
});
