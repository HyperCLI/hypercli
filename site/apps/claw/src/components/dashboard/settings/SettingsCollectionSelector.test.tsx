import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const gtm = {
    id: "workspace-1",
    name: "gtm",
    slug: "gtm",
    description: null,
    displayName: "GTM",
    displaySlug: null,
    role: "admin",
    createdAt: null,
    updatedAt: null,
  };
  const research = {
    id: "workspace-2",
    name: "research",
    slug: "research",
    description: null,
    displayName: "Research",
    displaySlug: null,
    role: "admin",
    createdAt: null,
    updatedAt: null,
  };

  return {
    gtm,
    research,
    selectWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(async () => true),
    context: {
      workspacesClient: {} as object | null,
      workspaces: [gtm, research],
      selectedWorkspaceId: gtm.id as string | null,
      isLoading: false,
      error: null as string | null,
    },
  };
});

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => ({
    ...mocks.context,
    selectWorkspace: mocks.selectWorkspace,
    refreshWorkspaces: mocks.refreshWorkspaces,
  }),
  workspaceDisplayName: (workspace: { displayName: string | null; name: string }) => (
    workspace.displayName?.trim() || workspace.name
  ),
}));

const releaseBoundaryMock = vi.hoisted(() => ({
  knowledgeHubAvailable: false,
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

import { SettingsCollectionSelector } from "./SettingsCollectionSelector";

describe("SettingsCollectionSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.workspaces = [mocks.gtm, mocks.research];
    mocks.context.workspacesClient = {};
    mocks.context.selectedWorkspaceId = mocks.gtm.id;
    mocks.context.isLoading = false;
    mocks.context.error = null;
    // Shipped release policy: Knowledge Hub (Collections) is hidden. The
    // enabled-surface tests below opt in by setting this to true.
    releaseBoundaryMock.knowledgeHubAvailable = false;
  });

  it("renders nothing and touches no Workspace state while Knowledge Hub is hidden", () => {
    // Release-disabled Collections must produce no reachable Collection copy,
    // loading, error, or empty state. The selector is the managing surface for
    // a hidden workflow, so it must not announce anything.
    const view = render(<SettingsCollectionSelector />);

    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh Collections/i })).not.toBeInTheDocument();
    // Even though the hidden selector subscribes to the Workspace context, it
    // must not trigger a refresh or selection change.
    expect(mocks.refreshWorkspaces).not.toHaveBeenCalled();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it("shows and changes the Collection being managed when Knowledge Hub is available", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const user = userEvent.setup();
    render(<SettingsCollectionSelector />);

    expect(screen.getByRole("heading", { name: "Managing Collection" })).toBeInTheDocument();
    const selector = screen.getByRole("combobox", { name: "Collection being managed" });
    expect(selector).toHaveTextContent("GTM");
    expect(selector).toHaveAttribute("data-testid", "settings-collection-selector");

    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "Research" }));

    expect(mocks.selectWorkspace).toHaveBeenCalledWith("workspace-2");
  });

  it("keeps the current scope visible when only one Collection is available and Knowledge Hub is available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    mocks.context.workspaces = [mocks.gtm];
    render(<SettingsCollectionSelector />);

    expect(screen.getByRole("combobox", { name: "Collection being managed" })).toBeDisabled();
    expect(screen.getByText("Only one Collection is available.")).toBeInTheDocument();
  });

  it("offers a retry when Collections cannot be loaded and Knowledge Hub is available", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const user = userEvent.setup();
    mocks.context.workspaces = [];
    mocks.context.selectedWorkspaceId = null;
    mocks.context.error = "Unable to load Collections.";
    render(<SettingsCollectionSelector />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Collections.");
    await user.click(screen.getByRole("button", { name: "Refresh Collections" }));
    expect(mocks.refreshWorkspaces).toHaveBeenCalledOnce();
  });

  it("shows loading and empty catalog states when Knowledge Hub is available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    mocks.context.workspaces = [];
    mocks.context.selectedWorkspaceId = null;
    mocks.context.isLoading = true;
    const view = render(<SettingsCollectionSelector />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Collections");

    mocks.context.isLoading = false;
    view.rerender(<SettingsCollectionSelector />);
    expect(screen.getByRole("status")).toHaveTextContent("No Collections are available");
  });

  it("explains how to recover when the Collection service is unavailable and Knowledge Hub is available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    mocks.context.workspaces = [];
    mocks.context.selectedWorkspaceId = null;
    mocks.context.workspacesClient = null;
    mocks.context.error = "Collection access is unavailable right now.";
    render(<SettingsCollectionSelector />);

    expect(screen.getByText("Refresh the page to try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Collections" })).not.toBeInTheDocument();
  });
});
