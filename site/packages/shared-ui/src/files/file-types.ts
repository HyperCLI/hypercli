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
  | "calendar"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "binary";

export type FilePreviewKind = "image" | "audio" | "video" | "pdf" | "archive" | "code" | "html" | "markdown" | "text" | "binary";
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
  | "calendar"
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
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  cur: "image/x-icon",
  gif: "image/gif",
  ico: "image/x-icon",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const;

const AUDIO_MIME_TYPES = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aifc: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  mid: "audio/midi",
  midi: "audio/midi",
  mp3: "audio/mpeg",
  mp2: "audio/mpeg",
  mpa: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  spx: "audio/ogg",
  wav: "audio/wav",
  wave: "audio/wav",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
} as const;

const VIDEO_MIME_TYPES = {
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  f4v: "video/mp4",
  m4v: "video/x-m4v",
  m2v: "video/mpeg",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ogv: "video/ogg",
  ogm: "video/ogg",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
} as const;

const NATIVE_IMAGE_MIME_TYPES = new Set<string>(Object.values(IMAGE_MIME_TYPES));
const NATIVE_AUDIO_MIME_TYPES = new Set<string>(Object.values(AUDIO_MIME_TYPES));
const NATIVE_VIDEO_MIME_TYPES = new Set<string>(Object.values(VIDEO_MIME_TYPES));

const ARCHIVE_MIME_TYPES = {
  cbz: "application/vnd.comicbook+zip",
  epub: "application/epub+zip",
  kmz: "application/vnd.google-earth.kmz",
  zip: "application/zip",
  zipx: "application/zip",
} as const;

const ZIP_PACKAGE_MIME_TYPES = {
  apk: "application/vnd.android.package-archive",
  egg: "application/zip",
  ipa: "application/zip",
  jar: "application/java-archive",
  nupkg: "application/zip",
  vsix: "application/zip",
  war: "application/java-archive",
  whl: "application/zip",
  xpi: "application/x-xpinstall",
} as const;

const COMPRESSED_ARCHIVE_MIME_TYPES = {
  "7z": "application/x-7z-compressed",
  br: "application/x-brotli",
  bz2: "application/x-bzip2",
  cab: "application/vnd.ms-cab-compressed",
  cbr: "application/vnd.rar",
  cpio: "application/x-cpio",
  gz: "application/gzip",
  lz: "application/x-lzip",
  lz4: "application/x-lz4",
  lzma: "application/x-lzma",
  rar: "application/vnd.rar",
  tar: "application/x-tar",
  tbz: "application/x-bzip2",
  tbz2: "application/x-bzip2",
  tgz: "application/gzip",
  tlz: "application/x-lzma",
  txz: "application/x-xz",
  xz: "application/x-xz",
  z: "application/x-compress",
  zst: "application/zstd",
  tzst: "application/zstd",
} as const;

