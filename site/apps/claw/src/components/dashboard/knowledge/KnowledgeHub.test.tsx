import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const failedFile = {
    ...file,
    id: "file-failed",
    path: "policies/broken-policy.pdf",
    displayName: "Broken policy",
    currentVersionId: "version-failed",
    fileState: "failed",
    processingState: "failed",
    keywords: ["policy"],
    summary: "A source that needs regeneration.",
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
    failedFile,
    grant,
    agents,
    grants: [grant] as Array<typeof grant>,
    contextWorkspaces: [workspace] as Array<typeof workspace>,
    clientAvailable: true,
    workspacesLoading: false,
    workspaceError: null as string | null,
    refreshWorkspaces: vi.fn(async () => true),
    refreshSelectedWorkspaceAgents: vi.fn(async () => true),
    list: vi.fn(async () => [workspace]),
    get: vi.fn(async () => workspace),
    listFiles: vi.fn(async () => [file]),
    listGrants: vi.fn(async () => [grant]),
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
    saveDownloadedFile: vi.fn(),
  };
});

vi.mock("@/components/dashboard/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/lib/download-file", () => ({
  downloadFileBytes: mocks.saveDownloadedFile,
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => {
  const workspacesClient = {
    list: mocks.list,
    get: mocks.get,
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
      workspacesClient: mocks.clientAvailable ? workspacesClient : null,
      workspaces: mocks.contextWorkspaces,
      selectedWorkspaceId: "workspace-1",
      isLoading: mocks.workspacesLoading,
      error: mocks.workspaceError,
      refreshWorkspaces: mocks.refreshWorkspaces,
      refreshSelectedWorkspaceAgents: mocks.refreshSelectedWorkspaceAgents,
    }),
  };
});

import { renderWithClient } from "@/test/utils";
import { KnowledgeHub } from "./KnowledgeHub";

type KnowledgeHubTestProps = Omit<ComponentProps<typeof KnowledgeHub>, "agents">;
const HEADER_CONTROLS_TARGET_ID = "knowledge-hub-test-controls";

function renderKnowledgeHub(props: KnowledgeHubTestProps = {}) {
  return renderWithClient(<KnowledgeHub agents={mocks.agents} {...props} />);
}

function collectionOpenButton(name: string): HTMLButtonElement {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return within(screen.getByRole("region", { name: "Collections catalog" })).getByRole("button", {
    name: new RegExp(`^${escapedName}`),
  });
}

async function openCollection(name = "Support playbook") {
  await screen.findByRole("region", { name: "Collections catalog" });
  fireEvent.click(collectionOpenButton(name));
  return screen.findByRole("heading", { level: 1, name });
}

async function renderSupportDetail(props: KnowledgeHubTestProps = {}) {
  const view = renderKnowledgeHub({ initialCollectionId: "workspace-1", ...props });
  await screen.findByRole("heading", { level: 1, name: "Support playbook" });
  return view;
}

function installHeaderControlsTarget(): HTMLElement {
  const target = document.createElement("div");
  target.id = HEADER_CONTROLS_TARGET_ID;
  document.body.appendChild(target);
  return target;
}

afterEach(() => {
  document.getElementById(HEADER_CONTROLS_TARGET_ID)?.remove();
});

