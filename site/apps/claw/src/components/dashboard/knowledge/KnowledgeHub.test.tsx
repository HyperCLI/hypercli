import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    id: "workspace-1",
    name: "Support playbook",
    slug: "support-playbook",
    description: "Escalation guidance and support procedures.",
    displayName: null,
    displaySlug: null,
    role: "admin",
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-07-20T10:00:00Z",
  };
  const generalWorkspace = {
    ...workspace,
    id: "workspace-general",
    name: "General",
    slug: "general",
    description: "Shared knowledge available across the account.",
  };
  const file = {
    id: "file-1",
    workspaceId: "workspace-1",
    path: "guides/support-guide.pdf",
    displayName: "Support guide",
    currentVersionId: "version-1",
    fileState: "processed",
    uploadStatus: "uploaded",
    processingState: "processed",
    keywords: ["support", "escalation"],
    summary: "How to resolve and escalate customer issues.",
  };
  const grant = {
    id: "grant-1",
    workspaceId: "workspace-1",
    subjectType: "agent",
    subjectId: "agent-support",
    role: "viewer",
    displayName: null,
    displaySlug: null,
    isOwner: false,
    expiresAt: null,
    revokedAt: null,
  };
  const agents = [
    {
      id: "agent-support",
      name: "support-agent",
      displayName: "Support Agent",
      avatarUrl: null,
      meta: null,
      state: "RUNNING",
      updatedAt: new Date("2026-07-20T12:00:00Z"),
      createdAt: new Date("2026-07-20T10:00:00Z"),
    },
    {
      id: "agent-research",
      name: "research-agent",
      displayName: "Research Agent",
      avatarUrl: null,
      meta: null,
      state: "STOPPED",
      updatedAt: new Date("2026-07-20T11:00:00Z"),
      createdAt: new Date("2026-07-20T09:00:00Z"),
    },
  ];
  return {
    workspace,
    generalWorkspace,
    file,
    grant,
    agents,
    grants: [grant] as Array<typeof grant>,
    contextWorkspaces: [workspace] as Array<typeof workspace>,
    refreshWorkspaces: vi.fn(async () => true),
    refreshSelectedWorkspaceAgents: vi.fn(async () => true),
    list: vi.fn(async () => [workspace]),
    listFiles: vi.fn(async () => [file]),
    listGrants: vi.fn(async () => [] as Array<typeof grant>),
    create: vi.fn(),
    update: vi.fn(),
    deleteCollection: vi.fn(async () => undefined),
    uploadFile: vi.fn(),
    updateFile: vi.fn(),
    regenerateFile: vi.fn(),
    deleteFile: vi.fn(async () => undefined),
    grantAccess: vi.fn(),
    revokeGrant: vi.fn(async () => undefined),
    markdownFile: vi.fn(async () => ({
      markdownFile: { file_id: "file-1", path: "guides/support-guide.pdf", state: "processed" },
      markdown: "# Support guide\n\nEscalate billing issues to the account team.",
    })),
    downloadFileBytes: vi.fn(async () => ({
      content: new TextEncoder().encode("Support source"),
      path: "guides/support-guide.pdf",
      name: "support-guide.pdf",
    })),
  };
});

vi.mock("@/components/dashboard/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => {
  const workspacesClient = {
    list: mocks.list,
    listFiles: mocks.listFiles,
    listGrants: mocks.listGrants,
    create: mocks.create,
    update: mocks.update,
    delete: mocks.deleteCollection,
    uploadFile: mocks.uploadFile,
    updateFile: mocks.updateFile,
    regenerateFile: mocks.regenerateFile,
    deleteFile: mocks.deleteFile,
    grant: mocks.grantAccess,
    revokeGrant: mocks.revokeGrant,
    markdownFile: mocks.markdownFile,
    downloadFileBytes: mocks.downloadFileBytes,
  };
  return {
    useWorkspace: () => ({
      workspacesClient,
      workspaces: mocks.contextWorkspaces,
      selectedWorkspaceId: "workspace-1",
      isLoading: false,
      error: null,
      refreshWorkspaces: mocks.refreshWorkspaces,
      refreshSelectedWorkspaceAgents: mocks.refreshSelectedWorkspaceAgents,
    }),
  };
});

