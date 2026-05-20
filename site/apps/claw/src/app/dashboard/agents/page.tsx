"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createOpenClawConfigValue,
  describeOpenClawConfigNode,
  normalizeOpenClawConfigSchemaNode,
} from "@hypercli.com/sdk/openclaw/gateway";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Check,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  SlidersHorizontal,
  Plug,
  X,
  Link2,
  Zap,
  Timer,
  Sparkles,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createHyperAgentClient, createOpenClawAgent, startOpenClawAgent } from "@/lib/agent-client";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { formatCpu, formatMemory, formatTokens, type SlotInventoryEntry } from "@/lib/format";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { useAgentLogs } from "@/hooks/useAgentLogs";
import { useAgentShell } from "@/hooks/useAgentShell";
import { agentAvatar } from "@/lib/avatar";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { IntegrationsDirectoryPanel } from "@/components/dashboard/integrations";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import type { TabId as AgentViewTabId } from "@/components/dashboard/agentViewTypes";
import { AgentsChannelsSidebar, MOCK_PARTICIPANTS, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { ChannelCreationWizard } from "@/components/dashboard/ChannelCreationWizard";
import { getCategoryForPlugin, type DirectoryCategory } from "@/components/dashboard/directory/directory-utils";
import { buildSkillsSnapshotCommand, parseSkillSnapshotOutput } from "@/components/dashboard/directory/workspace-skills";
import { PlanComparisonModal } from "@/components/dashboard/agents/PlanComparisonModal";
import { FirstAgentSetupWizard } from "@/components/dashboard/agents/FirstAgentSetupWizard";
import type { AgentFileEntry, SdkAgent } from "@/types";
import type { FileEntry } from "@/components/dashboard/files/types";
import type { Deployments, OpenClawAgent as SdkOpenClawAgent } from "@hypercli.com/sdk/agents";
import type {
  HyperAgentCurrentPlan,
  HyperAgentEntitlement,
  HyperAgentPlan,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
  HyperAgentTypeCatalog,
} from "@hypercli.com/sdk/agent";
import type { Agent, AgentBudget, AgentState, JsonObject } from "./types";
import {
  describeAgentTierStartGuidance,
  describeAgentsPageError,
  getAgentSizePresets,
  inferAgentTier,
  parseEntitlementSlotTier,
  titleizeTier,
  type AgentTierSelectionState,
} from "@/lib/agent-tier";
import {
  OPENCLAW_SYNC_ROOT,
  OPENCLAW_WORKSPACE_DIR,
  OPENCLAW_WORKSPACE_PREFIX,
  asObject,
  deepCloneJsonObject,
  getOpenClawUiHint,
  getPathValue,
  humanizeKey,
  setPathValue,
  sortOpenClawEntries,
} from "@/lib/openclaw-config";
import { getOpenClawDefaultModel } from "@/lib/openclaw-models";
import {
  clearStripeCheckoutReturnState,
  clearPendingPlanCheckout,
  getCheckoutReflectionStatus,
  getEffectivePlanName,
  getPlanOwnedCountFromSummary,
  mergeLaunchSlotInventories,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
} from "@/lib/plan-checkout-state";
import {
  billingReflectionReducer,
  checkoutSyncBannerFromBillingState,
  initialBillingReflectionState,
} from "@/lib/billing-reflection-machine";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import {
  type AgentStatusChipModel,
  type CenterPanel,
} from "@/components/dashboard/agents/page-helpers";
import { AgentSettingsPanel, AgentList, AgentTierSelectionModal, ErrorBanner, OpenClawSettingsDrawer } from "@/components/dashboard/agents/AgentPanels";
import { AgentChatPanel, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatPanel";
import { AgentFilesPanel } from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLogsPanel } from "@/components/dashboard/agents/AgentLogsPanel";
import { AgentTerminalPanel } from "@/components/dashboard/agents/AgentTerminalPanel";
import { AgentInspector } from "@/components/dashboard/agents/AgentInspector";
import { AgentMainPanel } from "@/components/dashboard/agents/AgentMainPanel";
import { AgentWorkspaceSidebar } from "@/components/dashboard/agents/AgentWorkspaceSidebar";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import { HyperClawLogoLink } from "@/components/HyperClawLogoLink";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { bundleKey, CLAW_PRODUCTS, compactBundle, formatBundle, type SlotBundle } from "@/lib/subscriptions";

type MainTab = AgentMainTab;
type AgentFileSource = "auto" | "pod" | "s3";
type SubscriptionSummaryWithEntitlementItems = HyperAgentSubscriptionSummary & {
  entitlementItems?: HyperAgentEntitlement[];
};

const SHOW_AGENT_INSPECTOR = false;
const SCHEDULED_SECTION_ENABLED = true;
const SCHEDULED_SECTION_DISABLED_REASON = "Scheduled workflows are not available yet.";
const BILLING_MOCK_PARAM = "billingMock";
const BILLING_MOCK_ACTIVE_NO_SLOT = "active-no-slot";
const AGENTS_DESKTOP_MEDIA_QUERY = "(min-width: 640px)";
const AGENT_LAUNCHER_OPEN_VALUES = new Set(["agent-launcher", "launcher", "launch-agent"]);

interface UpgradeDisplayProduct {
  id: string;
  name: string;
  bundle: SlotBundle;
  price: number;
  description?: string;
  features: string[];
  highlighted: boolean;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
}

interface UpgradeCheckoutPlan {
  id: string;
  name: string;
  bundle?: Record<string, number>;
  price: number;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
}

type CatalogPlan = HyperAgentPlan & {
  bundle?: Record<string, number> | null;
  checkoutBundle?: Record<string, number> | null;
  checkout_bundle?: Record<string, number> | null;
  hidden?: boolean;
  meta?: {
    bundle?: Record<string, number> | null;
    checkout_bundle?: Record<string, number> | null;
    subtitle?: string | null;
  } | null;
  price_usd?: number;
  slotGrants?: Record<string, number> | null;
  slot_grants?: Record<string, number> | null;
};

const FALLBACK_PRODUCTS_BY_ID = new Map(CLAW_PRODUCTS.map((product) => [product.id, product]));

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBundle(value: unknown): SlotBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([tier, count]) => [tier, Number(count)] as const)
    .filter(([, count]) => Number.isFinite(count) && count > 0);
  return Object.fromEntries(entries) as SlotBundle;
}

function firstBundle(...bundles: unknown[]): SlotBundle {
  for (const bundle of bundles) {
    const normalized = normalizeBundle(bundle);
    if (Object.keys(normalized).length > 0) return normalized;
  }
  return {};
}

function uniqueFeatureList(features: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const feature of features) {
    const normalized = feature.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    unique.push(normalized);
  }
  return unique;
}

function buildUpgradeProducts(catalogPlans: HyperAgentPlan[]): UpgradeDisplayProduct[] {
  return catalogPlans
    .filter(isVisibleCurrentAgentPlan)
    .map((plan) => {
      const catalogPlan = plan as CatalogPlan;
      const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
      const fallbackBundle = FALLBACK_PRODUCTS_BY_ID.get(plan.id)?.bundle;
      return {
        id: plan.id,
        name: plan.name,
        bundle: firstBundle(
          catalogPlan.bundle,
          catalogPlan.checkoutBundle,
          catalogPlan.checkout_bundle,
          catalogPlan.meta?.bundle,
          catalogPlan.meta?.checkout_bundle,
          catalogPlan.slotGrants,
          catalogPlan.slot_grants,
          fallbackBundle,
        ),
        price: finiteNumber(catalogPlan.priceUsd ?? catalogPlan.price_usd ?? plan.price),
        description: catalogPlan.meta?.subtitle ?? undefined,
        features: plan.features ?? [],
        highlighted: Boolean(plan.highlighted),
        limits: {
          tpd: finiteNumber(limits.tpd),
          burstTpm: finiteNumber(limits.burstTpm ?? (limits as { burst_tpm?: number }).burst_tpm),
          rpm: finiteNumber(limits.rpm ?? plan.rpmLimit),
        },
      };
    });
}

function toUpgradeCheckoutPlan(product: UpgradeDisplayProduct): UpgradeCheckoutPlan {
  const bundle = compactBundle(product.bundle) as Record<string, number>;
  return {
    id: product.id,
    name: product.name,
    bundle: Object.keys(bundle).length > 0 ? bundle : undefined,
    price: product.price,
    limits: product.limits,
  };
}

function bundleFromSubscription(subscription: HyperAgentSubscription): SlotBundle {
  const metaBundle = compactBundle(
    (subscription.meta?.bundle as Record<string, number> | undefined) ??
      (subscription.meta?.checkout_bundle as Record<string, number> | undefined),
  );
  if (Object.keys(metaBundle).length > 0) return metaBundle;

  const derived: Record<string, number> = {};
  for (const [tier, granted] of Object.entries(subscription.slotGrants ?? {})) {
    const total = Math.max(Number(granted || 0), 0) * Math.max(subscription.quantity || 1, 1);
    if (total > 0) derived[tier] = total;
  }
  if (Object.keys(derived).length > 0) return compactBundle(derived);
  if (subscription.planId === "free") return { free: Math.max(subscription.quantity || 1, 1) };
  return {};
}

function primaryLaunchTier(bundle: SlotBundle): string | null {
  const tiers: Array<keyof Pick<SlotBundle, "large" | "medium" | "small">> = ["large", "medium", "small"];
  return tiers.find((tier) => Number(bundle[tier] || 0) > 0) ?? null;
}

function describeUpgradeProduct(product: UpgradeDisplayProduct): string {
  if (product.description) return product.description;
  const tier = primaryLaunchTier(product.bundle);
  if (tier) return `${titleizeTier(tier)} launch capacity`;
  return `${formatTokens(product.limits.tpd)} tokens per day`;
}

function upgradeProductFeatures(product: UpgradeDisplayProduct): string[] {
  const bundleLabel = formatBundle(product.bundle);
  return uniqueFeatureList([
    `${formatTokens(product.limits.tpd)} tokens / day`,
    product.limits.burstTpm > 0 ? `Up to ${formatTokens(product.limits.burstTpm)} TPM` : null,
    product.limits.rpm > 0 ? `${formatTokens(product.limits.rpm)} RPM` : null,
    bundleLabel,
    ...product.features,
  ].filter((feature): feature is string => Boolean(feature))).slice(0, 7);
}

function isActiveNoSlotBillingMockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(BILLING_MOCK_PARAM) === BILLING_MOCK_ACTIVE_NO_SLOT;
  } catch {
    return false;
  }
}

function applyActiveNoSlotBillingMock(
  summary: HyperAgentSubscriptionSummary | null,
  currentPlan: HyperAgentCurrentPlan | null,
  catalogPlans: HyperAgentPlan[],
): HyperAgentSubscriptionSummary {
  const entitlementItems = (summary as SubscriptionSummaryWithEntitlementItems | null)?.entitlementItems ?? [];
  const catalogProduct = buildUpgradeProducts(catalogPlans).find((product) => product.id !== "free" && primaryLaunchTier(product.bundle));
  const existingSubscription = summary?.activeSubscriptions?.find((subscription) => primaryLaunchTier(bundleFromSubscription(subscription)));
  const tier = primaryLaunchTier(existingSubscription ? bundleFromSubscription(existingSubscription) : (catalogProduct?.bundle ?? {})) ?? "medium";
  const planId =
    existingSubscription?.planId ||
    (summary?.effectivePlanId && summary.effectivePlanId !== "free" ? summary.effectivePlanId : "") ||
    catalogProduct?.id ||
    currentPlan?.id ||
    "active-test-plan";
  const planName = existingSubscription?.planName || catalogProduct?.name || currentPlan?.name || "Active test plan";
  const activeEntitlementCount = Math.max(summary?.activeEntitlementCount ?? summary?.entitlements?.activeEntitlementCount ?? 1, 1);
  const mockSubscription: HyperAgentSubscription = {
    ...(existingSubscription ?? ({} as HyperAgentSubscription)),
    id: existingSubscription?.id || "mock-active-no-slot-subscription",
    userId: existingSubscription?.userId || "",
    planId,
    planName,
    provider: existingSubscription?.provider || "TEST",
    status: existingSubscription?.status || "ACTIVE",
    quantity: existingSubscription?.quantity || 1,
    expiresAt: existingSubscription?.expiresAt || null,
    updatedAt: existingSubscription?.updatedAt || null,
    stripeSubscriptionId: existingSubscription?.stripeSubscriptionId || null,
    cancelAtPeriodEnd: existingSubscription?.cancelAtPeriodEnd || false,
    canCancel: existingSubscription?.canCancel || false,
    isCurrent: true,
    meta: existingSubscription?.meta || null,
    planTpmLimit: existingSubscription?.planTpmLimit || summary?.pooledTpmLimit || 0,
    planRpmLimit: existingSubscription?.planRpmLimit || summary?.pooledRpmLimit || 0,
    planTpd: existingSubscription?.planTpd || summary?.pooledTpd || currentPlan?.pooledTpd || 0,
    planAgentTier: existingSubscription?.planAgentTier || tier,
    slotGrants: { ...(existingSubscription?.slotGrants ?? {}), [tier]: Math.max(Number(existingSubscription?.slotGrants?.[tier] || 1), 1) },
    entitlements: existingSubscription?.entitlements || [],
  };
  const activeSubscriptions = existingSubscription
    ? (summary?.activeSubscriptions ?? []).map((subscription) => (subscription.id === mockSubscription.id ? mockSubscription : subscription))
    : [...(summary?.activeSubscriptions ?? []), mockSubscription];
  const subscriptions = existingSubscription && summary?.subscriptions?.length ? summary.subscriptions : activeSubscriptions;

  const mockedSummary: SubscriptionSummaryWithEntitlementItems = {
    effectivePlanId: planId,
    currentSubscriptionId: summary?.currentSubscriptionId || mockSubscription.id,
    currentEntitlementId: summary?.currentEntitlementId || mockSubscription.id,
    pooledTpmLimit: summary?.pooledTpmLimit || 0,
    pooledRpmLimit: summary?.pooledRpmLimit || 0,
    pooledTpd: summary?.pooledTpd || currentPlan?.pooledTpd || 0,
    slotInventory: {},
    billingResetAt: summary?.billingResetAt || null,
    activeSubscriptionCount: Math.max(summary?.activeSubscriptionCount ?? activeSubscriptions.length, activeSubscriptions.length, 1),
    activeEntitlementCount,
    entitlements: {
      ...(summary?.entitlements ?? {}),
      effectivePlanId: planId,
      pooledTpmLimit: summary?.entitlements?.pooledTpmLimit ?? summary?.pooledTpmLimit ?? 0,
      pooledRpmLimit: summary?.entitlements?.pooledRpmLimit ?? summary?.pooledRpmLimit ?? 0,
      pooledTpd: summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0,
      slotInventory: {},
      activeEntitlementCount,
      billingResetAt: summary?.entitlements?.billingResetAt ?? summary?.billingResetAt ?? null,
    },
    entitlementItems,
    activeSubscriptions,
    subscriptions,
    user: summary?.user || {},
  };
  return mockedSummary;
}

