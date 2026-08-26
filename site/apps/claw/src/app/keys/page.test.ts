import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import KeysRootPage from "./page";

describe("API keys root route", () => {
  it("redirects to the guarded canonical settings surface", () => {
    KeysRootPage();

    expect(redirect).toHaveBeenCalledWith("/dashboard/agents?view=settings&settings=api-keys");
  });
});
