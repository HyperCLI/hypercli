import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { FilePreview } from "./FilePreview";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: ComponentProps<"div"> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

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
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/does not look like a ZIP archive/i)).toBeInTheDocument();
  });
});
