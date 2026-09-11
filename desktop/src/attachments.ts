// Only fileTypeFromBlob is webview-safe. fileTypeFromFile/fileTypeFromStream
// pull node:fs/promises via dynamic import — they minify into the bundle
// regardless and throw if ever called from the webview. Do not import them.
import { fileTypeFromBlob } from "file-type";
import type { MessageAttachment } from "./chat-trace";

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
};

function extensionMimeType(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? null;
}

/**
 * Read a dropped/pasted/picked File into a chat attachment. macOS clipboard
 * pastes arrive with an empty File.type; without detection the attachment
 * goes out as application/octet-stream, which ACP agents reject and (in
 * opencode) leave the session refusing further turns. Sniff magic bytes via
 * file-type, then fall back to the filename extension, and only then to
 * octet-stream for genuinely unknown binary.
 */
export async function readAttachment(file: File): Promise<MessageAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  const dataBase64 = btoa(binary);
  let mimeType = file.type;
  if (!mimeType) {
    const detected = await fileTypeFromBlob(file.slice(0, 4100));
    mimeType = detected?.mime ?? extensionMimeType(file.name) ?? "application/octet-stream";
  }
  return {
    name: file.name || "attachment",
    mimeType,
    dataBase64,
  };
}
