import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaceContext = vi.hoisted(() => ({
  selectedWorkspaceId: "workspace-1" as string | null,
  selectedWorkspaceAgentIds: ["agent-docs"] as readonly string[],
  refreshSelectedWorkspaceAgents: vi.fn(),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => workspaceContext,
}));

import { renderWithClient } from "@/test/utils";
import { SharedKnowledgePanel, type SharedKnowledgeAgent } from "./SharedKnowledgePanel";

const agents: SharedKnowledgeAgent[] = [
  { id: "agent-docs", name: "Docs Agent", pod_name: "docs-agent", state: "RUNNING", meta: null },
  { id: "agent-brand", name: "Brand Agent", pod_name: "brand-agent", state: "STOPPED", meta: null },
];

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "workspace-1",
    name: "Team knowledge",
    slug: "team-knowledge",
    description: "Shared team notes",
    displayName: null,
    displaySlug: null,
    role: "admin",
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-07-20T10:00:00Z",
    ...overrides,
  };
}

function workspaceFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    workspaceId: "workspace-1",
    path: "docs/brief.md",
    displayName: "brief.md",
    currentVersionId: "version-1",
    fileState: "uploaded",
    uploadStatus: "uploaded",
    processingState: "pending",
    keywords: ["handoff", "brief"],
    summary: "Projected shared knowledge content.",
    ...overrides,
  };
}

function workspaceGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    workspaceId: "workspace-1",
    subjectType: "agent",
    subjectId: "agent-docs",
    role: "viewer",
    displayName: null,
    displaySlug: null,
    isOwner: false,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function workspaceManifest() {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Team knowledge",
    workspaceSlug: "team-knowledge",
    snapshotId: "snapshot-1",
    basePath: "/home/node/workspaces/team-knowledge",
    markdownFiles: [{ file_id: "file-1", path: "docs/brief.md", state: "processed" }],
  };
}

function mockWorkspaces(overrides: Record<string, unknown> = {}) {
  return {
    list: vi.fn(async () => [workspace()]),
    search: vi.fn(async (query: string) => query === "missing-term" ? [] : [workspace()]),
    create: vi.fn(async (_body: { name: string; description?: string }) => workspace({ id: "workspace-2", name: "Support Docs", slug: "support-docs", description: "Customer support procedures." })),
    listFiles: vi.fn(async (_workspaceRef: string) => [workspaceFile()]),
    listGrants: vi.fn(async (_workspaceRef: string) => [workspaceGrant()]),
    listAgents: vi.fn(async (_workspaceRef: string) => [{
      workspaceId: "workspace-1",
      agentId: "agent-docs",
      role: "viewer",
      expiresAt: null,
    }]),
    manifest: vi.fn(async (_workspaceRef: string) => workspaceManifest()),
    markdownFile: vi.fn(async (_workspaceRef: string, _path: string) => ({
      markdownFile: workspaceManifest().markdownFiles[0],
      markdown: "# Brief\n\nProjected shared knowledge content.\n",
    })),
    downloadFileBytes: vi.fn(async (_workspaceRef: string, path: string, _subject?: object, _options?: { raw?: boolean }) => ({
      content: new Uint8Array([35, 32, 66, 114, 105, 101, 102]),
      path,
      name: "brief.md",
    })),
    update: vi.fn(async (_workspaceRef: string, _body: { name?: string; description?: string }) => workspace({ name: "Renamed knowledge", description: "Updated notes" })),
    updateFile: vi.fn(async (_workspaceRef: string, _path: string, _body: object) => workspaceFile({ displayName: "brief-renamed.md" })),
    delete: vi.fn(async (_workspaceRef: string) => undefined),
    grant: vi.fn(async (_workspaceRef: string, body: { subjectId: string }) => workspaceGrant({ id: "grant-2", subjectId: body.subjectId })),
    revokeGrant: vi.fn(async (_workspaceRef: string, _grantId: string) => undefined),
    uploadFile: vi.fn(async (_workspaceRef: string, _file: Blob, options: { path?: string; filename?: string }) => workspaceFile({ id: "file-2", path: options.path, displayName: options.filename })),
    deleteFile: vi.fn(async (_workspaceRef: string, _path: string) => undefined),
    regenerateFile: vi.fn(async (_workspaceRef: string, _path: string) => workspaceFile({ processingState: "pending" })),
    ...overrides,
  };
}

