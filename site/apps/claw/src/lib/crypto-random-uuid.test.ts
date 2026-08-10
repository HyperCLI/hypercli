import { describe, expect, it, vi } from "vitest";

import { installCryptoRandomUUID } from "./crypto-random-uuid";

describe("installCryptoRandomUUID", () => {
  it("installs an RFC 4122 UUID v4 generator using getRandomValues", () => {
    let seed = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_byte, index) => {
        bytes[index] = seed + index;
      });
      seed += bytes.length;
      return bytes;
    });
    const cryptoApi = { getRandomValues } as unknown as Crypto;

    installCryptoRandomUUID(cryptoApi);

    expect(cryptoApi.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(cryptoApi.randomUUID()).not.toBe(cryptoApi.randomUUID());
    expect(getRandomValues).toHaveBeenCalledTimes(3);
  });

  it("preserves a native randomUUID implementation", () => {
    const randomUUID = vi.fn(() => "native-id") as unknown as Crypto["randomUUID"];
    const cryptoApi = {
      getRandomValues: vi.fn(),
      randomUUID,
    } as unknown as Crypto;

    installCryptoRandomUUID(cryptoApi);

    expect(cryptoApi.randomUUID()).toBe("native-id");
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(cryptoApi.getRandomValues).not.toHaveBeenCalled();
  });
});
