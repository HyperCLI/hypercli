import { describe, expect, it } from "vitest";

import {
  FILE_TYPE_DEFINITIONS,
  decodeUtf8FileContent,
  inferFileMimeType,
  isAudioFileReference,
  isArchiveFileReference,
  isFileByteContent,
  isImageFileReference,
  isKnownNonImageFileReference,
  isVideoFileReference,
  knownFileExtensionsPattern,
  resolveFileType,
  shouldReadFileAsBytes,
} from "@hypercli/shared-ui/files";

describe("shared file type registry", () => {
  it("resolves preview and read behavior from one registry", () => {
    expect(resolveFileType("src/app.tsx")).toMatchObject({ kind: "code", previewKind: "code", readMode: "text" });
    expect(resolveFileType("README.mdx")).toMatchObject({ kind: "markdown", previewKind: "markdown", readMode: "text" });
    expect(resolveFileType("public/index.html")).toMatchObject({ id: "html", kind: "code", previewKind: "html", readMode: "text" });
    expect(resolveFileType("screenshots/demo.PNG?cache=1")).toMatchObject({ kind: "image", previewKind: "image", readMode: "bytes" });
    expect(resolveFileType("archive.zip")).toMatchObject({ kind: "archive", previewKind: "archive", readMode: "bytes" });
    expect(resolveFileType("report.pdf")).toMatchObject({ kind: "document", previewKind: "pdf", readMode: "bytes" });
    expect(resolveFileType("samples/meeting-template.ICS?download=1")).toMatchObject({
      id: "calendar",
      label: "Calendar",
      kind: "calendar",
      previewKind: "text",
      readMode: "text",
      editable: true,
      iconKind: "calendar",
      known: true,
    });
  });

  it("keeps unknown files binary until their content is validated", () => {
    expect(resolveFileType("payload.custom-extension")).toMatchObject({ known: false, previewKind: "binary", readMode: "bytes", editable: false });
    expect(shouldReadFileAsBytes("payload.custom-extension")).toBe(true);
    expect(decodeUtf8FileContent(new TextEncoder().encode("plain UTF-8 text"))).toBe("plain UTF-8 text");
    expect(decodeUtf8FileContent(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(decodeUtf8FileContent(new Uint8Array([0xff, 0xfe]))).toBeNull();
    expect(decodeUtf8FileContent(new Uint8Array([1, 2]))).toBeNull();
    expect(decodeUtf8FileContent(new Uint8Array([0x7f]))).toBeNull();
    expect(decodeUtf8FileContent(new Uint8Array([0xc2, 0x80]))).toBeNull();
    expect(decodeUtf8FileContent(new Uint8Array([0xef, 0xbb, 0xbf, 0x74, 0x65, 0x78, 0x74]))).toBe("text");
    expect(resolveFileType("signing.key")).toMatchObject({ known: false, readMode: "bytes" });
    expect(resolveFileType("README.unknown")).toMatchObject({ known: false, readMode: "bytes" });
  });

  it("recognizes common native preview and code/data formats", () => {
    expect(resolveFileType("preview.avif")).toMatchObject({ previewKind: "image", readMode: "bytes" });
    expect(resolveFileType("recording.webm")).toMatchObject({ kind: "video", previewKind: "video" });
    expect(resolveFileType({ name: "recording.webm", mimeType: "audio/webm" })).toMatchObject({ kind: "audio", previewKind: "audio" });
    expect(resolveFileType("document.pdf")).toMatchObject({ previewKind: "pdf", editable: false });
    expect(resolveFileType("events.jsonl")).toMatchObject({ kind: "json", readMode: "text" });
    expect(resolveFileType("analysis.ipynb")).toMatchObject({ kind: "json", readMode: "text" });
    expect(resolveFileType("Makefile")).toMatchObject({ kind: "code", readMode: "text" });
    expect(resolveFileType(".env.local")).toMatchObject({ kind: "config", readMode: "text" });
    expect(resolveFileType("model.safetensors")).toMatchObject({ kind: "binary", editable: false });
  });

  it("recognizes common developer, config, and structured-text files", () => {
    const cases = [
      ["README.qmd", "markdown"],
      ["trace.sarif", "json"],
      ["src/types.d.mts", "code"],
      ["src/worker.pyw", "code"],
      ["CMakeLists.txt", "code"],
      ["Dockerfile.production", "code"],
      ["go.mod", "config"],
      ["requirements-dev.txt", "config"],
      [".zshrc", "config"],
      ["captions.ttml", "text"],
      ["contact.vcf", "text"],
      ["playlist.m3u8", "text"],
      ["availability.ifb", "calendar"],
    ] as const;

    for (const [path, kind] of cases) {
      expect(resolveFileType(path), path).toMatchObject({ kind, readMode: "text", known: true });
    }
    expect(inferFileMimeType("trace.sarif")).toBe("application/sarif+json");
    expect(inferFileMimeType("src/app.js.map")).toBe("application/json");
    expect(inferFileMimeType("captions.ttml")).toBe("application/ttml+xml");
    expect(isAudioFileReference("playlist.m3u8")).toBe(false);
  });

  it("recognizes ZIP-compatible packages without reclassifying Office documents", () => {
    for (const path of ["app.apk", "library.jar", "plugin.vsix", "bundle.whl", "comic.cbz"]) {
      expect(resolveFileType(path), path).toMatchObject({ previewKind: "archive", readMode: "bytes", known: true });
    }
    expect(resolveFileType("arrays.npz")).toMatchObject({ id: "zip-data", kind: "binary", previewKind: "archive" });
    expect(resolveFileType({ name: "library.jar", mimeType: "application/zip" })).toMatchObject({ id: "zip-package", previewKind: "archive" });
    expect(resolveFileType({ name: "library.jar", mimeType: "application/java-archive" })).toMatchObject({ id: "zip-package", previewKind: "archive" });
    expect(resolveFileType("proposal.docx")).toMatchObject({ kind: "document", previewKind: "binary" });
    expect(resolveFileType({ name: "proposal.docx", mimeType: "application/zip" })).toMatchObject({ kind: "binary", previewKind: "binary" });
    expect(isArchiveFileReference("library.jar")).toBe(true);
    expect(isArchiveFileReference("proposal.docx")).toBe(false);
  });

  it("keeps Office and OpenDocument variants download-only", () => {
    const cases = [
      ["template.ott", "document"],
      ["master.odm", "document"],
      ["drawing.fodg", "document"],
      ["report.fodt", "document"],
      ["sheet.ots", "spreadsheet"],
      ["sheet.fods", "spreadsheet"],
      ["slides.otp", "presentation"],
      ["slides.fodp", "presentation"],
    ] as const;
    for (const [path, kind] of cases) {
      expect(resolveFileType(path), path).toMatchObject({ kind, previewKind: "binary", readMode: "bytes", editable: false });
    }
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.oasis.opendocument.spreadsheet-template" })).toMatchObject({ kind: "spreadsheet", readMode: "bytes" });
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.oasis.opendocument.presentation-flat-xml" })).toMatchObject({ kind: "presentation", readMode: "bytes" });
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.oasis.opendocument.graphics" })).toMatchObject({ kind: "document", readMode: "bytes" });
  });

  it("does not let special basenames override known binary suffixes", () => {
    for (const path of [".env.docx", "Dockerfile.exe", "Makefile.odt"]) {
      expect(resolveFileType(path), path).toMatchObject({ id: "unknown-binary", readMode: "bytes", editable: false, known: true });
    }
    expect(resolveFileType("CMakeLists.txt")).toMatchObject({ id: "code", readMode: "text" });
  });

  it("recognizes download-only binary, credential, and unsupported media families", () => {
    expect(resolveFileType("certificate.pem")).toMatchObject({ id: "credential-text", readMode: "text", editable: false });
    expect(resolveFileType("id_ed25519")).toMatchObject({ id: "credential-text", readMode: "text", editable: false });
    expect(resolveFileType("certificate.der")).toMatchObject({ id: "credential", readMode: "bytes" });
    expect(resolveFileType("capture.pcapng")).toMatchObject({ id: "data-binary", previewKind: "binary" });
    expect(resolveFileType("book.azw3")).toMatchObject({ kind: "document", previewKind: "binary" });
    expect(resolveFileType("photo.dng")).toMatchObject({ id: "unsupported-image", previewKind: "binary" });
    expect(resolveFileType("sound.caf")).toMatchObject({ id: "unsupported-audio", previewKind: "binary" });
    expect(resolveFileType("clip.m2ts")).toMatchObject({ id: "unsupported-video", previewKind: "binary" });
    expect(isImageFileReference("photo.dng")).toBe(false);
    expect(isAudioFileReference("sound.caf")).toBe(false);
    expect(isVideoFileReference("clip.m2ts")).toBe(false);
  });

  it("normalizes MIME parameters and fails closed on meaningful type conflicts", () => {
    expect(resolveFileType({ name: "payload", mimeType: "application/geo+json; charset=utf-8" })).toMatchObject({ kind: "json", readMode: "text" });
    expect(resolveFileType({ name: "notes.txt", mimeType: "application/octet-stream" })).toMatchObject({ kind: "text", readMode: "text", editable: true });
    expect(resolveFileType({ name: "README.md", mimeType: "text/plain" })).toMatchObject({ kind: "markdown", previewKind: "markdown", editable: true });
    expect(resolveFileType({ name: "README.md", mimeType: "application/javascript" })).toMatchObject({ id: "unknown-binary", previewKind: "binary" });
    expect(resolveFileType({ name: "app.ts", mimeType: "text/x-typescript" })).toMatchObject({ kind: "code", previewKind: "code", editable: true });
    expect(resolveFileType({ name: "page.html", mimeType: "text/html" })).toMatchObject({ id: "html", kind: "code", previewKind: "html", editable: true });
    expect(resolveFileType({ name: "upload", mimeType: "application/xhtml+xml" })).toMatchObject({ id: "html", previewKind: "html" });
    expect(resolveFileType({ name: "report.pdf", mimeType: "image/svg+xml" })).toMatchObject({ kind: "binary", previewKind: "binary", known: true });
    expect(resolveFileType({ name: "report.pdf", mimeType: "application/msword" })).toMatchObject({ kind: "binary", previewKind: "binary", known: true });
    expect(resolveFileType({ name: "report.pdf", mimeType: "application/xhtml+xml" })).toMatchObject({ kind: "binary", previewKind: "binary", known: true });
    expect(inferFileMimeType({ name: "report.pdf", mimeType: "image/svg+xml" })).toBe("application/octet-stream");
    expect(inferFileMimeType({ name: "document.pdf", mimeType: "application/pdf; charset=binary" })).toBe("application/pdf");
    expect(isImageFileReference({ name: "report.pdf", mimeType: "image/svg+xml" })).toBe(false);
    expect(resolveFileType({ name: "report", mimeType: "application/x-pdf" })).toMatchObject({ id: "pdf" });
    expect(inferFileMimeType({ name: "report", mimeType: "application/x-pdf" })).toBe("application/pdf");
    expect(resolveFileType({ name: "config", mimeType: "text/x-yaml" })).toMatchObject({ id: "config" });
    expect(resolveFileType({ name: "captions", mimeType: "application/ttml+xml" })).toMatchObject({ id: "text" });
    expect(inferFileMimeType({ name: "voice", mimeType: "audio/x-wav" })).toBe("audio/wav");
    expect(resolveFileType({ name: "song.mp3", mimeType: "video/mp4" })).toMatchObject({ id: "unknown-binary", previewKind: "binary" });
    expect(resolveFileType({ name: "upload", mimeType: "image/x-canon-cr2" })).toMatchObject({ id: "unknown-binary", known: true });
    expect(resolveFileType({ name: "upload", mimeType: "video/mp2t" })).toMatchObject({ id: "unsupported-video", previewKind: "binary" });
    expect(resolveFileType({ name: "upload", mimeType: "image/png", type: "image/jpeg" })).toMatchObject({ id: "unknown-binary", known: true });
    expect(resolveFileType({ name: "upload", mimeType: "audio/wave", type: "audio/wav" })).toMatchObject({ id: "audio" });
  });

  it("uses agreeing name/path metadata and fails closed when they disagree", () => {
    expect(resolveFileType({ name: "upload", path: "reports/final.pdf" })).toMatchObject({ id: "pdf", extension: "pdf" });
    expect(resolveFileType({ name: "final.pdf", path: "reports/final.pdf" })).toMatchObject({ id: "pdf" });
    expect(resolveFileType({ name: "final.txt", path: "reports/final.pdf" })).toMatchObject({ id: "unknown-binary", known: true });
    expect(resolveFileType({ name: "payload.svg#notes.txt" })).toMatchObject({ id: "text", extension: "txt" });
  });

  it("keeps registry ids and extensions unique", () => {
    const ids = FILE_TYPE_DEFINITIONS.map(({ id }) => id);
    const extensions = FILE_TYPE_DEFINITIONS.flatMap(({ extensions: values }) => values);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it("recognizes MIME-only Office and iWork files", () => {
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" })).toMatchObject({ kind: "spreadsheet" });
    expect(resolveFileType({ name: "upload", mimeType: "application/x-iwork-keynote-sffkey" })).toMatchObject({ kind: "presentation" });
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.apple.pages" })).toMatchObject({ kind: "document" });
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.apple.numbers" })).toMatchObject({ kind: "spreadsheet" });
    expect(resolveFileType({ name: "upload", mimeType: "application/vnd.apple.keynote" })).toMatchObject({ kind: "presentation" });
    expect(resolveFileType({ name: "photo.heic", mimeType: "image/heic" })).toMatchObject({ id: "unsupported-image", previewKind: "binary" });
  });

  it("accepts only Uint8Array byte views", () => {
    expect(isFileByteContent(new Uint8Array([1, 2]))).toBe(true);
    expect(isFileByteContent(new Uint8ClampedArray([1, 2]))).toBe(false);
    expect(isFileByteContent(new Int8Array([1, 2]))).toBe(false);
    expect(isFileByteContent(new DataView(new ArrayBuffer(2)))).toBe(false);
    expect(isFileByteContent({ [Symbol.toStringTag]: "Uint8Array" })).toBe(false);
    const taggedDataView = new DataView(new ArrayBuffer(2));
    Object.defineProperty(taggedDataView, Symbol.toStringTag, { value: "Uint8Array" });
    expect(isFileByteContent(taggedDataView)).toBe(false);
  });

  it("infers MIME types and media predicates from extensions or explicit MIME types", () => {
    expect(inferFileMimeType("photo.jpg")).toBe("image/jpeg");
    expect(inferFileMimeType("book.epub")).toBe("application/epub+zip");
    expect(inferFileMimeType("neutral-sample.ics")).toBe("text/calendar");
    expect(inferFileMimeType("voice.mp3")).toBe("audio/mpeg");
    expect(isImageFileReference({ path: "output/no-extension", type: "image/png" })).toBe(true);
    expect(resolveFileType({ name: "calendar-data", type: "text/calendar" })).toMatchObject({ id: "calendar", kind: "calendar" });
    expect(isAudioFileReference("https://cdn.example.test/final.wav?download=1")).toBe(true);
    expect(isAudioFileReference({ path: "https://cdn.example.test/final.wav?token=signed" })).toBe(true);
  });

  it("separates renderable images from known non-image file references", () => {
    expect(isKnownNonImageFileReference("https://example.test/preview.png")).toBe(false);
    expect(isKnownNonImageFileReference("https://example.test/report.pdf")).toBe(true);
    expect(isKnownNonImageFileReference("https://example.test/fake-schedule.ics")).toBe(true);
    expect(isKnownNonImageFileReference("https://example.test/src/app.tsx")).toBe(true);
    expect(isImageFileReference("https://example.test/photo.heic")).toBe(false);
    expect(isKnownNonImageFileReference("https://example.test/photo.heic")).toBe(true);
  });

  it("exposes a regex fragment for markdown file mention linkification", () => {
    const fileMentionPattern = new RegExp(`\\.(?:${knownFileExtensionsPattern()})$`, "i");

    expect(fileMentionPattern.test("src/app.tsx")).toBe(true);
    expect(fileMentionPattern.test("README.mdx")).toBe(true);
    expect(fileMentionPattern.test("archive.zip")).toBe(true);
    expect(fileMentionPattern.test("fake-calendar.ics")).toBe(true);
    expect(fileMentionPattern.test("no-extension")).toBe(false);
  });
});
