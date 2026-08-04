import { describe, expect, it, vi } from "vitest";

import { agentAvatar, agentProfileImageUrl, randomAgentAvatarIconIndex } from "./avatar";

describe("randomAgentAvatarIconIndex", () => {
  it("maps secure random values to the available icons", () => {
    const getRandomValuesSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 31;
      return array;
    });

    expect(randomAgentAvatarIconIndex()).toBe(15);

    getRandomValuesSpy.mockRestore();
  });
});

describe("agentProfileImageUrl", () => {
  it("prefers the hydrated profile image", () => {
    expect(agentProfileImageUrl({
      avatarUrl: " https://cdn.example.com/profile.png ",
      displayIdentity: { avatar_url: "https://cdn.example.com/identity.png" },
    })).toBe("https://cdn.example.com/profile.png");
  });

  it("falls back to the display identity image", () => {
    expect(agentProfileImageUrl({
      avatarUrl: null,
      displayIdentity: { avatar_url: "https://cdn.example.com/identity.png" },
    })).toBe("https://cdn.example.com/identity.png");
  });

  it("ignores missing and invalid image values", () => {
    expect(agentProfileImageUrl({ avatarUrl: " ", displayIdentity: { avatar_url: 42 } })).toBeNull();
    expect(agentProfileImageUrl(null)).toBeNull();
  });
});

describe("agentAvatar", () => {
  it("prefers the profile image over the metadata image", () => {
    const avatar = agentAvatar(
      "Ada",
      { ui: { avatar: { image: "https://cdn.example.com/meta.png" } } },
      "https://cdn.example.com/profile.png",
    );

    expect(avatar.imageUrl).toBe("https://cdn.example.com/profile.png");
  });

  it("keeps the metadata image as a fallback", () => {
    const avatar = agentAvatar(
      "Ada",
      { ui: { avatar: { image: "https://cdn.example.com/meta.png" } } },
      null,
    );

    expect(avatar.imageUrl).toBe("https://cdn.example.com/meta.png");
  });
});
