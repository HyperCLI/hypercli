export type FileTypeKind =
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "markdown"
  | "code"
  | "config"
  | "json"
  | "text"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "binary";

export type FilePreviewKind = "image" | "archive" | "code" | "markdown" | "text" | "binary";
export type FileReadMode = "text" | "bytes";
export type FileIconKind =
  | "file"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "code"
  | "json"
  | "settings"
  | "text"
  | "document"
  | "spreadsheet"
  | "presentation";

export interface FileReferenceLike {
  name?: string;
  path?: string;
  type?: string;
  mimeType?: string;
}

export interface FileTypeDefinition {
  id: string;
  label: string;
  kind: FileTypeKind;
  extensions: readonly string[];
  previewKind: FilePreviewKind;
  readMode: FileReadMode;
  editable: boolean;
  iconKind: FileIconKind;
  mimeType?: string;
  mimeTypes?: Readonly<Record<string, string>>;
}

export interface ResolvedFileType extends FileTypeDefinition {
  extension: string;
  known: boolean;
}

const IMAGE_MIME_TYPES = {
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const;

const AUDIO_MIME_TYPES = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "audio/webm",
} as const;

const VIDEO_MIME_TYPES = {
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ogv: "video/ogg",
} as const;

const ARCHIVE_MIME_TYPES = {
  epub: "application/epub+zip",
  zip: "application/zip",
} as const;

const COMPRESSED_ARCHIVE_MIME_TYPES = {
  gz: "application/gzip",
  tar: "application/x-tar",
  tgz: "application/gzip",
} as const;

