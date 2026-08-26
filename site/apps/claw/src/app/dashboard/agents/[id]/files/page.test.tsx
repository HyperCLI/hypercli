import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import AgentFilesRedirectPage from "./page";

describe("AgentFilesRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to the canonical gated Files tab", async () => {
    await AgentFilesRedirectPage({
      params: Promise.resolve({ id: "agent/one" }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?agentId=agent%2Fone&tab=files",
    );
  });

  it("preserves a deep-linked workspace file", async () => {
    await AgentFilesRedirectPage({
      params: Promise.resolve({ id: "agent-1" }),
      searchParams: Promise.resolve({ file: " notes/launch plan.md " }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?agentId=agent-1&tab=files&file=notes%2Flaunch+plan.md",
    );
  });
});
