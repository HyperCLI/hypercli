import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import { AGENT_DOMAIN } from "@/lib/api";
import { renderWithClient } from "@/test/utils";
import type {
  OpenClawBootstrapFile,
  OpenClawBootstrapFileName,
} from "@/lib/openclaw-bootstrap-pack";

const releaseBoundaryMock = vi.hoisted(() => ({
  hermesLauncherAvailable: false,
  knowledgeHubAvailable: false,
}));

vi.mock("@/lib/dashboard-release-boundary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dashboard-release-boundary")>();
  return {
    ...original,
    isDashboardReleaseSurfaceAvailable: (surface: string) => (
      surface === "hermes-launcher"
        ? releaseBoundaryMock.hermesLauncherAvailable
        : surface === "knowledge-hub"
        ? releaseBoundaryMock.knowledgeHubAvailable
        : original.isDashboardReleaseSurfaceAvailable(surface as never)
    ),
  };
});

import {
  FirstAgentSetupWizard,
  updateFirstAgentSetupDraftPlan,
  type FirstAgentSetupCreateParams,
} from "./FirstAgentSetupWizard";

const catalogPlans = [
  {
    id: "team-launch",
    canonicalId: null,
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
] as unknown as HyperAgentPlan[];

function getPlanCardAction(name: string): HTMLElement {
  return screen.getAllByRole("button", { name })[0];
}

function getPlanFooterAction(name: string): HTMLElement {
  const actions = screen.getAllByRole("button", { name });
  return actions[actions.length - 1];
}

function goToPlanStep() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

type PersistedSetupDraft = {
  bootstrapDraft?: {
    inputs?: { agentName?: string };
    files?: Array<{ name: string; content: string }>;
  };
};

function readPersistedSetupDraft(): PersistedSetupDraft {
  return JSON.parse(window.sessionStorage.getItem("hypercli-first-agent-draft") ?? "{}");
}

// The bootstrap pack hydrates asynchronously from /bootstrap/*.md on mount.
// Launch and plan actions stay gated until the pack is assembled, so tests
// that click them must first wait for the wizard to report readiness.
async function waitForPackReady(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("agent-setup-wizard")).toHaveAttribute("data-pack-ready", "true");
  });
}

// Wait until the wizard's debounced draft persistence reflects the bootstrap
// inputs matching the current agent name. Use this after the workspace step
// re-syncs the pack with a typed display name, before personality-stage
// background generation begins.
async function waitForPackInputsAgentName(agentName: string): Promise<void> {
  await waitFor(() => {
    expect(readPersistedSetupDraft().bootstrapDraft?.inputs?.agentName).toBe(agentName);
  });
}

