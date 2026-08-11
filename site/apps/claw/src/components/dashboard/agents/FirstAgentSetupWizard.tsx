"use client";

import React, { type ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Circle,
  Globe,
  Rocket,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { SlotInventory } from "@/lib/format";
import { formatTokens } from "@/lib/format";
import { agentAvatar, randomAgentAvatarIconIndex } from "@/lib/avatar";
import { getOpenClawDefaultImage } from "@/lib/openclaw-launch";
import { parseAgentCapacityError } from "@/lib/agent-tier";
import { generateAgentName } from "@/lib/agent-name";
import { managedAgentHandleFromDisplayName } from "@/lib/agent-profile-updates";
import {
  hasPlanWord,
  isFiveAiuPlan,
  isLegacyAgentPlan,
  isLegacyAgentPlanLabel,
  isVisibleCurrentAgentPlan,
} from "@/lib/agent-plan-catalog";
import {
  deriveLaunchSources,
  getEffectivePlanIdFromSummary,
  type LaunchSourceKind,
} from "@/lib/agent-launch-state";
import {
  clearFirstAgentSetupDraft,
  createFirstAgentSetupId,
  readFirstAgentSetupDraft,
  writeFirstAgentSetupDraft,
} from "@/hooks/useFirstAgentSetupDraft";
import {
  buildDeterministicOpenClawBootstrapPack,
  createOpenClawBootstrapDraft,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapFile,
  type OpenClawBootstrapFileName,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";
import { PlanComparisonModal } from "./PlanComparisonModal";
import { SlotProvisioningStatus } from "./SlotProvisioningStatus";
import { OpenClawBootstrapStep, type OpenClawBootstrapStage } from "./OpenClawBootstrapStep";
import { AgentLoadingState } from "./page-helpers";
import {
  createFirstAgentWizardState,
  firstAgentWizardReducer,
} from "./first-agent-wizard-machine";

export interface FirstAgentSetupCreateParams {
  creationId?: string;
  name: string;
  handle?: string | null;
  iconIndex: number;
  size: string;
  files: File[];
  enableDesktop: boolean;
  enableMemoryIndex?: boolean;
  customImage?: string | null;
  knowledgeDomainId: string | null;
}

export interface KnowledgeDomainOption {
  id: string;
  name: string;
  role: string | null;
}

interface FirstAgentSetupWizardProps {
  onCreateAgent: (params: FirstAgentSetupCreateParams) => Promise<string | null>;
  onGenerateBootstrap?: (
    name: OpenClawBootstrapFileName,
    inputs: OpenClawBootstrapInputs,
  ) => Promise<OpenClawBootstrapFile>;
  onOpenPlanCatalog?: (planId?: string) => void | Promise<void>;
  onClose?: () => void;
  initialPlanId?: string | null;
  selectedCatalogPlanId?: string | null;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  pendingSlotReleases?: Record<string, number>;
  showProFeatureLabels?: boolean;
  enableCustomImageOption?: boolean;
  enforceProFeaturePlanRestrictions?: boolean;
  saveDraftAsYouGo?: boolean;
  skipPlanSelection?: boolean;
  capacityReady?: boolean;
  capacityError?: string | null;
  onRetryCapacity?: () => void;
  capacityContent?: React.ReactNode;
  checkoutActive?: boolean;
  checkoutProcessing?: boolean;
  checkoutContent?: React.ReactNode;
  onBackFromCheckout?: () => void;
  onStartFresh?: () => void;
  draftPrincipalId?: string | null;
  draftWorkspaceId?: string | null;
  knowledgeDomains?: KnowledgeDomainOption[];
  knowledgeDomainsLoading?: boolean;
  size?: "default" | "embedded" | "inline" | "large";
}

type WizardStepId = "identity" | "workspace" | "plan";

const EMPTY_SLOT_INVENTORY: SlotInventory = {};

export { updateFirstAgentSetupDraftPlan } from "@/hooks/useFirstAgentSetupDraft";

const stepCopy: Record<WizardStepId, { title: string; subtitle: string }> = {
  identity: {
    title: "Create agent",
    subtitle: "Give it a display name and choose its initial access. You can change both later.",
  },
  workspace: {
    title: "Set up the workspace",
    subtitle: "Shape the canonical instructions OpenClaw will read when this agent starts.",
  },
  plan: {
    title: "Choose your plan",
    subtitle: "From a single text agent to a full AI workforce.",
  },
};

const steps: WizardStepId[] = ["identity", "workspace", "plan"];

type LaunchPlanAction = "launch" | "plans";

type LaunchPlanOption = {
  id: string;
  catalogPlanId?: string;
  name: string;
  size: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  oldPrice?: string;
  price?: string;
  priceNote?: string;
  statusText?: string;
  cta: string;
  accent?: boolean;
  slotStatus: string;
  features: string[];
  action: LaunchPlanAction;
  disabled?: boolean;
  sortPrice?: number | null;
};

type CatalogPlan = HyperAgentPlan & {
  bundle?: Record<string, number> | null;
  checkoutBundle?: Record<string, number> | null;
  checkout_bundle?: Record<string, number> | null;
  hidden?: boolean;
  meta?: {
    bundle?: Record<string, number> | null;
    checkout_bundle?: Record<string, number> | null;
    hidden?: boolean | null;
    subtitle?: string | null;
  } | null;
  price_usd?: number;
  slotGrants?: Record<string, number> | null;
  slot_grants?: Record<string, number> | null;
  subtitle?: string | null;
};

type ActiveLaunchPlanGroup = {
  id: string;
  catalogPlanId: string;
  tier: string;
  planName: string;
  catalogPlan?: HyperAgentPlan;
  granted: number;
  slotGrants: Record<string, number>;
  sourceCount: number;
  sourceType: LaunchSourceKind;
};

type ChoosePlanCatalog = {
  displayPlans: HyperAgentPlan[];
  catalogById: Map<string, HyperAgentPlan>;
  sourceCatalogById: Map<string, HyperAgentPlan>;
};

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBundle(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([tier, count]) => [tier, Number(count)] as const)
      .filter(([, count]) => Number.isFinite(count) && count > 0),
  );
}

function firstBundle(...bundles: unknown[]): Record<string, number> {
  for (const bundle of bundles) {
    const normalized = normalizeBundle(bundle);
    if (Object.keys(normalized).length > 0) return normalized;
  }
  return {};
}

function catalogSlotBundle(plan: HyperAgentPlan | null | undefined): Record<string, number> {
  if (!plan) return {};
  const catalogPlan = plan as CatalogPlan;
  return firstBundle(
    catalogPlan.slotGrants,
    catalogPlan.slot_grants,
    catalogPlan.bundle,
    catalogPlan.checkoutBundle,
    catalogPlan.checkout_bundle,
    catalogPlan.meta?.bundle,
    catalogPlan.meta?.checkout_bundle,
  );
}

function primaryTierFromBundle(bundle: Record<string, number>): string | null {
  return ["large", "medium", "small", "free"].find((tier) => Number(bundle[tier] || 0) > 0) ?? null;
}

function iconForTier(tier: string | null): ComponentType<{ className?: string }> {
  if (tier === "large") return Rocket;
  if (tier === "medium") return Sparkles;
  return Circle;
}

