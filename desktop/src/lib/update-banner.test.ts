import { describe, expect, it, vi } from "vitest";
import {
  UPDATE_DISMISS_KEY,
  dismissUpdateBanner,
  dismissedUpdateVersion,
  isNewerVersion,
  subscribeUpdateBannerDismissals,
  updateBannerVisible,
  type StorageLike,
} from "./update-banner";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("updateBannerVisible", () => {
  it("is hidden by default when no update is available", () => {
    expect(
      updateBannerVisible({ availableVersion: null, currentVersion: "0.2.3", dismissedVersion: null }),
    ).toBe(false);
  });

  it("shows when the available version is newer than the running build", () => {
    expect(
      updateBannerVisible({ availableVersion: "0.3.0", currentVersion: "0.2.3", dismissedVersion: null }),
    ).toBe(true);
  });

  it("does not show for an older or equal available version", () => {
    expect(
      updateBannerVisible({ availableVersion: "0.2.3", currentVersion: "0.2.3", dismissedVersion: null }),
    ).toBe(false);
    expect(
      updateBannerVisible({ availableVersion: "0.2.2", currentVersion: "0.2.3", dismissedVersion: null }),
    ).toBe(false);
  });

  it("shows when the running version is not yet known", () => {
    expect(
      updateBannerVisible({ availableVersion: "0.3.0", currentVersion: null, dismissedVersion: null }),
    ).toBe(true);
  });

  it("hides a dismissed version", () => {
    expect(
      updateBannerVisible({ availableVersion: "0.3.0", currentVersion: "0.2.3", dismissedVersion: "0.3.0" }),
    ).toBe(false);
  });

  it("re-shows for a newer version after an earlier dismissal", () => {
    expect(
      updateBannerVisible({ availableVersion: "0.3.1", currentVersion: "0.2.3", dismissedVersion: "0.3.0" }),
    ).toBe(true);
  });
});

describe("isNewerVersion", () => {
  it("compares numeric triplets", () => {
    expect(isNewerVersion("0.3.0", "0.2.3")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.2.3", "0.2.3")).toBe(false);
    expect(isNewerVersion("0.2.2", "0.2.3")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("treats differing unparseable strings as newer, equal ones as not", () => {
    expect(isNewerVersion("nightly-b", "nightly-a")).toBe(true);
    expect(isNewerVersion("nightly-a", "nightly-a")).toBe(false);
  });
});

describe("dismissal persistence", () => {
  it("round-trips the dismissed version through storage", () => {
    const storage = memoryStorage();
    expect(dismissedUpdateVersion(storage)).toBeNull();
    dismissUpdateBanner("0.3.0", storage);
    // A fresh read simulates a remount/restart: the dismissal persists.
    expect(dismissedUpdateVersion(storage)).toBe("0.3.0");
    expect(storage.data.get(UPDATE_DISMISS_KEY)).toBe("0.3.0");
  });

  it("overwrites an older dismissal with the newly dismissed version", () => {
    const storage = memoryStorage({ [UPDATE_DISMISS_KEY]: "0.3.0" });
    dismissUpdateBanner("0.3.1", storage);
    expect(dismissedUpdateVersion(storage)).toBe("0.3.1");
  });

  it("notifies subscribers on dismiss", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUpdateBannerDismissals(listener);
    dismissUpdateBanner("0.3.0", memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    dismissUpdateBanner("0.3.1", memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