describe("FirstAgentSetupWizard", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    releaseBoundaryMock.hermesLauncherAvailable = false;
    releaseBoundaryMock.knowledgeHubAvailable = false;
  });

  it("shows Hermes as coming soon and resets a saved Hermes selection in the shipped launcher", () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "saved-hermes-agent",
      iconIndex: 0,
      category: "General",
      agentType: "hermes",
    }));
    renderWithClient(
      <FirstAgentSetupWizard
        onStartFresh={vi.fn()}
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    const selector = screen.getByTestId("agent-setup-runtime-selector");
    const openClawOption = within(selector).getByTestId("agent-setup-runtime-openclaw");
    const hermesOption = within(selector).getByTestId("agent-setup-runtime-hermes");
    expect(openClawOption).toHaveAttribute("aria-pressed", "true");
    expect(hermesOption).toBeDisabled();
    expect(hermesOption).toHaveAttribute("aria-pressed", "false");
    expect(within(hermesOption).getByText("Coming soon")).toBeInTheDocument();

    fireEvent.click(hermesOption);
    expect(openClawOption).toHaveAttribute("aria-pressed", "true");
    expect(hermesOption).toHaveAttribute("aria-pressed", "false");
  });

  it("does not surface Collections when Knowledge Hub is unavailable", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
        knowledgeCollections={[{ id: "collection-1", name: "Product", role: "admin" }]}
        knowledgeCollectionsLoading
      />,
    );

    expect(screen.queryByLabelText("Initial Collection")).not.toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent URL preview")).toBeInTheDocument();
  });

  it("drops a stale saved Collection before launching while Knowledge Hub is unavailable", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      setupId: "setup-stale-collection",
      name: "restored-agent",
      iconIndex: 0,
      category: "General",
      plan: "team-launch",
      knowledgeCollectionId: "collection-stale",
      starterFiles: [],
    }));
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    await waitForPackReady();
    fireEvent.click(getPlanFooterAction("Launch agent"));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
      knowledgeCollectionId: null,
    })));
  });

  it("preserves Collection selection inside the dormant enabled workflow", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const onCreateAgent = vi.fn(async () => "agent-1");
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
        knowledgeCollections={[
          { id: "collection-1", name: "Product", role: "admin" },
          { id: "collection-readonly", name: "Archive", role: "viewer" },
        ]}
      />,
    );

    const selector = screen.getByLabelText("Initial Collection");
    expect(selector).toBeInTheDocument();
    expect(within(selector).getByRole("option", { name: "Archive (admin access required)" })).toBeDisabled();
    fireEvent.change(selector, { target: { value: "collection-1" } });
    goToPlanStep();
    await waitForPackReady();
    fireEvent.click(getPlanFooterAction("Launch agent"));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
      knowledgeCollectionId: "collection-1",
    })));
  });

  it("uses the wide launcher presentation while preserving compact default bounds", () => {
    const view = renderWithClient(
      <FirstAgentSetupWizard
        size="large"
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(view.container.querySelector("section")).toHaveClass("max-h-[910px]", "max-w-[1168px]");
  });

  it("uses one normalized shell for the inline presentation", () => {
    const view = renderWithClient(
      <FirstAgentSetupWizard
        size="inline"
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(view.container.querySelector("section")).toHaveClass("h-full", "max-h-[680px]", "sm:max-h-[820px]", "max-w-[1168px]");
    expect(view.container.querySelector("header")).toHaveClass("min-h-[82px]");
    expect(view.container.querySelector("footer")).toHaveClass("h-[72px]");
  });

  it("fills its parent without modal framing in the embedded presentation", () => {
    const view = renderWithClient(
      <FirstAgentSetupWizard
        size="embedded"
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    const surface = view.container.querySelector("section");
    expect(surface).toHaveAttribute("data-presentation", "embedded");
    expect(surface).toHaveClass(
      "h-full",
      "max-h-none",
      "max-w-none",
      "rounded-none",
      "border-0",
      "shadow-none",
    );
    expect(surface?.parentElement).toHaveClass("p-0");
  });

  it("starts optional agent customization collapsed on the identity step", async () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(screen.getByRole("heading", { name: "Create agent" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-setup-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("agent-setup-continue-identity")).toBeEnabled();
    expect(screen.getByLabelText("Agent name")).toHaveValue("");
    expect(screen.getByLabelText("Agent name")).toHaveAttribute("placeholder", "e.g. Research Assistant");
    expect(screen.queryByText("Avatar")).not.toBeInTheDocument();
    expect(screen.queryByText("What does it help with?")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await waitFor(() => {
      expect(screen.getByLabelText("Agent URL preview")).toHaveTextContent(/^[a-z]+-[a-z]+-[a-z]+$/);
    });
    const advancedToggle = screen.getByTestId("agent-setup-advanced-toggle");
    const optionalSettings = screen.getByTestId("agent-setup-advanced-settings");
    expect(optionalSettings?.parentElement).toHaveClass("mx-auto", "my-auto", "w-full");
    expect(optionalSettings).not.toHaveAttribute("open");
    fireEvent.click(advancedToggle);
    expect(optionalSettings).toHaveAttribute("open");
    expect(screen.getByTestId("agent-setup-desktop-toggle")).toHaveAttribute("id", "agent-setup-desktop-toggle");
  });

  it("shows distinct launch momentum across every setup step", () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(screen.getByText("Taking shape")).toBeInTheDocument();
    expect(screen.getByText("Moments from launch")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "48");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Define what it should accomplish")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "64");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Looking good!")).toBeInTheDocument();
    expect(screen.getByText("Now shape how it works")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "78");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Almost there!")).toBeInTheDocument();
    expect(screen.getByText("Choose the one that fits best")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "92");
  });

  it("keeps per-file generation running when the user continues to the plan step", async () => {
    const resolvers: Partial<Record<
      OpenClawBootstrapFileName,
      (file: OpenClawBootstrapFile) => void
    >> = {};
    const onGenerateBootstrap = vi.fn((name: OpenClawBootstrapFileName) => (
      new Promise<OpenClawBootstrapFile>((resolve) => {
        resolvers[name] = resolve;
      })
    ));

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        onGenerateBootstrap={onGenerateBootstrap}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "background-builder" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onGenerateBootstrap).not.toHaveBeenCalled();
    // Let the workspace step re-sync the pack to the typed display name
    // before the personality stage kicks off background file generation.
    await waitForPackInputsAgentName("background-builder");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onGenerateBootstrap).toHaveBeenCalledTimes(1));
    expect(onGenerateBootstrap.mock.calls.map(([name]) => name)).toEqual([
      "AGENTS.md",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();

    await act(async () => {
      resolvers["AGENTS.md"]?.({
        name: "AGENTS.md",
        content: "# AGENTS.md\n\nGenerated while the plan step was open.",
      });
    });
    await waitFor(() => expect(onGenerateBootstrap).toHaveBeenCalledTimes(2));
    expect(onGenerateBootstrap.mock.calls[1]?.[0]).toBe("SOUL.md");

    await act(async () => {
      resolvers["SOUL.md"]?.({
        name: "SOUL.md",
        content: "# SOUL.md\n\nGenerated while the plan step was open.",
      });
    });
    await waitFor(() => expect(onGenerateBootstrap).toHaveBeenCalledTimes(3));
    expect(onGenerateBootstrap.mock.calls.map(([name]) => name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "USER.md",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: /approach the work/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Workspace files" })).not.toBeInTheDocument();
  });

  it("saves anonymous identity changes for a later launch", async () => {
    renderWithClient(
      <FirstAgentSetupWizard
        saveDraftAsYouGo
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "night-ops-pilot" } });

    await waitFor(() => {
      const draft = JSON.parse(window.sessionStorage.getItem("hypercli-first-agent-draft") ?? "{}");
      expect(draft).toMatchObject({
        source: "first-agent-setup",
        displayName: "night-ops-pilot",
        plan: null,
      });
      expect(draft.name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    });

    goToPlanStep();
    fireEvent.click(screen.getByRole("heading", { name: "Team Launch" }).closest("button")!);

    await waitFor(() => {
      const draft = JSON.parse(window.sessionStorage.getItem("hypercli-first-agent-draft") ?? "{}");
      expect(draft).toMatchObject({ plan: "team-launch", size: "medium" });
    });
  });

  it("updates an existing draft with the product selected in checkout", () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      plan: "starter",
      name: "checkout-agent",
    }));

    updateFirstAgentSetupDraftPlan("pro");

    expect(JSON.parse(window.sessionStorage.getItem("hypercli-first-agent-draft") ?? "{}").plan).toBe("pro");
  });

  it("keeps the display name blank while generating a three-word URL name", async () => {
    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    const nameInput = screen.getByLabelText("Agent name") as HTMLInputElement;
    const urlPreview = screen.getByLabelText("Agent URL preview");

    await waitFor(() => {
      expect(urlPreview.textContent?.split("-")).toHaveLength(3);
    });
    expect(nameInput).toHaveValue("");
    expect(urlPreview).toHaveTextContent(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("skips blocked words in generated agent names", async () => {
    const randomValues = [0, 896, 0];
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

    const urlPreview = screen.getByLabelText("Agent URL preview");

    await waitFor(() => {
      expect(urlPreview).toHaveTextContent("bright-vector-anchor");
    });
    expect(urlPreview.textContent?.split("-")).not.toContain("signal");

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

    goToPlanStep();

    expect(screen.getByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(screen.getByText("Team Launch")).toBeInTheDocument();
    expect(screen.getByText("Shared agent capacity from catalog")).toBeInTheDocument();
    expect(screen.getByText("Medium slots available after purchase")).toBeInTheDocument();
    expect(screen.getByText("Team channels")).toBeInTheDocument();
    expect(screen.getByText("1x Medium launch slot")).toBeInTheDocument();
    expect(screen.getAllByText("250K tokens/day")).toHaveLength(1);
    const planSelector = screen.getByRole("group", { name: "Available plans" });
    expect(planSelector).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team Launch" }).closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("What's included")).toBeInTheDocument();
    expect(getPlanCardAction("View plan")).toHaveClass("bg-[var(--button-primary)]");
    expect(screen.getByText("Most Popular")).toHaveClass("bg-selection-accent");
    expect(screen.getByText("Most Popular")).toHaveClass("text-selection-accent-foreground");
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

    goToPlanStep();
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

  it("calls the close handler from the header and identity footer", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Close agent creation" }));

    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(2);
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

    goToPlanStep();
    await waitForPackReady();
    fireEvent.click(getPlanCardAction("View plan"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onOpenPlanCatalog).toHaveBeenCalledWith("team-launch");
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("opens capacity directly from the workspace step when plan selection is skipped", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);

    renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Set up the workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What do you want to get done?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: /approach the work/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onOpenPlanCatalog.mock.calls[0]).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Choose your plan" })).not.toBeInTheDocument();
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("embeds capacity selection in the creation surface instead of opening another modal", () => {
    const onOpenPlanCatalog = vi.fn();
    const view = renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
        size="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));

    expect(screen.getByRole("heading", { name: "Give it room to run" })).toBeInTheDocument();
    expect(screen.getByText("Choose the capacity that fits the work ahead. You can scale it up anytime.")).toBeInTheDocument();
    expect(screen.getByText("Embedded capacity catalog")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "92");
    expect(view.container.querySelector("section")).toHaveClass("h-full", "max-h-[680px]", "sm:max-h-[820px]", "max-w-[1168px]");
    expect(screen.queryByRole("heading", { name: "Choose your plan" })).not.toBeInTheDocument();
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("keeps purchase checkout in the same surface with its own progress state", () => {
    const onBackFromCheckout = vi.fn();
    const props = {
      skipPlanSelection: true,
      capacityReady: true,
      capacityContent: <div>Embedded capacity catalog</div>,
      onCreateAgent: vi.fn(async () => null),
      onOpenPlanCatalog: vi.fn(),
      onBackFromCheckout,
      budget: null,
      subscriptionSummary: null,
      catalogPlans,
      size: "inline" as const,
    };
    const view = renderWithClient(<FirstAgentSetupWizard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    view.rerender(
      <FirstAgentSetupWizard
        {...props}
        checkoutActive
        checkoutContent={<div>Embedded purchase checkout</div>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Make it official" })).toBeInTheDocument();
    expect(screen.getByText("Choose how you'd like to pay. Your setup stays right here.")).toBeInTheDocument();
    expect(screen.getByText("Embedded purchase checkout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare plans" })).not.toBeInTheDocument();
    expect(screen.getByText("One tiny thing...")).toBeInTheDocument();
    expect(screen.getByText("Then it's ready to run")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute("aria-valuenow", "98");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBackFromCheckout).toHaveBeenCalledOnce();
  });

  it("locks checkout navigation while a payment is processing", () => {
    const onBackFromCheckout = vi.fn();
    const onClose = vi.fn();
    const props = {
      skipPlanSelection: true,
      capacityReady: true,
      capacityContent: <div>Embedded capacity catalog</div>,
      checkoutContent: <div>Embedded purchase checkout</div>,
      onCreateAgent: vi.fn(async () => null),
      onOpenPlanCatalog: vi.fn(),
      onBackFromCheckout,
      onClose,
      budget: null,
      subscriptionSummary: null,
      catalogPlans,
      size: "inline" as const,
    };
    const view = renderWithClient(<FirstAgentSetupWizard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    view.rerender(
      <FirstAgentSetupWizard
        {...props}
        checkoutActive
        checkoutProcessing
      />,
    );

    const back = screen.getByRole("button", { name: "Back" });
    const close = screen.getByRole("button", { name: "Close agent creation" });
    expect(back).toBeDisabled();
    expect(close).toBeDisabled();
    fireEvent.click(back);
    fireEvent.click(close);
    expect(onBackFromCheckout).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("launches directly from the workspace step when capacity is available", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => "agent-1");

    renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPackReady();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ size: "medium" })));
    expect(screen.queryByRole("heading", { name: "Choose your plan" })).not.toBeInTheDocument();
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("skips the workspace step and launches without bootstrap files for hermes agents", async () => {
    releaseBoundaryMock.hermesLauncherAvailable = true;
    const onCreateAgent = vi.fn(async (_params: FirstAgentSetupCreateParams) => "agent-hermes");

    renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    expect(screen.getByTestId("agent-setup-runtime-openclaw")).toHaveAttribute("aria-pressed", "true");
    const hermesOption = screen.getByTestId("agent-setup-runtime-hermes");
    expect(hermesOption).not.toBeDisabled();
    expect(within(hermesOption).queryByText("Coming soon")).not.toBeInTheDocument();
    fireEvent.click(hermesOption);
    expect(hermesOption).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("button", { name: /^Research a market/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledOnce());
    expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentType: "hermes",
      files: [],
      enableDesktop: false,
      enableMemoryIndex: false,
    }));
  });

  it("replaces the setup form with the startup loader as soon as creation begins", async () => {
    const onCreateAgent = vi.fn(() => new Promise<string | null>(() => undefined));

    const view = renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPackReady();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledOnce());
    expect(view.container.querySelector('[data-slot="agent-creation-loading"]')).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agent startup" })).toBeInTheDocument();
    expect(screen.getByText("Creating agent")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /approach the work/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Creating..." })).not.toBeInTheDocument();
  });

  it("launches with the selected objective and personality in the workspace files", async () => {
    const onCreateAgent = vi.fn(async (_params: FirstAgentSetupCreateParams) => "agent-1");
    const OriginalFile = File;
    const fileContents = new Map<string, string>();
    class CapturingFile extends OriginalFile {
      constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
        super(parts, name, options);
        fileContents.set(name, parts.filter((part): part is string => typeof part === "string").join(""));
      }
    }
    vi.stubGlobal("File", CapturingFile);

    renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={vi.fn()}
        budget={{
          slots: { medium: { granted: 1, used: 0, available: 1 } },
          pooled_tpd: 250000,
        }}
        subscriptionSummary={{
          effectivePlanId: "team-launch",
          activeSubscriptions: [{
            id: "sub-team",
            planId: "team-launch",
            planName: "Team Launch",
            slotGrants: { medium: 1 },
            quantity: 1,
          }],
        } as any}
        catalogPlans={catalogPlans}
      />,
    );

    // Let the starter pack finish hydrating before any workspace edits, so
    // the deterministic re-assembly applies on top of the hydrated files.
    await waitForPackReady();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /^Research a market/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /^The Detective/ }));
    // Wait for the re-assembled pack (with the selected objective and
    // personality baked in) to settle before launching.
    await waitFor(() => {
      const files = readPersistedSetupDraft().bootstrapDraft?.files ?? [];
      expect(files.find((file) => file.name === "AGENTS.md")?.content)
        .toContain("Research a market. Investigate an industry, competitors, and opportunities.");
      expect(files.find((file) => file.name === "SOUL.md")?.content)
        .toContain("Be observant, skeptical, and relentless about finding the truth.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalledOnce());
    const files = onCreateAgent.mock.calls[0]?.[0].files ?? [];
    vi.stubGlobal("File", OriginalFile);
    expect(files.map((file) => file.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "BOOTSTRAP.md",
    ]);
    expect(fileContents.get("AGENTS.md"))
      .toContain("Research a market. Investigate an industry, competitors, and opportunities.");
    expect(fileContents.get("SOUL.md"))
      .toContain("Research a market. Investigate an industry, competitors, and opportunities.");
    expect(fileContents.get("SOUL.md"))
      .toContain("Be observant, skeptical, and relentless about finding the truth.");
    expect(fileContents.get("IDENTITY.md")).toContain("- **Name:**");
    expect(fileContents.get("BOOTSTRAP.md")).toContain("delete `BOOTSTRAP.md`");
  });

  it("keeps a saved draft inside the main setup shell before resuming", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "resumed-agent",
      iconIndex: 11,
      category: "Ops",
      plan: "team-launch",
      enableDesktop: true,
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: "",
    }));
    const onStartFresh = vi.fn();
    const view = renderWithClient(
      <FirstAgentSetupWizard
        size="inline"
        saveDraftAsYouGo
        skipPlanSelection
        capacityReady={false}
        capacityContent={<div>Embedded capacity catalog</div>}
        onStartFresh={onStartFresh}
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={vi.fn()}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your agent has a head start." })).toBeInTheDocument();
    expect(screen.getByText(`resumed-agent.${AGENT_DOMAIN}`)).toBeInTheDocument();
    expect(screen.getByText("Browser ready")).toBeInTheDocument();
    expect(screen.getByText("Memory ready")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Agent setup progress" })).toHaveAttribute(
      "aria-valuetext",
      "Setup saved. Ready when you are.",
    );
    expect(view.container.querySelectorAll("[data-agent-launch-surface]")).toHaveLength(1);
    expect(view.container.querySelector('[data-slot="saved-agent-draft-summary"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(onStartFresh).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(await screen.findByRole("heading", { name: "Set up the workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking capacity..." })).toBeDisabled();
  });

  it("opens capacity for a resumed draft once billing data is ready", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "resumed-agent",
      iconIndex: 0,
      category: "General",
      plan: "team-launch",
      starterFiles: [],
    }));
    const onOpenPlanCatalog = vi.fn();
    const props = {
      skipPlanSelection: true,
      capacityContent: <div>Embedded capacity catalog</div>,
      onCreateAgent: vi.fn(async () => null),
      onOpenPlanCatalog,
      budget: null,
      subscriptionSummary: null,
      catalogPlans,
    };
    const view = renderWithClient(<FirstAgentSetupWizard {...props} capacityReady={false} />);

    expect(await screen.findByRole("heading", { name: "Set up the workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking capacity..." })).toBeDisabled();
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();

    view.rerender(<FirstAgentSetupWizard {...props} capacityReady />);

    expect(await screen.findByRole("heading", { name: "Give it room to run" })).toBeInTheDocument();
    expect(screen.getByText("Embedded capacity catalog")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose your plan" })).not.toBeInTheDocument();
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
  });

  it("offers a billing retry instead of leaving capacity loading indefinitely", () => {
    const onRetryCapacity = vi.fn();
    renderWithClient(
      <FirstAgentSetupWizard
        skipPlanSelection
        capacityReady={false}
        capacityError="Billing data could not be loaded. Retry before checkout."
        onRetryCapacity={onRetryCapacity}
        capacityContent={<div>Embedded capacity catalog</div>}
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={vi.fn()}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Billing data could not be loaded");
    expect(screen.getByRole("button", { name: "Capacity unavailable" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry billing data" }));
    expect(onRetryCapacity).toHaveBeenCalledOnce();
  });

  it("applies a valid preferred plan from the dashboard route", async () => {
    const onOpenPlanCatalog = vi.fn();
    renderWithClient(
      <FirstAgentSetupWizard
        initialPlanId="plus"
        onCreateAgent={vi.fn(async () => null)}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={unsortedCatalogPlans}
      />,
    );

    goToPlanStep();
    await waitForPackReady();
    fireEvent.click(getPlanFooterAction("View plan"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledWith("plus"));
  });

  it("restores an existing setup draft directly to plan selection", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "restored-agent",
      iconIndex: 12,
      category: "Research",
      plan: "team-launch",
      starterFiles: [{ name: "brief.pdf", size: 123, type: "application/pdf" }],
      enableDesktop: true,
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: null,
    }));

    renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(screen.queryByText(/Reselect brief\.pdf/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Agent name")).toHaveValue("restored-agent");
    expect(screen.getByText("Advanced").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Avatar")).not.toBeInTheDocument();
  });

  it("does not expose an authenticated account draft in an anonymous wizard", () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      setupId: "setup-private",
      principalId: "user-1",
      name: "private-account-agent",
      iconIndex: 2,
      category: "Research",
      plan: "team-launch",
    }));

    renderWithClient(
      <FirstAgentSetupWizard
        draftPrincipalId={null}
        onCreateAgent={vi.fn(async () => null)}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={catalogPlans}
      />,
    );

    expect(screen.getByLabelText("Agent name")).not.toHaveValue("private-account-agent");
  });

  it("maps a restored catalog plan to its active entitlement option", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "restored-agent",
      iconIndex: 0,
      category: "General",
      plan: "team-launch",
      starterFiles: [],
    }));
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async () => null);
    const activeBudget = {
      slots: {
        small: { granted: 1, used: 1, available: 0 },
        medium: { granted: 1, used: 1, available: 0 },
      },
      pooled_tpd: 250000,
    };
    const activeSummary = {
      effectivePlanId: "basic",
      activeSubscriptions: [
        { id: "sub-basic", planId: "basic", planName: "Basic", slotGrants: { small: 1 }, quantity: 1 },
        { id: "sub-team", planId: "team-launch", planName: "Team Launch", slotGrants: { medium: 1 }, quantity: 1 },
      ],
    } as any;
    const plans = [{ ...catalogPlans[0], id: "basic", name: "Basic", price: 19, priceUsd: 19 }, catalogPlans[0]];
    const view = renderWithClient(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={null}
        subscriptionSummary={null}
        catalogPlans={plans}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    view.rerender(
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent}
        onOpenPlanCatalog={onOpenPlanCatalog}
        budget={activeBudget}
        subscriptionSummary={activeSummary}
        catalogPlans={plans}
      />,
    );
    await screen.findAllByText("No slots available");
    await waitForPackReady();
    fireEvent.click(getPlanFooterAction("Buy more slots"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledWith("team-launch"));
  });

  it("lets an explicit catalog checkout selection override the restored plan", async () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "restored-agent",
      iconIndex: 0,
      category: "General",
      plan: "team-launch",
      starterFiles: [],
    }));
    const onOpenPlanCatalog = vi.fn();
    const plans = [{ ...catalogPlans[0], id: "basic", name: "Basic", price: 19, priceUsd: 19 }, catalogPlans[0]];
    const props = {
      onCreateAgent: vi.fn(async () => null),
      onOpenPlanCatalog,
      budget: null,
      subscriptionSummary: null,
      catalogPlans: plans,
    };
    const view = renderWithClient(<FirstAgentSetupWizard {...props} />);

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    view.rerender(<FirstAgentSetupWizard {...props} selectedCatalogPlanId="basic" />);
    await waitForPackReady();
    fireEvent.click(getPlanFooterAction("View plan"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledWith("basic"));
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

    goToPlanStep();

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

    goToPlanStep();

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
    const onCreateAgent = vi.fn(async (_params: FirstAgentSetupCreateParams) => "agent-1");

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

    goToPlanStep();

    expect(screen.queryByRole("heading", { name: "5 AIU" })).not.toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    await waitForPackReady();
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        creationId: expect.any(String),
        size: "large",
      })),
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

    goToPlanStep();

    expect(screen.getAllByText("No slots available")).toHaveLength(2);
    expect(screen.queryByText("0 Medium slots available")).not.toBeInTheDocument();
    await waitForPackReady();
    fireEvent.click(getPlanCardAction("Buy more slots"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onOpenPlanCatalog).toHaveBeenCalledWith("team-launch");
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

    goToPlanStep();

    expect(screen.getByText("Slot being released")).toBeInTheDocument();
    expect(screen.getByText("1 Medium slot being released")).toBeInTheDocument();
    expect(screen.getByText("Refreshing slot availability")).toBeInTheDocument();
    expect(getPlanCardAction("Refreshing slots")).toBeDisabled();
    expect(getPlanCardAction("Refreshing slots")).toHaveClass("disabled:cursor-wait");
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

    goToPlanStep();

    expect(screen.getByText("Payment active, waiting for entitlement")).toBeInTheDocument();
    expect(screen.getByText("Medium slot provisioning")).toBeInTheDocument();
    expect(screen.getByText("Launch entitlement is still provisioning")).toBeInTheDocument();
    await waitForPackReady();
    fireEvent.click(getPlanCardAction("Open plans"));

    await waitFor(() => expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1));
    expect(onOpenPlanCatalog).toHaveBeenCalledWith("team-launch");
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it("assigns a fresh random icon when launching with the selected entitlement", async () => {
    const onOpenPlanCatalog = vi.fn();
    const onCreateAgent = vi.fn(async (_params: FirstAgentSetupCreateParams) => "agent-1");
    const randomValues = [1, 0, 0, 14];
    const getRandomValuesSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = randomValues.shift() ?? 0;
      return array;
    });

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

    const urlPreview = screen.getByLabelText("Agent URL preview");
    await waitFor(() => expect(urlPreview).toHaveTextContent(/^[a-z]+-[a-z]+-[a-z]+$/));
    const deploymentName = urlPreview.textContent;
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Research Assistant" } });
    expect(urlPreview).toHaveTextContent(deploymentName!);

    goToPlanStep();

    expect(screen.getByText("1 Medium slot available")).toBeInTheDocument();
    await waitForPackReady();
    fireEvent.click(getPlanCardAction("Launch agent"));

    await waitFor(() => expect(onCreateAgent).toHaveBeenCalled());
    const createParams = onCreateAgent.mock.calls[0]?.[0];
    expect(createParams).toEqual(expect.objectContaining({
      name: deploymentName,
      handle: "research-assistant",
      size: "medium",
    }));
    expect(createParams?.iconIndex).toBe(14);
    expect(createParams?.files.map((file) => file.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "BOOTSTRAP.md",
    ]);
    expect(onOpenPlanCatalog).not.toHaveBeenCalled();
    getRandomValuesSpy.mockRestore();
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

    goToPlanStep();
    await waitForPackReady();
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

    goToPlanStep();

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    expect(screen.getByText("Uses your active direct entitlement")).toBeInTheDocument();
    await waitForPackReady();
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

    goToPlanStep();

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("1 Large slot available")).toBeInTheDocument();
    await waitForPackReady();
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

    goToPlanStep();
    await waitForPackReady();
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

    goToPlanStep();

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

    goToPlanStep();

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

    goToPlanStep();

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Basic",
      "Plus",
    ]);
  });
});
