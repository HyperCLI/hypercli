import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    isAuthenticated: true,
    flowState: "idle",
    error: null as string | null,
    login: vi.fn(),
    getToken: vi.fn(),
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

import DesktopLoginPage from "./page";

describe("DesktopLoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.isLoading = false;
    mocks.auth.isAuthenticated = true;
    mocks.auth.flowState = "idle";
    mocks.auth.error = null;
    mocks.auth.getToken.mockRejectedValue(new Error("GET /token?code=private-code returned 503"));
    window.history.replaceState(null, "", "/desktop-login");
  });

  it("omits a rejected redirect value from the recovery state", async () => {
    window.history.replaceState(null, "", "/desktop-login?redirect_uri=https://attacker.example/callback?token=private");
    const { container } = render(<DesktopLoginPage />);

    expect(await screen.findByRole("heading", { name: "Restart sign-in from the desktop app" })).toBeVisible();
    expect(screen.queryByText(/attacker\.example/i)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("destructive");
  });

  it("hands the token to the app only after the user clicks", async () => {
    mocks.auth.getToken.mockResolvedValue("jwt-123");
    const realLocation = window.location;
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { search: "", replace: replaceSpy },
    });
    try {
      render(<DesktopLoginPage />);
      const openButton = await screen.findByRole("button", { name: "Open Backseat Driver" });
      expect(replaceSpy).not.toHaveBeenCalled();
      fireEvent.click(openButton);
      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(replaceSpy).toHaveBeenCalledWith("backseatdriver://auth#token=jwt-123");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: realLocation,
      });
    }
  });

  it("offers a retry without exposing the session endpoint error", async () => {
    render(<DesktopLoginPage />);

    expect(await screen.findByRole("heading", { name: "Retry to reopen the desktop session" })).toBeVisible();
    expect(screen.queryByText(/GET \/token/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.auth.getToken).toHaveBeenCalledTimes(2));
  });
});
