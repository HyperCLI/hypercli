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

const unsortedCatalogPlans = [
  { ...catalogPlans[0], id: "plus", name: "Plus", price: 49, priceUsd: 49, highlighted: false },
  { ...catalogPlans[0], id: "basic", name: "Basic", price: 19, priceUsd: 19, highlighted: false },
  { ...catalogPlans[0], id: "enterprise", name: "Enterprise", price: 99, priceUsd: 99, highlighted: false },
] as HyperAgentPlan[];

describe("FirstAgentSetupWizard", () => {
  it("renders catalog plan details instead of static fallback plan copy", () => {
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
    expect(screen.getByText("Medium slots available after purchase")).toBeInTheDocument();
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

  it("sorts catalog plan options by price", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={unsortedCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Basic",
      "Plus",
      "Enterprise",
    ]);
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

    expect(screen.getAllByText("No slots available")).toHaveLength(2);
    expect(screen.queryByText("0 Medium slots available")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buy more slots" }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("shows when an exhausted slot is being released after agent deletion", () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        pendingSlotReleases={{ medium: 1 }}
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

    expect(screen.getByText("Slot being released")).toBeInTheDocument();
    expect(screen.getByText("1 Medium slot being released")).toBeInTheDocument();
    expect(screen.getByText("Refreshing slot availability")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refreshing slots" })).toBeDisabled();
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("shows a waiting entitlement state when payment is active but slot inventory is empty", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: {},
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

    expect(screen.getByText("Payment active, waiting for entitlement")).toBeInTheDocument();
    expect(screen.getByText("Medium slot provisioning")).toBeInTheDocument();
    expect(screen.getByText("Launch entitlement is still provisioning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open plans" }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("shows available slots and launches with the selected entitlement", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: {
            medium: { granted: 1, used: 0, available: 1 },
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

    expect(screen.getByText("1 Medium slot available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "medium" })),
    );
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("groups repeated active subscriptions for the same plan and slot tier", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: {
            medium: { granted: 2, used: 0, available: 2 },
          },
          pooled_tpd: 500000,
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
            {
              id: "sub-2",
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

    expect(screen.getAllByRole("heading", { name: "Team Launch" })).toHaveLength(1);
    expect(screen.getByText("2 Medium slots available")).toBeInTheDocument();
    expect(screen.getByText("2x Medium launch slots")).toBeInTheDocument();
  });

  it("sorts active plan options by catalog price", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: {
            small: { granted: 1, used: 0, available: 1 },
            medium: { granted: 1, used: 0, available: 1 },
          },
          pooled_tpd: 500000,
        }}
        subscriptionSummary={{
          effectivePlanId: "plus",
          activeSubscriptions: [
            {
              id: "sub-plus",
              planId: "plus",
              planName: "Plus",
              slotGrants: { medium: 1 },
              quantity: 1,
            },
            {
              id: "sub-basic",
              planId: "basic",
              planName: "Basic",
              slotGrants: { small: 1 },
              quantity: 1,
            },
          ],
        } as any}
        catalogPlans={unsortedCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Basic",
      "Plus",
    ]);
  });
});
