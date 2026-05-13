import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const proAndFiveAiuCatalogPlans = [
  {
    ...catalogPlans[0],
    id: "starter",
    name: "Starter",
    price: 19,
    priceUsd: 19,
    aiu: 1,
    highlighted: false,
    slotGrants: { small: 1 },
    meta: { subtitle: "Starter launch capacity" },
  },
  {
    ...catalogPlans[0],
    id: "5-aiu",
    name: "5 AIU",
    price: 99,
    priceUsd: 99,
    aiu: 5,
    highlighted: false,
    slotGrants: { large: 1 },
    meta: { subtitle: "Legacy 5 AIU launch capacity" },
  },
  {
    ...catalogPlans[0],
    id: "catalog-pro",
    name: "Pro",
    price: 99,
    priceUsd: 99,
    aiu: 5,
    highlighted: true,
    slotGrants: { large: 1 },
    meta: { subtitle: "Pro launch capacity" },
  },
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

  it("opens plan comparison from the choose plan step", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));

    const dialog = screen.getByRole("dialog", { name: "Plan comparison" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Team Launch")).toBeInTheDocument();
    expect(within(dialog).getByText("Price")).toBeInTheDocument();
    expect(within(dialog).getByText("Team channels")).toBeInTheDocument();
    expect(within(dialog).getByText("250K/day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close plan comparison" }));
    expect(screen.queryByRole("dialog", { name: "Plan comparison" })).not.toBeInTheDocument();
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

  it("merges 5 AIU catalog plans into Pro when Pro is available", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Starter",
      "Pro",
    ]);
    expect(screen.queryByRole("heading", { name: "5 AIU" })).not.toBeInTheDocument();
  });

  it("uses Pro launch state when the effective plan is a merged 5 AIU plan", async () => {
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        budget={{
          slots: {
            large: { granted: 1, used: 0, available: 1 },
          },
          pooled_tpd: 500000,
        }}
        subscriptionSummary={{
          effectivePlanId: "5-aiu",
          activeSubscriptions: [],
        } as any}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.queryByRole("heading", { name: "5 AIU" })).not.toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "large" })),
    );
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

  it("groups active 5 AIU subscriptions with Pro when both plans are present", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: {
            large: { granted: 2, used: 0, available: 2 },
          },
          pooled_tpd: 500000,
        }}
        subscriptionSummary={{
          effectivePlanId: "catalog-pro",
          activeSubscriptions: [
            {
              id: "sub-pro",
              planId: "catalog-pro",
              planName: "Pro",
              slotGrants: { large: 1 },
              quantity: 1,
            },
            {
              id: "sub-5-aiu",
              planId: "5-aiu",
              planName: "5 AIU",
              slotGrants: { large: 1 },
              quantity: 1,
            },
          ],
        } as any}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Pro"]);
    expect(screen.queryByRole("heading", { name: "5 AIU" })).not.toBeInTheDocument();
    expect(screen.getByText("2 Large slots available")).toBeInTheDocument();
    expect(screen.getByText("2x Large launch slots")).toBeInTheDocument();
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
