import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import SettingsRedirectPage from "./page";

describe("SettingsRedirectPage", () => {
  it("preserves Slack OAuth results when redirecting to account settings", async () => {
    await SettingsRedirectPage({
      searchParams: Promise.resolve({
        integration: "slack",
        slack_oauth_ok: "true",
        slack_team_id: "T123",
      }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?view=settings&integration=slack&slack_oauth_ok=true&slack_team_id=T123",
    );
  });
});
