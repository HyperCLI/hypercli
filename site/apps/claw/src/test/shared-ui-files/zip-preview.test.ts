import { describe, expect, it } from "vitest";

import { parseZipPreview } from "@hypercli/shared-ui/files";

function pushUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff);
}

function pushUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

interface ZipFixtureEntry {
  name: string;
  rawNameBytes?: number[];
  content?: string;
  flags?: number;
  localExtra?: number[];
  centralExtra?: number[];
  versionMadeBy?: number;
  externalAttributes?: number;
}

function createZip(entries: ZipFixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const nameBytes = entry.rawNameBytes ?? Array.from(encoder.encode(entry.name));
    const contentBytes = Array.from(encoder.encode(entry.content ?? ""));
    const flags = entry.flags ?? 0x0800;
    const localExtra = entry.localExtra ?? [];
    const centralExtra = entry.centralExtra ?? localExtra;
    const localHeaderOffset = local.length;
    const isDirectory = nameBytes[nameBytes.length - 1] === 0x2f;

    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, flags);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint32(local, 0);
    pushUint32(local, contentBytes.length);
    pushUint32(local, contentBytes.length);
    pushUint16(local, nameBytes.length);
    pushUint16(local, localExtra.length);
    local.push(...nameBytes, ...localExtra, ...contentBytes);

    pushUint32(central, 0x02014b50);
    pushUint16(central, entry.versionMadeBy ?? 20);
    pushUint16(central, 20);
    pushUint16(central, flags);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, contentBytes.length);
    pushUint32(central, contentBytes.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, centralExtra.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, entry.externalAttributes ?? (isDirectory ? 0x10 : 0));
    pushUint32(central, localHeaderOffset);
    central.push(...nameBytes, ...centralExtra);
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

function zipView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function endOfCentralDirectoryOffset(bytes: Uint8Array): number {
  return bytes.byteLength - 22;
}

function centralDirectoryOffset(bytes: Uint8Array): number {
  return zipView(bytes).getUint32(endOfCentralDirectoryOffset(bytes) + 16, true);
}

