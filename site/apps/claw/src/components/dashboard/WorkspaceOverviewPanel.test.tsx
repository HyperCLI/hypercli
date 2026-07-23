import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { buildSdkAgent } from "@/test/factories";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  usageHistory: vi.fn(),
  keyUsage: vi.fn(),
  listWorkspaces: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  selectedWorkspace: {
    id: "workspace-1",
    name: "research-hub",
    slug: "research-hub",
    description: null,
    displayName: "Research Hub",
    displaySlug: null,
    role: "admin",
    createdAt: null,
    updatedAt: null,
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.getToken,
    isLoading: false,
    user: { id: "user-1", fullName: "Jane Rivera", email: "jane@example.com" },
  }),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => ({ selectedWorkspace: mocks.selectedWorkspace }),
  workspaceDisplayName: (workspace: { displayName: string | null; name: string }) => workspace.displayName || workspace.name,
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: () => ({
    usageHistory: mocks.usageHistory,
    keyUsage: mocks.keyUsage,
  }),
  createWorkspacesClient: () => ({
    list: mocks.listWorkspaces,
    listFiles: mocks.listWorkspaceFiles,
  }),
}));

vi.mock("@/components/ClawTooltip", () => ({
  TooltipHint: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/dashboard/members/MembersSection", () => ({
  MembersSection: ({ agents }: { agents: Array<{ name: string }> }) => (
    <section>{agents.map((agent) => <span key={agent.name}>{agent.name}</span>)}</section>
  ),
}));

import { WorkspaceOverviewPanel } from "./WorkspaceOverviewPanel";

describe("WorkspaceOverviewPanel", () => {
  const accountAgent = toAgentViewModel(buildSdkAgent({ id: "agent-1", name: "Research Agent" }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getToken.mockResolvedValue("session-token");
    mocks.usageHistory.mockResolvedValue({
      history: [{ date: "2026-07-20", totalTokens: 3000, promptTokens: 1200, completionTokens: 1800, requests: 12 }],
    });
    mocks.keyUsage.mockResolvedValue({
      keys: [{ keyHash: "key-1", name: "Slack", totalTokens: 3000, requests: 12 }],
    });
    mocks.listWorkspaces.mockResolvedValue([mocks.selectedWorkspace]);
    mocks.listWorkspaceFiles.mockResolvedValue([{ id: "file-1" }, { id: "file-2" }]);
  });

  it("renders API-backed overview content and delegates navigation", async () => {
    const onOpenMembers = vi.fn();
    const onOpenAgentLauncher = vi.fn();
    render(
      <WorkspaceOverviewPanel
        accountAgents={[accountAgent]}
        workspaceAgents={[accountAgent]}
        agentsLoading={false}
        workspaceAgentsLoading={false}
        agentCreationDisabledReason={null}
        agentsHref="/dashboard/agents?agentId=agent-1"
        knowledgeHref="/dashboard/agents?section=knowledge&agentId=agent-1"
        membersHref="/dashboard/agents?section=members&agentId=agent-1"
        onOpenMembers={onOpenMembers}
        onOpenAgentLauncher={onOpenAgentLauncher}
      />,
    );

    expect(screen.getByRole("heading", { name: "Research Hub" })).toBeInTheDocument();
    const knowledgeMetric = await screen.findByRole("link", { name: /Knowledge files/i });
    await waitFor(() => expect(within(knowledgeMetric).getByText("2")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("3.0k").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Research Agent").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(onOpenMembers).toHaveBeenCalledOnce();
    expect(onOpenAgentLauncher).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith("research-hub"));
  });
});
