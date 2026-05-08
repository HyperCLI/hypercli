import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import { renderWithClient } from "@/test/utils";

import { FirstAgentSetupWizard } from "./FirstAgentSetupWizard";

const catalogPlans = [
  {
    id: "team-launch",
    name: "Team Launch",
    price: 49,
    priceUsd: 49,
    aiu: 0,
    agents: 2,
    features: ["Team channels", "Shared files", "Priority routing", "250K tokens/day"],
    models: [],
    highlighted: true,
    limits: {
      tpd: 250000,
      tpm: 8000,
      burstTpm: 16000,
      rpm: 300,
    },
    tpmLimit: 8000,
    rpmLimit: 300,
    meta: {
      subtitle: "Shared agent capacity from catalog",
      checkout_bundle: { medium: 1, small: 1 },
    },
  } as HyperAgentPlan,
];

describe("FirstAgentSetupWizard", () => {
  it("renders SDK catalog plan details instead of static fallback plan copy", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(screen.getByText("Team Launch")).toBeInTheDocument();
    expect(screen.getByText("Shared agent capacity from catalog")).toBeInTheDocument();
    expect(screen.getByText("Team channels")).toBeInTheDocument();
    expect(screen.getByText("1x Medium launch slot")).toBeInTheDocument();
    expect(screen.getAllByText("250K tokens/day")).toHaveLength(1);
    expect(screen.queryByText("Simple")).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced workflows and analytics")).not.toBeInTheDocument();
  });

  it("opens the plan catalog modal for catalog plans when no entitlement can launch", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "View plan" }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("opens the plan catalog modal when active entitlement slots are exhausted", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: {
            medium: { granted: 1, used: 1, available: 0 },
          },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [
            {
              id: "sub-1",
              planId: "team-launch",
              planName: "Team Launch",
              slotGrants: { medium: 1 },
              quantity: 1,
            },
          ],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("No slots available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buy more slots" }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onCreateAgent).not.toHaveBeenCalled();
  });
});
