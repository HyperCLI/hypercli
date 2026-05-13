"use client";

import React, { type ComponentType } from "react";
import { motion } from "framer-motion";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import {
  Bot,
  Brain,
  Check,
  ChevronLeft,
  Circle,
  FileText,
  Rocket,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import type { SlotInventory } from "@/lib/format";
import { formatTokens } from "@/lib/format";
import {
  hasPlanWord,
  isFiveAiuPlan,
  isLegacyAgentPlan,
  isLegacyAgentPlanLabel,
  isVisibleCurrentAgentPlan,
} from "@/lib/agent-plan-catalog";
import { PlanComparisonModal } from "./PlanComparisonModal";
import { SlotProvisioningStatus } from "./SlotProvisioningStatus";

interface FirstAgentSetupWizardProps {
  onCreateAgent: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  onOpenPlanCatalog?: () => void | Promise<void>;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  pendingSlotReleases?: Record<string, number>;
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
    title: "Create your first agent",
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
  subscriptionCount: number;
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

  for (const subscription of subscriptionSummary?.activeSubscriptions ?? []) {
    const slotGrants = subscription.slotGrants ?? {};
    const tier = ["large", "medium", "small"].find((candidate) => Number(slotGrants[candidate] || 0) > 0);
    if (!tier) continue;

    const catalogPlan = catalogById.get(subscription.planId);
    const sourceCatalogPlan = sourceCatalogById.get(subscription.planId);
    const mergedIntoPro = Boolean(
      catalogPlan &&
      sourceCatalogPlan &&
      catalogPlan.id !== sourceCatalogPlan.id &&
      isProPlan(catalogPlan) &&
      isLegacyAgentPlan(sourceCatalogPlan),
    );
    const subscriptionNameIsLegacy = isLegacyAgentPlanLabel(subscription.planName);
    const planName = (mergedIntoPro || (catalogPlan && isProPlan(catalogPlan) && subscriptionNameIsLegacy))
      ? catalogPlan?.name ?? subscription.planName ?? "Pro"
      : subscription.planName || catalogPlan?.name || subscription.planId || "Current plan";
    const normalizedPlanName = planName.trim().toLowerCase();
    const planId = catalogPlan?.id || (subscription.planName ? normalizedPlanName : subscription.planId || normalizedPlanName);
    const groupKey = `${planId}:${tier}`;
    const quantity = Math.max(Number(subscription.quantity || 1), 1);
    let group = activeGroups.get(groupKey);
    if (!group) {
      group = {
        id: `active:${groupKey}`,
        tier,
        planName,
        catalogPlan,
        granted: 0,
        slotGrants: {},
        subscriptionCount: 0,
      };
      activeGroups.set(groupKey, group);
    }

    group.granted += Math.max(Number(slotGrants[tier] || 0), 0) * quantity;
    group.subscriptionCount += quantity;
    for (const [slotTier, amount] of Object.entries(slotGrants)) {
      const granted = Math.max(Number(amount || 0), 0) * quantity;
      group.slotGrants[slotTier] = (group.slotGrants[slotTier] ?? 0) + granted;
    }
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
    const activeSubscriptionLabel = group.subscriptionCount > 1
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
        ...catalogFeatures(catalogPlan, tier, group.slotGrants),
        `${granted}x ${titleizeTier(tier)} slot${granted === 1 ? "" : "s"}`,
        waitingForEntitlement || slotBeingReleased ? null : `${available} free right now`,
        activeSubscriptionLabel,
      ].filter((feature): feature is string => Boolean(feature))).slice(0, 7) : [
        `${granted}x ${titleizeTier(tier)} slot${granted === 1 ? "" : "s"}`,
        waitingForEntitlement
          ? "Launch entitlement is still provisioning"
          : slotBeingReleased
            ? "A deleted agent is releasing this slot"
            : `${available} free right now`,
        activeSubscriptionLabel,
      ],
    };
  });

  if (mapped.length > 0) return sortLaunchPlanOptions(mapped);

  const effectivePlanId = subscriptionSummary?.effectivePlanId ?? "";
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

