function uuidV4(cryptoApi: Pick<Crypto, "getRandomValues">): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function installCryptoRandomUUID(cryptoApi: Crypto | undefined = globalThis.crypto): void {
  if (!cryptoApi || typeof cryptoApi.randomUUID === "function") return;
  Object.defineProperty(cryptoApi, "randomUUID", {
    configurable: true,
    value: () => uuidV4(cryptoApi),
  });
}

installCryptoRandomUUID();
