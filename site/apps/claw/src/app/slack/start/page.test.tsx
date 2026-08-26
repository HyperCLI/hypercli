import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import SlackStartPage from "./page";

describe("SlackStartPage", () => {
  it("redirects direct visits to the guarded settings surface", () => {
    SlackStartPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/agents?view=settings");
  });
});
