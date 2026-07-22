import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspace = {
  id: "workspace-1",
  name: "Team Knowledge",
  slug: "team-knowledge",
  description: "Shared runbooks",
  displayName: null,
  displaySlug: null,
  role: "admin",
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:00Z",
};

const ownerGrant = {
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
};

const agentGrant = {
  id: "grant-agent",
  workspaceId: "workspace-1",
  subjectType: "agent",
  subjectId: "agent-1",
  role: "viewer",
  displayName: null,
  displaySlug: null,
  isOwner: false,
  expiresAt: null,
  revokedAt: null,
};

const mocks = vi.hoisted(() => ({
  auth: {
    user: {
      id: "user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    } as {
      id: string;
      email?: string;
      fullName?: string;
    } | null,
  },
  workspaces: {
    listGrants: vi.fn(),
    grant: vi.fn(),
    updateGrant: vi.fn(),
    revokeGrant: vi.fn(),
  },
  workspaceContext: {
    workspacesClient: null as Record<string, unknown> | null,
    workspaces: [] as Array<Record<string, unknown>>,
    selectedWorkspaceId: null as string | null,
    selectedWorkspace: null as Record<string, unknown> | null,
    isLoading: false,
    error: null as string | null,
    selectWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
    refreshSelectedWorkspaceAgents: vi.fn(),
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspaceContext,
}));

import { MembersSection } from "./MembersSection";

describe("MembersSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = {
      id: "user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    };
    mocks.workspaceContext.workspacesClient = mocks.workspaces;
    mocks.workspaceContext.workspaces = [workspace];
    mocks.workspaceContext.selectedWorkspaceId = workspace.id;
    mocks.workspaceContext.selectedWorkspace = workspace;
    mocks.workspaceContext.isLoading = false;
    mocks.workspaceContext.error = null;
    mocks.workspaces.listGrants.mockResolvedValue([ownerGrant, agentGrant]);
    mocks.workspaces.grant.mockResolvedValue(agentGrant);
    mocks.workspaces.updateGrant.mockImplementation(async (_workspaceId, _grantId, body) => ({
      ...agentGrant,
      role: body.role ?? agentGrant.role,
    }));
    mocks.workspaces.revokeGrant.mockResolvedValue(undefined);
    mocks.workspaceContext.refreshSelectedWorkspaceAgents.mockResolvedValue(true);
  });

  it("populates available Workspaces and their direct access grants", async () => {
    render(<MembersSection agents={[{ id: "agent-1", name: "Research Agent" }]} />);

    expect(await screen.findByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByText(/Manage direct user and agent access for Team Knowledge/)).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Jane Rivera" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Workspace" })).not.toBeInTheDocument();
    expect(mocks.workspaces.listGrants).toHaveBeenCalledWith("workspace-1");
  });

  it("refreshes grants and the selected agent roster from the visible action", async () => {
    render(<MembersSection agents={[{ id: "agent-1", name: "Research Agent" }]} />);
    await screen.findByText("Research Agent");

    fireEvent.click(screen.getByRole("button", { name: "Refresh Workspace access" }));

    await waitFor(() => expect(mocks.workspaces.listGrants).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
  });

  it("follows the Workspace selected in shared dashboard state", async () => {
    const productWorkspace = {
      ...workspace,
      id: "workspace-2",
      name: "Product Knowledge",
      slug: "product-knowledge",
    };
    const productOwner = { ...ownerGrant, id: "grant-product-owner", workspaceId: "workspace-2" };
    mocks.workspaces.listGrants
      .mockResolvedValueOnce([ownerGrant, agentGrant])
      .mockResolvedValueOnce([productOwner]);

    const view = render(<MembersSection />);
    await screen.findByText(/Manage direct user and agent access for Team Knowledge/);
    const addAccess = screen.getByRole("button", { name: "Add access" });
    fireEvent.click(addAccess);
    await waitFor(() => expect(screen.getByLabelText("Type")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("User UUID"), { target: { value: "user-from-team-draft" } });
    expect(addAccess).toHaveAttribute("aria-expanded", "true");

    mocks.workspaceContext.workspaces = [workspace, productWorkspace];
    mocks.workspaceContext.selectedWorkspaceId = productWorkspace.id;
    mocks.workspaceContext.selectedWorkspace = productWorkspace;
    view.rerender(<MembersSection />);

    expect(await screen.findByText(/Manage direct user and agent access for Product Knowledge/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.workspaces.listGrants).toHaveBeenCalledWith("workspace-2"));
    expect(screen.queryByLabelText("User UUID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    expect(screen.getByLabelText("User UUID")).toHaveValue("");
    expect(mocks.workspaces.grant).not.toHaveBeenCalled();
  });

  it("creates, updates, and revokes direct agent access", async () => {
    mocks.workspaces.listGrants
      .mockResolvedValueOnce([ownerGrant])
      .mockResolvedValueOnce([ownerGrant, agentGrant])
      .mockResolvedValueOnce([ownerGrant]);
    render(<MembersSection agents={[{ id: "agent-1", name: "Research Agent" }]} />);
    await screen.findByText("Jane Rivera");

    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "agent" } });
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agent-1" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "contributor" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));

    await waitFor(() => expect(mocks.workspaces.grant).toHaveBeenCalledWith("workspace-1", {
      subjectType: "agent",
      subjectId: "agent-1",
      role: "contributor",
      expiresAt: undefined,
    }));
    await waitFor(() => expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledTimes(1));
    const agentRole = await screen.findByRole("combobox", { name: "Role for Research Agent" });
    fireEvent.change(agentRole, { target: { value: "admin" } });
    await waitFor(() => expect(mocks.workspaces.updateGrant).toHaveBeenCalledWith("workspace-1", "grant-agent", { role: "admin" }));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove Research Agent" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove Workspace access" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(mocks.workspaces.revokeGrant).toHaveBeenCalledWith("workspace-1", "grant-agent"));
    await waitFor(() => expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledTimes(2));
  });

  it("does not refresh the agent roster for user access grants", async () => {
    mocks.workspaces.listGrants
      .mockResolvedValueOnce([ownerGrant])
      .mockResolvedValueOnce([ownerGrant]);
    render(<MembersSection />);
    await screen.findByText("Jane Rivera");

    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    fireEvent.change(screen.getByLabelText("User UUID"), { target: { value: "user-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));

    await waitFor(() => expect(mocks.workspaces.grant).toHaveBeenCalledWith("workspace-1", {
      subjectType: "user",
      subjectId: "user-2",
      role: "viewer",
      expiresAt: undefined,
    }));
    await waitFor(() => expect(mocks.workspaces.listGrants).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).not.toHaveBeenCalled();
  });

  it("shows only the signed-in account when the selected Workspace is not administered", async () => {
    const viewerWorkspace = { ...workspace, role: "viewer" };
    mocks.workspaceContext.workspaces = [viewerWorkspace];
    mocks.workspaceContext.selectedWorkspace = viewerWorkspace;
    render(<MembersSection />);

    expect(await screen.findByText("Workspace access is read-only")).toBeInTheDocument();
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add access" })).not.toBeInTheDocument();
    expect(mocks.workspaces.listGrants).not.toHaveBeenCalled();
  });

  it("renders live Workspace access in the compact dashboard panel", async () => {
    render(<MembersSection compact agents={[{ id: "agent-1", name: "Research Agent" }]} />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/dashboard/agents?section=members");
    expect(await screen.findByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
  });

  it("reports shared Workspace connection failures", async () => {
    mocks.workspaceContext.workspacesClient = null;
    mocks.workspaceContext.workspaces = [];
    mocks.workspaceContext.selectedWorkspaceId = null;
    mocks.workspaceContext.selectedWorkspace = null;
    mocks.workspaceContext.error = "Session expired";
    render(<MembersSection />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Session expired")).toBeInTheDocument();
    expect(mocks.workspaces.listGrants).not.toHaveBeenCalled();
  });
});
