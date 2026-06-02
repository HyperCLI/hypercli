import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesPanel } from "./AgentFilesPanel";

function renderFilesPanel(overrides: Partial<ComponentProps<typeof AgentFilesPanel>> = {}) {
  const props: ComponentProps<typeof AgentFilesPanel> = {
    agentName: "Agent",
    agentState: "RUNNING",
    rootPath: ".openclaw/workspace",
    connected: true,
    connecting: false,
    hydrating: false,
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
      expect(onOpenFile).toHaveBeenCalledWith(".openclaw/workspace/report.md");
    });
  });

  it("opens generated home preview paths through the workspace file path", async () => {
    const onOpenFileBytes = vi.fn(async () => new Uint8Array([255, 216, 255]));

    renderFilesPanel({
      initialPreviewPath: "/home/865621.jpg",
      onOpenFileBytes,
    });

    await waitFor(() => {
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
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
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/archive.zip");
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
      expect(onOpenFileBytes).toHaveBeenCalledWith(".openclaw/workspace/book.epub");
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
