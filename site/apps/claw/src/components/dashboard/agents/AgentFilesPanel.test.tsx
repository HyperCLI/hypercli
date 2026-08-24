import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesPanel } from "./AgentFilesPanel";

function renderFilesPanel(overrides: Partial<ComponentProps<typeof AgentFilesPanel>> = {}) {
  const props: ComponentProps<typeof AgentFilesPanel> = {
    agentId: "agent-1",
    agentName: "Agent",
    rootPath: ".openclaw/workspace",
    connected: true,
    initialPreviewPath: null,
    onListFiles: vi.fn(async () => []),
    onOpenFile: vi.fn(async () => "content"),
    onSaveFile: vi.fn(async () => undefined),
    onDeleteFile: vi.fn(async () => undefined),
    onUploadFile: vi.fn(async () => undefined),
    onCreateDirectory: vi.fn(async () => undefined),
    ...overrides,
  };

  render(<AgentFilesPanel {...props} />);
  return props;
}

describe("AgentFilesPanel", () => {
  it("exposes one Reef-backed workspace without source tabs", async () => {
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onListFiles });

    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith(".openclaw/workspace"));
    expect(onListFiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tablist", { name: /file source/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /backup|gateway/i })).not.toBeInTheDocument();
  });

  it("browses stopped retained storage when the file plane is connected", async () => {
    const onListFiles = vi.fn(async () => [
      { name: "README.md", path: "README.md", type: "file" as const },
    ]);
    renderFilesPanel({ connected: true, onListFiles });

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText(/start the agent to browse/i)).not.toBeInTheDocument();
  });

  it("maps displayed workspace paths back to relative API paths", async () => {
    const onListFiles = vi.fn(async (path?: string) => path === ".openclaw/workspace"
      ? [{ name: "projects", path: "projects", type: "directory" as const }]
      : []);
    renderFilesPanel({ onListFiles });

    fireEvent.click(await screen.findByRole("button", { name: "projects" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(".openclaw/workspace/projects"));
  });

  it("uses the synchronized home as the browser root and navigates back from the workspace", async () => {
    const onListFiles = vi.fn(async (path?: string) => {
      if (path === "") {
        return [{ name: ".openclaw", path: ".openclaw", type: "directory" as const }];
      }
      if (path === ".openclaw") {
        return [{ name: "workspace", path: "workspace", type: "directory" as const }];
      }
      return [{ name: "README.md", path: "README.md", type: "file" as const }];
    });
    renderFilesPanel({ rootPath: "/home/node", onListFiles });

    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(""));
    expect(screen.getByRole("button", { name: "Up one folder" })).toBeDisabled();

    fireEvent.click(await screen.findByRole("button", { name: ".openclaw" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(".openclaw"));
    fireEvent.click(await screen.findByRole("button", { name: "workspace" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(".openclaw/workspace"));

    fireEvent.click(screen.getByRole("button", { name: "Up one folder" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(".openclaw"));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(""));
  });

  it("opens an absolute synchronized preview through a relative API path", async () => {
    const onOpenFile = vi.fn(async () => "content");
    renderFilesPanel({
      rootPath: "/home/node",
      initialPreviewPath: "/home/node/.openclaw/workspace/report.md",
      onOpenFile,
    });

    await waitFor(() => {
      expect(onOpenFile).toHaveBeenCalledWith(".openclaw/workspace/report.md");
    });
  });

  it("uses the selector-free byte reader for binary previews", async () => {
    const onOpenFile = vi.fn(async () => "text");
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([80, 75, 5, 6]));
    renderFilesPanel({
      initialPreviewPath: ".openclaw/workspace/archive.zip",
      onOpenFile,
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(
        ".openclaw/workspace/archive.zip",
        { maxBytes: 64 * 1024 * 1024, signal: expect.any(AbortSignal) },
      );
    });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("validates unknown bytes before exposing a text editor", async () => {
    const onOpenFile = vi.fn(async () => "unsafe fallback");
    const onOpenFileBytes = vi.fn(async () => new TextEncoder().encode("validated custom text"));
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "notes.custom", path: "notes.custom", type: "file" as const },
      ]),
      onOpenFile,
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "notes.custom" }));
    expect(await screen.findByRole("textbox", { name: "notes.custom contents" })).toHaveValue("validated custom text");
    expect(onOpenFileBytes).toHaveBeenCalledWith(
      ".openclaw/workspace/notes.custom",
      { maxBytes: 4 * 1024 * 1024, signal: expect.any(AbortSignal) },
    );
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("keeps invalid unknown bytes out of the text editor", async () => {
    renderFilesPanel({
      initialPreviewPath: ".openclaw/workspace/payload.custom",
      onOpenFileBytes: vi.fn(async () => new Uint8Array([0, 1, 2, 255])),
    });

    expect(await screen.findByText("File preview is not available.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "payload.custom contents" })).not.toBeInTheDocument();
  });

  it("uses response MIME metadata before decoding preview bytes", async () => {
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "upload", path: "upload", type: "file" as const },
      ]),
      onOpenFileBytes: vi.fn(async () => ({
        content: new TextEncoder().encode("%PDF-1.7"),
        mimeType: "application/pdf",
      })),
    });

    fireEvent.click(await screen.findByRole("button", { name: "upload" }));
    expect(await screen.findByLabelText("PDF preview for upload")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "upload contents" })).not.toBeInTheDocument();
  });

  it("ignores a stale read after another file is opened", async () => {
    let resolveFirst: ((content: string) => void) | undefined;
    const firstRead = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const onOpenFile = vi.fn((path: string) => path.endsWith("first.txt")
      ? firstRead
      : Promise.resolve("second content"));
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "first.txt", path: "first.txt", type: "file" as const },
        { name: "second.txt", path: "second.txt", type: "file" as const },
      ]),
      onOpenFile,
      onOpenFileBytes: undefined,
    });

    fireEvent.click(await screen.findByRole("button", { name: "first.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "second.txt" }));
    expect(await screen.findByRole("textbox", { name: "second.txt contents" })).toHaveValue("second content");
    resolveFirst?.("first content");
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("textbox", { name: "second.txt contents" })).toHaveValue("second content");
  });

  it("does not publish a completed save into another preview", async () => {
    let resolveSave: (() => void) | undefined;
    const savePending = new Promise<void>((resolve) => { resolveSave = resolve; });
    const onSaveFile = vi.fn(() => savePending);
    renderFilesPanel({
      isDesktopViewport: true,
      onListFiles: vi.fn(async () => [
        { name: "first.txt", path: "first.txt", type: "file" as const },
        { name: "second.txt", path: "second.txt", type: "file" as const },
      ]),
      onOpenFile: vi.fn(async (path: string) => path.endsWith("first.txt") ? "first content" : "second content"),
      onOpenFileBytes: undefined,
      onSaveFile,
    });

    fireEvent.click(await screen.findByRole("button", { name: "first.txt" }));
    const firstEditor = await screen.findByRole("textbox", { name: "first.txt contents" });
    fireEvent.change(firstEditor, { target: { value: "saved first content" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "second.txt" }));
    expect(await screen.findByRole("textbox", { name: "second.txt contents" })).toHaveValue("second content");
    await act(async () => {
      resolveSave?.();
      await savePending;
    });
    expect(screen.getByRole("textbox", { name: "second.txt contents" })).toHaveValue("second content");
  });

  it("aborts a bounded byte read when the preview closes", async () => {
    let readSignal: AbortSignal | undefined;
    const onOpenFileBytes = vi.fn((_path: string, options?: { signal: AbortSignal }) => {
      readSignal = options?.signal;
      return new Promise<Uint8Array>(() => undefined);
    });
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "preview.png", path: "preview.png", type: "file" as const },
      ]),
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "preview.png" }));
    await waitFor(() => expect(readSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(readSignal?.aborted).toBe(true);
  });

  it("enforces preview limits when a listing omits file size", async () => {
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "large.txt", path: "large.txt", type: "file" as const },
      ]),
      onOpenFileBytes: vi.fn(async () => new Uint8Array((4 * 1024 * 1024) + 1)),
    });

    fireEvent.click(await screen.findByRole("button", { name: "large.txt" }));
    expect(await screen.findByText("Preview is limited to 4 MiB for this file type.")).toBeInTheDocument();
  });

  it("shows compact file-specific copy while loading", async () => {
    renderFilesPanel({
      agentId: "agent-loading-test",
      onListFiles: vi.fn(() => new Promise<never>(() => undefined)),
    });

    const loader = await screen.findByRole("status", { name: /loading files fetching folders and files/i });
    expect(within(loader).getByText("Loading files")).toBeInTheDocument();
    expect(within(loader).getByText("Fetching folders and files.")).toBeInTheDocument();
  });

  it("writes, creates, and deletes without a destination selector", async () => {
    const onListFiles = vi.fn(async () => [
      { name: "notes.txt", path: "notes.txt", type: "file" as const },
    ]);
    const onOpenFile = vi.fn(async () => "before");
    const onSaveFile = vi.fn(async () => undefined);
    const onCreateDirectory = vi.fn(async () => undefined);
    const onDeleteFile = vi.fn(async () => undefined);
    renderFilesPanel({ onListFiles, onOpenFile, onSaveFile, onCreateDirectory, onDeleteFile });

    fireEvent.click(await screen.findByRole("button", { name: "notes.txt" }));
    const editor = await screen.findByRole("textbox", { name: "notes.txt contents" });
    fireEvent.change(editor, { target: { value: "after" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveFile).toHaveBeenCalledWith(".openclaw/workspace/notes.txt", "after"));

    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "reports" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/workspace/reports"));

    const actions = await screen.findByRole("button", {
      name: "File actions for .openclaw/workspace/notes.txt",
    });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(onDeleteFile).toHaveBeenCalledWith(".openclaw/workspace/notes.txt", undefined));
    await waitFor(() => expect(onListFiles.mock.calls.length).toBeGreaterThanOrEqual(4));
  });

  it("uploads without a storage destination selector", async () => {
    const onUploadFile = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onListFiles, onUploadFile });

    await screen.findByText("No files yet");
    fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["hello"], "hello.txt", { type: "text/plain" })] },
    });

    await waitFor(() => {
      expect(onUploadFile).toHaveBeenCalledWith(".openclaw/workspace/hello.txt", expect.any(Uint8Array));
    });
    await waitFor(() => expect(onListFiles.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("rejects nested folder names", async () => {
    const onCreateDirectory = vi.fn(async () => undefined);
    renderFilesPanel({ onCreateDirectory });

    await screen.findByText("No files yet");
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "reports/2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Create one folder at a time.")).toBeInTheDocument();
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });
});
