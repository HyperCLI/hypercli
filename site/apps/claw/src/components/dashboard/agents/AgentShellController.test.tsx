import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentShellController } from "./AgentShellController";

const shellMocks = vi.hoisted(() => ({
  status: "connected" as "connected" | "connecting" | "reconnecting" | "disconnected",
  terminalReady: true,
  reconnect: vi.fn(),
}));

vi.mock("@/hooks/useAgentShell", () => ({
  useAgentShell: () => ({
    status: shellMocks.status,
    send: vi.fn(),
    resize: vi.fn(),
    reconnect: shellMocks.reconnect,
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

  it("blocks reconnect before invoking shell transport", () => {
    const ref = createRef<{ reconnect: () => void }>();
    const onRequestProductUse = vi.fn(() => false);
    shellMocks.status = "disconnected";
    shellMocks.reconnect.mockClear();
    render(
      <AgentShellController
        ref={ref}
        deployments={null}
        agentId="agent-1"
        visible
        onRequestProductUse={onRequestProductUse}
      />,
    );

    act(() => ref.current?.reconnect());

    expect(onRequestProductUse).toHaveBeenCalledOnce();
    expect(shellMocks.reconnect).not.toHaveBeenCalled();
    shellMocks.status = "connected";
  });
});
