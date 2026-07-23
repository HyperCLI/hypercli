import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import UsageRedirectPage from "./page";

describe("UsageRedirectPage", () => {
  it("redirects to the persistent usage view", async () => {
    await UsageRedirectPage({ searchParams: Promise.resolve({ agentId: "agent-1" }) });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?view=usage&agentId=agent-1",
    );
  });
});
