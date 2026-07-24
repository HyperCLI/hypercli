import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import { renderWithClient } from "@/test/utils";

import { AgentCreationSetupWizard } from "./AgentCreationSetupWizard";

const catalogPlans = [
  {
    id: "team-launch",
    name: "Team Launch",
    price: 49,
    priceUsd: 49,
    aiu: 0,
    agents: 1,
    features: ["Team channels", "Shared files"],
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
      checkout_bundle: { medium: 1 },
    },
  } as HyperAgentPlan,
];

const tieredCatalogPlans = [
  {
    ...catalogPlans[0],
    id: "basic",
    name: "Basic",
    price: 19,
    priceUsd: 19,
    highlighted: false,
    slotGrants: { small: 1 },
    meta: { subtitle: "Basic launch capacity" },
  },
  {
    ...catalogPlans[0],
    id: "plus",
    name: "Plus",
    price: 49,
    priceUsd: 49,
    highlighted: false,
    slotGrants: { medium: 1 },
    meta: { subtitle: "Plus launch capacity" },
  },
  {
    ...catalogPlans[0],
    id: "pro",
    name: "Pro",
    price: 99,
    priceUsd: 99,
    highlighted: true,
    slotGrants: { large: 1 },
    meta: { subtitle: "Pro launch capacity" },
  },
] as HyperAgentPlan[];

function renderLaunchableWizard(onCreateAgent = vi.fn(async () => "agent-1")) {
  renderWithClient(
    <AgentCreationSetupWizard
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
  return onCreateAgent;
}

function renderTieredLaunchableWizard(onCreateAgent = vi.fn(async () => "agent-1")) {
  renderWithClient(
    <AgentCreationSetupWizard
      onCreateAgent={onCreateAgent}
      budget={{
        slots: {
          small: { granted: 1, used: 0, available: 1 },
          medium: { granted: 1, used: 0, available: 1 },
          large: { granted: 1, used: 0, available: 1 },
        },
        pooled_tpd: 250000,
      }}
      subscriptionSummary={{
        effectivePlanId: "pro",
        activeSubscriptions: [
          {
            id: "sub-basic",
            planId: "basic",
            planName: "Basic",
            slotGrants: { small: 1 },
            quantity: 1,
          },
          {
            id: "sub-plus",
            planId: "plus",
            planName: "Plus",
            slotGrants: { medium: 1 },
            quantity: 1,
          },
          {
            id: "sub-pro",
            planId: "pro",
            planName: "Pro",
            slotGrants: { large: 1 },
            quantity: 1,
          },
        ],
      } as any}
      catalogPlans={tieredCatalogPlans}
    />,
  );
  return onCreateAgent;
}

function goToPlanStep() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function getPlanCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const card = heading.closest("div[role='button']");
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

describe("AgentCreationSetupWizard", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-latest";
    process.env.NEXT_PUBLIC_OPENCLAW_PRO_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:pro-latest";
  });

  it("marks desktop, memory indexing, and custom image as Pro features", () => {
    renderLaunchableWizard();

    expect(screen.getByText("Desktop browser")).toBeInTheDocument();
    expect(screen.getByText("Memory indexing")).toBeInTheDocument();
    expect(screen.getByText("Custom image")).toBeInTheDocument();
    expect(screen.getAllByText("Pro")).toHaveLength(3);
  });

  it("defaults the custom image input from the configured launch image", async () => {
    renderLaunchableWizard();

    fireEvent.click(screen.getByLabelText(/Custom image/i));
    const imageInput = screen.getByRole("textbox", { name: "Custom agent image" }) as HTMLInputElement;

    expect(imageInput).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:pro-latest");

    fireEvent.click(screen.getByLabelText(/Desktop browser/i));

    await waitFor(() => {
      expect(imageInput).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:pro-latest");
    });
  });

  it("forwards a selected custom image when launching", async () => {
    const onCreateAgent = renderLaunchableWizard();

    fireEvent.click(screen.getByLabelText(/Custom image/i));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom agent image" }), {
      target: { value: "ghcr.io/acme/openclaw:stable" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Launch agent" })[0]);

    await waitFor(() => {
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        customImage: "ghcr.io/acme/openclaw:stable",
        size: "medium",
      }));
    });
  });

  it("keeps Basic and Plus enabled before a Pro feature is selected", () => {
    renderTieredLaunchableWizard();

    goToPlanStep();

    expect(within(getPlanCard("Basic")).getByRole("button", { name: "Launch agent" })).toBeEnabled();
    expect(within(getPlanCard("Plus")).getByRole("button", { name: "Launch agent" })).toBeEnabled();
    expect(within(getPlanCard("Pro")).getByRole("button", { name: "Launch agent" })).toBeEnabled();
  });

  it.each([
    ["Desktop browser"],
    ["Memory indexing"],
    ["Custom image"],
  ])("disables Basic and Plus when %s is selected", (featureLabel) => {
    renderTieredLaunchableWizard();

    fireEvent.click(screen.getByLabelText(new RegExp(featureLabel, "i")));
    goToPlanStep();

    expect(within(getPlanCard("Basic")).getByRole("button", { name: "Pro required" })).toBeDisabled();
    expect(within(getPlanCard("Plus")).getByRole("button", { name: "Pro required" })).toBeDisabled();
    expect(within(getPlanCard("Pro")).getByRole("button", { name: "Launch agent" })).toBeEnabled();
    expect(within(getPlanCard("Basic")).getByText("Desktop, indexing, and custom images require Pro.")).toBeInTheDocument();
  });

  it("disables Free when a Pro feature is selected", () => {
    renderWithClient(
      <AgentCreationSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={[
          {
            ...catalogPlans[0],
            id: "free",
            name: "Free",
            price: 0,
            priceUsd: 0,
            highlighted: false,
            meta: { checkout_bundle: { free: 1 } },
          } as HyperAgentPlan,
          {
            ...catalogPlans[0],
            id: "starter",
            name: "Starter",
            price: 20,
            priceUsd: 20,
            highlighted: false,
            meta: { checkout_bundle: { small: 1 } },
          } as HyperAgentPlan,
          tieredCatalogPlans[2],
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Desktop browser/i));
    goToPlanStep();

    expect(within(getPlanCard("Free")).getByRole("button", { name: "Pro required" })).toBeDisabled();
    expect(within(getPlanCard("Starter")).getByRole("button", { name: "Pro required" })).toBeDisabled();
    expect(within(getPlanCard("Pro")).getByRole("button", { name: "View plan" })).toBeEnabled();
  });
});
