import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesPanel, FilesDirectoryTree } from "@hypercli/shared-ui/files";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: ComponentProps<"div"> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
    section: ({ children, initial, animate, exit, transition, ...props }: ComponentProps<"section"> & Record<string, unknown>) => (
      <section {...props}>{children}</section>
    ),
    button: ({ children, initial, animate, exit, transition, whileHover, whileTap, ...props }: ComponentProps<"button"> & Record<string, unknown>) => (
      <button {...props}>{children}</button>
    ),
    span: ({ children, initial, animate, exit, transition, whileHover, whileTap, ...props }: ComponentProps<"span"> & Record<string, unknown>) => (
      <span {...props}>{children}</span>
    ),
  },
}));

function renderPanel(overrides: Partial<ComponentProps<typeof AgentFilesPanel>> = {}) {
  return render(
    <AgentFilesPanel
      connected
      onListFiles={vi.fn(async () => [])}
      onOpenFile={vi.fn(async () => "")}
      {...overrides}
    />,
  );
}

describe("AgentFilesPanel", () => {
  it("keeps folder validation inline, amber, and programmatically associated", async () => {
    renderPanel({
      onListFiles: vi.fn(async () => []),
      onCreateDirectory: vi.fn(async () => undefined),
    });

    await screen.findByText("No files yet");

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByLabelText("Folder name");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "agent-files-new-folder-error");
    expect(document.getElementById("agent-files-new-folder-error")).toHaveTextContent("Folder name is required.");
    expect(document.getElementById("agent-files-new-folder-error")).toHaveClass("text-warning");

    fireEvent.change(input, { target: { value: "docs" } });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("passes recursive folder deletion through after shared confirmation", async () => {
    const folder = { name: "archive", path: "archive", type: "directory" as const };
    const onDeleteFile = vi.fn(async () => undefined);
    let resolveRefresh: (files: typeof folder[]) => void = () => undefined;
    const refresh = new Promise<typeof folder[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const onListFiles = vi.fn()
      .mockResolvedValueOnce([folder])
      .mockImplementationOnce(() => refresh);
    renderPanel({
      onListFiles,
      onDeleteFile,
    });

    await screen.findByText("archive");
    await waitFor(() => expect(onListFiles).toHaveBeenCalledTimes(1));
    const tree = screen.getByText("archive").closest("aside");
    expect(tree).not.toBeNull();
    fireEvent.click(within(tree as HTMLElement).getByRole("button", { name: "File actions for archive" }));
    fireEvent.click(within(tree as HTMLElement).getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete this folder?" });
    expect(onDeleteFile).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete folder" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onDeleteFile).toHaveBeenCalledWith("archive", { recursive: true }, "agent");
      expect(onListFiles).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveRefresh([]);
      await refresh;
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "Delete this folder?" })).not.toBeInTheDocument();
    });
  });
});

describe("FilesDirectoryTree", () => {
  it("confirms recursive folder deletion before invoking its callback", async () => {
    const folder = { name: "archive", path: "archive", type: "directory" as const };
    const onDeleteFile = vi.fn(async () => undefined);
    render(
      <FilesDirectoryTree
        entries={[folder]}
        onOpenFile={vi.fn()}
        onDeleteFile={onDeleteFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "File actions for archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete this folder?" });
    expect(dialog).toHaveTextContent("everything inside it");
    expect(onDeleteFile).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    });
    await waitFor(() => {
      expect(onDeleteFile).toHaveBeenCalledWith(folder);
      expect(screen.queryByRole("alertdialog", { name: "Delete this folder?" })).not.toBeInTheDocument();
    });
  });

  it("allows file deletion to be cancelled before invoking its callback", () => {
    const file = { name: "notes.txt", path: "notes.txt", type: "file" as const };
    const onDeleteFile = vi.fn();
    render(
      <FilesDirectoryTree
        entries={[file]}
        onOpenFile={vi.fn()}
        onDeleteFile={onDeleteFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "File actions for notes.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete this file?" });
    expect(dialog).toHaveTextContent("cannot be undone");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onDeleteFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Delete this file?" })).not.toBeInTheDocument();
  });
});
