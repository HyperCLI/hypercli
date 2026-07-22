import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { FilePreview } from "@hypercli/shared-ui/files";
import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, chart: string) => ({
    svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: ComponentProps<"div"> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

function renderMarkdown(content: string, className?: string) {
  return <MarkdownContent content={content} className={className} />;
}

function pushUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff);
}

function pushUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function createZip(entries: Array<{ name: string; content?: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const nameBytes = Array.from(encoder.encode(entry.name));
    const contentBytes = Array.from(encoder.encode(entry.content ?? ""));
    const localHeaderOffset = local.length;

    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, 0x0800);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint32(local, 0);
    pushUint32(local, contentBytes.length);
    pushUint32(local, contentBytes.length);
    pushUint16(local, nameBytes.length);
    pushUint16(local, 0);
    local.push(...nameBytes, ...contentBytes);

    pushUint32(central, 0x02014b50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0x0800);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, contentBytes.length);
    pushUint32(central, contentBytes.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, entry.name.endsWith("/") ? 0x10 : 0);
    pushUint32(central, localHeaderOffset);
    central.push(...nameBytes);
  }

  const end: number[] = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, entries.length);
  pushUint16(end, entries.length);
  pushUint32(end, central.length);
  pushUint32(end, local.length);
  pushUint16(end, 0);

  return new Uint8Array([...local, ...central, ...end]);
}

describe("FilePreview", () => {
  it("lists ZIP file names without extracting the archive", () => {
    render(
      <FilePreview
        entry={{ name: "bundle.zip", path: ".openclaw/workspace/bundle.zip", type: "file", size: 128 }}
        content={createZip([
          { name: "src/" },
          { name: "src/index.ts", content: "console.log('hello');" },
          { name: "assets/logo.png", content: "png" },
        ])}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("1 folders")).toBeInTheDocument();
    expect(screen.getByText("src/")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("assets/logo.png")).toBeInTheDocument();
  });

  it("previews EPUB files as ZIP-based archives", () => {
    render(
      <FilePreview
        entry={{ name: "guide.epub", path: ".openclaw/workspace/guide.epub", type: "file", size: 128 }}
        content={createZip([
          { name: "mimetype", content: "application/epub+zip" },
          { name: "META-INF/container.xml", content: "<container />" },
        ])}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("mimetype")).toBeInTheDocument();
    expect(screen.getByText("META-INF/container.xml")).toBeInTheDocument();
  });

  it("shows an archive preview error for invalid ZIP bytes", () => {
    render(
      <FilePreview
        entry={{ name: "broken.zip", path: ".openclaw/workspace/broken.zip", type: "file", size: 3 }}
        content={new Uint8Array([1, 2, 3])}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/does not look like a ZIP archive/i)).toBeInTheDocument();
  });

  it("renders markdown preview and toggles to raw source", () => {
    const content = "# Release notes\n\n- Shipped markdown preview";

    render(
      <FilePreview
        entry={{ name: "README.md", path: ".openclaw/workspace/README.md", type: "file", size: content.length }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Release notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(screen.getByRole("textbox")).toHaveValue(content);
    expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not show the markdown view switch for non-markdown files", () => {
    render(
      <FilePreview
        entry={{ name: "notes.txt", path: ".openclaw/workspace/notes.txt", type: "file", size: 12 }}
        content="# Notes"
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raw" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("# Notes");
  });

  it("renders ICS calendar files as editable text previews", () => {
    const content = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example Test Fixture//Calendar Preview//EN",
      "BEGIN:VEVENT",
      "UID:test-fixture-001@example.test",
      "SUMMARY:Placeholder review block",
      "DTSTART:20260101T090000Z",
      "DTEND:20260101T093000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    render(
      <FilePreview
        entry={{ name: "placeholder-calendar.ics", path: ".openclaw/workspace/placeholder-calendar.ics", type: "file", size: content.length }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(/preview is not available yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "placeholder-calendar.ics contents" })).toHaveValue(content);
  });

  it("does not render raw HTML in markdown preview", () => {
    render(
      <FilePreview
        entry={{ name: "README.md", path: ".openclaw/workspace/README.md", type: "file", size: 128 }}
        content={'<section><h2>HTML preview</h2><p>Rendered from HTML.</p></section>\n\n**Markdown survives**\n\n<script>alert("x")</script>'}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { name: "HTML preview" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Rendered from HTML/i)).not.toBeInTheDocument();
    expect(screen.getByText("Markdown survives")).toHaveClass("font-semibold");
    expect(screen.queryByText(/alert\("x"\)/i)).not.toBeInTheDocument();
  });

  it("renders markdown block math in preview mode", () => {
    const content = [
      "# Formula",
      "",
      "$$",
      "E = mc^2",
      "$$",
    ].join("\n");

    const { container } = render(
      <FilePreview
        entry={{ name: "README.md", path: ".openclaw/workspace/README.md", type: "file", size: content.length }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Formula" })).toBeInTheDocument();
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector(".katex-display .katex")).toBeInTheDocument();
  });

  it("renders Mermaid diagram fences in markdown preview mode", async () => {
    mermaidMock.render.mockClear();
    const content = [
      "# Diagram",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Start] --> B[Done]",
      "```",
    ].join("\n");

    render(
      <FilePreview
        entry={{ name: "README.md", path: ".openclaw/workspace/README.md", type: "file", size: content.length }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Diagram" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /rendering diagram/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledWith(
        expect.stringMatching(/^markdown-mermaid-/),
        "flowchart TD\n  A[Start] --> B[Done]",
      );
    });
    expect(screen.getByRole("img", { name: /mermaid diagram/i })).toBeInTheDocument();
    expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
  });
});
