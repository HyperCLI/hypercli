"use client";

import React, { type ComponentType } from "react";
import { motion } from "framer-motion";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  Circle,
  FileText,
  Package,
  Rocket,
  Shield,
  Sparkles,
  Monitor,
  X,
  Zap,
} from "lucide-react";
import type { SlotInventory } from "@/lib/format";
import { formatTokens } from "@/lib/format";
import { getOpenClawDefaultImage } from "@/lib/openclaw-launch";
import { parseAgentCapacityError } from "@/lib/agent-tier";
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
import { agentAvatar } from "@/lib/avatar";
import { PlanComparisonModal } from "./PlanComparisonModal";
import { SlotProvisioningStatus } from "./SlotProvisioningStatus";
import {
  createFirstAgentWizardState,
  firstAgentWizardReducer,
} from "./first-agent-wizard-machine";

export interface FirstAgentSetupCreateParams {
  name: string;
  iconIndex: number;
  size: string;
  files: File[];
  enableDesktop: boolean;
  enableMemoryIndex?: boolean;
  customImage?: string | null;
}

interface FirstAgentSetupWizardProps {
  onCreateAgent: (params: FirstAgentSetupCreateParams) => Promise<string | null>;
  onOpenPlanCatalog?: () => void | Promise<void>;
  onClose?: () => void;
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
}

type WizardStepId = "identity" | "knowledge" | "plan";

const FIRST_AGENT_SETUP_DRAFT_KEY = "hypercli-first-agent-draft";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const EMPTY_SLOT_INVENTORY: SlotInventory = {};

const helpCategories = ["General", "Research", "Support", "Sales", "Ops", "Dev", "Content", "Automation"];

const avatarOptions: Array<{
  iconIndex: number;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { iconIndex: 0, label: "Bot avatar", icon: Bot },
  { iconIndex: 1, label: "Brain avatar", icon: Brain },
  { iconIndex: 12, label: "Shield avatar", icon: Shield },
  { iconIndex: 11, label: "Rocket avatar", icon: Rocket },
  { iconIndex: 15, label: "Lightning avatar", icon: Zap },
];

const stepCopy: Record<WizardStepId, { title: string; subtitle: string }> = {
  identity: {
    title: "Create your agent",
    subtitle: "Give it a name, a look, and a quick note on what it does. You can change anything later.",
  },
  knowledge: {
    title: "Give it something to know",
    subtitle: "Add a file so your agent has real context.",
  },
  plan: {
    title: "Choose your plan",
    subtitle: "From a single text agent to a full AI workforce.",
  },
};

const steps: WizardStepId[] = ["identity", "knowledge", "plan"];
const agentNameFirstWords = [
  "bright",
  "clear",
  "fresh",
  "rapid",
  "solar",
  "quiet",
  "prime",
  "silver",
  "steady",
  "swift",
];
const agentNameSecondWords = [
  "atlas",
  "beam",
  "forge",
  "harbor",
  "matrix",
  "orbit",
  "pilot",
  "signal",
  "vector",
  "window",
];
const agentNameThirdWords = [
  "anchor",
  "bridge",
  "engine",
  "field",
  "garden",
  "lab",
  "node",
  "studio",
  "tower",
  "works",
];
const blockedAgentNameWords = new Set(["signal"]);

type LaunchPlanAction = "launch" | "plans";

