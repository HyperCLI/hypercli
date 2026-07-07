export interface ZipPreviewEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
  unsafePath: boolean;
  compressionMethod: number;
}

export interface ZipPreview {
  entries: ZipPreviewEntry[];
  totalEntries: number;
  fileCount: number;
  directoryCount: number;
  truncated: boolean;
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP64_FIELD_MARKER = 0xffff;
const ZIP64_OFFSET_MARKER = 0xffffffff;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const DEFAULT_MAX_ENTRIES = 1000;

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw new Error("Invalid ZIP archive.");
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new Error("Invalid ZIP archive.");
  }
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const firstPossibleOffset = Math.max(0, view.byteLength - 22 - MAX_ZIP_COMMENT_LENGTH);
  for (let offset = view.byteLength - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (readUint32(view, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = readUint16(view, offset + 20);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new Error("This does not look like a ZIP archive.");
}

function decodeZipFileName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function isUnsafeZipPath(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  );
}

export function parseZipPreview(bytes: Uint8Array, maxEntries = DEFAULT_MAX_ENTRIES): ZipPreview {
  if (bytes.byteLength < 22) {
    throw new Error("This does not look like a ZIP archive.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = readUint16(view, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(view, eocdOffset + 6);
  const totalEntriesOnDisk = readUint16(view, eocdOffset + 8);
  const totalEntries = readUint16(view, eocdOffset + 10);
  const centralDirectorySize = readUint32(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || totalEntriesOnDisk !== totalEntries) {
    throw new Error("Multi-part ZIP archives are not supported in preview.");
  }

  if (
    totalEntries === ZIP64_FIELD_MARKER ||
    centralDirectorySize === ZIP64_OFFSET_MARKER ||
    centralDirectoryOffset === ZIP64_OFFSET_MARKER
  ) {
    throw new Error("ZIP64 archives are not supported in preview yet.");
  }

  if (centralDirectoryOffset + centralDirectorySize > view.byteLength) {
    throw new Error("Invalid ZIP central directory.");
  }

  const entries: ZipPreviewEntry[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let cursor = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  for (let index = 0; index < totalEntries && cursor < endOffset; index += 1) {
    if (readUint32(view, cursor) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry.");
    }

    const flags = readUint16(view, cursor + 8);
    const compressionMethod = readUint16(view, cursor + 10);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraFieldLength = readUint16(view, cursor + 30);
    const fileCommentLength = readUint16(view, cursor + 32);
    const externalAttributes = readUint32(view, cursor + 38);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > endOffset) {
      throw new Error("Invalid ZIP file name.");
    }

    const name = decodeZipFileName(bytes.subarray(nameStart, nameEnd), Boolean(flags & 0x0800));
    const directory = name.endsWith("/") || Boolean(externalAttributes & 0x10);
    if (directory) directoryCount += 1;
    else fileCount += 1;

    if (entries.length < maxEntries) {
      entries.push({
        name,
        compressedSize,
        uncompressedSize,
        directory,
        unsafePath: isUnsafeZipPath(name),
        compressionMethod,
      });
    }

    cursor = nameEnd + extraFieldLength + fileCommentLength;
  }

  return {
    entries,
    totalEntries,
    fileCount,
    directoryCount,
    truncated: totalEntries > entries.length,
  };
}
