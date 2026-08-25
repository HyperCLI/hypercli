import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeployments, renderWithClient } from "@/test/utils";
import type { ObserverEvent } from "@/lib/buzz-activity";
import { AgentActivityController } from "./AgentActivityController";

const subscribeMocks = vi.hoisted(() => ({
  subscribeBuzzActivity: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/lib/buzz-activity/subscribe", () => ({
  subscribeBuzzActivity: subscribeMocks.subscribeBuzzActivity,
}));

function shellToolFrame(seq: number): ObserverEvent {
  return {
    seq,
    timestamp: "2026-08-25T00:00:00.000Z",
    kind: "acp_read",
    agentIndex: 0,
    channelId: null,
    sessionId: "session-1",
    turnId: "turn-1",
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
  };
}

describe("AgentActivityController", () => {
  beforeEach(() => {
    subscribeMocks.subscribeBuzzActivity.mockReset();
    subscribeMocks.close.mockReset();
    subscribeMocks.subscribeBuzzActivity.mockResolvedValue({ close: subscribeMocks.close });
  });

  it("renders streamed activity without rerendering its parent", async () => {
    const deployments = mockDeployments({});
    let parentRenders = 0;

    function Harness() {
      parentRenders += 1;
      return <AgentActivityController deployments={deployments} agentId="agent-1" visible />;
    }

    renderWithClient(<Harness />);
    await waitFor(() => expect(screen.getByTestId("agents-activity-empty")).toBeInTheDocument());
    const rendersBeforeEvents = parentRenders;

    const handlers = subscribeMocks.subscribeBuzzActivity.mock.calls.at(-1)?.[2] as {
      onFrame: (frame: ObserverEvent) => void;
    };
    await act(async () => {
      handlers.onFrame(shellToolFrame(1));
    });

    await waitFor(() => expect(screen.getAllByTestId("agents-activity-event")).toHaveLength(1));
    expect(screen.getByText("Ran command")).toBeInTheDocument();
    expect(parentRenders).toBe(rendersBeforeEvents);
  });

  it("reports status changes and resets on unmount", async () => {
    const deployments = mockDeployments({});
    const onStatusChange = vi.fn();

    const { unmount } = renderWithClient(
      <AgentActivityController deployments={deployments} agentId="agent-1" visible onStatusChange={onStatusChange} />,
    );

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("connected"));
    unmount();
    expect(onStatusChange).toHaveBeenLastCalledWith("disconnected");
    expect(subscribeMocks.close).toHaveBeenCalled();
  });
});