function uniqueFeatureList(features: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const feature of features) {
    const normalized = feature.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function catalogDescription(plan: HyperAgentPlan): string {
  const catalogPlan = plan as CatalogPlan;
  const subtitle = catalogPlan.subtitle ?? catalogPlan.meta?.subtitle;
  if (subtitle) return subtitle;
  const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
  const tpd = finiteNumber(limits.tpd);
  const rpm = finiteNumber(limits.rpm ?? plan.rpmLimit);
  if (tpd > 0 && rpm > 0) {
    return `${formatTokens(tpd)} tokens/day with ${formatTokens(rpm)} RPM.`;
  }
  if (tpd > 0) {
    return `${formatTokens(tpd)} tokens/day.`;
  }
  return "Plan details are not available yet.";
}

function catalogFeatures(plan: HyperAgentPlan, tier: string | null, bundle: Record<string, number>): string[] {
  const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
  const features = [...(plan.features ?? [])];
  const slotFeatures = Object.entries(bundle)
    .filter(([, count]) => Number(count) > 0)
    .map(([slotTier, count]) => `${count}x ${titleizeTier(slotTier)} launch slot${Number(count) === 1 ? "" : "s"}`);
  const derived = [
    finiteNumber(limits.tpd) > 0 ? `${formatTokens(finiteNumber(limits.tpd))} tokens/day` : null,
    finiteNumber(limits.burstTpm ?? (limits as { burst_tpm?: number }).burst_tpm) > 0
      ? `Up to ${formatTokens(finiteNumber(limits.burstTpm ?? (limits as { burst_tpm?: number }).burst_tpm))} TPM burst`
      : null,
    finiteNumber(limits.rpm ?? plan.rpmLimit) > 0 ? `${formatTokens(finiteNumber(limits.rpm ?? plan.rpmLimit))} RPM` : null,
    tier && slotFeatures.length === 0 ? `${titleizeTier(tier)} launch capacity` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return uniqueFeatureList([...slotFeatures, ...features, ...derived]).slice(0, 7);
}

function catalogPrice(plan: HyperAgentPlan | null | undefined): number | null {
  if (!plan) return null;
  const price = Number((plan as CatalogPlan).priceUsd ?? (plan as CatalogPlan).price_usd ?? plan.price);
  return Number.isFinite(price) ? price : null;
}

function isProPlan(plan: HyperAgentPlan): boolean {
  return hasPlanWord(plan.id, "pro") || hasPlanWord(plan.name, "pro");
}

function isProFeatureEligiblePlan(plan: LaunchPlanOption): boolean {
  const planId = plan.catalogPlanId ?? plan.id;
  return ["pro", "team", "enterprise"].some((word) => (
    hasPlanWord(planId, word) || hasPlanWord(plan.name, word)
  ));
}

function selectProPlan(plans: HyperAgentPlan[]): HyperAgentPlan | null {
  const proPlans = plans.filter(isProPlan);
  return (
    proPlans.find((plan) => plan.name.trim().toLowerCase() === "pro") ??
    proPlans.find((plan) => plan.id.trim().toLowerCase() === "pro") ??
    proPlans.find((plan) => hasPlanWord(plan.name, "pro")) ??
    proPlans[0] ??
    null
  );
}

function buildChoosePlanCatalog(catalogPlans: HyperAgentPlan[] | null | undefined): ChoosePlanCatalog {
  const catalogVisiblePlans = (catalogPlans ?? []).filter((plan) => {
    const catalogPlan = plan as CatalogPlan;
    return !catalogPlan.hidden && !catalogPlan.meta?.hidden;
  });
  const currentPlans = catalogVisiblePlans.filter(isVisibleCurrentAgentPlan);
  const proPlan = selectProPlan(currentPlans);
  const displayPlans = proPlan
    ? currentPlans.filter((plan) => plan.id === proPlan.id || !isFiveAiuPlan(plan))
    : currentPlans;
  const catalogById = new Map<string, HyperAgentPlan>();
  const sourceCatalogById = new Map<string, HyperAgentPlan>();

  for (const plan of catalogVisiblePlans) {
    const displayPlan = proPlan && plan.id !== proPlan.id && isLegacyAgentPlan(plan) ? proPlan : plan;
    catalogById.set(plan.id, displayPlan);
    sourceCatalogById.set(plan.id, plan);
  }

  return { displayPlans, catalogById, sourceCatalogById };
}

function priceLabel(plan: HyperAgentPlan): string {
  return `$${catalogPrice(plan) ?? 0}`;
}

function sortLaunchPlanOptions(options: LaunchPlanOption[]): LaunchPlanOption[] {
  return [...options].sort((a, b) => {
    const aPrice = a.sortPrice ?? Number.POSITIVE_INFINITY;
    const bPrice = b.sortPrice ?? Number.POSITIVE_INFINITY;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return a.name.localeCompare(b.name);
  });
}

function slotStatusLabel({
  tier,
  available,
  granted,
  releasing,
  waiting,
  catalogOnly,
}: {
  tier: string | null;
  available: number;
  granted: number;
  releasing?: number;
  waiting?: boolean;
  catalogOnly?: boolean;
}): string {
  const tierLabel = tier ? titleizeTier(tier) : "Agent";
  const releasingCount = Math.max(Number(releasing || 0), 0);
  if (available > 0) {
    const availableLabel = `${available} ${tierLabel} slot${available === 1 ? "" : "s"} available`;
    return releasingCount > 0
      ? `${availableLabel} - ${releasingCount} releasing`
      : availableLabel;
  }
  if (releasingCount > 0) {
    return `${releasingCount} ${tierLabel} slot${releasingCount === 1 ? "" : "s"} being released`;
  }
  if (waiting) {
    return `${tierLabel} slot provisioning`;
  }
  if (granted > 0) {
    return "No slots available";
  }
  return catalogOnly ? `${tierLabel} slots available after purchase` : `Get a ${tierLabel} slot`;
}

function buildLaunchPlanOptions(
  subscriptionSummary: HyperAgentSubscriptionSummary | null | undefined,
  slotInventory: SlotInventory,
  catalogPlans: HyperAgentPlan[] | null | undefined,
  pendingSlotReleases: Record<string, number> = {},
): LaunchPlanOption[] {
  const {
    displayPlans,
    catalogById,
    sourceCatalogById,
  } = buildChoosePlanCatalog(catalogPlans);
  const activeGroups = new Map<string, ActiveLaunchPlanGroup>();
  const effectivePlanId = getEffectivePlanIdFromSummary(subscriptionSummary);
  const launchSources = deriveLaunchSources({
    subscriptionSummary,
    slotInventory,
    pendingSlotReleases,
    includeInventorySources: true,
  });

  const addActiveGroup = ({
    sourceType,
    planId: rawPlanId,
    planName: rawPlanName,
    slotGrants,
    quantity = 1,
  }: {
    sourceType: LaunchSourceKind;
    planId: string;
    planName?: string | null;
    slotGrants: Record<string, number> | null | undefined;
    quantity?: number;
  }) => {
    const tier = ["large", "medium", "small"].find((candidate) => Number(slotGrants?.[candidate] || 0) > 0);
    if (!tier) return;

    const inventoryCatalogPlan = sourceType === "inventory"
      ? displayPlans.find((plan) => {
          const planTier = primaryTierFromBundle(catalogSlotBundle(plan));
          return (planTier === "free" ? "small" : planTier) === tier;
        })
      : undefined;
    const catalogPlan = catalogById.get(rawPlanId) ?? inventoryCatalogPlan;
    const sourceCatalogPlan = sourceCatalogById.get(rawPlanId);
    const mergedIntoPro = Boolean(
      catalogPlan &&
      sourceCatalogPlan &&
      catalogPlan.id !== sourceCatalogPlan.id &&
      isProPlan(catalogPlan) &&
      isLegacyAgentPlan(sourceCatalogPlan),
    );
    const sourceNameIsLegacy = isLegacyAgentPlanLabel(rawPlanName ?? "");
    const planName = (mergedIntoPro || (catalogPlan && isProPlan(catalogPlan) && sourceNameIsLegacy))
      ? catalogPlan?.name ?? rawPlanName ?? "Pro"
      : sourceType === "inventory"
        ? catalogPlan?.name || rawPlanName || rawPlanId || "Current plan"
        : rawPlanName || catalogPlan?.name || rawPlanId || "Current plan";
    const normalizedPlanName = planName.trim().toLowerCase();
    const planId = catalogPlan?.id || (rawPlanName ? normalizedPlanName : rawPlanId || normalizedPlanName);
    const groupKey = `${sourceType}:${planId}:${tier}`;
    const normalizedQuantity = Math.max(Number(quantity || 1), 1);
    let group = activeGroups.get(groupKey);
    if (!group) {
      group = {
        id: `active:${groupKey}`,
        catalogPlanId: catalogPlan?.id || rawPlanId,
        tier,
        planName,
        catalogPlan,
        granted: 0,
        slotGrants: {},
        sourceCount: 0,
        sourceType,
      };
      activeGroups.set(groupKey, group);
    }

    group.granted += Math.max(Number(slotGrants?.[tier] || 0), 0) * normalizedQuantity;
    group.sourceCount += normalizedQuantity;
    for (const [slotTier, amount] of Object.entries(slotGrants ?? {})) {
      const granted = Math.max(Number(amount || 0), 0) * normalizedQuantity;
      group.slotGrants[slotTier] = (group.slotGrants[slotTier] ?? 0) + granted;
    }
  };

  for (const source of launchSources) {
    if (source.inferenceOnly) continue;
    addActiveGroup({
      sourceType: source.kind,
      planId: source.planId,
      planName: source.planName,
      slotGrants: source.slotGrants,
      quantity: source.quantity,
    });
  }

  const mapped = Array.from(activeGroups.values()).map((group) => {
    const tier = group.tier;
    const catalogPlan = group.catalogPlan;
    const granted = group.granted;
    const inventoryGranted = Math.max(slotInventory[tier]?.granted ?? 0, 0);
    const available = Math.max(slotInventory[tier]?.available ?? 0, 0);
    const releasing = Math.max(Number(pendingSlotReleases[tier] || 0), 0);
    const canLaunch = available > 0;
    const waitingForEntitlement = granted > 0 && inventoryGranted === 0;
    const slotBeingReleased = !canLaunch && !waitingForEntitlement && releasing > 0;
    const activeSourceLabel = group.sourceType === "direct-entitlement"
      ? group.sourceCount > 1
        ? "Uses your active direct entitlements"
        : "Uses your active direct entitlement"
      : group.sourceType === "inventory"
        ? "Uses your active entitlement"
      : group.sourceCount > 1
        ? "Uses your existing active subscriptions"
        : "Uses your existing active subscription";

    return {
      id: group.id,
      catalogPlanId: group.catalogPlanId,
      name: group.planName,
      size: tier,
      icon: iconForTier(tier),
      description: catalogPlan
        ? catalogDescription(catalogPlan)
        : `${titleizeTier(tier)} launch slot from your active ${group.planName} subscription`,
      price: undefined,
      priceNote: undefined,
      statusText: canLaunch
        ? "Ready to launch"
        : waitingForEntitlement
          ? "Payment active, waiting for entitlement"
          : slotBeingReleased
            ? "Slot being released"
            : "No slots available",
      cta: canLaunch ? "Launch agent" : waitingForEntitlement ? "Open plans" : slotBeingReleased ? "Refreshing slots" : "Buy more slots",
      accent: tier === "large",
      slotStatus: slotStatusLabel({ tier, available, granted: inventoryGranted, releasing, waiting: waitingForEntitlement }),
      action: canLaunch ? ("launch" as const) : ("plans" as const),
      disabled: slotBeingReleased,
      sortPrice: catalogPrice(catalogPlan),
      features: catalogPlan ? uniqueFeatureList([
        waitingForEntitlement ? "Launch entitlement is still provisioning" : null,
        slotBeingReleased ? "A deleted agent is releasing this slot" : null,
        activeSourceLabel,
        ...catalogFeatures(catalogPlan, tier, group.slotGrants),
        `${granted}x ${titleizeTier(tier)} slot${granted === 1 ? "" : "s"}`,
        waitingForEntitlement || slotBeingReleased ? null : `${available} free right now`,
      ].filter((feature): feature is string => Boolean(feature))).slice(0, 7) : [
        `${granted}x ${titleizeTier(tier)} slot${granted === 1 ? "" : "s"}`,
        waitingForEntitlement
          ? "Launch entitlement is still provisioning"
          : slotBeingReleased
            ? "A deleted agent is releasing this slot"
            : `${available} free right now`,
        activeSourceLabel,
      ],
    };
  });

  if (mapped.length > 0) return sortLaunchPlanOptions(mapped);

  const effectiveDisplayPlanId = effectivePlanId ? (catalogById.get(effectivePlanId)?.id ?? effectivePlanId) : "";
  const catalogOptions = displayPlans.map((plan) => {
    const bundle = catalogSlotBundle(plan);
    const tier = primaryTierFromBundle(bundle);
    const size = tier === "free" ? "small" : (tier ?? "small");
    const inventoryGranted = tier ? Math.max(slotInventory[size]?.granted ?? 0, 0) : 0;
    const available = tier ? Math.max(slotInventory[size]?.available ?? 0, 0) : 0;
    const releasing = tier ? Math.max(Number(pendingSlotReleases[size] || 0), 0) : 0;
    const isEffectivePlan = Boolean(effectiveDisplayPlanId && effectiveDisplayPlanId === plan.id);
    const canLaunch = Boolean(isEffectivePlan && tier && available > 0);
    const waitingForEntitlement = Boolean(isEffectivePlan && tier && inventoryGranted === 0);
    const slotBeingReleased = Boolean(isEffectivePlan && tier && !canLaunch && !waitingForEntitlement && releasing > 0);
    return {
      id: plan.id,
      catalogPlanId: plan.id,
      name: plan.name,
      size,
      icon: iconForTier(tier),
      description: catalogDescription(plan),
      price: priceLabel(plan),
      priceNote: "USD/month per plan",
      statusText: waitingForEntitlement ? "Payment active, waiting for entitlement" : slotBeingReleased ? "Slot being released" : undefined,
      cta: canLaunch ? "Launch agent" : waitingForEntitlement ? "Open plans" : slotBeingReleased ? "Refreshing slots" : "View plan",
      accent: Boolean(plan.highlighted),
      slotStatus: slotStatusLabel({
        tier,
        available,
        granted: inventoryGranted,
        releasing,
        waiting: waitingForEntitlement,
        catalogOnly: !isEffectivePlan,
      }),
      action: canLaunch ? ("launch" as const) : ("plans" as const),
      disabled: slotBeingReleased,
      sortPrice: catalogPrice(plan),
      features: waitingForEntitlement
        ? uniqueFeatureList(["Launch entitlement is still provisioning", ...catalogFeatures(plan, tier, bundle)]).slice(0, 7)
        : slotBeingReleased
          ? uniqueFeatureList(["A deleted agent is releasing this slot", ...catalogFeatures(plan, tier, bundle)]).slice(0, 7)
        : catalogFeatures(plan, tier, bundle),
    };
  });

  if (catalogOptions.length > 0) return sortLaunchPlanOptions(catalogOptions);

  return [
    {
      id: "plans",
      name: "Plan catalog unavailable",
      size: "small",
      icon: Circle,
      description: "Plan details are not available for this workspace.",
      statusText: "Open Plans",
      cta: "Open plans",
      slotStatus: "No launch slots available",
      action: "plans",
      features: ["Refresh billing data or open the Plans page to choose a current option."],
    },
  ];
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function agentUrlSlug(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized || "agent";
}

function WizardButton({
  children,
  disabled = false,
  busy = false,
  large = false,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  large?: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium transition-colors disabled:opacity-60",
        large
          ? "h-[clamp(2.75rem,4.7vw,3.5rem)] rounded-[14px] px-[clamp(1rem,2.7vw,2rem)] text-[clamp(0.9375rem,1.5vw,1.125rem)]"
          : "h-9 rounded-[10px] px-3.5 text-[14px] sm:h-10 sm:px-4 sm:text-[15px]",
        busy ? "disabled:cursor-wait" : "disabled:cursor-not-allowed",
        variant === "primary"
          ? "bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)]"
          : "border border-border bg-surface-low text-foreground hover:bg-surface-high",
      )}
    >
      {children}
    </button>
  );
}

function WizardMomentum({ stage }: { stage: "resume" | "identity" | OpenClawBootstrapStage | "capacity" | "checkout" }) {
  const reducedMotion = useReducedMotion();
  const progress = stage === "checkout" ? 98 : stage === "capacity" ? 92 : stage === "personality" ? 78 : stage === "objective" ? 64 : 48;
  const status = stage === "checkout"
    ? "One tiny thing..."
    : stage === "capacity"
      ? "Almost there!"
      : stage === "personality"
        ? "Looking good!"
        : stage === "objective"
          ? "Taking shape"
          : stage === "resume"
            ? "Setup saved"
            : "Taking shape";
  const detail = stage === "checkout"
    ? "Then it's ready to run"
    : stage === "capacity"
      ? "Choose the one that fits best"
      : stage === "personality"
        ? "Now shape how it works"
        : stage === "objective"
          ? "Define what it should accomplish"
          : stage === "resume"
            ? "Ready when you are"
            : "Moments from launch";

  return (
    <div
      role="progressbar"
      aria-label="Agent setup progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={`${status}. ${detail}.`}
      className="flex min-w-0 flex-1 flex-col items-center justify-center px-1 text-center sm:px-2"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-border/70">
        <motion.div
          initial={reducedMotion ? false : { width: stage === "checkout" ? "92%" : stage === "capacity" ? "78%" : stage === "personality" ? "64%" : stage === "objective" ? "48%" : "0%" }}
          animate={{ width: `${progress}%` }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="h-full bg-[var(--selection-accent)] shadow-[0_0_14px_rgb(var(--selection-accent-rgb)_/_0.65)]"
        />
      </div>
      {stage !== "resume" ? (
        <>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--selection-accent)] sm:tracking-[0.14em]">
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
            {status}
          </span>
          <span className="mt-0.5 truncate text-[10px] font-medium text-text-muted sm:text-[11px]">{detail}</span>
        </>
      ) : null}
    </div>
  );
}

