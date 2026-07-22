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
  const listWorkspaceGrants = vi.fn();
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
    listWorkspaceGrants,
    workspace,
    workspaceContext: {
      workspacesClient: { listGrants: listWorkspaceGrants },
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
    mocks.listWorkspaceGrants.mockResolvedValue([{
      id: "grant-owner",
      workspaceId: "workspace-1",
      subjectType: "user",
      subjectId: "user-1",
      role: "admin",
      displayName: null,
      displaySlug: null,
      isOwner: true,
      expiresAt: null,
      revokedAt: null,
    }]);
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
  });

  it("filters visible agents while retaining the account catalog for members", async () => {
    mocks.workspace.role = "admin";
    mocks.listAgents.mockResolvedValue([
      buildSdkAgent({ id: "agent-1", name: "Research Agent" }),
      buildSdkAgent({ id: "agent-2", name: "Account Catalog Agent" }),
    ]);
    mocks.listWorkspaceGrants.mockResolvedValue([{
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
    }]);

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
    expect(newAgent).toHaveAttribute("title", "Workspace admin access is required to add agents.");
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
