import type { ComponentProps, ComponentType, ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      expect(onOpenFile).toHaveBeenCalledWith(".openclaw/workspace/report.md", "agent");
    });
  });

  it("opens generated home preview paths through the workspace file path", async () => {
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([255, 216, 255]));

    renderFilesPanel({
      initialPreviewPath: "/home/865621.jpg",
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg", "agent");
    });
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
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/archive.zip", "agent");
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
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/book.epub", "agent");
    });
    expect(onOpenFile).not.toHaveBeenCalled();
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
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
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
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
    });
    expect(await screen.findByText(".config")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide dotfiles" })).toBeInTheDocument();
  });

  it("switches to the Backup source from panel tabs at the OpenClaw directory", async () => {
    const onListFiles = vi.fn(async () => []);

    renderFilesPanel({ onListFiles, showSourceTabs: true });

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
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
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
    });
    onListFiles.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: "Gateway" }));

    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(undefined, "gateway");
    });
    expect(screen.getByRole("button", { name: /new folder/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload files" })).toBeDisabled();
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
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
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
    expect(onListFiles).not.toHaveBeenCalledWith(".openclaw", "agent");
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
      expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/reports");
    });
    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledWith(".openclaw", "agent");
    });
    expect(onListFiles).not.toHaveBeenCalledWith(".openclaw", "backup");
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