function countOwnedCheckoutPlan(
  summary: HyperAgentSubscriptionSummary | null,
  checkoutPlan: UpgradeCheckoutPlan | null,
): number {
  if (!summary || !checkoutPlan) return 0;
  const checkoutBundleKey = checkoutPlan.bundle ? bundleKey(checkoutPlan.bundle) : "{}";
  let ownedCount = getPlanOwnedCountFromSummary(summary, checkoutPlan.id);

  for (const subscription of summary.activeSubscriptions ?? []) {
    if (subscription.planId === checkoutPlan.id) {
      continue;
    }
    if (checkoutBundleKey !== "{}" && bundleKey(bundleFromSubscription(subscription)) === checkoutBundleKey) {
      ownedCount += Math.max(subscription.quantity || 1, 1);
    }
  }

  return ownedCount;
}

function countOwnedProduct(
  summary: HyperAgentSubscriptionSummary | null,
  product: UpgradeDisplayProduct,
): number {
  return countOwnedCheckoutPlan(summary, toUpgradeCheckoutPlan(product));
}

function buildBillingBudget(
  summary: HyperAgentSubscriptionSummary | null,
  currentPlan: HyperAgentCurrentPlan | null,
  typeCatalog: HyperAgentTypeCatalog | null,
): AgentBudget | null {
  if (!summary && !currentPlan) {
    return null;
  }

  const summarySlots = mergeLaunchSlotInventories(summary?.slotInventory, summary?.entitlements?.slotInventory);
  const slots = summary ? summarySlots : mergeLaunchSlotInventories(currentPlan?.slotInventory);
  const pooledTpd = summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0;
  const sizePresets = Object.fromEntries(
    (typeCatalog?.types ?? []).map((type) => [type.id, { cpu: type.cpu, memory: type.memory }]),
  );

  const merged: AgentBudget = {
    slots,
    pooled_tpd: pooledTpd,
  };
  if (Object.keys(sizePresets).length > 0) {
    merged.size_presets = sizePresets;
  }
  return merged;
}

type FetchAgentsResult = {
  subscriptionSummary: HyperAgentSubscriptionSummary | null;
  budget: AgentBudget | null;
};

function slotReleaseLanded(
  before: SlotInventoryEntry | null | undefined,
  after: SlotInventoryEntry | null | undefined,
): boolean {
  if (!before || !after) return false;
  return Math.max(after.available ?? 0, 0) > Math.max(before.available ?? 0, 0) ||
    Math.max(after.used ?? 0, 0) < Math.max(before.used ?? 0, 0);
}

