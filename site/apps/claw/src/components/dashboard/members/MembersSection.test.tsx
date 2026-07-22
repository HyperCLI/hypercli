import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const selfGrant = {
  id: "grant-self",
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

const teammateGrant = {
  id: "grant-teammate",
  workspaceId: "workspace-1",
  subjectType: "user",
  subjectId: "user-2",
  role: "contributor",
  displayName: "Alex Chen",
  displaySlug: "alex-chen",
  isOwner: false,
  expiresAt: null,
  revokedAt: null,
};

const agentViewerGrant = {
  id: "grant-agent-viewer",
  workspaceId: "workspace-1",
  subjectType: "agent",
  subjectId: "agent-1",
  role: "viewer",
  displayName: "Snapshot Agent Label",
  displaySlug: "research-helper",
  isOwner: false,
  expiresAt: null,
  revokedAt: null,
};

const agentContributorGrant = {
  ...agentViewerGrant,
  id: "grant-agent-contributor",
  role: "contributor",
};

const unmatchedAgentGrant = {
  id: "grant-unmatched-agent",
  workspaceId: "workspace-1",
  subjectType: "agent",
  subjectId: "agent-external",
  role: "viewer",
  displayName: "External Scout",
  displaySlug: "external-scout",
  isOwner: false,
  expiresAt: null,
  revokedAt: null,
};

const revokedGrant = {
  id: "grant-revoked",
  workspaceId: "workspace-1",
  subjectType: "user",
  subjectId: "user-former",
  role: "viewer",
  displayName: "Former Member",
  displaySlug: "former-member",
  isOwner: false,
  expiresAt: null,
  revokedAt: "2026-07-21T00:00:00Z",
};

// Its future timestamp is intentional: absence from entry.grants, not the UI clock, makes it history.
const snapshotExpiredGrant = {
  id: "grant-snapshot-expired",
  workspaceId: "workspace-1",
  subjectType: "agent",
  subjectId: "agent-future-inactive",
  role: "viewer",
  displayName: "Future Snapshot Inactive",
  displaySlug: null,
  isOwner: false,
  expiresAt: "2099-01-01T00:00:00Z",
  revokedAt: null,
};

const activeEntries = [
  {
    workspaceId: "workspace-1",
    subjectType: "user",
    subjectId: "user-1",
    role: "admin",
    displayName: null,
    displaySlug: null,
    grants: [selfGrant],
  },
  {
    workspaceId: "workspace-1",
    subjectType: "user",
    subjectId: "user-2",
    role: "contributor",
    displayName: "Alex Chen",
    displaySlug: "alex-chen",
    grants: [teammateGrant],
  },
  {
    workspaceId: "workspace-1",
    subjectType: "agent",
    subjectId: "agent-1",
    role: "contributor",
    displayName: "Snapshot Agent Label",
    displaySlug: "research-helper",
    grants: [agentViewerGrant, agentContributorGrant],
  },
  {
    workspaceId: "workspace-1",
    subjectType: "agent",
    subjectId: "agent-external",
    role: "viewer",
    displayName: "External Scout",
    displaySlug: "external-scout",
    grants: [unmatchedAgentGrant],
  },
];

const allGrants = [
  selfGrant,
  teammateGrant,
  agentViewerGrant,
  agentContributorGrant,
  unmatchedAgentGrant,
  revokedGrant,
  snapshotExpiredGrant,
];

const accountAgents = [
  { id: "agent-1", name: "Research Agent", displayName: "Research Agent", handle: "research" },
  { id: "agent-2", name: "Catalog Agent", displayName: null, handle: "catalog" },
];

function adminSnapshot(
  entries = activeEntries,
  grants = allGrants,
  targetWorkspace = workspace,
) {
  return {
    workspace: { ...targetWorkspace, role: "admin" },
    currentRole: "admin",
    visibility: "all-direct-access" as const,
    capturedAt: "2026-07-22T12:00:00.000Z",
    entries,
    grants,
  };
}

function currentAccessSnapshot(role: "viewer" | "contributor") {
  return {
    workspace: { ...workspace, role },
    currentRole: role,
    visibility: "current-access-only" as const,
    capturedAt: "2026-07-22T12:00:00.000Z",
    entries: null,
    grants: null,
  };
}

const mocks = vi.hoisted(() => ({
  auth: {
    getToken: vi.fn(),
    user: {
      id: "did:privy:user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    } as {
      id: string;
      email?: string;
      fullName?: string;
    } | null,
  },
  workspaces: {
    accessSnapshot: vi.fn(),
    grant: vi.fn(),
    revokeGrant: vi.fn(),
  },
  userApi: {
    authMe: vi.fn(),
    get: vi.fn(),
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

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return { user: mocks.userApi };
  }),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspaceContext,
}));

