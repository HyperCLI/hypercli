function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function downloadFileBytes(fileName: string, bytes: Uint8Array, mimeType = "application/octet-stream"): void {
  const blobUrl = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: mimeType }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName || "download";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