function UpgradePlanCatalogModal({
  open,
  products,
  catalogPlans,
  ownedCounts,
  loading,
  error,
  onClose,
  onSelectPlan,
  onOpenPlans,
}: {
  open: boolean;
  products: UpgradeDisplayProduct[];
  catalogPlans: HyperAgentPlan[] | null;
  ownedCounts: Record<string, number>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectPlan: (product: UpgradeDisplayProduct) => void;
  onOpenPlans: () => void;
}) {
  const [comparisonOpen, setComparisonOpen] = useState(false);

  if (!open) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <motion.div
        className="max-h-[min(720px,calc(100vh-2rem))] w-full max-w-[1040px] overflow-hidden rounded-[16px] border border-[#343434] bg-[#171717] shadow-2xl"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#303033] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#36c99b]" />
              <h2 className="text-[18px] font-semibold leading-tight text-[#f5f5f5]">Upgrade plan</h2>
            </div>
            <p className="mt-2 text-[13px] leading-snug text-[#858585]">Choose a plan for checkout.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setComparisonOpen(true)}
              className="inline-flex h-8 items-center justify-center rounded-[10px] border border-[#4a4a4d] bg-[#232323] px-3 text-[13px] font-medium text-[#f5f5f5] transition-colors hover:border-[#66666a] hover:bg-[#2b2b2b]"
            >
              Compare plans
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#3c3c40] bg-[#202020] text-[#a2a2a8] transition-colors hover:bg-[#2b2b2b] hover:text-[#f5f5f5]"
              aria-label="Close upgrade modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(min(720px,100vh-2rem)-73px)] overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-4 py-3 text-sm text-[#d05f5f]">
              {error}
              <button
                type="button"
                onClick={onOpenPlans}
                className="ml-3 font-semibold text-foreground underline underline-offset-4"
              >
                Open plans page
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-low/30 px-4 py-3 text-sm text-text-secondary">
              No paid plans are available right now.
              <button
                type="button"
                onClick={onOpenPlans}
                className="ml-3 font-semibold text-foreground underline underline-offset-4"
              >
                Open plans page
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {products.map((product) => {
                const ownedCount = ownedCounts[product.id] ?? 0;
                const ProductIcon = product.highlighted ? Sparkles : Bot;
                const featureRows = upgradeProductFeatures(product);
                return (
                  <div
                    key={product.id}
                    className="relative flex min-h-[302px] flex-col rounded-[8px] border border-[#353538] bg-[#181818] p-4 text-left transition-colors hover:border-[#505055]"
                  >
                    {product.highlighted && (
                      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#063f31] px-2.5 py-1 text-[12px] font-medium leading-none text-[#36d399]">
                        Most Popular
                      </span>
                    )}

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#303035] bg-[#242427] text-[#f5f5f5]">
                        <ProductIcon className="h-4 w-4" />
                      </span>
                      <h3 className="truncate text-[18px] font-semibold leading-none text-[#f5f5f5]">{product.name}</h3>
                      {ownedCount > 0 && (
                        <span className="ml-auto shrink-0 rounded-full border border-[#36c99b]/30 bg-[#36c99b]/10 px-2 py-0.5 text-[11px] font-medium text-[#36d399]">
                          You own {ownedCount}
                        </span>
                      )}
                    </div>

                    <p className="mt-5 min-h-[34px] text-[13px] leading-[1.35] text-[#7d7d82]">
                      {describeUpgradeProduct(product)}
                    </p>

                    <div className="mt-3 flex min-h-[42px] items-center gap-2.5">
                      <span className="text-[28px] font-bold leading-none text-[#f7f7f7]">${product.price}</span>
                      <span className="max-w-[78px] text-[10px] font-semibold leading-[1.1] text-[#f6f6f6]">
                        USD/month per agent
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectPlan(product)}
                      className={`mt-3 flex h-8 w-full items-center justify-center rounded-[8px] px-3 text-[13px] font-medium leading-tight transition-colors ${
                        product.highlighted
                          ? "bg-[#36c99b] text-[#06251c] hover:bg-[#43dbad]"
                          : "border border-[#444448] bg-[#202020] text-[#f5f5f5] hover:bg-[#262626]"
                      }`}
                    >
                      {ownedCount > 0 ? "Add another" : product.highlighted ? `Upgrade to ${product.name}` : "Select plan"}
                    </button>

                    <div className="mt-5 space-y-2.5">
                      {featureRows.map((feature, featureIndex) => (
                        <div key={`${product.id}-${featureIndex}-${feature}`} className="flex items-start gap-2.5 text-[13px] leading-tight text-[#f2f2f2]">
                          <Check className="mt-px h-4 w-4 shrink-0 text-[#77777b]" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <PlanComparisonModal
          open={comparisonOpen}
          onClose={() => setComparisonOpen(false)}
          catalogPlans={catalogPlans}
        />
      </motion.div>
    </motion.div>
  );
}

function normalizeAgentFilePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    lastModified: entry.last_modified,
  };
}

function upsertSdkAgent(prev: SdkAgent[], nextAgent: SdkAgent): SdkAgent[] {
  const index = prev.findIndex((agent) => agent.id === nextAgent.id);
  if (index === -1) {
    return [...prev, nextAgent];
  }
  const next = [...prev];
  next[index] = nextAgent;
  return next;
}

function removeSdkAgent(prev: SdkAgent[], agentId: string): SdkAgent[] {
  return prev.filter((agent) => agent.id !== agentId);
}

function getWorkspaceSidebarDisabledReason({
  agentsLoading,
  connecting,
  hydrating,
}: {
  agentsLoading: boolean;
  connecting: boolean;
  hydrating: boolean;
}): string {
  if (agentsLoading) return "Loading agents.";
  const bootStatus = getAgentGatewayPanelBootStatus({
    connected: false,
    connecting,
    loading: hydrating,
    loadingTitle: "Loading workspace",
    loadingDetail: "Fetching messages, files, and config.",
    connectingDetail: "Opening the gateway connection.",
    waitingDetail: "Workspace is loading.",
  });
  if (bootStatus) return bootStatus.detail;
  return "Workspace is loading.";
}
// Shell now routes through the gateway WebSocket via lagoon -> K8s exec.

// ── Main component ──

export default function AgentsPage() {
  return (
    <React.Suspense fallback={null}>
      <AgentsPageContent />
    </React.Suspense>
  );
}

function AgentsPageContent() {
  const { getToken, user, logout } = useAgentAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedAgentId = searchParams.get("agentId")?.trim() || null;
  const requestedOpen = searchParams.get("open")?.trim() || null;
  const queryKey = searchParams.toString();
  const shouldOpenAgentLauncherFromQuery = requestedOpen ? AGENT_LAUNCHER_OPEN_VALUES.has(requestedOpen) : false;
  const { setAgentMenu } = useDashboardMobileAgentMenu();
  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(AGENTS_DESKTOP_MEDIA_QUERY).matches;
  });

  // Agent data
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [planName, setPlanName] = useState<string | null>(null);
  const [subscriptionSummary, setSubscriptionSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [tokenUsage, setTokenUsage] = useState<number | null>(null);
  const [upgradeCatalogOpen, setUpgradeCatalogOpen] = useState(false);
  const [upgradeCatalogError, setUpgradeCatalogError] = useState<string | null>(null);
  const [upgradeCheckoutPlan, setUpgradeCheckoutPlan] = useState<UpgradeCheckoutPlan | null>(null);
  const [upgradeCatalogLoading, setUpgradeCatalogLoading] = useState(false);
  const [billingReflectionState, dispatchBillingReflection] = useReducer(
    billingReflectionReducer,
    initialBillingReflectionState,
  );
  const checkoutSync = useMemo(
    () => checkoutSyncBannerFromBillingState(billingReflectionState),
    [billingReflectionState],
  );
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [recentlyStoppedIds, setRecentlyStoppedIds] = useState<Set<string>>(new Set());
  const [pendingSlotReleases, setPendingSlotReleases] = useState<Record<string, number>>({});
  const stoppedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const slotReleaseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const checkoutReturnHandledRef = useRef(false);
  const appliedAgentQueryRef = useRef<string | null>(null);
  const appliedOpenQueryRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      stoppedTimersRef.current.forEach((t) => clearTimeout(t));
      slotReleaseTimersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const [tierSelection, setTierSelection] = useState<AgentTierSelectionState | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileAgentsSidebarOpen, setMobileAgentsSidebarOpen] = useState(false);
  const [mobileWorkspaceSidebarOpen, setMobileWorkspaceSidebarOpen] = useState(false);
  const [mobileAgentLauncherOpen, setMobileAgentLauncherOpen] = useState(false);
  const [sidebarCreatorSignal, setSidebarCreatorSignal] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  // Logs
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Shell
  const shellBoxRef = useRef<HTMLDivElement | null>(null);
  const shellTerminalRef = useRef<Terminal | null>(null);
  const shellFitAddonRef = useRef<FitAddon | null>(null);
  const shellSessionAgentRef = useRef<string | null>(null);
  const shellBufferRef = useRef<string[]>([]);

  // Files panel

  // Right sidebar inspector
  const [inspectorTab, setInspectorTab] = useState<AgentViewTabId>("overview");
  const [channelsData, setChannelsData] = useState<Record<string, unknown> | null>(null);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);

  // Overlays for gear dropdown items
  const [showChannelWizard, setShowChannelWizard] = useState(false);
  const [directoryCategory, setDirectoryCategory] = useState<DirectoryCategory | undefined>();
  const [directoryItemId, setDirectoryItemId] = useState<string | undefined>();
  const [directoryDetailOrigin, setDirectoryDetailOrigin] = useState<"chat" | null>(null);

  // Hatching animation state tracking
  const prevStatesRef = useRef<Map<string, AgentState>>(new Map());
  const [burstAgentId, setBurstAgentId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(AGENTS_DESKTOP_MEDIA_QUERY);
    const apply = () => setIsDesktopViewport(mediaQuery.matches);
    apply();
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isDesktopViewport) return;
    setMobileAgentsSidebarOpen(false);
    setMobileWorkspaceSidebarOpen(false);
  }, [isDesktopViewport]);

  // Settings panel state
  const [settingsName, setSettingsName] = useState("");
  const [, setAgentClusterUnavailable] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [openclawDraft, setOpenclawDraft] = useState<JsonObject | null>(null);
  const [openclawSaving, setOpenclawSaving] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);
  const [openclawSuccess, setOpenclawSuccess] = useState<string | null>(null);
  const [openclawSettingsOpen, setOpenclawSettingsOpen] = useState(false);
  const [activeOpenclawSection, setActiveOpenclawSection] = useState<string | null>(null);
  const [openclawMapDraftKeys, setOpenclawMapDraftKeys] = useState<Record<string, string>>({});
  const [openclawJsonDrafts, setOpenclawJsonDrafts] = useState<Record<string, string>>({});
  const [openclawJsonDraftErrors, setOpenclawJsonDraftErrors] = useState<Record<string, string>>({});
  const [chatDragActive, setChatDragActive] = useState(false);
  const openclawPaneRef = useRef<HTMLDivElement | null>(null);
  const chatDragDepthRef = useRef(0);

  const openConnectionSuggestion = useCallback((suggestion: ChatConnectionSuggestion) => {
    if (suggestion.directoryPluginId) {
      const category = getCategoryForPlugin(suggestion.directoryPluginId) ?? undefined;
      setDirectoryCategory(category);
      setDirectoryItemId(suggestion.directoryPluginId);
      setDirectoryDetailOrigin("chat");
      setMainTab("integrations");
      setMobileShowChat(true);
      return;
    }

    if (!SHOW_AGENT_INSPECTOR) return;
    setInspectorTab("connections");
    setInspectorSheetOpen(true);
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchAgents = useCallback(async (): Promise<FetchAgentsResult | null> => {
    try {
      const token = await getToken();
      const agentClient = deployments ?? createAgentClient(token);
      if (!deployments) {
        setDeployments(agentClient);
      }
      const hyperAgent = createHyperAgentClient(token);
      const [listedAgents, catalogData, currentPlan, summaryData, dailyUsage, typeCatalogData] = await Promise.all([
        agentClient.list(),
        hyperAgent.plans().catch(() => []),
        hyperAgent.currentPlan().catch(() => null),
        hyperAgent.subscriptionSummary().catch(() => null),
        hyperAgent.usageHistory(1).catch(() => null),
        hyperAgent.agentTypes().catch(() => null),
      ]);
      const plans = Array.isArray(catalogData) ? catalogData : [];
      const normalizedCurrentPlan = currentPlan as HyperAgentCurrentPlan | null;
      const rawSummary = (summaryData as HyperAgentSubscriptionSummary | null) || null;
      const summary = isActiveNoSlotBillingMockEnabled()
        ? applyActiveNoSlotBillingMock(rawSummary, normalizedCurrentPlan, plans)
        : rawSummary;
      const typeCatalog = (typeCatalogData as HyperAgentTypeCatalog | null) || null;
      const nextBudget = buildBillingBudget(summary, normalizedCurrentPlan, typeCatalog);
      setSdkAgents(listedAgents);
      setBudget(nextBudget);
      setCatalogPlans(plans);
      setPlanName(getEffectivePlanName(summary, normalizedCurrentPlan, plans));
      setSubscriptionSummary(summary);
      setTokenUsage(dailyUsage?.history?.reduce((total, entry) => total + entry.totalTokens, 0) ?? null);
      setAgentClusterUnavailable(false);
      const requestedAgent = requestedAgentId
        ? listedAgents.find((agent) => agent.id === requestedAgentId) ?? null
        : null;
      setSelectedAgentId((currentId) => {
        if (currentId && listedAgents.some((item) => item.id === currentId)) {
          return currentId;
        }
        return requestedAgent?.id ?? listedAgents[0]?.id ?? null;
      });
      return { subscriptionSummary: summary, budget: nextBudget };
    } catch (err) {
      const described = describeAgentsPageError(err);
      setError(described.message);
      setAgentClusterUnavailable(described.clusterUnavailable);
      setSdkAgents([]);
      setBudget(null);
      setCatalogPlans([]);
      setDeployments(null);
      return null;
    } finally {
      setAgentsLoading(false);
    }
  }, [deployments, getToken, requestedAgentId]);

  const refreshAgentsForChildren = useCallback(async () => {
    await fetchAgents();
  }, [fetchAgents]);

  const clearPendingSlotRelease = useCallback((releaseId: string, tier: string) => {
    const timer = slotReleaseTimersRef.current.get(releaseId);
    if (timer) {
      clearTimeout(timer);
      slotReleaseTimersRef.current.delete(releaseId);
    }
    setPendingSlotReleases((current) => {
      const count = Math.max((current[tier] ?? 0) - 1, 0);
      if (count > 0) return { ...current, [tier]: count };
      const next = { ...current };
      delete next[tier];
      return next;
    });
  }, []);

  const scheduleSlotReleaseRefresh = useCallback((
    releaseId: string,
    tier: string,
    baseline: SlotInventoryEntry,
    attempt = 0,
  ) => {
    const previousTimer = slotReleaseTimersRef.current.get(releaseId);
    if (previousTimer) clearTimeout(previousTimer);

    const timer = setTimeout(() => {
      void (async () => {
        const refreshed = await fetchAgents();
        const refreshedEntry = refreshed?.budget?.slots?.[tier];
        if (slotReleaseLanded(baseline, refreshedEntry) || attempt >= 8) {
          clearPendingSlotRelease(releaseId, tier);
          return;
        }
        scheduleSlotReleaseRefresh(releaseId, tier, baseline, attempt + 1);
      })();
    }, attempt === 0 ? 1500 : 2500);

    slotReleaseTimersRef.current.set(releaseId, timer);
  }, [clearPendingSlotRelease, fetchAgents]);

  const trackPendingSlotRelease = useCallback((releaseId: string, tier: string, baseline: SlotInventoryEntry) => {
    if (Math.max(baseline.used ?? 0, 0) <= 0) return;
    setPendingSlotReleases((current) => ({
      ...current,
      [tier]: (current[tier] ?? 0) + 1,
    }));
    scheduleSlotReleaseRefresh(releaseId, tier, baseline);
  }, [scheduleSlotReleaseRefresh]);

  const refreshCheckoutEntitlements = useCallback(async () => {
    const pending = readPendingPlanCheckout();
    dispatchBillingReflection({
      type: "SYNC_STARTED",
      pending,
      message: `Refreshing ${pending?.planName ?? "your plan"} entitlements from billing...`,
    });
    const refreshed = await fetchAgents();
    const reflectionStatus = getCheckoutReflectionStatus(refreshed?.subscriptionSummary ?? null, pending);

    if (reflectionStatus === "ready") {
      clearPendingPlanCheckout();
    }
    dispatchBillingReflection({
      type: "REFLECTION_RECEIVED",
      pending,
      reflectionStatus,
    });
  }, [fetchAgents]);

  const openUpgradeCatalog = useCallback(async () => {
    if (upgradeCatalogLoading) return;

    setUpgradeCatalogOpen(true);
    setUpgradeCatalogError(null);
    if (catalogPlans.length > 0) {
      return;
    }

    setUpgradeCatalogLoading(true);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const plans = await hyperAgent.plans();
      setCatalogPlans(plans);
      if (buildUpgradeProducts(plans).filter((product) => product.id !== "free" && product.price > 0).length === 0) {
        setUpgradeCatalogError("No paid plans are available right now.");
      }
    } catch (error) {
      setUpgradeCatalogError(error instanceof Error ? error.message : "Plan catalog is unavailable right now.");
    } finally {
      setUpgradeCatalogLoading(false);
    }
  }, [catalogPlans, getToken, upgradeCatalogLoading]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (!requestedAgentId || appliedAgentQueryRef.current === requestedAgentId) return;
    if (!sdkAgents.some((agent) => agent.id === requestedAgentId)) return;

    appliedAgentQueryRef.current = requestedAgentId;
    setSelectedAgentId(requestedAgentId);
    setMobileShowChat(true);
  }, [requestedAgentId, sdkAgents]);

  useEffect(() => {
    if (!shouldOpenAgentLauncherFromQuery || appliedOpenQueryRef.current === queryKey) return;

    appliedOpenQueryRef.current = queryKey;
    setMobileShowChat(false);

    if (isDesktopViewport) {
      setSidebarCreatorSignal((value) => value + 1);
      return;
    }

    setMobileAgentsSidebarOpen(false);
    setMobileAgentLauncherOpen(true);
  }, [isDesktopViewport, queryKey, shouldOpenAgentLauncherFromQuery]);

  useEffect(() => {
    if (checkoutReturnHandledRef.current) return;
    const checkoutReturn = readStripeCheckoutReturnState();
    if (!checkoutReturn) return;

    if (checkoutReturn.status === "cancelled") {
      checkoutReturnHandledRef.current = true;
      clearPendingPlanCheckout();
      dispatchBillingReflection({ type: "CHECKOUT_CANCELLED" });
      clearStripeCheckoutReturnState();
      return;
    }

    let active = true;
    const pending = readPendingPlanCheckout();
    const planLabel = pending?.planName ? `${pending.planName} plan` : "your plan";
    dispatchBillingReflection({
      type: "SYNC_STARTED",
      pending,
      message: `Payment received. Finalizing ${planLabel} setup...`,
    });

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    void (async () => {
      let reflectionStatus = getCheckoutReflectionStatus(null, pending);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const refreshed = await fetchAgents();
        if (!active) return;

        reflectionStatus = getCheckoutReflectionStatus(refreshed?.subscriptionSummary ?? null, pending);
        if (reflectionStatus === "ready") {
          break;
        }

        if (attempt < 5) {
          await wait(attempt < 2 ? 1500 : 3000);
          if (!active) return;
        }
      }

      if (!active) return;

      if (reflectionStatus === "ready") {
        clearPendingPlanCheckout();
      }
      dispatchBillingReflection({
        type: "REFLECTION_RECEIVED",
        pending,
        reflectionStatus,
      });

      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
    })();

    return () => {
      active = false;
    };
  }, [fetchAgents]);

  useEffect(() => {
    if (!checkoutSync || (checkoutSync.status !== "success" && checkoutSync.status !== "cancelled")) return;
    const timer = setTimeout(() => dispatchBillingReflection({ type: "DISMISS" }), 5000);
    return () => clearTimeout(timer);
  }, [checkoutSync]);

  const agents = useMemo(() => sdkAgents.map(toAgentViewModel), [sdkAgents]);
  const upgradeProducts = useMemo(
    () => buildUpgradeProducts(catalogPlans).filter((product) => product.id !== "free" && product.price > 0),
    [catalogPlans],
  );
  const upgradeOwnedCounts = useMemo(
    () => Object.fromEntries(upgradeProducts.map((product) => [product.id, countOwnedProduct(subscriptionSummary, product)])),
    [subscriptionSummary, upgradeProducts],
  );
  const upgradeCheckoutOwnedCount = useMemo(
    () => countOwnedCheckoutPlan(subscriptionSummary, upgradeCheckoutPlan),
    [subscriptionSummary, upgradeCheckoutPlan],
  );

  // Detect STARTING→RUNNING for burst
  useEffect(() => {
    const prev = prevStatesRef.current;
    for (const agent of agents) {
      const prevState = prev.get(agent.id);
      if (prevState && (prevState === "STARTING" || prevState === "PENDING") && agent.state === "RUNNING") {
        setBurstAgentId(agent.id);
      }
    }
    const next = new Map<string, AgentState>();
    for (const agent of agents) next.set(agent.id, agent.state);
    prevStatesRef.current = next;
  }, [agents]);

  const selectedSdkAgent = useMemo(
    () => (selectedAgentId ? sdkAgents.find((agent) => agent.id === selectedAgentId) ?? null : null),
    [sdkAgents, selectedAgentId],
  );
  const selectedAgent = useMemo(
    () => (selectedSdkAgent ? toAgentViewModel(selectedSdkAgent) : null),
    [selectedSdkAgent],
  );
  const selectedOpenClawAgent = useMemo(
    () => (selectedSdkAgent && typeof (selectedSdkAgent as { connect?: unknown }).connect === "function"
      ? (selectedSdkAgent as SdkOpenClawAgent)
      : null),
    [selectedSdkAgent],
  );
  const selectedAgentState = selectedAgent?.state ?? null;
  const isSelectedTransitioning = selectedAgent && ["PENDING", "STARTING", "STOPPING"].includes(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";
  useEffect(() => {
    if (!selectedAgentId || !selectedAgentState || !["PENDING", "STARTING", "STOPPING"].includes(selectedAgentState)) {
      return;
    }

    const timer = setInterval(() => {
      void fetchAgents();
    }, 2000);

    return () => clearInterval(timer);
  }, [fetchAgents, selectedAgentId, selectedAgentState]);

  const selectedAgentStartGuidance = useMemo(
    () =>
      selectedAgent && (selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED")
        ? describeAgentTierStartGuidance(selectedAgent, budget)
        : null,
    [selectedAgent, budget],
  );
  const stoppedTabLabel: Record<CenterPanel, string> = {
    chat: "Chat",
    files: "Files",
    integrations: "Integrations",
    scheduled: "Scheduled",
    logs: "Logs",
    settings: "Settings",
    shell: "Shell",
  };
  // Sync settings fields when selected agent changes
  useEffect(() => {
    if (selectedAgent) {
      setSettingsName(selectedAgent.name || "");
    }
  }, [selectedAgentId]);

  // ── Gateway Chat hook ──
  const handleShellData = useCallback((text: string) => {
    if (!text) return;
    shellBufferRef.current.push(text);
    shellTerminalRef.current?.write(text);
  }, []);

  const {
    logs,
    status: wsStatus,
    reconnect: reconnectLogs,
  } = useAgentLogs(deployments, selectedAgentId, mainTab === "logs" && selectedAgentState === "RUNNING");

  const {
    status: shellStatus,
    send: sendShell,
    resize: resizeShell,
    reconnect: reconnectShell,
  } = useAgentShell(deployments, {
    agentId: selectedAgentId,
    enabled: mainTab === "shell" && selectedAgentState === "RUNNING",
    onData: handleShellData,
  });

  const chat = useOpenClawSession(
    selectedAgent && isSelectedRunning ? selectedOpenClawAgent : null,
    mainTab === "chat" ||
      mainTab === "files" ||
      mainTab === "workspace" ||
      mainTab === "integrations" ||
      mainTab === "settings" ||
      openclawSettingsOpen,
  );
  const activeConnectionStatus = useMemo(() => {
    if (!isSelectedRunning) return null;
    if (mainTab === "files") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    if (mainTab === "logs") return wsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "integrations" || mainTab === "settings") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, mainTab, shellStatus, wsStatus]);

  const listAgentFiles = useCallback(async (path?: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return [];
    const token = await getToken();
    const agentClient = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const entries = await agentClient.filesList(selectedAgentId, normalizedPath, source);
    if (source === "auto" && entries.length === 0) {
      for (const fallbackSource of ["s3", "pod"] as const) {
        try {
          const fallbackEntries = await agentClient.filesList(selectedAgentId, normalizedPath, fallbackSource);
          if (fallbackEntries.length > 0) return (fallbackEntries as AgentFileEntry[]).map(toDashboardFileEntry);
        } catch {}
      }
    }
    return (entries as AgentFileEntry[]).map(toDashboardFileEntry);
  }, [getToken, selectedAgentId]);

  const readAgentFile = useCallback(async (path: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return "";
    const token = await getToken();
    const agentClient = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path);
    try {
      return await agentClient.fileRead(selectedAgentId, normalizedPath, source);
    } catch (err) {
      if (source !== "auto") throw err;
      for (const fallbackSource of ["s3", "pod"] as const) {
        try {
          return await agentClient.fileRead(selectedAgentId, normalizedPath, fallbackSource);
        } catch {}
      }
      throw err;
    }
  }, [getToken, selectedAgentId]);

  const readAgentFileBytes = useCallback(async (path: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return new Uint8Array();
    const token = await getToken();
    const agentClient = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path);
    try {
      return await agentClient.fileReadBytes(selectedAgentId, normalizedPath, source);
    } catch (err) {
      if (source !== "auto") throw err;
      for (const fallbackSource of ["s3", "pod"] as const) {
        try {
          return await agentClient.fileReadBytes(selectedAgentId, normalizedPath, fallbackSource);
        } catch {}
      }
      throw err;
    }
  }, [getToken, selectedAgentId]);

  const loadAgentSkills = useCallback(async () => {
    if (!selectedAgentId) return [];
    const token = await getToken();
    const result = await createAgentClient(token).exec(selectedAgentId, buildSkillsSnapshotCommand(), { timeout: 15_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to read /app/skills from the agent.");
    }
    return parseSkillSnapshotOutput(result.stdout);
  }, [getToken, selectedAgentId]);

  const saveAgentFile = useCallback(async (path: string, content: string) => {
    if (!selectedAgentId) return;
    const token = await getToken();
    await createAgentClient(token).fileWrite(selectedAgentId, normalizeAgentFilePath(path), content);
  }, [getToken, selectedAgentId]);

  const deleteAgentFile = useCallback(async (path: string, options?: { recursive?: boolean }) => {
    if (!selectedAgentId) return;
    const token = await getToken();
    await createAgentClient(token).fileDelete(selectedAgentId, normalizeAgentFilePath(path), options);
  }, [getToken, selectedAgentId]);

  const agentStatus = useMemo<AgentStatusChipModel | null>(() => {
    if (!selectedAgent) return null;

    if (selectedAgent.state === "FAILED") {
      return {
        label: "Failed",
        detail: selectedAgent.last_error || "Needs attention before it can run.",
        tone: "failed",
      };
    }

    if (selectedAgent.state === "STOPPED") {
      return {
        label: "Stopped",
        detail: "Start the agent to chat.",
        tone: "stopped",
      };
    }

    if (selectedAgent.state === "PENDING") {
      return {
        label: "Provisioning",
        detail: "Reserving compute and preparing the workspace.",
        tone: "starting",
        loading: true,
      };
    }

    if (selectedAgent.state === "STARTING") {
      return {
        label: "Booting",
        detail: "Starting the container and OpenClaw services.",
        tone: "starting",
        loading: true,
      };
    }

    if (selectedAgent.state === "STOPPING") {
      return {
        label: "Stopping",
        detail: "Stopping the runtime and cleaning up the workspace.",
        tone: "stopping",
        loading: true,
      };
    }

    if (!isSelectedRunning) {
      return {
        label: "Disconnected",
        detail: "Workspace is not connected yet.",
        tone: "disconnected",
      };
    }

    const panelLabel = mainTab === "logs" ? "logs" : mainTab === "shell" ? "shell" : "workspace";
    if (activeConnectionStatus === "connecting") {
      return {
        label: "Connecting",
        detail: panelLabel === "workspace" ? "Opening the gateway connection." : `Opening ${panelLabel} stream.`,
        tone: "connecting",
        loading: true,
      };
    }
    if (activeConnectionStatus === "disconnected") {
      return {
        label: "Disconnected",
        detail: panelLabel === "workspace" ? "Gateway disconnected." : `${panelLabel[0].toUpperCase()}${panelLabel.slice(1)} will reconnect when the gateway is reachable.`,
        tone: "disconnected",
      };
    }
    return {
      label: "Ready",
      detail: panelLabel === "workspace" ? "Chat is available." : `${panelLabel[0].toUpperCase()}${panelLabel.slice(1)} stream connected.`,
      tone: "ready",
    };
  }, [activeConnectionStatus, isSelectedRunning, mainTab, selectedAgent]);

  const openclawSchemaBundle = chat.configSchema;
  const openclawSchemaRoot = useMemo(
    () => asObject(openclawSchemaBundle?.schema ?? null),
    [openclawSchemaBundle]
  );
  const openclawSchemaProperties = useMemo(
    () => asObject(openclawSchemaRoot?.properties ?? null),
    [openclawSchemaRoot]
  );

  const openclawSections = useMemo(
    () => sortOpenClawEntries(Object.entries(openclawSchemaProperties ?? {}), openclawSchemaBundle),
    [openclawSchemaBundle, openclawSchemaProperties]
  );

  useEffect(() => {
    const cfg = asObject(chat.config);
    setOpenclawDraft(deepCloneJsonObject(cfg ?? {}));
    setOpenclawJsonDrafts({});
    setOpenclawJsonDraftErrors({});
    setOpenclawError(null);
    setOpenclawSuccess(null);
  }, [selectedAgentId, chat.config]);

  useEffect(() => {
    if (!activeOpenclawSection && openclawSections.length > 0) {
      setActiveOpenclawSection(openclawSections[0][0]);
    }
    if (activeOpenclawSection && !openclawSections.find(([k]) => k === activeOpenclawSection)) {
      setActiveOpenclawSection(openclawSections[0]?.[0] ?? null);
    }
  }, [openclawSections, activeOpenclawSection]);

  useEffect(() => {
    if (!openclawSettingsOpen) return;
    openclawPaneRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeOpenclawSection, openclawSettingsOpen]);

  // ── Agent inspector data wiring ──

  // Probe channel status when gateway connects, and refresh after config save
  useEffect(() => {
    if (!chat.connected) {
      setChannelsData(null);
      return;
    }
    let cancelled = false;
    chat.channelsStatus(false).then((data) => {
      if (!cancelled) setChannelsData(data as Record<string, unknown>);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chat.connected, chat.channelsStatus]);

  // Derive AgentConfig from raw chat.config (model, system prompt, tools)
  const agentConfigForView = useMemo(() => {
    const cfg = asObject(chat.config);
    if (!cfg) return null;
    const llm = asObject(cfg.llm) ?? {};
    const toolsObj = asObject(cfg.tools) ?? {};
    const tools = Object.entries(toolsObj).map(([name, val]) => {
      const entry = asObject(val);
      return { name, enabled: entry?.enabled === true };
    });
    const defaultModel = getOpenClawDefaultModel(cfg);
    return {
      model: defaultModel || "unknown",
      systemPrompt: typeof llm.system === "string" ? llm.system : (typeof llm.systemPrompt === "string" ? llm.systemPrompt : ""),
      tools,
    };
  }, [chat.config]);

  // Module variants per design doc Section 2 — only enable what's in scope.
  // Out-of-scope modules (Section 11) stay "off" by default.
  // Overview: Agent Card, Active Sessions, Workspace Files, What Can I Do?, Example Prompts
  // Activity: filterable event log
  // Connections: flat list + CTA
  // Cron: scheduled jobs manager
  const agentViewVariants = useMemo(() => ({
    // Overview — in scope
    agentCardVariant: "v1" as const,
    workspaceFilesVariant: "v1" as const,
    whatCanIDoVariant: "v1" as const,
    examplePromptsVariant: "v1" as const,
    // Activity tab
    activityVariant: "v1" as const,
    // Connections tab
    connectionRowStyle: "v1" as const,
  }), []);

  // One thread per agent, used by both the left ConversationsSidebar and the
  // right inspector (which needs `hasAgent` true to render content).
  const syntheticThreads = useMemo<ConversationThread[]>(() => {
    return agents.map((agent) => ({
      id: agent.id,
      sessionKey: resolveOpenClawSessionKey(agent.id),
      participants: [
        { id: "user", name: "You", type: "user" as const },
        { id: agent.id, name: agent.name || agent.id, type: "agent" as const, meta: agent.meta ?? null },
      ],
      kind: "user-agent" as const,
      title: agent.name || agent.pod_name || agent.id,
      lastMessage: agent.state === "RUNNING" ? "Connected" : agent.state.toLowerCase(),
      lastMessageBy: agent.id,
      lastMessageAt: agent.updated_at ? new Date(agent.updated_at).getTime() : Date.now(),
      messageCount: agent.id === selectedAgentId ? chat.messages.length : 0,
      unreadCount: 0,
      isActive: agent.state === "RUNNING",
    }));
  }, [agents, selectedAgentId, chat.messages.length]);

  // Derive RecentToolCall[] by flattening toolCalls across assistant messages.
  // Newest last (matches the Activity tab order).
  const recentToolCallsForView = useMemo(() => {
    if (!chat.messages || chat.messages.length === 0) return null;
    const out: Array<{ id: string; name: string; args: string; result?: string; timestamp: number }> = [];
    chat.messages.forEach((msg) => {
      if (msg.role !== "assistant" || !msg.toolCalls) return;
      const ts = msg.timestamp ?? Date.now();
      msg.toolCalls.forEach((tc, idx) => {
        out.push({
          id: tc.id ?? `${ts}-${idx}`,
          name: tc.name,
          args: tc.args,
          result: tc.result,
          timestamp: ts,
        });
      });
    });
    return out.length > 0 ? out.slice(-20) : null;
  }, [chat.messages]);

  // Derive ActivityEntry[] from chat.activityFeed (icons added per type)
  const activityEntriesForView = useMemo(() => {
    if (!chat.activityFeed || chat.activityFeed.length === 0) return null;
    return chat.activityFeed.map((entry) => {
      let icon = MessageSquare;
      if (entry.type === "tool") icon = SlidersHorizontal;
      else if (entry.type === "error") icon = X;
      else if (entry.type === "system") icon = Settings;
      else if (entry.type === "connection") icon = Link2;
      else if (entry.type === "skill") icon = Zap;
      else if (entry.type === "cron") icon = Timer;
      return { ...entry, icon };
    });
  }, [chat.activityFeed]);

  // Derive workspace files from chat.files (gateway only returns files, not directories)
  const agentWorkspaceFilesForView = useMemo(() => {
    if (!chat.files || chat.files.length === 0) return null;
    return chat.files.map((f) => ({
      name: f.name,
      type: "file" as const,
      size: f.size,
    }));
  }, [chat.files]);

  // Derive CronJob[] from chat.cronJobs
  const agentCronJobsForView = useMemo(() => {
    if (!chat.cronJobs || chat.cronJobs.length === 0) return null;
    return chat.cronJobs.map((j) => {
      const entry = j as Record<string, unknown>;
      return {
        id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
        schedule: typeof entry.schedule === "string" ? entry.schedule : "",
        prompt: typeof entry.prompt === "string" ? entry.prompt : "",
        description: typeof entry.description === "string" ? entry.description : "",
        enabled: entry.enabled !== false,
        lastRun: typeof entry.lastRun === "number" ? entry.lastRun : undefined,
        nextRun: typeof entry.nextRun === "number" ? entry.nextRun : undefined,
      };
    });
  }, [chat.cronJobs]);

  // Derive AgentSession[] from chat.sessions
  const agentSessionsForView = useMemo(() => {
    if (!chat.sessions || chat.sessions.length === 0) return null;
    return chat.sessions.map((s) => {
      const entry = s as Record<string, unknown>;
      const key = typeof entry.key === "string" ? entry.key : String(entry.id ?? "");
      const clientMode = typeof entry.clientMode === "string" ? entry.clientMode : (typeof entry.client === "string" ? entry.client : "unknown");
      const clientDisplayName = typeof entry.clientDisplayName === "string" ? entry.clientDisplayName : (typeof entry.displayName === "string" ? entry.displayName : key);
      const createdAt = typeof entry.createdAt === "number" ? entry.createdAt : Date.now();
      const lastMessageAt = typeof entry.lastMessageAt === "number" ? entry.lastMessageAt : createdAt;
      return { key, clientMode, clientDisplayName, createdAt, lastMessageAt };
    });
  }, [chat.sessions]);

  // Derive Connection[] from channelsStatus response
  const agentConnectionsForView = useMemo(() => {
    const channels = asObject(channelsData?.channels);
    if (!channels) return null;
    return Object.entries(channels).map(([key, val]) => {
      const entry = asObject(val) ?? {};
      const configured = entry.configured === true;
      const running = entry.running === true;
      return {
        id: key,
        name: humanizeKey(key),
        icon: Plug,
        category: "Communication",
        connected: configured && running,
        description: configured ? (running ? "Active" : "Configured · idle") : "Not configured",
      };
    });
  }, [channelsData]);

  const agentCardDataById = useMemo(() => {
    if (!selectedAgent) return {};
    return {
      [selectedAgent.id]: {
        id: selectedAgent.id,
        name: selectedAgent.name || selectedAgent.id,
        state: selectedAgent.state,
        cpuMillicores: selectedAgent.cpu_millicores,
        memoryMib: selectedAgent.memory_mib,
        hostname: selectedAgent.hostname,
        startedAt: selectedAgent.started_at,
        updatedAt: selectedAgent.updated_at,
        lastError: selectedAgent.last_error,
        meta: selectedAgent.meta,
        config: agentConfigForView,
        connections: agentConnectionsForView?.map((connection) => ({
          id: connection.id,
          name: connection.name,
          connected: connection.connected,
        })) ?? null,
        sessions: agentSessionsForView?.map((session) => ({ key: session.key })) ?? null,
        files: agentWorkspaceFilesForView?.map((file) => ({
          name: file.name,
          size: file.size,
        })) ?? null,
        activity: activityEntriesForView?.map((entry) => ({
          id: entry.id,
          action: entry.action,
          detail: entry.detail,
          timestamp: entry.timestamp,
        })) ?? null,
      },
    };
  }, [
    activityEntriesForView,
    agentConfigForView,
    agentConnectionsForView,
    agentSessionsForView,
    agentWorkspaceFilesForView,
    selectedAgent,
  ]);

  const effectiveOpenclawSection = useMemo(
    () => (isDesktopViewport ? (activeOpenclawSection ?? openclawSections[0]?.[0] ?? null) : activeOpenclawSection),
    [activeOpenclawSection, isDesktopViewport, openclawSections]
  );

  const visibleOpenclawSections = useMemo(() => {
    if (!effectiveOpenclawSection) return openclawSections;
    const selected = openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection);
    return selected ? [selected] : openclawSections;
  }, [effectiveOpenclawSection, openclawSections]);

  const activeOpenclawSectionEntry = useMemo(
    () => openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection) ?? null,
    [effectiveOpenclawSection, openclawSections]
  );

  const activeOpenclawSectionLabel = useMemo(() => {
    if (!activeOpenclawSectionEntry) return null;
    const [sectionKey, sectionSchema] = activeOpenclawSectionEntry;
    return (
      getOpenClawUiHint(openclawSchemaBundle, [sectionKey])?.label?.trim()
      || (typeof asObject(sectionSchema)?.title === "string"
        ? String(asObject(sectionSchema)?.title)
        : humanizeKey(sectionKey))
    );
  }, [activeOpenclawSectionEntry, openclawSchemaBundle]);

  const updateOpenclawPath = useCallback((path: string[], value: unknown) => {
    setOpenclawDraft((prev) => {
      const base = prev ? deepCloneJsonObject(prev) : {};
      return setPathValue(base, path, value);
    });
  }, []);

  const setOpenclawJsonDraftError = useCallback((pathKey: string, message: string | null) => {
    setOpenclawJsonDraftErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[pathKey] = message;
      } else {
        delete next[pathKey];
      }
      return next;
    });
    if (message) {
      setOpenclawError(message);
    }
  }, []);

  const updateOpenclawJsonDraft = useCallback((path: string[], raw: string) => {
    const pathKey = path.join(".");
    setOpenclawJsonDrafts((prev) => ({ ...prev, [pathKey]: raw }));
    try {
      updateOpenclawPath(path, JSON.parse(raw));
      setOpenclawJsonDraftError(pathKey, null);
      setOpenclawError(null);
    } catch {
      setOpenclawJsonDraftError(pathKey, `Invalid JSON at ${path.join(".")}`);
    }
  }, [setOpenclawJsonDraftError, updateOpenclawPath]);

  const removeOpenclawPath = useCallback((path: string[]) => {
    setOpenclawDraft((prev) => {
      if (!prev || path.length === 0) return prev;
      const base = deepCloneJsonObject(prev);
      const parentPath = path.slice(0, -1);
      const leafKey = path[path.length - 1];
      const parent = parentPath.length === 0 ? base : getPathValue(base, parentPath);
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
        return base;
      }
      delete (parent as JsonObject)[leafKey];
      return base;
    });
  }, []);

  const addOpenclawMapEntry = useCallback((path: string[], schemaRaw: unknown) => {
    const pathKey = path.join(".");
    const nextKey = (openclawMapDraftKeys[pathKey] ?? "").trim();
    if (!nextKey) return;
    updateOpenclawPath([...path, nextKey], createOpenClawConfigValue(schemaRaw));
    setOpenclawMapDraftKeys((prev) => ({ ...prev, [pathKey]: "" }));
  }, [openclawMapDraftKeys, updateOpenclawPath]);

  const saveOpenclawPatch = useCallback(async (patch: JsonObject, successText: string) => {
    if (!chat.connected) {
      setOpenclawError("Gateway disconnected. Reconnect before saving OpenClaw settings.");
      return;
    }
    const jsonDraftError = Object.values(openclawJsonDraftErrors)[0];
    if (jsonDraftError) {
      setOpenclawError(jsonDraftError);
      return;
    }
    setOpenclawSaving(true);
    setOpenclawError(null);
    setOpenclawSuccess(null);
    try {
      await chat.saveConfig(patch);
      setOpenclawJsonDrafts({});
      setOpenclawJsonDraftErrors({});
      setOpenclawSuccess(successText);
    } catch (err) {
      setOpenclawError(err instanceof Error ? err.message : "Failed to save OpenClaw config");
    } finally {
      setOpenclawSaving(false);
    }
  }, [chat, openclawJsonDraftErrors]);

  const saveOpenclawSection = useCallback(async (sectionKey: string) => {
    if (!openclawDraft) return;
    await saveOpenclawPatch({ [sectionKey]: openclawDraft[sectionKey] }, `Saved section: ${sectionKey}`);
  }, [openclawDraft, saveOpenclawPatch]);

  const saveAllOpenclaw = useCallback(async () => {
    if (!openclawDraft) return;
    await saveOpenclawPatch(openclawDraft, "Saved all OpenClaw settings");
  }, [openclawDraft, saveOpenclawPatch]);

  const renderOpenclawField = useCallback((schemaRaw: unknown, path: string[], depth = 0): React.ReactNode => {
    try {
    const schema = normalizeOpenClawConfigSchemaNode(schemaRaw);
    const descriptor = describeOpenClawConfigNode(schemaRaw);
    const hint = getOpenClawUiHint(openclawSchemaBundle, path);
    const title =
      hint?.label?.trim() ||
      (typeof schema.title === "string" ? schema.title : "") ||
      humanizeKey(path[path.length - 1] || "setting");
    const description =
      hint?.help?.trim() ||
      (typeof schema.description === "string" ? schema.description : "");
    const placeholder =
      hint?.placeholder && hint.placeholder.trim() ? hint.placeholder : undefined;
    const typeRaw = schema.type;
    const type = Array.isArray(typeRaw)
      ? (typeRaw.find((entry) => entry !== "null") as string | undefined)
      : (typeof typeRaw === "string" ? typeRaw : undefined);
    const enumValues: unknown[] = Array.isArray(schema.enum) ? schema.enum : [];
    const currentValue = openclawDraft ? getPathValue(openclawDraft, path) : undefined;
    const key = path.join(".");
    const fieldDisabled = !chat.connected || openclawSaving;

    const propertyKeys = descriptor.properties;
    const additionalSchema = descriptor.additionalPropertySchema;
    if (type === "object" || Object.keys(propertyKeys).length > 0 || descriptor.additionalProperties) {
      const entries = Object.keys(propertyKeys).length > 0
        ? sortOpenClawEntries(Object.entries(propertyKeys), openclawSchemaBundle, path)
        : [];
      const dynamicEntries = descriptor.additionalProperties && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
        ? Object.entries(currentValue as JsonObject).filter(([childKey]) => !(childKey in propertyKeys))
        : [];
      if (entries.length === 0 && dynamicEntries.length === 0 && !descriptor.additionalProperties) {
        // Fallback: render JSON editor for object schemas with no resolved properties (e.g. unresolved $ref)
        if (typeof console !== "undefined") {
          console.warn(`[OpenClaw] Section "${key}" has type "object" but no resolved properties. Schema may contain unresolved $ref.`, schema);
        }
        const fallbackValue = openclawJsonDrafts[key] ??
          (typeof currentValue === "undefined" || currentValue === null ? "{}" : JSON.stringify(currentValue, null, 2));
        return (
          <div key={key} className="space-y-1">
            <label className="block text-sm text-text-secondary">{title}</label>
            {description && <p className="text-xs text-text-muted">{description}</p>}
            <textarea
              value={fallbackValue}
              onChange={(e) => updateOpenclawJsonDraft(path, e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={placeholder}
              disabled={fieldDisabled}
              className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        );
      }
      return (
        <div key={key} className={depth > 0 ? "rounded-lg border border-border p-3 space-y-3" : "space-y-3"}>
          {depth > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {hint?.advanced && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    advanced
                  </span>
                )}
              </div>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          )}
          {entries.map(([childKey, childSchema]) => renderOpenclawField(childSchema, [...path, childKey], depth + 1))}
          {descriptor.additionalProperties && (
            <div className="space-y-3">
              {dynamicEntries.map(([childKey]) => (
                <div key={`${key}-dynamic-${childKey}`} className="rounded-lg border border-border/70 bg-surface-low/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{childKey}</p>
                    <button
                      type="button"
                      onClick={() => removeOpenclawPath([...path, childKey])}
                      disabled={fieldDisabled}
                      className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-[#d05f5f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                  {renderOpenclawField(additionalSchema ? { ...additionalSchema, title: childKey } : { title: childKey, type: "object" }, [...path, childKey], depth + 1)}
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-3 md:flex-row md:items-center">
                <input
                  type="text"
                  value={openclawMapDraftKeys[key] ?? ""}
                  onChange={(e) => setOpenclawMapDraftKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`Add ${title.toLowerCase()} key`}
                  disabled={fieldDisabled}
                  className="flex-1 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => addOpenclawMapEntry(path, additionalSchema ?? { type: "object" })}
                  disabled={fieldDisabled}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    const jsonValue = openclawJsonDrafts[key] ??
      (typeof currentValue === "undefined"
        ? (type === "array" ? "[]" : type === "object" ? "{}" : "")
        : JSON.stringify(currentValue, null, 2));

    return (
      <div key={key} className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label className="block text-sm text-text-secondary">{title}</label>
          {hint?.sensitive && (
            <span className="rounded-full border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#d05f5f]">
              sensitive
            </span>
          )}
          {hint?.advanced && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
              advanced
            </span>
          )}
        </div>
        {description && <p className="text-xs text-text-muted">{description}</p>}
        {enumValues.length > 0 ? (
          <select
            value={currentValue == null ? "" : JSON.stringify(currentValue)}
            onChange={(e) => {
              if (!e.target.value) {
                updateOpenclawPath(path, null);
                return;
              }
              const nextValue = enumValues.find((value) => JSON.stringify(value) === e.target.value);
              updateOpenclawPath(path, nextValue ?? e.target.value);
            }}
            disabled={fieldDisabled}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">(unset)</option>
            {enumValues.map((value) => (
              <option key={`${key}-enum-${JSON.stringify(value)}`} value={JSON.stringify(value)}>
                {String(value)}
              </option>
            ))}
          </select>
        ) : type === "boolean" ? (
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={Boolean(currentValue)}
              onChange={(e) => updateOpenclawPath(path, e.target.checked)}
              disabled={fieldDisabled}
              className="rounded border-border bg-surface-low disabled:cursor-not-allowed disabled:opacity-60"
            />
            Enabled
          </label>
        ) : type === "number" || type === "integer" ? (
          <input
            type="number"
            value={typeof currentValue === "number" ? String(currentValue) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                updateOpenclawPath(path, null);
                return;
              }
              const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
              if (!Number.isNaN(parsed)) updateOpenclawPath(path, parsed);
            }}
            placeholder={placeholder}
            disabled={fieldDisabled}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
          />
        ) : type === "array" || type === "object" ? (
          <textarea
            value={jsonValue}
            onChange={(e) => updateOpenclawJsonDraft(path, e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={placeholder}
            disabled={fieldDisabled}
            className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
          />
        ) : (
          <input
            type={hint?.sensitive ? "password" : "text"}
            value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
            onChange={(e) => updateOpenclawPath(path, e.target.value)}
            placeholder={placeholder}
            disabled={fieldDisabled}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
          />
        )}
      </div>
    );
    } catch (err) {
      const key = path.join(".");
      console.error(`[OpenClaw] Failed to render field "${key}":`, err);
      return (
        <div key={key} className="text-xs text-[#d05f5f] p-2 rounded border border-[#d05f5f]/30">
          Failed to render {key}: {err instanceof Error ? err.message : String(err)}
        </div>
      );
    }
  }, [addOpenclawMapEntry, chat.connected, openclawDraft, openclawJsonDrafts, openclawMapDraftKeys, openclawSaving, openclawSchemaBundle, removeOpenclawPath, updateOpenclawJsonDraft, updateOpenclawPath]);

  // Auto-scroll chat — only when user is near bottom (not scrolled up reading)
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 100px of the end
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    const count = chat.messages.length;
    if (count !== lastMsgCountRef.current) {
      lastMsgCountRef.current = count;
      // Always scroll on new message (user sent or agent started replying)
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    } else if (isNearBottomRef.current) {
      // Streaming update — only scroll if already near bottom
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    }
  }, [chat.messages]);

  // When a reply finishes streaming, snap to the last line regardless of
  // scroll position so the end of the message is always visible.
  const prevSendingRef = useRef(chat.sending);
  useEffect(() => {
    if (prevSendingRef.current && !chat.sending) {
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
    prevSendingRef.current = chat.sending;
  }, [chat.sending]);

  // Scroll to bottom when user switches back to chat tab.
  // useLayoutEffect runs synchronously after DOM commit (refs are set)
  // but before browser paint, so the user never sees the un-scrolled state.
  useLayoutEffect(() => {
    if (mainTab === "chat" && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [mainTab]);

  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);

  useEffect(() => {
    if (mainTab !== "shell") return;
    if (!shellBoxRef.current) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 3000,
      theme: {
        background: "#0c1016",
        foreground: "#d8dde7",
        cursor: "#d8dde7",
        selectionBackground: "#2a3445",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(shellBoxRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });

    if (shellSessionAgentRef.current !== selectedAgentId) {
      shellBufferRef.current = [];
      shellSessionAgentRef.current = selectedAgentId;
    }

    for (const chunk of shellBufferRef.current) {
      term.write(chunk);
    }

    const disposable = term.onData((data) => {
      sendShell(data);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      resizeShell(rows, cols);
    });

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    shellTerminalRef.current = term;
    shellFitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener("resize", onResize);
      resizeDisposable.dispose();
      disposable.dispose();
      term.dispose();
      shellTerminalRef.current = null;
      shellFitAddonRef.current = null;
    };
  }, [mainTab, resizeShell, selectedAgentId, sendShell]);

  // ── Actions ──

  const handleStart = async (agentId: string) => {
    const sdkAgent = sdkAgents.find((entry) => entry.id === agentId) ?? null;
    const agent = sdkAgent ? toAgentViewModel(sdkAgent) : null;
    const guidance = describeAgentTierStartGuidance(agent, budget);
    if (guidance) {
      if (guidance.availableTiers.length > 0) {
        setTierSelection({ agentId, guidance });
      } else {
        setError(guidance.message);
      }
      return;
    }
    setStartingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      const startedAgent = await startOpenClawAgent(token, agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, startedAgent));
    } catch (err) {
      const requestedTier = parseEntitlementSlotTier(err);
      if (requestedTier) {
        const fallbackPreset = getAgentSizePresets(budget)[requestedTier];
        const tierGuidance = describeAgentTierStartGuidance(
          agent && inferAgentTier(agent, budget) === requestedTier
            ? agent
            : fallbackPreset
              ? {
                  cpu_millicores: fallbackPreset.cpu_millicores,
                  memory_mib: fallbackPreset.memory_mib,
                }
              : null,
          budget,
        );
        setError(tierGuidance?.message ?? (err instanceof Error ? err.message : "Failed to start agent"));
      } else {
        setError(err instanceof Error ? err.message : "Failed to start agent");
      }
    } finally {
      setStartingId(null);
    }
  };

  const handleCreateFirstAgent = useCallback(async ({ name, iconIndex, size }: { name: string; iconIndex: number; size: string }) => {
    try {
      setError(null);
      const token = await getToken();
      const created = await createOpenClawAgent(token, {
        name: name || undefined,
        start: true,
        size,
        meta: { ui: { avatar: { icon_index: iconIndex } } },
      });
      await fetchAgents();
      if (created.id) {
        setSelectedAgentId(created.id);
        setMainTab("chat");
        setMobileShowChat(true);
        return created.id;
      }
      setError("Agent was created, but no agent id was returned.");
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create agent";
      setError(message);
      throw err;
    }
  }, [fetchAgents, getToken]);

  const handleResizeAndStart = useCallback(async (agentId: string, tier: string) => {
    setStartingId(agentId);
    setError(null);
    setTierSelection(null);
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const resizedAgent = await agentClient.resize(agentId, { size: tier });
      setSdkAgents((prev) => upsertSdkAgent(prev, resizedAgent));
      const startedAgent = await startOpenClawAgent(token, agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, startedAgent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resize and start agent");
    } finally {
      setStartingId(null);
    }
  }, [getToken]);

  const selectedAgentHasTierOptions = Boolean(selectedAgentStartGuidance?.availableTiers?.length);
  const selectedAgentRecentlyStopped = Boolean(selectedAgent && recentlyStoppedIds.has(selectedAgent.id));
  const selectedAgentTierLaunchBlocked = Boolean(selectedAgentStartGuidance && !selectedAgentHasTierOptions);
  const selectedAgentLaunchBlocked = selectedAgentTierLaunchBlocked || selectedAgentRecentlyStopped;
  const selectedAgentStartBlockedTitle = selectedAgentRecentlyStopped
    ? "Agent is finishing shutdown"
    : selectedAgentStartGuidance?.title;
  const selectedAgentStartBlockedMessage = selectedAgentRecentlyStopped
    ? "Wait a few seconds before starting this agent again."
    : selectedAgentStartGuidance?.message;
  const selectedAgentStarting = Boolean(selectedAgent && startingId === selectedAgent.id);
  const workspaceSidebarDisabled = agentsLoading || Boolean(selectedAgent && (chat.connecting || chat.hydrating));
  const workspaceSidebarDisabledReason = getWorkspaceSidebarDisabledReason({
    agentsLoading,
    connecting: chat.connecting,
    hydrating: chat.hydrating,
  });

  const selectedAgentSuggestedTierActions = useMemo(
    () =>
      (selectedAgentStartGuidance?.availableTiers ?? []).map((entry) => ({
        label: `Resize To ${titleizeTier(entry.tier)} And Start (${entry.available} free)`,
        onSelect: () => {
          if (selectedAgent) {
            void handleResizeAndStart(selectedAgent.id, entry.tier);
          }
        },
      })),
    [handleResizeAndStart, selectedAgent, selectedAgentStartGuidance],
  );

  const handleStop = async (agentId: string) => {
    setStoppingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      const stoppedAgent = await createAgentClient(token).stop(agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, stoppedAgent));
      // Cooldown: disable Start for 5s while the runtime finishes cleanup.
      setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
      const existing = stoppedTimersRef.current.get(agentId);
      if (existing) clearTimeout(existing);
      stoppedTimersRef.current.set(agentId, setTimeout(() => {
        setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
        stoppedTimersRef.current.delete(agentId);
      }, 10000));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setStoppingId(null);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingId(agentId);
    setError(null);
    try {
      const agentToDelete = agents.find((agent) => agent.id === agentId) ?? null;
      const releaseTier = agentToDelete ? inferAgentTier(agentToDelete, budget) : null;
      const releaseBaseline = releaseTier ? budget?.slots?.[releaseTier] : null;
      const token = await getToken();
      await createAgentClient(token).delete(agentId);
      const nextAgents = removeSdkAgent(sdkAgents, agentId);
      const deletedIndex = sdkAgents.findIndex((agent) => agent.id === agentId);
      const replacementIndex = deletedIndex === -1 ? 0 : Math.min(deletedIndex, nextAgents.length - 1);
      const replacementAgentId = nextAgents[replacementIndex]?.id ?? null;
      setSdkAgents(nextAgents);
      setSelectedAgentId((currentId) => {
        if (currentId === agentId) return replacementAgentId;
        if (currentId && nextAgents.some((agent) => agent.id === currentId)) return currentId;
        return replacementAgentId;
      });
      const refreshed = await fetchAgents();
      if (releaseTier && releaseBaseline && !slotReleaseLanded(releaseBaseline, refreshed?.budget?.slots?.[releaseTier])) {
        trackPendingSlotRelease(`${agentId}:${releaseTier}:${Date.now()}`, releaseTier, releaseBaseline);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeletingId(null);
      setPendingAgentDelete(null);
    }
  };

  const handleSaveName = async () => {
    if (!selectedAgent || selectedAgent.state !== "STOPPED") return;
    const trimmed = settingsName.trim();
    if (!trimmed || trimmed === (selectedAgent.name || "")) return;
    setSavingName(true);
    try {
      const token = await getToken();
      const updatedAgent = await createAgentClient(token).update(selectedAgent.id, { name: trimmed });
      setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename agent");
    } finally {
      setSavingName(false);
    }
  };

  // Audio recording
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [audioPreviewPlaying, setAudioPreviewPlaying] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelAnimRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analyser for volume visualization
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Volume level animation loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(avg / 128, 1)); // normalize to 0-1
        levelAnimRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      setRecordingDuration(0);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(levelAnimRef.current);
        audioCtx.close();
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      // Mic permission denied
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const discardAudio = useCallback(() => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioPreviewDuration(0);
    setAudioPreviewPlaying(false);
    setRecordingDuration(0);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl) return;
    const previewAudio = new Audio(audioUrl);
    previewAudio.preload = "metadata";
    const syncDuration = () => {
      if (Number.isFinite(previewAudio.duration) && previewAudio.duration > 0) {
        setAudioPreviewDuration(Math.round(previewAudio.duration));
      }
    };
    const onPlay = () => setAudioPreviewPlaying(true);
    const onPause = () => setAudioPreviewPlaying(false);
    previewAudio.addEventListener("loadedmetadata", syncDuration);
    previewAudio.addEventListener("durationchange", syncDuration);
    previewAudio.addEventListener("play", onPlay);
    previewAudio.addEventListener("pause", onPause);
    previewAudio.addEventListener("ended", onPause);
    audioPreviewRef.current = previewAudio;
    return () => {
      previewAudio.pause();
      previewAudio.removeEventListener("loadedmetadata", syncDuration);
      previewAudio.removeEventListener("durationchange", syncDuration);
      previewAudio.removeEventListener("play", onPlay);
      previewAudio.removeEventListener("pause", onPause);
      previewAudio.removeEventListener("ended", onPause);
      previewAudio.src = "";
      audioPreviewRef.current = null;
      setAudioPreviewPlaying(false);
    };
  }, [audioUrl]);

  const toggleAudioPreviewPlayback = useCallback(() => {
    const previewAudio = audioPreviewRef.current;
    if (!previewAudio) return;
    if (previewAudio.paused) {
      void previewAudio.play();
      return;
    }
    previewAudio.pause();
  }, []);

  const sendAudio = useCallback(async () => {
    if (!audioBlob || !selectedAgent || sendingAudio || !chat.connected) return;
    setSendingAudio(true);
    try {
      const token = await getToken();
      const timestamp = Date.now();
      const filename = `voice-${timestamp}.webm`;
      const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${filename}`;
      const agentPath = `${OPENCLAW_WORKSPACE_DIR}/${filename}`;
      const voiceMessage = `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${agentPath}\``;
      await createAgentClient(token).fileWriteBytes(selectedAgent.id, uploadPath, await audioBlob.arrayBuffer());
      // Keep input state in sync and send in one action.
      chat.setInput(voiceMessage);
      await chat.sendMessage(voiceMessage);
      discardAudio();
    } catch (e) {
      console.error("Audio upload failed:", e);
      setError(e instanceof Error ? e.message : "Audio upload failed");
    } finally {
      setSendingAudio(false);
    }
  }, [audioBlob, chat, discardAudio, selectedAgent, getToken, sendingAudio]);

  const handleChatFileDrop = useCallback(async (fileList: FileList | File[]) => {
    if (!selectedAgent || !chat.connected) return;

    const files = Array.from(fileList);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const uploaded: Array<{ name: string; path: string; type: string }> = [];

      for (const file of files) {
        const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${file.name}`;
        await agentClient.fileWriteBytes(selectedAgent.id, uploadPath, await file.arrayBuffer());
        uploaded.push({
          name: file.name,
          path: `${OPENCLAW_SYNC_ROOT}/${uploadPath}`,
          type: file.type,
        });
      }

      if (imageFiles.length > 0) {
        const dt = new DataTransfer();
        imageFiles.forEach((file) => dt.items.add(file));
        chat.addAttachments(dt.files);
      }
      chat.addPendingFiles(uploaded);
    } catch (e) {
      console.error("Chat file upload failed:", e);
      setError(e instanceof Error ? e.message : "File upload failed");
    }
  }, [chat, getToken, selectedAgent]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleSendChat = () => {
    if (chat.sending) {
      chat.setInput("");
      chat.addPendingMessage(chat.input);
      return;
    }
    chat.sendMessage();
  };

  const selectedCenterPanel: CenterPanel =
    mainTab === "files" ||
    mainTab === "integrations" ||
    mainTab === "scheduled" ||
    mainTab === "logs" ||
    mainTab === "shell" ||
    mainTab === "settings"
      ? mainTab
      : "chat";

  useEffect(() => {
    if (!SCHEDULED_SECTION_ENABLED && mainTab === "scheduled") {
      setMainTab("chat");
    }
  }, [mainTab]);

  useEffect(() => {
    if (!selectedAgent && openclawSettingsOpen) {
      setOpenclawSettingsOpen(false);
    }
  }, [openclawSettingsOpen, selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) {
      setAgentMenu(null);
      return;
    }
    setAgentMenu({
      selectedAgentId: selectedAgent.id,
	      activeTab: mainTab,
	      onSelectTab: (tab) => {
	        if (tab === "files") {
	          setMainTab("files");
	          setMobileShowChat(true);
	          return;
	        }
        if (tab === "workspace") {
          setMainTab("chat");
          setMobileShowChat(true);
          return;
        }
        if (tab === "openclaw") {
          setOpenclawSettingsOpen(true);
          setMobileShowChat(true);
          return;
        }
        if (tab === "integrations") {
          setDirectoryCategory(undefined);
          setDirectoryItemId(undefined);
          setDirectoryDetailOrigin(null);
          setMainTab("integrations");
          setMobileShowChat(true);
          return;
        }
        if (tab === "settings") {
          setMainTab("settings");
          setMobileShowChat(true);
          return;
        }
        if (tab === "scheduled" && !SCHEDULED_SECTION_ENABLED) {
          setMainTab("chat");
          setMobileShowChat(true);
          return;
        }
        setMainTab(tab);
        setMobileShowChat(true);
      },
      onDelete: () => {
        setPendingAgentDelete({
          id: selectedAgent.id,
          name: selectedAgent.name || selectedAgent.id,
        });
      },
      deleting: deletingId === selectedAgent.id,
    });
    return () => setAgentMenu(null);
  }, [selectedAgent, mainTab, deletingId, setAgentMenu, router]);

  // ── Render ──
  const mobileMainPanelVisible = !isDesktopViewport || mobileShowChat || agentsLoading || !selectedAgent;
  const closeMobileSidebars = () => {
    setMobileAgentsSidebarOpen(false);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openAgentSettingsTab = () => {
    setMainTab("settings");
    setMobileShowChat(true);
    closeMobileSidebars();
  };
  const openChatTab = () => {
    setMainTab("chat");
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    setMobileShowChat(true);
    closeMobileSidebars();
  };
  const openFilesTab = () => {
    setMainTab("files");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openIntegrationsTab = () => {
    setDirectoryCategory(undefined);
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setMainTab("integrations");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openSkillsTab = () => {
    setDirectoryCategory("skills");
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setMainTab("integrations");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openScheduledTab = () => {
    if (!SCHEDULED_SECTION_ENABLED) return;
    setMainTab("scheduled");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openLogsTab = () => {
    setMainTab("logs");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openShellTab = () => {
    setMainTab("shell");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openOpenClawSettings = () => {
    if (!selectedAgent) {
      openAgentSettingsTab();
      return;
    }
    setOpenclawSettingsOpen(true);
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openMobileAgentLauncher = () => {
    setMobileAgentsSidebarOpen(false);
    setMobileAgentLauncherOpen(true);
  };
  const createMobileAgentFromLauncher = async (params: { name: string; iconIndex: number; size: string }) => {
    try {
      const createdId = await handleCreateFirstAgent(params);
      if (createdId) {
        setMobileAgentLauncherOpen(false);
        setMobileAgentsSidebarOpen(false);
      }
      return createdId;
    } catch {
      return null;
    }
  };
  const showMobileChatReturn = !isDesktopViewport && (mainTab !== "chat" || openclawSettingsOpen);
  const useSettingsMobileChrome = !isDesktopViewport && mainTab === "settings" && Boolean(selectedAgent) && !openclawSettingsOpen;

  return (
    <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header + menu (hidden on desktop) */}
      {!isDesktopViewport && !useSettingsMobileChrome && (
        <div className="relative flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <HyperClawLogoLink className="h-[31px] w-[102px]" priority />
            <span className="text-text-muted font-medium">Agents</span>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-low/80 p-1">
            <AnimatePresence initial={false}>
              {showMobileChatReturn && (
                <motion.button
                  key="mobile-chat-return"
                  type="button"
                  aria-label="Back to chat"
                  onClick={openChatTab}
                  initial={{ opacity: 0, scale: 0.85, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 40 }}
                  exit={{ opacity: 0, scale: 0.85, width: 0 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-secondary transition-colors hover:bg-background hover:text-foreground"
                >
                  <MessageSquare className="h-5 w-5 shrink-0" />
                </motion.button>
              )}
            </AnimatePresence>
            <button
              type="button"
              aria-label="Open agents sidebar"
              aria-expanded={mobileAgentsSidebarOpen}
              onClick={() => {
                setMobileWorkspaceSidebarOpen(false);
                setMobileAgentsSidebarOpen((open) => !open);
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                mobileAgentsSidebarOpen
                  ? "border-[#38D39F]/30 bg-[#38D39F]/10 text-[#38D39F]"
                  : "border-transparent text-text-secondary hover:bg-background hover:text-foreground"
              }`}
            >
              <Bot className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Open workspace sidebar"
              aria-expanded={mobileWorkspaceSidebarOpen}
              onClick={() => {
                setMobileAgentsSidebarOpen(false);
                setMobileWorkspaceSidebarOpen((open) => !open);
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                mobileWorkspaceSidebarOpen
                  ? "border-[#38D39F]/30 bg-[#38D39F]/10 text-[#38D39F]"
                  : "border-transparent text-text-secondary hover:bg-background hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {checkoutSync && (
        <div
          className={`mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm sm:mx-6 lg:mx-8 ${
            checkoutSync.status === "pending" || checkoutSync.status === "cancelled"
              ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
              : "border-[#38D39F]/25 bg-[#38D39F]/10 text-[#B7F5DF]"
          }`}
        >
          <span>{checkoutSync.message}</span>
          <div className="flex shrink-0 items-center gap-2">
            {checkoutSync.status === "pending" && (
              <button
                type="button"
                onClick={() => { void refreshCheckoutEntitlements(); }}
                className="rounded-md border border-current/20 px-2 py-1 text-xs font-medium text-current opacity-80 transition hover:opacity-100"
              >
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={() => dispatchBillingReflection({ type: "DISMISS" })}
              className="rounded p-0.5 text-current opacity-70 transition hover:opacity-100"
              aria-label="Dismiss checkout status"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {upgradeCatalogOpen && (
          <UpgradePlanCatalogModal
            open={upgradeCatalogOpen}
            products={upgradeProducts}
            catalogPlans={catalogPlans}
            ownedCounts={upgradeOwnedCounts}
            loading={upgradeCatalogLoading}
            error={upgradeCatalogError}
            onClose={() => setUpgradeCatalogOpen(false)}
            onOpenPlans={() => router.push("/plans")}
            onSelectPlan={(product) => {
              setUpgradeCatalogOpen(false);
              setUpgradeCheckoutPlan(toUpgradeCheckoutPlan(product));
            }}
          />
        )}
      </AnimatePresence>

      {upgradeCheckoutPlan && (
        <PlanCheckoutModal
          plan={upgradeCheckoutPlan}
          ownedCount={upgradeCheckoutOwnedCount}
          isOpen={Boolean(upgradeCheckoutPlan)}
          onClose={() => setUpgradeCheckoutPlan(null)}
          onSuccess={() => { void refreshCheckoutEntitlements(); }}
          getToken={getToken}
        />
      )}

      <ChannelCreationWizard
        open={showChannelWizard}
        onClose={() => setShowChannelWizard(false)}
        availableAgents={agents.map((a) => ({ id: a.id, name: a.name || a.id, type: "agent" as const }))}
        availableUsers={MOCK_PARTICIPANTS.filter((p) => p.type === "user")}
        onCreate={async (channel) => {
          // TODO: raise an SDK/API requirement for channel creation. For now, log and close.
          console.log("Create channel:", channel);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingAgentDelete)}
        title="Delete Agent"
        message={
          pendingAgentDelete
            ? `Delete agent "${pendingAgentDelete.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={Boolean(pendingAgentDelete && deletingId === pendingAgentDelete.id)}
        onCancel={() => setPendingAgentDelete(null)}
        onConfirm={() => {
          if (pendingAgentDelete) void handleDelete(pendingAgentDelete.id);
        }}
      />
      <AgentTierSelectionModal
        tierSelection={tierSelection}
        setTierSelection={setTierSelection}
        handleResizeAndStart={handleResizeAndStart}
        titleizeTier={titleizeTier}
      />

      <AnimatePresence>
        {mobileAgentLauncherOpen && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="relative h-[min(720px,calc(100vh-1.5rem))] w-[min(1020px,calc(100vw-1.5rem))]"
            >
              <button
                type="button"
                aria-label="Close launch agent"
                onClick={() => setMobileAgentLauncherOpen(false)}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/35 text-text-muted backdrop-blur transition-colors hover:bg-black/55 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              <FirstAgentSetupWizard
                budget={budget}
                subscriptionSummary={subscriptionSummary}
                catalogPlans={catalogPlans}
                pendingSlotReleases={pendingSlotReleases}
                onOpenPlanCatalog={openUpgradeCatalog}
                onCreateAgent={createMobileAgentFromLauncher}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isDesktopViewport && mobileAgentsSidebarOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <button
              type="button"
              aria-label="Close agents sidebar"
              onClick={() => setMobileAgentsSidebarOpen(false)}
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
              className="relative z-10 h-full w-full bg-[#232323] shadow-2xl"
            >
              <AgentsChannelsSidebar
                variant="v3"
                showDivider={false}
                fillParent
                mobileMode
                threads={syntheticThreads}
                selectedThreadId={selectedAgentId}
                showChannels={false}
                availableAgents={agents.map((a) => ({
                  id: a.id,
                  name: a.name || a.id,
                  type: "agent" as const,
                  meta: a.meta ?? null,
                }))}
                agentCardDataById={agentCardDataById}
                onSelectThread={(threadId) => {
                  setSelectedAgentId(threadId);
                  setMobileShowChat(true);
                  setMobileAgentsSidebarOpen(false);
                }}
                onStartAgentChat={(agent) => {
                  setSelectedAgentId(agent.id);
                  setMobileShowChat(true);
                  setMobileAgentsSidebarOpen(false);
                }}
                onOpenAgentLauncher={openMobileAgentLauncher}
                onCreateAgent={createMobileAgentFromLauncher}
                accountInitial={accountInitial}
                onOpenAgentSettings={openAgentSettingsTab}
                agentSettingsActive={mainTab === "settings"}
                onLogout={logout}
                onDeleteThread={(threadId) => {
                  const agent = agents.find((item) => item.id === threadId);
                  if (agent) {
                    setPendingAgentDelete({ id: agent.id, name: agent.name || agent.id });
                    setMobileAgentsSidebarOpen(false);
                  }
                }}
                onCollapse={() => setMobileAgentsSidebarOpen(false)}
              />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isDesktopViewport && mobileWorkspaceSidebarOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <button
              type="button"
              aria-label="Close workspace sidebar"
              onClick={() => setMobileWorkspaceSidebarOpen(false)}
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
              className="relative z-10 h-full w-full bg-[#232323] shadow-2xl"
            >
              <AgentWorkspaceSidebar
                selectedAgent={selectedAgent}
                activeTab={openclawSettingsOpen && selectedAgent ? "openclaw" : mainTab}
                skillsActive={mainTab === "integrations" && directoryCategory === "skills"}
                planName={planName}
                subscriptionSummary={subscriptionSummary}
                catalogPlans={catalogPlans}
                tokenUsed={tokenUsage}
                tokenLimit={budget?.pooled_tpd ?? null}
                disabled={workspaceSidebarDisabled}
                disabledReason={workspaceSidebarDisabledReason}
                scheduledDisabled={!SCHEDULED_SECTION_ENABLED}
                scheduledDisabledReason={SCHEDULED_SECTION_DISABLED_REASON}
                isDesktopViewport={false}
                renderMobile
                forceExpanded
                fillParent
                onClose={() => setMobileWorkspaceSidebarOpen(false)}
                onSelectChat={openChatTab}
                onOpenFiles={openFilesTab}
                onOpenIntegrations={openIntegrationsTab}
                onOpenSkills={openSkillsTab}
                onOpenScheduled={openScheduledTab}
                onOpenLogs={openLogsTab}
                onOpenShell={openShellTab}
                onOpenOpenClaw={openOpenClawSettings}
                onOpenSettings={openAgentSettingsTab}
                onUpgrade={() => { void openUpgradeCatalog(); }}
              />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Main layout: AgentList + AgentMainPanel + AgentInspector */}
      <div className="flex flex-1 min-h-0">
        <AgentList
          sidebarCollapsed={sidebarCollapsed}
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileMainPanelVisible}
          agents={agents}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          setMobileShowChat={setMobileShowChat}
          setSidebarCollapsed={setSidebarCollapsed}
          syntheticThreads={syntheticThreads}
          agentCardDataById={agentCardDataById}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          fetchAgents={refreshAgentsForChildren}
          setError={setError}
          sidebarCreatorSignal={sidebarCreatorSignal}
          setPendingAgentDelete={setPendingAgentDelete}
          accountInitial={accountInitial}
          onOpenSettings={openAgentSettingsTab}
          settingsActive={mainTab === "settings"}
          onLogout={logout}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          pendingSlotReleases={pendingSlotReleases}
          onOpenPlanCatalog={openUpgradeCatalog}
          updateAgentName={async (agentId, name) => {
            const token = await getToken();
            const updatedAgent = await createAgentClient(token).update(agentId, { name });
            setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
          }}
        />

        <AgentWorkspaceSidebar
          selectedAgent={selectedAgent}
          activeTab={openclawSettingsOpen && selectedAgent ? "openclaw" : mainTab}
          skillsActive={mainTab === "integrations" && directoryCategory === "skills"}
          planName={planName}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          tokenUsed={tokenUsage}
          tokenLimit={budget?.pooled_tpd ?? null}
          disabled={workspaceSidebarDisabled}
          disabledReason={workspaceSidebarDisabledReason}
          scheduledDisabled={!SCHEDULED_SECTION_ENABLED}
          scheduledDisabledReason={SCHEDULED_SECTION_DISABLED_REASON}
          isDesktopViewport={isDesktopViewport}
          onSelectChat={openChatTab}
          onOpenFiles={openFilesTab}
          onOpenIntegrations={openIntegrationsTab}
          onOpenSkills={openSkillsTab}
          onOpenScheduled={openScheduledTab}
          onOpenLogs={openLogsTab}
          onOpenShell={openShellTab}
          onOpenOpenClaw={openOpenClawSettings}
          onOpenSettings={openAgentSettingsTab}
          onUpgrade={() => { void openUpgradeCatalog(); }}
        />

        <AgentMainPanel
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileMainPanelVisible}
          selectedAgent={selectedAgent}
          hasAgents={agents.length > 0}
          loadingInitialAgents={agentsLoading}
          isSelectedTransitioning={Boolean(isSelectedTransitioning)}
          isSelectedRunning={Boolean(isSelectedRunning)}
          burstAgentId={burstAgentId}
          onBurstComplete={() => setBurstAgentId(null)}
          agentStatus={agentStatus}
          activeConnectionStatus={activeConnectionStatus}
          chatConnected={chat.connected}
          chatConnecting={chat.connecting}
          startingId={startingId}
          recentlyStoppedIds={recentlyStoppedIds}
          selectedAgentLaunchBlocked={selectedAgentLaunchBlocked}
          selectedAgentStartGuidanceTitle={selectedAgentStartBlockedTitle}
          blockedMessage={selectedAgentStartBlockedMessage}
          suggestedTierActions={selectedAgentSuggestedTierActions}
          currentPanel={selectedCenterPanel}
          skillsPanelActive={directoryCategory === "skills"}
          stoppedTabLabel={stoppedTabLabel[selectedCenterPanel]}
          panelContent={mainTab === "chat" ? (
            <AgentChatPanel
              chat={chat}
              selectedAgent={selectedAgent!}
              isSelectedRunning={Boolean(isSelectedRunning)}
              chatDragActive={chatDragActive}
              setChatDragActive={setChatDragActive}
              chatDragDepthRef={chatDragDepthRef}
              handleChatFileDrop={handleChatFileDrop}
              chatScrollRef={chatScrollRef}
              handleChatScroll={handleChatScroll}
              chatEndRef={chatEndRef}
              recording={recording}
              audioLevel={audioLevel}
              recordingDuration={recordingDuration}
              stopRecording={stopRecording}
              audioUrl={audioUrl}
              audioPreviewPlaying={audioPreviewPlaying}
              audioPreviewDuration={audioPreviewDuration}
              toggleAudioPreviewPlayback={toggleAudioPreviewPlayback}
              discardAudio={discardAudio}
              sendAudio={sendAudio}
              sendingAudio={sendingAudio}
              startRecording={startRecording}
              handleSendChat={handleSendChat}
              formatDuration={formatDuration}
              onConnectionCta={openConnectionSuggestion}
            />
          ) : mainTab === "files" ? (
            <AgentFilesPanel
              key={selectedAgent?.id ?? "no-agent"}
              agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
              agentState={selectedAgent?.state ?? null}
              rootPath={OPENCLAW_WORKSPACE_PREFIX}
              connected={chat.connected}
              connecting={chat.connecting}
              hydrating={chat.hydrating}
              isDesktopViewport={isDesktopViewport}
              error={null}
              onListFiles={listAgentFiles}
              onOpenFile={readAgentFile}
              onOpenFileBytes={readAgentFileBytes}
              onDownloadFileBytes={readAgentFileBytes}
              onSaveFile={saveAgentFile}
              onDeleteFile={deleteAgentFile}
              onUploadFile={saveAgentFile}
            />
          ) : mainTab === "integrations" ? (
            <IntegrationsDirectoryPanel
              initialCategory={directoryCategory}
              initialPluginId={directoryItemId}
              detailBackLabel={directoryDetailOrigin === "chat" ? "Back to chat" : undefined}
              onDetailBack={directoryDetailOrigin === "chat" ? () => {
                setDirectoryDetailOrigin(null);
                setDirectoryItemId(undefined);
                setMainTab("chat");
                setMobileShowChat(true);
              } : undefined}
              agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
              config={chat.config as Record<string, unknown> | null}
              configSchema={chat.configSchema}
              connected={chat.connected}
              onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
              onChannelProbe={async () => chat.channelsStatus(true)}
              onOpenShell={() => setMainTab("shell")}
              onLoadSkills={loadAgentSkills}
              onListFiles={listAgentFiles}
              onReadFile={readAgentFile}
            />
          ) : mainTab === "settings" ? (
            <AgentSettingsPanel
              agent={selectedAgent}
              user={user}
              getToken={getToken}
              onStartAgent={() => {
                if (selectedAgent) void handleStart(selectedAgent.id);
              }}
              onStopAgent={() => {
                if (selectedAgent) void handleStop(selectedAgent.id);
              }}
              onDeleteAgent={() => {
                if (selectedAgent) {
                  setPendingAgentDelete({ id: selectedAgent.id, name: selectedAgent.name || selectedAgent.id });
                }
              }}
              onLogout={logout}
              agentStarting={selectedAgentStarting}
              agentStopping={Boolean(selectedAgent && stoppingId === selectedAgent.id)}
              agentDeleting={Boolean(selectedAgent && deletingId === selectedAgent.id)}
              agentStartBlocked={selectedAgentLaunchBlocked}
              agentStartBlockedReason={selectedAgentStartBlockedTitle}
              planName={planName}
              subscriptionSummary={subscriptionSummary}
              tokenUsage={tokenUsage}
              tokenLimit={budget?.pooled_tpd ?? null}
              openclawConfig={chat.config}
              openclawModels={chat.models}
              onSaveOpenClawConfig={async (patch) => { await chat.saveConfig(patch); }}
              isDesktopViewport={isDesktopViewport}
              showBackToChat={showMobileChatReturn}
              onBackToChat={openChatTab}
              agentsMenuOpen={mobileAgentsSidebarOpen}
              workspaceMenuOpen={mobileWorkspaceSidebarOpen}
              onOpenAgentsMenu={() => {
                setMobileWorkspaceSidebarOpen(false);
                setMobileAgentsSidebarOpen((open) => !open);
              }}
              onOpenWorkspaceMenu={() => {
                setMobileAgentsSidebarOpen(false);
                setMobileWorkspaceSidebarOpen((open) => !open);
              }}
            />
          ) : mainTab === "logs" ? (
            <AgentLogsPanel status={wsStatus} logs={logs} logBoxRef={logBoxRef} />
          ) : mainTab === "shell" ? (
            <AgentTerminalPanel status={shellStatus} shellBoxRef={shellBoxRef} />
          ) : null}
          onCreate={() => {
            setMobileShowChat(false);
            setSidebarCreatorSignal((v) => v + 1);
          }}
          onCreateAgent={handleCreateFirstAgent}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          pendingSlotReleases={pendingSlotReleases}
          onOpenPlanCatalog={openUpgradeCatalog}
          onShowList={() => setMobileShowChat(false)}
          showMobileListButton={false}
          onShowInspector={() => setInspectorSheetOpen(true)}
          showInspectorButton={SHOW_AGENT_INSPECTOR}
          onStart={() => {
            if (selectedAgent) {
              void handleStart(selectedAgent.id);
            }
          }}
          onReconnect={() => {
            if (mainTab === "logs") reconnectLogs();
            if (mainTab === "shell") reconnectShell();
          }}
        />

        {SHOW_AGENT_INSPECTOR && (
          <AgentInspector
            isDesktopViewport={isDesktopViewport}
            open={inspectorSheetOpen}
            setOpen={setInspectorSheetOpen}
            selectedAgent={selectedAgent}
            isSelectedRunning={Boolean(isSelectedRunning)}
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            viewProps={{
              ...agentViewVariants,
              showActiveSessions: true,
              showCronManager: true,
              showRecentToolCalls: true,
              tabBarStyle: "v1",
              agentConfig: agentConfigForView,
              agentConnections: agentConnectionsForView,
              agentSessions: agentSessionsForView,
              activityEntries: activityEntriesForView,
              recentToolCalls: recentToolCallsForView,
              agentCronJobs: agentCronJobsForView,
              agentWorkspaceFiles: agentWorkspaceFilesForView,
              onPromptClick: (prompt) => chat.setInput(prompt),
              onCronRemove: (jobId) => { void chat.removeCron(jobId); },
              onMarketplaceClick: () => { setDirectoryCategory(undefined); setDirectoryItemId(undefined); setDirectoryDetailOrigin(null); setMainTab("integrations"); },
              onAgentStart: () => { if (selectedAgent) void handleStart(selectedAgent.id); },
              onAgentStop: () => { if (selectedAgent) void handleStop(selectedAgent.id); },
              agentStarting: selectedAgentStarting,
              agentStopping: Boolean(selectedAgent && stoppingId === selectedAgent.id),
              agentStartBlocked: selectedAgentLaunchBlocked,
              agentStartBlockedReason: selectedAgentStartBlockedTitle,
              onOpenFiles: (path) => {
                if (!selectedAgent) return;
                const base = `/dashboard/agents/${selectedAgent.id}/files`;
                router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
              },
              conversationThreads: syntheticThreads,
              selectedConversationThreadId: selectedAgent?.id ?? null,
            }}
          />
        )}
      </div>

      <OpenClawSettingsDrawer
        open={openclawSettingsOpen && Boolean(selectedAgent)}
        onClose={() => setOpenclawSettingsOpen(false)}
        agent={selectedAgent}
        openclawSections={openclawSections}
        openclawSchemaBundle={openclawSchemaBundle}
        effectiveOpenclawSection={effectiveOpenclawSection}
        setActiveOpenclawSection={setActiveOpenclawSection}
        activeOpenclawSectionLabel={activeOpenclawSectionLabel}
        openclawSaving={openclawSaving}
        openclawDraft={openclawDraft}
        openclawError={openclawError}
        openclawSuccess={openclawSuccess}
        chat={chat}
        visibleOpenclawSections={visibleOpenclawSections}
        renderOpenclawField={renderOpenclawField}
        saveOpenclawSection={saveOpenclawSection}
        saveAllOpenclaw={saveAllOpenclaw}
        openclawPaneRef={openclawPaneRef}
        isDesktopViewport={isDesktopViewport}
      />

    </div>
  );
}
