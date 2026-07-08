import { beforeEach, describe, expect, it } from "vitest";

import { buildOpenClawLaunchOptions } from "./openclaw-launch";

describe("buildOpenClawLaunchOptions", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:prod";
    process.env.NEXT_PUBLIC_OPENCLAW_PRO_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-prod";
  });

  it("launches headless agents with only the root gateway route", () => {
    expect(buildOpenClawLaunchOptions({ desktopEnabled: false })).toEqual({
      image: "ghcr.io/hypercli/hypercli-openclaw:prod",
      env: {
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        OPENCLAW_DESKTOP_ENABLED: "0",
      },
      memoryIndex: null,
      openClawRoutes: { includeDesktop: false },
    });
  });

  it("launches desktop agents with the pro image and desktop route", () => {
    expect(buildOpenClawLaunchOptions({ desktopEnabled: true })).toEqual({
      image: "ghcr.io/hypercli/hypercli-openclaw:pro-prod",
      env: {
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        OPENCLAW_DESKTOP_ENABLED: "1",
      },
      memoryIndex: null,
      openClawRoutes: { includeDesktop: true },
    });
  });

  it("uses a custom image override when provided", () => {
    expect(buildOpenClawLaunchOptions({
      desktopEnabled: true,
      customImage: "ghcr.io/acme/openclaw:desktop",
    })).toMatchObject({
      image: "ghcr.io/acme/openclaw:desktop",
      env: {
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        OPENCLAW_DESKTOP_ENABLED: "1",
      },
      openClawRoutes: { includeDesktop: true },
    });
  });

  it("allows desktop custom images even when the pro default image is not configured", () => {
    delete process.env.NEXT_PUBLIC_OPENCLAW_PRO_IMAGE;

    expect(buildOpenClawLaunchOptions({
      desktopEnabled: true,
      customImage: "ghcr.io/acme/openclaw:desktop",
    })).toMatchObject({
      image: "ghcr.io/acme/openclaw:desktop",
      openClawRoutes: { includeDesktop: true },
    });
  });

  it("passes memory index launch overrides as env", () => {
    expect(buildOpenClawLaunchOptions({
      desktopEnabled: false,
      memoryIndex: {
        onSessionStart: true,
        onSearch: true,
        watch: true,
        watchDebounceMs: 60000,
        intervalMinutes: 120,
      },
    })).toMatchObject({
      env: {
        OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "120",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: "60000",
      },
    });
  });

  it("fails clearly when desktop is requested without a pro image", () => {
    delete process.env.NEXT_PUBLIC_OPENCLAW_PRO_IMAGE;

    expect(() => buildOpenClawLaunchOptions({ desktopEnabled: true })).toThrow(
      "NEXT_PUBLIC_OPENCLAW_PRO_IMAGE is required to launch desktop agents.",
    );
  });
});
