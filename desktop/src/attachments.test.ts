import { describe, expect, it } from "vitest";
import { readAttachment } from "./attachments";

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52]);
}

function untypedFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as unknown as BlobPart], name);
}

describe("readAttachment", () => {
  it("keeps a known browser-provided type", async () => {
    const file = new File([pngBytes() as unknown as BlobPart], "shot.png", { type: "image/png" });
    const attachment = await readAttachment(file);
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.name).toBe("shot.png");
    expect(attachment.dataBase64.length).toBeGreaterThan(0);
  });

  it("sniffs PNG from magic bytes when File.type is empty (macOS paste regression: ACP agents rejected octet-stream turns)", async () => {
    const attachment = await readAttachment(untypedFile(pngBytes(), "Screenshot 2026-09-11 at 6.45.03 PM.png"));
    expect(attachment.mimeType).toBe("image/png");
  });

  it("falls back to the filename extension for text formats file-type cannot detect", async () => {
    const bytes = new TextEncoder().encode("# hello\n");
    const attachment = await readAttachment(untypedFile(bytes, "notes.md"));
    expect(attachment.mimeType).toBe("text/markdown");
  });

  it("falls back to octet-stream only for genuinely unknown binary", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const attachment = await readAttachment(untypedFile(bytes, "blob"));
    expect(attachment.mimeType).toBe("application/octet-stream");
  });
});
