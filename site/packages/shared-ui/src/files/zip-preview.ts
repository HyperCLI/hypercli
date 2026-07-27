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
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_FIELD_MARKER = 0xffff;
const ZIP64_OFFSET_MARKER = 0xffffffff;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const DEFAULT_MAX_ENTRIES = 1000;
const MAX_RETAINED_FILE_NAME_BYTES = 1024 * 1024;
const CENTRAL_DIRECTORY_FILE_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_SIZE = 30;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FILE_NAME_FLAG = 0x0800;
const UNICODE_PATH_EXTRA_FIELD_ID = 0x7075;
const CP437_HIGH_CODE_POINTS = new Uint16Array([
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9, 0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f, 0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, 0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248, 0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
]);

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
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Invalid UTF-8 ZIP file name.");
    }
  }
  let name = "";
  for (const byte of bytes) {
    name += String.fromCharCode(byte < 0x80 ? byte : CP437_HIGH_CODE_POINTS[byte - 0x80]!);
  }
  return name;
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff]!;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function parseUnicodePathExtraField(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  rawNameBytes: Uint8Array,
): string | null {
  let cursor = start;
  let unicodeName: string | null = null;
  let rawNameCrc: number | null = null;
  while (cursor < end) {
    if (cursor + 4 > end) throw new Error("Invalid ZIP extra field.");
    const fieldId = readUint16(view, cursor);
    const fieldSize = readUint16(view, cursor + 2);
    const dataStart = cursor + 4;
    const dataEnd = dataStart + fieldSize;
    if (dataEnd > end) throw new Error("Invalid ZIP extra field.");

    if (fieldId === UNICODE_PATH_EXTRA_FIELD_ID) {
      if (fieldSize < 5) throw new Error("Invalid ZIP Unicode path field.");
      const version = bytes[dataStart];
      const expectedNameCrc = readUint32(view, dataStart + 1);
      rawNameCrc ??= crc32(rawNameBytes);
      if (version === 1 && expectedNameCrc === rawNameCrc) {
        const nextName = decodeZipFileName(bytes.subarray(dataStart + 5, dataEnd), true);
        if (unicodeName !== null && unicodeName !== nextName) {
          throw new Error("Conflicting ZIP Unicode path fields.");
        }
        unicodeName = nextName;
      }
    }
    cursor = dataEnd;
  }
  return unicodeName;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

interface LocalFileRecord {
  view: DataView;
  bytes: Uint8Array;
  centralDirectoryOffset: number;
  localHeaderOffset: number;
  flags: number;
  compressionMethod: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  nameBytes: Uint8Array;
}

function validateLocalFileRecord(record: LocalFileRecord): string | null {
  const {
    view,
    bytes,
    centralDirectoryOffset,
    localHeaderOffset,
    flags,
    compressionMethod,
    checksum,
    compressedSize,
    uncompressedSize,
    nameBytes,
  } = record;
  if (
    localHeaderOffset >= centralDirectoryOffset
    || localHeaderOffset + LOCAL_FILE_HEADER_SIZE > centralDirectoryOffset
    || readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error("Invalid ZIP local file header.");
  }

  const localFlags = readUint16(view, localHeaderOffset + 6);
  const localCompressionMethod = readUint16(view, localHeaderOffset + 8);
  const localChecksum = readUint32(view, localHeaderOffset + 14);
  const localCompressedSize = readUint32(view, localHeaderOffset + 18);
  const localUncompressedSize = readUint32(view, localHeaderOffset + 22);
  const localNameLength = readUint16(view, localHeaderOffset + 26);
  const localExtraFieldLength = readUint16(view, localHeaderOffset + 28);
  const localNameStart = localHeaderOffset + LOCAL_FILE_HEADER_SIZE;
  const localNameEnd = localNameStart + localNameLength;
  const localExtraEnd = localNameEnd + localExtraFieldLength;

  if (
    localExtraEnd > centralDirectoryOffset
    || compressedSize > centralDirectoryOffset - localExtraEnd
    || localFlags !== flags
    || localCompressionMethod !== compressionMethod
  ) {
    throw new Error("Invalid ZIP local file header.");
  }

  const localNameBytes = bytes.subarray(localNameStart, localNameEnd);
  if (!equalBytes(localNameBytes, nameBytes)) {
    throw new Error("ZIP local and central file names do not match.");
  }

  const usesDataDescriptor = Boolean(flags & DATA_DESCRIPTOR_FLAG);
  if (
    (!usesDataDescriptor && (
      localChecksum !== checksum
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize
    ))
    || (usesDataDescriptor && (
      (localChecksum !== 0 && localChecksum !== checksum)
      || (localCompressedSize !== 0 && localCompressedSize !== compressedSize)
      || (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
    ))
  ) {
    throw new Error("ZIP local and central file metadata do not match.");
  }

  return parseUnicodePathExtraField(
    view,
    bytes,
    localNameEnd,
    localExtraEnd,
    localNameBytes,
  );
}

function isUnsafeZipPath(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..") ||
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(normalized)
  );
}

export function parseZipPreview(bytes: Uint8Array, maxEntries = DEFAULT_MAX_ENTRIES): ZipPreview {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new RangeError("maxEntries must be a non-negative safe integer.");
  }
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

  if (
    centralDirectoryOffset > eocdOffset
    || centralDirectorySize > eocdOffset - centralDirectoryOffset
    || totalEntries * CENTRAL_DIRECTORY_FILE_HEADER_SIZE > centralDirectorySize
  ) {
    throw new Error("Invalid ZIP central directory.");
  }

  const entries: ZipPreviewEntry[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let cursor = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;
  let retainedFileNameBytes = 0;
  let retainEntries = true;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_DIRECTORY_FILE_HEADER_SIZE > endOffset) {
      throw new Error("Invalid ZIP central directory entry.");
    }
    if (readUint32(view, cursor) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry.");
    }

    const flags = readUint16(view, cursor + 8);
    const compressionMethod = readUint16(view, cursor + 10);
    const checksum = readUint32(view, cursor + 16);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraFieldLength = readUint16(view, cursor + 30);
    const fileCommentLength = readUint16(view, cursor + 32);
    const entryDiskNumber = readUint16(view, cursor + 34);
    const externalAttributes = readUint32(view, cursor + 38);
    const localHeaderOffset = readUint32(view, cursor + 42);
    const nameStart = cursor + CENTRAL_DIRECTORY_FILE_HEADER_SIZE;
    const nameEnd = nameStart + fileNameLength;
    const entryEnd = nameEnd + extraFieldLength + fileCommentLength;

    if (fileNameLength === 0 || entryEnd > endOffset) {
      throw new Error("Invalid ZIP file name.");
    }
    if (
      compressedSize === ZIP64_OFFSET_MARKER
      || uncompressedSize === ZIP64_OFFSET_MARKER
      || localHeaderOffset === ZIP64_OFFSET_MARKER
      || entryDiskNumber === ZIP64_FIELD_MARKER
    ) {
      throw new Error("ZIP64 archives are not supported in preview yet.");
    }
    const nameBytes = bytes.subarray(nameStart, nameEnd);
    const rawName = decodeZipFileName(nameBytes, Boolean(flags & UTF8_FILE_NAME_FLAG));
    const centralUnicodeName = parseUnicodePathExtraField(
      view,
      bytes,
      nameEnd,
      nameEnd + extraFieldLength,
      nameBytes,
    );
    if (entryDiskNumber !== 0) throw new Error("Invalid ZIP local file header.");
    const localUnicodeName = validateLocalFileRecord({
      view,
      bytes,
      centralDirectoryOffset,
      localHeaderOffset,
      flags,
      compressionMethod,
      checksum,
      compressedSize,
      uncompressedSize,
      nameBytes,
    });
    if (centralUnicodeName && localUnicodeName && centralUnicodeName !== localUnicodeName) {
      throw new Error("ZIP local and central Unicode file names do not match.");
    }
    const name = centralUnicodeName ?? localUnicodeName ?? rawName;
    const versionMadeBy = readUint16(view, cursor + 4);
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const hasUnixAttributes = creatorSystem === 3 || creatorSystem === 19;
    const symbolicLink = hasUnixAttributes && (unixMode & 0xf000) === 0xa000;
    const unixDirectory = hasUnixAttributes && (unixMode & 0xf000) === 0x4000;
    const directory = rawName.endsWith("/") || name.endsWith("/") || Boolean(externalAttributes & 0x10) || unixDirectory;
    if (directory) directoryCount += 1;
    else fileCount += 1;

    if (retainEntries && entries.length < maxEntries) {
      const retainedNameBytes = Math.max(fileNameLength, name.length * 2);
      if (retainedFileNameBytes + retainedNameBytes > MAX_RETAINED_FILE_NAME_BYTES) {
        retainEntries = false;
      } else {
        retainedFileNameBytes += retainedNameBytes;
        entries.push({
          name,
          compressedSize,
          uncompressedSize,
          directory,
          unsafePath: symbolicLink || isUnsafeZipPath(rawName) || isUnsafeZipPath(name),
          compressionMethod,
        });
      }
    }

    cursor = entryEnd;
  }

  if (cursor !== endOffset) {
    throw new Error("Invalid ZIP central directory size.");
  }

  return {
    entries,
    totalEntries,
    fileCount,
    directoryCount,
    truncated: totalEntries > entries.length,
  };
}
