import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { renderWithClient } from "@/test/utils";
import { AgentLogsController } from "./AgentLogsController";

function createSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  } as unknown as WebSocket;
}

describe("AgentLogsController", () => {
  it("publishes log batches without rerendering its parent", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    let parentRenders = 0;

    function Harness() {
      parentRenders += 1;
      return <AgentLogsController deployments={deployments} agentId="agent-1" />;
    }

    renderWithClient(<Harness />);
    await waitFor(() => expect(screen.getByText("Connected. Waiting for log lines.")).toBeInTheDocument());
    const rendersBeforeLogs = parentRenders;

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ event: "log", log: "first line" }) } as MessageEvent);
      socket.onmessage?.({ data: JSON.stringify({ event: "log", log: "second line" }) } as MessageEvent);
    });

    await waitFor(() => expect(screen.getByText((_, element) => (
      element?.tagName === "PRE" && element.textContent === "first line\nsecond line"
    ))).toBeInTheDocument());
    expect(parentRenders).toBe(rendersBeforeLogs);
  });
});
