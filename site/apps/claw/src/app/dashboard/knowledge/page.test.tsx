import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  knowledgeHubAvailable: false,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/dashboard-release-boundary", () => ({
  isDashboardReleaseSurfaceAvailable: () => mocks.knowledgeHubAvailable,
}));

import SharedKnowledgeRedirectPage from "./page";

describe("SharedKnowledgeRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.knowledgeHubAvailable = false;
  });

  it("redirects to the Agents dashboard while Shared knowledge is unavailable", async () => {
    await SharedKnowledgeRedirectPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("preserves Agent selection without entering Shared knowledge while unavailable", async () => {
    await SharedKnowledgeRedirectPage({
      searchParams: Promise.resolve({ focusAgent: "agent docs", session: "agent:docs:main" }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?agentId=agent+docs&session=agent%3Adocs%3Amain",
    );
  });

  it("drops stale Collection query params while Shared knowledge is unavailable", async () => {
    // A bookmarked legacy URL may still carry collectionId/domainId. While the
    // surface is hidden the redirect must not forward Collection state into the
    // Agents dashboard URL, only the (safe) Agent focus.
    await SharedKnowledgeRedirectPage({
      searchParams: Promise.resolve({
        collectionId: "collection-1",
        domainId: "legacy-domain-1",
        agentId: "agent-9",
      }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?agentId=agent-9");
  });

  it("preserves the dormant Shared knowledge redirect when the surface is available", async () => {
    mocks.knowledgeHubAvailable = true;

    await SharedKnowledgeRedirectPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?section=knowledge");
  });

  it("keeps the dormant redirect Collection-free when the surface is available", async () => {
    // Dormant behavior: the Shared knowledge section resolves its Collection
    // from the Workspace provider catalog, not from legacy URL params, so
    // collectionId/domainId stay dropped even when the surface is enabled.
    mocks.knowledgeHubAvailable = true;

    await SharedKnowledgeRedirectPage({
      searchParams: Promise.resolve({
        collectionId: "collection-1",
        domainId: "legacy-domain-1",
      }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?section=knowledge");
  });
});
