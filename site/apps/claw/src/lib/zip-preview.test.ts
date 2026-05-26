import { describe, expect, it } from "vitest";

import { parseZipPreview } from "./zip-preview";

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
    const isDirectory = entry.name.endsWith("/");

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
    pushUint32(central, isDirectory ? 0x10 : 0);
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

describe("parseZipPreview", () => {
  it("lists ZIP central directory entries without extracting content", () => {
    const preview = parseZipPreview(createZip([
      { name: "src/" },
      { name: "src/index.ts", content: "console.log('hello');" },
      { name: "README.md", content: "# Project" },
    ]));

    expect(preview.totalEntries).toBe(3);
    expect(preview.fileCount).toBe(2);
    expect(preview.directoryCount).toBe(1);
    expect(preview.entries.map((entry) => entry.name)).toEqual(["src/", "src/index.ts", "README.md"]);
    expect(preview.entries[1]).toEqual(expect.objectContaining({
      directory: false,
      uncompressedSize: "console.log('hello');".length,
    }));
  });

  it("truncates long entry lists", () => {
    const preview = parseZipPreview(createZip([
      { name: "one.txt" },
      { name: "two.txt" },
      { name: "three.txt" },
    ]), 2);

    expect(preview.totalEntries).toBe(3);
    expect(preview.entries).toHaveLength(2);
    expect(preview.truncated).toBe(true);
  });

  it("marks unsafe paths", () => {
    const preview = parseZipPreview(createZip([{ name: "../escape.txt" }]));

    expect(preview.entries[0]?.unsafePath).toBe(true);
  });

  it("rejects non-ZIP bytes", () => {
    expect(() => parseZipPreview(new Uint8Array([1, 2, 3]))).toThrow(/ZIP archive/i);
  });
});
