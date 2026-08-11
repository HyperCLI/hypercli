import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TrialPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: {
    getToken: vi.fn().mockResolvedValue("token"),
    isAuthenticated: true,
    isLoading: false,
  },
  claimTrialEntitlement: vi.fn().mockResolvedValue({ id: "ent-trial" }),
  subscriptionSummary: vi.fn().mockResolvedValue({}),
  notifyBillingPlanChanged: vi.fn(),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: () => ({
    claimTrialEntitlement: mocks.claimTrialEntitlement,
    subscriptionSummary: mocks.subscriptionSummary,
  }),
}));

vi.mock("@/components/dashboard/DashboardShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: () => <div>HyperCLI</div>,
  PrivyLoginPanel: () => <div>Login</div>,
  notifyBillingPlanChanged: mocks.notifyBillingPlanChanged,
}));

describe("TrialPage", () => {
  beforeEach(() => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.getToken.mockClear();
    mocks.claimTrialEntitlement.mockClear();
    mocks.subscriptionSummary.mockClear();
    mocks.notifyBillingPlanChanged.mockClear();
  });

  it("claims the backend-owned entitlement without opening checkout", async () => {
    render(<TrialPage />);

    const claimButton = screen.getByRole("button", { name: "Start free trial" });
    expect(claimButton).toHaveAttribute("id", "claim-trial-button");
    expect(claimButton).toHaveClass("claim-trial-button");
    fireEvent.click(claimButton);

    await waitFor(() => expect(mocks.claimTrialEntitlement).toHaveBeenCalledOnce());
    expect(mocks.subscriptionSummary).toHaveBeenCalledOnce();
    expect(mocks.notifyBillingPlanChanged).toHaveBeenCalledOnce();
    expect(await screen.findByText("Trial access is ready")).toBeInTheDocument();
  });

  it("keeps authentication on the stable trial URL", () => {
    mocks.auth.isAuthenticated = false;
    render(<TrialPage />);

    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(document.querySelector("#trial-page-login")).not.toBeNull();
  });
});
