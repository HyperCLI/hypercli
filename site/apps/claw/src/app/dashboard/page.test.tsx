import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";

const mocks = vi.hoisted(() => {
  const workspace = {
    id: "workspace-1",
    name: "Shared knowledge",
    slug: "shared",
    description: null,
    displayName: "Research Hub",
    displaySlug: null,
    role: "viewer",
    createdAt: null,
    updatedAt: null,
  };
  const workspaceAccessSnapshot = vi.fn();
  return {
    getToken: vi.fn(),
    logout: vi.fn(),
    push: vi.fn(),
    listAgents: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    usageHistory: vi.fn(),
    keyUsage: vi.fn(),
    listWorkspaces: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    workspaceAccessSnapshot,
    userProfile: vi.fn(),
    authMe: vi.fn(),
    workspace,
    workspaceContext: {
      workspacesClient: {
        accessSnapshot: workspaceAccessSnapshot,
      },
      workspaces: [workspace],
      selectedWorkspaceId: workspace.id,
      selectedWorkspace: workspace,
      selectedWorkspaceAgentIds: ["agent-1"] as string[],
      isAgentRosterLoading: false,
      agentRosterError: null as string | null,
      isLoading: false,
      error: null,
      selectWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      refreshSelectedWorkspaceAgents: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.getToken,
    isLoading: false,
    logout: mocks.logout,
    user: { id: "user-1", fullName: "Jane Rivera", email: "jane@example.com" },
  }),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return {
      user: {
        get: mocks.userProfile,
        authMe: mocks.authMe,
      },
    };
  }),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspaceContext,
  workspaceAgentCreationDisabledReason: (workspace: { role?: string } | null, rosterError: string | null) => {
    if (!workspace) return "Select a Workspace before launching an agent.";
    if (workspace.role !== "admin") return "Workspace admin access is required to add agents.";
    if (rosterError) return "Workspace agents could not be loaded. Refresh before launching an agent.";
    return null;
  },
  workspaceDisplayName: (workspace: { displayName: string | null; name: string }) => workspace.displayName || workspace.name,
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: () => ({
    list: mocks.listAgents,
    update: mocks.updateAgent,
    delete: mocks.deleteAgent,
  }),
  createHyperAgentClient: () => ({
    usageHistory: mocks.usageHistory,
    keyUsage: mocks.keyUsage,
  }),
  createOpenClawAgent: vi.fn(),
  createWorkspacesClient: () => ({
    list: mocks.listWorkspaces,
    listFiles: mocks.listWorkspaceFiles,
  }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  Button: ({ children, onClick, disabled, title }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title}>{children}</button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/dashboard/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/dashboard/agents/AgentPanels", () => ({
  AgentList: ({ agents, rosterLoading }: {
    agents: Array<{ id: string; name: string }>;
    rosterLoading?: boolean;
  }) => (
    <aside data-testid="agent-roster" data-roster-loading={String(Boolean(rosterLoading))}>
      {agents.map((agent) => <span key={agent.id}>{agent.name}</span>)}
    </aside>
  ),
}));

