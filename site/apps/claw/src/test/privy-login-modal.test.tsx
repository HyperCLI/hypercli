import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrivyLoginModal } from "../../../../packages/shared-ui/src/components/PrivyLogin";

const mocks = vi.hoisted(() => ({
  isModalOpen: false,
  login: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => {
    mocks.usePrivy();
    return {
      ready: true,
      authenticated: false,
      isModalOpen: mocks.isModalOpen,
      login: mocks.login,
      getAccessToken: vi.fn(),
    };
  },
}));

vi.mock("@turnkey/react-wallet-kit", () => ({
  useTurnkey: () => ({ handleLogin: vi.fn() }),
}));

describe("PrivyLoginModal", () => {
  beforeEach(() => {
    mocks.isModalOpen = false;
    mocks.login.mockReset();
    mocks.usePrivy.mockReset();
  });

  it("does not require Privy context while closed", () => {
    render(<PrivyLoginModal isOpen={false} onClose={vi.fn()} />);

    expect(mocks.usePrivy).not.toHaveBeenCalled();
  });

  it("keeps its state mounted without intercepting the active Privy modal", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PrivyLoginModal isOpen onClose={onClose} />);
    const loginButton = screen.getByRole("button", { name: "Login with Privy" });
    const overlay = screen.getByRole("button", { name: "Close login modal" }).closest(".fixed");

    expect(overlay).not.toBeNull();
    expect(overlay).not.toHaveClass("invisible", "pointer-events-none");

    mocks.isModalOpen = true;
    rerender(<PrivyLoginModal isOpen onClose={onClose} />);

    expect(overlay).toHaveAttribute("inert");
    expect(overlay).toHaveClass("invisible", "pointer-events-none");
    expect(overlay).toContainElement(loginButton);
  });
});
