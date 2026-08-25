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

const releaseBoundaryMock = vi.hoisted(() => ({
  available: false,
}));

vi.mock("@/lib/dashboard-release-boundary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dashboard-release-boundary")>();
  return {
    ...original,
    isDashboardReleaseSurfaceAvailable: (surface: string) =>
      surface === "members" ? releaseBoundaryMock.available : original.isDashboardReleaseSurfaceAvailable(surface as never),
  };
});

import { WorkspaceOverviewPanel } from "./WorkspaceOverviewPanel";

describe("WorkspaceOverviewPanel", () => {
  const accountAgent = toAgentViewModel(buildSdkAgent({
    id: "agent-1",
    name: "research-agent",
    handle: "research-pilot",
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    releaseBoundaryMock.available = false;
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
    expect(screen.getByText("In this Collection")).toBeInTheDocument();
    expect(screen.getByText("Across Knowledge Hub")).toBeInTheDocument();
    expect(screen.queryByText("In this Workspace")).not.toBeInTheDocument();
    const knowledgeMetric = await screen.findByRole("link", { name: /Knowledge files/i });
    await waitFor(() => expect(within(knowledgeMetric).getByText("2")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("3.0k").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Research Pilot").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(onOpenAgentLauncher).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith("research-hub"));
  });

  it("hides Members entry points while the surface is unavailable", async () => {
    const onOpenMembers = vi.fn();
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
        onOpenAgentLauncher={vi.fn()}
      />,
    );

    // Header action, metric card, and embedded directory are all gated.
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Members/i })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith("research-hub"));
    expect(screen.queryByText("Visible account access")).not.toBeInTheDocument();
    expect(onOpenMembers).not.toHaveBeenCalled();
  });

  it("renders Members entry points when the release surface is available", async () => {
    releaseBoundaryMock.available = true;
    const onOpenMembers = vi.fn();
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
        onOpenAgentLauncher={vi.fn()}
      />,
    );

    // Header action, metric card, and embedded directory all render.
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByText("Visible account access")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Research Pilot")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });
});