function ProFeatureBadge() {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-selection-accent/40 bg-selection-accent/10 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-selection-accent">
      Pro
    </span>
  );
}

function LaunchCapacityFallback({
  error,
  onOpenPlanCatalog,
}: {
  error: string;
  onOpenPlanCatalog?: () => void | Promise<void>;
}) {
  const capacityError = React.useMemo(() => parseAgentCapacityError(error), [error]);
  const [openingPlans, setOpeningPlans] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);

  if (!capacityError) {
    return (
      <div className="mb-4 rounded-[12px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const tierLabel = titleizeTier(capacityError.tier);
  const handleAcquireCapacity = async () => {
    setOpenError(null);
    if (!onOpenPlanCatalog) {
      if (typeof window !== "undefined") window.location.assign("/plans");
      return;
    }

    setOpeningPlans(true);
    try {
      await onOpenPlanCatalog();
    } catch (nextError) {
      setOpenError(nextError instanceof Error ? nextError.message : "Plan catalog is unavailable right now.");
    } finally {
      setOpeningPlans(false);
    }
  };

  return (
    <div role="alert" className="elevation-shadow-soft mb-4 rounded-[14px] border border-warning/30 bg-warning/10 p-4 text-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-warning/30 bg-warning/10 text-warning">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{capacityError.title}</p>
          <p className="mt-1 text-[13px] leading-5 text-text-secondary">
            Your {tierLabel} launch slot could not be reserved. Add another slot now, or stop an existing {tierLabel} agent to free capacity.
          </p>

          {(capacityError.requestedInventory || capacityError.accountInventory.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {capacityError.requestedInventory && (
                <span className="rounded-full border border-warning/25 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-warning">
                  Requested {tierLabel}: {capacityError.requestedInventory.free} free / {capacityError.requestedInventory.total} total
                </span>
              )}
              {capacityError.accountInventory.map((entry) => (
                <span key={entry.tier} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                  {entry.tier}: {entry.free} free / {entry.total} total
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => { void handleAcquireCapacity(); }}
              disabled={openingPlans}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[var(--button-primary)] px-3.5 text-[13px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-wait disabled:opacity-70"
            >
              {openingPlans ? "Opening plans..." : `Add ${tierLabel} capacity`}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <span className="text-[12px] leading-4 text-text-muted">Need it immediately? Stop a running {tierLabel} agent and retry.</span>
          </div>

          {openError && <p className="mt-2 text-[12px] text-destructive">{openError}</p>}
        </div>
      </div>
    </div>
  );
}

export function FirstAgentSetupWizard({
  onCreateAgent,
  onGenerateBootstrap,
  onOpenPlanCatalog,
  onClose,
  initialPlanId,
  selectedCatalogPlanId,
  budget,
  subscriptionSummary,
  catalogPlans,
  pendingSlotReleases = {},
  showProFeatureLabels = false,
  enableCustomImageOption = false,
  enforceProFeaturePlanRestrictions = false,
  saveDraftAsYouGo = false,
  skipPlanSelection = false,
  capacityReady = true,
  capacityError = null,
  onRetryCapacity,
  capacityContent,
  checkoutActive = false,
  checkoutProcessing = false,
  checkoutContent,
  onBackFromCheckout,
  onStartFresh,
  draftPrincipalId = null,
  draftWorkspaceId = null,
  knowledgeDomains = [],
  knowledgeDomainsLoading = false,
  size = "default",
}: FirstAgentSetupWizardProps) {
  const [restoredDraft] = React.useState(() => {
    const draft = readFirstAgentSetupDraft();
    if (!draft) return null;
    if (draft.principalId && draft.principalId !== draftPrincipalId) return null;
    if (draft.workspaceId && draftWorkspaceId && draft.workspaceId !== draftWorkspaceId) return null;
    return draft;
  });
  const [setupId] = React.useState(() => restoredDraft?.setupId ?? createFirstAgentSetupId());
  const [draftResumeOpen, setDraftResumeOpen] = React.useState(() => (
    Boolean(restoredDraft && onStartFresh)
  ));
  const [deploymentName, setDeploymentName] = React.useState(restoredDraft?.name ?? "");
  const [agentName, setAgentName] = React.useState(restoredDraft?.displayName ?? "");
  const [agentNameError, setAgentNameError] = React.useState<string | null>(null);
  const agentNameErrorId = React.useId();
  const [selectedCategory] = React.useState(restoredDraft?.category ?? "General");
  const [selectedIconIndex, setSelectedIconIndex] = React.useState(() => restoredDraft?.iconIndex ?? randomAgentAvatarIconIndex());
  const [enableDesktop, setEnableDesktop] = React.useState(restoredDraft?.enableDesktop ?? false);
  const [enableMemoryIndex, setEnableMemoryIndex] = React.useState(restoredDraft?.enableMemoryIndex ?? false);
  const [enableCustomImage, setEnableCustomImage] = React.useState(restoredDraft?.enableCustomImage ?? false);
  const [customImage, setCustomImage] = React.useState(restoredDraft?.customImage ?? "");
  const [customImageEdited, setCustomImageEdited] = React.useState(Boolean(restoredDraft?.customImage));
  const [knowledgeDomainId, setKnowledgeDomainId] = React.useState<string | null>(restoredDraft?.knowledgeDomainId ?? null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [workspaceStage, setWorkspaceStage] = React.useState<OpenClawBootstrapStage>(() => restoredDraft ? "personality" : "objective");
  const [bootstrapDraft, setBootstrapDraft] = React.useState<OpenClawBootstrapDraft>(() => (
    restoredDraft?.bootstrapDraft ?? createOpenClawBootstrapDraft(restoredDraft?.name ?? "Your agent")
  ));
  const bootstrapGenerationRunRef = React.useRef(0);
  const bootstrapInitialGenerationStartedRef = React.useRef(false);
  const slotInventory = budget?.slots ?? EMPTY_SLOT_INVENTORY;
  const planOptions = React.useMemo(
    () => buildLaunchPlanOptions(subscriptionSummary, slotInventory, catalogPlans, pendingSlotReleases),
    [catalogPlans, pendingSlotReleases, slotInventory, subscriptionSummary],
  );
  const [wizardState, dispatchWizard] = React.useReducer(
    firstAgentWizardReducer,
    restoredDraft?.plan || initialPlanId?.trim() || planOptions[0]?.id || "free",
    createFirstAgentWizardState,
  );
  const { stepIndex, selectedPlanId, creating, createError } = wizardState;
  const [planComparisonOpen, setPlanComparisonOpen] = React.useState(false);
  const [openingCapacity, setOpeningCapacity] = React.useState(false);
  const appliedInitialPlanIdRef = React.useRef<string | null>(null);
  const resumedDraftCapacityHandledRef = React.useRef(false);
  const requiresProPlan = enforceProFeaturePlanRestrictions && (enableDesktop || enableMemoryIndex || enableCustomImage);
  const displayedPlanOptions = React.useMemo(() => {
    if (!requiresProPlan) return planOptions;
    return planOptions.map((plan) => {
      if (isProFeatureEligiblePlan(plan)) return plan;
      return {
        ...plan,
        cta: "Pro required",
        disabled: true,
        statusText: "Pro feature selected",
        features: uniqueFeatureList([
          "Desktop, indexing, and custom images require Pro.",
          ...plan.features,
        ]).slice(0, 7),
      };
    });
  }, [planOptions, requiresProPlan]);

  const currentStep = steps[stepIndex];
  const largePresentation = size === "large";
  const embeddedPresentation = size === "embedded";
  const inlinePresentation = size === "inline";
  const widePresentation = embeddedPresentation || inlinePresentation || largePresentation;
  const selectedPlan = displayedPlanOptions.find((plan) => plan.id === selectedPlanId) ?? displayedPlanOptions[0];
  const hasEmbeddedCapacityContent = Boolean(capacityContent);
  const directCapacityFlow = skipPlanSelection && Boolean(hasEmbeddedCapacityContent || onOpenPlanCatalog);
  const embeddedCapacityStep = currentStep === "plan" && directCapacityFlow && hasEmbeddedCapacityContent;
  const embeddedCheckoutStep = embeddedCapacityStep && checkoutActive && Boolean(checkoutContent);
  const currentCopy = draftResumeOpen && restoredDraft
    ? {
        title: "Your agent has a head start.",
        subtitle: "Review what is saved, then continue setting it up without leaving this window.",
      }
    : embeddedCheckoutStep
    ? { title: "Make it official", subtitle: "Choose how you'd like to pay. Your setup stays right here." }
    : embeddedCapacityStep
      ? { title: "Give it room to run", subtitle: "Choose the capacity that fits the work ahead. You can scale it up anytime." }
      : stepCopy[currentStep];
  const focusStage = draftResumeOpen
    ? "resume"
    : embeddedCheckoutStep
      ? "checkout"
      : embeddedCapacityStep
        ? "capacity"
        : currentStep === "workspace"
          ? workspaceStage
          : currentStep;
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const previousFocusStageRef = React.useRef(focusStage);
  const availableLaunchPlan = selectedPlan?.action === "launch" && !selectedPlan.disabled
    ? selectedPlan
    : displayedPlanOptions.find((plan) => plan.action === "launch" && !plan.disabled);
  const selectedPlanIsProvisioning = selectedPlan?.statusText === "Payment active, waiting for entitlement";
  const selectedPlanIsReleasing = selectedPlan?.statusText === "Slot being released";
  const selectedPlanStatusFeature = selectedPlanIsProvisioning || selectedPlanIsReleasing ? null : selectedPlan?.slotStatus;
  const selectedPlanFeatureRows = selectedPlan
    ? uniqueFeatureList([selectedPlanStatusFeature, ...selectedPlan.features].filter((feature): feature is string => Boolean(feature))).slice(0, 7)
    : [];
  const workspaceAgentName = agentName.trim() || deploymentName || "Your agent";
  const agentUrl = agentUrlSlug(deploymentName);
  const ResumeAvatarIcon = agentAvatar(
    restoredDraft?.name ?? deploymentName,
    { ui: { avatar: { icon_index: restoredDraft?.iconIndex ?? selectedIconIndex } } },
  ).icon;
  const restoredCapabilities = restoredDraft
    ? [
        restoredDraft.enableDesktop ? "Browser ready" : null,
        restoredDraft.enableMemoryIndex ? "Memory ready" : null,
      ].filter((capability): capability is string => Boolean(capability))
    : [];
  const defaultCustomImage = getOpenClawDefaultImage(enableDesktop);
  const effectiveCustomImage = customImageEdited ? customImage : defaultCustomImage;
  const runBootstrapGeneration = React.useCallback(async (rawInputs: OpenClawBootstrapInputs) => {
    const runId = bootstrapGenerationRunRef.current + 1;
    bootstrapGenerationRunRef.current = runId;
    const inputs = { ...rawInputs, agentName: workspaceAgentName };
    const fallbackFiles = buildDeterministicOpenClawBootstrapPack(inputs);
    const names = fallbackFiles.map((file) => file.name);

    setBootstrapDraft({
      version: bootstrapDraft.version,
      inputs,
      files: fallbackFiles,
      generationSource: "deterministic",
    });

    if (!onGenerateBootstrap) return;

    let completedCount = 0;
    for (const name of names) {
      if (bootstrapGenerationRunRef.current !== runId) return;
      try {
        const file = await onGenerateBootstrap(name, inputs);
        if (bootstrapGenerationRunRef.current !== runId) return;
        setBootstrapDraft((current) => ({
          ...current,
          files: current.files.map((candidate) => candidate.name === name ? file : candidate),
          generationSource: "mixed",
        }));
        completedCount += 1;
      } catch {
        if (bootstrapGenerationRunRef.current !== runId) return;
      }
    }

    if (bootstrapGenerationRunRef.current !== runId) return;
    setBootstrapDraft((current) => ({
      ...current,
      generationSource: completedCount === names.length
        ? "model"
        : completedCount > 0
          ? "mixed"
          : "deterministic",
    }));
  }, [bootstrapDraft.version, onGenerateBootstrap, workspaceAgentName]);

  const handleBootstrapDraftChange = React.useCallback((nextDraft: OpenClawBootstrapDraft) => {
    bootstrapGenerationRunRef.current += 1;
    setBootstrapDraft(nextDraft);
  }, []);

  React.useEffect(() => {
    if (previousFocusStageRef.current === focusStage) return;
    previousFocusStageRef.current = focusStage;
    const timeout = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [focusStage]);

  React.useEffect(() => {
    if (currentStep !== "workspace" || workspaceStage !== "personality" || bootstrapInitialGenerationStartedRef.current) return;
    bootstrapInitialGenerationStartedRef.current = true;
    void runBootstrapGeneration({ ...bootstrapDraft.inputs, agentName: workspaceAgentName });
  }, [bootstrapDraft.inputs, currentStep, runBootstrapGeneration, workspaceAgentName, workspaceStage]);

  const persistDraft = React.useCallback((plan: LaunchPlanOption | null = null, iconIndex = selectedIconIndex) => {
    const retainedPlanId = selectedCatalogPlanId?.trim() || restoredDraft?.plan || initialPlanId?.trim() || null;
    writeFirstAgentSetupDraft({
      setupId,
      name: deploymentName,
      displayName: agentName.trim(),
      description: `${workspaceAgentName} helps with ${selectedCategory.toLowerCase()} workflows.`,
      size: plan?.size ?? restoredDraft?.size ?? null,
      iconIndex,
      category: selectedCategory,
      plan: plan?.catalogPlanId ?? plan?.id ?? retainedPlanId,
      enableDesktop,
      enableMemoryIndex,
      enableCustomImage,
      customImage: enableCustomImage ? effectiveCustomImage.trim() : "",
      principalId: draftPrincipalId,
      workspaceId: draftWorkspaceId,
      knowledgeDomainId,
      bootstrapDraft,
    });
  }, [
    bootstrapDraft,
    agentName,
    deploymentName,
    draftPrincipalId,
    draftWorkspaceId,
    effectiveCustomImage,
    enableCustomImage,
    enableDesktop,
    enableMemoryIndex,
    initialPlanId,
    knowledgeDomainId,
    restoredDraft?.plan,
    restoredDraft?.size,
    selectedCatalogPlanId,
    selectedCategory,
    selectedIconIndex,
    setupId,
    workspaceAgentName,
  ]);

  const openCapacityCatalog = React.useCallback(async () => {
    if (openingCapacity) return;
    dispatchWizard({ type: "CLEAR_ERROR" });
    persistDraft(selectedPlan ?? null);
    if (hasEmbeddedCapacityContent) {
      dispatchWizard({
        type: "GO_TO_STEP",
        stepIndex: steps.indexOf("plan"),
        maxStepIndex: steps.length - 1,
      });
      return;
    }
    if (!onOpenPlanCatalog) return;
    setOpeningCapacity(true);
    try {
      await onOpenPlanCatalog();
    } catch (error) {
      dispatchWizard({
        type: "CREATE_FAILED",
        message: error instanceof Error ? error.message : "Plan catalog is unavailable right now.",
      });
    } finally {
      setOpeningCapacity(false);
    }
  }, [hasEmbeddedCapacityContent, onOpenPlanCatalog, openingCapacity, persistDraft, selectedPlan]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const generatedName = generateAgentName();
      setDeploymentName((currentName) => currentName.trim() ? currentName : generatedName);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  React.useEffect(() => {
    if (draftResumeOpen || !saveDraftAsYouGo || !deploymentName.trim()) return;
    const timeout = window.setTimeout(() => persistDraft(), 120);
    return () => window.clearTimeout(timeout);
  }, [agentName, deploymentName, draftResumeOpen, persistDraft, saveDraftAsYouGo]);

  React.useEffect(() => {
    if (draftResumeOpen || currentStep === "identity" || !deploymentName.trim()) return;
    const timeout = window.setTimeout(() => persistDraft(selectedPlan ?? null), 120);
    return () => window.clearTimeout(timeout);
  }, [agentName, bootstrapDraft, currentStep, deploymentName, draftResumeOpen, persistDraft, selectedPlan]);

  React.useEffect(() => {
    if (!restoredDraft || draftResumeOpen) return;
    const timeout = window.setTimeout(() => {
      if (directCapacityFlow) setWorkspaceStage("personality");
      dispatchWizard({
        type: "GO_TO_STEP",
        stepIndex: steps.indexOf(directCapacityFlow ? "workspace" : "plan"),
        maxStepIndex: steps.length - 1,
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [directCapacityFlow, draftResumeOpen, restoredDraft]);

  React.useEffect(() => {
    if (
      !restoredDraft ||
      draftResumeOpen ||
      !directCapacityFlow ||
      !capacityReady ||
      availableLaunchPlan ||
      resumedDraftCapacityHandledRef.current
    ) return;

    const timeout = window.setTimeout(() => {
      if (resumedDraftCapacityHandledRef.current) return;
      resumedDraftCapacityHandledRef.current = true;
      void openCapacityCatalog();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [availableLaunchPlan, capacityReady, directCapacityFlow, draftResumeOpen, openCapacityCatalog, restoredDraft]);

  React.useEffect(() => {
    dispatchWizard({
      type: "PLAN_OPTIONS_CHANGED",
      planIds: planOptions.map((plan) => plan.id),
      fallbackPlanId: planOptions[0]?.id ?? "free",
    });
  }, [planOptions]);

  React.useEffect(() => {
    const normalizedPlanId = selectedCatalogPlanId?.trim() || restoredDraft?.plan || initialPlanId?.trim() || null;
    if (!normalizedPlanId) return;
    const matchingPlan = displayedPlanOptions.find((plan) => (
      plan.id === normalizedPlanId || plan.catalogPlanId === normalizedPlanId
    ));
    if (!matchingPlan) return;
    const applicationKey = `${normalizedPlanId}:${matchingPlan.id}`;
    if (appliedInitialPlanIdRef.current === applicationKey) return;
    appliedInitialPlanIdRef.current = applicationKey;
    dispatchWizard({ type: "SELECT_PLAN", planId: matchingPlan.id });
  }, [displayedPlanOptions, initialPlanId, restoredDraft?.plan, selectedCatalogPlanId]);

  const goToStep = (nextStep: number) => {
    dispatchWizard({ type: "GO_TO_STEP", stepIndex: nextStep, maxStepIndex: steps.length - 1 });
  };

  const saveDraftAndCreate = async (planId = selectedPlanId) => {
    if (creating) return;
    const plan = displayedPlanOptions.find((option) => option.id === planId) ?? selectedPlan;
    dispatchWizard({ type: "CLEAR_ERROR" });
    if (!plan) {
      dispatchWizard({ type: "CREATE_FAILED", message: "Plan catalog is unavailable right now." });
      return;
    }
    if (plan.disabled) {
      dispatchWizard({ type: "CREATE_FAILED", message: "Choose a Pro plan to use selected Pro features." });
      return;
    }
    const selectedCustomImage = enableCustomImage ? effectiveCustomImage.trim() : null;
    if (enableCustomImage && !selectedCustomImage) {
      dispatchWizard({ type: "CREATE_FAILED", message: "Custom image is required." });
      return;
    }
    const creationIconIndex = randomAgentAvatarIconIndex();
    setSelectedIconIndex(creationIconIndex);
    persistDraft(plan, creationIconIndex);
    if (plan.action === "plans") {
      if (onOpenPlanCatalog) {
        try {
          await onOpenPlanCatalog(plan.catalogPlanId ?? plan.id);
        } catch (error) {
          dispatchWizard({
            type: "CREATE_FAILED",
            message: error instanceof Error ? error.message : "Plan catalog is unavailable right now.",
          });
        }
      } else if (typeof window !== "undefined") {
        window.location.assign("/plans");
      }
      return;
    }
    if (Math.max(slotInventory[plan.size]?.available ?? 0, 0) <= 0) {
      dispatchWizard({
        type: "CREATE_FAILED",
        message: "Payment may be active, but no launch entitlement slot is available yet. Refresh billing before creating an agent.",
      });
      return;
    }
    dispatchWizard({ type: "CREATE_REQUESTED" });
    try {
      const createdId = await onCreateAgent({
        creationId: setupId,
        name: deploymentName,
        handle: agentName.trim() ? managedAgentHandleFromDisplayName(agentName) : null,
        iconIndex: creationIconIndex,
        size: plan.size,
        files: bootstrapDraft.files.map((file) => (
          new File([file.content], file.name, { type: "text/markdown" })
        )),
        enableDesktop,
        enableMemoryIndex,
        customImage: selectedCustomImage,
        knowledgeDomainId,
      });
      if (createdId && typeof window !== "undefined") {
        clearFirstAgentSetupDraft();
      }
      if (!createdId) {
        dispatchWizard({ type: "CREATE_FINISHED_WITHOUT_ID" });
      }
    } catch (error) {
      dispatchWizard({ type: "CREATE_FAILED", message: error instanceof Error ? error.message : "Failed to create agent" });
    }
  };

  const handlePlanAction = (planId = selectedPlan?.id) => {
    if (!planId || creating) return;
    const plan = displayedPlanOptions.find((option) => option.id === planId);
    if (!plan || plan.disabled) return;
    dispatchWizard({ type: "SELECT_PLAN", planId });
    void saveDraftAndCreate(planId);
  };

  const handleWorkspaceAction = () => {
    if (!directCapacityFlow) {
      goToStep(2);
      return;
    }
    if (!capacityReady || creating || openingCapacity) return;
    if (availableLaunchPlan) {
      handlePlanAction(availableLaunchPlan.id);
      return;
    }
    void openCapacityCatalog();
  };

  const workspaceActionLabel = !directCapacityFlow
    ? "Continue"
    : !capacityReady
      ? capacityError ? "Capacity unavailable" : "Checking capacity..."
      : creating
        ? "Creating..."
        : openingCapacity
          ? "Opening capacity..."
          : availableLaunchPlan
            ? "Launch agent"
            : "Next step";

  if (creating) {
    return (
      <div
        aria-busy="true"
        data-slot="agent-creation-loading"
        className="h-full min-h-0 w-full flex-1"
      >
        <AgentLoadingState
          title="Creating agent"
          detail="Saving your setup and preparing persistent storage."
          tone="starting"
          stage="runtime"
          guided
        />
      </div>
    );
  }

  return (
    <div className={cx(
      "flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center overflow-hidden",
      largePresentation || embeddedPresentation ? "p-0" : inlinePresentation ? "px-4 py-6 sm:p-2" : "px-3 py-3 sm:px-4 sm:py-4",
    )}>
      <motion.section
        aria-labelledby="first-agent-setup-title"
        data-agent-launch-surface={embeddedPresentation || inlinePresentation || undefined}
        data-presentation={embeddedPresentation ? "embedded" : undefined}
        initial={embeddedPresentation || inlinePresentation ? false : { opacity: 0, y: 10 }}
        animate={embeddedPresentation || inlinePresentation ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: embeddedPresentation || inlinePresentation ? 0 : 0.2 }}
        className={cx(
          "relative flex min-h-0 w-full min-w-0 flex-col overflow-hidden border border-border text-foreground",
          embeddedPresentation
            ? "border-0 bg-background shadow-none"
            : inlinePresentation
            ? "bg-surface-low shadow-[0_24px_80px_rgb(0_0_0_/_0.3)]"
            : "elevation-shadow-strong bg-background",
          largePresentation
            ? "h-full max-h-[910px] max-w-[1168px] rounded-[26px]"
            : embeddedPresentation
              ? "h-full max-h-none max-w-none rounded-none"
            : inlinePresentation
              ? "h-full max-h-[680px] max-w-[1168px] rounded-[24px] sm:max-h-[820px]"
              : "h-full max-h-[680px] max-w-[456px] rounded-[20px]",
        )}
      >
        {inlinePresentation ? <div aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--selection-accent-rgb)_/_0.9),transparent)]" /> : null}
        <header data-slot="agent-setup-header" className={cx(
          "relative flex-shrink-0 border-b border-border",
          largePresentation ? "px-5 py-4 sm:px-8 sm:py-7" : "min-h-[82px] px-5 py-3 sm:px-6",
        )}>
          <div className={cx(
            "min-w-0",
            onClose && (largePresentation ? "pr-16" : "pr-10"),
            !draftResumeOpen && currentStep === "plan" && (
              onClose ? "sm:pr-[240px]" : "sm:pr-[190px]"
            ),
          )}>
            <h2 ref={headingRef} tabIndex={-1} className={cx(
              "font-medium leading-tight text-foreground",
              largePresentation ? "text-[24px] sm:text-[36px]" : "text-[20px] sm:text-[22px]",
              !draftResumeOpen && currentStep === "plan" && (onClose ? "pr-[92px] sm:pr-0" : "pr-[72px] sm:pr-0"),
            )} id="first-agent-setup-title">{currentCopy.title}</h2>
            <p className={cx(
              "text-text-muted",
              largePresentation ? "mt-2 text-[13px] leading-5 sm:mt-5 sm:text-[22px] sm:leading-7" : "mt-1 text-[12px] leading-5 sm:text-[13px]",
            )}>{currentCopy.subtitle}</p>
          </div>
          {!draftResumeOpen && currentStep === "plan" && !embeddedCheckoutStep && (
            <div className={cx(
              "absolute top-3 flex items-center justify-end gap-2",
              largePresentation
                ? onClose ? "sm:right-[88px] sm:top-7" : "sm:right-8 sm:top-7"
                : onClose ? "right-[52px] sm:right-[60px] sm:top-4" : "right-4 sm:right-6 sm:top-4 lg:right-7",
            )}>
              <button
                type="button"
                aria-label="Compare plans"
                onClick={() => setPlanComparisonOpen(true)}
                className={cx(
                  "inline-flex shrink-0 items-center justify-center whitespace-nowrap border border-border bg-surface-low font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-high",
                  largePresentation ? "h-12 rounded-[13px] px-5 text-[16px]" : "h-8 rounded-[9px] px-2.5 text-[12px] sm:h-9 sm:rounded-[10px] sm:px-3.5 sm:text-[14px]",
                )}
              >
                <span className="max-sm:hidden">Compare plans</span>
                <span className="sm:hidden">Compare</span>
              </button>
            </div>
          )}
          {onClose ? (
            <button
              type="button"
              aria-label="Close agent creation"
              onClick={onClose}
              disabled={checkoutProcessing}
              className={cx(
                "absolute z-10 flex items-center justify-center rounded-full border border-border bg-background/70 text-text-muted backdrop-blur transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 disabled:cursor-wait disabled:opacity-45",
                largePresentation ? "right-8 top-7 h-12 w-12" : "right-4 top-3 h-8 w-8 sm:right-5",
              )}
            >
              <X className={largePresentation ? "h-5 w-5" : "h-4 w-4"} />
            </button>
          ) : null}
        </header>

        {draftResumeOpen && restoredDraft && onStartFresh && (
          <>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8"
              data-slot="agent-setup-scroll-body"
            >
              <div
                data-slot="saved-agent-draft-summary"
                className="mx-auto flex min-h-full w-full max-w-[760px] items-center"
              >
                <div className="grid w-full gap-7 sm:grid-cols-[minmax(0,1.12fr)_minmax(240px,0.88fr)] sm:items-center sm:gap-9">
                  <div className="min-w-0">
                    <div className="flex items-center gap-4">
                      <span className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-[22px] border border-selection-accent/35 bg-selection-accent/10 text-selection-accent shadow-[0_14px_34px_rgb(0_0_0_/_0.28)]">
                        <ResumeAvatarIcon className="h-8 w-8" aria-hidden="true" />
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-low bg-selection-accent text-selection-accent-foreground">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-selection-accent">Saved agent</p>
                        <h3 className="mt-1 truncate text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[28px]">
                          {restoredDraft.displayName || restoredDraft.name}
                        </h3>
                        <p className="mt-1 truncate text-[12px] font-medium text-text-muted">
                          {agentUrlSlug(restoredDraft.name)}.hypercli.com
                        </p>
                      </div>
                    </div>

                    <p className="mt-6 max-w-[52ch] text-[14px] leading-6 text-text-secondary">
                      The choices below are already saved in this browser. Continue to review the workspace and choose any remaining capacity.
                    </p>

                    {restoredCapabilities.length > 0 ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {restoredCapabilities.map((capability) => (
                          <span key={capability} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/65 px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary">
                            <Check className="h-3 w-3 text-selection-accent" aria-hidden="true" />
                            {capability}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-6 sm:grid-cols-1 sm:border-l sm:border-t-0 sm:py-1 sm:pl-8">
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Identity</dt>
                      <dd className="mt-1.5 flex items-center gap-2 text-[14px] font-semibold text-foreground">
                        <Check className="h-3.5 w-3.5 text-selection-accent" aria-hidden="true" />
                        Saved
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Purpose</dt>
                      <dd className="mt-1.5 truncate text-[14px] font-semibold text-foreground">{restoredDraft.category}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Workspace</dt>
                      <dd className="mt-1.5 text-[14px] font-semibold text-foreground">Review next</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Capacity</dt>
                      <dd className="mt-1.5 text-[14px] font-semibold text-foreground">
                        {restoredDraft.plan ? "Selection saved" : "Choose next"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>

            <footer data-slot="agent-setup-footer" className="relative flex h-[72px] flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-low px-5 sm:px-6">
              <WizardButton variant="secondary" onClick={onStartFresh}>Start fresh</WizardButton>
              <WizardMomentum stage="resume" />
              <WizardButton onClick={() => setDraftResumeOpen(false)}>
                Continue setup
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </WizardButton>
            </footer>
          </>
        )}

        {!draftResumeOpen && currentStep === "identity" && (
          <>
            <div className={cx(
              "min-h-0 flex-1 overflow-y-auto",
              largePresentation ? "px-[clamp(1.25rem,2.7vw,2rem)] py-[clamp(1.25rem,4vw,3rem)]" : "px-5 py-4 sm:px-6",
            )} data-slot="agent-setup-scroll-body">
              <div className={cx("mx-auto grid min-h-full w-full content-center", (embeddedPresentation || inlinePresentation) && "max-w-[660px]")}>
                <label htmlFor="first-agent-name" className={cx(
                  "block font-semibold leading-none text-foreground",
                  largePresentation ? "mb-[clamp(0.75rem,1.7vw,1.25rem)] text-[clamp(0.9375rem,1.7vw,1.25rem)]" : "mb-1.5 text-[13px]",
                )}>Agent name</label>
                <input
                  id="first-agent-name"
                  autoFocus
                  maxLength={64}
                  value={agentName}
                  placeholder="e.g. Research Assistant"
                  aria-invalid={Boolean(agentNameError)}
                  aria-describedby={agentNameError ? agentNameErrorId : undefined}
                  onChange={(event) => {
                    setAgentName(event.target.value);
                    setAgentNameError(null);
                  }}
                  className={cx(
                    "w-full border border-border bg-surface-low text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong",
                    largePresentation ? "h-[clamp(3rem,5.4vw,4rem)] rounded-[18px] px-[clamp(1rem,1.7vw,1.25rem)] text-[clamp(1rem,1.7vw,1.25rem)]" : "h-10 rounded-[10px] px-3 text-[14px]",
                  )}
                />
                {agentNameError ? (
                  <p id={agentNameErrorId} role="alert" className={cx("text-destructive", largePresentation ? "mt-2 text-[13px]" : "mt-1.5 text-[11px]")}>{agentNameError}</p>
                ) : null}

                <div className={largePresentation ? "mt-[clamp(1.5rem,4vw,3rem)]" : "mt-4"}>
                  <span className={cx(
                    "block font-semibold leading-none text-foreground",
                    largePresentation ? "mb-[clamp(0.75rem,1.7vw,1.25rem)] text-[clamp(0.9375rem,1.7vw,1.25rem)]" : "mb-1.5 text-[13px]",
                  )}>Agent URL</span>
                  <div className={cx(
                    "flex overflow-hidden border border-border bg-surface-low text-text-muted",
                    largePresentation ? "h-[clamp(3rem,5.4vw,4rem)] rounded-[18px] text-[clamp(0.9375rem,1.7vw,1.25rem)]" : "h-10 rounded-[10px] text-[13px]",
                  )}>
                    <span className={cx(
                      "flex shrink-0 items-center justify-center border-r border-border text-foreground",
                      largePresentation ? "w-[clamp(3rem,5.4vw,4rem)]" : "w-10",
                    )}>
                      <Globe className={largePresentation ? "h-[clamp(1.25rem,2.4vw,1.75rem)] w-[clamp(1.25rem,2.4vw,1.75rem)]" : "h-4 w-4"} />
                    </span>
                    <output aria-label="Agent URL preview" className={cx("flex min-w-0 flex-1 items-center truncate font-medium", largePresentation ? "px-4 sm:px-5" : "px-3")}>{agentUrl}</output>
                    <span className={cx("flex shrink-0 items-center border-l border-border", largePresentation ? "px-4 sm:px-5" : "px-2.5")}>.hypercli.com</span>
                  </div>
                </div>

                <div className={largePresentation ? "mt-[clamp(1.5rem,4vw,3rem)]" : "mt-4"}>
                  <label htmlFor="first-agent-knowledge-domain" className={cx("block font-semibold leading-tight text-foreground", largePresentation ? "text-[clamp(0.9375rem,1.7vw,1.25rem)]" : "text-[13px]")}>Initial Knowledge Domain</label>
                  <div className={cx("relative", largePresentation ? "mt-3" : "mt-2")}>
                    <select
                      id="first-agent-knowledge-domain"
                      value={knowledgeDomainId ?? ""}
                      onChange={(event) => setKnowledgeDomainId(event.target.value || null)}
                      disabled={knowledgeDomainsLoading}
                      className={cx(
                        "peer w-full appearance-none border border-border bg-background text-foreground outline-none transition-colors focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40 disabled:cursor-wait disabled:opacity-60",
                        largePresentation ? "h-[clamp(3rem,5.4vw,4rem)] rounded-[18px] pl-4 pr-14 text-[clamp(0.9375rem,1.7vw,1.125rem)]" : "h-10 rounded-[10px] pl-3 pr-10 text-[13px]",
                      )}
                    >
                      <option value="">{knowledgeDomainsLoading ? "Loading Domains..." : "No Domain"}</option>
                      {knowledgeDomains.map((domain) => (
                        <option key={domain.id} value={domain.id} disabled={domain.role?.toLowerCase() !== "admin"}>
                          {domain.name}{domain.role?.toLowerCase() === "admin" ? "" : " (admin access required)"}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className={cx(
                      "pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted transition-colors peer-focus:text-foreground peer-disabled:opacity-60",
                      largePresentation ? "right-5 h-5 w-5" : "right-3 h-4 w-4",
                    )} />
                  </div>
                  <p className={cx("text-text-muted", largePresentation ? "mt-2 text-[13px] leading-5" : "mt-1.5 text-[11px] leading-4")}>Assign only the business knowledge this agent needs. You can change Domain access later.</p>
                </div>

                <details
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                  className={cx(
                    "group overflow-hidden border border-border bg-surface-high",
                    largePresentation ? "mt-[clamp(2rem,3.4vw,2.5rem)] rounded-[18px]" : "mt-4 rounded-[11px]",
                  )}
                >
                  <summary className={cx(
                    "flex cursor-pointer list-none items-center outline-none transition-colors hover:bg-surface-low focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection-accent/40 [&::-webkit-details-marker]:hidden",
                    largePresentation ? "gap-[clamp(0.75rem,1.35vw,1rem)] px-[clamp(1.25rem,2vw,1.5rem)] py-[clamp(1.25rem,2vw,1.5rem)]" : "gap-2.5 px-3.5 py-3",
                  )}>
                    <Settings2 className={cx("shrink-0 text-foreground", largePresentation ? "h-[clamp(1.25rem,2.4vw,1.75rem)] w-[clamp(1.25rem,2.4vw,1.75rem)]" : "h-4.5 w-4.5")} />
                    <span className={cx("min-w-0 flex-1 font-semibold text-foreground", largePresentation ? "text-[clamp(1.0625rem,1.9vw,1.375rem)]" : "text-[13px]")}>Advanced</span>
                    <ChevronDown className={cx("shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180", largePresentation ? "h-[clamp(1.25rem,2vw,1.5rem)] w-[clamp(1.25rem,2vw,1.5rem)]" : "h-4 w-4")} />
                  </summary>

                  <div className={cx("border-t border-border", largePresentation ? "px-5 py-5 sm:px-6 sm:py-6" : "px-3.5 py-3")}>
                    {enableCustomImageOption ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <label htmlFor="first-agent-custom-image" className={cx("font-semibold leading-tight text-foreground", largePresentation ? "text-[16px] sm:text-[20px]" : "text-[12px]")}>Custom image</label>
                          {showProFeatureLabels ? <ProFeatureBadge /> : null}
                        </div>
                        <input
                          id="first-agent-custom-image"
                          value={enableCustomImage ? effectiveCustomImage : ""}
                          onChange={(event) => {
                            const nextImage = event.target.value;
                            setCustomImageEdited(true);
                            setCustomImage(nextImage);
                            setEnableCustomImage(Boolean(nextImage.trim()));
                          }}
                          aria-label="Custom agent image"
                          placeholder="ghcr.io/example/openclaw:latest"
                          spellCheck={false}
                          className={cx(
                            "w-full border border-border bg-background font-mono text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong",
                            largePresentation ? "mt-3 h-12 rounded-[13px] px-4 text-[13px] sm:h-14 sm:text-[15px]" : "mt-2 h-9 rounded-[9px] px-2.5 text-[11px]",
                          )}
                        />
                        <p className={cx("text-text-muted", largePresentation ? "mt-2 text-[13px] leading-5" : "mt-1 text-[11px] leading-4")}>Use a custom container image instead of the default.</p>
                      </div>
                    ) : null}

                    <div className={cx("grid sm:grid-cols-2", largePresentation ? "gap-3 sm:gap-4" : "gap-2", enableCustomImageOption && (largePresentation ? "mt-5" : "mt-3"))}>
                      <label className={cx("flex items-start border border-border bg-background", largePresentation ? "gap-3 rounded-[14px] px-4 py-4" : "gap-2 rounded-[10px] px-3 py-2.5")}>
                        <input
                          type="checkbox"
                          checked={enableDesktop}
                          onChange={(event) => setEnableDesktop(event.target.checked)}
                          className={cx("mt-1 rounded border-border bg-background accent-[var(--button-primary)]", largePresentation ? "h-5 w-5" : "h-4 w-4")}
                        />
                        <span className="min-w-0">
                          <span className={cx("flex items-center gap-1.5 font-semibold leading-tight text-foreground", largePresentation ? "text-[15px]" : "text-[12px]")}>
                            Desktop browser
                            {showProFeatureLabels ? <ProFeatureBadge /> : null}
                          </span>
                          <span className={cx("mt-1 block text-text-muted", largePresentation ? "text-[13px] leading-5" : "text-[11px] leading-4")}>Private browser for visual tasks.</span>
                        </span>
                      </label>

                      <label className={cx("flex items-start border border-border bg-background", largePresentation ? "gap-3 rounded-[14px] px-4 py-4" : "gap-2 rounded-[10px] px-3 py-2.5")}>
                        <input
                          type="checkbox"
                          checked={enableMemoryIndex}
                          onChange={(event) => setEnableMemoryIndex(event.target.checked)}
                          className={cx("mt-1 rounded border-border bg-background accent-[var(--button-primary)]", largePresentation ? "h-5 w-5" : "h-4 w-4")}
                        />
                        <span className="min-w-0">
                          <span className={cx("flex items-center gap-1.5 font-semibold leading-tight text-foreground", largePresentation ? "text-[15px]" : "text-[12px]")}>
                            Memory indexing
                            {showProFeatureLabels ? <ProFeatureBadge /> : null}
                          </span>
                          <span className={cx("mt-1 block text-text-muted", largePresentation ? "text-[13px] leading-5" : "text-[11px] leading-4")}>Searchable workspace memory.</span>
                        </span>
                      </label>
                    </div>
                  </div>
                </details>
              </div>
            </div>

            <footer data-slot="agent-setup-footer" className={cx(
              "relative flex flex-shrink-0 items-center gap-2 border-t border-border bg-surface-low",
              onClose ? "justify-between" : "justify-end",
              largePresentation ? "h-[clamp(5.125rem,10vw,7.375rem)] px-[clamp(1.25rem,2.7vw,2rem)]" : "h-[72px] px-5 sm:px-6",
            )}>
              {onClose ? <WizardButton large={largePresentation} variant="secondary" onClick={onClose}>Cancel</WizardButton> : null}
              {largePresentation ? null : <WizardMomentum stage="identity" />}
              <WizardButton onClick={() => {
                if (agentName.trim()) {
                  try {
                    managedAgentHandleFromDisplayName(agentName);
                  } catch (error) {
                    setAgentNameError(error instanceof Error ? error.message : "Enter a valid display name.");
                    return;
                  }
                }
                if (saveDraftAsYouGo) persistDraft();
                setWorkspaceStage("objective");
                goToStep(1);
              }} large={largePresentation}>Continue</WizardButton>
            </footer>
          </>
        )}

        {!draftResumeOpen && currentStep === "workspace" && (
          <>
            <div
              data-slot="agent-setup-scroll-body"
              className={cx(
                "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
                largePresentation ? "px-5 py-5 sm:px-8 sm:py-7" : inlinePresentation ? "px-5 py-3 sm:px-6" : "px-5 py-4 sm:px-6",
              )}
            >
              {createError && (
                <LaunchCapacityFallback
                  error={createError}
                  onOpenPlanCatalog={hasEmbeddedCapacityContent ? openCapacityCatalog : onOpenPlanCatalog}
                />
              )}
              {directCapacityFlow && capacityError ? (
                <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                  <span>{capacityError}</span>
                  {onRetryCapacity ? (
                    <button
                      type="button"
                      onClick={onRetryCapacity}
                      className="rounded-md border border-current/30 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-destructive/10"
                    >
                      Retry billing data
                    </button>
                  ) : null}
                </div>
              ) : null}
              <OpenClawBootstrapStep
                agentName={workspaceAgentName}
                draft={bootstrapDraft}
                stage={workspaceStage}
                onChange={handleBootstrapDraftChange}
                wide={widePresentation}
              />
            </div>
            <footer data-slot="agent-setup-footer" className={cx(
              "relative flex flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-low",
              largePresentation ? "h-[82px] px-5 sm:h-[104px] sm:px-8" : "h-[72px] px-5 sm:px-6",
            )}>
              <WizardButton
                large={largePresentation}
                variant="secondary"
                onClick={() => {
                  if (workspaceStage === "personality") {
                    setWorkspaceStage("objective");
                    return;
                  }
                  goToStep(0);
                }}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </WizardButton>
              {largePresentation ? null : <WizardMomentum stage={workspaceStage} />}
              <WizardButton
                large={largePresentation}
                disabled={workspaceStage === "personality" && directCapacityFlow && (!capacityReady || creating || openingCapacity)}
                busy={workspaceStage === "personality" && directCapacityFlow && (creating || openingCapacity)}
                onClick={() => {
                  if (workspaceStage === "objective") {
                    setWorkspaceStage("personality");
                    return;
                  }
                  handleWorkspaceAction();
                }}
              >
                {workspaceStage === "objective" ? "Continue" : workspaceActionLabel}
              </WizardButton>
            </footer>
          </>
        )}

        {!draftResumeOpen && currentStep === "plan" && (embeddedCapacityStep ? (
          <>
            <div className="flex min-h-0 flex-1">
              {embeddedCheckoutStep ? checkoutContent : capacityContent}
            </div>
            <footer data-slot="agent-setup-footer" className={cx(
              "relative flex flex-shrink-0 items-center gap-2 border-t border-border bg-surface-low",
              largePresentation ? "h-[82px] px-5 sm:h-[104px] sm:px-8" : "h-[72px] px-5 sm:px-6",
            )}>
              <div className="flex min-w-0 flex-1 justify-start">
                <WizardButton
                  large={largePresentation}
                  variant="secondary"
                  disabled={checkoutProcessing}
                  onClick={() => {
                    if (embeddedCheckoutStep && onBackFromCheckout) {
                      onBackFromCheckout();
                      return;
                    }
                    goToStep(1);
                  }}
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back
                </WizardButton>
              </div>
              {largePresentation ? null : <WizardMomentum stage={embeddedCheckoutStep ? "checkout" : "capacity"} />}
              <div aria-hidden="true" className="min-w-0 flex-1" />
            </footer>
          </>
        ) : (
          <>
            <div data-slot="agent-setup-scroll-body" className={cx("min-h-0 flex-1 overflow-y-auto", largePresentation ? "px-5 py-5 sm:px-8 sm:py-7" : "px-5 py-5 sm:px-6 lg:px-7")}>
              {createError && <LaunchCapacityFallback error={createError} onOpenPlanCatalog={onOpenPlanCatalog} />}
              <div role="group" aria-label="Available plans" className={cx(
                "grid min-h-0",
                largePresentation ? "gap-3 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]" : "gap-2",
              )}>
                {displayedPlanOptions.map((plan) => {
                  const Icon = plan.icon;
                  const isReleasing = plan.statusText === "Slot being released";
                  const selected = selectedPlanId === plan.id;
                  return (
                    <button
                      type="button"
                      key={plan.id}
                      aria-pressed={selected}
                      disabled={plan.disabled}
                      onClick={() => {
                        dispatchWizard({ type: "SELECT_PLAN", planId: plan.id });
                        if (saveDraftAsYouGo) persistDraft(plan);
                      }}
                      className={cx(
                        "group relative flex w-full items-center overflow-hidden border bg-surface-low text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        largePresentation ? "min-h-[92px] gap-3.5 rounded-[15px] px-4 py-4" : "min-h-[68px] gap-3 rounded-[11px] px-3.5 py-3",
                        selected
                          ? "border-selection-accent/65 bg-[rgb(var(--selection-accent-rgb)_/_0.055)] shadow-[inset_3px_0_0_var(--selection-accent)]"
                          : "border-border hover:border-border-strong hover:bg-surface-high",
                        plan.disabled && "cursor-not-allowed opacity-55 hover:border-border hover:bg-surface-low",
                        isReleasing && "cursor-wait",
                      )}
                    >
                      <span className={cx(
                        "flex shrink-0 items-center justify-center border transition-colors",
                        largePresentation ? "h-11 w-11 rounded-[12px]" : "h-9 w-9 rounded-[9px]",
                        selected
                          ? "border-selection-accent/45 bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-selection-accent"
                          : "border-border bg-surface-high text-foreground",
                      )}>
                        <Icon className={largePresentation ? "h-5 w-5" : "h-4 w-4"} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <h3 className={cx("truncate font-semibold leading-tight text-foreground", largePresentation ? "text-[18px]" : "text-[16px]")}>{plan.name}</h3>
                          {plan.accent ? (
                            <span className="shrink-0 rounded-full bg-selection-accent px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-selection-accent-foreground">
                              Most Popular
                            </span>
                          ) : null}
                        </span>
                        <span className={cx("mt-1 block truncate leading-4", largePresentation ? "text-[12px]" : "text-[11px]", plan.disabled ? "text-warning" : "text-text-muted")}>
                          {plan.disabled ? plan.cta : plan.description}
                        </span>
                      </span>
                      <span className="flex max-w-[94px] shrink-0 flex-col items-end text-right">
                        {plan.oldPrice ? <span className="text-[10px] leading-none text-text-muted line-through">{plan.oldPrice}</span> : null}
                        {plan.price ? (
                          <>
                            <span className={cx("font-bold leading-none text-foreground", largePresentation ? "text-[24px]" : "text-[20px]")}>{plan.price}</span>
                            <span className="mt-1 text-[9px] font-medium leading-none text-text-muted">per plan / mo</span>
                          </>
                        ) : (
                          <span className={cx("text-[11px] font-semibold leading-tight", isReleasing ? "text-warning" : "text-foreground")}>
                            {plan.statusText ?? "Already active"}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedPlan ? (
                <div className={cx(
                  "border border-border bg-background/65 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.025)]",
                  largePresentation ? "mt-4 rounded-[16px] p-5" : "mt-3 rounded-[12px] p-3.5",
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">What&apos;s included</p>
                    {selectedPlan.price && selectedPlan.statusText ? (
                      <span className="max-w-[132px] shrink-0 text-right text-[10px] font-semibold leading-4 text-warning">{selectedPlan.statusText}</span>
                    ) : null}
                  </div>

                  {selectedPlanIsProvisioning || selectedPlanIsReleasing ? (
                    <SlotProvisioningStatus
                      status={selectedPlan.slotStatus}
                      detail={selectedPlanIsReleasing ? "Refreshing slot availability" : undefined}
                    />
                  ) : null}

                  <div className={cx(
                    "grid border-t border-border",
                    largePresentation ? "mt-3 gap-x-6 gap-y-3 pt-4 sm:grid-cols-2 lg:grid-cols-3" : "mt-2.5 gap-x-4 gap-y-2 pt-3 sm:grid-cols-2",
                  )}>
                    {selectedPlanFeatureRows.map((feature, featureIndex) => (
                      <div key={`${selectedPlan.id}-${featureIndex}-${feature}`} className={cx("flex min-w-0 items-start text-foreground", largePresentation ? "gap-2.5 text-[13px] leading-5" : "gap-2 text-[11px] leading-4")}>
                        <Check className={cx("mt-0.5 flex-shrink-0 text-text-muted", largePresentation ? "h-4 w-4" : "h-3.5 w-3.5")} />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
          </div>
          <footer data-slot="agent-setup-footer" className={cx(
            "relative flex flex-shrink-0 items-center gap-2 border-t border-border bg-surface-low",
            largePresentation ? "h-[82px] justify-between px-5 sm:h-[104px] sm:px-8" : "h-[72px] px-5 sm:px-6",
          )}>
            <WizardButton large={largePresentation} variant="secondary" onClick={() => goToStep(1)}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </WizardButton>
            {largePresentation ? null : <WizardMomentum stage="capacity" />}
            <WizardButton
              large={largePresentation}
              disabled={!selectedPlan || creating || Boolean(selectedPlan.disabled)}
              busy={creating || selectedPlanIsReleasing}
              onClick={() => handlePlanAction()}
            >
              {creating ? "Creating..." : selectedPlan?.cta ?? "Continue"}
            </WizardButton>
          </footer>
          </>
        ))}
      </motion.section>
      <PlanComparisonModal
        open={planComparisonOpen}
        onClose={() => setPlanComparisonOpen(false)}
        catalogPlans={catalogPlans}
      />
    </div>
  );
}
