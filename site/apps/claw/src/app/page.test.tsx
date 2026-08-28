import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

import Home from "./page";

describe("Claw root page", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.searchParams = new URLSearchParams();
  });

  it("redirects to the agents dashboard", async () => {
    render(<Home />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledOnce();
    });
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("preserves incoming handoff parameters", async () => {
    mocks.searchParams = new URLSearchParams([
      ["intent", "trial"],
      ["plan", "team"],
      ["tag", "one"],
      ["tag", "two"],
    ]);

    render(<Home />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        "/dashboard/agents?intent=trial&plan=team&tag=one&tag=two",
      );
    });
  });
});
