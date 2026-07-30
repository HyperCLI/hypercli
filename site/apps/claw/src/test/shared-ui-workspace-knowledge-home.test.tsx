import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Workspace,
  WorkspaceFile,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceKnowledgeHome } from "@hypercli/shared-ui";

const workspace: Workspace = {
  id: "workspace-1",
  name: "research-hub",
  slug: "research-hub",
  description: "Research briefs and source material",
  displayName: "Research Hub",
  displaySlug: null,
  role: "admin",
  createdAt: null,
  updatedAt: null,
};

const scopedWorkspace: Workspace = {
  ...workspace,
  id: "workspace-2",
  name: "customer-library",
  slug: "customer-library",
  description: "Customer research and roadmap notes",
  displayName: "Customer Library",
  role: "viewer",
};

const files: WorkspaceFile[] = [
  {
    id: "file-1",
    workspaceId: workspace.id,
    path: "briefs/market.md",
    displayName: "Market brief",
    currentVersionId: "version-1",
    fileState: "processed",
    uploadStatus: "uploaded",
    processingState: "processed",
    keywords: [],
    summary: null,
  },
  {
    id: "file-2",
    workspaceId: workspace.id,
    path: "briefs/customer.md",
    displayName: "Customer brief",
    currentVersionId: "version-2",
    fileState: "processed",
    uploadStatus: "uploaded",
    processingState: "processed",
    keywords: [],
    summary: null,
  },
];

const grants = [{
  id: "grant-1",
  workspaceId: workspace.id,
  subjectType: "agent",
  subjectId: "agent-1",
  role: "viewer",
  displayName: "Research Agent",
  displaySlug: null,
  isOwner: false,
  expiresAt: null,
  revokedAt: null,
}];

describe("WorkspaceKnowledgeHome", () => {
  it("joins workspace agents with live shared knowledge details", async () => {
    const onOpenKnowledge = vi.fn();
    const knowledgeClient: Pick<WorkspacesAPI, "listFiles" | "listGrants"> = {
      listFiles: vi.fn().mockResolvedValue(files),
      listGrants: vi.fn().mockResolvedValue(grants),
    };

    render(
      <WorkspaceKnowledgeHome
        workspace={workspace}
        workspaces={[workspace]}
        knowledgeClient={knowledgeClient}
        agents={[{ id: "agent-1", name: "Research Agent", state: "running" }]}
        selectedWorkspaceAgentIds={["agent-1"]}
        onOpenKnowledge={onOpenKnowledge}
      />,
    );

    expect(screen.getByRole("heading", { name: "Research Hub", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2 files")).toBeInTheDocument());
    expect(screen.getByText("Available to reference")).toBeInTheDocument();
    expect(screen.getByText("1 assigned")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Research Hub in Shared resources" }));
    expect(onOpenKnowledge).toHaveBeenCalledWith(workspace.id);
  });

  it("marks scoped access as partial and searches loaded file metadata", async () => {
    const listGrants = vi.fn().mockResolvedValue(grants);
    const knowledgeClient: Pick<WorkspacesAPI, "listFiles" | "listGrants"> = {
      listFiles: vi.fn().mockImplementation(async (workspaceRef: string) => workspaceRef === scopedWorkspace.slug
        ? [{ ...files[0], id: "roadmap-file", workspaceId: scopedWorkspace.id, path: "planning/roadmap.md", displayName: "Roadmap" }]
        : files),
      listGrants,
    };

    render(
      <WorkspaceKnowledgeHome
        workspace={workspace}
        workspaces={[workspace, scopedWorkspace]}
        knowledgeClient={knowledgeClient}
        agents={[{ id: "agent-1", name: "Research Agent", state: "running" }]}
        selectedWorkspaceAgentIds={["agent-1"]}
        onOpenKnowledge={vi.fn()}
      />,
    );

    const summary = screen.getByRole("region", { name: "Workspace summary" });
    await waitFor(() => expect(within(summary).getByText("1+")).toBeInTheDocument());
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    expect(listGrants).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Search shared knowledge" }), { target: { value: "roadmap" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Customer Library in Shared resources" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Open Research Hub in Shared resources" })).not.toBeInTheDocument();
  });

  it("hides retained coverage while the agent roster is refreshing", async () => {
    const knowledgeClient: Pick<WorkspacesAPI, "listFiles" | "listGrants"> = {
      listFiles: vi.fn().mockResolvedValue(files),
      listGrants: vi.fn().mockResolvedValue(grants),
    };

    render(
      <WorkspaceKnowledgeHome
        workspace={workspace}
        workspaces={[workspace]}
        knowledgeClient={knowledgeClient}
        agents={[{ id: "agent-1", name: "Research Agent", state: "running" }]}
        selectedWorkspaceAgentIds={["agent-1"]}
        agentsLoading
        onOpenKnowledge={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Loading agent knowledge reach.")).toBeInTheDocument());
    expect(screen.queryByRole("progressbar", { name: "Workspace knowledge coverage" })).not.toBeInTheDocument();
  });
});
