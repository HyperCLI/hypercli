import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  panel: vi.fn(),
  userId: "user-1",
  workspacesClient: { kind: "workspaces" },
  workspace: { id: "workspace-1", name: "Team Knowledge" },
  workspaceContext: {
    workspacesClient: null as { kind: string } | null,
    workspaces: [] as Array<{ id: string; name: string }>,
    selectedWorkspaceId: null as string | null,
    selectedWorkspace: null as { id: string; name: string } | null,
    isLoading: false,
    error: null as string | null,
    selectWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ user: { id: mocks.userId } }),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspaceContext,
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
  availableWorkspaces: unknown[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onWorkspacesChanged: (preferredWorkspaceId?: string | null) => Promise<void>;
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
    mocks.workspaceContext.workspacesClient = mocks.workspacesClient;
    mocks.workspaceContext.workspaces = [mocks.workspace];
    mocks.workspaceContext.selectedWorkspaceId = mocks.workspace.id;
    mocks.workspaceContext.selectedWorkspace = mocks.workspace;
    mocks.workspaceContext.isLoading = false;
    mocks.workspaceContext.error = null;
    mocks.workspaceContext.refreshWorkspaces.mockResolvedValue(undefined);
  });

  it("forwards the shared Workspace catalog, selection, and dashboard agent state", () => {
    const agents = [{ id: "agent-docs", name: "Docs Agent", state: "RUNNING", meta: null }];

    render(
      <SharedKnowledgeSection
        agents={agents}
        agentsLoading
        agentsError="Agents refreshing"
        preferredAgentId="agent-docs"
      />,
    );

    expect(latestPanelProps()).toMatchObject({
      agents,
      agentsError: "Agents refreshing",
      agentsLoading: true,
      connectionError: null,
      preferredAgentId: "agent-docs",
      ready: true,
      workspaces: mocks.workspacesClient,
      availableWorkspaces: [mocks.workspace],
      selectedWorkspaceId: "workspace-1",
    });

    latestPanelProps().onSelectWorkspace("workspace-2");
    void latestPanelProps().onWorkspacesChanged("workspace-2");
    expect(mocks.workspaceContext.selectWorkspace).toHaveBeenCalledWith("workspace-2");
    expect(mocks.workspaceContext.refreshWorkspaces).toHaveBeenCalledWith("workspace-2");
  });

  it("forwards shared Workspace connection failures", () => {
    mocks.workspaceContext.workspacesClient = null;
    mocks.workspaceContext.workspaces = [];
    mocks.workspaceContext.selectedWorkspaceId = null;
    mocks.workspaceContext.selectedWorkspace = null;
    mocks.workspaceContext.error = "Session expired";

    render(<SharedKnowledgeSection agents={[]} />);

    expect(latestPanelProps()).toMatchObject({
      connectionError: "Session expired",
      ready: false,
      workspaces: null,
      availableWorkspaces: [],
      selectedWorkspaceId: null,
    });
  });

  it("keeps the panel pending until the shared catalog is loaded", () => {
    mocks.workspaceContext.isLoading = true;
    render(<SharedKnowledgeSection agents={[]} />);

    expect(latestPanelProps()).toMatchObject({ ready: false, workspaces: mocks.workspacesClient });
  });
});