function fixtureCrc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function unicodePathExtra(rawName: string, unicodeName: string): number[] {
  const encoder = new TextEncoder();
  const rawNameBytes = encoder.encode(rawName);
  const unicodeNameBytes = Array.from(encoder.encode(unicodeName));
  const extra: number[] = [];
  pushUint16(extra, 0x7075);
  pushUint16(extra, 5 + unicodeNameBytes.length);
  extra.push(1);
  pushUint32(extra, fixtureCrc32(rawNameBytes));
  extra.push(...unicodeNameBytes);
  return extra;
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

  it("decodes legacy unflagged names as CP437", () => {
    const preview = parseZipPreview(createZip([{
      name: "legacy.txt",
      rawNameBytes: [0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74],
      flags: 0,
    }]));

    expect(preview.entries[0]?.name).toBe("caf\u00e9.txt");
  });

  it("supports empty archives and validates maxEntries", () => {
    expect(parseZipPreview(createZip([]))).toEqual({
      entries: [],
      totalEntries: 0,
      fileCount: 0,
      directoryCount: 0,
      truncated: false,
    });
    expect(parseZipPreview(createZip([{ name: "one.txt" }]), 0)).toMatchObject({ entries: [], truncated: true });
    for (const maxEntries of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseZipPreview(createZip([]), maxEntries)).toThrow(/maxEntries/i);
    }
  });

  it("marks unsafe paths", () => {
    const unicodePath = unicodePathExtra("safe.txt", "../unicode-escape.txt");
    const preview = parseZipPreview(createZip([
      { name: "../escape.txt" },
      { name: "safe/\u202ecod.exe" },
      { name: "safe.txt", localExtra: unicodePath, centralExtra: unicodePath },
      { name: "link", versionMadeBy: (3 << 8) | 20, externalAttributes: 0xa0000000 },
    ]));

    expect(preview.entries[0]?.unsafePath).toBe(true);
    expect(preview.entries[1]?.unsafePath).toBe(true);
    expect(preview.entries[2]).toMatchObject({ name: "../unicode-escape.txt", unsafePath: true });
    expect(preview.entries[3]?.unsafePath).toBe(true);
  });

  it("rejects central-directory count and length mismatches", () => {
    const tooMany = createZip([{ name: "one.txt" }]);
    const tooManyView = zipView(tooMany);
    const tooManyEocd = endOfCentralDirectoryOffset(tooMany);
    tooManyView.setUint16(tooManyEocd + 8, 2, true);
    tooManyView.setUint16(tooManyEocd + 10, 2, true);
    expect(() => parseZipPreview(tooMany)).toThrow(/central directory/i);

    const tooFew = createZip([{ name: "one.txt" }, { name: "two.txt" }]);
    const tooFewView = zipView(tooFew);
    const tooFewEocd = endOfCentralDirectoryOffset(tooFew);
    tooFewView.setUint16(tooFewEocd + 8, 1, true);
    tooFewView.setUint16(tooFewEocd + 10, 1, true);
    expect(() => parseZipPreview(tooFew)).toThrow(/central directory size/i);
  });

  it("rejects entry field overruns and invalid local offsets", () => {
    const overrun = createZip([{ name: "one.txt" }]);
    zipView(overrun).setUint16(centralDirectoryOffset(overrun) + 30, 1, true);
    expect(() => parseZipPreview(overrun)).toThrow(/file name/i);

    const invalidLocalOffset = createZip([{ name: "one.txt" }]);
    const centralOffset = centralDirectoryOffset(invalidLocalOffset);
    zipView(invalidLocalOffset).setUint32(centralOffset + 42, centralOffset, true);
    expect(() => parseZipPreview(invalidLocalOffset)).toThrow(/local file header/i);

    const mismatchedName = createZip([{ name: "one.txt" }]);
    mismatchedName[30] = "x".charCodeAt(0);
    expect(() => parseZipPreview(mismatchedName)).toThrow(/file names do not match/i);

    const payloadOverrun = createZip([{ name: "one.txt", content: "x" }]);
    const payloadOverrunView = zipView(payloadOverrun);
    const payloadOverrunCentralOffset = centralDirectoryOffset(payloadOverrun);
    payloadOverrunView.setUint32(18, payloadOverrunCentralOffset, true);
    payloadOverrunView.setUint32(payloadOverrunCentralOffset + 20, payloadOverrunCentralOffset, true);
    expect(() => parseZipPreview(payloadOverrun)).toThrow(/local file header/i);
  });

  it("rejects per-entry ZIP64 markers and malformed entries beyond the display limit", () => {
    const zip64 = createZip([{ name: "one.txt" }]);
    zipView(zip64).setUint32(centralDirectoryOffset(zip64) + 20, 0xffffffff, true);
    expect(() => parseZipPreview(zip64)).toThrow(/ZIP64/i);

    const malformed = createZip([{ name: "one.txt" }, { name: "two.txt" }]);
    const secondEntryOffset = centralDirectoryOffset(malformed) + 46 + "one.txt".length;
    zipView(malformed).setUint32(secondEntryOffset, 0, true);
    expect(() => parseZipPreview(malformed, 1)).toThrow(/central directory entry/i);
  });

  it("rejects invalid flagged UTF-8 names without reading file payloads", () => {
    const invalidName = createZip([{ name: "one.txt", content: "payload" }]);
    const centralOffset = centralDirectoryOffset(invalidName);
    invalidName[centralOffset + 46] = 0xff;
    expect(() => parseZipPreview(invalidName)).toThrow(/UTF-8 ZIP file name/i);

    const hiddenInvalidName = createZip([{ name: "one.txt" }]);
    const hiddenCentralOffset = centralDirectoryOffset(hiddenInvalidName);
    hiddenInvalidName[30] = 0xff;
    hiddenInvalidName[hiddenCentralOffset + 46] = 0xff;
    expect(() => parseZipPreview(hiddenInvalidName, 0)).toThrow(/UTF-8 ZIP file name/i);

    const hugeMetadata = createZip([{ name: "nested/bomb.zip", content: "not opened" }]);
    const hugeMetadataView = zipView(hugeMetadata);
    const hugeMetadataCentralOffset = centralDirectoryOffset(hugeMetadata);
    hugeMetadataView.setUint16(8, 8, true);
    hugeMetadataView.setUint32(22, 0xfffffffe, true);
    hugeMetadataView.setUint16(hugeMetadataCentralOffset + 10, 8, true);
    hugeMetadataView.setUint32(hugeMetadataCentralOffset + 24, 0xfffffffe, true);
    expect(parseZipPreview(hugeMetadata).entries[0]).toMatchObject({
      name: "nested/bomb.zip",
      uncompressedSize: 0xfffffffe,
    });
  });

  it("rejects malformed and conflicting Unicode path extra fields", () => {
    const malformedExtra = [0x75, 0x70, 0x05, 0x00, 0x01];
    expect(() => parseZipPreview(createZip([{
      name: "safe.txt",
      localExtra: malformedExtra,
      centralExtra: malformedExtra,
    }]))).toThrow(/extra field/i);

    const localPath = unicodePathExtra("safe.txt", "local.txt");
    const centralPath = unicodePathExtra("safe.txt", "central.txt");
    expect(() => parseZipPreview(createZip([{
      name: "safe.txt",
      localExtra: localPath,
      centralExtra: centralPath,
    }]))).toThrow(/Unicode file names do not match/i);
  });

  it("rejects non-ZIP bytes", () => {
    expect(() => parseZipPreview(new Uint8Array([1, 2, 3]))).toThrow(/ZIP archive/i);
  });
});
