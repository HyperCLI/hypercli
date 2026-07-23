import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import DashboardRedirectPage from "./page";

describe("DashboardRedirectPage", () => {
  it("redirects legacy overview links and preserves agent selection", async () => {
    await DashboardRedirectPage({
      searchParams: Promise.resolve({ agentId: "agent one", session: "focus" }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?view=overview&agentId=agent+one&session=focus",
    );
  });
});
