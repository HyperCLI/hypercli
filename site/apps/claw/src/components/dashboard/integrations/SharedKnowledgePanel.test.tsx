import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { SharedKnowledgePanel, type SharedKnowledgeAgent } from "./SharedKnowledgePanel";

const agents: SharedKnowledgeAgent[] = [
  { id: "agent-docs", name: "Docs Agent", pod_name: "docs-agent", state: "RUNNING", meta: null },
  { id: "agent-brand", name: "Brand Agent", pod_name: "brand-agent", state: "STOPPED", meta: null },
];

function workspace(overrides = {}) {
  return {
    id: "workspace-1",
    name: "Team Workspace",
    slug: "team-knowledge",
    description: "Shared team notes",
    ...overrides,
  };
}

function workspaceFile(overrides = {}) {
  return {
    id: "file-1",
    workspaceId: "workspace-1",
    path: "docs/brief.md",
    displayName: "brief.md",
    currentVersionId: "version-1",
    fileState: "uploaded",
    uploadStatus: "uploaded",
    projectionStatus: "queued",
    keywords: ["handoff", "brief"],
    title: "Brief",
    summary: "Projected workspace content.",
    ...overrides,
  };
}

function workspaceGrant(overrides = {}) {
  return {
    id: "grant-1",
    workspaceId: "workspace-1",
    subjectType: "agent",
    subjectId: "agent-docs",
    role: "viewer",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function workspaceManifest(overrides = {}) {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Team Workspace",
    workspaceSlug: "team-knowledge",
    snapshotId: "snapshot-1",
    basePath: "/home/node/workspaces/team-knowledge",
    projections: [
      {
        file_id: "file-1",
        file_version_id: "version-1",
        projection_id: "projection-1",
        source_path: "docs/brief.md",
        source_filename: "brief.md",
        source_content_type: "text/markdown",
        source_size_bytes: 128,
        source_sha256: "sha256-brief",
        source_etag: "etag-brief",
        source_last_modified: "2026-07-09T12:00:00Z",
        projection_path: "docs/.tomd/brief.md",
        markdown_sha256: "sha256-projection",
        keywords: ["handoff", "brief"],
        status: "finished",
        markdown_body: "# Brief\n\nProjected workspace content.",
      },
    ],
    ...overrides,
  };
}

function mockWorkspaces(overrides = {}) {
  return {
    list: vi.fn(async () => [workspace()]),
    search: vi.fn(async (query: string) => query === "missing-term" ? [] : [workspace()]),
    create: vi.fn(async () => workspace({ id: "workspace-2", name: "Support Docs", slug: "support-docs", description: "Customer support procedures." })),
    listFiles: vi.fn(async () => [workspaceFile()]),
    listGrants: vi.fn(async () => [workspaceGrant()]),
    manifest: vi.fn(async () => workspaceManifest()),
    projectionMarkdown: vi.fn(async () => ({
      projection: workspaceManifest().projections[0],
      markdown: "---\nkeywords: [\"handoff\",\"brief\"]\nsource_path: \"docs/brief.md\"\n---\n\n# Brief\n\nProjected workspace content.\n",
    })),
    downloadUrl: vi.fn(async () => ({
      fileId: "file-1",
      fileVersionId: "version-1",
      sourcePath: "docs/brief.md",
      sourceS3Key: "dev/workspace-1/docs/brief.md",
      s3Bucket: "hypercli-workspaces",
      s3Endpoint: "https://storage.streamformation.com",
      url: "https://storage.example.test/signed",
      downloadCommand: "hyper workspaces download team-knowledge/docs/brief.md",
    })),
    downloadFileBytes: vi.fn(async () => ({
      content: new Uint8Array([35, 32, 66, 114, 105, 101, 102]),
      path: "docs/brief.md",
      name: "brief.md",
    })),
    update: vi.fn(async () => workspace({ name: "Renamed Workspace", description: "Updated notes" })),
    updateFile: vi.fn(async () => workspaceFile({ displayName: "brief-renamed.md", title: "Renamed Brief" })),
    delete: vi.fn(async () => undefined),
    grant: vi.fn(async () => workspaceGrant({ id: "grant-2", subjectId: "agent-brand" })),
    revokeGrant: vi.fn(async () => undefined),
    uploadFile: vi.fn(async () => workspaceFile({ id: "file-2", path: "upload.md", displayName: "upload.md" })),
    deleteFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderSharedKnowledgePanel(workspaces = mockWorkspaces()) {
  renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={workspaces as any} ready />);
  return workspaces;
}

async function waitForTeamWorkspace() {
  expect((await screen.findAllByText("Team Workspace")).length).toBeGreaterThan(0);
}

describe("SharedKnowledgePanel", () => {
  it("loads workspaces, files, and assigned agents from the Workspaces SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();

    await waitForTeamWorkspace();
    fireEvent.click(await screen.findByText("docs"));
    expect(await screen.findByText("brief.md")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
    expect(workspaces.list).toHaveBeenCalledTimes(1);
    expect(workspaces.listFiles).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.listGrants).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.manifest).toHaveBeenCalledWith("team-knowledge");
  });

  it("uses the backend search endpoint for workspace, file, and metadata queries", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    fireEvent.change(screen.getByPlaceholderText(/search workspaces/i), { target: { value: "brief.md" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("brief.md"));
    await waitForTeamWorkspace();

    fireEvent.change(screen.getByPlaceholderText(/search workspaces/i), { target: { value: "handoff" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("handoff"));
    await waitForTeamWorkspace();

    fireEvent.change(screen.getByPlaceholderText(/search workspaces/i), { target: { value: "missing-term" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("missing-term"));
    await waitFor(() => expect(screen.queryAllByText("Team Workspace")).toHaveLength(0));
    expect(screen.getByText("No workspaces found.")).toBeInTheDocument();
  });

  it("creates a workspace and grants selected agents", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    fireEvent.change(screen.getByPlaceholderText(/team workspace/i), { target: { value: "Support Docs" } });
    fireEvent.change(screen.getByPlaceholderText(/what should agents find here/i), { target: { value: "Customer support procedures." } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(workspaces.create).toHaveBeenCalledWith({
      name: "Support Docs",
      description: "Customer support procedures.",
    }));
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-docs", role: "viewer" });
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" });
  });

  it("uploads and deletes workspace files through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    const file = new File(["# Upload"], "upload.md", { type: "text/markdown" });
    fireEvent.click(screen.getByTitle("Upload files"));
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(workspaces.uploadFile).toHaveBeenCalled());
    const uploadCall = workspaces.uploadFile.mock.calls[0];
    expect(uploadCall[0]).toBe("team-knowledge");
    expect(uploadCall[2]).toEqual({ path: "upload.md", filename: "upload.md" });

    fireEvent.click(await screen.findByText("docs"));
    await screen.findByText("brief.md");
    fireEvent.click(screen.getByRole("button", { name: /file actions for docs\/brief\.md/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(workspaces.deleteFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
  });

  it("opens files through synthesized projection markdown", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("brief.md"));

    await waitFor(() => expect(workspaces.projectionMarkdown).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
    expect(await screen.findByText(/Projected workspace content/i)).toBeInTheDocument();
  });

  it("updates selected workspace file metadata through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("brief.md"));

    fireEvent.change(await screen.findByDisplayValue("brief.md"), { target: { value: "brief-renamed.md" } });
    fireEvent.change(screen.getByDisplayValue("Brief"), { target: { value: "Renamed Brief" } });
    fireEvent.change(screen.getByDisplayValue("handoff, brief"), { target: { value: "pricing, retention" } });
    fireEvent.change(screen.getByDisplayValue("Projected workspace content."), { target: { value: "Renewal notes." } });
    fireEvent.click(screen.getByRole("button", { name: /save metadata/i }));

    await waitFor(() => expect(workspaces.updateFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md", {
      displayName: "brief-renamed.md",
      title: "Renamed Brief",
      keywords: ["pricing", "retention"],
      summary: "Renewal notes.",
    }));
  });

  it("updates and deletes workspaces through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /edit team workspace/i }));
    fireEvent.change(screen.getByDisplayValue("Team Workspace"), { target: { value: "Renamed Workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(workspaces.update).toHaveBeenCalledWith("team-knowledge", {
      name: "Renamed Workspace",
      description: "Shared team notes",
    }));

    fireEvent.click(screen.getByRole("button", { name: /delete team workspace/i }));

    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));
  });

  it("grants and revokes agent access through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamWorkspace();

    const knowledgeCard = screen.getAllByText("Team Workspace")[0].closest("article");
    expect(knowledgeCard).toBeInstanceOf(HTMLElement);
    const knowledge = within(knowledgeCard as HTMLElement);

    fireEvent.click(knowledge.getByRole("button", { name: /assign agent/i }));
    fireEvent.click(knowledge.getByRole("button", { name: /brand agent/i }));

    await waitFor(() => expect(workspaces.grant).toHaveBeenCalledWith(
      "team-knowledge",
      { subjectType: "agent", subjectId: "agent-brand", role: "viewer" },
    ));

    fireEvent.click(knowledge.getByRole("button", { name: /docs agent/i }));

    await waitFor(() => expect(workspaces.revokeGrant).toHaveBeenCalledWith("team-knowledge", "grant-1"));
  });

  it("shows an unavailable state when the Workspaces SDK is missing", () => {
    renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={null} ready={false} />);

    expect(screen.getByText("Workspaces are not connected.")).toBeInTheDocument();
  });
});