vi.mock("@/components/dashboard/agents/DashboardWorkspaceNavigation", () => ({
  DashboardWorkspaceNavigation: ({ selectedAgent }: { selectedAgent: { id: string } | null }) => (
    <aside data-testid="workspace-navigation" data-agent-id={selectedAgent?.id ?? ""}>Workspace navigation</aside>
  ),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspace.role = "viewer";
    mocks.workspaceContext.selectedWorkspaceAgentIds = ["agent-1"];
    mocks.workspaceContext.isAgentRosterLoading = false;
    mocks.workspaceContext.agentRosterError = null;
    mocks.getToken.mockResolvedValue("session-token");
    mocks.userProfile.mockResolvedValue({
      userId: "user-1",
      name: "Jane Rivera",
      email: "jane@example.com",
    });
    mocks.authMe.mockResolvedValue({ userId: "user-1", orchestraUserId: null });
    mocks.listAgents.mockResolvedValue([buildSdkAgent({ name: "Research Agent" })]);
    mocks.usageHistory.mockResolvedValue({
      history: [
        { date: "2026-07-20", totalTokens: 3000, promptTokens: 1200, completionTokens: 1800, requests: 12 },
      ],
    });
    mocks.keyUsage.mockResolvedValue({
      keys: [{ keyHash: "key-1", name: "Slack", totalTokens: 3000, requests: 12 }],
    });
    mocks.listWorkspaces.mockResolvedValue([mocks.workspace]);
    mocks.listWorkspaceFiles.mockResolvedValue([{ id: "file-1" }, { id: "file-2" }]);
    mocks.workspaceAccessSnapshot.mockImplementation(async () => {
      if (mocks.workspace.role !== "admin") {
        return {
          workspace: mocks.workspace,
          currentRole: mocks.workspace.role,
          visibility: "current-access-only",
          capturedAt: "2026-07-22T12:00:00.000Z",
          entries: null,
          grants: null,
        };
      }
      const grant = {
        id: "grant-admin",
        workspaceId: "workspace-1",
        subjectType: "user",
        subjectId: "user-1",
        role: "admin",
        displayName: "Jane Rivera",
        displaySlug: null,
        isOwner: true,
        expiresAt: null,
        revokedAt: null,
      };
      return {
        workspace: mocks.workspace,
        currentRole: "admin",
        visibility: "all-direct-access",
        capturedAt: "2026-07-22T12:00:00.000Z",
        entries: [{
          workspaceId: "workspace-1",
          subjectType: "user",
          subjectId: "user-1",
          role: "admin",
          displayName: "Jane Rivera",
          displaySlug: null,
          grants: [grant],
        }],
        grants: [grant],
      };
    });
  });

  it("renders the workspace overview from authenticated and API-backed data", async () => {
    mocks.workspace.role = "admin";
    render(<DashboardPage />);

    expect(screen.getByRole("heading", { name: "Research Hub" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-navigation")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("agent-roster")).toHaveTextContent("Research Agent"));

    const knowledgeMetric = await screen.findByRole("link", { name: /Knowledge files/i });
    expect(within(knowledgeMetric).getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("3.0k").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(mocks.push).toHaveBeenCalledWith("/dashboard/agents?open=agent-launcher");
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith("shared"));
    await waitFor(() => expect(mocks.workspaceAccessSnapshot).toHaveBeenCalledWith("workspace-1"));
  });

  it("filters visible agents while retaining the account catalog for members", async () => {
    mocks.workspace.role = "admin";
    mocks.listAgents.mockResolvedValue([
      buildSdkAgent({ id: "agent-1", name: "Research Agent" }),
      buildSdkAgent({ id: "agent-2", name: "Account Catalog Agent" }),
    ]);
    const agentGrant = {
      id: "grant-agent-2",
      workspaceId: "workspace-1",
      subjectType: "agent",
      subjectId: "agent-2",
      role: "viewer",
      displayName: null,
      displaySlug: null,
      isOwner: false,
      expiresAt: null,
      revokedAt: null,
    };
    const userGrant = {
      id: "grant-admin",
      workspaceId: "workspace-1",
      subjectType: "user",
      subjectId: "user-1",
      role: "admin",
      displayName: "Jane Rivera",
      displaySlug: null,
      isOwner: true,
      expiresAt: null,
      revokedAt: null,
    };
    mocks.workspaceAccessSnapshot.mockResolvedValue({
      workspace: mocks.workspace,
      currentRole: "admin",
      visibility: "all-direct-access",
      capturedAt: "2026-07-22T12:00:00.000Z",
      entries: [
        {
          workspaceId: "workspace-1",
          subjectType: "user",
          subjectId: "user-1",
          role: "admin",
          displayName: "Jane Rivera",
          displaySlug: null,
          grants: [userGrant],
        },
        {
          workspaceId: "workspace-1",
          subjectType: "agent",
          subjectId: "agent-2",
          role: "viewer",
          displayName: null,
          displaySlug: null,
          grants: [agentGrant],
        },
      ],
      grants: [userGrant, agentGrant],
    });

    render(<DashboardPage />);

    const roster = screen.getByTestId("agent-roster");
    await waitFor(() => expect(roster).toHaveTextContent("Research Agent"));
    expect(roster).not.toHaveTextContent("Account Catalog Agent");
    expect(screen.getByTestId("workspace-navigation")).toHaveAttribute("data-agent-id", "agent-1");
    expect(screen.getByText(/1 member.*1 agent/)).toBeInTheDocument();

    const agentsMetric = screen.getByRole("link", { name: /Agents/ });
    expect(within(agentsMetric).getByText("1")).toBeInTheDocument();
    expect(within(agentsMetric).getByText("In this Workspace")).toBeInTheDocument();

    const usageSection = screen.getByRole("heading", { name: "Agent usage table" }).closest("section");
    expect(usageSection).not.toBeNull();
    const researchRow = within(usageSection!).getByRole("cell", { name: "Research Agent" }).closest("tr");
    expect(researchRow).not.toBeNull();
    expect(within(researchRow!).getAllByText("---")).toHaveLength(3);
    expect(within(usageSection!).queryByRole("cell", { name: "Account Catalog Agent" })).not.toBeInTheDocument();

    expect(await screen.findByText("Account Catalog Agent")).toBeInTheDocument();
  });

  it("disables agent creation for a read-only Workspace member", async () => {
    render(<DashboardPage />);

    await waitFor(() => expect(mocks.listAgents).toHaveBeenCalled());
    const newAgent = screen.getByRole("button", { name: "New agent" });
    expect(newAgent).toBeDisabled();
    expect(screen.getByText("Workspace admin access is required to add agents.")).toBeInTheDocument();
  });

  it("keeps the roster empty while Workspace membership is loading", async () => {
    mocks.workspaceContext.isAgentRosterLoading = true;

    render(<DashboardPage />);

    await waitFor(() => expect(mocks.listAgents).toHaveBeenCalled());
    expect(screen.getByTestId("agent-roster")).toBeEmptyDOMElement();
    expect(screen.getByTestId("agent-roster")).toHaveAttribute("data-roster-loading", "true");
  });

  it("surfaces Workspace membership errors without exposing account agents", async () => {
    mocks.workspaceContext.agentRosterError = "Could not load Workspace agents.";

    render(<DashboardPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load Workspace agents.");
    await waitFor(() => expect(mocks.listAgents).toHaveBeenCalled());
    expect(screen.getByTestId("agent-roster")).toBeEmptyDOMElement();
  });
});