type LaunchPlanOption = {
  id: string;
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

function isBasicOrPlusPlanOption(plan: LaunchPlanOption): boolean {
  return hasPlanWord(plan.id, "basic") ||
    hasPlanWord(plan.name, "basic") ||
    hasPlanWord(plan.id, "plus") ||
    hasPlanWord(plan.name, "plus");
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
      name: plan.name,
      size,
      icon: iconForTier(tier),
      description: catalogDescription(plan),
      price: priceLabel(plan),
      priceNote: "USD/month per agent",
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function randomIndex(max: number): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function pickAgentNameWord(words: string[]): string {
  const allowedWords = words.filter((word) => !blockedAgentNameWords.has(word.toLowerCase()));
  const pool = allowedWords.length > 0 ? allowedWords : words;
  return pool[randomIndex(pool.length)] ?? "agent";
}

function generateAgentName(): string {
  const first = pickAgentNameWord(agentNameFirstWords);
  const second = pickAgentNameWord(agentNameSecondWords);
  const third = pickAgentNameWord(agentNameThirdWords);
  return `${first}-${second}-${third}`;
}

function WizardButton({
  children,
  disabled = false,
  busy = false,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-9 items-center justify-center rounded-[10px] px-3.5 text-[14px] font-medium transition-colors disabled:opacity-60 sm:h-10 sm:px-4 sm:text-[15px]",
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
    <div role="alert" className="mb-4 rounded-[14px] border border-warning/30 bg-warning/10 p-4 text-sm shadow-[0_16px_40px_color-mix(in_srgb,var(--foreground)_10%,transparent)]">
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
  onOpenPlanCatalog,
  onClose,
  budget,
  subscriptionSummary,
  catalogPlans,
  pendingSlotReleases = {},
  showProFeatureLabels = false,
  enableCustomImageOption = false,
  enforceProFeaturePlanRestrictions = false,
}: FirstAgentSetupWizardProps) {
  const [defaultAgentName, setDefaultAgentName] = React.useState("");
  const [agentName, setAgentName] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("General");
  const [selectedIconIndex, setSelectedIconIndex] = React.useState(avatarOptions[0].iconIndex);
  const [enableDesktop, setEnableDesktop] = React.useState(false);
  const [enableMemoryIndex, setEnableMemoryIndex] = React.useState(false);
  const [enableCustomImage, setEnableCustomImage] = React.useState(false);
  const [customImage, setCustomImage] = React.useState("");
  const [customImageEdited, setCustomImageEdited] = React.useState(false);
  const slotInventory = budget?.slots ?? EMPTY_SLOT_INVENTORY;
  const planOptions = React.useMemo(
    () => buildLaunchPlanOptions(subscriptionSummary, slotInventory, catalogPlans, pendingSlotReleases),
    [catalogPlans, pendingSlotReleases, slotInventory, subscriptionSummary],
  );
  const [wizardState, dispatchWizard] = React.useReducer(
    firstAgentWizardReducer,
    planOptions[0]?.id ?? "free",
    createFirstAgentWizardState,
  );
  const { stepIndex, selectedPlanId, creating, createError } = wizardState;
  const [files, setFiles] = React.useState<File[]>([]);
  const [planComparisonOpen, setPlanComparisonOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const requiresProPlan = enforceProFeaturePlanRestrictions && (enableDesktop || enableMemoryIndex || enableCustomImage);
  const displayedPlanOptions = React.useMemo(() => {
    if (!requiresProPlan) return planOptions;
    return planOptions.map((plan) => {
      if (!isBasicOrPlusPlanOption(plan)) return plan;
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
  const currentCopy = stepCopy[currentStep];
  const selectedPlan = displayedPlanOptions.find((plan) => plan.id === selectedPlanId) ?? displayedPlanOptions[0];
  const selectedAvatar = avatarOptions.find((option) => option.iconIndex === selectedIconIndex) ?? avatarOptions[0];
  const SelectedAvatarIcon = selectedAvatar.icon;
  const displayName = agentName.trim() || defaultAgentName || "agent";
  const selectedAvatarStyle = agentAvatar(displayName, { ui: { avatar: { icon_index: selectedIconIndex } } });
  const defaultCustomImage = getOpenClawDefaultImage(enableDesktop);
  const effectiveCustomImage = customImageEdited ? customImage : defaultCustomImage;

  React.useEffect(() => {
    const generatedName = generateAgentName();
    setDefaultAgentName(generatedName);
    setAgentName((currentName) => currentName.trim() ? currentName : generatedName);
  }, []);

  React.useEffect(() => {
    dispatchWizard({
      type: "PLAN_OPTIONS_CHANGED",
      planIds: planOptions.map((plan) => plan.id),
      fallbackPlanId: planOptions[0]?.id ?? "free",
    });
  }, [planOptions]);

  const goToStep = (nextStep: number) => {
    dispatchWizard({ type: "GO_TO_STEP", stepIndex: nextStep, maxStepIndex: steps.length - 1 });
  };

  const handleFileSelection = (fileList: FileList | null) => {
    if (!fileList) return;
    setFiles(Array.from(fileList).filter((file) => file.size <= MAX_FILE_SIZE).slice(0, 4));
  };

  const persistDraft = (plan: LaunchPlanOption) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        FIRST_AGENT_SETUP_DRAFT_KEY,
        JSON.stringify({
          source: "first-agent-setup",
          name: displayName,
          description: `${displayName} helps with ${selectedCategory.toLowerCase()} workflows.`,
          size: plan.size,
          iconIndex: selectedIconIndex,
          category: selectedCategory,
          plan: plan.id,
          starterFiles: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
          enableDesktop,
          enableMemoryIndex,
          enableCustomImage,
          customImage: enableCustomImage ? effectiveCustomImage.trim() : null,
        }),
      );
    }
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
    persistDraft(plan);
    const selectedCustomImage = enableCustomImage ? effectiveCustomImage.trim() : null;
    if (enableCustomImage && !selectedCustomImage) {
      dispatchWizard({ type: "CREATE_FAILED", message: "Custom image is required." });
      return;
    }
    if (plan.action === "plans") {
      if (onOpenPlanCatalog) {
        try {
          await onOpenPlanCatalog();
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
        name: displayName,
        iconIndex: selectedIconIndex,
        size: plan.size,
        files,
        enableDesktop,
        enableMemoryIndex,
        customImage: selectedCustomImage,
      });
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

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex h-full max-h-[680px] min-h-0 w-full max-w-[980px] flex-col overflow-hidden rounded-[20px] border border-border bg-background text-foreground shadow-[0_20px_56px_color-mix(in_srgb,var(--foreground)_16%,transparent)]"
      >
        <header className="relative flex-shrink-0 border-b border-border px-5 py-4 sm:px-6 lg:px-7">
          <div className={cx("min-w-0", currentStep === "plan" && "sm:pr-[190px]")}>
            <h2 className="text-[20px] font-medium leading-tight text-foreground sm:text-[24px]">{currentCopy.title}</h2>
            <p className="mt-2 text-[13px] leading-snug text-text-muted sm:text-[15px] lg:text-[16px]">{currentCopy.subtitle}</p>
          </div>
          {currentStep === "plan" && (
            <div className="mt-4 flex items-center justify-end gap-2 sm:absolute sm:right-6 sm:top-4 sm:mt-0 lg:right-7">
              <button
                type="button"
                onClick={() => setPlanComparisonOpen(true)}
                className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border border-border bg-surface-low px-3.5 text-[14px] font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-high"
              >
                Compare plans
              </button>
              {onClose ? (
                <button
                  type="button"
                  aria-label="Close choose plan"
                  onClick={onClose}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-low text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-high hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          )}
        </header>

        {currentStep === "identity" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              <div className="grid gap-5 md:grid-cols-[72px_minmax(0,1fr)] md:items-center lg:grid-cols-[80px_minmax(0,1fr)]">
                <div className="relative mx-auto h-[72px] w-[72px] md:mx-0 lg:h-20 lg:w-20">
                  <div
                    className="flex h-[72px] w-[72px] items-center justify-center rounded-full lg:h-20 lg:w-20"
                    style={{
                      backgroundColor: selectedAvatarStyle.bgColor,
                      color: selectedAvatarStyle.fgColor,
                    }}
                  >
                    <SelectedAvatarIcon className="h-7 w-7 lg:h-8 lg:w-8" />
                  </div>
                </div>

                <label className="block min-w-0">
                  <span className="mb-2 block text-[14px] font-semibold leading-none text-foreground sm:text-[16px]">Agent name</span>
                  <input
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    className="h-10 w-full rounded-[12px] border border-border bg-surface-low px-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong sm:h-11 sm:text-[16px] lg:h-12"
                  />
                </label>
              </div>

              <div className="mt-7 lg:mt-8">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-foreground sm:text-[16px]">What does it help with?</p>
                <div className="flex flex-wrap gap-2">
                  {helpCategories.map((category) => {
                    const selected = selectedCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedCategory(category)}
                        className={cx(
                           "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold leading-none transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-[14px]",
                           selected
                             ? "border-selection-accent/70 bg-surface-high text-selection-accent shadow-[0_0_0_1px_color-mix(in_srgb,var(--selection-accent)_38%,transparent)]"
                             : "border-border bg-surface-high text-text-secondary shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_3%,transparent)] hover:border-border-strong hover:bg-surface-low hover:text-foreground",
                        )}
                      >
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-foreground sm:text-[16px]">Avatar</p>
                <div className="flex flex-wrap gap-2">
                  {avatarOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = selectedIconIndex === option.iconIndex;
                    const avatarStyle = agentAvatar(displayName, { ui: { avatar: { icon_index: option.iconIndex } } });
                    return (
                      <button
                        key={option.iconIndex}
                        type="button"
                        aria-label={option.label}
                        aria-pressed={selected}
                        onClick={() => setSelectedIconIndex(option.iconIndex)}
                        className={cx(
                          "flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors",
                          selected
                            ? "border-selection-accent shadow-[0_0_0_1px_color-mix(in_srgb,var(--selection-accent)_28%,transparent)]"
                            : "border-border hover:border-border-strong hover:bg-surface-low",
                        )}
                        style={{
                          backgroundColor: avatarStyle.bgColor,
                          color: avatarStyle.fgColor,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="mt-7 flex items-start gap-3 rounded-[12px] border border-border bg-surface-low px-4 py-3">
                <input
                  type="checkbox"
                  checked={enableDesktop}
                  onChange={(event) => setEnableDesktop(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-background accent-[var(--button-primary)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-semibold leading-tight text-foreground sm:text-[15px]">
                    <Monitor className="h-4 w-4 text-text-muted" />
                    Desktop browser
                    {showProFeatureLabels ? <ProFeatureBadge /> : null}
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-text-muted sm:text-[13px]">
                    Adds a protected noVNC desktop at desktop-&lt;agent&gt;.hypercli.app.
                  </span>
                </span>
              </label>

              <label className="mt-3 flex items-start gap-3 rounded-[12px] border border-border bg-surface-low px-4 py-3">
                <input
                  type="checkbox"
                  checked={enableMemoryIndex}
                  onChange={(event) => setEnableMemoryIndex(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-background accent-[var(--button-primary)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-semibold leading-tight text-foreground sm:text-[15px]">
                    <Brain className="h-4 w-4 text-text-muted" />
                    Memory indexing
                    {showProFeatureLabels ? <ProFeatureBadge /> : null}
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-text-muted sm:text-[13px]">
                    Index memory files on session start, search, and watched file changes.
                  </span>
                </span>
              </label>

              {enableCustomImageOption ? (
                <div className="mt-3 rounded-[12px] border border-border bg-surface-low px-4 py-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={enableCustomImage}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setEnableCustomImage(checked);
                        if (!checked) {
                          setCustomImage("");
                          setCustomImageEdited(false);
                        }
                      }}
                      className="mt-1 h-4 w-4 rounded border-border bg-background accent-[var(--button-primary)]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[14px] font-semibold leading-tight text-foreground sm:text-[15px]">
                        <Package className="h-4 w-4 text-text-muted" />
                        Custom image
                        {showProFeatureLabels ? <ProFeatureBadge /> : null}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-text-muted sm:text-[13px]">
                        Start this agent from a specific container image instead of the account default.
                      </span>
                    </span>
                  </label>
                  {enableCustomImage ? (
                    <div className="mt-3 pl-7">
                      <input
                        value={effectiveCustomImage}
                        onChange={(event) => {
                          setCustomImageEdited(true);
                          setCustomImage(event.target.value);
                        }}
                        aria-label="Custom agent image"
                        placeholder={defaultCustomImage || "ghcr.io/example/openclaw:latest"}
                        spellCheck={false}
                        className="h-10 w-full rounded-[10px] border border-border bg-background px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong sm:text-[13px]"
                      />
                      <p className="mt-2 text-[11px] leading-4 text-text-muted">
                        Defaults to the configured {enableDesktop ? "desktop" : "standard"} image.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-end border-t border-border bg-surface-low px-5 sm:px-7">
              <WizardButton onClick={() => goToStep(1)}>Continue</WizardButton>
            </footer>
          </>
        )}

        {currentStep === "knowledge" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleFileSelection(event.dataTransfer.files);
                }}
                className="flex min-h-[190px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border bg-background px-5 text-center sm:min-h-[220px]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-low text-text-muted sm:h-12 sm:w-12">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <p className="mt-5 text-[16px] font-semibold leading-tight text-foreground sm:text-[18px]">
                  Drop your files here, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="underline underline-offset-4 transition-colors hover:text-selection-accent"
                  >
                    click to browse
                  </button>
                </p>
                <p className="mt-2 text-[13px] leading-tight text-text-muted sm:text-[14px]">PDF, DOCX, EPUB, TXT, or CSV - up to 25 MB each</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.epub,.txt,.csv"
                  className="hidden"
                  onChange={(event) => handleFileSelection(event.target.files)}
                />

                {files.length > 0 && (
                  <div className="mt-7 flex max-w-full flex-wrap justify-center gap-3">
                    {files.map((file) => (
                      <span
                        key={`${file.name}-${file.size}`}
                        className="max-w-[260px] truncate rounded-full border border-border bg-surface-low px-4 py-2 text-sm text-text-secondary"
                      >
                        {file.name} - {formatFileSize(file.size)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-between border-t border-border bg-surface-low px-5 sm:px-7">
              <WizardButton variant="secondary" onClick={() => goToStep(0)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </WizardButton>
              <WizardButton onClick={() => goToStep(2)}>Continue</WizardButton>
            </footer>
          </>
        )}

        {currentStep === "plan" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              {createError && <LaunchCapacityFallback error={createError} onOpenPlanCatalog={onOpenPlanCatalog} />}
              <div className="grid min-h-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {displayedPlanOptions.map((plan) => {
                  const Icon = plan.icon;
                  const isProvisioning = plan.statusText === "Payment active, waiting for entitlement";
                  const isReleasing = plan.statusText === "Slot being released";
                  const statusFeature = isProvisioning || isReleasing ? null : plan.slotStatus;
                  const featureRows = uniqueFeatureList([statusFeature, ...plan.features].filter((feature): feature is string => Boolean(feature))).slice(0, 7);
                  return (
                    <div
                      key={plan.id}
                      aria-disabled={plan.disabled || undefined}
                      onClick={() => {
                        if (plan.disabled) return;
                        dispatchWizard({ type: "SELECT_PLAN", planId: plan.id });
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (plan.disabled) return;
                          dispatchWizard({ type: "SELECT_PLAN", planId: plan.id });
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={cx(
                        "relative flex min-h-[302px] flex-col rounded-[8px] border border-border bg-surface-low p-4 text-left transition-colors hover:border-border-strong",
                        selectedPlanId === plan.id && "border-selection-accent/60",
                        plan.disabled && "opacity-60",
                        isReleasing ? "cursor-wait" : plan.disabled ? "cursor-not-allowed" : "cursor-pointer",
                      )}
	                    >
	                      {plan.accent && (
	                        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-selection-accent px-2.5 py-1 text-[12px] font-medium leading-none text-selection-accent-foreground">
	                          Most Popular
	                        </span>
	                      )}

                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-border bg-surface-high text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h3 className="truncate text-[18px] font-semibold leading-none text-foreground">{plan.name}</h3>
                      </div>

                      <p className="mt-5 min-h-[34px] text-[13px] leading-[1.35] text-text-muted">{plan.description}</p>

                      <div className="mt-3 flex min-h-[42px] items-center gap-2.5">
                        {plan.oldPrice && (
                          <span className="text-[24px] font-bold leading-none text-text-muted line-through decoration-[2px]">{plan.oldPrice}</span>
                        )}
                        {plan.price ? (
                          <>
                            <span className="text-[28px] font-bold leading-none text-foreground">{plan.price}</span>
                            <span className="max-w-[78px] text-[10px] font-semibold leading-[1.1] text-foreground">{plan.priceNote}</span>
                          </>
                        ) : (
                          <span className="text-[18px] font-semibold leading-none text-foreground">{plan.statusText ?? "Already active"}</span>
                        )}
                      </div>
                      {plan.price && plan.statusText && (
                        <p className="mt-2 text-[12px] font-medium text-warning">{plan.statusText}</p>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePlanAction(plan.id);
                        }}
	                        disabled={creating || plan.disabled}
	                        className={cx(
	                          "mt-3 h-8 rounded-[8px] text-[13px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-70",
	                          creating || isReleasing ? "disabled:cursor-wait" : "disabled:cursor-not-allowed",
	                          plan.accent
	                            ? "bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)]"
	                            : "border border-primary/40 bg-primary/10 text-primary hover:border-primary/55 hover:bg-primary/15",
	                        )}
	                      >
                        {creating && selectedPlanId === plan.id ? "Creating..." : plan.cta}
                      </button>

                      {isProvisioning || isReleasing ? (
                        <SlotProvisioningStatus
                          status={plan.slotStatus}
                          detail={isReleasing ? "Refreshing slot availability" : undefined}
                        />
                      ) : null}

                      <div className="mt-5 space-y-2.5">
                        {featureRows.map((feature, featureIndex) => (
                          <div key={`${plan.id}-${featureIndex}-${feature}`} className="flex items-start gap-2.5 text-[13px] leading-tight text-foreground">
                            <Check className="mt-px h-4 w-4 flex-shrink-0 text-text-muted" />
                            <span>{feature}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <footer className="flex h-[72px] flex-shrink-0 items-center justify-between border-t border-border bg-surface-low px-5 sm:px-7">
            <WizardButton variant="secondary" onClick={() => goToStep(1)}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </WizardButton>
            <WizardButton
              disabled={!selectedPlan || creating || Boolean(selectedPlan.disabled)}
              busy={creating}
              onClick={() => handlePlanAction()}
            >
              {creating ? "Creating..." : selectedPlan?.cta ?? "Continue"}
            </WizardButton>
          </footer>
          </>
        )}
      </motion.section>
      <PlanComparisonModal
        open={planComparisonOpen}
        onClose={() => setPlanComparisonOpen(false)}
        catalogPlans={catalogPlans}
      />
    </div>
  );
}
