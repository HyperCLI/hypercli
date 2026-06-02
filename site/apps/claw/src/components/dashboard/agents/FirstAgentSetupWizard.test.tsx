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

function getPlanCardAction(name: string): HTMLElement {
  return screen.getAllByRole("button", { name })[0];
}

function getPlanFooterAction(name: string): HTMLElement {
  const actions = screen.getAllByRole("button", { name });
  return actions[actions.length - 1];
}

describe("FirstAgentSetupWizard", () => {
  it("generates a three-word default agent name", async () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    const nameInput = screen.getByLabelText("Agent name") as HTMLInputElement;

    await waitFor(() => {
      expect(nameInput.value.split("-")).toHaveLength(3);
    });
    expect(nameInput.value).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("skips blocked words in generated agent names", async () => {
    const randomValues = [0, 7, 0];
    const getRandomValuesSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const view = array as Uint32Array;
      view[0] = randomValues.shift() ?? 0;
      return array;
    });

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    const nameInput = screen.getByLabelText("Agent name") as HTMLInputElement;

    await waitFor(() => {
      expect(nameInput.value).toBe("bright-vector-anchor");
    });
    expect(nameInput.value.split("-")).not.toContain("signal");

    getRandomValuesSpy.mockRestore();
  });

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
	    expect(getPlanCardAction("View plan")).toHaveClass("bg-[var(--button-primary)]");
	    expect(screen.getByText("Most Popular")).toHaveClass("bg-[var(--selection-accent)]");
	    expect(screen.getByText("Most Popular")).toHaveClass("text-[var(--selection-accent-foreground)]");
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

  it("calls the close handler from the choose-plan step", () => {
    const onClose = vi.fn();

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        onClose={onClose}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Close choose plan" }));

    expect(onClose).toHaveBeenCalledTimes(1);
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
    fireEvent.click(getPlanCardAction("View plan"));

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

    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));
    const dialog = screen.getByRole("dialog", { name: "Plan comparison" });
    expect(within(dialog).getByText("Pro")).toBeInTheDocument();
    expect(within(dialog).queryByText("5 AIU")).not.toBeInTheDocument();
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
    fireEvent.click(getPlanCardAction("Launch agent"));

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
    fireEvent.click(getPlanCardAction("Buy more slots"));

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
    expect(getPlanCardAction("Refreshing slots")).toBeDisabled();
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
    fireEvent.click(getPlanCardAction("Open plans"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("launches from the choose-plan card button with the selected entitlement", async () => {
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
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "medium" })),
    );
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("forwards selected knowledge files when launching", async () => {
    const onCreateAgent = vi.fn(async () => "agent-1");
    const file = new File(["launch brief"], "Launch Brief.txt", { type: "text/plain" });
    const { container } = renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
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
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText("Launch Brief.txt - 12 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ files: [file], size: "medium" })),
    );
  });

  it("launches from the selected plan footer action", async () => {
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
    fireEvent.click(getPlanFooterAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "medium" })),
    );
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("launches from a direct activation-code entitlement without an active subscription", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: {
            large: { granted: 1, used: 0, available: 1 },
          },
          pooled_tpd: 250000000,
        }}
        subscriptionSummary={{
          effectivePlanId: "catalog-pro",
          activeSubscriptions: [],
          entitlementItems: [
            {
              id: "ent-activation-1",
              subscriptionId: null,
              planId: "catalog-pro",
              planName: "Pro",
              provider: "ACTIVATION_CODE",
              status: "ACTIVE",
              slotGrants: { large: 1 },
            },
          ],
        } as any}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    expect(screen.getByText("Uses your active direct entitlement")).toBeInTheDocument();
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "large" })),
    );
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("launches from entitlement slot inventory when no entitlement item is listed", async () => {
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        budget={{
          slots: {
            large: { granted: 1, used: 0, available: 1 },
          },
          pooled_tpd: 250000000,
        }}
        subscriptionSummary={{
          effectivePlanId: "",
          activeSubscriptions: [],
          activeEntitlementCount: 1,
        } as any}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "large" })),
    );
  });

  it("shows an acquisition CTA when backend capacity reservation rejects launch", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => {
      throw new Error(
        "API Error 429: No available 'large' entitlement slots. Requested tier inventory: 1 free / 2 total (used 1). Available slots on this account: large 1 free / 2 total, medium 0 free / 0 total, small 0 free / 0 total. Stop an existing agent or purchase more capacity.",
      );
    });

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: {
            large: { granted: 2, used: 1, available: 1 },
          },
          pooled_tpd: 250000000,
        }}
        subscriptionSummary={{
          effectivePlanId: "catalog-pro",
          activeSubscriptions: [],
          activeEntitlementCount: 2,
        } as any}
        catalogPlans={proAndFiveAiuCatalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() => expect(screen.getByText("Large capacity unavailable")).toBeInTheDocument());
    expect(screen.getByText(/Your Large launch slot could not be reserved/i)).toBeInTheDocument();
    expect(screen.getByText("Requested Large: 1 free / 2 total")).toBeInTheDocument();
    expect(screen.getByText("large: 1 free / 2 total")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add Large capacity/i }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
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
