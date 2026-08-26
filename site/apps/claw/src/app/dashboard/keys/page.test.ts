import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import KeysPage from "./page";

describe("dashboard API keys route", () => {
  it("redirects to the guarded canonical settings surface", () => {
    KeysPage();

    expect(redirect).toHaveBeenCalledWith("/dashboard/agents?view=settings&settings=api-keys");
  });
});
