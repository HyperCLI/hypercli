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

  it("does not let an older profile request overwrite a mutation", async () => {
    let resolveProfileImage!: (value: { avatarUrl: string }) => void;
    sdkMocks.getProfileImage.mockReturnValueOnce(new Promise((resolve) => {
      resolveProfileImage = resolve;
    }));
    const getToken = vi.fn(async () => "token");
    const { result } = renderHook(() => useAccountProfileAvatar({
      enabled: true,
      getToken,
      userId: "user-1",
    }));

    await waitFor(() => expect(sdkMocks.getProfileImage).toHaveBeenCalledOnce());
    act(() => result.current.setAvatarUrl("https://cdn.example.test/replacement.png"));
    await act(async () => {
      resolveProfileImage({ avatarUrl: "https://cdn.example.test/old.png" });
      await Promise.resolve();
    });

    expect(result.current.avatarUrl).toBe("https://cdn.example.test/replacement.png");
  });

  it("uses fresh local bytes when an upload reuses the canonical URL", async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:fresh-account-avatar");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });

    let getToken = vi.fn(async () => "token");
    const { result, rerender, unmount } = renderHook(() => useAccountProfileAvatar({
      enabled: true,
      getToken,
      userId: "user-1",
    }));
    await waitFor(() => expect(result.current.avatarUrl).toBe("https://cdn.example.test/profile.png"));
    const file = new File(["new avatar"], "avatar.png", { type: "image/png" });

    act(() => result.current.setAvatarUrl("https://cdn.example.test/profile.png", file));
    expect(result.current.avatarUrl).toBe("blob:fresh-account-avatar");
    expect(createObjectUrl).toHaveBeenCalledWith(file);
    getToken = vi.fn(async () => "refreshed-token");
    rerender();
    expect(result.current.avatarUrl).toBe("blob:fresh-account-avatar");
    expect(sdkMocks.getProfileImage).toHaveBeenCalledOnce();
    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:fresh-account-avatar");

    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl });
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
});
