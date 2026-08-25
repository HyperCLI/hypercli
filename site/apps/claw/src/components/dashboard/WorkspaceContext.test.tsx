import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const generalWorkspace = {
  ...teamWorkspace,
  id: "workspace-general",
  name: "General",
  slug: "general",
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
    get: vi.fn(),
    listAgentAssociations: vi.fn(),
    listGrants: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    grant: vi.fn(),
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/lib/agent-client", () => ({
  createWorkspacesClient: mocks.createWorkspacesClient,
}));

const releaseBoundaryMock = vi.hoisted(() => ({
  knowledgeHubAvailable: true,
}));

vi.mock("@/lib/dashboard-release-boundary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dashboard-release-boundary")>();
  return {
    ...original,
    isDashboardReleaseSurfaceAvailable: (surface: string) =>
      surface === "knowledge-hub"
        ? releaseBoundaryMock.knowledgeHubAvailable
        : original.isDashboardReleaseSurfaceAvailable(surface as never),
  };
});

import {
  WorkspaceProvider,
  useWorkspace,
  workspaceAgentCreationDisabledReason,
} from "./WorkspaceContext";

describe("workspaceAgentCreationDisabledReason", () => {
  it("requires a selected Workspace with admin access and a healthy roster", () => {
    expect(workspaceAgentCreationDisabledReason(null, null)).toBe("Select a Collection before launching an agent.");
    expect(workspaceAgentCreationDisabledReason({ ...teamWorkspace, role: "viewer" }, null)).toBe(
      "Collection admin access is required to add agents.",
    );
    expect(workspaceAgentCreationDisabledReason(teamWorkspace, "Unavailable")).toBe(
      "Collection agents could not be loaded. Refresh before launching an agent.",
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
    refreshWorkspaces,
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
      <button type="button" onClick={() => { void refreshWorkspaces(); }}>Refresh Workspaces</button>
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
    // Existing coverage exercises the enabled Collection workflow.
    releaseBoundaryMock.knowledgeHubAvailable = true;
    mocks.auth.getToken.mockResolvedValue("session-token");
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.user = { id: "user-1" };
    mocks.createWorkspacesClient.mockReturnValue(mocks.client);
    mocks.client.list.mockResolvedValue([teamWorkspace, productWorkspace, generalWorkspace]);
    mocks.client.get.mockResolvedValue(generalWorkspace);
    mocks.client.listAgentAssociations.mockResolvedValue([]);
    mocks.client.listGrants.mockResolvedValue([]);
    mocks.client.create.mockResolvedValue(generalWorkspace);
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
    mocks.client.listAgentAssociations.mockReturnValue(new Promise((resolve) => { resolveAgents = resolve; }));

    renderProvider();

    await waitFor(() => expect(mocks.client.listAgentAssociations).toHaveBeenCalledWith("workspace-team"));
    expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("loading");
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");

    await act(async () => { resolveAgents?.([workspaceAgent("agent-1")]); });
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-1"]');
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("none");
  });

  it("deduplicates selected Collection agent IDs", async () => {
    mocks.client.listAgentAssociations.mockResolvedValue([
      workspaceAgent("agent-1"),
      workspaceAgent("agent-1"),
      workspaceAgent("agent-2"),
    ]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-1","agent-2"]'));
  });

  it("represents a resolved Workspace with no associated agents", async () => {
    renderProvider();

    await waitFor(() => expect(mocks.client.listAgentAssociations).toHaveBeenCalledWith("workspace-team"));
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("none");
  });

  it("falls back to active admin-visible grants when the roster route is not deployed", async () => {
    mocks.client.listAgentAssociations.mockRejectedValue(Object.assign(new Error("Not found"), { statusCode: 404 }));
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

  it("reports selected Collection agent loading failures without fallback IDs", async () => {
    mocks.client.listAgentAssociations.mockRejectedValue(new Error("Agent roster unavailable"));

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
    mocks.client.listAgentAssociations.mockImplementation((workspaceId: string) => {
      if (workspaceId === productWorkspace.id) return pendingProduct;
      if (mocks.client.listAgentAssociations.mock.calls.length === 1) return Promise.resolve([workspaceAgent("agent-team")]);
      return pendingTeamRefresh;
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-team"]'));

    fireEvent.click(screen.getByRole("button", { name: "Refresh agents" }));
    await waitFor(() => expect(mocks.client.listAgentAssociations).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Select product" }));

    expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("loading");
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent("[]");
    await waitFor(() => expect(mocks.client.listAgentAssociations).toHaveBeenCalledWith("workspace-product"));
    await act(async () => { resolveProduct?.([workspaceAgent("agent-product", productWorkspace.id)]); });
    await waitFor(() => expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-product"]'));

    await act(async () => { resolveTeamRefresh?.([workspaceAgent("agent-stale")]); });
    expect(screen.getByTestId("agent-roster-ids")).toHaveTextContent('["agent-product"]');
  });

  it("grants viewer access and refreshes membership for an admin", async () => {
    mocks.client.listAgentAssociations
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
    expect(mocks.client.listAgentAssociations).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("association-error")).toHaveTextContent("none");
  });

  it("does not report association complete when the roster cannot refresh", async () => {
    mocks.client.listAgentAssociations
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Roster refresh failed"));

    renderProvider();
    await waitFor(() => expect(mocks.client.listAgentAssociations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("agent-roster-state")).toHaveTextContent("resolved"));
    fireEvent.click(screen.getByRole("button", { name: "Associate agent" }));

    await waitFor(() => expect(screen.getByTestId("association-error")).toHaveTextContent(
      "The agent was assigned to the Collection, but its agent list could not be refreshed.",
    ));
    expect(mocks.client.grant).toHaveBeenCalledOnce();
    expect(screen.getByTestId("agent-roster-error")).toHaveTextContent("Roster refresh failed");
  });

  it("rejects automatic association without Collection admin access", async () => {
    mocks.client.list.mockResolvedValue([{ ...teamWorkspace, role: "viewer" }]);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    fireEvent.click(screen.getByRole("button", { name: "Associate agent" }));

    await waitFor(() => expect(screen.getByTestId("association-error")).toHaveTextContent("Collection admin access is required to assign agents."));
    expect(mocks.client.grant).not.toHaveBeenCalled();
  });

  it("restores and persists the selected Workspace for the signed-in account", async () => {
    window.localStorage.setItem("claw.selectedWorkspace.v1:user-1", "workspace-product");

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Product Operations"));
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("3");
    expect(mocks.createWorkspacesClient).toHaveBeenCalledWith("session-token");
    expect(mocks.client.list).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Select team" }));
    expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge");
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBe("workspace-team");
  });

  it("loads an empty Collection catalog without provisioning General", async () => {
    mocks.client.list.mockResolvedValue([]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("none"));
    expect(mocks.client.create).not.toHaveBeenCalled();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("0");
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBeNull();
    expect(mocks.client.listAgentAssociations).not.toHaveBeenCalled();
  });

  it("does not provision General when an existing Collection is present", async () => {
    mocks.client.list.mockResolvedValue([teamWorkspace]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    expect(mocks.client.create).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("1");
  });

  it("waits for a stable principal before loading Collections", async () => {
    mocks.auth.user = null;
    mocks.client.list.mockResolvedValue([]);

    const view = renderProvider();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.auth.getToken).not.toHaveBeenCalled();
    expect(mocks.client.list).not.toHaveBeenCalled();

    mocks.auth.user = { id: "user-1" };
    view.rerender(
      <WorkspaceProvider>
        <WorkspaceConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(mocks.client.list).toHaveBeenCalledOnce());
    expect(mocks.client.create).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("none"));
  });

  it("refreshes the catalog and selects a newly created Workspace", async () => {
    mocks.client.list
      .mockResolvedValueOnce([teamWorkspace, generalWorkspace])
      .mockResolvedValueOnce([teamWorkspace, productWorkspace, generalWorkspace]);
    mocks.client.create.mockResolvedValue(productWorkspace);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => expect(mocks.client.create).toHaveBeenCalledWith({ name: "Product Operations" }));
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Product Operations"));
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBe("workspace-product");
  });

  it("registers an authorized Workspace discovered by search before selecting it", async () => {
    mocks.client.list.mockResolvedValue([teamWorkspace, generalWorkspace]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("workspace-state")).toHaveTextContent("Team Knowledge"));

    fireEvent.click(screen.getByRole("button", { name: "Select discovered" }));

    expect(screen.getByTestId("workspace-state")).toHaveTextContent("Discovered Workspace");
    expect(screen.getByTestId("workspace-count")).toHaveTextContent("3");
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
      list: vi.fn(async () => [secondAccountWorkspace, generalWorkspace]),
      listAgentAssociations: vi.fn(async () => []),
      create: vi.fn(),
      grant: vi.fn(),
    };
    mocks.client.list.mockResolvedValue([teamWorkspace, generalWorkspace]);
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

describe("WorkspaceProvider while Knowledge Hub (Collections) is release-disabled", () => {
  // Adversarial runtime contract: with the shipped policy (knowledge-hub
  // unavailable), the provider must not acquire a token, build a Workspaces
  // client, list the catalog, load selected-Collection associations, or issue
  // grants — no matter what stale state, slow/rejected mocks, or principal
  // changes occur. The dormant implementation is preserved; hidden mode
  // short-circuits before any transport.

  function HiddenConsumer() {
    const [outcomes, setOutcomes] = useState<string[]>([]);
    const {
      workspaces,
      selectedWorkspace,
      selectedWorkspaceId,
      selectedWorkspaceAgentIds,
      isAgentRosterLoading,
      agentRosterError,
      isLoading,
      error,
      selectWorkspace,
      createWorkspace,
      refreshWorkspaces,
      refreshSelectedWorkspaceAgents,
      assignAgentToCollection,
      associateAgentWithSelectedWorkspace,
    } = useWorkspace();

    const record = (label: string, promise: Promise<unknown>) => {
      void promise.then(
        () => setOutcomes((current) => [...current, `${label}:resolved`]),
        (cause: unknown) => setOutcomes((current) => [...current, `${label}:${cause instanceof Error ? cause.message : "failed"}`]),
      );
    };

    return (
      <div>
        <span data-testid="hidden-workspaces">{JSON.stringify(workspaces)}</span>
        <span data-testid="hidden-selected">{selectedWorkspace?.id ?? selectedWorkspaceId ?? "none"}</span>
        <span data-testid="hidden-roster-ids">{JSON.stringify(selectedWorkspaceAgentIds)}</span>
        <span data-testid="hidden-roster-loading">{String(isAgentRosterLoading)}</span>
        <span data-testid="hidden-roster-error">{agentRosterError ?? "none"}</span>
        <span data-testid="hidden-loading">{String(isLoading)}</span>
        <span data-testid="hidden-error">{error ?? "none"}</span>
        <span data-testid="hidden-outcomes">{outcomes.join("|") || "none"}</span>
        <button type="button" onClick={() => selectWorkspace("workspace-team")}>Select team</button>
        <button type="button" onClick={() => selectWorkspace(discoveredWorkspace.id, discoveredWorkspace)}>Select discovered</button>
        <button type="button" onClick={() => record("create", createWorkspace({ name: "New" }))}>Create</button>
        <button type="button" onClick={() => record("refresh", refreshWorkspaces())}>Refresh</button>
        <button type="button" onClick={() => record("roster", refreshSelectedWorkspaceAgents())}>Refresh roster</button>
        <button type="button" onClick={() => record("assign", assignAgentToCollection("agent-1", "workspace-team"))}>Assign</button>
        <button type="button" onClick={() => record("associate", associateAgentWithSelectedWorkspace("agent-1"))}>Associate</button>
      </div>
    );
  }

  function renderHidden() {
    return render(
      <WorkspaceProvider>
        <HiddenConsumer />
      </WorkspaceProvider>,
    );
  }

  function expectZeroWorkspaceTransport() {
    expect(mocks.auth.getToken).not.toHaveBeenCalled();
    expect(mocks.createWorkspacesClient).not.toHaveBeenCalled();
    expect(mocks.client.list).not.toHaveBeenCalled();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.listAgentAssociations).not.toHaveBeenCalled();
    expect(mocks.client.listGrants).not.toHaveBeenCalled();
    expect(mocks.client.create).not.toHaveBeenCalled();
    expect(mocks.client.grant).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    releaseBoundaryMock.knowledgeHubAvailable = false;
    mocks.auth.getToken.mockResolvedValue("session-token");
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.user = { id: "user-1" };
    mocks.createWorkspacesClient.mockReturnValue(mocks.client);
    mocks.client.list.mockResolvedValue([teamWorkspace, productWorkspace, generalWorkspace]);
    mocks.client.get.mockResolvedValue(generalWorkspace);
    mocks.client.listAgentAssociations.mockResolvedValue([workspaceAgent("agent-1")]);
    mocks.client.listGrants.mockResolvedValue([]);
    mocks.client.create.mockResolvedValue(generalWorkspace);
    mocks.client.grant.mockResolvedValue({});
  });

  afterEach(() => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
  });

  it("acquires no token, client, catalog, or roster for an authenticated user", async () => {
    renderHidden();
    // Allow any microtask/timeout-scheduled effects to fire.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-workspaces")).toHaveTextContent("[]");
    expect(screen.getByTestId("hidden-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-roster-ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("hidden-roster-loading")).toHaveTextContent("false");
    expect(screen.getByTestId("hidden-roster-error")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-loading")).toHaveTextContent("false");
    expect(screen.getByTestId("hidden-error")).toHaveTextContent("none");
  });

  it("ignores a stale selected-Collection id in localStorage without fetching", async () => {
    // A user who previously selected a Collection must not see that stale id
    // resurrect a catalog list or roster fetch while the surface is hidden.
    window.localStorage.setItem("claw.selectedWorkspace.v1:user-1", "workspace-team");

    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-roster-ids")).toHaveTextContent("[]");
  });

  it("makes no calls even when Workspace mocks would resolve slowly", async () => {
    // A latent fetch that only resolves later must never be initiated.
    let resolveSlowList: ((workspaces: typeof teamWorkspace[]) => void) | undefined;
    mocks.client.list.mockReturnValue(new Promise((resolve) => { resolveSlowList = resolve; }));

    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    // Resolving the (never-called) mock must not change hidden state.
    await act(async () => { resolveSlowList?.([teamWorkspace]); });
    expect(screen.getByTestId("hidden-workspaces")).toHaveTextContent("[]");
  });

  it("makes no calls even when the token and list mocks reject", async () => {
    // Rejection paths must be unreachable; no error should surface.
    mocks.auth.getToken.mockRejectedValue(new Error("Session expired"));
    mocks.client.list.mockRejectedValue(new Error("Catalog unavailable"));
    mocks.client.listAgentAssociations.mockRejectedValue(new Error("Roster unavailable"));

    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-error")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-roster-error")).toHaveTextContent("none");
  });

  it("rejects Collection mutations without transport", async () => {
    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    fireEvent.click(screen.getByRole("button", { name: "Associate" }));
    await waitFor(() => expect(screen.getByTestId("hidden-outcomes")).toHaveTextContent("Collections are not available in this release."));

    expectZeroWorkspaceTransport();
    const outcomes = screen.getByTestId("hidden-outcomes").textContent ?? "";
    expect(outcomes).toContain("create:Collections are not available in this release.");
    expect(outcomes).toContain("assign:Collections are not available in this release.");
    expect(outcomes).toContain("associate:Collections are not available in this release.");
  });

  it("treats refresh and selection as inert no-ops without transport", async () => {
    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh roster" }));
    fireEvent.click(screen.getByRole("button", { name: "Select team" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-roster-ids")).toHaveTextContent("[]");
  });

  it("keeps a discovered-Collection selection from surfacing any Collection state while hidden", async () => {
    // Dormant callers may pass a freshly created or recovered Collection object
    // to selectWorkspace. While the surface is hidden, that write must not
    // surface a catalog entry, a selected Collection, or any roster state — and
    // above all must not start Workspace transport.
    renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    fireEvent.click(screen.getByRole("button", { name: "Select discovered" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-workspaces")).toHaveTextContent("[]");
    expect(screen.getByTestId("hidden-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("hidden-roster-ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("hidden-roster-loading")).toHaveTextContent("false");
    expect(window.localStorage.getItem("claw.selectedWorkspace.v1:user-1")).toBeNull();
  });

  it("does not start Workspace transport when the principal changes", async () => {
    mocks.auth.getToken.mockImplementation(async () => mocks.auth.user?.id === "user-2" ? "token-2" : "token-1");

    const view = renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expectZeroWorkspaceTransport();

    // Switch the signed-in account; hidden mode must remain transport-free.
    mocks.auth.user = { id: "user-2" };
    view.rerender(
      <WorkspaceProvider>
        <HiddenConsumer />
      </WorkspaceProvider>,
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-workspaces")).toHaveTextContent("[]");
    expect(screen.getByTestId("hidden-roster-ids")).toHaveTextContent("[]");
  });

  it("does not start Workspace transport on logout", async () => {
    const view = renderHidden();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    mocks.auth.isAuthenticated = false;
    mocks.auth.user = null;
    view.rerender(
      <WorkspaceProvider>
        <HiddenConsumer />
      </WorkspaceProvider>,
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expectZeroWorkspaceTransport();
    expect(screen.getByTestId("hidden-loading")).toHaveTextContent("false");
  });
});
