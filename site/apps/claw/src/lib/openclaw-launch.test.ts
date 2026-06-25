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
      env: { OPENCLAW_DESKTOP_ENABLED: "0" },
      openClawRoutes: { includeDesktop: false },
    });
  });

  it("launches desktop agents with the pro image and desktop route", () => {
    expect(buildOpenClawLaunchOptions({ desktopEnabled: true })).toEqual({
      image: "ghcr.io/hypercli/hypercli-openclaw:pro-prod",
      env: { OPENCLAW_DESKTOP_ENABLED: "1" },
      openClawRoutes: { includeDesktop: true },
    });
  });

  it("fails clearly when desktop is requested without a pro image", () => {
    delete process.env.NEXT_PUBLIC_OPENCLAW_PRO_IMAGE;

    expect(() => buildOpenClawLaunchOptions({ desktopEnabled: true })).toThrow(
      "NEXT_PUBLIC_OPENCLAW_PRO_IMAGE is required to launch desktop agents.",
    );
  });
});