function generateAgentName(): string {
  const first = agentNameFirstWords[randomIndex(agentNameFirstWords.length)];
  const second = agentNameSecondWords[randomIndex(agentNameSecondWords.length)];
  return `${first}-${second}`;
}

function WizardButton({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center justify-center rounded-[10px] px-3.5 text-[14px] font-medium transition-colors sm:h-10 sm:px-4 sm:text-[15px]",
        variant === "primary"
          ? "bg-[#36c99b] text-[#06251c] hover:bg-[#43dbad]"
          : "border border-[#4a4a4d] bg-[#242424] text-foreground hover:bg-[#2b2b2b]",
      )}
    >
      {children}
    </button>
  );
}

export function FirstAgentSetupWizard({
  onCreateAgent,
  onOpenPlanCatalog,
  budget,
  subscriptionSummary,
  catalogPlans,
  pendingSlotReleases = {},
}: FirstAgentSetupWizardProps) {
  const [defaultAgentName, setDefaultAgentName] = React.useState("");
  const [stepIndex, setStepIndex] = React.useState(0);
  const [agentName, setAgentName] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("General");
  const [selectedIconIndex, setSelectedIconIndex] = React.useState(avatarOptions[0].iconIndex);
  const slotInventory = budget?.slots ?? EMPTY_SLOT_INVENTORY;
  const planOptions = React.useMemo(
    () => buildLaunchPlanOptions(subscriptionSummary, slotInventory, catalogPlans, pendingSlotReleases),
    [catalogPlans, pendingSlotReleases, slotInventory, subscriptionSummary],
  );
  const [selectedPlanId, setSelectedPlanId] = React.useState<string>(planOptions[0]?.id ?? "free");
  const [files, setFiles] = React.useState<File[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [planComparisonOpen, setPlanComparisonOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const currentStep = steps[stepIndex];
  const currentCopy = stepCopy[currentStep];
  const selectedPlan = planOptions.find((plan) => plan.id === selectedPlanId) ?? planOptions[0];
  const selectedAvatar = avatarOptions.find((option) => option.iconIndex === selectedIconIndex) ?? avatarOptions[0];
  const SelectedAvatarIcon = selectedAvatar.icon;
  const displayName = agentName.trim() || defaultAgentName || "agent";

  React.useEffect(() => {
    const generatedName = generateAgentName();
    setDefaultAgentName(generatedName);
    setAgentName((currentName) => currentName.trim() ? currentName : generatedName);
  }, []);

  React.useEffect(() => {
    if (!planOptions.find((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(planOptions[0]?.id ?? "free");
    }
  }, [planOptions, selectedPlanId]);

  const goToStep = (nextStep: number) => {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextStep)));
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
        }),
      );
    }
  };

  const saveDraftAndCreate = async (planId = selectedPlanId) => {
    if (creating) return;
    const plan = planOptions.find((option) => option.id === planId) ?? selectedPlan;
    setCreateError(null);
    if (!plan) {
      setCreateError("Plan catalog is unavailable right now.");
      return;
    }
    persistDraft(plan);
    if (plan.action === "plans") {
      if (onOpenPlanCatalog) {
        try {
          await onOpenPlanCatalog();
        } catch (error) {
          setCreateError(error instanceof Error ? error.message : "Plan catalog is unavailable right now.");
        }
      } else if (typeof window !== "undefined") {
        window.location.assign("/plans");
      }
      return;
    }
    if (Math.max(slotInventory[plan.size]?.available ?? 0, 0) <= 0) {
      setCreateError("Payment may be active, but no launch entitlement slot is available yet. Refresh billing before creating an agent.");
      return;
    }
    setCreating(true);
    try {
      const createdId = await onCreateAgent({
        name: displayName,
        iconIndex: selectedIconIndex,
        size: plan.size,
      });
      if (!createdId) {
        setCreateError("Agent creation did not return an agent id.");
        setCreating(false);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create agent");
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex h-full max-h-[680px] min-h-0 w-full max-w-[980px] flex-col overflow-hidden rounded-[20px] border border-[#353535] bg-[#171717] text-foreground shadow-[0_20px_56px_rgba(0,0,0,0.46)]"
      >
        <header className="relative flex-shrink-0 border-b border-[#333333] px-5 py-4 pr-[164px] sm:px-6 sm:pr-[172px] lg:px-7 lg:pr-[180px]">
          <div className="min-w-0">
            <h2 className="text-[20px] font-medium leading-tight text-[#f3f3f3] sm:text-[24px]">{currentCopy.title}</h2>
            <p className="mt-2 text-[13px] leading-snug text-[#858585] sm:text-[15px] lg:text-[16px]">{currentCopy.subtitle}</p>
          </div>
          {currentStep === "plan" && (
            <button
              type="button"
              onClick={() => setPlanComparisonOpen(true)}
              className="absolute right-5 top-4 inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border border-[#4a4a4d] bg-[#232323] px-3.5 text-[14px] font-medium text-[#f5f5f5] transition-colors hover:border-[#66666a] hover:bg-[#2b2b2b] sm:right-6 lg:right-7"
            >
              Compare plans
            </button>
          )}
        </header>

        {currentStep === "identity" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              <div className="grid gap-5 md:grid-cols-[72px_minmax(0,1fr)] md:items-center lg:grid-cols-[80px_minmax(0,1fr)]">
                <div className="relative mx-auto h-[72px] w-[72px] md:mx-0 lg:h-20 lg:w-20">
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#22352f] text-[#74e5be] lg:h-20 lg:w-20">
                    <SelectedAvatarIcon className="h-7 w-7 lg:h-8 lg:w-8" />
                  </div>
                </div>

                <label className="block min-w-0">
                  <span className="mb-2 block text-[14px] font-semibold leading-none text-[#f5f5f5] sm:text-[16px]">Agent name</span>
                  <input
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    className="h-10 w-full rounded-[12px] border border-[#4a4a4d] bg-[#202020] px-3 text-[15px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#707070] focus:border-[#6a6a6d] sm:h-11 sm:text-[16px] lg:h-12"
                  />
                </label>
              </div>

              <div className="mt-7 lg:mt-8">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-[#f5f5f5] sm:text-[16px]">What does it help with?</p>
                <div className="flex flex-wrap gap-2">
                  {helpCategories.map((category) => {
                    const selected = selectedCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setSelectedCategory(category)}
                        className={cx(
                          "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors sm:text-[14px]",
                          selected
                            ? "border-[#5b5b5f] bg-[#252525] text-[#f6f6f6]"
                            : "border-[#444448] bg-[#202020] text-[#f0f0f0] hover:border-[#66666a]",
                        )}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-[#f5f5f5] sm:text-[16px]">Avatar</p>
                <div className="flex flex-wrap gap-2">
                  {avatarOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = selectedIconIndex === option.iconIndex;
                    return (
                      <button
                        key={option.iconIndex}
                        type="button"
                        aria-label={option.label}
                        aria-pressed={selected}
                        onClick={() => setSelectedIconIndex(option.iconIndex)}
                        className={cx(
                          "flex h-8 w-8 items-center justify-center rounded-[8px] border bg-[#222222] text-[#f1f1f1] transition-colors",
                          selected
                            ? "border-[#35c69a] shadow-[0_0_0_1px_rgba(53,198,154,0.28)]"
                            : "border-[#424245] hover:border-[#66666a] hover:bg-[#292929]",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-end border-t border-[#333333] bg-[#202020] px-5 sm:px-7">
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
                className="flex min-h-[190px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[#343434] bg-[#070707] px-5 text-center sm:min-h-[220px]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2f2f31] bg-[#111111] text-[#8b8b8f] sm:h-12 sm:w-12">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <p className="mt-5 text-[16px] font-semibold leading-tight text-[#f5f5f5] sm:text-[18px]">
                  Drop your files here, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="underline underline-offset-4 transition-colors hover:text-[#36c99b]"
                  >
                    click to browse
                  </button>
                </p>
                <p className="mt-2 text-[13px] leading-tight text-[#858585] sm:text-[14px]">PDF, DOCX, TXT, or CSV - up to 25 MB each</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.csv"
                  className="hidden"
                  onChange={(event) => handleFileSelection(event.target.files)}
                />

                {files.length > 0 && (
                  <div className="mt-7 flex max-w-full flex-wrap justify-center gap-3">
                    {files.map((file) => (
                      <span
                        key={`${file.name}-${file.size}`}
                        className="max-w-[260px] truncate rounded-full border border-[#3c3c3f] bg-[#191919] px-4 py-2 text-sm text-[#d8d8d8]"
                      >
                        {file.name} - {formatFileSize(file.size)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-between border-t border-[#333333] bg-[#202020] px-5 sm:px-7">
              <WizardButton variant="secondary" onClick={() => goToStep(0)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </WizardButton>
              <WizardButton onClick={() => goToStep(2)}>Continue</WizardButton>
            </footer>
          </>
        )}

        {currentStep === "plan" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              {createError && (
                <div className="mb-4 rounded-[12px] border border-[#d05f5f]/40 bg-[#d05f5f]/10 px-4 py-3 text-sm text-[#ffb3b3]">
                  {createError}
                </div>
              )}
              <div className="grid min-h-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {planOptions.map((plan) => {
                const Icon = plan.icon;
                const isProvisioning = plan.statusText === "Payment active, waiting for entitlement";
                const isReleasing = plan.statusText === "Slot being released";
                const statusFeature = isProvisioning || isReleasing ? null : plan.slotStatus;
                const featureRows = uniqueFeatureList([statusFeature, ...plan.features].filter((feature): feature is string => Boolean(feature))).slice(0, 7);
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPlanId(plan.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={cx(
                      "relative flex min-h-[302px] flex-col rounded-[8px] border border-[#353538] bg-[#181818] p-4 text-left transition-colors hover:border-[#505055]",
                      selectedPlanId === plan.id && "border-[#56565a]",
                      plan.disabled && "opacity-60",
                    )}
                  >
                    {plan.accent && (
                      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#063f31] px-2.5 py-1 text-[12px] font-medium leading-none text-[#36d399]">
                        Most Popular
                      </span>
                    )}

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#303035] bg-[#242427] text-[#f5f5f5]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <h3 className="truncate text-[18px] font-semibold leading-none text-[#f5f5f5]">{plan.name}</h3>
                    </div>

                    <p className="mt-5 min-h-[34px] text-[13px] leading-[1.35] text-[#7d7d82]">{plan.description}</p>

                    <div className="mt-3 flex min-h-[42px] items-center gap-2.5">
                      {plan.oldPrice && (
                        <span className="text-[24px] font-bold leading-none text-[#777777] line-through decoration-[2px]">{plan.oldPrice}</span>
                      )}
                      {plan.price ? (
                        <>
                          <span className="text-[28px] font-bold leading-none text-[#f7f7f7]">{plan.price}</span>
                          <span className="max-w-[78px] text-[10px] font-semibold leading-[1.1] text-[#f6f6f6]">{plan.priceNote}</span>
                        </>
                      ) : (
                        <span className="text-[18px] font-semibold leading-none text-[#f7f7f7]">{plan.statusText ?? "Already active"}</span>
                      )}
                    </div>
                    {plan.price && plan.statusText && (
                      <p className="mt-2 text-[12px] font-medium text-amber-100">{plan.statusText}</p>
                    )}

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPlanId(plan.id);
                        void saveDraftAndCreate(plan.id);
                      }}
                      disabled={creating || plan.disabled}
                      className={cx(
                        "mt-3 h-8 rounded-[8px] text-[13px] font-medium leading-tight transition-colors disabled:cursor-wait disabled:opacity-70",
                        plan.accent
                          ? "bg-[#36c99b] text-[#06251c] hover:bg-[#43dbad]"
                          : "border border-[#444448] bg-[#202020] text-[#f5f5f5] hover:bg-[#262626]",
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
                        <div key={`${plan.id}-${featureIndex}-${feature}`} className="flex items-start gap-2.5 text-[13px] leading-tight text-[#f2f2f2]">
                          <Check className="mt-px h-4 w-4 flex-shrink-0 text-[#77777b]" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