import { MembersSection } from "./MembersSection";

function summaryValue(label: string): HTMLElement {
  const labelElement = screen.getByText(label);
  if (!labelElement.parentElement) throw new Error(`Missing ${label} summary`);
  return labelElement.parentElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function selectWorkspaceRole(role: "viewer" | "contributor" | "admin") {
  const selectedWorkspace = { ...workspace, role };
  mocks.workspaceContext.workspaces = [selectedWorkspace];
  mocks.workspaceContext.selectedWorkspaceId = selectedWorkspace.id;
  mocks.workspaceContext.selectedWorkspace = selectedWorkspace;
  mocks.workspaces.accessSnapshot.mockResolvedValue(
    role === "admin" ? adminSnapshot() : currentAccessSnapshot(role),
  );
}

describe("MembersSection", () => {
  beforeEach(() => {
    mocks.workspaces.accessSnapshot.mockReset();
    mocks.workspaces.grant.mockReset();
    mocks.workspaces.revokeGrant.mockReset();
    mocks.auth.getToken.mockReset();
    mocks.userApi.authMe.mockReset();
    mocks.userApi.get.mockReset();
    mocks.workspaceContext.refreshSelectedWorkspaceAgents.mockReset();
    mocks.auth.user = {
      id: "did:privy:user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    };
    mocks.auth.getToken.mockResolvedValue("session-token");
    mocks.userApi.authMe.mockResolvedValue({
      userId: "user-1",
      orchestraUserId: null,
    });
    mocks.userApi.get.mockResolvedValue({
      userId: "user-1",
      name: "Jane Rivera",
      email: "jane@example.com",
    });
    mocks.workspaceContext.workspacesClient = mocks.workspaces;
    mocks.workspaceContext.workspaces = [workspace];
    mocks.workspaceContext.selectedWorkspaceId = workspace.id;
    mocks.workspaceContext.selectedWorkspace = workspace;
    mocks.workspaceContext.isLoading = false;
    mocks.workspaceContext.error = null;
    mocks.workspaces.accessSnapshot.mockResolvedValue(adminSnapshot());
    mocks.workspaces.grant.mockResolvedValue(agentViewerGrant);
    mocks.workspaces.revokeGrant.mockResolvedValue(undefined);
    mocks.workspaceContext.refreshSelectedWorkspaceAgents.mockResolvedValue(true);
  });

  it.each(["viewer", "contributor", "admin"] as const)(
    "loads one access snapshot for a %s",
    async (role) => {
      selectWorkspaceRole(role);

      render(<MembersSection agents={accountAgents} />);

      if (role === "admin") await screen.findByText("Alex Chen");
      else await screen.findByRole("heading", { name: "Your Workspace access" });
      expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledOnce();
      expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledWith("workspace-1");
      expect(Object.keys(mocks.workspaces).sort()).toEqual(["accessSnapshot", "grant", "revokeGrant"]);
    },
  );

  it.each(["viewer", "contributor"] as const)(
    "shows only the signed-in account and unknown directory totals for a %s",
    async (role) => {
      selectWorkspaceRole(role);

      render(<MembersSection agents={accountAgents} />);

      expect(await screen.findByRole("heading", { name: "Your Workspace access" })).toBeInTheDocument();
      expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
      expect(screen.getByText(role)).toBeInTheDocument();
      expect(screen.getByText("The full direct-access list is available to Workspace admins.")).toBeInTheDocument();
      expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
      expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
      expect(screen.queryByText("External Scout")).not.toBeInTheDocument();
      expect(within(summaryValue("People")).getByText("-")).toBeInTheDocument();
      expect(within(summaryValue("Agents")).getByText("-")).toBeInTheDocument();
      expect(within(summaryValue("People")).queryByText("0")).not.toBeInTheDocument();
      expect(screen.queryByRole("searchbox", { name: "Search members" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add access" })).not.toBeInTheDocument();
    },
  );

  it("shows only current access in the compact non-admin panel", async () => {
    selectWorkspaceRole("viewer");

    render(<MembersSection compact agents={accountAgents} />);

    expect(await screen.findByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.getByText("viewer - Current access")).toBeInTheDocument();
    expect(screen.getByText("The full direct-access list is available to Workspace admins.")).toBeInTheDocument();
    expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/dashboard/agents?section=members");
  });

  it("renders grouped people and agents, snapshot counts and search, and the complete agent catalog", async () => {
    const user = userEvent.setup();
    render(<MembersSection agents={accountAgents} />);

    expect(await screen.findByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("External Scout")).toBeInTheDocument();
    expect(screen.getByText("@research-helper")).toBeInTheDocument();
    expect(screen.getByText("2 active grants")).toBeInTheDocument();
    expect(within(summaryValue("People")).getByText("2")).toBeInTheDocument();
    expect(within(summaryValue("Agents")).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Role for/ })).not.toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search members" });
    fireEvent.change(search, { target: { value: "research" } });
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Catalog Agent" } });
    expect(screen.getByText("No active people or agents match your search.")).toBeInTheDocument();
    expect(screen.queryByText("Catalog Agent")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "Agent" }));
    const assignmentCatalog = screen.getByRole("combobox", { name: "Agent" });
    await user.click(assignmentCatalog);
    expect(screen.getByRole("option", { name: "Research Agent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Catalog Agent" })).toBeInTheDocument();
  });

  it("renders all grouped entry types in the compact admin panel", async () => {
    render(<MembersSection compact agents={accountAgents} />);

    expect(await screen.findByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByText("External Scout")).toBeInTheDocument();
    expect(screen.queryByText("Former Member")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("keeps an authoritative admin empty snapshot distinct from unavailable access", async () => {
    mocks.workspaces.accessSnapshot.mockResolvedValue(adminSnapshot([], []));

    render(<MembersSection agents={accountAgents} />);

    expect(await screen.findByText("No active direct access entries.")).toBeInTheDocument();
    expect(within(summaryValue("People")).getByText("0")).toBeInTheDocument();
    expect(within(summaryValue("Agents")).getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Workspace access is unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses active entry grant IDs to render raw revoked and expired history", async () => {
    render(<MembersSection agents={accountAgents} />);

    const historyHeading = await screen.findByRole("heading", { name: "Access history" });
    const history = screen.getByRole("table", { name: "Inactive Workspace access grants" });
    expect(historyHeading).toBeInTheDocument();
    expect(within(history).getByText("Former Member")).toBeInTheDocument();
    expect(within(history).getByText("Future Snapshot Inactive")).toBeInTheDocument();
    expect(within(history).getByText("revoked")).toBeInTheDocument();
    expect(within(history).getByText("expired")).toBeInTheDocument();
    expect(within(history).queryByText("Research Agent")).not.toBeInTheDocument();
  });

  it("refreshes with exactly one new snapshot request", async () => {
    render(<MembersSection agents={accountAgents} />);
    await screen.findByText("Research Agent");

    fireEvent.click(screen.getByRole("button", { name: "Refresh Workspace access" }));

    await waitFor(() => expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).not.toHaveBeenCalled();
  });

  it("reloads the snapshot after user creation without refreshing agent context", async () => {
    render(<MembersSection agents={accountAgents} />);
    await screen.findByText("Alex Chen");

    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    fireEvent.change(screen.getByLabelText("User UUID"), { target: { value: "user-3" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(mocks.workspaces.grant).toHaveBeenCalledWith("workspace-1", {
      subjectType: "user",
      subjectId: "user-3",
      role: "viewer",
      expiresAt: undefined,
    }));
    await waitFor(() => expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).not.toHaveBeenCalled();
  });

  it("reloads the snapshot and agent context after agent creation", async () => {
    const user = userEvent.setup();
    render(<MembersSection agents={accountAgents} />);
    await screen.findByText("Research Agent");

    fireEvent.click(screen.getByRole("button", { name: "Add access" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "Agent" }));
    await user.click(screen.getByRole("combobox", { name: "Agent" }));
    await user.click(screen.getByRole("option", { name: "Catalog Agent" }));
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: "Contributor" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(mocks.workspaces.grant).toHaveBeenCalledWith("workspace-1", {
      subjectType: "agent",
      subjectId: "agent-2",
      role: "contributor",
      expiresAt: undefined,
    }));
    await waitFor(() => expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
  });

  it("revokes every grouped grant, reloads, closes confirmation, and reports a partial failure", async () => {
    mocks.workspaces.revokeGrant.mockImplementation(async (_workspaceId, grantId) => {
      if (grantId === "grant-agent-contributor") throw new Error("Backend denied contributor grant");
    });

    render(<MembersSection agents={accountAgents} />);
    await screen.findByText("Research Agent");

    fireEvent.click(screen.getByRole("button", { name: "Remove Research Agent" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove Workspace access" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove access" }));

    await waitFor(() => expect(mocks.workspaces.revokeGrant).toHaveBeenCalledTimes(2));
    expect(mocks.workspaces.revokeGrant).toHaveBeenNthCalledWith(1, "workspace-1", "grant-agent-viewer");
    expect(mocks.workspaces.revokeGrant).toHaveBeenNthCalledWith(2, "workspace-1", "grant-agent-contributor");
    await waitFor(() => expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog", { name: "Remove Workspace access" })).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Partially removed Research Agent");
    expect(screen.getByRole("alert")).toHaveTextContent("1 of 2 active access grants failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Backend denied contributor grant");
  });

  it("reports a full grouped-subject failure without inferring protected access", async () => {
    mocks.workspaces.revokeGrant.mockRejectedValue(new Error("Backend protects this grant"));

    render(<MembersSection agents={accountAgents} />);
    await screen.findByText("Jane Rivera");

    fireEvent.click(screen.getByRole("button", { name: "Remove Jane Rivera" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove access" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to remove Jane Rivera");
    expect(screen.getByRole("alert")).toHaveTextContent("Backend protects this grant");
    expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.workspaceContext.refreshSelectedWorkspaceAgents).not.toHaveBeenCalled();
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
  });

  it("ignores a stale snapshot after switching Workspaces", async () => {
    const firstSnapshot = deferred<ReturnType<typeof adminSnapshot>>();
    const productWorkspace = {
      ...workspace,
      id: "workspace-2",
      name: "Product Knowledge",
      slug: "product-knowledge",
    };
    const productGrant = {
      ...selfGrant,
      id: "grant-product",
      workspaceId: "workspace-2",
      subjectId: "user-product",
      displayName: "Product Admin",
      isOwner: false,
    };
    const productEntry = {
      workspaceId: "workspace-2",
      subjectType: "user",
      subjectId: "user-product",
      role: "admin",
      displayName: "Product Admin",
      displaySlug: "product-admin",
      grants: [productGrant],
    };
    mocks.workspaces.accessSnapshot
      .mockReturnValueOnce(firstSnapshot.promise)
      .mockResolvedValueOnce(adminSnapshot([productEntry], [productGrant], productWorkspace));

    const view = render(<MembersSection agents={accountAgents} />);
    await waitFor(() => expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledWith("workspace-1"));

    mocks.workspaceContext.workspaces = [workspace, productWorkspace];
    mocks.workspaceContext.selectedWorkspaceId = productWorkspace.id;
    mocks.workspaceContext.selectedWorkspace = productWorkspace;
    view.rerender(<MembersSection agents={accountAgents} />);

    expect(await screen.findByText("Product Admin")).toBeInTheDocument();
    expect(mocks.workspaces.accessSnapshot).toHaveBeenCalledWith("workspace-2");

    await act(async () => {
      firstSnapshot.resolve(adminSnapshot());
      await firstSnapshot.promise;
      await Promise.resolve();
    });

    expect(screen.getByText("Product Admin")).toBeInTheDocument();
    expect(screen.queryByText("Jane Rivera")).not.toBeInTheDocument();
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
  });

  it("shows a snapshot connection failure as unavailable rather than an empty directory", async () => {
    mocks.workspaces.accessSnapshot.mockRejectedValue(new Error("Workspace connection failed"));

    render(<MembersSection agents={accountAgents} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace connection failed");
    expect(screen.getByText("Workspace access is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No active direct access entries.")).not.toBeInTheDocument();
    expect(within(summaryValue("People")).getByText("-")).toBeInTheDocument();
    expect(within(summaryValue("Agents")).getByText("-")).toBeInTheDocument();
  });

  it("reports shared connection failures without requesting a snapshot", async () => {
    mocks.workspaceContext.workspacesClient = null;
    mocks.workspaceContext.workspaces = [];
    mocks.workspaceContext.selectedWorkspaceId = null;
    mocks.workspaceContext.selectedWorkspace = null;
    mocks.workspaceContext.error = "Session expired";

    render(<MembersSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Session expired");
    expect(mocks.workspaces.accessSnapshot).not.toHaveBeenCalled();
  });
});
