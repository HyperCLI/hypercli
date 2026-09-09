// Browser stand-in for the Node `crypto` builtin.
//
// ts-sdk statically imports `randomFillSync` (agents.ts) and only calls it when
// `globalThis.crypto.getRandomValues` is missing. The Web Crypto API is always
// present in a webview, so this is reachable only in exotic cases — but the
// static import still has to resolve.
export function randomFillSync<T extends ArrayBufferView>(buffer: T): T {
  const view = new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
  globalThis.crypto.getRandomValues(view);
  return buffer;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export default { randomFillSync, randomUUID };
