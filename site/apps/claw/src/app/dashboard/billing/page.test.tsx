import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: mocks.getToken }),
}));

vi.mock("@/components/billing/ProfileBillingSection", () => ({
  ProfileBillingSection: ({ getToken }: { getToken: () => Promise<string> }) => (
    <section data-token-getter={getToken === mocks.getToken ? "account" : "unknown"}>Billing details</section>
  ),
}));

import BillingPage from "./page";

describe("BillingPage", () => {
  it("renders billing as a standalone account page", () => {
    render(<BillingPage />);

    expect(screen.getByText("Billing details")).toHaveAttribute("data-token-getter", "account");
    expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
  });
});