beforeEach(() => {
  mocks.grants = [mocks.grant];
  mocks.contextWorkspaces = [mocks.workspace];
  mocks.clientAvailable = true;
  mocks.workspacesLoading = false;
  mocks.workspaceError = null;

  mocks.refreshWorkspaces.mockReset();
  mocks.refreshWorkspaces.mockResolvedValue(true);
  mocks.refreshSelectedWorkspaceAgents.mockReset();
  mocks.refreshSelectedWorkspaceAgents.mockResolvedValue(true);

  mocks.list.mockReset();
  mocks.list.mockResolvedValue([mocks.workspace]);
  mocks.get.mockReset();
  mocks.get.mockResolvedValue(mocks.workspace);
  mocks.listFiles.mockReset();
  mocks.listFiles.mockImplementation(async (workspaceRef: string) => (
    workspaceRef === mocks.workspace.slug ? [mocks.file] : []
  ));
  mocks.listGrants.mockReset();
  mocks.listGrants.mockImplementation(async (workspaceRef: string) => (
    workspaceRef === mocks.workspace.slug ? [...mocks.grants] : []
  ));

  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.deleteCollection.mockReset();
  mocks.deleteCollection.mockResolvedValue(undefined);
  mocks.uploadFile.mockReset();
  mocks.updateFile.mockReset();
  mocks.regenerateFile.mockReset();
  mocks.deleteFile.mockReset();
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.grantAccess.mockReset();
  mocks.grantAccess.mockImplementation(async (_workspaceRef: string, input: { subjectId: string }) => {
    const grant = { ...mocks.grant, id: `grant-${input.subjectId}`, subjectId: input.subjectId };
    mocks.grants.push(grant);
    return grant;
  });
  mocks.revokeGrant.mockReset();
  mocks.revokeGrant.mockResolvedValue(undefined);
  mocks.markdownFile.mockReset();
  mocks.markdownFile.mockResolvedValue({
    markdownFile: { file_id: "file-1", path: "guides/support-guide.pdf", state: "processed" },
    markdown: "# Support guide\n\nEscalate billing issues to the account team.",
  });
  mocks.downloadFileBytes.mockReset();
  mocks.downloadFileBytes.mockResolvedValue({
    content: new TextEncoder().encode("Support source"),
    path: "guides/support-guide.pdf",
    name: "support-guide.pdf",
  });
  mocks.saveDownloadedFile.mockReset();
});

