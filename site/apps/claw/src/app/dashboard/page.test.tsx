import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";

const mocks = vi.hoisted(() => ({
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
}));

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
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

vi.mock("@/components/dashboard/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/dashboard/agents/AgentPanels", () => ({
  AgentList: ({ agents }: { agents: Array<{ id: string; name: string }> }) => (
    <aside data-testid="agent-roster">{agents.map((agent) => <span key={agent.id}>{agent.name}</span>)}</aside>
  ),
}));

vi.mock("@/components/dashboard/agents/DashboardWorkspaceNavigation", () => ({
  DashboardWorkspaceNavigation: ({ workspaceName }: { workspaceName: string }) => (
    <aside data-testid="workspace-navigation">{workspaceName}</aside>
  ),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.listWorkspaces.mockResolvedValue([{ slug: "shared" }]);
    mocks.listWorkspaceFiles.mockResolvedValue([{ id: "file-1" }, { id: "file-2" }]);
  });

  it("renders the workspace overview from authenticated and API-backed data", async () => {
    render(<DashboardPage />);

    expect(screen.getByRole("heading", { name: "Jane Rivera's workspace" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-navigation")).toHaveTextContent("Jane Rivera's workspace");
    expect(await screen.findByTestId("agent-roster")).toHaveTextContent("Research Agent");

    const knowledgeMetric = await screen.findByRole("link", { name: /Knowledge files/i });
    expect(within(knowledgeMetric).getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("3.0k").length).toBeGreaterThan(0);
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(mocks.push).toHaveBeenCalledWith("/dashboard/agents?open=agent-launcher");
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith("shared"));
  });
});
