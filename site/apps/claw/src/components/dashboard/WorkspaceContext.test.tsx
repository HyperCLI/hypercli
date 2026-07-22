import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamWorkspace = {
  id: "workspace-team",
  name: "Team Knowledge",
  slug: "team-knowledge",
  description: "Shared runbooks",
  displayName: null,
  displaySlug: null,
  role: "admin",
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:00Z",
};

const productWorkspace = {
  ...teamWorkspace,
  id: "workspace-product",
  name: "Product Operations",
  slug: "product-operations",
};

const discoveredWorkspace = {
  ...teamWorkspace,
  id: "workspace-discovered",
  name: "Discovered Workspace",
  slug: "discovered-workspace",
};

function workspaceAgent(agentId: string, workspaceId = teamWorkspace.id) {
  return {
    workspaceId,
    agentId,
    role: "viewer",
    expiresAt: null,
  };
}

const mocks = vi.hoisted(() => ({
  auth: {
    getToken: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    user: { id: "user-1" } as { id: string } | null,
  },
  createWorkspacesClient: vi.fn(),
  client: {
    list: vi.fn(),
    listAgents: vi.fn(),
    listGrants: vi.fn(),
    create: vi.fn(),
    grant: vi.fn(),
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/lib/agent-client", () => ({
  createWorkspacesClient: mocks.createWorkspacesClient,
}));

import {
  WorkspaceProvider,
  useWorkspace,
  workspaceAgentCreationDisabledReason,
} from "./WorkspaceContext";

describe("workspaceAgentCreationDisabledReason", () => {
  it("requires a selected Workspace with admin access and a healthy roster", () => {
    expect(workspaceAgentCreationDisabledReason(null, null)).toBe("Select a Workspace before launching an agent.");
    expect(workspaceAgentCreationDisabledReason({ ...teamWorkspace, role: "viewer" }, null)).toBe(
      "Workspace admin access is required to add agents.",
    );
    expect(workspaceAgentCreationDisabledReason(teamWorkspace, "Unavailable")).toBe(
      "Workspace agents could not be loaded. Refresh before launching an agent.",
    );
    expect(workspaceAgentCreationDisabledReason(teamWorkspace, null)).toBeNull();
  });
});

function WorkspaceConsumer() {
  const [associationError, setAssociationError] = useState("none");
  const {
    workspaces,
    selectedWorkspace,
    selectedWorkspaceAgentIds,
    isAgentRosterLoading,
    agentRosterError,
    isLoading,
    error,
    selectWorkspace,
    createWorkspace,
    refreshSelectedWorkspaceAgents,
    associateAgentWithSelectedWorkspace,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="workspace-state">
        {isLoading ? "loading" : error || selectedWorkspace?.name || "none"}
      </span>
      <span data-testid="workspace-count">{workspaces.length}</span>
      <span data-testid="agent-roster-state">{isAgentRosterLoading ? "loading" : "resolved"}</span>
      <span data-testid="agent-roster-error">{agentRosterError || "none"}</span>
      <span data-testid="agent-roster-ids">{JSON.stringify(selectedWorkspaceAgentIds)}</span>
      <span data-testid="association-error">{associationError}</span>
      <button type="button" onClick={() => selectWorkspace("workspace-team")}>Select team</button>
      <button type="button" onClick={() => selectWorkspace("workspace-product")}>Select product</button>
      <button type="button" onClick={() => selectWorkspace(discoveredWorkspace.id, discoveredWorkspace)}>Select discovered</button>
      <button type="button" onClick={() => { void createWorkspace({ name: "Product Operations" }).catch(() => undefined); }}>Create product</button>
      <button type="button" onClick={() => { void refreshSelectedWorkspaceAgents(); }}>Refresh agents</button>
      <button
        type="button"
        onClick={() => {
          void associateAgentWithSelectedWorkspace("agent-new").then(
            () => setAssociationError("none"),
            (cause: unknown) => setAssociationError(cause instanceof Error ? cause.message : "failed"),
          );
        }}
      >
        Associate agent
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <WorkspaceProvider>
      <WorkspaceConsumer />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.auth.getToken.mockResolvedValue("session-token");
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.user = { id: "user-1" };
    mocks.createWorkspacesClient.mockReturnValue(mocks.client);
    mocks.client.list.mockResolvedValue([teamWorkspace, productWorkspace]);
    mocks.client.listAgents.mockResolvedValue([]);
    mocks.client.listGrants.mockResolvedValue([]);
    mocks.client.create.mockResolvedValue(productWorkspace);
    mocks.client.grant.mockResolvedValue({
      id: "grant-agent-new",
      workspaceId: teamWorkspace.id,
      subjectType: "agent",
      subjectId: "agent-new",
      role: "viewer",
      displayName: null,
      displaySlug: null,
      isOwner: false,
      expiresAt: null,
      revokedAt: null,
    });
  });

  it("lists agents for the initially selected Workspace", async () => {
    let resolveAgents: ((associations: ReturnType<typeof workspaceAgent>[]) => void) | undefined;
    mocks.client.listAgents.mockReturnValue(new Promise((resolve) => { resolveAgents = resolve; }));

    renderProvider();

    await waitFor(() => expect(mocks.client.listAgents).toHaveBeenCalledWith("workspace-team"));
    expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("loading");
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");

    await act(async () => { resolveAgents?.([workspaceAgent("agent-1")]); });
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-1"]');
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("none");
  });

  it("deduplicates selected Workspace agent IDs", async () => {
    mocks.client.listAgents.mockResolvedValue([
      workspaceAgent("agent-1"),
      workspaceAgent("agent-1"),
      workspaceAgent("agent-2"),
    ]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-1","agent-2"]'));
  });

  it("represents a resolved Workspace with no associated agents", async () => {
    renderProvider();

    await waitFor(() => expect(mocks.client.listAgents).toHaveBeenCalledWith("workspace-team"));
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("none");
  });

  it("falls back to active admin-visible grants when the roster route is not deployed", async () => {
    mocks.client.listAgents.mockRejectedValue(Object.assign(new Error("Not found"), { statusCode: 404 }));
    mocks.client.listGrants.mockResolvedValue([
      {
        id: "grant-active",
        workspaceId: teamWorkspace.id,
        subjectType: "agent",
        subjectId: "agent-active",
        role: "viewer",
        displayName: null,
        displaySlug: null,
        isOwner: false,
        expiresAt: null,
        revokedAt: null,
      },
      {
        id: "grant-revoked",
        workspaceId: teamWorkspace.id,
        subjectType: "agent",
        subjectId: "agent-revoked",
        role: "viewer",
        displayName: null,
        displaySlug: null,
        isOwner: false,
        expiresAt: null,
        revokedAt: "2026-07-20T11:00:00Z",
      },
      {
        id: "grant-expired",
        workspaceId: teamWorkspace.id,
        subjectType: "agent",
        subjectId: "agent-expired",
        role: "viewer",
        displayName: null,
        displaySlug: null,
        isOwner: false,
        expiresAt: "2020-01-01T00:00:00Z",
        revokedAt: null,
      },
    ]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-active"]'));
    expect(mocks.client.listGrants).toHaveBeenCalledWith(teamWorkspace.id);
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("none");
  });

  it("reports selected Workspace agent loading failures without fallback IDs", async () => {
    mocks.client.listAgents.mockRejectedValue(new Error("Agent roster unavailable"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("Agent roster unavailable"));
    expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved");
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");
  });

  it("masks old IDs and ignores a late roster response after a Workspace switch", async () => {
    let resolveTeamRefresh: ((associations: ReturnType<typeof workspaceAgent>[]) => void) | undefined;
    let resolveProduct: ((associations: ReturnType<typeof workspaceAgent>[]) => void) | undefined;
    const pendingTeamRefresh = new Promise<ReturnType<typeof workspaceAgent>[]>((resolve) => { resolveTeamRefresh = resolve; });
    const pendingProduct = new Promise<ReturnType<typeof workspaceAgent>[]>((resolve) => { resolveProduct = resolve; });
    mocks.client.listAgents.mockImplementation((workspaceId: string) => {
      if (workspaceId === productWorkspace.id) return pendingProduct;
      if (mocks.client.listAgents.mock.calls.length === 1) return Promise.resolve([workspaceAgent("agent-team")]);
      return pendingTeamRefresh;
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-team"]'));

    fireEvent.click(screen.getByRole("button", { name: "Refresh agents" }));
    await waitFor(() => expect(mocks.client.listAgents).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Select product" }));

    expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("loading");
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");
    await waitFor(() => expect(mocks.client.listAgents).toHaveBeenCalledWith("workspace-product"));
    await act(async () => { resolveProduct?.([workspaceAgent("agent-product", productWorkspace.id)]); });
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-product"]'));

    await act(async () => { resolveTeamRefresh?.([workspaceAgent("agent-stale")]); });
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-product"]');
  });

  it("grants viewer access and refreshes membership for an admin", async () => {
    mocks.client.listAgents
      .mockResolvedValueOnce([workspaceAgent("agent-existing")])
      .mockResolvedValueOnce([workspaceAgent("agent-existing"), workspaceAgent("agent-new")]);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-existing"]'));
    fireEvent.click(screen.getByRole("button", { name: "Associate agent" }));

    await waitFor(() => expect(mocks.client.grant).toHaveBeenCalledWith("workspace-team", {
      subjectType: "agent",
      subjectId: "agent-new",
      role: "viewer",
    }));
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-existing","agent-new"]'));
    expect(mocks.client.listAgents).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("association-error")).toHaveTextContent("none");
  });

  it("does not report association complete when the roster cannot refresh", async () => {
    mocks.client.listAgents
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Roster refresh failed"));

    renderProvider();
    await waitFor(() => expect(mocks.client.listAgents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    fireEvent.click(screen.getByRole("button", { name: "Associate agent" }));

    await waitFor(() => expect(screen.getByTestId("association-error")).toHaveTextContent(
      "The agent was added to the selected Workspace, but the roster could not be refreshed.",
    ));
    expect(mocks.client.grant).toHaveBeenCalledOnce();
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("Roster refresh failed");
  });

  it("rejects automatic association without Workspace admin access", async () => {
    mocks.client.list.mockResolvedValue([{ ...teamWorkspace, role: "viewer" }]);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    fireEvent.click(screen.getByRole("button", { name: "Associate agent" }));

    await waitFor(() => expect(screen.getByTestId("association-error")).toHaveTextContent("Workspace admin access is required to add agents."));
    expect(mocks.client.grant).not.toHaveBeenCalled();
  });

  it("restores and persists the selected Workspace for the signed-in account", async () => {
    window.localStorage.setItem("claw.selectedWorkspace.v1:user-1", "workspace-product");

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Product Operations"));
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("2");
    expect(mocks.createWorkspacesClient).toHaveBeenCalledWith("session-token");
    expect(mocks.client.list).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Select team" }));
    expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge");
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBe("workspace-team");
  });

  it("refreshes the catalog and selects a newly created Workspace", async () => {
    mocks.client.list
      .mockResolvedValueOnce([teamWorkspace])
      .mockResolvedValueOnce([teamWorkspace, productWorkspace]);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => expect(mocks.client.create).toHaveBeenCalledWith({ name: "Product Operations" }));
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Product Operations"));
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBe("workspace-product");
  });

  it("registers an authorized Workspace discovered by search before selecting it", async () => {
    mocks.client.list.mockResolvedValue([teamWorkspace]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));

    fireEvent.click(screen.getByRole("button", { name: "Select discovered" }));

    expect(screen.getByTestId("workspace-state")).toHaveTextContent("Discovered Workspace");
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("2");
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBe("workspace-discovered");
  });

  it("reports token failures without exposing a stale catalog", async () => {
    mocks.auth.getToken.mockRejectedValue(new Error("Session expired"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Session expired"));
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("0");
    expect(mocks.createWorkspacesClient).not.toHaveBeenCalled();
  });

  it("ignores a stale creation refresh after the signed-in account changes", async () => {
    let resolveCreate: ((workspace: typeof productWorkspace) => void) | undefined;
    const pendingCreate = new Promise<typeof productWorkspace>((resolve) => { resolveCreate = resolve; });
    const secondAccountWorkspace = {
      ...teamWorkspace,
      id: "workspace-second-account",
      name: "Second Account",
      slug: "second-account",
    };
    const secondClient = {
      list: vi.fn(async () => [secondAccountWorkspace]),
      listAgents: vi.fn(async () => []),
      create: vi.fn(),
      grant: vi.fn(),
    };
    mocks.client.list.mockResolvedValue([teamWorkspace]);
    mocks.client.create.mockReturnValue(pendingCreate);
    mocks.auth.getToken.mockImplementation(async () => mocks.auth.user?.id === "user-2" ? "token-2" : "token-1");
    mocks.createWorkspacesClient.mockImplementation((token: string) => token === "token-2" ? secondClient : mocks.client);

    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(mocks.client.create).toHaveBeenCalledOnce());

    mocks.auth.user = { id: "user-2" };
    view.rerender(
      <WorkspaceProvider>
        <WorkspaceConsumer />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Second Account"));

    await act(async () => { resolveCreate?.(productWorkspace); });
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Second Account"));
    expect(secondClient.list).toHaveBeenCalledOnce();
    expect(mocks.client.list).toHaveBeenCalledOnce();
  });
});