describe("KnowledgeHub", () => {
  it("renders the Collections index and reports that no Collection is selected", async () => {
    const onSelectedCollectionChange = vi.fn();
    renderKnowledgeHub({ onSelectedCollectionChange });

    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Knowledge controls" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search Collections and sources" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Knowledge and agents" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New collection" })).toBeInTheDocument();

    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledWith("support-playbook"));
    const catalog = await screen.findByRole("region", { name: "Collections catalog" });
    expect(within(catalog).getByRole("button", { name: /^Support playbook/ })).toBeInTheDocument();
    expect(within(catalog).getByText("1 resource")).toBeInTheDocument();
    expect(within(catalog).getByText("1 agent")).toBeInTheDocument();
    expect(within(catalog).getByText("No exceptions")).toBeInTheDocument();

    fireEvent.click(within(catalog).getByRole("button", { name: "Show resource breakdown for Support playbook" }));
    const breakdown = await screen.findByText("Resource breakdown");
    expect(within(breakdown.parentElement as HTMLElement).getByText("1 source")).toBeInTheDocument();
    await waitFor(() => expect(onSelectedCollectionChange).toHaveBeenLastCalledWith(null));
  });

  it("renders the instructional flow without catalog controls when the account has no Collections", async () => {
    mocks.contextWorkspaces = [];
    mocks.list.mockResolvedValue([]);
    renderKnowledgeHub();

    expect(await screen.findByRole("heading", { name: "Create a shared foundation for your agents" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Search Collections and sources" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Knowledge, skills, and integrations flow into a Collection and become available to assigned agents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first collection" })).toBeInTheDocument();
  });

  it("opens a Collection from the index without a remount and notifies navigation", async () => {
    const onNavigateCollection = vi.fn();
    const onSelectedCollectionChange = vi.fn();
    renderKnowledgeHub({ onNavigateCollection, onSelectedCollectionChange });

    const detailHeading = await openCollection();

    expect(onNavigateCollection).toHaveBeenCalledWith("workspace-1");
    await waitFor(() => expect(detailHeading).toHaveFocus());
    for (const name of ["Overview", "Knowledge", "Agents", "Skills", "Integrations"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(onSelectedCollectionChange).toHaveBeenLastCalledWith({
      id: "workspace-1",
      name: "Support playbook",
      description: "Escalation guidance and support procedures.",
      sourceCount: 1,
      assignedAgentCount: 1,
      processingCount: 0,
      failedCount: 0,
    }));
  });

  it("renders an explicitly requested Collection and all detail tabs", async () => {
    await renderSupportDetail();

    expect(screen.queryByRole("heading", { level: 1, name: "Collections" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Overview",
      "Knowledge",
      "Agents",
      "Skills",
      "Integrations",
    ]);
    expect(screen.getByRole("heading", { name: "Knowledge health" })).toBeInTheDocument();
  });

  it("keeps viewer Collections read-only across Knowledge, Agents, and capability tabs", async () => {
    const viewerWorkspace = { ...mocks.workspace, role: "viewer" };
    mocks.contextWorkspaces = [viewerWorkspace];
    mocks.list.mockResolvedValue([viewerWorkspace]);

    renderKnowledgeHub({ initialCollectionId: viewerWorkspace.id });
    await screen.findByRole("heading", { level: 1, name: "Support playbook" });

    expect(screen.queryByRole("button", { name: "Add to collection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions for Support playbook" })).not.toBeInTheDocument();
    expect(mocks.listGrants).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    expect(screen.queryByRole("button", { name: "Upload files" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(await screen.findByText("Agent assignments are scoped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByRole("heading", { name: "Shared skills are coming soon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add skills" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "Integrations" }));
    expect(screen.getByRole("heading", { name: "Shared integrations are coming soon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add integrations" })).toBeDisabled();
  });

  it("shows an unavailable state for an unknown requested ID and returns to the index", async () => {
    const onNavigateCollection = vi.fn();
    renderKnowledgeHub({ initialCollectionId: "workspace-missing", onNavigateCollection });

    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledWith("support-playbook"));
    expect(await screen.findByRole("heading", { level: 1, name: "Collection unavailable" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Collections" }));

    expect(onNavigateCollection).toHaveBeenLastCalledWith(null);
    const indexHeading = await screen.findByRole("heading", { level: 1, name: "Collections" });
    await waitFor(() => expect(indexHeading).toHaveFocus());
  });

  it("keeps a requested Collection in a loading state while the workspace client connects", async () => {
    mocks.clientAvailable = false;
    mocks.workspacesLoading = true;

    renderKnowledgeHub({ initialCollectionId: "workspace-1" });

    expect(screen.getByRole("status", { name: "Loading requested Collection" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collection unavailable" })).not.toBeInTheDocument();
  });

  it("does not flash unavailable while an initial Collection catalog request is pending", async () => {
    let resolveList: ((workspaces: Array<typeof mocks.workspace>) => void) | undefined;
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => {
      resolveList = resolve;
    }));

    renderKnowledgeHub({ initialCollectionId: "workspace-1" });

    expect(screen.getByRole("status", { name: "Loading requested Collection" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collection unavailable" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
    await act(async () => {
      resolveList?.([mocks.workspace]);
      await Promise.resolve();
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Support playbook" })).toBeInTheDocument();
  });

  it("synchronizes external Collection history changes without remounting", async () => {
    const view = renderKnowledgeHub();
    await screen.findByRole("heading", { level: 1, name: "Collections" });

    view.rerender(<KnowledgeHub agents={mocks.agents} initialCollectionId="workspace-1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Support playbook" })).toBeInTheDocument();

    view.rerender(<KnowledgeHub agents={mocks.agents} initialCollectionId={null} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
  });

  it("closes destructive confirmations when external Collection history changes", async () => {
    const view = await renderSupportDetail();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Support playbook" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Collection" }));
    expect(screen.getByRole("alertdialog", { name: "Delete Collection?" })).toBeInTheDocument();

    view.rerender(<KnowledgeHub agents={mocks.agents} initialCollectionId={null} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Delete Collection?" })).not.toBeInTheDocument());
  });

  it("searches Collection names and source data from the index", async () => {
    const emptyWorkspace = {
      ...mocks.workspace,
      id: "workspace-empty",
      name: "Empty handbook",
      slug: "empty-handbook",
      description: "A Collection awaiting its first source.",
    };
    mocks.contextWorkspaces = [mocks.workspace, emptyWorkspace];
    mocks.list.mockResolvedValue([mocks.workspace, emptyWorkspace]);
    mocks.listFiles.mockImplementation(async (workspaceRef: string) => (
      workspaceRef === "support-playbook" ? [mocks.file] : []
    ));
    renderKnowledgeHub();

    await screen.findByRole("region", { name: "Collections catalog" });
    const search = screen.getByRole("textbox", { name: "Search Collections and sources" });
    fireEvent.change(search, { target: { value: "support-guide.pdf" } });
    await waitFor(() => expect(screen.queryByText("Empty handbook")).not.toBeInTheDocument());
    expect(collectionOpenButton("Support playbook")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "empty handbook" } });
    expect(screen.getByText("Empty handbook")).toBeInTheDocument();
    expect(screen.queryByText("Support playbook")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    expect(await screen.findByText("Support playbook")).toBeInTheDocument();
    expect(screen.getByText("Empty handbook")).toBeInTheDocument();
  });

  it("creates a Collection and opens its first-run Overview", async () => {
    const createdWorkspace = {
      ...mocks.workspace,
      id: "workspace-2",
      name: "Customer support",
      slug: "customer-support",
      description: "Policies and procedures for customer issues.",
      role: null,
      updatedAt: "2026-07-20T13:00:00Z",
    };
    mocks.create.mockResolvedValue(createdWorkspace);
    mocks.get.mockResolvedValue({ ...createdWorkspace, role: "admin" });
    const onNavigateCollection = vi.fn();
    renderKnowledgeHub({ onNavigateCollection });
    await screen.findByRole("region", { name: "Collections catalog" });

    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = screen.getByRole("dialog", { name: "Create collection" });
    expect(within(dialog).getByRole("checkbox", { name: "Assign Support Agent" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Assign Research Agent" })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Customer support" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Description/ }), {
      target: { value: "Policies and procedures for customer issues." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create collection" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      name: "Customer support",
      description: "Policies and procedures for customer issues.",
    }));
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledWith("customer-support"));
    expect(mocks.listGrants).toHaveBeenCalledWith("customer-support");
    expect(onNavigateCollection).toHaveBeenLastCalledWith("workspace-2");
    expect(await screen.findByRole("heading", { level: 1, name: "Customer support" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    const firstRun = document.querySelector('[data-slot="collection-first-run"]') as HTMLElement;
    expect(within(firstRun).getByRole("heading", { name: "Build your Collection" })).toBeInTheDocument();
  });

  it("assigns selected agents after creating a Collection", async () => {
    const createdWorkspace = {
      ...mocks.workspace,
      id: "workspace-2",
      name: "Customer support",
      slug: "customer-support",
      description: "Policies and procedures for customer issues.",
      role: null,
      updatedAt: "2026-07-20T13:00:00Z",
    };
    mocks.create.mockResolvedValue(createdWorkspace);
    mocks.get.mockResolvedValue({ ...createdWorkspace, role: "admin" });
    renderKnowledgeHub();
    await screen.findByRole("region", { name: "Collections catalog" });

    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = screen.getByRole("dialog", { name: "Create collection" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Customer support" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Assign Research Agent" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create collection" }));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("customer-support"));
    await waitFor(() => expect(mocks.grantAccess).toHaveBeenCalledWith("customer-support", {
      subjectType: "agent",
      subjectId: "agent-research",
      role: "viewer",
    }));
    expect(await screen.findByRole("heading", { level: 1, name: "Customer support" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveTextContent("1");
  });

  it("protects General and deletes an ordinary Collection back to the index", async () => {
    mocks.contextWorkspaces = [mocks.generalWorkspace, mocks.workspace];
    mocks.list.mockResolvedValue([mocks.generalWorkspace, mocks.workspace]);
    const onNavigateCollection = vi.fn();
    renderKnowledgeHub({ onNavigateCollection });

    await openCollection("General");
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for General" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Delete Collection" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    await openCollection();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Support playbook" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Collection" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Collection?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith("support-playbook"));
    expect(onNavigateCollection).toHaveBeenLastCalledWith(null);
    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("renames a Collection from the details editor and publishes the updated selection", async () => {
    mocks.update.mockImplementation(async (_workspaceRef: string, input: { name?: string; description?: string }) => ({
      ...mocks.workspace,
      ...input,
      updatedAt: "2026-07-20T13:00:00Z",
    }));
    const onSelectedCollectionChange = vi.fn();
    await renderSupportDetail({ onSelectedCollectionChange });

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Support playbook" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit details" }));
    const editor = screen.getByRole("dialog", { name: "Edit details" });
    const nameInput = within(editor).getByRole("textbox", { name: /^Name/ });
    fireEvent.change(nameInput, { target: { value: "Support operations" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("support-playbook", {
      name: "Support operations",
      description: "Escalation guidance and support procedures.",
    }));
    expect(await screen.findByRole("heading", { level: 1, name: "Support operations" })).toBeInTheDocument();
    await waitFor(() => expect(onSelectedCollectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "workspace-1",
      name: "Support operations",
    })));
  });

  it("uploads and searches Knowledge, including the failed-source filter", async () => {
    mocks.listFiles.mockResolvedValue([mocks.file, mocks.failedFile]);
    const uploadedFile = {
      ...mocks.file,
      id: "file-2",
      path: "launch-notes.md",
      displayName: "launch-notes.md",
      currentVersionId: "version-2",
      fileState: "uploaded",
      processingState: "pending",
      keywords: [],
      summary: "Launch procedures.",
    };
    mocks.uploadFile.mockResolvedValue(uploadedFile);
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    await screen.findByRole("region", { name: "Collection knowledge" });

    const search = screen.getByRole("textbox", { name: "Search sources" });
    fireEvent.change(search, { target: { value: "support-guide" } });
    await waitFor(() => expect(screen.queryByText("Broken policy")).not.toBeInTheDocument());
    expect(screen.getByText("Support guide")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "not-present" } });
    expect(await screen.findByRole("heading", { name: "No results found" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    fireEvent.click(await screen.findByRole("button", { name: "View failed files" }));
    expect(screen.getByText("Showing failed files")).toBeInTheDocument();
    expect(screen.getByText("Broken policy")).toBeInTheDocument();
    expect(screen.queryByText("Support guide")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Show all files" })[0]!);

    const upload = new File(["# Launch"], "launch-notes.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [upload] } });

    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledWith("support-playbook", upload, {
      path: "launch-notes.md",
      filename: "launch-notes.md",
    }));
    const drawer = await screen.findByRole("dialog", { name: "launch-notes.md" });
    expect(drawer).toHaveAttribute("data-slot", "sheet-content");
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "launch-notes.md" })).not.toBeInTheDocument());
  });

  it("previews, edits, downloads, regenerates, and deletes a source from its drawer", async () => {
    mocks.regenerateFile.mockResolvedValue(mocks.file);
    mocks.updateFile.mockImplementation(async (
      _workspaceRef: string,
      _path: string,
      input: { displayName: string; keywords: string[]; summary: string | null },
    ) => ({ ...mocks.file, ...input }));
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    const knowledge = await screen.findByRole("region", { name: "Collection knowledge" });
    fireEvent.click(within(knowledge).getByRole("button", { name: /^Support guide/ }));

    let drawer = await screen.findByRole("dialog", { name: "Support guide" });
    expect(drawer).toHaveAttribute("data-slot", "sheet-content");
    expect(await within(drawer).findByText(/Escalate billing issues to the account team/i)).toBeInTheDocument();
    expect(mocks.markdownFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf");

    let actions = within(drawer).getByRole("group", { name: "Source actions" });
    fireEvent.click(within(actions).getByRole("button", { name: "Download original source" }));
    await waitFor(() => expect(mocks.downloadFileBytes).toHaveBeenCalledWith(
      "support-playbook",
      "guides/support-guide.pdf",
      {},
      { raw: true },
    ));
    expect(mocks.saveDownloadedFile).toHaveBeenCalledWith("support-guide.pdf", expect.anything());
    expect(Array.from(mocks.saveDownloadedFile.mock.calls[0]![1] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode("Support source")),
    );

    await waitFor(() => expect(within(actions).getByRole("button", { name: "Regenerate agent view" })).toBeEnabled());
    fireEvent.click(within(actions).getByRole("button", { name: "Regenerate agent view" }));
    await waitFor(() => expect(mocks.regenerateFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf"));

    const detailsView = within(drawer).getByRole("group", { name: "Source details view" });
    fireEvent.click(within(detailsView).getByRole("button", { name: "Metadata" }));
    fireEvent.change(within(drawer).getByRole("textbox", { name: "Display name" }), {
      target: { value: "Support handbook" },
    });
    fireEvent.click(within(drawer).getByRole("button", { name: "Remove keyword escalation" }));
    const keywordInput = within(drawer).getByRole("textbox", { name: "Add keyword" });
    fireEvent.change(keywordInput, { target: { value: "billing" } });
    fireEvent.keyDown(keywordInput, { key: "Enter" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: /^Agent summary/ }), {
      target: { value: "Customer issue resolution." },
    });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save metadata" }));

    await waitFor(() => expect(mocks.updateFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf", {
      displayName: "Support handbook",
      keywords: ["support", "billing"],
      summary: "Customer issue resolution.",
    }));
    drawer = await screen.findByRole("dialog", { name: "Support handbook" });
    actions = within(drawer).getByRole("group", { name: "Source actions" });
    fireEvent.click(within(actions).getByRole("button", { name: "Delete source" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete source?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteFile).toHaveBeenCalledWith("support-playbook", "guides/support-guide.pdf"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Support handbook" })).not.toBeInTheDocument());
    expect(screen.getByText("Add knowledge your agents can rely on")).toBeInTheDocument();
  });

  it("reports source action failures inside the active drawer", async () => {
    mocks.downloadFileBytes.mockRejectedValueOnce(new Error("download failed"));
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    const knowledge = await screen.findByRole("region", { name: "Collection knowledge" });
    fireEvent.click(within(knowledge).getByRole("button", { name: /^Support guide/ }));

    const drawer = await screen.findByRole("dialog", { name: "Support guide" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Download original source" }));

    expect(await within(drawer).findByRole("alert")).toHaveTextContent("The original source couldn't be downloaded.");
  });

  it("does not leak a late source failure into another source drawer", async () => {
    let rejectDownload: ((reason?: unknown) => void) | undefined;
    mocks.listFiles.mockResolvedValue([mocks.file, mocks.failedFile]);
    mocks.downloadFileBytes.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectDownload = reject;
    }));
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    const knowledge = await screen.findByRole("region", { name: "Collection knowledge" });
    fireEvent.click(within(knowledge).getByRole("button", { name: /^Support guide/ }));

    let drawer = await screen.findByRole("dialog", { name: "Support guide" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Download original source" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Support guide" })).not.toBeInTheDocument());
    fireEvent.click(within(knowledge).getByRole("button", { name: /^Broken policy/ }));
    drawer = await screen.findByRole("dialog", { name: "Broken policy" });

    await act(async () => {
      rejectDownload?.(new Error("download failed"));
      await Promise.resolve();
    });

    expect(within(drawer).queryByText("The original source couldn't be downloaded.")).not.toBeInTheDocument();
    expect(await screen.findByText("The original source couldn't be downloaded.")).toBeInTheDocument();
  });

  it("shows assigned agents and assigns another account agent from Manage agents", async () => {
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));

    const assignedList = screen.getByRole("region", { name: "Assigned agents list" });
    expect(within(assignedList).getByText("Support Agent")).toBeInTheDocument();
    expect(within(assignedList).queryByText("Research Agent")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage agents" }));
    const manager = screen.getByRole("dialog", { name: "Manage agents" });

    const assignedLane = document.querySelector('[data-lane="assigned"]') as HTMLElement;
    const availableLane = document.querySelector('[data-lane="available"]') as HTMLElement;
    expect(within(assignedLane).getByRole("heading", { name: "Inside this Collection" })).toBeInTheDocument();
    expect(within(availableLane).getByRole("heading", { name: "Available agents" })).toBeInTheDocument();
    expect(within(assignedLane).getByText("Support Agent")).toBeInTheDocument();
    expect(within(availableLane).getByText("Research Agent")).toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "Assign Research Agent to Collection" }));
    await waitFor(() => expect(mocks.grantAccess).toHaveBeenCalledWith("support-playbook", {
      subjectType: "agent",
      subjectId: "agent-research",
      role: "viewer",
    }));
    expect(await within(manager).findByRole("button", { name: "Remove Research Agent from Collection" })).toHaveAttribute("aria-pressed", "true");
    expect(within(assignedLane).getByText("Research Agent")).toBeInTheDocument();
    expect(mocks.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
  });

  it("lets an admin revoke an assigned agent that is outside the visible roster", async () => {
    const orphanGrant = { ...mocks.grant, id: "grant-orphan", subjectId: "agent-orphan" };
    mocks.grants = [orphanGrant];
    await renderSupportDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));

    fireEvent.click(await screen.findByRole("button", { name: "Remove agent-orphan from Collection" }));
    const confirm = screen.getByRole("alertdialog", { name: "Remove agent-orphan?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.revokeGrant).toHaveBeenCalledWith("support-playbook", "grant-orphan"));
  });

  it("keyboard-navigates detail tabs and presents source details as a sheet dialog", async () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });

    try {
      await renderSupportDetail();
      const overview = screen.getByRole("tab", { name: "Overview" });
      overview.focus();
      fireEvent.keyDown(overview, { key: "ArrowRight" });
      const knowledgeTab = screen.getByRole("tab", { name: "Knowledge" });
      expect(knowledgeTab).toHaveAttribute("aria-selected", "true");
      expect(knowledgeTab).toHaveFocus();

      fireEvent.keyDown(knowledgeTab, { key: "End" });
      const integrations = screen.getByRole("tab", { name: "Integrations" });
      expect(integrations).toHaveAttribute("aria-selected", "true");
      expect(integrations).toHaveFocus();

      fireEvent.keyDown(integrations, { key: "Home" });
      expect(overview).toHaveAttribute("aria-selected", "true");
      expect(overview).toHaveFocus();

      fireEvent.click(knowledgeTab);
      const knowledge = await screen.findByRole("region", { name: "Collection knowledge" });
      fireEvent.click(within(knowledge).getByRole("button", { name: /^Support guide/ }));
      const drawer = await screen.findByRole("dialog", { name: "Support guide" });
      expect(drawer).toHaveAttribute("data-slot", "sheet-content");
      fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    } finally {
      if (originalRequestAnimationFrame) {
        Object.defineProperty(window, "requestAnimationFrame", {
          configurable: true,
          value: originalRequestAnimationFrame,
        });
      } else {
        Reflect.deleteProperty(window, "requestAnimationFrame");
      }
    }
  });

  it("refreshes the catalog and dashboard agent roster together", async () => {
    const onRefreshAgents = vi.fn(async () => true);
    const controls = installHeaderControlsTarget();
    await renderSupportDetail({ onRefreshAgents, headerControlsTargetId: HEADER_CONTROLS_TARGET_ID });

    fireEvent.click(within(controls).getByRole("button", { name: "Refresh Knowledge and agents" }));

    await waitFor(() => expect(onRefreshAgents).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("does not let an older refresh erase a completed upload", async () => {
    const uploadedFile = {
      ...mocks.file,
      id: "file-2",
      path: "launch-notes.md",
      displayName: "launch-notes.md",
      currentVersionId: "version-2",
      fileState: "uploaded",
      processingState: "pending",
      keywords: [],
      summary: "Launch procedures.",
    };
    let resolveRefresh: ((files: Array<typeof mocks.file>) => void) | undefined;
    mocks.uploadFile.mockResolvedValue(uploadedFile);
    const controls = installHeaderControlsTarget();
    await renderSupportDetail({ headerControlsTargetId: HEADER_CONTROLS_TARGET_ID });
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge" }));
    await screen.findByRole("region", { name: "Collection knowledge" });

    mocks.listFiles.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    fireEvent.click(within(controls).getByRole("button", { name: "Refresh Knowledge and agents" }));
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledTimes(2));

    const upload = new File(["# Launch"], "launch-notes.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [upload] } });
    expect(await screen.findByRole("dialog", { name: "launch-notes.md" })).toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.([mocks.file]);
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: "launch-notes.md" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "launch-notes.md" })).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "Collection knowledge" })).getByRole("button", {
      name: /^launch-notes\.md/,
    })).toBeInTheDocument();
  });
});
