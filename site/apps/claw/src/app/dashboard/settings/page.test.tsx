import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  user: {
    id: "user-1234567890abcdef",
    email: "john@example.com",
    walletAddress: "0x1234567890abcdef",
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    user: authMocks.user,
    logout: authMocks.logout,
  }),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    authMocks.logout.mockClear();
  });

  it("opens the payment details modal from the billing payment manage action", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: /billing/i }));
    await user.click(screen.getByRole("button", { name: "Manage" }));

    expect(screen.getByRole("dialog", { name: "Update payment details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("john@example.com");

    await user.type(screen.getByLabelText("Card Number"), "4242 4242 4242 4242");
    expect(screen.getByLabelText("Card Number")).toHaveValue("4242 4242 4242 4242");
  });
});
