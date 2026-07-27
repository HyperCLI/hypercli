import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentShellController } from "./AgentShellController";

const shellMocks = vi.hoisted(() => ({
  status: "connected" as "connected" | "connecting" | "reconnecting" | "disconnected",
  terminalReady: true,
}));

vi.mock("@/hooks/useAgentShell", () => ({
  useAgentShell: () => ({
    status: shellMocks.status,
    send: vi.fn(),
    resize: vi.fn(),
    reconnect: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAgentShellTerminal", () => ({
  useAgentShellTerminal: () => ({
    shellBoxRef: vi.fn(),
    writeOutput: vi.fn(),
    terminalReady: shellMocks.terminalReady,
    terminalError: null,
    retryTerminal: vi.fn(),
  }),
}));

vi.mock("./AgentTerminalPanel", () => ({
  AgentTerminalPanel: ({ visible }: { visible: boolean }) => <div data-visible={visible} />,
}));

describe("AgentShellController", () => {
  it("reports status only when the Shell panel is visible", () => {
    const onStatusChange = vi.fn();
    const { rerender, unmount } = render(
      <AgentShellController
        deployments={null}
        agentId="agent-1"
        visible={false}
        prewarm
        onStatusChange={onStatusChange}
      />,
    );

    expect(onStatusChange).not.toHaveBeenCalled();

    rerender(
      <AgentShellController
        deployments={null}
        agentId="agent-1"
        visible
        onStatusChange={onStatusChange}
      />,
    );
    expect(onStatusChange).toHaveBeenCalledWith("connected");

    unmount();
    expect(onStatusChange).toHaveBeenLastCalledWith("disconnected");
  });
});
