import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorkspacesClient: vi.fn(),
  getToken: vi.fn(),
  panel: vi.fn(),
  userId: "user-1",
  workspaces: { kind: "workspaces" },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: mocks.getToken, user: { id: mocks.userId } }),
}));

vi.mock("@/lib/agent-client", () => ({
  createWorkspacesClient: mocks.createWorkspacesClient,
}));

vi.mock("./SharedKnowledgePanel", () => ({
  SharedKnowledgePanel: (props: unknown) => {
    mocks.panel(props);
    return <div data-testid="shared-knowledge-panel" />;
  },
}));

import { SharedKnowledgeSection } from "./SharedKnowledgeSection";

type PanelProps = {
  agents: Array<{ id: string }>;
  agentsError: string | null;
  agentsLoading: boolean;
  connectionError: string | null;
  preferredAgentId: string | null;
  ready: boolean;
  workspaces: unknown;
};

function latestPanelProps(): PanelProps {
  const props = mocks.panel.mock.calls.at(-1)?.[0];
  if (!props) throw new Error("Shared knowledge panel was not rendered");
  return props as PanelProps;
}

describe("SharedKnowledgeSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = "user-1";
    mocks.getToken.mockResolvedValue("session-token");
    mocks.createWorkspacesClient.mockReturnValue(mocks.workspaces);
  });

  it("connects shared knowledge and forwards dashboard agent state", async () => {
    const agents = [{ id: "agent-docs", name: "Docs Agent", state: "RUNNING", meta: null }];

    render(
      <SharedKnowledgeSection
        agents={agents}
        agentsLoading
        agentsError="Agents refreshing"
        preferredAgentId="agent-docs"
      />,
    );

    await waitFor(() => expect(latestPanelProps()).toMatchObject({
      agents,
      agentsError: "Agents refreshing",
      agentsLoading: true,
      connectionError: null,
      preferredAgentId: "agent-docs",
      ready: true,
      workspaces: mocks.workspaces,
    }));
    expect(mocks.createWorkspacesClient).toHaveBeenCalledWith("session-token");
  });

  it("reports token failures without constructing a workspace client", async () => {
    mocks.getToken.mockRejectedValue(new Error("Session expired"));

    render(<SharedKnowledgeSection agents={[]} />);

    await waitFor(() => expect(latestPanelProps()).toMatchObject({
      connectionError: "Session expired",
      ready: false,
      workspaces: null,
    }));
    expect(mocks.createWorkspacesClient).not.toHaveBeenCalled();
  });

  it("hides the previous principal's client while a new session is loading", async () => {
    const { rerender } = render(<SharedKnowledgeSection agents={[]} />);
    await waitFor(() => expect(latestPanelProps()).toMatchObject({
      ready: true,
      workspaces: mocks.workspaces,
    }));

    mocks.userId = "user-2";
    mocks.getToken.mockReturnValueOnce(new Promise<string>(() => undefined));
    rerender(<SharedKnowledgeSection agents={[]} />);

    expect(latestPanelProps()).toMatchObject({ ready: false, workspaces: null });
  });
});