import { renderWithClient } from "@/test/utils";
import { KnowledgeHub } from "./KnowledgeHub";

beforeEach(() => {
  mocks.grants = [mocks.grant];
  mocks.contextWorkspaces = [mocks.workspace];
  mocks.refreshWorkspaces.mockReset();
  mocks.refreshWorkspaces.mockResolvedValue(true);
  mocks.refreshSelectedWorkspaceAgents.mockReset();
  mocks.refreshSelectedWorkspaceAgents.mockResolvedValue(true);
  mocks.list.mockReset();
  mocks.list.mockResolvedValue([mocks.workspace]);
  mocks.listFiles.mockReset();
  mocks.listFiles.mockResolvedValue([mocks.file]);
  mocks.listGrants.mockReset();
  mocks.listGrants.mockImplementation(async () => [...mocks.grants]);
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.deleteCollection.mockClear();
  mocks.uploadFile.mockReset();
  mocks.updateFile.mockReset();
  mocks.regenerateFile.mockReset();
  mocks.deleteFile.mockClear();
  mocks.grantAccess.mockReset();
  mocks.grantAccess.mockImplementation(async (_workspaceRef: string, input: { subjectId: string }) => {
    const grant = { ...mocks.grant, id: `grant-${input.subjectId}`, subjectId: input.subjectId };
    mocks.grants.push(grant);
    return grant;
  });
  mocks.revokeGrant.mockClear();
  mocks.markdownFile.mockClear();
  mocks.downloadFileBytes.mockClear();
});

