import type { ComponentProps } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@/components/dashboard/files/types";
import { renderWithClient } from "@/test/utils";
import { AgentFilesPanel } from "./AgentFilesPanel";

function renderAgentFilesPanel(
  overrides: Partial<ComponentProps<typeof AgentFilesPanel>> = {},
) {
  const props: ComponentProps<typeof AgentFilesPanel> = {
    agentName: "First Agent",
    agentState: "RUNNING",
    rootPath: "workspace",
    connected: true,
    connecting: false,
    hydrating: false,
    error: null,
    onListFiles: vi.fn().mockResolvedValue([]),
    onOpenFile: vi.fn().mockResolvedValue(""),
    onSaveFile: vi.fn().mockResolvedValue(undefined),
    onDeleteFile: vi.fn().mockResolvedValue(undefined),
    onUploadFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    props,
    ...renderWithClient(<AgentFilesPanel {...props} />),
  };
}

describe("AgentFilesPanel", () => {
  it("fetches root folders and files, then refetches when a folder is opened", async () => {
    const rootEntries: FileEntry[] = [
      { name: "docs", path: "workspace/docs", type: "directory" },
      { name: "README.md", path: "workspace/README.md", type: "file", size: 128 },
    ];
    const docsEntries: FileEntry[] = [
      { name: "guide.md", path: "workspace/docs/guide.md", type: "file", size: 256 },
    ];
    const onListFiles = vi.fn(async (path?: string) => (
      path === "workspace/docs" ? docsEntries : rootEntries
    ));

    renderAgentFilesPanel({ onListFiles });

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(onListFiles).toHaveBeenCalledWith("workspace");

    await userEvent.click(screen.getByRole("button", { name: /docs/i }));

    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("workspace/docs"));
    expect(await screen.findByText("guide.md")).toBeInTheDocument();
  });

  it("shows the list loading state while stopped agents fetch files", async () => {
    let resolveList: (entries: FileEntry[]) => void = () => {};
    const onListFiles = vi.fn(
      () => new Promise<FileEntry[]>((resolve) => {
        resolveList = resolve;
      }),
    );

    renderAgentFilesPanel({
      agentState: "STOPPED",
      onListFiles,
    });

    expect(await screen.findByText("Loading folders and files.")).toBeInTheDocument();

    resolveList([{ name: "README.md", path: "workspace/README.md", type: "file" }]);
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });

  it("uploads into the current folder and refreshes the displayed list", async () => {
    const entries: FileEntry[] = [
      { name: "README.md", path: "workspace/README.md", type: "file", size: 128 },
    ];
    const onListFiles = vi.fn(async () => [...entries]);
    const onUploadFile = vi.fn(async (path: string, content: string) => {
      entries.push({ name: path.split("/").pop() ?? path, path, type: "file", size: content.length });
    });

    const { container } = renderAgentFilesPanel({ onListFiles, onUploadFile });

    expect(await screen.findByText("README.md")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Upload files"));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    await userEvent.upload(input!, new File(["hello"], "notes.txt", { type: "text/plain" }));

    await waitFor(() => expect(onUploadFile).toHaveBeenCalledWith("workspace/notes.txt", "hello"));
    await waitFor(() => expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0));
    expect(onListFiles).toHaveBeenCalledTimes(2);
  });
});
