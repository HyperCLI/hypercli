import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import Home from "./page";

describe("Claw root page", () => {
  beforeEach(() => {
    mocks.redirect.mockReset();
  });

  it("redirects to the agents dashboard", async () => {
    await Home({
      searchParams: Promise.resolve({}),
    });

    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("preserves incoming handoff parameters", async () => {
    await Home({
      searchParams: Promise.resolve({
        intent: "trial",
        plan: "team",
        tag: ["one", "two"],
      }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/agents?intent=trial&plan=team&tag=one&tag=two",
    );
  });
});