describe("KnowledgeHub", () => {
  it("hydrates the account catalog with source health and direct agent membership", async () => {
    const onSelectedDomainChange = vi.fn();
    const controlsTargetId = "knowledge-hub-test-controls";
    renderWithClient(
      <>
        <div id={controlsTargetId} data-testid="knowledge-header-controls" />
        <KnowledgeHub agents={mocks.agents} onSelectedDomainChange={onSelectedDomainChange} headerControlsTargetId={controlsTargetId} />
      </>,
    );

    expect(await screen.findByRole("heading", { name: "Domains" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Knowledge" })).not.toBeInTheDocument();
    const controlsTarget = screen.getByTestId("knowledge-header-controls");
    const controls = await within(controlsTarget).findByRole("group", { name: "Knowledge controls" });
    expect(controls).toHaveClass("flex-wrap", "justify-end");
    expect(within(controlsTarget).getByRole("textbox", { name: "Search Domains and sources" })).toHaveStyle({ paddingLeft: "2.25rem" });
    const newDomainButton = within(controlsTarget).getByRole("button", { name: "New Domain" });
    expect(newDomainButton).toBeInTheDocument();
    expect(newDomainButton.querySelector("svg")).not.toBeInTheDocument();
    expect((await screen.findAllByText("Support playbook")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Source" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Metadata" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Domain name" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Source coverage" })).toBeInTheDocument();
    expect(screen.getByText("1 of 1 source ready for agents")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent access" })).toBeInTheDocument();
    expect(screen.getByText("1 agent has access to this Domain")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview source: Support guide" })).toBeInTheDocument();
    await waitFor(() => expect(onSelectedDomainChange).toHaveBeenLastCalledWith({
      id: "workspace-1",
      name: "Support playbook",
      description: "Escalation guidance and support procedures.",
      sourceCount: 1,
      assignedAgentCount: 1,
      processingCount: 0,
      failedCount: 0,
    }));
    const paneGrid = document.querySelector('[data-slot="knowledge-pane-grid"]');
    expect(paneGrid).toHaveClass("grid");
    expect(paneGrid).toHaveStyle({ gridTemplateColumns: "220px minmax(0, 1fr)" });
    const domainsPane = document.querySelector('[data-pane="domains"]');
    const sourcesPane = document.querySelector('[data-pane="sources"]');
    const inspectorPane = document.querySelector('[data-pane="inspector"]');
    expect(domainsPane).toHaveAttribute("data-active", "true");
    expect(sourcesPane).toHaveAttribute("data-active", "false");
    expect(inspectorPane).toHaveAttribute("data-active", "false");
    expect(domainsPane).toHaveStyle({ display: "flex" });
    expect(sourcesPane).toHaveStyle({ display: "none" });
    expect(inspectorPane).toHaveStyle({ display: "flex" });
    const domainRow = within(domainsPane as HTMLElement).getByText("Support playbook").closest(".group");
    expect(domainRow).toHaveClass("rounded-xl", "bg-[var(--selection-accent-soft)]");
    expect(domainRow?.querySelector(".lucide-library-big")).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-status"]')).toHaveClass("flex", "py-3");
    expect(document.querySelector('[data-slot="domain-status"]')).not.toHaveClass("flex-col");
    expect(document.querySelector('[data-slot="domain-status"] .lucide-check')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-overview-metrics"]')).toHaveStyle({ gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))" });

    const uploadsOption = screen.getByRole("button", { name: "Uploads" });
    expect(uploadsOption).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(uploadsOption);
    expect(uploadsOption).toHaveAttribute("aria-expanded", "true");
    expect(paneGrid).toHaveStyle({ gridTemplateColumns: "220px 300px minmax(0, 1fr)" });
    expect(sourcesPane).toHaveStyle({ display: "flex" });
    expect(within(sourcesPane as HTMLElement).getByRole("heading", { name: "Sources in Support playbook" })).toHaveTextContent("Sources");
    expect(within(sourcesPane as HTMLElement).queryByText("Support playbook")).not.toBeInTheDocument();
    expect(within(inspectorPane as HTMLElement).getByRole("heading", { name: "Overview of Support playbook" })).toHaveClass("sr-only");
    expect(inspectorPane?.querySelector('[data-slot="source-context-header"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close sources" }));
    expect(paneGrid).toHaveStyle({ gridTemplateColumns: "220px minmax(0, 1fr)" });
    expect(sourcesPane).toHaveStyle({ display: "none" });
    await waitFor(() => expect(uploadsOption).toHaveFocus());
    expect(screen.getByLabelText("Knowledge sections")).toHaveStyle({ display: "none" });
    expect(document.querySelector('button[aria-label="Back to Domains"]')).toHaveStyle({ display: "none" });
    expect(screen.getByRole("heading", { name: "Domain knowledge is ready" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-overview-metrics"]')).toHaveClass("grid", "gap-px");
    expect(document.querySelector('[data-slot="domain-overview-layout"]')).toHaveStyle({ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))" });
    expect(screen.getAllByText("Support guide").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Domain configuration" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Catalog identity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Governance record" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access boundary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lifecycle" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-settings-header"]')).toHaveClass("grid", "sm:grid-cols-[minmax(0,1fr)_auto]", "text-left");
    expect(document.querySelector('[data-slot="domain-settings-state"]')?.parentElement).toHaveClass("grid", "grid-cols-[auto_minmax(0,1fr)]", "text-left");
    const settingsLayout = document.querySelector('[data-slot="domain-settings-layout"]');
    expect(settingsLayout).toHaveClass("lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.75fr)]");
    expect(settingsLayout?.querySelector("svg")).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-overview-status"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="space-metadata"]')).toHaveClass("divide-y", "border-y");
    expect(document.querySelector('[data-slot="domain-catalog-preview"]')).toHaveTextContent("Support playbook");
    expect(document.querySelector('[data-slot="domain-catalog-preview"]')).toHaveTextContent("1 source · 1 assigned agent");
    expect(document.querySelector('[data-slot="space-actions"]')).toHaveClass("sticky", "grid", "grid-cols-[minmax(0,1fr)_auto]");
    expect(screen.getByRole("button", { name: "Review assigned agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mocks.list).toHaveBeenCalled();
    expect(mocks.listFiles).toHaveBeenCalledWith("support-playbook");
    expect(mocks.listGrants).toHaveBeenCalledWith("support-playbook");

    fireEvent.click(screen.getByRole("tab", { name: "Assigned agents" }));
    expect(screen.getByRole("heading", { name: "Agent access boundary" })).toBeInTheDocument();
    const assignedLane = document.querySelector('[data-lane="assigned"]');
    const availableLane = document.querySelector('[data-lane="available"]');
    expect(within(assignedLane as HTMLElement).getByRole("heading", { name: "Inside this Domain" })).toBeInTheDocument();
    expect(within(availableLane as HTMLElement).getByRole("heading", { name: "Available agents" })).toBeInTheDocument();
    expect(await screen.findByText("Support Agent")).toBeInTheDocument();
    expect(within(assignedLane as HTMLElement).getByText("Support Agent")).toBeInTheDocument();
    expect(within(availableLane as HTMLElement).getByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Support Agent from Domain" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the source pane from an empty Domain overview", async () => {
    mocks.listFiles.mockResolvedValue([]);
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    expect(await screen.findByRole("heading", { name: "Ready for your first source" })).toBeInTheDocument();
    expect(screen.getByText("Upload a document to add reusable knowledge to this Domain.")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="domain-status"] svg')).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Build knowledge for this Domain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add sources" }));
    expect(document.querySelector('[data-pane="sources"]')).toHaveStyle({ display: "flex" });
    expect(screen.getByRole("button", { name: "Close sources" })).toBeInTheDocument();
  });

  it("guides creation with a live Domain preview and no decorative action icon", async () => {
    const createdWorkspace = {
      ...mocks.workspace,
      id: "workspace-2",
      name: "Customer support",
      slug: "customer-support",
      description: "Policies and procedures for customer issues.",
    };
    mocks.create.mockResolvedValue(createdWorkspace);
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);
    await screen.findByRole("heading", { name: "Source coverage" });

    fireEvent.click(screen.getByRole("button", { name: "New Domain" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Create a Domain" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Domain list preview" })).toBeInTheDocument();
    expect(within(dialog).getByText("Untitled Domain")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Domain name" }), { target: { value: "Customer support" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Purpose and boundary" }), { target: { value: "Policies and procedures for customer issues." } });
    const preview = dialog.querySelector('[data-slot="domain-create-preview"]') as HTMLElement;
    expect(within(preview).getByText("Customer support")).toBeInTheDocument();
    expect(within(preview).getByText("Policies and procedures for customer issues.")).toBeInTheDocument();
    const createDomain = within(dialog).getByRole("button", { name: "Create Domain" });
    expect(createDomain.querySelector("svg")).not.toBeInTheDocument();
    fireEvent.click(createDomain);

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      name: "Customer support",
      description: "Policies and procedures for customer issues.",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("filters Domains by operational state", async () => {
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    await screen.findByRole("heading", { name: "Source coverage" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter Domains" }), { button: 0, ctrlKey: false });
    const allDomainsFilter = await screen.findByRole("menuitemradio", { name: /All Domains/ });
    expect(allDomainsFilter).toHaveAttribute("aria-checked", "true");
    expect(within(allDomainsFilter).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Ready/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Processing/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Needs attention/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Empty/ }));

    expect(screen.getByRole("button", { name: "Filter Domains: Empty" })).toBeInTheDocument();
    expect(screen.getByText("No empty Domains")).toBeInTheDocument();
    expect(screen.getByText("Choose another filter to see more Domains.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Source coverage" })).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter Domains: Empty" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Ready/ }));
    expect(await screen.findByRole("heading", { name: "Source coverage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Domains: Ready" })).toBeInTheDocument();
  });

  it("uses a single-pane drill-in layout below the desktop breakpoint", async () => {
    const originalMatchMedia = window.matchMedia;
    let desktopMatches = false;
    const desktopListeners = new Set<() => void>();
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 1024px)" ? desktopMatches : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        if (query === "(min-width: 1024px)") desktopListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => desktopListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMedia,
    });
    const view = renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    try {
      await screen.findByRole("heading", { name: "Domains" });
      const domainsPane = document.querySelector('[data-pane="domains"]');
      const sourcesPane = document.querySelector('[data-pane="sources"]');
      const inspectorPane = document.querySelector('[data-pane="inspector"]');
      expect(screen.getByLabelText("Knowledge sections")).toHaveStyle({ display: "grid" });
      expect(screen.getByLabelText("Knowledge sections")).toHaveStyle({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
      expect(domainsPane).toHaveStyle({ display: "flex" });
      expect(sourcesPane).toHaveStyle({ display: "none" });
      expect(inspectorPane).toHaveStyle({ display: "none" });

      const domainName = (await screen.findAllByText("Support playbook")).find((element) => element.closest('[data-pane="domains"]'));
      expect(domainName).toBeDefined();
      fireEvent.click(domainName!.closest("button")!);
      expect(domainsPane).toHaveStyle({ display: "none" });
      expect(sourcesPane).toHaveStyle({ display: "none" });
      expect(inspectorPane).toHaveStyle({ display: "flex" });

      fireEvent.click(screen.getByRole("button", { name: "Domains" }));
      fireEvent.click(screen.getByRole("button", { name: "Uploads" }));
      expect(domainsPane).toHaveStyle({ display: "none" });
      expect(sourcesPane).toHaveStyle({ display: "flex" });
      expect(inspectorPane).toHaveStyle({ display: "none" });
      expect(screen.getByLabelText("Knowledge sections")).toHaveStyle({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });

      fireEvent.click(screen.getByRole("button", { name: /support guide.*support-guide\.pdf/i }));
      expect(sourcesPane).toHaveStyle({ display: "none" });
      expect(inspectorPane).toHaveStyle({ display: "flex" });
      expect(within(inspectorPane as HTMLElement).getByRole("heading", { name: "Support guide in Support playbook" })).not.toHaveClass("sr-only");
      expect(inspectorPane?.querySelector('[data-slot="source-context-header"]')).toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Assigned agents" }));
      expect(inspectorPane?.querySelector('[data-slot="source-context-header"]')).not.toBeInTheDocument();
      expect(within(inspectorPane as HTMLElement).getByRole("heading", { name: "Assigned agents for Support playbook" })).toHaveClass("sr-only");
      expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");

      desktopMatches = true;
      act(() => desktopListeners.forEach((listener) => listener()));
      expect(screen.getByLabelText("Knowledge sections")).toHaveStyle({ display: "none" });
      expect(domainsPane).toHaveStyle({ display: "flex" });
      expect(sourcesPane).toHaveStyle({ display: "flex" });
      expect(inspectorPane).toHaveStyle({ display: "flex" });
    } finally {
      view.unmount();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("refreshes the catalog and the dashboard-supplied agent roster together", async () => {
    const onRefreshAgents = vi.fn(async () => true);
    renderWithClient(<KnowledgeHub agents={mocks.agents} onRefreshAgents={onRefreshAgents} />);
    await screen.findByRole("button", { name: "Preview source: Support guide" });

    fireEvent.click(screen.getByRole("button", { name: "Refresh Knowledge and agents" }));

    await waitFor(() => expect(onRefreshAgents).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledTimes(2));
  });

  it("allows deleting an ordinary Domain when it is the only visible Domain", async () => {
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    await screen.findByRole("heading", { name: "Source coverage" });
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Domain" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith("support-playbook"));
  });

  it("keeps General protected while allowing another Domain to be deleted", async () => {
    mocks.contextWorkspaces = [mocks.generalWorkspace, mocks.workspace];
    mocks.list.mockResolvedValue([mocks.generalWorkspace, mocks.workspace]);
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    expect((await screen.findAllByText("General")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.queryByRole("button", { name: "Delete Domain" })).not.toBeInTheDocument();
    expect(screen.getByText("General is created with your account and cannot be deleted.")).toBeInTheDocument();

    const supportName = (await screen.findAllByText("Support playbook")).find((element) => element.closest('[data-pane="domains"]'));
    expect(supportName).toBeDefined();
    fireEvent.click(supportName!.closest("button")!);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Domain" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith("support-playbook"));
  });

  it("opens an explicitly requested Domain from an external Knowledge Hub entry", async () => {
    mocks.contextWorkspaces = [mocks.generalWorkspace, mocks.workspace];
    mocks.list.mockResolvedValue([mocks.generalWorkspace, mocks.workspace]);
    const onSelectedDomainChange = vi.fn();
    renderWithClient(
      <KnowledgeHub
        agents={mocks.agents}
        initialDomainId="workspace-1"
        onSelectedDomainChange={onSelectedDomainChange}
      />,
    );

    await screen.findByRole("heading", { name: "Source coverage" });
    const domainsPane = document.querySelector('[data-pane="domains"]') as HTMLElement;
    const supportRow = within(domainsPane).getByText("Support playbook").closest("button");
    const generalRow = within(domainsPane).getByText("General").closest("button");
    expect(supportRow).toHaveAttribute("aria-current", "page");
    expect(generalRow).not.toHaveAttribute("aria-current");
    await waitFor(() => expect(onSelectedDomainChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "workspace-1" })));
  });

  it("renames a Domain through the explicit inspector action", async () => {
    mocks.update.mockImplementation(async (_workspaceRef: string, input: { name?: string; description?: string }) => ({
      ...mocks.workspace,
      ...input,
      updatedAt: "2026-07-20T13:00:00Z",
    }));
    const onSelectedDomainChange = vi.fn();
    renderWithClient(<KnowledgeHub agents={mocks.agents} onSelectedDomainChange={onSelectedDomainChange} />);
    await screen.findByRole("heading", { name: "Source coverage" });

    const renameDomain = screen.getByRole("button", { name: "Rename Domain: Support playbook" });
    expect(screen.getByRole("heading", { name: "Domains" }).closest("section")).toContainElement(renameDomain);
    fireEvent.click(renameDomain);
    const nameInput = screen.getByRole("textbox", { name: "Domain name" });
    await waitFor(() => expect(nameInput).toHaveFocus());
    fireEvent.change(nameInput, { target: { value: "Support operations" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("support-playbook", {
      name: "Support operations",
      description: "Escalation guidance and support procedures.",
    }));
    expect((await screen.findAllByText("Support operations")).length).toBeGreaterThan(0);
    await waitFor(() => expect(onSelectedDomainChange).toHaveBeenLastCalledWith({
      id: "workspace-1",
      name: "Support operations",
      description: "Escalation guidance and support procedures.",
      sourceCount: 1,
      assignedAgentCount: 1,
      processingCount: 0,
      failedCount: 0,
    }));
  });

  it("updates source metadata and loads the generated agent view", async () => {
    mocks.updateFile.mockImplementation(async (_workspaceRef: string, _path: string, input: { displayName: string; keywords: string[]; summary: string | null }) => ({
      ...mocks.file,
      ...input,
    }));
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);
    await screen.findByRole("heading", { name: "Source coverage" }, { timeout: 3_000 });

    fireEvent.click(screen.getByRole("button", { name: "Uploads" }));
    fireEvent.click(screen.getByRole("button", { name: /support guide.*support-guide\.pdf/i }));
    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    const sourceView = screen.getByRole("group", { name: "Source view" });
    fireEvent.click(within(sourceView).getByRole("button", { name: "Metadata" }));
    expect(screen.getByRole("heading", { name: "Source metadata" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent-facing identity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Discovery signals" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Source record" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="source-metadata-layout"]')).toHaveStyle({ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 23rem), 1fr))" });
    expect(screen.getByRole("button", { name: "Save metadata" })).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("Support guide"), { target: { value: "Support handbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove keyword escalation" }));
    const keywordInput = screen.getByRole("textbox", { name: "Add keyword" });
    fireEvent.change(keywordInput, { target: { value: "billing" } });
    fireEvent.keyDown(keywordInput, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove keyword billing" })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("How to resolve and escalate customer issues."), { target: { value: "Customer issue resolution." } });
    expect(screen.getByRole("button", { name: "Save metadata" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));

    await waitFor(() => expect(mocks.updateFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf", {
      displayName: "Support handbook",
      keywords: ["support", "billing"],
      summary: "Customer issue resolution.",
    }));

    fireEvent.click(within(sourceView).getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/Escalate billing issues to the account team/i)).toBeInTheDocument();
    expect(mocks.markdownFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf");
  });

  it("uploads sources and assigns another account agent to the Domain", async () => {
    const uploadedFile = {
      ...mocks.file,
      id: "file-2",
      path: "launch-notes.md",
      displayName: "launch-notes.md",
      processingState: "pending",
      fileState: "uploaded",
    };
    mocks.uploadFile.mockResolvedValue(uploadedFile);
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);
    await screen.findByRole("heading", { name: "Source coverage" });

    fireEvent.click(screen.getByRole("button", { name: "Uploads" }));
    const upload = new File(["# Launch"], "launch-notes.md", { type: "text/markdown" });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [upload] } });
    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledWith("support-playbook", upload, {
      path: "launch-notes.md",
      filename: "launch-notes.md",
    }));

    fireEvent.click(screen.getByRole("tab", { name: "Assigned agents" }));
    const addResearch = await screen.findByRole("button", { name: "Assign Research Agent to Domain" });
    const accessReadCount = mocks.listGrants.mock.calls.length;
    fireEvent.click(addResearch);
    await waitFor(() => expect(mocks.grantAccess).toHaveBeenCalledWith("support-playbook", {
      subjectType: "agent",
      subjectId: "agent-research",
      role: "viewer",
    }));
    expect(mocks.listGrants).toHaveBeenCalledTimes(accessReadCount);
    expect(await screen.findByRole("button", { name: "Remove Research Agent from Domain" })).toHaveAttribute("aria-pressed", "true");
    expect(within(document.querySelector('[data-lane="assigned"]') as HTMLElement).getByText("Research Agent")).toBeInTheDocument();
    expect(mocks.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
  });

  it("refreshes after the provider provisions the first Domain", async () => {
    mocks.contextWorkspaces = [];
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([mocks.workspace]);
    const view = renderWithClient(<KnowledgeHub agents={mocks.agents} />);

    expect(await screen.findByText("No Domains yet")).toBeInTheDocument();
    mocks.contextWorkspaces = [mocks.workspace];
    view.rerender(<KnowledgeHub agents={mocks.agents} />);

    expect((await screen.findAllByText("Support playbook")).length).toBeGreaterThan(0);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("does not let an older refresh erase a completed upload", async () => {
    const uploadedFile = {
      ...mocks.file,
      id: "file-2",
      path: "launch-notes.md",
      displayName: "launch-notes.md",
      processingState: "pending",
      fileState: "uploaded",
    };
    let resolveRefresh: ((files: Array<typeof mocks.file>) => void) | undefined;
    mocks.uploadFile.mockResolvedValue(uploadedFile);
    renderWithClient(<KnowledgeHub agents={mocks.agents} />);
    await screen.findByRole("heading", { name: "Source coverage" });
    fireEvent.click(screen.getByRole("button", { name: "Uploads" }));

    mocks.listFiles.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Knowledge and agents" }));
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledTimes(2));

    const upload = new File(["# Launch"], "launch-notes.md", { type: "text/markdown" });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [upload] } });
    expect((await screen.findAllByText("launch-notes.md")).length).toBeGreaterThan(0);

    await act(async () => resolveRefresh?.([mocks.file]));
    await waitFor(() => expect(screen.getAllByText("launch-notes.md").length).toBeGreaterThan(0));
  });
});