export const FILE_TYPE_DEFINITIONS = [
  {
    id: "image",
    label: "Image",
    kind: "image",
    extensions: ["apng", "avif", "bmp", "cur", "gif", "ico", "jpe", "jpeg", "jfif", "jpg", "pjp", "pjpeg", "png", "svg", "webp"],
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
    extensions: ["aac", "aif", "aifc", "aiff", "flac", "m4a", "m4b", "mid", "midi", "mp2", "mp3", "mpa", "oga", "ogg", "opus", "spx", "wav", "wave", "weba", "wma"],
    previewKind: "audio",
    readMode: "bytes",
    editable: false,
    iconKind: "audio",
    mimeTypes: AUDIO_MIME_TYPES,
  },
  {
    id: "video",
    label: "Video",
    kind: "video",
    extensions: ["3g2", "3gp", "avi", "f4v", "flv", "m2v", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogm", "ogv", "webm", "wmv"],
    previewKind: "video",
    readMode: "bytes",
    editable: false,
    iconKind: "video",
    mimeTypes: VIDEO_MIME_TYPES,
  },
  {
    id: "zip-archive",
    label: "Archive",
    kind: "archive",
    extensions: ["cbz", "epub", "kmz", "zip", "zipx"],
    previewKind: "archive",
    readMode: "bytes",
    editable: false,
    iconKind: "archive",
    mimeTypes: ARCHIVE_MIME_TYPES,
  },
  {
    id: "zip-package",
    label: "Package",
    kind: "archive",
    extensions: ["apk", "egg", "ipa", "jar", "nupkg", "vsix", "war", "whl", "xpi"],
    previewKind: "archive",
    readMode: "bytes",
    editable: false,
    iconKind: "archive",
    mimeTypes: ZIP_PACKAGE_MIME_TYPES,
  },
  {
    id: "zip-data",
    label: "Data package",
    kind: "binary",
    extensions: ["npz"],
    previewKind: "archive",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeType: "application/zip",
  },
  {
    id: "compressed-archive",
    label: "Compressed archive",
    kind: "archive",
    extensions: ["7z", "br", "bz2", "cab", "cbr", "cpio", "gz", "lz", "lz4", "lzma", "rar", "tar", "tbz", "tbz2", "tgz", "tlz", "txz", "tzst", "xz", "z", "zst"],
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
    extensions: ["livemd", "markdown", "md", "mdown", "mdwn", "mdx", "mkd", "mkdn", "qmd", "rmd"],
    previewKind: "markdown",
    readMode: "text",
    editable: true,
    iconKind: "text",
    mimeType: "text/markdown",
  },
  {
    id: "html",
    label: "HTML",
    kind: "code",
    extensions: ["htm", "html", "shtml", "xht", "xhtml"],
    previewKind: "html",
    readMode: "text",
    editable: true,
    iconKind: "code",
    mimeTypes: {
      htm: "text/html",
      html: "text/html",
      shtml: "text/html",
      xht: "application/xhtml+xml",
      xhtml: "application/xhtml+xml",
    },
    mimeType: "text/html",
  },
  {
    id: "json",
    label: "JSON",
    kind: "json",
    extensions: ["geojson", "gltf", "har", "ipynb", "json", "json5", "jsonl", "jsonld", "ndjson", "sarif", "topojson", "webmanifest"],
    previewKind: "text",
    readMode: "text",
    editable: true,
    iconKind: "json",
    mimeTypes: {
      geojson: "application/geo+json",
      gltf: "model/gltf+json",
      har: "application/json",
      ipynb: "application/x-ipynb+json",
      json: "application/json",
      json5: "application/json5",
      jsonl: "application/x-ndjson",
      jsonld: "application/ld+json",
      ndjson: "application/x-ndjson",
      sarif: "application/sarif+json",
      topojson: "application/json",
      webmanifest: "application/manifest+json",
    },
    mimeType: "application/json",
  },
  {
    id: "code",
    label: "Code",
    kind: "code",
    extensions: [
      "asm", "astro", "bash", "bat", "bats", "bicep", "c", "capnp", "cc", "cjs", "clj", "cljc",
      "cljs", "cmake", "cmd", "cpp", "cs", "css", "cts", "cu", "cuh", "cxx", "dart", "dockerfile",
      "edn", "ejs", "elm", "erl", "ex", "exs", "fb2", "fish", "fs", "fsx", "go", "gradle", "graphql",
      "gpx", "graphqls", "gql", "groovy", "h", "haml", "hbs", "hcl", "hh", "hpp", "hrl", "hs",
      "hxx", "inl", "j2", "java", "jinja", "jinja2", "jl", "js", "jsonc", "jsx", "kml", "ksh", "kt",
      "kts", "ld", "lds", "less", "lhs", "lua", "makefile", "ml", "mli", "mm", "mjs", "mustache", "nim",
      "nix", "nomad", "php", "pl", "proto", "ps1", "pug", "py", "pyi", "pyw", "r", "rb", "rego", "rs",
      "s", "sass", "scala", "scss", "sh", "sol", "sql", "styl", "svelte", "sv", "svh", "swift", "tcl", "tf",
      "tfvars", "thrift", "tmpl", "tpl", "ts", "tsx", "twig", "v", "vh", "vue", "wat", "wsdl",
      "xml", "xsd", "xsl", "xslt", "zig", "zsh",
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
    extensions: [
      "cfg", "cnf", "conf", "config", "desktop", "dockerignore", "editorconfig", "env", "gitattributes",
      "gitconfig", "gitignore", "gitmodules", "hocon", "ignore", "ini", "link", "lock", "mailmap", "mount",
      "netdev", "network", "node-version", "npmignore", "npmrc", "nvmrc", "path", "preset", "properties",
      "python-version", "rc", "rproj", "ruby-version", "rules", "service", "socket", "target", "timer",
      "toml", "tool-versions", "yaml", "yml",
    ],
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
    extensions: [
      "adoc", "asciidoc", "ass", "creole", "csv", "dfxp", "diff", "eml", "lrc", "log", "m3u", "m3u8",
      "mbox", "nfo", "org", "patch", "pls", "rst", "sbv", "srt", "ssa", "tex", "textile", "tsv", "ttml",
      "txt", "vcard", "vcf", "vtt", "xspf",
    ],
    previewKind: "text",
    readMode: "text",
    editable: true,
    iconKind: "text",
    mimeTypes: {
      csv: "text/csv",
      dfxp: "application/ttml+xml",
      eml: "message/rfc822",
      m3u: "application/vnd.apple.mpegurl",
      m3u8: "application/vnd.apple.mpegurl",
      mbox: "application/mbox",
      tsv: "text/tab-separated-values",
      ttml: "application/ttml+xml",
      vcard: "text/vcard",
      vcf: "text/vcard",
      vtt: "text/vtt",
      xspf: "application/xspf+xml",
    },
    mimeType: "text/plain",
  },
  {
    id: "calendar",
    label: "Calendar",
    kind: "calendar",
    extensions: ["ics", "ifb"],
    previewKind: "text",
    readMode: "text",
    editable: true,
    iconKind: "calendar",
    mimeType: "text/calendar",
  },
  {
    id: "pdf",
    label: "PDF",
    kind: "document",
    extensions: ["pdf"],
    previewKind: "pdf",
    readMode: "bytes",
    editable: false,
    iconKind: "document",
    mimeType: "application/pdf",
  },
  {
    id: "document",
    label: "Document",
    kind: "document",
    extensions: [
      "azw", "azw3", "djv", "djvu", "doc", "docm", "docx", "dot", "dotm", "dotx", "fodg", "fodt",
      "kfx", "mobi", "odc", "odf", "odg", "odi", "odm", "odt", "one", "otg", "oth", "ott", "oxps",
      "pages", "rtf", "vsd", "vsdm", "vsdx", "wpd", "wps", "xps",
    ],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "document",
    mimeTypes: {
      doc: "application/msword",
      docm: "application/vnd.ms-word.document.macroenabled.12",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dot: "application/msword",
      dotm: "application/vnd.ms-word.template.macroenabled.12",
      dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      mobi: "application/x-mobipocket-ebook",
      fodg: "application/vnd.oasis.opendocument.graphics-flat-xml",
      fodt: "application/vnd.oasis.opendocument.text-flat-xml",
      odc: "application/vnd.oasis.opendocument.chart",
      odf: "application/vnd.oasis.opendocument.formula",
      odg: "application/vnd.oasis.opendocument.graphics",
      odi: "application/vnd.oasis.opendocument.image",
      odm: "application/vnd.oasis.opendocument.text-master",
      odt: "application/vnd.oasis.opendocument.text",
      otg: "application/vnd.oasis.opendocument.graphics-template",
      oth: "application/vnd.oasis.opendocument.text-web",
      ott: "application/vnd.oasis.opendocument.text-template",
      oxps: "application/oxps",
      pages: "application/x-iwork-pages-sffpages",
      rtf: "application/rtf",
      wpd: "application/vnd.wordperfect",
      wps: "application/vnd.ms-works",
      xps: "application/vnd.ms-xpsdocument",
    },
  },
  {
    id: "spreadsheet",
    label: "Spreadsheet",
    kind: "spreadsheet",
    extensions: ["fods", "numbers", "ods", "ots", "xls", "xlsb", "xlsm", "xlsx", "xlt", "xltm", "xltx"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "spreadsheet",
    mimeTypes: {
      fods: "application/vnd.oasis.opendocument.spreadsheet-flat-xml",
      numbers: "application/x-iwork-numbers-sffnumbers",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      ots: "application/vnd.oasis.opendocument.spreadsheet-template",
      xls: "application/vnd.ms-excel",
      xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xlt: "application/vnd.ms-excel",
      xltm: "application/vnd.ms-excel.template.macroenabled.12",
      xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    },
  },
  {
    id: "presentation",
    label: "Presentation",
    kind: "presentation",
    extensions: ["fodp", "odp", "otp", "pot", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "presentation",
    mimeTypes: {
      fodp: "application/vnd.oasis.opendocument.presentation-flat-xml",
      odp: "application/vnd.oasis.opendocument.presentation",
      otp: "application/vnd.oasis.opendocument.presentation-template",
      pot: "application/vnd.ms-powerpoint",
      potm: "application/vnd.ms-powerpoint.template.macroenabled.12",
      potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
      pps: "application/vnd.ms-powerpoint",
      ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
      ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
      ppt: "application/vnd.ms-powerpoint",
      pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
  },
  {
    id: "unsupported-image",
    label: "Image",
    kind: "image",
    extensions: [
      "arw", "cr2", "cr3", "dds", "dng", "exr", "hdr", "heic", "heics", "heif", "heifs", "j2k", "jp2",
      "jpf", "jpx", "nef", "orf", "pcx", "psd", "qoi", "rw2", "sgi", "tga", "tif", "tiff", "wmf",
    ],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "image",
    mimeTypes: {
      heic: "image/heic",
      heif: "image/heif",
      psd: "image/vnd.adobe.photoshop",
      tif: "image/tiff",
      tiff: "image/tiff",
    },
  },
  {
    id: "unsupported-audio",
    label: "Audio",
    kind: "binary",
    extensions: ["ac3", "ape", "caf", "dts", "eac3", "mka", "ra", "ram", "wv"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "audio",
    mimeTypes: {
      ac3: "audio/ac3",
      caf: "audio/x-caf",
      eac3: "audio/eac3",
      mka: "audio/x-matroska",
      ra: "audio/vnd.rn-realaudio",
      ram: "audio/vnd.rn-realaudio",
    },
    mimeType: "application/octet-stream",
  },
  {
    id: "unsupported-video",
    label: "Video",
    kind: "binary",
    extensions: ["asf", "m2ts", "mxf", "rm", "rmvb", "vob"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "video",
    mimeTypes: {
      asf: "video/x-ms-asf",
      m2ts: "video/mp2t",
      mxf: "application/mxf",
      rm: "application/vnd.rn-realmedia",
      rmvb: "application/vnd.rn-realmedia-vbr",
      vob: "video/dvd",
    },
    mimeType: "application/octet-stream",
  },
  {
    id: "credential-text",
    label: "Credential",
    kind: "text",
    extensions: ["pem"],
    previewKind: "code",
    readMode: "text",
    editable: false,
    iconKind: "file",
    mimeTypes: { pem: "application/x-pem-file" },
    mimeType: "text/plain",
  },
  {
    id: "package",
    label: "Package",
    kind: "archive",
    extensions: ["deb", "dmg", "iso", "rpm"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "archive",
    mimeType: "application/octet-stream",
  },
  {
    id: "executable",
    label: "Executable",
    kind: "binary",
    extensions: ["a", "bin", "class", "dll", "dylib", "exe", "o", "obj", "pyc", "so", "wasm"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeType: "application/octet-stream",
  },
  {
    id: "data-binary",
    label: "Data",
    kind: "binary",
    extensions: [
      "accdb", "arrow", "avro", "bson", "cbor", "db", "dbf", "dta", "duckdb", "feather", "glb", "h5",
      "hdf", "hdf5", "laz", "mdb", "mpack", "msgpack", "npy", "parquet", "pcap", "pcapng", "pickle", "pkl",
      "rdata", "rds", "sas7bdat", "sav", "shp", "shx", "sqlite", "sqlite3", "ubjson",
    ],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeType: "application/octet-stream",
  },
  {
    id: "model",
    label: "Model",
    kind: "binary",
    extensions: ["ckpt", "gguf", "mlmodel", "onnx", "pt", "pth", "safetensors", "tflite", "weights"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeType: "application/octet-stream",
  },
  {
    id: "font",
    label: "Font",
    kind: "binary",
    extensions: ["otf", "ttf", "woff", "woff2"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeTypes: {
      otf: "font/otf",
      ttf: "font/ttf",
      woff: "font/woff",
      woff2: "font/woff2",
    },
  },
  {
    id: "credential",
    label: "Credential",
    kind: "binary",
    extensions: ["cer", "crt", "csr", "der", "jks", "keystore", "p12", "p7b", "p7c", "p7m", "p7s", "p8", "pfx", "pk8"],
    previewKind: "binary",
    readMode: "bytes",
    editable: false,
    iconKind: "file",
    mimeTypes: {
      cer: "application/pkix-cert",
      crt: "application/x-x509-ca-cert",
      csr: "application/pkcs10",
      der: "application/pkix-cert",
      jks: "application/x-java-keystore",
      keystore: "application/x-java-keystore",
      p12: "application/pkcs12",
      p7b: "application/pkcs7-mime",
      p7c: "application/pkcs7-mime",
      p7m: "application/pkcs7-mime",
      p7s: "application/pkcs7-signature",
      p8: "application/pkcs8",
      pfx: "application/pkcs12",
      pk8: "application/pkcs8",
    },
    mimeType: "application/octet-stream",
  },
] as const satisfies readonly FileTypeDefinition[];

const UNKNOWN_BINARY_FILE_TYPE: FileTypeDefinition = {
  id: "unknown-binary",
  label: "File",
  kind: "binary",
  extensions: [],
  previewKind: "binary",
  readMode: "bytes",
  editable: false,
  iconKind: "file",
  mimeType: "application/octet-stream",
};

const EXTENSION_TO_FILE_TYPE = new Map<string, FileTypeDefinition>();
const FILE_TYPE_BY_ID = new Map<string, FileTypeDefinition>();

for (const definition of FILE_TYPE_DEFINITIONS) {
  if (FILE_TYPE_BY_ID.has(definition.id)) {
    throw new Error(`Duplicate file type id: ${definition.id}`);
  }
  FILE_TYPE_BY_ID.set(definition.id, definition);
  for (const extension of definition.extensions) {
    if (EXTENSION_TO_FILE_TYPE.has(extension)) {
      throw new Error(`Duplicate file extension: ${extension}`);
    }
    EXTENSION_TO_FILE_TYPE.set(extension, definition);
  }
}

export const KNOWN_FILE_EXTENSIONS = Object.freeze(Array.from(EXTENSION_TO_FILE_TYPE.keys()).sort());

function stripUrlSuffix(value: string): string {
  return value.trim().replace(/[?#].*$/, "");
}

function basename(value: string, stripSuffix = true): string {
  const stripped = (stripSuffix ? stripUrlSuffix(value) : value.trim()).replace(/[\\/]+$/, "");
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

function candidateHasUrlSuffix(candidate: string, value: string | FileReferenceLike): boolean {
  return typeof value === "string" || /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)/i.test(candidate.trim());
}

const MIME_TYPE_ALIASES: Readonly<Record<string, string>> = {
  "application/acrobat": "application/pdf",
  "application/ics": "text/calendar",
  "application/jsonl": "application/x-ndjson",
  "application/jsonlines": "application/x-ndjson",
  "application/markdown": "text/markdown",
  "application/ndjson": "application/x-ndjson",
  "application/vnd.pdf": "application/pdf",
  "application/x-gzip": "application/gzip",
  "application/x-bzip": "application/x-bzip2",
  "application/x-compressed-tar": "application/x-tar",
  "application/x-gtar": "application/x-tar",
  "application/x-json": "application/json",
  "application/x-jsonlines": "application/x-ndjson",
  "application/x-markdown": "text/markdown",
  "application/x-ndjson": "application/x-ndjson",
  "application/x-pdf": "application/pdf",
  "application/x-pkcs12": "application/pkcs12",
  "application/x-rar-compressed": "application/vnd.rar",
  "application/x-rtf": "application/rtf",
  "application/x-toml": "application/toml",
  "application/x-yaml": "application/yaml",
  "application/x-zstd": "application/zstd",
  "application/x-zip": "application/zip",
  "application/x-zip-compressed": "application/zip",
  "audio/mp3": "audio/mpeg",
  "audio/vnd.wave": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-aiff": "audio/aiff",
  "audio/x-flac": "audio/flac",
  "audio/x-m4a": "audio/mp4",
  "audio/x-mp3": "audio/mpeg",
  "audio/x-mpegurl": "application/vnd.apple.mpegurl",
  "audio/x-wav": "audio/wav",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/vnd.microsoft.icon": "image/x-icon",
  "image/x-png": "image/png",
  "multipart/x-zip": "application/zip",
  "text/json": "application/json",
  "text/md": "text/markdown",
  "text/pdf": "application/pdf",
  "text/rtf": "application/rtf",
  "text/toml": "application/toml",
  "text/x-markdown": "text/markdown",
  "text/x-toml": "application/toml",
  "text/x-vcalendar": "text/calendar",
  "text/x-yaml": "application/yaml",
  "text/yaml": "application/yaml",
};

function normalizeMimeType(value: string): string {
  const mimeType = value
    .trim()
    .toLowerCase()
    .split(";", 1)[0]
    .trim();
  return MIME_TYPE_ALIASES[mimeType] ?? mimeType;
}

function fileReferenceMimeType(value: string | FileReferenceLike): string {
  if (!isFileReference(value)) return "";
  const valueType = value.type?.includes("/") ? value.type : "";
  return normalizeMimeType(value.mimeType || valueType || "");
}

function fileReferenceHasMimeConflict(value: string | FileReferenceLike): boolean {
  if (!isFileReference(value) || !value.mimeType || !value.type?.includes("/")) return false;
  return normalizeMimeType(value.mimeType) !== normalizeMimeType(value.type);
}

function fileTypeById(id: string): FileTypeDefinition | null {
  return FILE_TYPE_BY_ID.get(id) ?? null;
}

function fileTypeFromSpecialName(candidate: string, stripSuffix: boolean): FileTypeDefinition | null {
  const name = basename(candidate, stripSuffix);
  const rules: Array<[RegExp, string]> = [
    [/\.(?:cjs|css|js|jsx|mjs|ts|tsx)\.map$/i, "json"],
    [/\.d\.(?:cts|mts|ts)$/i, "code"],
    [/\.(?:db|sqlite)-(?:journal|shm|wal)$/i, "data-binary"],
    [/^(?:dockerfile|containerfile)(?:[._-].*)?$/i, "code"],
    [/^(?:makefile|gnumakefile|bsdmakefile|procfile)(?:[._-].*)?$/i, "code"],
    [/^(?:justfile|jenkinsfile|vagrantfile|rakefile|gemfile|brewfile|podfile|fastfile|tiltfile|earthfile)$/i, "code"],
    [/^(?:build|build\.bazel|workspace|workspace\.bazel|module\.bazel|buck|cmakelists\.txt|meson\.build|meson_options\.txt|manifest\.in)$/i, "code"],
    [/^go\.(?:mod|sum|work|work\.sum)$/i, "config"],
    [/^pipfile(?:\.lock)?$/i, "config"],
    [/^(?:requirements|constraints)(?:[._-].*)?\.(?:in|txt)$/i, "config"],
    [/^\.env(?:\..+)?$/i, "config"],
    [/^\.(?:bash_logout|bash_profile|bashrc|envrc|kshrc|profile|zlogin|zlogout|zprofile|zshrc)$/i, "config"],
    [/^\.(?:babelrc|browserslistrc|coveragerc|eslintrc|flake8|gitconfig|gitmodules|mailmap|pylintrc|prettierignore|prettierrc|stylelintrc|tool-versions|python-version|node-version|ruby-version)$/i, "config"],
    [/^(?:id_(?:dsa|ecdsa|ed25519|rsa|xmss)(?:\.pub)?|authorized_keys)$/i, "credential-text"],
    [/^(?:known_hosts|mime\.types)$/i, "config"],
  ];
  const match = rules.find(([pattern]) => pattern.test(name));
  return match ? fileTypeById(match[1]) : null;
}

function fileTypeFromFallbackName(candidate: string, stripSuffix: boolean): FileTypeDefinition | null {
  const name = basename(candidate, stripSuffix);
  if (name.includes(".")) return null;
  const rules: Array<[RegExp, string]> = [
    [/^(?:readme|license|licence|notice|authors|contributors|changelog|contributing|security|support|governance|maintainers|codeowners|code_of_conduct|copying|install|todo)(?:[._-].*)?$/i, "text"],
  ];
  const match = rules.find(([pattern]) => pattern.test(name));
  return match ? fileTypeById(match[1]) : null;
}

function fileExtensionFromCandidate(candidate: string, stripSuffix: boolean): string {
  const name = basename(candidate, stripSuffix);
  if (!name || name === "." || name === "..") return "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < name.length - 1) return name.slice(dotIndex + 1).toLowerCase();
  return name.toLowerCase();
}

interface PathFileTypeResolution {
  definition: FileTypeDefinition | null;
  extension: string;
  conflict: boolean;
}

function resolvePathFileType(value: string | FileReferenceLike): PathFileTypeResolution {
  const candidates = fileReferenceCandidates(value);
  const resolutions = candidates.map((candidate) => {
    const stripSuffix = candidateHasUrlSuffix(candidate, value);
    const extension = fileExtensionFromCandidate(candidate, stripSuffix);
    const specialDefinition = fileTypeFromSpecialName(candidate, stripSuffix);
    const extensionDefinition = EXTENSION_TO_FILE_TYPE.get(extension) ?? null;
    const conflict = Boolean(
      specialDefinition
      && extensionDefinition
      && specialDefinition.id !== extensionDefinition.id
      && (specialDefinition.readMode === "bytes" || extensionDefinition.readMode === "bytes"),
    );
    const definition = conflict
      ? null
      : specialDefinition ?? extensionDefinition ?? fileTypeFromFallbackName(candidate, stripSuffix);
    return { definition, extension, conflict };
  });
  if (resolutions.some(({ conflict }) => conflict)) {
    return { definition: null, extension: resolutions[0]?.extension ?? "", conflict: true };
  }
  const knownResolutions = resolutions.filter(
    (resolution): resolution is { definition: FileTypeDefinition; extension: string; conflict: boolean } => Boolean(resolution.definition),
  );
  const definitionIds = new Set(knownResolutions.map(({ definition }) => definition.id));
  if (definitionIds.size > 1) {
    return { definition: null, extension: resolutions[0]?.extension ?? "", conflict: true };
  }
  const selected = knownResolutions[0];
  return {
    definition: selected?.definition ?? null,
    extension: selected?.extension ?? resolutions[0]?.extension ?? "",
    conflict: false,
  };
}

function fileTypeFromMimeType(mimeType: string): FileTypeDefinition | null {
  if (!mimeType) return null;
  if (mimeType === "image/vnd.djvu") return fileTypeById("document");
  if ([
    "image/heic", "image/heif", "image/jp2", "image/jpx", "image/tiff", "image/vnd.adobe.photoshop",
    "image/x-dds", "image/x-exr", "image/x-tga",
  ].includes(mimeType)) {
    return fileTypeById("unsupported-image");
  }
  if ([
    "audio/ac3", "audio/eac3", "audio/vnd.rn-realaudio", "audio/x-ape", "audio/x-caf", "audio/x-matroska",
  ].includes(mimeType)) return fileTypeById("unsupported-audio");
  if ([
    "application/mxf", "application/vnd.rn-realmedia", "application/vnd.rn-realmedia-vbr", "video/dvd",
    "video/mp2t", "video/x-ms-asf",
  ].includes(mimeType)) return fileTypeById("unsupported-video");
  if ([
    "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/xspf+xml",
  ].includes(mimeType)) return fileTypeById("text");
  if (NATIVE_IMAGE_MIME_TYPES.has(mimeType)) return fileTypeById("image");
  if (NATIVE_AUDIO_MIME_TYPES.has(mimeType)) return fileTypeById("audio");
  if (NATIVE_VIDEO_MIME_TYPES.has(mimeType)) return fileTypeById("video");
  if (mimeType === "application/pdf") return fileTypeById("pdf");
  if (["application/zip", "application/epub+zip", "application/vnd.comicbook+zip", "application/vnd.google-earth.kmz"].includes(mimeType) || /^application\/[a-z0-9.-]+\+zip$/.test(mimeType)) return fileTypeById("zip-archive");
  if (["application/java-archive", "application/vnd.android.package-archive", "application/x-java-archive", "application/x-xpinstall"].includes(mimeType)) return fileTypeById("zip-package");
  if (/^(?:application|model|text)\/(?:[a-z0-9.-]+\+)?json$/.test(mimeType) || ["application/json5", "application/x-ndjson"].includes(mimeType)) return fileTypeById("json");
  if (mimeType === "text/markdown") return fileTypeById("markdown");
  if (["application/xhtml+xml", "text/html"].includes(mimeType)) return fileTypeById("html");
  if (mimeType === "text/calendar") return fileTypeById("calendar");
  if (["application/mbox", "application/ttml+xml", "message/rfc822", "text/vcard"].includes(mimeType)) return fileTypeById("text");
  if ([
    "application/ecmascript", "application/graphql", "application/javascript", "application/sql", "application/typescript",
    "application/x-javascript", "application/x-sh", "application/x-typescript", "application/xml", "text/css", "text/ecmascript",
    "text/html", "text/javascript", "text/typescript", "text/x-c", "text/x-c++src", "text/x-java-source", "text/x-python",
    "text/x-shellscript", "text/x-sql", "text/x-typescript", "text/xml",
  ].includes(mimeType) || /^application\/[a-z0-9.-]+\+xml$/.test(mimeType)) return fileTypeById("code");
  if (["application/toml", "application/yaml"].includes(mimeType)) return fileTypeById("config");
  if (["application/x-pem-file", "application/pem-certificate-chain", "application/pgp-keys"].includes(mimeType)) return fileTypeById("credential-text");
  if (mimeType.startsWith("text/")) return fileTypeById("text");
  if ([
    "application/msword",
    "application/rtf",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.ms-word.template.macroenabled.12",
    "application/vnd.ms-works",
    "application/vnd.ms-publisher",
    "application/vnd.ms-xpsdocument",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.text-flat-xml",
    "application/vnd.oasis.opendocument.text-master",
    "application/vnd.oasis.opendocument.text-template",
    "application/vnd.oasis.opendocument.text-web",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    "application/vnd.wordperfect",
    "application/vnd.apple.pages",
    "application/oxps",
    "application/vnd.amazon.ebook",
    "application/vnd.amazon.mobi8-ebook",
    "application/x-mobipocket-ebook",
    "application/x-iwork-pages-sffpages",
  ].includes(mimeType)) return fileTypeById("document");
  if ([
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.binary.macroenabled.12",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-excel.template.macroenabled.12",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.spreadsheet-flat-xml",
    "application/vnd.oasis.opendocument.spreadsheet-template",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    "application/vnd.apple.numbers",
    "application/x-iwork-numbers-sffnumbers",
  ].includes(mimeType)) return fileTypeById("spreadsheet");
  if ([
    "application/vnd.ms-powerpoint",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
    "application/vnd.ms-powerpoint.template.macroenabled.12",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.presentation-flat-xml",
    "application/vnd.oasis.opendocument.presentation-template",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    "application/vnd.openxmlformats-officedocument.presentationml.template",
    "application/vnd.apple.keynote",
    "application/x-iwork-keynote-sffkey",
  ].includes(mimeType)) return fileTypeById("presentation");
  if (mimeType.startsWith("application/vnd.oasis.opendocument.")) return fileTypeById("document");
  if ([
    "application/gzip",
    "application/vnd.ms-cab-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-bzip2",
    "application/x-brotli",
    "application/x-compress",
    "application/x-cpio",
    "application/x-lz4",
    "application/x-lzip",
    "application/x-lzma",
    "application/x-tar",
    "application/x-xz",
    "application/zstd",
  ].includes(mimeType)) return fileTypeById("compressed-archive");
  if ([
    "application/pkcs10", "application/pkcs12", "application/pkcs7-mime", "application/pkcs7-signature",
    "application/pkcs8", "application/pkix-cert", "application/x-java-keystore", "application/x-x509-ca-cert",
  ].includes(mimeType)) return fileTypeById("credential");
  if ([
    "application/avro", "application/cbor", "application/msgpack", "application/vnd.apache.parquet",
    "application/vnd.sqlite3", "application/vnd.tcpdump.pcap", "application/x-hdf5", "model/gltf-binary",
  ].includes(mimeType)) return fileTypeById("data-binary");
  if (["application/vnd.apple.coreml.model", "application/x-tensorflow-lite"].includes(mimeType)) return fileTypeById("model");
  if (mimeType.startsWith("font/")) return fileTypeById("font");
  if (mimeType === "application/wasm") return fileTypeById("executable");
  return null;
}

export function getFileExtension(value: string | FileReferenceLike): string {
  const candidate = fileReferenceCandidates(value)[0] ?? "";
  return fileExtensionFromCandidate(candidate, candidateHasUrlSuffix(candidate, value));
}

export function resolveFileType(value: string | FileReferenceLike): ResolvedFileType {
  const pathResolution = resolvePathFileType(value);
  const { definition: pathDefinition, extension } = pathResolution;
  const mimeType = fileReferenceMimeType(value);
  const mimeDefinition = fileTypeFromMimeType(mimeType);

  if (pathResolution.conflict || fileReferenceHasMimeConflict(value)) {
    return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
  }

  if (pathDefinition && mimeDefinition) {
    const mediaConflict = (pathDefinition.kind === "audio" || pathDefinition.kind === "video")
      && (mimeDefinition.kind === "audio" || mimeDefinition.kind === "video")
      && pathDefinition.kind !== mimeDefinition.kind;
    if (mediaConflict) {
      if (extension === "webm" && mimeType === "audio/webm") {
        return { ...mimeDefinition, extension, known: true };
      }
      return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
    }
    if (pathDefinition.previewKind === "archive" && mimeDefinition.id === "zip-archive") {
      return { ...pathDefinition, extension, known: true };
    }
    if (pathDefinition.readMode === "text" && mimeDefinition.readMode === "text") {
      if (mimeType === "text/plain" || pathDefinition.previewKind === mimeDefinition.previewKind) {
        return { ...pathDefinition, extension, known: true };
      }
      return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
    }
    if (
      pathDefinition.kind !== mimeDefinition.kind
      || pathDefinition.previewKind !== mimeDefinition.previewKind
      || pathDefinition.readMode !== mimeDefinition.readMode
    ) {
      return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
    }
  }

  if (pathDefinition && mimeType && mimeType !== "application/octet-stream" && !mimeDefinition) {
    return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
  }

  if (!pathDefinition && mimeType && mimeType !== "application/octet-stream" && !mimeDefinition) {
    return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: true };
  }

  const definition = pathDefinition ?? mimeDefinition;
  if (definition) return { ...definition, extension, known: true };
  return { ...UNKNOWN_BINARY_FILE_TYPE, extension, known: false };
}

export function shouldReadFileAsBytes(value: string | FileReferenceLike): boolean {
  return resolveFileType(value).readMode === "bytes";
}

export function isFileTypeReference(value: string | FileReferenceLike, kind: FileTypeKind): boolean {
  const resolvedFileType = resolveFileType(value);
  return resolvedFileType.known && resolvedFileType.kind === kind;
}

export function isImageFileReference(value: string | FileReferenceLike): boolean {
  const resolvedFileType = resolveFileType(value);
  return resolvedFileType.known && resolvedFileType.previewKind === "image";
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
  const resolvedFileType = resolveFileType(value);
  return resolvedFileType.known && resolvedFileType.previewKind !== "image";
}

export function inferFileMimeType(value: string | FileReferenceLike, fallback = "application/octet-stream"): string {
  const fileType = resolveFileType(value);
  if (fileType.id === UNKNOWN_BINARY_FILE_TYPE.id && fileType.known) return fallback;
  const mimeType = fileReferenceMimeType(value);
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  return fileType.mimeTypes?.[fileType.extension] ?? fileType.mimeType ?? fallback;
}

export function decodeUtf8FileContent(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let disallowedControls = 0;
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (
        (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13)
        || (code >= 0x7f && code <= 0x9f)
      ) {
        disallowedControls += 1;
      }
    }
    return disallowedControls > 0 ? null : text;
  } catch {
    return null;
  }
}

const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;

export function isFileByteContent(value: unknown): value is Uint8Array {
  if (value instanceof Uint8Array) return true;
  if (!ArrayBuffer.isView(value) || !typedArrayTagGetter) return false;
  try {
    return typedArrayTagGetter.call(value) === "Uint8Array";
  } catch {
    return false;
  }
}

export function knownFileExtensionsPattern(): string {
  return KNOWN_FILE_EXTENSIONS
    .slice()
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join("|");
}
