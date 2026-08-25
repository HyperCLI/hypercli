import { act, waitFor } from "@testing-library/react";
import { BuzzActivityGapError } from "@hypercli.com/sdk/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeployments, renderHookWithClient } from "@/test/utils";
import type { ObserverEvent } from "@/lib/buzz-activity";
import { useAgentActivity } from "./useAgentActivity";

const subscribeMocks = vi.hoisted(() => ({
  subscribeBuzzActivity: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/lib/buzz-activity/subscribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/buzz-activity/subscribe")>()),
  subscribeBuzzActivity: subscribeMocks.subscribeBuzzActivity,
}));

function frame(partial: Partial<ObserverEvent>): ObserverEvent {
  return {
    seq: 1,
    timestamp: "2026-08-25T00:00:00.000Z",
    kind: "acp_read",
    agentIndex: 0,
    channelId: null,
    sessionId: "session-1",
    turnId: "turn-1",
    payload: {},
    ...partial,
  };
}

function shellToolFrame(seq: number): ObserverEvent {
  return frame({
    seq,
    kind: "acp_read",
    payload: {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: `call-${seq}`,
          title: "shell",
          status: "in_progress",
          rawInput: { command: "ls -la" },
        },
      },
    },
  });
}

function subscriptionHandlers() {
  const call = subscribeMocks.subscribeBuzzActivity.mock.calls.at(-1);
  return call?.[2] as {
    onFrame: (frame: ObserverEvent) => void;
    onHistoryEnd?: () => void;
    onClose?: (event: { code: number; reason: string }) => void;
    onError?: (error: unknown) => void;
  };
}

describe("useAgentActivity", () => {
  beforeEach(() => {
    subscribeMocks.subscribeBuzzActivity.mockReset();
    subscribeMocks.close.mockReset();
    subscribeMocks.subscribeBuzzActivity.mockResolvedValue({ close: subscribeMocks.close });
  });

  it("subscribes through the activity transport and normalizes frames", async () => {
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(subscribeMocks.subscribeBuzzActivity).toHaveBeenCalledWith(
      deployments,
      "agent-1",
      expect.objectContaining({
        onFrame: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    ));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => {
      subscriptionHandlers().onFrame(shellToolFrame(1));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]).toMatchObject({
      renderClass: "shell",
      label: "Ran command",
      preview: "ls -la",
      status: "executing",
    });
  });

  it("flushes replayed history in a single bump on history end", async () => {
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onFrame(shellToolFrame(1));
      subscriptionHandlers().onFrame(shellToolFrame(2));
      subscriptionHandlers().onHistoryEnd?.();
    });

    expect(result.current.events).toHaveLength(2);
  });

  it("resets the journal when the agent changes and closes the old subscription", async () => {
    const deployments = mockDeployments({});
    const { result, rerender } = renderHookWithClient(
      ({ agentId }) => useAgentActivity(deployments, agentId, true),
      { initialProps: { agentId: "agent-1" as string | null } },
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onFrame(shellToolFrame(1));
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ agentId: "agent-2" });

    await waitFor(() => expect(subscribeMocks.subscribeBuzzActivity).toHaveBeenCalledWith(
      deployments,
      "agent-2",
      expect.anything(),
    ));
    expect(subscribeMocks.close).toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
  });

  it("marks transient closes disconnected and terminal closes without reconnect", async () => {
    const deployments = mockDeployments({});
    const { result, unmount } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onClose?.({ code: 1006, reason: "" });
    });
    expect(result.current.status).toBe("disconnected");
    unmount();

    subscribeMocks.subscribeBuzzActivity.mockClear();
    const terminal = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));
    await waitFor(() => expect(terminal.result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onClose?.({ code: 1000, reason: "normal closure" });
    });
    expect(terminal.result.current.status).toBe("disconnected");
    terminal.unmount();
  });

  it("surfaces stream errors with an error status", async () => {
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onError?.(new Error("activity unavailable"));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("activity unavailable");
  });

  it("keeps the stream alive on an in-pod history gap", async () => {
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      subscriptionHandlers().onFrame(shellToolFrame(1));
      subscriptionHandlers().onError?.(new BuzzActivityGapError(3));
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
    expect(subscribeMocks.close).not.toHaveBeenCalled();
  });

  it("cancels a scheduled reconnect when a terminal close drops the connection", async () => {
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(subscribeMocks.subscribeBuzzActivity).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      act(() => {
        subscriptionHandlers().onError?.(new Error("activity unavailable"));
      });
      expect(result.current.status).toBe("error");

      act(() => {
        subscriptionHandlers().onClose?.({ code: 1000, reason: "normal" });
      });
      expect(result.current.status).toBe("disconnected");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(result.current.status).toBe("disconnected");
      expect(subscribeMocks.subscribeBuzzActivity).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an error when the transport is unavailable", async () => {
    subscribeMocks.subscribeBuzzActivity.mockImplementation(() => {
      throw new Error("Activity streaming is not available yet.");
    });
    const deployments = mockDeployments({});
    const { result } = renderHookWithClient(() => useAgentActivity(deployments, "agent-1", true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Activity streaming is not available yet.");
  });

  it("closes the subscription when disabled", async () => {
    const deployments = mockDeployments({});
    const { result, rerender } = renderHookWithClient(
      ({ enabled }) => useAgentActivity(deployments, "agent-1", enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    rerender({ enabled: false });

    await waitFor(() => expect(result.current.status).toBe("disconnected"));
    expect(subscribeMocks.close).toHaveBeenCalled();
  });
});
