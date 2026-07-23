import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import AgentsRedirectPage from "./page";

describe("AgentsRedirectPage", () => {
  it("redirects the root alias without dropping selection", async () => {
    await AgentsRedirectPage({
      searchParams: Promise.resolve({ agentId: "agent-1", session: "focus" }),
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?agentId=agent-1&session=focus",
    );
  });
});
