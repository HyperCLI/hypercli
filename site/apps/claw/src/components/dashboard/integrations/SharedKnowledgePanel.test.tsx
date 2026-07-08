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
    name: "Team Knowledge",
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

function mockWorkspaces(overrides = {}) {
  return {
    list: vi.fn(async () => [workspace()]),
    search: vi.fn(async (query: string) => query === "missing-term" ? [] : [workspace()]),
    create: vi.fn(async () => workspace({ id: "workspace-2", name: "Support Docs", slug: "support-docs", description: "Customer support procedures." })),
    listFiles: vi.fn(async () => [workspaceFile()]),
    listGrants: vi.fn(async () => [workspaceGrant()]),
    update: vi.fn(async () => workspace({ name: "Renamed Knowledge", description: "Updated notes" })),
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

describe("SharedKnowledgePanel", () => {
  it("loads workspaces, files, and assigned agents from the Workspaces SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();

    expect(await screen.findByText("Team Knowledge")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("docs"));
    expect(screen.getByText("brief.md")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
    expect(workspaces.list).toHaveBeenCalledTimes(1);
    expect(workspaces.listFiles).toHaveBeenCalledWith("team-knowledge");
    expect(workspaces.listGrants).toHaveBeenCalledWith("team-knowledge");
  });

  it("uses the backend search endpoint for workspace, file, and metadata queries", async () => {
    const workspaces = renderSharedKnowledgePanel();
    expect(await screen.findByText("Team Knowledge")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search knowledge bases/i), { target: { value: "brief.md" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("brief.md"));
    expect(await screen.findByText("Team Knowledge")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search knowledge bases/i), { target: { value: "handoff" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("handoff"));
    expect(await screen.findByText("Team Knowledge")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search knowledge bases/i), { target: { value: "missing-term" } });
    await waitFor(() => expect(workspaces.search).toHaveBeenCalledWith("missing-term"));
    await waitFor(() => expect(screen.queryByText("Team Knowledge")).not.toBeInTheDocument());
    expect(screen.getByText("No knowledge bases found.")).toBeInTheDocument();
  });

  it("creates a workspace and grants selected agents", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Team Knowledge");

    fireEvent.click(screen.getByRole("button", { name: /new knowledge base/i }));
    fireEvent.change(screen.getByPlaceholderText(/team knowledge/i), { target: { value: "Support Docs" } });
    fireEvent.change(screen.getByPlaceholderText(/what knowledge will this base contain/i), { target: { value: "Customer support procedures." } });
    fireEvent.click(screen.getByRole("button", { name: /create knowledge base/i }));

    await waitFor(() => expect(workspaces.create).toHaveBeenCalledWith({
      name: "Support Docs",
      description: "Customer support procedures.",
    }));
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-docs", role: "viewer" });
    expect(workspaces.grant).toHaveBeenCalledWith("support-docs", { subjectType: "agent", subjectId: "agent-brand", role: "viewer" });
  });

  it("uploads and deletes workspace files through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Team Knowledge");

    const file = new File(["# Upload"], "upload.md", { type: "text/markdown" });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(workspaces.uploadFile).toHaveBeenCalledWith(
      "team-knowledge",
      file,
      { path: "upload.md", filename: "upload.md" },
    ));

    fireEvent.click(screen.getByRole("button", { name: /delete docs\/brief\.md/i }));

    await waitFor(() => expect(workspaces.deleteFile).toHaveBeenCalledWith("team-knowledge", "docs/brief.md"));
  });

  it("updates and deletes workspaces through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Team Knowledge");

    fireEvent.click(screen.getByRole("button", { name: /edit team knowledge/i }));
    fireEvent.change(screen.getByDisplayValue("Team Knowledge"), { target: { value: "Renamed Knowledge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(workspaces.update).toHaveBeenCalledWith("team-knowledge", {
      name: "Renamed Knowledge",
      description: "Shared team notes",
    }));

    fireEvent.click(screen.getByRole("button", { name: /delete team knowledge/i }));

    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("team-knowledge"));
  });

  it("grants and revokes agent access through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Team Knowledge");

    const knowledgeCard = screen.getByText("Team Knowledge").closest("article");
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

    expect(screen.getByText("Shared knowledge is not connected.")).toBeInTheDocument();
  });
});
