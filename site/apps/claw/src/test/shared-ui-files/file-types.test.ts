import { describe, expect, it } from "vitest";

import {
  inferFileMimeType,
  isAudioFileReference,
  isImageFileReference,
  isKnownNonImageFileReference,
  knownFileExtensionsPattern,
  resolveFileType,
  shouldReadFileAsBytes,
} from "@hypercli/shared-ui/files";

describe("shared file type registry", () => {
  it("resolves preview and read behavior from one registry", () => {
    expect(resolveFileType("src/app.tsx")).toMatchObject({ kind: "code", previewKind: "code", readMode: "text" });
    expect(resolveFileType("README.mdx")).toMatchObject({ kind: "markdown", previewKind: "markdown", readMode: "text" });
    expect(resolveFileType("screenshots/demo.PNG?cache=1")).toMatchObject({ kind: "image", previewKind: "image", readMode: "bytes" });
    expect(resolveFileType("archive.zip")).toMatchObject({ kind: "archive", previewKind: "archive", readMode: "bytes" });
    expect(resolveFileType("report.pdf")).toMatchObject({ kind: "document", previewKind: "binary", readMode: "bytes" });
  });

  it("keeps unknown files editable text by default", () => {
    expect(resolveFileType("notes.custom-extension")).toMatchObject({ known: false, previewKind: "text", readMode: "text", editable: true });
    expect(shouldReadFileAsBytes("notes.custom-extension")).toBe(false);
  });

  it("infers MIME types and media predicates from extensions or explicit MIME types", () => {
    expect(inferFileMimeType("photo.jpg")).toBe("image/jpeg");
    expect(inferFileMimeType("book.epub")).toBe("application/epub+zip");
    expect(inferFileMimeType("voice.mp3")).toBe("audio/mpeg");
    expect(isImageFileReference({ path: "output/no-extension", type: "image/png" })).toBe(true);
    expect(isAudioFileReference("https://cdn.example.test/final.wav?download=1")).toBe(true);
  });

  it("separates renderable images from known non-image file references", () => {
    expect(isKnownNonImageFileReference("https://example.test/preview.png")).toBe(false);
    expect(isKnownNonImageFileReference("https://example.test/report.pdf")).toBe(true);
    expect(isKnownNonImageFileReference("https://example.test/src/app.tsx")).toBe(true);
  });

  it("exposes a regex fragment for markdown file mention linkification", () => {
    const fileMentionPattern = new RegExp(`\\.(?:${knownFileExtensionsPattern()})$`, "i");

    expect(fileMentionPattern.test("src/app.tsx")).toBe(true);
    expect(fileMentionPattern.test("README.mdx")).toBe(true);
    expect(fileMentionPattern.test("archive.zip")).toBe(true);
    expect(fileMentionPattern.test("no-extension")).toBe(false);
  });
});
