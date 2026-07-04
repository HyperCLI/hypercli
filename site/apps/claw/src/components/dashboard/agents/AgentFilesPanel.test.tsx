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
      expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/workspace/reports");
    });
    await waitFor(() => {
      expect(onListFiles).toHaveBeenCalledTimes(1);
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
