import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: false },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: () => <div>HyperCLI</div>,
  PrivyLoginPanel: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div data-testid="login-panel" data-has-redirect={onSuccess ? "true" : "false"} />
  ),
}));

vi.mock("@/hooks/useClawAuth", () => ({
  useClawAuth: () => mocks.auth,
}));

import Home from "./page";

describe("Claw login page", () => {
  beforeEach(() => {
    mocks.auth = { isLoading: false, isAuthenticated: false };
    mocks.replace.mockReset();
    window.history.replaceState(null, "", "/");
  });

  it("lets authenticated state perform one direct agents redirect", async () => {
    mocks.auth = { isLoading: false, isAuthenticated: true };

    render(<Home />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledOnce();
    });
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/agents?view=overview");
  });

  it("preserves a Team trial handoff after authentication", async () => {
    window.history.replaceState(null, "", "/?intent=trial&plan=team");
    mocks.auth = { isLoading: false, isAuthenticated: true };

    render(<Home />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/trial");
    });
  });

  it("does not give the login panel a competing redirect", () => {
    render(<Home />);

    expect(screen.getByTestId("login-panel")).toHaveAttribute("data-has-redirect", "false");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
