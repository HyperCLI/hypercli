import type { ComponentProps, ComponentType, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesPanel } from "./AgentFilesPanel";

vi.mock("@hypercli/shared-ui", () => ({
  EmptyState: ({
    icon: Icon,
    title,
    description,
    actionLabel,
    onAction,
    footnote,
  }: {
    icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    footnote?: ReactNode;
  }) => (
    <section>
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {actionLabel && <button onClick={onAction}>{actionLabel}</button>}
      {footnote}
    </section>
  ),
}));

function renderFilesPanel(overrides: Partial<ComponentProps<typeof AgentFilesPanel>> = {}) {
    const props: ComponentProps<typeof AgentFilesPanel> = {
      agentName: "Agent",
      rootPath: ".openclaw/workspace",
      connected: true,
      initialPreviewPath: null,
      onListFiles: vi.fn(async () => []),
    onOpenFile: vi.fn(async () => "content"),
    onSaveFile: vi.fn(async () => undefined),
    onDeleteFile: vi.fn(async () => undefined),
    onUploadFile: vi.fn(async () => undefined),
    ...overrides,
  };

  render(<AgentFilesPanel {...props} />);
  return props;
}

async function expectTooltip(trigger: HTMLElement, content: RegExp) {
  fireEvent.focus(trigger);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(content);
  fireEvent.blur(trigger);
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
}

