import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowMock = vi.hoisted(() => ({ isFocused: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock,
}));

import { TauriAppFocusService } from "./app-focus";

describe("app focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports backgrounded when the Tauri window is not focused", async () => {
    windowMock.isFocused.mockResolvedValue(false);

    await expect(new TauriAppFocusService().isBackgrounded()).resolves.toBe(true);
  });

  it("falls back to document visibility when Tauri focus lookup fails", async () => {
    windowMock.isFocused.mockRejectedValue(new Error("permission denied"));
    vi.stubGlobal("document", { hidden: true });

    await expect(new TauriAppFocusService().isBackgrounded()).resolves.toBe(true);
  });

  it("defaults to foregrounded when no platform focus signal is available", async () => {
    windowMock.isFocused.mockRejectedValue(new Error("plugin unavailable"));

    await expect(new TauriAppFocusService().isBackgrounded()).resolves.toBe(false);
  });
});
