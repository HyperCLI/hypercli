import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { allowConsoleError } from "@/test/setup";
import TrialPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: {
    getToken: vi.fn().mockResolvedValue("token"),
    isAuthenticated: true,
    isLoading: false,
    user: { id: "user-1" },
  },
  startTrial: vi.fn().mockResolvedValue({
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_trial",
    checkoutSessionId: "cs_trial",
    checkoutAttemptId: "attempt-trial",
  }),
  writePendingPlanCheckout: vi.fn(),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/lib/trial-checkout", () => ({
  startTrial: mocks.startTrial,
}));

vi.mock("@/lib/plan-checkout-state", () => ({
  createPlanCheckoutAttemptId: () => "attempt-local",
  createTeamTrialCheckoutState: async (
    client: { startTrial: (request: unknown) => Promise<unknown> },
    request: unknown,
    options: { principalId: string; checkoutAttemptId?: string | null },
  ) => ({
    checkout: await client.startTrial(request),
    pending: {
      principalId: options.principalId,
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 10,
      checkoutAttemptId: options.checkoutAttemptId ?? undefined,
      flow: "team-trial",
    },
  }),
  writePendingPlanCheckout: mocks.writePendingPlanCheckout,
}));

vi.mock("@/components/dashboard/DashboardShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/trial/TeamTrialActivationDialog", () => ({
  TeamTrialActivationDialog: ({ open, onStartTrial }: { open: boolean; onStartTrial: () => void }) => open
    ? <button type="button" onClick={onStartTrial}>Start 7-day free trial</button>
    : null,
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: () => <div>HyperCLI</div>,
  PrivyLoginPanel: () => <div>Login</div>,
  RecoveryState: ({ id, title, description, primaryAction }: {
    id?: string;
    title: ReactNode;
    description: ReactNode;
    primaryAction?: { label: ReactNode; onAction: () => void };
  }) => (
    <section id={id} role="alert">
      <h3>{title}</h3>
      <p>{description}</p>
      {primaryAction ? <button onClick={primaryAction.onAction}>{primaryAction.label}</button> : null}
    </section>
  ),
}));

describe("TrialPage", () => {
  beforeEach(() => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.user = { id: "user-1" };
    mocks.auth.getToken.mockClear();
    mocks.startTrial.mockClear();
    mocks.writePendingPlanCheckout.mockClear();
    Object.defineProperty(window, "location", {
      value: { ...window.location, href: "http://localhost/trial" },
      writable: true,
    });
  });

  it("starts a Stripe-backed trial checkout", async () => {
    render(<TrialPage />);

    const claimButton = screen.getByRole("button", { name: "Start free trial" });
    expect(claimButton).toHaveAttribute("id", "claim-trial-button");
    expect(claimButton).toHaveClass("claim-trial-button");
    fireEvent.click(claimButton);
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));

    await waitFor(() => expect(mocks.startTrial).toHaveBeenCalledOnce());
    expect(mocks.startTrial).toHaveBeenCalledWith("token", {
      successUrl: "http://localhost/dashboard/agents?checkout=success&checkout_attempt=attempt-local&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "http://localhost/dashboard/agents?checkout=cancelled&checkout_attempt=attempt-local",
    });
    expect(mocks.writePendingPlanCheckout).toHaveBeenCalledWith(expect.objectContaining({
      principalId: "user-1",
      planId: "team",
      flow: "team-trial",
    }));
    expect(window.location.href).toBe("https://checkout.stripe.com/c/pay/cs_trial");
  });

  it("keeps authentication on the stable trial URL", () => {
    mocks.auth.isAuthenticated = false;
    render(<TrialPage />);

    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(document.querySelector("#trial-page-login")).not.toBeNull();
  });

  it("uses ambiguous recovery copy when trial activation cannot be confirmed", async () => {
    allowConsoleError("Trial checkout failed");
    mocks.startTrial.mockRejectedValueOnce(
      new Error("POST /agents/stripe/trial token=private-trial-token returned 504"),
    );
    render(<TrialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));

    expect(await screen.findByRole("heading", { name: "Retry to open secure checkout" })).toBeVisible();
    expect(screen.getByText(/Checkout did not open/i)).toBeVisible();
    expect(screen.queryByText(/POST \/agents\/stripe\/trial/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry checkout" })).toBeVisible();
    expect(document.querySelector("#trial-claim-error")).not.toBeNull();
  });
});