describe("AgentFilesPanel", () => {
  it("opens absolute OpenClaw workspace preview paths from the workspace root", async () => {
    const onOpenFile = vi.fn(async () => "content");

    renderFilesPanel({
      initialPreviewPath: "/home/node/.openclaw/workspace/report.md",
      onOpenFile,
    });

    await waitFor(() => {
      expect(onOpenFile).toHaveBeenCalledWith("/home/node/.openclaw/workspace/report.md", "agent");
    });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("keeps initial pod paths outside the workspace absolute", async () => {
    const onOpenFileBytes = vi.fn(async () => new TextEncoder().encode("content"));

    renderFilesPanel({
      initialPreviewPath: "/etc/hosts",
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(
        "/etc/hosts",
        "agent",
        { maxBytes: 4 * 1024 * 1024, signal: expect.any(AbortSignal) },
      );
    });
  });

  it("does not reopen an initial Agent preview after switching sources", async () => {
    const onOpenFile = vi.fn(async () => "content");
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({
      initialPreviewPath: "/etc/example.txt",
      onListFiles,
      onOpenFile,
      showSourceTabs: true,
    });

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/etc/example.txt", "agent"));
    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith(undefined, "gateway"));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("does not reopen an initial preview after an automatic source fallback", async () => {
    const onOpenFile = vi.fn(async () => "content");
    const onListFiles = vi.fn(async () => []);
    const props: ComponentProps<typeof AgentFilesPanel> = {
      agentName: "Agent",
      rootPath: ".openclaw/workspace",
      connected: true,
      initialPreviewPath: "/home/node/.openclaw/workspace/report.txt",
      onListFiles,
      onOpenFile,
      showSourceTabs: true,
    };
    const { rerender } = render(<AgentFilesPanel {...props} />);

    await waitFor(() => {
      expect(onOpenFile).toHaveBeenCalledWith(
        "/home/node/.openclaw/workspace/report.txt",
        "agent",
      );
    });
    rerender(
      <AgentFilesPanel
        {...props}
        defaultSource="backup"
        sourceDisabledReasons={{ agent: "Start the agent to browse live files." }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Backup" })).toHaveAttribute("aria-selected", "true");
    });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("opens generated home preview paths through the workspace file path", async () => {
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([255, 216, 255]));

    renderFilesPanel({
      initialPreviewPath: "/home/865621.jpg",
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(
        "/home/node/.openclaw/workspace/865621.jpg",
        "agent",
        { maxBytes: 64 * 1024 * 1024, signal: expect.any(AbortSignal) },
      );
    });
    expect(onOpenFileBytes).toHaveBeenCalledTimes(1);
  });

  it("opens ZIP previews through the byte reader instead of text read", async () => {
    const onOpenFile = vi.fn(async () => "text");
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([80, 75, 5, 6]));

    renderFilesPanel({
      initialPreviewPath: ".openclaw/workspace/archive.zip",
      onOpenFile,
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(
        "/home/node/.openclaw/workspace/archive.zip",
        "agent",
        { maxBytes: 64 * 1024 * 1024, signal: expect.any(AbortSignal) },
      );
    });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens EPUB previews through the byte reader instead of text read", async () => {
    const onOpenFile = vi.fn(async () => "text");
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));

    renderFilesPanel({
      initialPreviewPath: ".openclaw/workspace/book.epub",
      onOpenFile,
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(
        "/home/node/.openclaw/workspace/book.epub",
        "agent",
        { maxBytes: 64 * 1024 * 1024, signal: expect.any(AbortSignal) },
      );
    });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("validates unknown file bytes before exposing a text editor", async () => {
    const onOpenFile = vi.fn(async () => "unsafe fallback");
    const onOpenFileBytes = vi.fn(async () => new TextEncoder().encode("validated custom text"));

    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "notes.custom", path: ".openclaw/workspace/notes.custom", type: "file" as const },
      ]),
      onOpenFile,
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "notes.custom" }));
    await waitFor(() => expect(onOpenFileBytes).toHaveBeenCalled());
    expect(await screen.findByRole("textbox", { name: "notes.custom contents" })).toHaveValue("validated custom text");
    expect(onOpenFileBytes).toHaveBeenCalledWith(
      "/home/node/.openclaw/workspace/notes.custom",
      "agent",
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

  it("does not read known download-only formats just to show an unavailable preview", async () => {
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "proposal.docx", path: ".openclaw/proposal.docx", type: "file" as const },
      ]),
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "proposal.docx" }));
    expect(await screen.findByText("Document preview is not available.")).toBeInTheDocument();
    expect(onOpenFileBytes).not.toHaveBeenCalled();
  });

  it("updates the preview entry when a recovered read returns a renamed path", async () => {
    const onOpenFile = vi.fn(async () => ({
      content: "content",
      path: ".openclaw/workspace/agent-landing-page-demo-architecture.md",
    }));

    renderFilesPanel({
      initialPreviewPath: ".openclaw/workspace/Agent Landing Page — Demo Architecture.md",
      onOpenFile,
    });

    await waitFor(() => {
      expect(screen.getByText("agent-landing-page-demo-architecture.md")).toBeInTheDocument();
    });
  });

  it("renders an empty workspace after the file list resolves", async () => {
    renderFilesPanel({
      onListFiles: vi.fn(async () => []),
    });

    await waitFor(() => {
      expect(screen.getByText("No files yet")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading workspace")).not.toBeInTheDocument();
  });

  it("hides source tabs by default and loads the Agent source from the OpenClaw directory", async () => {
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({ onListFiles });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
    });
    expect(onListFiles).not.toHaveBeenCalledWith(".openclaw", "backup");
    expect(screen.queryByRole("tablist", { name: /file source/i })).not.toBeInTheDocument();
  });

  it("starts the Agent source at the OpenClaw directory and shows hidden entries", async () => {
    const onListFiles = vi.fn(async () => [
      { name: ".config", path: ".openclaw/.config", type: "directory" as const },
    ]);

    renderFilesPanel({ onListFiles, showSourceTabs: true });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
    });
    expect(await screen.findByText(".config")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide dotfiles" })).toBeInTheDocument();
  });

  it("keeps Home at the OpenClaw directory while Root reaches the pod filesystem root", async () => {
    const onListFiles = vi.fn(async (path?: string) => path === "/home/node/.openclaw"
      ? [{ name: "workspace", path: ".openclaw/workspace", type: "directory" as const }]
      : []);

    renderFilesPanel({ onListFiles });

    fireEvent.click(await screen.findByRole("button", { name: "workspace" }));
    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw/workspace", "agent");
    });

    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    await waitFor(() => {
      expect(onListFiles).toHaveBeenLastCalledWith("/", "agent");
    });

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => {
      expect(onListFiles).toHaveBeenLastCalledWith("/home/node/.openclaw", "agent");
    });
  });

  it("navigates up to filesystem root and makes paths above the sync root browse-only", async () => {
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onListFiles, onCreateDirectory: vi.fn(async () => undefined) });

    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("/home/node/.openclaw", "agent"));
    const upButton = screen.getByRole("button", { name: "Up one folder" });

    fireEvent.click(upButton);
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("/home/node", "agent"));
    expect(screen.getByRole("button", { name: "New folder" })).toBeEnabled();

    fireEvent.click(upButton);
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("/home", "agent"));
    expect(screen.getByRole("button", { name: "New folder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload files" })).toBeDisabled();

    fireEvent.click(upButton);
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("/", "agent"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Up one folder" })).toBeDisabled());
  });

  it("stops Backup navigation at the sync root", async () => {
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onListFiles, showSourceTabs: true });

    fireEvent.click(screen.getByRole("tab", { name: "Backup" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith(".openclaw", "backup"));
    const upButton = screen.getByRole("button", { name: "Up one folder" });
    fireEvent.click(upButton);
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("", "backup"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Up one folder" })).toBeDisabled());
  });

  it("preserves absolute directory entry paths when navigating outside Home", async () => {
    const onListFiles = vi.fn(async (path?: string) => path === "/"
      ? [{ name: "etc", path: "/etc/", type: "directory" as const }]
      : []);
    renderFilesPanel({ onListFiles });

    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    fireEvent.click(await screen.findByRole("button", { name: "etc" }));
    await waitFor(() => expect(onListFiles).toHaveBeenLastCalledWith("/etc", "agent"));
  });

  it("keeps breadcrumbs available at the root, during search, and for Gateway files", async () => {
    const onListFiles = vi.fn(async (_path?: string, source?: string) => source === "gateway"
      ? []
      : [{ name: "workspace", path: ".openclaw/workspace", type: "directory" as const }]);
    renderFilesPanel({
      showSourceTabs: true,
      onListFiles,
    });

    expect(await screen.findByRole("button", { name: "workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Root" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search files..."), { target: { value: "missing" } });
    expect(await screen.findByText("No files matching 'missing'")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Root" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith(undefined, "gateway"));
    expect(await screen.findByText("No files yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText("Search files...")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Root" })).toBeInTheDocument();
  });

  it("switches to the Backup source from panel tabs at the OpenClaw directory", async () => {
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({ onListFiles, showSourceTabs: true });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
    });
    onListFiles.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: "Backup" }));

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup");
    });
    expect(screen.getByRole("tab", { name: "Backup" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the Gateway source from panel tabs and disables file mutations", async () => {
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({ onListFiles, showSourceTabs: true, onCreateDirectory: vi.fn(async () => undefined) });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
    });
    onListFiles.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(undefined, "gateway");
    });
    expect(screen.getByRole("button", { name: /new folder/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload files" })).toBeDisabled();
  });

  it("does not request binary files through the text-only Gateway source", async () => {
    const onListFiles = vi.fn(async (_path?: string, source?: string) => source === "gateway"
      ? [{ name: "preview.png", path: "preview.png", type: "file" as const }]
      : []);
    const onOpenFile = vi.fn(async () => "base64");
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));

    renderFilesPanel({ onListFiles, onOpenFile, onOpenFileBytes, showSourceTabs: true });
    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    fireEvent.click(await screen.findByRole("button", { name: "preview.png" }));

    expect(await screen.findByText(/byte access.*not available through Gateway files/i)).toBeInTheDocument();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenFileBytes).not.toHaveBeenCalled();
  });

  it("does not trust unknown files from the text-only Gateway source", async () => {
    const onListFiles = vi.fn(async (_path?: string, source?: string) => source === "gateway"
      ? [{ name: "payload.custom", path: "payload.custom", type: "file" as const }]
      : []);
    const onOpenFile = vi.fn(async () => "decoded binary");

    renderFilesPanel({ onListFiles, onOpenFile, showSourceTabs: true });
    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    fireEvent.click(await screen.findByRole("button", { name: "payload.custom" }));

    expect(await screen.findByText(/byte access.*not available through Gateway files/i)).toBeInTheDocument();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("uses response MIME metadata before decoding preview bytes", async () => {
    const onOpenFileBytes = vi.fn(async () => ({
      content: new TextEncoder().encode("%PDF-1.7"),
      mimeType: "application/pdf",
    }));

    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "upload", path: ".openclaw/upload", type: "file" as const },
      ]),
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "upload" }));
    expect(await screen.findByLabelText("PDF preview for upload")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "upload contents" })).not.toBeInTheDocument();
  });

  it("ignores a stale read after another file is opened", async () => {
    let resolveFirst: ((content: string) => void) | undefined;
    const firstRead = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const onOpenFile = vi.fn((path: string) => path.endsWith("first.txt")
      ? firstRead
      : Promise.resolve("second content"));

    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "first.txt", path: ".openclaw/first.txt", type: "file" as const },
        { name: "second.txt", path: ".openclaw/second.txt", type: "file" as const },
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
    expect(screen.queryByText("first content")).not.toBeInTheDocument();
  });

  it("does not publish a completed save into a different file preview", async () => {
    let resolveSave: (() => void) | undefined;
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSaveFile = vi.fn(() => savePending);
    const onOpenFile = vi.fn(async (path: string) => path.endsWith("first.txt") ? "first content" : "second content");

    renderFilesPanel({
      isDesktopViewport: true,
      onListFiles: vi.fn(async () => [
        { name: "first.txt", path: ".openclaw/first.txt", type: "file" as const },
        { name: "second.txt", path: ".openclaw/second.txt", type: "file" as const },
      ]),
      onOpenFile,
      onOpenFileBytes: undefined,
      onSaveFile,
    });

    fireEvent.click(await screen.findByRole("button", { name: "first.txt" }));
    const firstEditor = await screen.findByRole("textbox", { name: "first.txt contents" });
    fireEvent.change(firstEditor, { target: { value: "saved first content" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(firstEditor).toHaveAttribute("readonly");

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
    const onOpenFileBytes = vi.fn((_path: string, _source?: string, options?: { signal: AbortSignal }) => {
      readSignal = options?.signal;
      return new Promise<Uint8Array>(() => undefined);
    });

    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "preview.png", path: ".openclaw/preview.png", type: "file" as const },
      ]),
      onOpenFileBytes,
    });

    fireEvent.click(await screen.findByRole("button", { name: "preview.png" }));
    await waitFor(() => expect(readSignal).toBeDefined());
    expect(readSignal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(readSignal?.aborted).toBe(true);
  });

  it("enforces preview limits when a listing does not report file size", async () => {
    renderFilesPanel({
      onListFiles: vi.fn(async () => [
        { name: "large.txt", path: ".openclaw/large.txt", type: "file" as const },
      ]),
      onOpenFileBytes: vi.fn(async () => new Uint8Array((4 * 1024 * 1024) + 1)),
    });

    fireEvent.click(await screen.findByRole("button", { name: "large.txt" }));
    expect(await screen.findByText("Preview is limited to 4 MiB for this file type.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "large.txt contents" })).not.toBeInTheDocument();
  });

  it("defaults to Backup and disables Agent when the live source is unavailable", async () => {
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({
      defaultSource: "backup",
      showSourceTabs: true,
      sourceDisabledReasons: { agent: "Start the agent to browse live files." },
      onListFiles,
    });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup");
    });
    const agentTab = screen.getByRole("tab", { name: "Agent" });
    expect(agentTab).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Backup" })).toHaveAttribute("aria-selected", "true");

    onListFiles.mockClear();
    fireEvent.click(agentTab);
    expect(onListFiles).not.toHaveBeenCalled();
  });

  it("shows latest backup status as per-file tooltips", async () => {
    const onListFiles = vi.fn(async (_path?: string, source?: string) => {
      if (source === "backup") {
        return [
          { name: "synced.md", path: ".openclaw/synced.md", type: "file" as const, sha256: "same", size: 4, lastModified: "2026-07-07T10:00:00Z" },
          { name: "changed.md", path: ".openclaw/changed.md", type: "file" as const, sha256: "old", size: 4, lastModified: "2026-07-07T09:00:00Z" },
          { name: "unverified.md", path: ".openclaw/unverified.md", type: "file" as const, size: 4, lastModified: "2026-07-07T13:00:00Z" },
          { name: "stale.md", path: ".openclaw/stale.md", type: "file" as const, size: 4, lastModified: "2026-07-07T09:00:00Z" },
        ];
      }
      return [
        { name: "synced.md", path: ".openclaw/synced.md", type: "file" as const, sha256: "same", size: 4, lastModified: "2026-07-07T10:00:00Z" },
        { name: "changed.md", path: ".openclaw/changed.md", type: "file" as const, sha256: "new", size: 4, lastModified: "2026-07-07T11:00:00Z" },
        { name: "unverified.md", path: ".openclaw/unverified.md", type: "file" as const, size: 4, lastModified: "2026-07-07T13:00:00Z" },
        { name: "stale.md", path: ".openclaw/stale.md", type: "file" as const, size: 4, lastModified: "2026-07-07T14:00:00Z" },
        { name: "draft.md", path: ".openclaw/draft.md", type: "file" as const, sha256: "draft", size: 5, lastModified: "2026-07-07T12:00:00Z" },
      ];
    });

    renderFilesPanel({ onListFiles, showSourceTabs: true });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup");
    });
    expect(screen.queryByText("Backup needs attention")).not.toBeInTheDocument();
    const backedUp = screen.getAllByRole("img", { name: "Backed up" });
    await expectTooltip(backedUp[0], /Backup copy modified: 2026-07-07T10:00:00Z[\s\S]*Hashes match/);
    await expectTooltip(screen.getByRole("img", { name: "Changed since backup" }), /Backup copy modified: 2026-07-07T09:00:00Z[\s\S]*Hashes differ/);
    await expectTooltip(backedUp[1], /Backup copy modified: 2026-07-07T13:00:00Z[\s\S]*Hash verification unavailable/);
    await expectTooltip(screen.getByRole("img", { name: "Backup may be stale" }), /Backup copy modified: 2026-07-07T09:00:00Z[\s\S]*Live file modified: 2026-07-07T14:00:00Z[\s\S]*Hash verification unavailable/);
    await expectTooltip(screen.getByRole("img", { name: "Not backed up" }), /Live file modified: 2026-07-07T12:00:00Z/);
  });

  it("shows backup-copy tooltips when live files are unavailable", async () => {
    const onListFiles = vi.fn(async () => [
      { name: "archived.md", path: ".openclaw/archived.md", type: "file" as const, size: 12, lastModified: "2026-07-07T08:00:00Z" },
    ]);

    renderFilesPanel({
      defaultSource: "backup",
      showSourceTabs: true,
      sourceDisabledReasons: { agent: "Start the agent to browse live files." },
      onListFiles,
    });

    expect(await screen.findByText("archived.md")).toBeInTheDocument();
    expect(screen.queryByText("Backup comparison paused")).not.toBeInTheDocument();
    await expectTooltip(screen.getByRole("img", { name: "Backed up" }), /Backup copy modified: 2026-07-07T08:00:00Z[\s\S]*Start the agent to compare/);
    expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup");
    expect(onListFiles).not.toHaveBeenCalledWith("/home/node/.openclaw", "agent");
  });

  it("uses compact file-specific copy while loading the file list", () => {
    renderFilesPanel({
      onListFiles: vi.fn(() => new Promise(() => undefined)),
    });

    const loader = screen.getByRole("status", { name: /loading files fetching folders and files/i });
    expect(loader).toBeInTheDocument();
    expect(within(loader).getByText("Loading files")).toBeInTheDocument();
    expect(within(loader).getByText("Fetching folders and files.")).toBeInTheDocument();
    expect(screen.queryByText("Loading workspace")).not.toBeInTheDocument();
  });

  it("shows cached files immediately when the panel remounts", async () => {
    const cachedEntry = {
      name: "README.md",
      path: ".openclaw/workspace/README.md",
      type: "file" as const,
      size: 12,
    };
    const firstListFiles = vi.fn(async () => [cachedEntry]);
    const baseProps: ComponentProps<typeof AgentFilesPanel> = {
      agentId: "agent-cache-test",
      agentName: "Agent",
      rootPath: ".openclaw/workspace",
      connected: true,
      initialPreviewPath: null,
      onListFiles: firstListFiles,
      onOpenFile: vi.fn(async () => "content"),
      onSaveFile: vi.fn(async () => undefined),
      onDeleteFile: vi.fn(async () => undefined),
      onUploadFile: vi.fn(async () => undefined),
    };

    const { unmount } = render(<AgentFilesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    unmount();

    const secondListFiles = vi.fn(() => new Promise<(typeof cachedEntry)[]>(() => undefined));
    render(<AgentFilesPanel {...baseProps} onListFiles={secondListFiles} />);

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("Loading workspace")).not.toBeInTheDocument();
    await waitFor(() => expect(secondListFiles).toHaveBeenCalled());
  });

  it("creates a folder in the current directory", async () => {
    const onCreateDirectory = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onCreateDirectory, onListFiles });

    await waitFor(() => expect(onListFiles).toHaveBeenCalled());
    onListFiles.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.change(screen.getByLabelText(/folder name/i), { target: { value: "reports" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/reports", "agent");
    });
    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent");
    });
    expect(onListFiles).not.toHaveBeenCalledWith(".openclaw", "backup");
  });

  it("creates a folder in the selected Backup source", async () => {
    const onCreateDirectory = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onCreateDirectory, onListFiles, showSourceTabs: true });

    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent"));
    fireEvent.click(screen.getByRole("tab", { name: "Backup" }));
    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup"));
    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.change(screen.getByLabelText(/folder name/i), { target: { value: "archives" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/archives", "backup");
    });
  });

  it("uploads folder contents to the selected Backup source", async () => {
    const onUploadFile = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onUploadFile, onListFiles, showSourceTabs: true });

    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith("/home/node/.openclaw", "agent"));
    fireEvent.click(screen.getByRole("tab", { name: "Backup" }));
    await waitFor(() => expect(onListFiles).toHaveBeenCalledWith(".openclaw", "backup"));
    fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["archive"], "archive.txt", { type: "text/plain" })] },
    });

    await waitFor(() => {
      expect(onUploadFile).toHaveBeenCalledWith(
        ".openclaw/archive.txt",
        expect.any(Uint8Array),
        "backup",
      );
    });
  });

  it("deletes from the selected Backup source", async () => {
    const onDeleteFile = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async (_path?: string, source?: string) => source === "backup"
      ? [{ name: "archive.txt", path: ".openclaw/archive.txt", type: "file" as const }]
      : []);
    renderFilesPanel({ onDeleteFile, onListFiles, showSourceTabs: true });

    fireEvent.click(screen.getByRole("tab", { name: "Backup" }));
    const actions = await screen.findByRole("button", {
      name: "File actions for /home/node/.openclaw/archive.txt",
    });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleteFile).toHaveBeenCalledWith(".openclaw/archive.txt", undefined, "backup");
    });
  });

  it("rejects nested folder names", async () => {
    const onCreateDirectory = vi.fn(async () => undefined);
    const onListFiles = vi.fn(async () => []);
    renderFilesPanel({ onCreateDirectory, onListFiles });

    await waitFor(() => expect(onListFiles).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.change(screen.getByLabelText(/folder name/i), { target: { value: "reports/2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(screen.getByText("Create one folder at a time.")).toBeInTheDocument();
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });
});
