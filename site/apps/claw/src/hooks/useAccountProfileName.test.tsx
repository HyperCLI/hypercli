import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return { user: { get: sdkMocks.get } };
  }),
}));

import { useAccountProfileName } from "./useAccountProfileName";

describe("useAccountProfileName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.get.mockResolvedValue({ name: "Sam Rivera" });
  });

  it("loads the editable profile name and supports immediate updates", async () => {
    const getToken = vi.fn(async () => "token");
    const { result } = renderHook(() => useAccountProfileName({
      enabled: true,
      getToken,
      userId: "stored-session",
    }));

    await waitFor(() => expect(result.current.name).toBe("Sam Rivera"));
    expect(getToken).toHaveBeenCalledOnce();
    expect(sdkMocks.get).toHaveBeenCalledOnce();

    act(() => result.current.setName("Alex Morgan"));
    expect(result.current.name).toBe("Alex Morgan");
  });

  it("does not substitute another identity field when name is empty", async () => {
    sdkMocks.get.mockResolvedValue({ name: null, username: "not-the-name" });
    const getToken = vi.fn(async () => "token");
    const { result } = renderHook(() => useAccountProfileName({
      enabled: true,
      getToken,
      userId: "user-1",
    }));

    await waitFor(() => expect(sdkMocks.get).toHaveBeenCalledOnce());
    expect(result.current.name).toBeNull();
  });
});
