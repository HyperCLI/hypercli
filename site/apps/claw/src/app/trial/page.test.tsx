import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import TrialPage from "./page";

describe("TrialPage", () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
  });

  it("redirects legacy trial links to the dashboard overview", () => {
    TrialPage();

    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?view=overview");
  });
});
