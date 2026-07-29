import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  getProfileImage: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return {
      user: { getProfileImage: sdkMocks.getProfileImage },
    };
  }),
}));

import { useAccountProfileAvatar } from "./useAccountProfileAvatar";

describe("useAccountProfileAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.getProfileImage.mockResolvedValue({
      id: "user-1",
      avatarUrl: "https://cdn.example.test/profile.png",
      s3Key: "profile.png",
    });
  });

  it("loads the persisted profile avatar and supports immediate updates", async () => {
    const getToken = vi.fn(async () => "token");
    const { result } = renderHook(() => useAccountProfileAvatar({
      enabled: true,
      getToken,
      userId: "user-1",
    }));

    await waitFor(() => {
      expect(result.current.avatarUrl).toBe("https://cdn.example.test/profile.png");
    });
    expect(getToken).toHaveBeenCalledOnce();

    act(() => result.current.setAvatarUrl("https://cdn.example.test/replacement.png"));
    expect(result.current.avatarUrl).toBe("https://cdn.example.test/replacement.png");
  });
});