function renderSharedKnowledgePanel(
  workspaces = mockWorkspaces(),
  props: Partial<ComponentProps<typeof SharedKnowledgePanel>> = {},
) {
  renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={workspaces as any} ready {...props} />);
  return workspaces;
}

async function waitForTeamKnowledge() {
  expect((await screen.findAllByText("Team knowledge")).length).toBeGreaterThan(0);
}

async function expandTeamKnowledge() {
  await waitForTeamKnowledge();
  fireEvent.click(screen.getByRole("button", { name: /expand team knowledge/i }));
}

beforeEach(() => {
  workspaceContext.selectedWorkspaceId = "workspace-1";
  workspaceContext.selectedWorkspaceAgentIds = ["agent-docs"];
  workspaceContext.refreshSelectedWorkspaceAgents.mockReset();
  workspaceContext.refreshSelectedWorkspaceAgents.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SharedKnowledgePanel", () => {
  it("loads collection metrics without eagerly fetching manifests", async () => {
    const workspaces = renderSharedKnowledgePanel();

    await waitForTeamKnowledge();
    expect(screen.getByText("1 file, 1 folder")).toBeInTheDocument();
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(workspaces.listFiles).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.listGrants).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.manifest).not.toHaveBeenCalled();
    expect(screen.queryByText("docs")).not.toBeInTheDocument();
  });

  it("refreshes the shared Workspace catalog from the visible action", async () => {
    const onWorkspacesChanged = vi.fn(async () => undefined);
    renderSharedKnowledgePanel(mockWorkspaces(), { onWorkspacesChanged });
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: "Refresh shared knowledge" }));
    expect(onWorkspacesChanged).toHaveBeenCalledOnce();
    expect(workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce();
  });

  it("expands a collection to show files and assigned agents", async () => {
    renderSharedKnowledgePanel();
    await expandTeamKnowledge();

    fireEvent.click(await screen.findByText("docs"));
    expect(await screen.findByText("brief.md")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
  });

  it("uses and updates the shared Workspace selection", async () => {
    const productWorkspace = workspace({ id: "workspace-2", name: "Product knowledge", slug: "product-knowledge" });
    const onSelectWorkspace = vi.fn();
    const workspaces = mockWorkspaces();
    renderSharedKnowledgePanel(workspaces, {
      availableWorkspaces: [workspace(), productWorkspace],
      selectedWorkspaceId: "workspace-2",
      onSelectWorkspace,
    });

    expect(await screen.findByRole("button", { name: /collapse product knowledge/i })).toBeInTheDocument();
    expect(workspaces.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /expand team knowledge/i }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-1", expect.objectContaining({ id: "workspace-1" }));
  });

  it("does not restore an old expansion when its file operation finishes", async () => {
    let resolveUpload: ((file: ReturnType<typeof workspaceFile>) => void) | undefined;
    const pendingUpload = new Promise<ReturnType<typeof workspaceFile>>((resolve) => { resolveUpload = resolve; });
    const teamWorkspace = workspace();
    const productWorkspace = workspace({ id: "workspace-2", name: "Product knowledge", slug: "product-knowledge" });
    const availableWorkspaces = [teamWorkspace, productWorkspace];
    const workspaces = mockWorkspaces({
      search: vi.fn(async (query: string) => query === "product" ? [productWorkspace] : availableWorkspaces),
      uploadFile: vi.fn(() => pendingUpload),
    });
    const view = renderWithClient(
      <SharedKnowledgePanel
        agents={agents}
        workspaces={workspaces as any}
        availableWorkspaces={availableWorkspaces as any}
        selectedWorkspaceId="workspace-1"
        ready
      />,
    );
    expect(await screen.findByRole("button", { name: /collapse team knowledge/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["# Draft"], "draft.md", { type: "text/markdown" })] } });
    await waitFor(() => expect(workspaces.uploadFile).toHaveBeenCalledOnce());

    view.rerender(
      <SharedKnowledgePanel
        agents={agents}
        workspaces={workspaces as any}
        availableWorkspaces={availableWorkspaces as any}
        selectedWorkspaceId="workspace-2"
        ready
      />,
    );
    expect(await screen.findByRole("button", { name: /collapse product knowledge/i })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /search shared knowledge/i }), { target: { value: "product" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("product"));

    await act(async () => {
      resolveUpload?.(workspaceFile({ id: "file-upload", path: "draft.md", displayName: "draft.md" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /collapse product knowledge/i })).toBeInTheDocument());
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Team knowledge")).not.toBeInTheDocument();
  });

  it("debounces backend searches and ignores stale results", async () => {
    let resolveOlder: ((value: ReturnType<typeof workspace>[]) => void) | undefined;
    const older = new Promise<ReturnType<typeof workspace>[]>((resolve) => { resolveOlder = resolve; });
    const workspaces = mockWorkspaces({
      search: vi.fn(async (query: string) => {
        if (query === "older") return older;
        return [workspace({ id: "workspace-new", name: "New result", slug: "new-result" })];
      }),
    });
    renderSharedKnowledgePanel(workspaces);
    await waitForTeamKnowledge();

    const search = screen.getByRole("textbox", { name: /search shared knowledge/i });
    fireEvent.change(search, { target: { value: "older" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("older"));
    fireEvent.change(search, { target: { value: "newer" } });
    expect(workspaces.search).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("newer"));
    expect(await screen.findByText("New result")).toBeInTheDocument();

    resolveOlder?.([workspace({ id: "workspace-old", name: "Old result", slug: "old-result" })]);
    await waitFor(() => expect(screen.queryByText("Old result")).not.toBeInTheDocument());
    expect(screen.getByText("New result")).toBeInTheDocument();
  });

  it("creates shared knowledge and defaults assignment to the focused agent", async () => {
    const onSelectWorkspace = vi.fn();
    const onWorkspacesChanged = vi.fn(async () => undefined);
    const workspaces = renderSharedKnowledgePanel(mockWorkspaces(), {
      preferredAgentId: "agent-brand",
      onSelectWorkspace,
      onWorkspacesChanged,
    });
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /new shared knowledge/i }));
    expect(screen.getByRole("button", { name: /brand agent/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /docs agent/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByPlaceholderText(/team knowledge/i), { target: { value: "Support Docs" } });
    fireEvent.change(screen.getByPlaceholderText(/what should agents find here/i), { target: { value: "Customer support procedures." } });
    fireEvent.click(screen.getByRole("button", { name: /create shared knowledge/i }));

    await waitFor(() => expect(workspaces.create).toHaveBeenCalledWith({
      name: "Support Docs",
      description: "Customer support procedures.",
    }));
    expect(workspaces.grant).toHaveBeenCalledTimes(1);
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" });
    expect(onWorkspacesChanged).toHaveBeenCalledWith("workspace-2");
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-2", expect.objectContaining({ id: "workspace-2" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new shared knowledge/i })).not.toBeInTheDocument());
  });

  it("waits for the focused agent before opening the create dialog", async () => {
    const workspaces = mockWorkspaces();
    const { rerender } = renderWithClient(
      <SharedKnowledgePanel
        agents={[]}
        agentsLoading
        preferredAgentId="agent-brand"
        workspaces={workspaces as any}
        ready
      />,
    );
    await waitForTeamKnowledge();

    expect(screen.getByRole("button", { name: /new shared knowledge/i })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: /new shared knowledge/i })).not.toBeInTheDocument();

    rerender(
      <SharedKnowledgePanel
        agents={agents}
        preferredAgentId="agent-brand"
        workspaces={workspaces as any}
        ready
      />,
    );

    const newKnowledge = screen.getByRole("button", { name: /new shared knowledge/i });
    expect(newKnowledge).toBeEnabled();
    fireEvent.click(newKnowledge);
    expect(screen.getByRole("button", { name: /brand agent/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByPlaceholderText(/team knowledge/i), { target: { value: "Support Docs" } });
    expect(screen.getByRole("button", { name: /create shared knowledge/i })).toBeEnabled();
  });

  it("keeps the create dialog open when creation fails", async () => {
    const workspaces = mockWorkspaces({ create: vi.fn(async () => { throw new Error("Create failed"); }) });
    renderSharedKnowledgePanel(workspaces);
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /new shared knowledge/i }));
    fireEvent.change(screen.getByPlaceholderText(/team knowledge/i), { target: { value: "Support Docs" } });
    fireEvent.click(screen.getByRole("button", { name: /create shared knowledge/i }));

    const dialog = screen.getByRole("dialog", { name: /new shared knowledge/i });
    expect(await within(dialog).findByText("Create failed")).toBeInTheDocument();
  });

  it("preserves MIME type on upload and confirms file deletion", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await expandTeamKnowledge();

    const file = new File(["# Upload"], "upload.md", { type: "text/markdown" });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(workspaces.uploadFile).toHaveBeenCalled());
    expect(workspaces.uploadFile.mock.calls[0]?.[0]).toBe("team-knowledge");
    expect(workspaces.uploadFile.mock.calls[0]?.[1]).toBe(file);
    expect(workspaces.uploadFile.mock.calls[0]?.[1].type).toBe("text/markdown");
    expect(workspaces.uploadFile.mock.calls[0]?.[2]).toEqual({ path: "upload.md", filename: "upload.md" });

    fireEvent.click(await screen.findByText("docs"));
    await screen.findByText("brief.md");
    fireEvent.click(screen.getByRole("button", { name: /file actions for docs\/brief\.md/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(workspaces.deleteFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: /delete file/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(workspaces.deleteFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
  });

  it("loads raw source bytes and generated Markdown with their distinct APIs", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await expandTeamKnowledge();
    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("brief.md"));

    fireEvent.click(screen.getByRole("button", { name: "raw" }));
    await waitFor(() => expect(workspaces.downloadFileBytes).toHaveBeenCalledWith("team-knowledge", "docs/brief.md", {}, { raw: true }));

    fireEvent.click(screen.getByRole("button", { name: "markdown" }));
    await waitFor(() => expect(workspaces.markdownFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
    expect(await screen.findByRole("heading", { name: "Brief" })).toBeInTheDocument();
    expect(screen.getByText(/Projected shared knowledge content/i)).toBeInTheDocument();
  });

  it("shows context-menu download failures without requiring a selected file", async () => {
    const workspaces = renderSharedKnowledgePanel(mockWorkspaces({
      downloadFileBytes: vi.fn(async () => {
        throw new Error("Download failed");
      }),
    }));
    await expandTeamKnowledge();
    fireEvent.click(await screen.findByText("docs"));
    await screen.findByText("brief.md");

    fireEvent.click(screen.getByRole("button", { name: /file actions for docs\/brief\.md/i }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
    expect(workspaces.downloadFileBytes).toHaveBeenCalledWith("team-knowledge", "docs/brief.md", {}, { raw: true });
  });

  it("updates file metadata and regenerates projections", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await expandTeamKnowledge();
    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("brief.md"));

    fireEvent.change(await screen.findByDisplayValue("brief.md"), { target: { value: "brief-renamed.md" } });
    fireEvent.change(screen.getByDisplayValue("handoff, brief"), { target: { value: "pricing, retention" } });
    fireEvent.change(screen.getByDisplayValue("Projected shared knowledge content."), { target: { value: "Renewal notes." } });
    fireEvent.click(screen.getByRole("button", { name: /save metadata/i }));
    await waitFor(() => expect(workspaces.updateFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md", {
      displayName: "brief-renamed.md",
      keywords: ["pricing", "retention"],
      summary: "Renewal notes.",
    }));

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(workspaces.regenerateFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
  });

  it("updates collections and confirms destructive deletion", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /edit team knowledge/i }));
    fireEvent.change(screen.getByDisplayValue("Team knowledge"), { target: { value: "Renamed knowledge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(workspaces.update).toHaveBeenCalledWith("team-knowledge", {
      name: "Renamed knowledge",
      description: "Shared team notes",
    }));

    fireEvent.click(screen.getByRole("button", { name: /delete renamed knowledge/i }));
    expect(workspaces.delete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: /delete shared knowledge/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));
  });

  it("does not dismiss a collection deletion while the request is in progress", async () => {
    let resolveDelete: (() => void) | undefined;
    const workspaces = renderSharedKnowledgePanel(mockWorkspaces({
      delete: vi.fn(() => new Promise<void>((resolve) => {
        resolveDelete = resolve;
      })),
    }));
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /delete team knowledge/i }));
    const dialog = screen.getByRole("alertdialog", { name: /delete shared knowledge/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));

    const cancelButtons = within(dialog).getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(screen.getByRole("alertdialog", { name: /delete shared knowledge/i })).toBeInTheDocument();

    await act(async () => resolveDelete?.());
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: /delete shared knowledge/i })).not.toBeInTheDocument());
  });

  it("removes a deleted collection locally when the refresh fails", async () => {
    const workspaces = renderSharedKnowledgePanel(mockWorkspaces({
      list: vi.fn()
        .mockResolvedValueOnce([workspace()])
        .mockRejectedValueOnce(new Error("Refresh failed")),
    }));
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /delete team knowledge/i }));
    const dialog = screen.getByRole("alertdialog", { name: /delete shared knowledge/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: /delete shared knowledge/i })).not.toBeInTheDocument());
    expect(screen.queryByText("Team knowledge")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("keeps the account agent catalog and refreshes the selected roster after assignment changes", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await expandTeamKnowledge();
    const card = screen.getAllByText("Team knowledge")[0]?.closest("article") as HTMLElement;
    const knowledge = within(card);

    fireEvent.click(knowledge.getByRole("button", { name: /assign agent/i }));
    expect(knowledge.getByRole("button", { name: /docs agent/i })).toBeInTheDocument();
    expect(knowledge.getByRole("button", { name: /brand agent/i })).toBeInTheDocument();
    fireEvent.click(knowledge.getByRole("button", { name: /brand agent/i }));
    await waitFor(() => expect(workspaces.grant).toHaveBeenCalledWith("team-knowledge", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" }));
    await waitFor(() => expect(workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledTimes(1));

    fireEvent.click(knowledge.getByRole("button", { name: /docs agent/i }));
    await waitFor(() => expect(workspaces.revokeGrant).toHaveBeenCalledWith("team-knowledge", "grant-1"));
    await waitFor(() => expect(workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledTimes(2));
  });

  it("does not refresh the selected roster for assignments to another Workspace", async () => {
    workspaceContext.selectedWorkspaceId = "workspace-2";
    const workspaces = renderSharedKnowledgePanel();
    await expandTeamKnowledge();
    const card = screen.getAllByText("Team knowledge")[0]?.closest("article") as HTMLElement;
    const knowledge = within(card);

    fireEvent.click(knowledge.getByRole("button", { name: /assign agent/i }));
    fireEvent.click(knowledge.getByRole("button", { name: /brand agent/i }));

    await waitFor(() => expect(workspaces.grant).toHaveBeenCalledWith("team-knowledge", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" }));
    await waitFor(() => expect(workspaces.listGrants).toHaveBeenCalledTimes(2));
    expect(workspaceContext.refreshSelectedWorkspaceAgents).not.toHaveBeenCalled();
  });

  it("waits for every duplicate grant revocation and refreshes after partial failure", async () => {
    const remainingGrant = workspaceGrant({ id: "grant-2" });
    const listGrants = vi.fn()
      .mockResolvedValueOnce([workspaceGrant(), remainingGrant])
      .mockResolvedValue([remainingGrant]);
    const workspaces = renderSharedKnowledgePanel(mockWorkspaces({
      listGrants,
      revokeGrant: vi.fn(async (_workspaceRef: string, grantId: string) => {
        if (grantId === "grant-2") throw new Error("Revoke failed");
      }),
    }));
    await expandTeamKnowledge();
    const card = screen.getAllByText("Team knowledge")[0]?.closest("article") as HTMLElement;
    const knowledge = within(card);

    fireEvent.click(knowledge.getByRole("button", { name: /assign agent/i }));
    fireEvent.click(knowledge.getByRole("button", { name: /docs agent/i }));

    await waitFor(() => expect(workspaces.revokeGrant).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(workspaceContext.refreshSelectedWorkspaceAgents).toHaveBeenCalledOnce());
    await waitFor(() => expect(listGrants).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 agent access grant could not be removed.");
  });

  it("shows collection-level hydration failures instead of false zero counts", async () => {
    renderSharedKnowledgePanel(mockWorkspaces({
      listFiles: vi.fn(async () => {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }),
      listGrants: vi.fn(async () => { throw new Error("grants offline"); }),
    }));
    await waitForTeamKnowledge();

    expect(screen.getByText("Files unavailable")).toBeInTheDocument();
    expect(screen.getByText("Access unavailable")).toBeInTheDocument();
    await expandTeamKnowledge();
    expect(screen.getByText(/don't have permission to view files/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent access couldn't be loaded/i)).toBeInTheDocument();
  });

  it("keeps viewer Workspaces read-only without requesting admin-only grants", async () => {
    const listGrants = vi.fn();
    const listAgents = vi.fn(async () => [{
      workspaceId: "workspace-1",
      agentId: "agent-docs",
      role: "viewer",
      expiresAt: null,
    }]);
    renderSharedKnowledgePanel(mockWorkspaces({
      list: vi.fn(async () => [workspace({ role: "viewer" })]),
      listGrants,
      listAgents,
    }));
    await expandTeamKnowledge();

    expect(listGrants).not.toHaveBeenCalled();
    expect(listAgents).toHaveBeenCalledWith("team-knowledge");
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit team knowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete team knowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("does not present missing viewer assignment data as an empty roster", async () => {
    const missingRoute = Object.assign(new Error("Not found"), { statusCode: 404 });
    renderSharedKnowledgePanel(mockWorkspaces({
      list: vi.fn(async () => [workspace({ role: "viewer" })]),
      listAgents: vi.fn(async () => { throw missingRoute; }),
    }));
    await expandTeamKnowledge();

    expect(screen.getByText("Access unavailable")).toBeInTheDocument();
    expect(screen.getByText("Agent assignments require a workspace service update.")).toBeInTheDocument();
    expect(screen.queryByText("No agents assigned.")).not.toBeInTheDocument();
  });

  it("shows an unavailable state when shared knowledge is not connected", () => {
    renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={null} ready={false} connectionError="Session expired" />);

    expect(screen.getByText("Shared knowledge is not connected.")).toBeInTheDocument();
    expect(screen.getByText("Session expired")).toBeInTheDocument();
  });
});