export const FILE_TYPE_DEFINITIONS = [
  {
    id: "image",
    label: "Image",
    kind: "image",
    extensions: ["bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"],
    previewKind: "image",
    readMode: "bytes",
    editable: false,
    iconKind: "image",
    mimeTypes: IMAGE_MIME_TYPES,
  },
  {
    id: "audio",
    label: "Audio",
    kind: "audio",
    extensions: ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "audio",
    mimeTypes: AUDIO_MIME_TYPES,
  },
  {
    id: "video",
    label: "Video",
    kind: "video",
    extensions: ["avi", "m4v", "mov", "mp4", "mpeg", "mpg", "ogv"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "video",
    mimeTypes: VIDEO_MIME_TYPES,
  },
  {
    id: "zip-archive",
    label: "Archive",
    kind: "archive",
    extensions: ["epub", "zip"],
    previewKind: "archive",
    readMode: "bytes",
    editable: false,
    iconKind: "archive",
    mimeTypes: ARCHIVE_MIME_TYPES,
  },
  {
    id: "compressed-archive",
    label: "Compressed archive",
    kind: "archive",
    extensions: ["gz", "tar", "tgz"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "archive",
    mimeTypes: COMPRESSED_ARCHIVE_MIME_TYPES,
  },
  {
    id: "markdown",
    label: "Markdown",
    kind: "markdown",
    extensions: ["md", "mdx"],
    previewKind: "markdown",
    readMode: "text",
    editable: true,
    iconKind: "text",
    mimeType: "text/markdown",
  },
  {
    id: "json",
    label: "JSON",
    kind: "json",
    extensions: ["json"],
    previewKind: "text",
    readMode: "text",
    editable: true,
    iconKind: "json",
    mimeType: "application/json",
  },
  {
    id: "code",
    label: "Code",
    kind: "code",
    extensions: [
      "bash", "c", "cc", "cjs", "cpp", "cs", "css", "dockerfile", "fish", "go", "graphql",
      "h", "hpp", "htm", "html", "java", "js", "jsonc", "jsx", "kt", "mjs", "php", "ps1",
      "py", "rb", "rs", "sass", "scss", "sh", "sql", "swift", "ts", "tsx", "xml", "zsh",
    ],
    previewKind: "code",
    readMode: "text",
    editable: true,
    iconKind: "code",
    mimeType: "text/plain",
  },
  {
    id: "config",
    label: "Config",
    kind: "config",
    extensions: ["conf", "env", "ini", "lock", "toml", "yaml", "yml"],
    previewKind: "code",
    readMode: "text",
    editable: true,
    iconKind: "settings",
    mimeType: "text/plain",
  },
  {
    id: "text",
    label: "Text",
    kind: "text",
    extensions: ["csv", "log", "tsv", "txt"],
    previewKind: "text",
    readMode: "text",
    editable: true,
    iconKind: "text",
    mimeType: "text/plain",
  },
  {
    id: "document",
    label: "Document",
    kind: "document",
    extensions: ["doc", "docx", "pdf"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "document",
    mimeTypes: {
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
    },
  },
  {
    id: "spreadsheet",
    label: "Spreadsheet",
    kind: "spreadsheet",
    extensions: ["xls", "xlsx"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "spreadsheet",
    mimeTypes: {
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  },
  {
    id: "presentation",
    label: "Presentation",
    kind: "presentation",
    extensions: ["ppt", "pptx"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "presentation",
    mimeTypes: {
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
  },
  {
    id: "binary-library",
    label: "Binary",
    kind: "binary",
    extensions: ["a"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeType: "application/octet-stream",
  },
] as const satisfies readonly FileTypeDefinition[];

const UNKNOWN_TEXT_FILE_TYPE: FileTypeDefinition = {
  id: "unknown-text",
  label: "Text",
  kind: "text",
  extensions: [],
  previewKind: "text",
  readMode: "text",
  editable: true,
  iconKind: "file",
  mimeType: "text/plain",
};

const EXTENSION_TO_FILE_TYPE = new Map<string, FileTypeDefinition>();

for (const definition of FILE_TYPE_DEFINITIONS) {
  for (const extension of definition.extensions) {
    EXTENSION_TO_FILE_TYPE.set(extension, definition);
  }
}

export const KNOWN_FILE_EXTENSIONS = Object.freeze(Array.from(EXTENSION_TO_FILE_TYPE.keys()).sort());

function stripUrlSuffix(value: string): string {
  return value.trim().replace(/[?#].*$/, "");
}

function basename(value: string): string {
  const stripped = stripUrlSuffix(value).replace(/[\\/]+$/, "");
  return stripped.split(/[\\/]/).filter(Boolean).pop() ?? stripped;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isFileReference(value: string | FileReferenceLike): value is FileReferenceLike {
  return typeof value !== "string";
}

function fileReferenceCandidates(value: string | FileReferenceLike): string[] {
  if (typeof value === "string") return [value];
  return [value.name, value.path].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

function fileReferenceMimeType(value: string | FileReferenceLike): string {
  if (!isFileReference(value)) return "";
  return (value.mimeType || value.type || "").trim().toLowerCase();
}

function fileKindFromMimeType(mimeType: string): FileTypeKind | null {
  if (!mimeType) return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/json") return "json";
  if (mimeType === "text/markdown") return "markdown";
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType === "application/pdf") return "document";
  if (mimeType === "application/zip" || mimeType === "application/epub+zip") return "archive";
  return null;
}

export function getFileExtension(value: string | FileReferenceLike): string {
  const candidate = fileReferenceCandidates(value)[0] ?? "";
  const name = basename(candidate);
  if (!name || name === "." || name === "..") return "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < name.length - 1) return name.slice(dotIndex + 1).toLowerCase();
  return name.toLowerCase();
}

export function resolveFileType(value: string | FileReferenceLike): ResolvedFileType {
  const extension = getFileExtension(value);
  const definition = EXTENSION_TO_FILE_TYPE.get(extension);
  if (definition) return { ...definition, extension, known: true };

  const mimeKind = fileKindFromMimeType(fileReferenceMimeType(value));
  const mimeDefinition = mimeKind
    ? FILE_TYPE_DEFINITIONS.find((candidate) => candidate.kind === mimeKind)
    : null;
  if (mimeDefinition) return { ...mimeDefinition, extension, known: true };

  return { ...UNKNOWN_TEXT_FILE_TYPE, extension, known: false };
}

export function shouldReadFileAsBytes(value: string | FileReferenceLike): boolean {
  return resolveFileType(value).readMode === "bytes";
}

export function isFileTypeReference(value: string | FileReferenceLike, kind: FileTypeKind): boolean {
  const mimeKind = fileKindFromMimeType(fileReferenceMimeType(value));
  if (mimeKind === kind) return true;
  return fileReferenceCandidates(value).some((candidate) => resolveFileType(candidate).kind === kind);
}

export function isImageFileReference(value: string | FileReferenceLike): boolean {
  return isFileTypeReference(value, "image");
}

export function isAudioFileReference(value: string | FileReferenceLike): boolean {
  return isFileTypeReference(value, "audio");
}

export function isVideoFileReference(value: string | FileReferenceLike): boolean {
  return isFileTypeReference(value, "video");
}

export function isArchiveFileReference(value: string | FileReferenceLike): boolean {
  return isFileTypeReference(value, "archive");
}

export function isKnownNonImageFileReference(value: string | FileReferenceLike): boolean {
  const mimeKind = fileKindFromMimeType(fileReferenceMimeType(value));
  if (mimeKind) return mimeKind !== "image";
  return fileReferenceCandidates(value).some((candidate) => {
    const fileType = resolveFileType(candidate);
    return fileType.known && fileType.kind !== "image";
  });
}

export function inferFileMimeType(value: string | FileReferenceLike, fallback = "application/octet-stream"): string {
  const mimeType = fileReferenceMimeType(value);
  if (mimeType) return mimeType;
  const fileType = resolveFileType(value);
  return fileType.mimeTypes?.[fileType.extension] ?? fileType.mimeType ?? fallback;
}

export function knownFileExtensionsPattern(): string {
  return KNOWN_FILE_EXTENSIONS
    .slice()
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join("|");
}
