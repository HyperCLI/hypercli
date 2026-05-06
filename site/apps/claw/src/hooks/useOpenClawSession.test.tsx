import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderHookWithClient } from "@/test/utils";
import { useOpenClawSession } from "./useOpenClawSession";

function buildGateway() {
  return {
    state: "connected" as const,
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    onConnectionState: vi.fn((handler: (state: "connected" | "connecting" | "disconnected") => void) => {
      handler("connected");
      return vi.fn();
    }),
    onEvent: vi.fn(() => vi.fn()),
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
    configPatch: vi.fn(async () => undefined),
    configSet: vi.fn(async () => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
  };
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
});
