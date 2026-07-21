import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import SharedKnowledgeRedirectPage from "./page";

describe("SharedKnowledgeRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to the embedded agents section", async () => {
    await SharedKnowledgeRedirectPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?section=knowledge");
  });

  it("preserves the focused agent as the agents-page selection", async () => {
    await SharedKnowledgeRedirectPage({
      searchParams: Promise.resolve({ focusAgent: "agent docs", session: "agent:docs:main" }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?section=knowledge&agentId=agent+docs&session=agent%3Adocs%3Amain",
    );
  });
});
