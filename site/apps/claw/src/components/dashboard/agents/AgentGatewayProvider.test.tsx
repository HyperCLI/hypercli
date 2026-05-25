import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentGatewayProvider,
  AgentGatewaySessionProvider,
  useAgentGatewaySession,
} from "./AgentGatewayProvider";

const mocks = vi.hoisted(() => ({
  useOpenClawSession: vi.fn(),
}));

vi.mock("@/hooks/useOpenClawSession", () => ({
  useOpenClawSession: mocks.useOpenClawSession,
}));

function SessionConsumer() {
  const session = useAgentGatewaySession();
  return (
    <div>
      <span data-testid="connected">{String(session.connected)}</span>
      <span data-testid="messages">{session.messages.length}</span>
    </div>
  );
}

describe("AgentGatewayProvider", () => {
  afterEach(() => {
    mocks.useOpenClawSession.mockReset();
  });

  it("owns the OpenClaw session hook and exposes one shared session to consumers", () => {
    const session = {
      connected: true,
      messages: [{ role: "assistant", content: "hello" }],
    };
    mocks.useOpenClawSession.mockReturnValue(session);
    const agent = { id: "agent-1" };

    render(
      <AgentGatewayProvider agent={agent as never} enabled>
        <SessionConsumer />
      </AgentGatewayProvider>,
    );

    expect(mocks.useOpenClawSession).toHaveBeenCalledWith(agent, true);
    expect(screen.getByTestId("connected")).toHaveTextContent("true");
    expect(screen.getByTestId("messages")).toHaveTextContent("1");
  });

  it("can expose an existing workspace-owned session without creating another SDK client", () => {
    const session = {
      connected: true,
      messages: [{ role: "assistant", content: "shared" }],
    };

    render(
      <AgentGatewaySessionProvider session={session as never}>
        <SessionConsumer />
      </AgentGatewaySessionProvider>,
    );

    expect(mocks.useOpenClawSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("connected")).toHaveTextContent("true");
    expect(screen.getByTestId("messages")).toHaveTextContent("1");
  });
});
