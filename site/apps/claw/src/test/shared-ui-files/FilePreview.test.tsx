import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByText("Contents only. Files inside are not opened or extracted.")).toBeInTheDocument();
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

  it("previews ZIP-compatible packages but keeps Office containers download-only", () => {
    const content = createZip([{ name: "META-INF/MANIFEST.MF", content: "Manifest-Version: 1.0" }]);
    const { rerender } = render(
      <FilePreview
        entry={{ name: "library.jar", path: ".openclaw/workspace/library.jar", type: "file", size: content.byteLength }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("META-INF/MANIFEST.MF")).toBeInTheDocument();

    rerender(
      <FilePreview
        entry={{ name: "proposal.docx", path: ".openclaw/workspace/proposal.docx", type: "file", size: content.byteLength }}
        content={content}
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Document preview is not available.")).toBeInTheDocument();
    expect(screen.queryByText("META-INF/MANIFEST.MF")).not.toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Try opening this archive another way" })).toBeInTheDocument();
    expect(screen.queryByText(/does not look like a ZIP archive/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText(/does not look like a ZIP archive/i)).toBeInTheDocument();
  });

  it("keeps preview errors action-led and redacts closed technical details", () => {
    const onRetry = vi.fn();
    render(
      <FilePreview
        entry={{ name: "notes.txt", path: "notes.txt", type: "file" }}
        content={null}
        loading={false}
        error="Authorization: Bearer preview-secret-token"
        onRetry={onRetry}
        onClose={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Try again to preview this file");
    expect(alert).toHaveTextContent("The file is still available");
    expect(alert).toHaveTextContent("Try the preview once more");
    expect(screen.queryByText(/preview-secret-token/i)).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Technical details" }));
    expect(alert).toHaveTextContent("Authorization: [redacted]");
    expect(alert).not.toHaveTextContent("preview-secret-token");

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
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

  it("renders HTML in a no-script sandbox and toggles to editable source", () => {
    const content = [
      "<!doctype html>",
      '<meta http-equiv="refresh" content="0;url=https://tracker.example.test">',
      "<style>body { color: rgb(12 34 56); }</style>",
      "<h1>Sandboxed document</h1>",
      '<img src="https://tracker.example.test/pixel.png" alt="Tracking pixel">',
      '<form action="https://tracker.example.test/submit"><button>Submit</button></form>',
      '<script>parent.__htmlPreviewScriptRan = true</script>',
    ].join("\n");

    render(
      <FilePreview
        entry={{ name: "demo.html", path: ".openclaw/workspace/demo.html", type: "file", size: content.length }}
        content={content}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    const iframe = screen.getByTitle("Sandboxed HTML preview for demo.html");
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe.getAttribute("allow")).toContain("camera 'none'");
    expect(screen.getByRole("status", { name: "HTML preview security" })).toHaveTextContent(/scripts and form submissions are disabled/i);

    const srcDoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).toContain("script-src 'none'");
    expect(srcDoc).toContain("form-action 'none'");
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).not.toMatch(/http-equiv=["']refresh/i);
    expect(srcDoc).toContain("<h1>Sandboxed document</h1>");

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    const editor = screen.getByRole("textbox", { name: "demo.html contents" });
    expect(editor).toHaveValue(content);
    expect(screen.queryByTitle("Sandboxed HTML preview for demo.html")).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "<h1>Updated preview</h1>" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTitle("Sandboxed HTML preview for demo.html").getAttribute("srcdoc")).toContain("<h1>Updated preview</h1>");
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

  it("renders browser-native audio, video, and PDF previews from file bytes", () => {
    const common = {
      loading: false,
      error: null,
      onClose: vi.fn(),
    };
    const { container, rerender } = render(
      <FilePreview
        {...common}
        entry={{ name: "voice.mp3", path: "voice.mp3", type: "file", mimeType: "audio/mpeg" }}
        content={new Uint8Array([1, 2, 3])}
      />,
    );

    expect(screen.getByLabelText("Audio preview for voice.mp3")).toBeInTheDocument();
    expect(container.querySelector("audio")).toHaveAttribute("src", expect.stringMatching(/^blob:/));

    rerender(
      <FilePreview
        {...common}
        entry={{ name: "clip.webm", path: "clip.webm", type: "file", mimeType: "video/webm" }}
        content={new Uint8Array([4, 5, 6])}
      />,
    );
    expect(screen.getByLabelText("Video preview for clip.webm")).toBeInTheDocument();

    rerender(
      <FilePreview
        {...common}
        entry={{ name: "report.pdf", path: "report.pdf", type: "file", mimeType: "application/pdf" }}
        content={new Uint8Array([37, 80, 68, 70])}
      />,
    );
    expect(screen.getByLabelText("PDF preview for report.pdf")).toHaveAttribute("type", "application/pdf");
  });

  it("creates native preview URLs after commit and revokes them when replaced", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:voice")
      .mockReturnValueOnce("blob:clip");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const voiceBytes = new Uint8Array([1, 2, 3]);
    const clipBytes = new Uint8Array([4, 5, 6]);

    const { rerender, unmount } = render(
      <FilePreview
        entry={{ name: "voice.mp3", path: "voice.mp3", type: "file", mimeType: "audio/mpeg" }}
        content={voiceBytes}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe("audio/mpeg");
    expect(screen.getByLabelText("Audio preview for voice.mp3")).toHaveAttribute("src", "blob:voice");

    rerender(
      <FilePreview
        entry={{ name: "clip.webm", path: "clip.webm", type: "file", mimeType: "video/webm" }}
        content={clipBytes}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:voice");
    expect(screen.getByLabelText("Video preview for clip.webm")).toHaveAttribute("src", "blob:clip");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("does not create an active preview for conflicting filename and MIME metadata", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    render(
      <FilePreview
        entry={{ name: "report.pdf", path: "report.pdf", type: "file", mimeType: "image/svg+xml" }}
        content={new TextEncoder().encode("<svg><script>throw 1</script></svg>")}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("File preview is not available.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "report.pdf" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PDF preview for report.pdf")).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    createObjectURL.mockRestore();
  });

  it("does not render Markdown when text metadata selects a different renderer", () => {
    render(
      <FilePreview
        entry={{ name: "README.md", path: "README.md", type: "file", mimeType: "application/javascript" }}
        content="# Unsafe renderer conflict"
        loading={false}
        error={null}
        renderMarkdown={renderMarkdown}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("File preview is not available.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unsafe renderer conflict" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("edits validated unknown text but keeps unknown binary content download-only", () => {
    const common = {
      loading: false,
      error: null,
      onClose: vi.fn(),
      onSave: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <FilePreview
        {...common}
        entry={{ name: "notes.custom", path: "notes.custom", type: "file" }}
        content="validated UTF-8"
      />,
    );

    expect(screen.getByRole("textbox", { name: "notes.custom contents" })).toHaveValue("validated UTF-8");

    rerender(
      <FilePreview
        {...common}
        entry={{ name: "payload.custom", path: "payload.custom", type: "file" }}
        content={new Uint8Array([0, 1, 2])}
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("File preview is not available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("copies an intentionally cleared editor as empty text", async () => {
    const copyText = vi.fn(async () => true);
    render(
      <FilePreview
        entry={{ name: "notes.txt", path: "notes.txt", type: "file" }}
        content="original"
        loading={false}
        error={null}
        onClose={vi.fn()}
        copyText={copyText}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "notes.txt contents" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(""));
  });

  it("keeps save failures visible without dropping the edit", async () => {
    render(
      <FilePreview
        entry={{ name: "notes.txt", path: "notes.txt", type: "file" }}
        content="original"
        loading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn(async () => { throw new Error("Write was rejected"); })}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "notes.txt contents" });
    fireEvent.change(editor, { target: { value: "updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try saving again");
    expect(alert).toHaveTextContent("Your edits are still here");
    expect(screen.queryByText("Write was rejected")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Technical details" }));
    expect(alert).toHaveTextContent("Write was rejected");
    expect(editor).toHaveValue("updated");
  });

  it("renders unsupported raw HTML as inert source in markdown preview", () => {
    const { container } = render(
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
    expect(container).toHaveTextContent("<section><h2>HTML preview</h2><p>Rendered from HTML.</p></section>");
    expect(container.querySelector("section")).not.toBeInTheDocument();
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
