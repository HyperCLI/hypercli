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
    name: "Product Documentation",
    slug: "product-docs",
    description: "Shared product specs",
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
    create: vi.fn(async () => workspace({ id: "workspace-2", name: "Support Docs", slug: "support-docs", description: "Customer support procedures." })),
    listFiles: vi.fn(async () => [workspaceFile()]),
    listGrants: vi.fn(async () => [workspaceGrant()]),
    update: vi.fn(async () => workspace({ name: "Renamed Documentation", description: "Updated docs" })),
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

    expect(await screen.findByText("Product Documentation")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("docs"));
    expect(screen.getByText("brief.md")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
    expect(workspaces.list).toHaveBeenCalledTimes(1);
    expect(workspaces.listFiles).toHaveBeenCalledWith("product-docs");
    expect(workspaces.listGrants).toHaveBeenCalledWith("product-docs");
  });

  it("creates a workspace and grants selected agents", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Product Documentation");

    fireEvent.click(screen.getByRole("button", { name: /new knowledge base/i }));
    fireEvent.change(screen.getByPlaceholderText(/product documentation/i), { target: { value: "Support Docs" } });
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
    await screen.findByText("Product Documentation");

    const file = new File(["# Upload"], "upload.md", { type: "text/markdown" });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(workspaces.uploadFile).toHaveBeenCalledWith(
      "product-docs",
      file,
      { path: "upload.md", filename: "upload.md" },
    ));

    fireEvent.click(screen.getByRole("button", { name: /delete docs\/brief\.md/i }));

    await waitFor(() => expect(workspaces.deleteFile).toHaveBeenCalledWith("product-docs", "docs/brief.md"));
  });

  it("updates and deletes workspaces through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Product Documentation");

    fireEvent.click(screen.getByRole("button", { name: /edit product documentation/i }));
    fireEvent.change(screen.getByDisplayValue("Product Documentation"), { target: { value: "Renamed Documentation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(workspaces.update).toHaveBeenCalledWith("product-docs", {
      name: "Renamed Documentation",
      description: "Shared product specs",
    }));

    fireEvent.click(screen.getByRole("button", { name: /delete product documentation/i }));

    await waitFor(() => expect(workspaces.delete).toHaveBeenCalledWith("product-docs"));
  });

  it("grants and revokes agent access through the SDK", async () => {
    const workspaces = renderSharedKnowledgePanel();
    await screen.findByText("Product Documentation");

    const productCard = screen.getByText("Product Documentation").closest("article");
    expect(productCard).toBeInstanceOf(HTMLElement);
    const product = within(productCard as HTMLElement);

    fireEvent.click(product.getByRole("button", { name: /assign agent/i }));
    fireEvent.click(product.getByRole("button", { name: /brand agent/i }));

    await waitFor(() => expect(workspaces.grant).toHaveBeenCalledWith(
      "product-docs",
      { subjectType: "agent", subjectId: "agent-brand", role: "viewer" },
    ));

    fireEvent.click(product.getByRole("button", { name: /docs agent/i }));

    await waitFor(() => expect(workspaces.revokeGrant).toHaveBeenCalledWith("product-docs", "grant-1"));
  });

  it("shows an unavailable state when the Workspaces SDK is missing", () => {
    renderWithClient(<SharedKnowledgePanel agents={agents} workspaces={null} ready={false} />);

    expect(screen.getByText("Shared knowledge is not connected.")).toBeInTheDocument();
  });
});
