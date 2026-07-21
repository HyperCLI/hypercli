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
    name: "Team knowledge",
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
    processingState: "pending",
    keywords: ["handoff", "brief"],
    summary: "Projected shared knowledge content.",
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
    workspaceName: "Team knowledge",
    workspaceSlug: "team-knowledge",
    snapshotId: "snapshot-1",
    basePath: "/home/node/workspaces/team-knowledge",
    markdownFiles: [
      {
        file_id: "file-1",
        path: "docs/brief.md",
        version: 1,
        part_count: 1,
        keywords: ["handoff", "brief"],
        summary: "Projected shared knowledge content.",
        state: "processed",
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
    markdownFile: vi.fn(async () => ({
      markdownFile: workspaceManifest().markdownFiles[0],
      markdown: "---\npath: \"docs/brief.md\"\nversion: 1\nkeywords: [\"handoff\",\"brief\"]\n---\n\n# Brief\n\nProjected shared knowledge content.\n",
    })),
    downloadUrl: vi.fn(async () => ({
      fileId: "file-1",
      path: "docs/brief.md",
      version: 1,
      url: "https://storage.example.test/signed",
      downloadCommand: "hyper workspaces download team-knowledge/docs/brief.md",
    })),
    downloadFileBytes: vi.fn(async () => ({
      content: new Uint8Array([35, 32, 66, 114, 105, 101, 102]),
      path: "docs/brief.md",
      name: "brief.md",
    })),
    update: vi.fn(async () => workspace({ name: "Renamed knowledge", description: "Updated notes" })),
    updateFile: vi.fn(async () => workspaceFile({ displayName: "brief-renamed.md" })),
    delete: vi.fn(async () => undefined),
    grant: vi.fn(async () => workspaceGrant({ id: "grant-2", subjectId: "agent-brand" })),
    revokeGrant: vi.fn(async () => undefined),
    uploadFile: vi.fn(async () => workspaceFile({ id: "file-2", path: "upload.md", displayName: "upload.md" })),
    deleteFile: vi.fn(async () => undefined),
    regenerateFile: vi.fn(async () => workspaceFile({ processingState: "pending" })),
    ...overrides,
  };
}

function renderSharedKnowledgePanel(workspaces = mockWorkspaces()) {
  renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={workspaces as any} ready />);
  return workspaces;
}

async function waitForTeamKnowledge() {
  expect((await screen.findAllByText("Team knowledge")).length).toBeGreaterThan(0);
}

describe("SharedKnowledgePanel", () => {
  it("loads shared knowledge, files, and assigned agents from the Workspaces SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();

    await waitForTeamKnowledge();
    fireEvent.click(await screen.findByText("docs"));
    expect(await screen.findByText("brief.md")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
    expect(workspaces.list).toHaveBeenCalledTimes(1);
    expect(workspaces.listFiles).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.listGrants).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.manifest).toHaveBeenCalledWith("team-knowledge");
  });

  it("uses the backend search endpoint for shared knowledge, file, and metadata queries", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    fireEvent.change(screen.getByPlaceholderText(/search shared knowledge/i), { target: { value: "brief.md" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("brief.md"));
    await waitForTeamKnowledge();

    fireEvent.change(screen.getByPlaceholderText(/search shared knowledge/i), { target: { value: "handoff" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("handoff"));
    await waitForTeamKnowledge();

    fireEvent.change(screen.getByPlaceholderText(/search shared knowledge/i), { target: { value: "missing-term" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("missing-term"));
    await waitFor(() => expect(screen.queryAllByText("Team knowledge")).toHaveLength(0));
    expect(screen.getByText("No shared knowledge found.")).toBeInTheDocument();
  });

  it("creates shared knowledge and grants selected agents", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /new shared knowledge/i }));
    fireEvent.change(screen.getByPlaceholderText(/team knowledge/i), { target: { value: "Support Docs" } });
    fireEvent.change(screen.getByPlaceholderText(/what should agents find here/i), { target: { value: "Customer support procedures." } });
    fireEvent.click(screen.getByRole("button", { name: /create shared knowledge/i }));

    await waitFor(() => expect(workspaces.create).toHaveBeenCalledWith({
      name: "Support Docs",
      description: "Customer support procedures.",
    }));
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-docs", role: "viewer" });
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" });
  });

  it("uploads and deletes shared knowledge files through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

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

  it("opens files through synthesized Markdown", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("brief.md"));
    fireEvent.click(screen.getByRole("button", { name: /markdown/i }));

    await waitFor(() => expect(workspaces.markdownFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
    expect(await screen.findByText(/Projected shared knowledge content/i)).toBeInTheDocument();
  });

  it("updates selected shared knowledge file metadata through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

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
  });

  it("updates and deletes shared knowledge through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /edit team knowledge/i }));
    fireEvent.change(screen.getByDisplayValue("Team knowledge"), { target: { value: "Renamed knowledge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(workspaces.update).toHaveBeenCalledWith("team-knowledge", {
      name: "Renamed knowledge",
      description: "Shared team notes",
    }));

    fireEvent.click(screen.getByRole("button", { name: /delete team knowledge/i }));

    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));
  });

  it("grants and revokes agent access through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await waitForTeamKnowledge();

    const knowledgeCard = screen.getAllByText("Team knowledge")[0].closest("article");
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

  it("shows an unavailable state when shared knowledge is not connected", () => {
    renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={null} ready={false} />);

    expect(screen.getByText("Shared knowledge is not connected.")).toBeInTheDocument();
  });
});
