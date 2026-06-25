"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Check,
  Loader2,
  MessageSquare,
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
import {
  AGENT_CLEANUP_START_MESSAGE,
  AGENT_STOP_CLEANUP_COOLDOWN_MS,
  createAgentClient,
  createHyperAgentClient,
  createOpenClawAgent,
  isAgentCleanupConflictError,
  startOpenClawAgent,
} from "@/lib/agent-client";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { formatCpu, formatMemory, formatTokens, type SlotInventoryEntry } from "@/lib/format";
import { useOpenClawSession, type OpenClawHydrationMode } from "@/hooks/useOpenClawSession";
import { useAgentLogs } from "@/hooks/useAgentLogs";
import { useAgentShell } from "@/hooks/useAgentShell";
import { useAgentShellActivation } from "@/hooks/useAgentShellActivation";
import { useAgentShellTerminal } from "@/hooks/useAgentShellTerminal";
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
import { FirstAgentSetupWizard, type FirstAgentSetupCreateParams } from "@/components/dashboard/agents/FirstAgentSetupWizard";
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
import type { Agent, AgentBudget, AgentState } from "./types";
import {
  describeAgentTierStartGuidance,
  describeAgentsPageError,
  getAgentSizePresets,
  inferAgentTier,
  parseAgentCapacityError,
  parseEntitlementSlotTier,
  titleizeTier,
  type AgentTierSelectionState,
} from "@/lib/agent-tier";
import {
  OPENCLAW_SYNC_ROOT,
  OPENCLAW_WORKSPACE_DIR,
  OPENCLAW_WORKSPACE_PREFIX,
  asObject,
  humanizeKey,
} from "@/lib/openclaw-config";
import { getOpenClawDefaultModel } from "@/lib/openclaw-models";
import { displayNameForDashboard } from "@/lib/dashboard-greeting";
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
  displayOpenClawSessionName,
  fallbackOpenClawSessionDisplayName,
  sameOpenClawSelectableSessionKey,
} from "@/lib/openclaw-session-sdk-surface";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import {
  type AgentStatusChipModel,
  type CenterPanel,
} from "@/components/dashboard/agents/page-helpers";
import { AgentSettingsPanel, AgentList, AgentTierSelectionModal, ErrorBanner } from "@/components/dashboard/agents/AgentPanels";
import { OpenClawSettingsDrawer } from "@/components/dashboard/agents/OpenClawSettingsDrawer";
import { AgentChatPanel, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatPanel";
import { AgentFilesPanel } from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLogsPanel } from "@/components/dashboard/agents/AgentLogsPanel";
import { AgentScheduledPanel } from "@/components/dashboard/agents/AgentScheduledPanel";
import { AgentTerminalPanel } from "@/components/dashboard/agents/AgentTerminalPanel";
import { AgentInspector } from "@/components/dashboard/agents/AgentInspector";
import { AgentMainPanel } from "@/components/dashboard/agents/AgentMainPanel";
import { AgentWorkspaceSidebar } from "@/components/dashboard/agents/AgentWorkspaceSidebar";
import { AgentGatewaySessionProvider, asAgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import { JourneyFloatingPanel } from "@/components/dashboard/journey/JourneyFloatingPanel";
import type { JourneyCapabilityCard } from "@/components/dashboard/journey/journey-capabilities";
import { buildJourneyBriefPrompt, buildJourneyCapabilityPrompt, buildJourneyPrompt } from "@/components/dashboard/journey/journey-prompt-builder";
import { useJourney } from "@/components/dashboard/journey/useJourney";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import { HyperCLILogoLink } from "@/components/HyperCLILogoLink";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { bundleKey, CLAW_PRODUCTS, compactBundle, formatBundle, type SlotBundle } from "@/lib/subscriptions";
import { createAudioMediaRecorder } from "@/lib/audio-recorder";
import { downloadFileBytes } from "@/lib/download-file";
import { uploadAgentStarterFiles } from "@/lib/agent-starter-files";
import { normalizeCronJob } from "@/lib/cron-jobs";
import {
  readAgentFileWithRecovery,
  type AgentFileReadRecoveryResult,
} from "@/lib/agent-file-recovery";
import type { ChatPendingFile } from "@/lib/openclaw-chat";
import type { JourneyCompletionEvent, JourneyDay } from "@/components/dashboard/journey/types";

type MainTab = AgentMainTab;
type AgentFileSource = "auto" | "pod" | "s3";
type PendingJourneyChatCompletion = {
  event: JourneyCompletionEvent | null;
  dayId?: string | null;
  receiptText?: string | null;
};
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
const TOKEN_USAGE_RECONCILE_DELAYS_MS = [2000, 5000] as const;
const TOKEN_USAGE_RUNNING_REFRESH_INTERVAL_MS = 60_000;
const AGENT_DIRECTORY_MARKER_NAME = ".hypercli-folder";

function pendingFileMatches(file: ChatPendingFile, mimePrefix: string, extensionPattern: RegExp): boolean {
  return file.type.toLowerCase().startsWith(mimePrefix) || extensionPattern.test(file.name) || extensionPattern.test(file.path);
}

function pendingFileIsImage(file: ChatPendingFile): boolean {
  return pendingFileMatches(file, "image/", /\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)$/i);
}

function pendingFileIsAudio(file: ChatPendingFile): boolean {
  return pendingFileMatches(file, "audio/", /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i);
}

function workspaceFileReferenceFromEntry(entry: FileEntry): ChatPendingFile | null {
  if (entry.type !== "file") return null;
  const normalizedPath = normalizeOpenClawWorkspaceFilePath(entry.path || entry.name);
  const relativePath = normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)
    ? normalizedPath.slice(OPENCLAW_WORKSPACE_PREFIX.length + 1)
    : normalizedPath;
  if (!relativePath) return null;
  return {
    name: entry.name || relativePath.split("/").filter(Boolean).pop() || relativePath,
    path: `${OPENCLAW_WORKSPACE_DIR}/${relativePath}`,
    type: "application/octet-stream",
  };
}

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

function dailyTokenUsageTotal(usage: { history?: Array<{ totalTokens?: unknown }> } | null | undefined): number | null {
  if (!Array.isArray(usage?.history)) return null;
  return usage.history.reduce((total, entry) => total + finiteNumber(entry.totalTokens), 0);
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
              <Sparkles className="h-4 w-4 text-[var(--selection-accent)]" />
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
                      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--selection-accent)] px-2.5 py-1 text-[12px] font-medium leading-none text-[var(--selection-accent-foreground)] shadow-[0_8px_22px_rgb(var(--selection-accent-rgb)_/_0.22)]">
                        Most Popular
                      </span>
                    )}

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#303035] bg-[#242427] text-[#f5f5f5]">
                        <ProductIcon className="h-4 w-4" />
                      </span>
                      <h3 className="truncate text-[18px] font-semibold leading-none text-[#f5f5f5]">{product.name}</h3>
                      {ownedCount > 0 && (
                        <span className="ml-auto shrink-0 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2 py-0.5 text-[11px] font-medium text-[var(--selection-accent)]">
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
                          ? "bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)]"
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
  return normalizeOpenClawWorkspaceFilePath(path);
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

function isAgentDirectoryMarkerEntry(entry: AgentFileEntry): boolean {
  const name = entry.name || entry.path.split("/").filter(Boolean).pop() || "";
  return name === AGENT_DIRECTORY_MARKER_NAME;
}

function agentFileSourceForState(agentState: AgentState | string | null | undefined, requested: AgentFileSource): AgentFileSource {
  if (requested !== "auto") return requested;
  return agentState === "RUNNING" ? "auto" : "s3";
}

function agentFileDestinationForState(agentState: AgentState | string | null | undefined): AgentFileSource {
  return agentState === "RUNNING" ? "auto" : "s3";
}

async function readAgentFileWithSourceFallback<T>(
  source: AgentFileSource,
  read: (source: AgentFileSource) => Promise<T>,
): Promise<T> {
  try {
    return await read(source);
  } catch (err) {
    if (source !== "auto") throw err;
    for (const fallbackSource of ["s3", "pod"] as const) {
      try {
        return await read(fallbackSource);
      } catch {}
    }
    throw err;
  }
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
  const dashboardDisplayName = displayNameForDashboard(user);
  const suggestedJourneyUserName = dashboardDisplayName === "there" ? null : dashboardDisplayName;
  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const journey = useJourney({ searchParams, searchKey: queryKey, storageScope: user?.email ?? null });
  const journeyChatCompletionRef = useRef<PendingJourneyChatCompletion | null>(null);
  const completeJourneyForEvent = journey.completeForEvent;
  const completeJourneyDay = journey.completeDay;
  const recordJourneyReceipt = journey.recordReceipt;
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
  const tokenUsageRefreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tokenUsageRefreshInFlightRef = useRef(false);
  const checkoutReturnHandledRef = useRef(false);
  const appliedAgentQueryRef = useRef<string | null>(null);
  const appliedOpenQueryRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      stoppedTimersRef.current.forEach((t) => clearTimeout(t));
      slotReleaseTimersRef.current.forEach((t) => clearTimeout(t));
      tokenUsageRefreshTimersRef.current.forEach((t) => clearTimeout(t));
      tokenUsageRefreshTimersRef.current = [];
    };
  }, []);

  const markAgentCleanupCooldown = useCallback((agentId: string) => {
    setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
    const existing = stoppedTimersRef.current.get(agentId);
    if (existing) clearTimeout(existing);
    stoppedTimersRef.current.set(agentId, setTimeout(() => {
      setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
      stoppedTimersRef.current.delete(agentId);
    }, AGENT_STOP_CLEANUP_COOLDOWN_MS));
  }, []);

  const [tierSelection, setTierSelection] = useState<AgentTierSelectionState | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSessionKeysByAgent, setSelectedSessionKeysByAgent] = useState<Record<string, string>>({});
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [scheduledInitialCommand, setScheduledInitialCommand] = useState<{ id: number; command: string } | null>(null);
  const scheduledInitialCommandIdRef = useRef(0);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileAgentsSidebarOpen, setMobileAgentsSidebarOpen] = useState(false);
  const [mobileWorkspaceSidebarOpen, setMobileWorkspaceSidebarOpen] = useState(false);
  const [mobileAgentLauncherOpen, setMobileAgentLauncherOpen] = useState(false);
  const [sidebarCreatorSignal, setSidebarCreatorSignal] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  // Logs
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Shell
  const shellOutputHandlerRef = useRef<(text: string) => void>(() => undefined);

  // Files panel
  const [filesPreviewPath, setFilesPreviewPath] = useState<string | null>(null);
  const [chatFileReferenceCandidates, setChatFileReferenceCandidates] = useState<ChatPendingFile[]>([]);

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
  const [openclawSettingsOpen, setOpenclawSettingsOpen] = useState(false);
  const [chatDragActive, setChatDragActive] = useState(false);
  const chatDragDepthRef = useRef(0);

  const openConnectionSuggestion = useCallback((suggestion: ChatConnectionSuggestion) => {
    if (suggestion.directoryPluginId) {
      const category = getCategoryForPlugin(suggestion.directoryPluginId) ?? undefined;
      setDirectoryCategory(category);
      setDirectoryItemId(suggestion.directoryPluginId);
      setDirectoryDetailOrigin("chat");
      setOpenclawSettingsOpen(false);
      setMainTab("integrations");
      setMobileShowChat(true);
      completeJourneyForEvent("integrations-opened");
      return;
    }

    if (!SHOW_AGENT_INSPECTOR) return;
    setInspectorTab("connections");
    setInspectorSheetOpen(true);
  }, [completeJourneyForEvent]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const clearScheduledTokenUsageRefreshes = useCallback(() => {
    tokenUsageRefreshTimersRef.current.forEach((timer) => clearTimeout(timer));
    tokenUsageRefreshTimersRef.current = [];
  }, []);

  const refreshTokenUsage = useCallback(async () => {
    if (tokenUsageRefreshInFlightRef.current) return;
    tokenUsageRefreshInFlightRef.current = true;
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const dailyUsage = await hyperAgent.usageHistory(1);
      setTokenUsage(dailyTokenUsageTotal(dailyUsage));
    } catch {
      // Keep the last displayed value on transient usage refresh failures.
    } finally {
      tokenUsageRefreshInFlightRef.current = false;
    }
  }, [getToken]);

  const refreshTokenUsageAfterChat = useCallback(() => {
    clearScheduledTokenUsageRefreshes();
    void refreshTokenUsage();
    tokenUsageRefreshTimersRef.current = TOKEN_USAGE_RECONCILE_DELAYS_MS.map((delay) => (
      setTimeout(() => {
        void refreshTokenUsage();
      }, delay)
    ));
  }, [clearScheduledTokenUsageRefreshes, refreshTokenUsage]);

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
      const listedAgentIds = new Set(listedAgents.map((agent) => agent.id));
      setSdkAgents(listedAgents);
      setSelectedSessionKeysByAgent((current) => {
        let changed = false;
        const next: Record<string, string> = {};
        for (const [agentId, sessionKey] of Object.entries(current)) {
          if (listedAgentIds.has(agentId)) {
            next[agentId] = sessionKey;
          } else {
            changed = true;
          }
        }
        return changed ? next : current;
      });
      setBudget(nextBudget);
      setCatalogPlans(plans);
      setPlanName(getEffectivePlanName(summary, normalizedCurrentPlan, plans));
      setSubscriptionSummary(summary);
      setTokenUsage(dailyTokenUsageTotal(dailyUsage));
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

  const getAgentClient = useCallback(async () => {
    if (deployments) return deployments;
    return createAgentClient(await getToken());
  }, [deployments, getToken]);

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

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void refreshTokenUsage();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshTokenUsage]);

  useEffect(() => {
    if (!isSelectedRunning || typeof window === "undefined") return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshTokenUsage();
    }, TOKEN_USAGE_RUNNING_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isSelectedRunning, refreshTokenUsage]);

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
    shellOutputHandlerRef.current(text);
  }, []);

  const {
    logs,
    status: wsStatus,
    reconnect: reconnectLogs,
  } = useAgentLogs(deployments, selectedAgentId, mainTab === "logs" && selectedAgentState === "RUNNING");

  const shellEnabled = useAgentShellActivation({
    agentId: selectedAgentId,
    agentState: selectedAgentState,
    activeTab: mainTab,
  });

  const {
    status: shellStatus,
    send: sendShell,
    resize: resizeShell,
    reconnect: reconnectShell,
  } = useAgentShell(deployments, {
    agentId: selectedAgentId,
    enabled: shellEnabled,
    onData: handleShellData,
  });

  const {
    shellBoxRef,
    writeOutput: writeShellOutput,
    clearOutput: clearShellOutput,
  } = useAgentShellTerminal({
    agentId: selectedAgentId,
    status: shellStatus,
    visible: mainTab === "shell" && Boolean(isSelectedRunning),
    onInput: sendShell,
    onResize: resizeShell,
  });

  useEffect(() => {
    shellOutputHandlerRef.current = writeShellOutput;
  }, [writeShellOutput]);

  useEffect(() => {
    if (mainTab !== "shell" || (shellStatus !== "connecting" && shellStatus !== "reconnecting")) return;
    clearShellOutput();
  }, [clearShellOutput, mainTab, shellStatus]);

  const selectedSessionKey = selectedAgentId
    ? selectedSessionKeysByAgent[selectedAgentId] ?? resolveOpenClawSessionKey(selectedAgentId)
    : resolveOpenClawSessionKey(null);
  const gatewayEnabled = isSelectedRunning;
  const openClawHydrationMode: OpenClawHydrationMode = (
    mainTab === "chat" ||
    mainTab === "workspace" ||
    mainTab === "integrations" ||
    mainTab === "scheduled" ||
    mainTab === "settings" ||
    mainTab === "openclaw" ||
    openclawSettingsOpen
  ) ? "full" : "sessions";

  const chat = useOpenClawSession(
    selectedAgent && isSelectedRunning ? selectedOpenClawAgent : null,
    gatewayEnabled,
    selectedSessionKey,
    { hydrationMode: openClawHydrationMode },
  );
  const gatewayChat = asAgentGatewaySession(chat);
  const activeConnectionStatus = useMemo(() => {
    if (mainTab === "files") {
      return selectedAgentId ? "connected" as const : null;
    }
    if (!isSelectedRunning) return null;
    if (mainTab === "logs") return wsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "integrations" || mainTab === "scheduled" || mainTab === "settings") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, mainTab, selectedAgentId, shellStatus, wsStatus]);

  const listAgentFiles = useCallback(async (path?: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return [];
    const agentClient = await getAgentClient();
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const preferredSource = agentFileSourceForState(selectedAgentState, source);
    const entries = await agentClient.filesList(selectedAgentId, normalizedPath, preferredSource);
    if (preferredSource === "auto" && entries.length === 0) {
      for (const fallbackSource of ["s3", "pod"] as const) {
        try {
          const fallbackEntries = await agentClient.filesList(selectedAgentId, normalizedPath, fallbackSource);
          if (fallbackEntries.length > 0) return (fallbackEntries as AgentFileEntry[])
            .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
            .map(toDashboardFileEntry);
        } catch {}
      }
    }
    return (entries as AgentFileEntry[])
      .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
      .map(toDashboardFileEntry);
  }, [getAgentClient, selectedAgentId, selectedAgentState]);

  const refreshChatFileReferences = useCallback(async () => {
    if (mainTab !== "chat") return;
    if (!selectedAgentId || !chat.connected) {
      setChatFileReferenceCandidates([]);
      return;
    }
    const entries = await listAgentFiles(OPENCLAW_WORKSPACE_PREFIX);
    setChatFileReferenceCandidates(entries.map(workspaceFileReferenceFromEntry).filter((file): file is ChatPendingFile => Boolean(file)));
  }, [chat.connected, listAgentFiles, mainTab, selectedAgentId]);

  useEffect(() => {
    let cancelled = false;
    if (mainTab !== "chat") return;
    if (!selectedAgentId || !chat.connected) {
      queueMicrotask(() => {
        if (!cancelled) setChatFileReferenceCandidates([]);
      });
      return;
    }
    void listAgentFiles(OPENCLAW_WORKSPACE_PREFIX)
      .then((entries) => {
        if (cancelled) return;
        setChatFileReferenceCandidates(entries.map(workspaceFileReferenceFromEntry).filter((file): file is ChatPendingFile => Boolean(file)));
      })
      .catch(() => {
        if (!cancelled) setChatFileReferenceCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chat.connected, listAgentFiles, mainTab, selectedAgentId]);

  const renameAgentFileToSafeName = useCallback(async (
    agentClient: Deployments,
    fromPath: string,
    safeCandidatePath: string,
  ) => {
    const agentId = selectedAgentId;
    if (!agentId) throw new Error("No agent selected");

    const normalizedFromPath = normalizeAgentFilePath(fromPath);
    const normalizedSafePath = normalizeAgentFilePath(safeCandidatePath);
    if (
      !normalizedFromPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`) ||
      !normalizedSafePath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)
    ) {
      throw new Error("Only workspace files can be renamed safely.");
    }

    const content = await agentClient.fileReadBytes(agentId, normalizedFromPath, "s3");
    await agentClient.fileWriteBytes(agentId, normalizedSafePath, content, "s3");
    try {
      await agentClient.fileDelete(agentId, normalizedFromPath);
    } catch {}
    return normalizedSafePath;
  }, [selectedAgentId]);

  const readAgentFileResult = useCallback(async (
    path: string,
    source: AgentFileSource = "auto",
  ): Promise<AgentFileReadRecoveryResult<string>> => {
    const agentId = selectedAgentId;
    const normalizedPath = normalizeAgentFilePath(path);
    if (!agentId) return { content: "", path: normalizedPath, renamed: false };

    const agentClient = await getAgentClient();
    const readSource = agentFileSourceForState(selectedAgentState, source);
    return readAgentFileWithRecovery({
      path: normalizedPath,
      read: (targetPath) => readAgentFileWithSourceFallback(readSource, (fallbackSource) => (
        agentClient.fileRead(agentId, targetPath, fallbackSource)
      )),
      rename: (fromPath, safeCandidatePath) => renameAgentFileToSafeName(agentClient, fromPath, safeCandidatePath),
    });
  }, [getAgentClient, renameAgentFileToSafeName, selectedAgentId, selectedAgentState]);

  const readAgentFile = useCallback(async (path: string, source: AgentFileSource = "auto") => {
    const result = await readAgentFileResult(path, source);
    return result.content;
  }, [readAgentFileResult]);

  const readAgentFileBytesResult = useCallback(async (
    path: string,
    source: AgentFileSource = "auto",
  ): Promise<AgentFileReadRecoveryResult<Uint8Array>> => {
    const agentId = selectedAgentId;
    const normalizedPath = normalizeAgentFilePath(path);
    if (!agentId) return { content: new Uint8Array(), path: normalizedPath, renamed: false };

    const agentClient = await getAgentClient();
    const readSource = agentFileSourceForState(selectedAgentState, source);
    return readAgentFileWithRecovery({
      path: normalizedPath,
      read: (targetPath) => readAgentFileWithSourceFallback(readSource, (fallbackSource) => (
        agentClient.fileReadBytes(agentId, targetPath, fallbackSource)
      )),
      rename: (fromPath, safeCandidatePath) => renameAgentFileToSafeName(agentClient, fromPath, safeCandidatePath),
    });
  }, [getAgentClient, renameAgentFileToSafeName, selectedAgentId, selectedAgentState]);

  const readAgentFileBytes = useCallback(async (path: string, source: AgentFileSource = "auto") => {
    const result = await readAgentFileBytesResult(path, source);
    return result.content;
  }, [readAgentFileBytesResult]);

  const loadAgentSkills = useCallback(async () => {
    if (!selectedAgentId) return [];
    const agentClient = await getAgentClient();
    const result = await agentClient.exec(selectedAgentId, buildSkillsSnapshotCommand(), { timeout: 15_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to read /app/skills from the agent.");
    }
    return parseSkillSnapshotOutput(result.stdout);
  }, [getAgentClient, selectedAgentId]);

  const saveAgentFile = useCallback(async (path: string, content: string) => {
    if (!selectedAgentId) return;
    const agentClient = await getAgentClient();
    await agentClient.fileWrite(
      selectedAgentId,
      normalizeAgentFilePath(path),
      content,
      agentFileDestinationForState(selectedAgentState),
    );
    await refreshChatFileReferences().catch(() => undefined);
  }, [getAgentClient, refreshChatFileReferences, selectedAgentId, selectedAgentState]);

  const uploadAgentFile = useCallback(async (path: string, content: Uint8Array) => {
    if (!selectedAgentId) return;
    const agentClient = await getAgentClient();
    await agentClient.fileWriteBytes(
      selectedAgentId,
      normalizeAgentFilePath(path),
      content,
      agentFileDestinationForState(selectedAgentState),
    );
    await refreshChatFileReferences().catch(() => undefined);
  }, [getAgentClient, refreshChatFileReferences, selectedAgentId, selectedAgentState]);

  const createAgentDirectory = useCallback(async (path: string) => {
    if (!selectedAgentId) return;
    const normalizedPath = normalizeAgentFilePath(path);
    if (normalizedPath === OPENCLAW_WORKSPACE_PREFIX || !normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)) {
      throw new Error("Folders can only be created inside the workspace.");
    }

    const agentClient = await getAgentClient();
    await agentClient.fileWriteBytes(
      selectedAgentId,
      `${normalizedPath}/${AGENT_DIRECTORY_MARKER_NAME}`,
      new Uint8Array(),
      "s3",
    );
  }, [getAgentClient, selectedAgentId]);

  const deleteAgentFile = useCallback(async (path: string, options?: { recursive?: boolean }) => {
    if (!selectedAgentId) return;
    const agentClient = await getAgentClient();
    await agentClient.fileDelete(selectedAgentId, normalizeAgentFilePath(path), options);
    await refreshChatFileReferences().catch(() => undefined);
  }, [getAgentClient, refreshChatFileReferences, selectedAgentId]);

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
    if (activeConnectionStatus === "connecting" || activeConnectionStatus === "reconnecting") {
      return {
        label: activeConnectionStatus === "reconnecting" ? "Reconnecting" : "Connecting",
        detail: activeConnectionStatus === "reconnecting"
          ? panelLabel === "logs" ? "Restoring the runtime log stream." : panelLabel === "workspace" ? "Reopening the gateway connection." : `Reopening ${panelLabel} stream.`
          : panelLabel === "logs" ? "Opening the runtime log stream." : panelLabel === "workspace" ? "Opening the gateway connection." : `Opening ${panelLabel} stream.`,
        tone: "connecting",
        loading: true,
      };
    }
    if (activeConnectionStatus === "disconnected") {
      return {
        label: "Disconnected",
        detail: panelLabel === "logs" ? "Logs will reconnect when the runtime is reachable." : panelLabel === "workspace" ? "Gateway disconnected." : `${panelLabel[0].toUpperCase()}${panelLabel.slice(1)} will reconnect when the gateway is reachable.`,
        tone: "disconnected",
      };
    }
    return {
      label: "Ready",
      detail: panelLabel === "logs" ? "Runtime log stream connected." : panelLabel === "workspace" ? "Chat is available." : `${panelLabel[0].toUpperCase()}${panelLabel.slice(1)} stream connected.`,
      tone: "ready",
    };
  }, [activeConnectionStatus, isSelectedRunning, mainTab, selectedAgent]);

  // ── Agent inspector data wiring ──

  // Probe channel status when gateway connects, and refresh after config save
  useEffect(() => {
    if (!SHOW_AGENT_INSPECTOR) return;
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
    return chat.cronJobs.map(normalizeCronJob);
  }, [chat.cronJobs]);

  // Derive AgentSession[] from chat.sessions
  const agentSessionsForView = useMemo(() => {
    if (!chat.sessions || chat.sessions.length === 0) return null;
    return chat.sessions.map((session) => {
      const sourceChannelId = typeof session.sourceChannelId === "string" ? session.sourceChannelId : undefined;
      return {
        key: session.key,
        clientMode: session.clientMode,
        clientDisplayName: displayOpenClawSessionName(session),
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        ...(sourceChannelId ? { sourceChannelId } : {}),
      };
    });
  }, [chat.sessions]);

  const scheduledSessionOptions = useMemo(() => {
    const options: Array<{ key: string; label: string }> = [];
    const addSession = (key: string, label: string) => {
      const normalizedKey = key.trim();
      if (!normalizedKey || options.some((option) => sameOpenClawSelectableSessionKey(option.key, normalizedKey))) return;
      options.push({ key: normalizedKey, label: label.trim() || (normalizedKey === "main" ? "Main Session" : "Current Session") });
    };

    for (const session of chat.sessions ?? []) {
      addSession(session.key, displayOpenClawSessionName(session));
    }
    addSession(selectedSessionKey, selectedSessionKey === "main" ? "Main Session" : "Current Session");
    return options;
  }, [chat.sessions, selectedSessionKey]);

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
      refreshTokenUsageAfterChat();
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
    prevSendingRef.current = chat.sending;
  }, [chat.sending, refreshTokenUsageAfterChat]);

  // Scroll to bottom when user switches back to chat tab.
  // useLayoutEffect runs synchronously after DOM commit (refs are set)
  // but before browser paint, so the user never sees the un-scrolled state.
  useLayoutEffect(() => {
    if (mainTab === "chat" && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [mainTab]);

  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);

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
      if (isAgentCleanupConflictError(err)) {
        markAgentCleanupCooldown(agentId);
        setError(AGENT_CLEANUP_START_MESSAGE);
        return;
      }
      if (parseAgentCapacityError(err)) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
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

  const handleCreateFirstAgent = useCallback(async ({ name, iconIndex, size, files }: FirstAgentSetupCreateParams) => {
    try {
      setError(null);
      const token = await getToken();
      const created = await createOpenClawAgent(token, {
        name: name || undefined,
        start: true,
        size,
        meta: { ui: { avatar: { icon_index: iconIndex } } },
      });
      if (created.id) {
        if (files.length > 0) {
          try {
            const agentClient = createAgentClient(token);
            await uploadAgentStarterFiles({
              agentId: created.id,
              files,
              writeFileBytes: (agentId, path, content, destination) => (
                agentClient.fileWriteBytes(agentId, path, content, destination)
              ),
            });
          } catch (uploadError) {
            setError(uploadError instanceof Error
              ? `Agent created, but starter files could not be uploaded: ${uploadError.message}`
              : "Agent created, but starter files could not be uploaded.");
          }
        }
        await fetchAgents();
        setSelectedAgentId(created.id);
        setOpenclawSettingsOpen(false);
        setMainTab("chat");
        setMobileShowChat(true);
        completeJourneyForEvent("agent-created");
        return created.id;
      }
      await fetchAgents();
      setError("Agent was created, but no agent id was returned.");
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create agent";
      if (!parseAgentCapacityError(err)) {
        setError(message);
      }
      throw err;
    }
  }, [completeJourneyForEvent, fetchAgents, getToken]);

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
      if (isAgentCleanupConflictError(err)) {
        markAgentCleanupCooldown(agentId);
        setError(AGENT_CLEANUP_START_MESSAGE);
      } else {
        setError(err instanceof Error ? err.message : "Failed to resize and start agent");
      }
    } finally {
      setStartingId(null);
    }
  }, [getToken, markAgentCleanupCooldown]);

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
  const workspaceSidebarDisabled = agentsLoading;
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
      markAgentCleanupCooldown(agentId);
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
      setSelectedSessionKeysByAgent((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, agentId)) return current;
        const next = { ...current };
        delete next[agentId];
        return next;
      });
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
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio recording is not available in this browser.");
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (typeof AudioContext !== "undefined") {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel(Math.min(avg / 128, 1));
            levelAnimRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
        } catch {
          if (audioCtx) void audioCtx.close();
          audioCtx = null;
          audioContextRef.current = null;
          analyserRef.current = null;
        }
      }

      const mediaRecorder = createAudioMediaRecorder(stream);
      audioChunksRef.current = [];
      setRecordingDuration(0);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (levelAnimRef.current) {
          cancelAnimationFrame(levelAnimRef.current);
          levelAnimRef.current = 0;
        }
        if (audioCtx) void audioCtx.close();
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || audioChunksRef.current[0]?.type || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (levelAnimRef.current) {
        cancelAnimationFrame(levelAnimRef.current);
        levelAnimRef.current = 0;
      }
      if (audioCtx) void audioCtx.close();
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      audioContextRef.current = null;
      analyserRef.current = null;
      setAudioLevel(0);
      setRecording(false);
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
      const voiceFile = { name: filename, path: agentPath, type: audioBlob.type || "audio/webm" };
      await createAgentClient(token).fileWriteBytes(selectedAgent.id, uploadPath, await audioBlob.arrayBuffer());
      await chat.sendMessage(voiceMessage, { displayContent: "", files: [voiceFile] });
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
      await refreshChatFileReferences().catch(() => undefined);
    } catch (e) {
      console.error("Chat file upload failed:", e);
      setError(e instanceof Error ? e.message : "File upload failed");
    }
  }, [chat, getToken, refreshChatFileReferences, selectedAgent]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleSendChat = () => {
    if (chat.activeSessionReadOnly) return;
    const draftInput = chat.input;
    const hasChatWork = draftInput.trim().length > 0 || chat.pendingFiles.length > 0 || chat.pendingAttachments.length > 0;
    const pendingJourneyCompletion = journeyChatCompletionRef.current;
    const completePendingJourney = () => {
      if (pendingJourneyCompletion?.dayId) {
        completeJourneyDay(pendingJourneyCompletion.dayId, pendingJourneyCompletion.receiptText ?? undefined);
      } else {
        completeJourneyForEvent(pendingJourneyCompletion?.event ?? "chat-sent");
      }
      journeyChatCompletionRef.current = null;
    };
    if (chat.activeSessionSending) {
      chat.setInput("");
      chat.addPendingMessage(draftInput);
      if (hasChatWork) {
        completePendingJourney();
      }
      return;
    }
    chat.sendMessage();
    if (hasChatWork) {
      completePendingJourney();
    }
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
  const journeyCapabilityContext = useMemo(() => {
    const hasImageAttachment =
      chat.pendingAttachments.some((attachment) => attachment.mimeType?.toLowerCase().startsWith("image/")) ||
      chat.pendingFiles.some(pendingFileIsImage);
    const hasAudioAttachment =
      Boolean(audioUrl) ||
      chat.pendingAttachments.some((attachment) => attachment.mimeType?.toLowerCase().startsWith("audio/")) ||
      chat.pendingFiles.some(pendingFileIsAudio);

    return {
      input: chat.input,
      hasImageAttachment,
      hasAudioAttachment,
      hasFileAttachment: chat.pendingAttachments.length > 0 || chat.pendingFiles.length > 0,
    };
  }, [audioUrl, chat.input, chat.pendingAttachments, chat.pendingFiles]);
  const journeyMissionDay = journey.currentDay;
  const selectedJourneyAgentName = selectedAgent?.name || selectedAgent?.pod_name || "your agent";
  const journeyIntroVisibleInChat = Boolean(
    journey.enabled &&
    mainTab === "chat" &&
    chat.messages.length === 0 &&
    journeyMissionDay?.id === "brief",
  );
  const journeyMissionCardVisibleInChat = Boolean(
    journey.enabled &&
    mainTab === "chat" &&
    journeyMissionDay &&
    !journey.completedIds.has(journeyMissionDay.id) &&
    (journeyMissionDay.id !== "brief" || chat.messages.length > 0),
  );
  const journeyChatSurfaceVisible = journeyIntroVisibleInChat || journeyMissionCardVisibleInChat;

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
          setFilesPreviewPath(null);
          setOpenclawSettingsOpen(false);
          setMainTab("files");
          setMobileShowChat(true);
          return;
        }
        if (tab === "workspace") {
          setDirectoryDetailOrigin(null);
          setOpenclawSettingsOpen(false);
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
          setOpenclawSettingsOpen(false);
          setMainTab("integrations");
          setMobileShowChat(true);
          return;
        }
        if (tab === "settings") {
          setOpenclawSettingsOpen(false);
          setMainTab("settings");
          setMobileShowChat(true);
          return;
        }
        if (tab === "scheduled" && !SCHEDULED_SECTION_ENABLED) {
          setOpenclawSettingsOpen(false);
          setMainTab("chat");
          setMobileShowChat(true);
          return;
        }
        setOpenclawSettingsOpen(false);
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
    setOpenclawSettingsOpen(false);
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
  const selectSession = (sessionKey: string) => {
    if (!selectedAgentId) return;
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [selectedAgentId]: sessionKey }));
    openChatTab();
  };
  const renameSession = async (sessionKey: string, title: string) => {
    await chat.renameSession(sessionKey, title);
  };
  const deleteSession = async (sessionKey: string) => {
    await chat.deleteSession(sessionKey);
    if (!selectedAgentId || !sameOpenClawSelectableSessionKey(sessionKey, selectedSessionKey)) return;
    const fallbackSessionKey = chat.sessions.find((session) => !sameOpenClawSelectableSessionKey(session.key, sessionKey))?.key ?? resolveOpenClawSessionKey(selectedAgentId);
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [selectedAgentId]: fallbackSessionKey }));
  };
  const createSession = async () => {
    if (!selectedAgentId) return;
    const sessionKey = await chat.createSession();
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [selectedAgentId]: sessionKey }));
    openChatTab();
  };
  const openFilesTab = (path?: string) => {
    const previewPath = typeof path === "string" ? path.trim() : "";
    setFilesPreviewPath(previewPath || null);
    setOpenclawSettingsOpen(false);
    setMainTab("files");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const downloadAgentFileFromChat = useCallback(async (file: ChatPendingFile) => {
    const result = await readAgentFileBytesResult(file.path);
    const name = result.renamed
      ? result.path.split("/").filter(Boolean).pop() || file.name || "download"
      : file.name || file.path.split("/").filter(Boolean).pop() || "download";
    downloadFileBytes(name, result.content, file.type || "application/octet-stream");
  }, [readAgentFileBytesResult]);
  const openIntegrationsTab = () => {
    setDirectoryCategory(undefined);
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    setMainTab("integrations");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
    completeJourneyForEvent("integrations-opened");
  };
  const openJourneyCapability = (capability: JourneyCapabilityCard, day?: JourneyDay | null) => {
    const category = getCategoryForPlugin(capability.pluginId) ?? undefined;
    setDirectoryCategory(category);
    setDirectoryItemId(capability.pluginId);
    setDirectoryDetailOrigin("chat");
    setOpenclawSettingsOpen(false);
    setMainTab("integrations");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
    if (day?.id === "connections") {
      completeJourneyDay(day.id, capability.receipt);
    } else if (day?.id) {
      recordJourneyReceipt(day.id, capability.receipt);
    }
  };
  const openSkillsTab = () => {
    setDirectoryCategory("skills");
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    setMainTab("integrations");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openScheduledTab = (draftCommand?: unknown) => {
    if (!SCHEDULED_SECTION_ENABLED) return;
    const command = typeof draftCommand === "string" ? draftCommand.trim() : "";
    if (command) {
      scheduledInitialCommandIdRef.current += 1;
      setScheduledInitialCommand({ id: scheduledInitialCommandIdRef.current, command });
    } else {
      setScheduledInitialCommand(null);
    }
    setOpenclawSettingsOpen(false);
    setMainTab("scheduled");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
    if (chat.connected) void chat.refreshCron().catch(() => undefined);
  };
  const openLogsTab = () => {
    setOpenclawSettingsOpen(false);
    setMainTab("logs");
    setMobileShowChat(true);
    setMobileWorkspaceSidebarOpen(false);
  };
  const openShellTab = () => {
    setOpenclawSettingsOpen(false);
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
  const setJourneyPrompt = (
    prompt: string,
    completionEvent: JourneyCompletionEvent | null = null,
    completionDayId: string | null = null,
    receiptText: string | null = null,
  ) => {
    journeyChatCompletionRef.current = completionEvent || completionDayId
      ? { event: completionEvent, dayId: completionDayId, receiptText }
      : null;
    if (prompt) chat.setInput(prompt);
    openChatTab();
  };
  const setJourneyPromptResult = (result: ReturnType<typeof buildJourneyPrompt>) => {
    setJourneyPrompt(result.prompt, result.completionEvent, result.completionDayId, result.receiptText);
  };
  const runJourneyCapabilityPrompt = (capability: JourneyCapabilityCard, day: JourneyDay) => {
    setJourneyPromptResult(buildJourneyCapabilityPrompt({
      dayId: day.id,
      agentName: selectedJourneyAgentName,
      preferredName: suggestedJourneyUserName,
      selectedCapabilityId: capability.id,
      capabilityContext: journeyCapabilityContext,
    }));
  };
  const openMobileAgentLauncher = () => {
    setMobileAgentsSidebarOpen(false);
    setMobileAgentLauncherOpen(true);
  };
  const createMobileAgentFromLauncher = async (params: FirstAgentSetupCreateParams) => {
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
  const runJourneyDayAction = (day: JourneyDay) => {
    if (day.actionKind === "create-agent") {
      if (selectedAgent) {
        setJourneyPromptResult(buildJourneyBriefPrompt({
          agentName: selectedJourneyAgentName,
          preferredName: suggestedJourneyUserName,
        }));
        return;
      }

      setMobileShowChat(false);
      if (isDesktopViewport) {
        setSidebarCreatorSignal((value) => value + 1);
      } else {
        openMobileAgentLauncher();
      }
      return;
    }

    if (day.actionKind === "open-files") {
      openFilesTab();
      return;
    }

    if (day.actionKind === "open-settings") {
      openAgentSettingsTab();
      return;
    }

    if (day.actionKind === "open-integrations") {
      openIntegrationsTab();
      return;
    }

    if (day.actionKind === "set-chat-prompt") {
      setJourneyPromptResult(buildJourneyPrompt({
        dayId: day.id,
        agentName: selectedJourneyAgentName,
        preferredName: suggestedJourneyUserName,
        capabilityContext: journeyCapabilityContext,
      }));
    }
  };
  const selectedSessionLabel = useMemo(() => {
    const session = (chat.sessions ?? []).find((item) => sameOpenClawSelectableSessionKey(item.key, selectedSessionKey));
    if (!session) return fallbackOpenClawSessionDisplayName(selectedSessionKey);
    return displayOpenClawSessionName(session);
  }, [chat.sessions, selectedSessionKey]);
  const selectedSessionReturnTarget = selectedAgent && (mainTab !== "chat" || openclawSettingsOpen)
    ? { label: selectedSessionLabel, onSelect: openChatTab }
    : null;
  const showMobileSectionReturn = !isDesktopViewport && Boolean(selectedSessionReturnTarget);
  const mobileReturnAriaLabel = selectedSessionReturnTarget ? `Open ${selectedSessionReturnTarget.label}` : "Open session";
  const handleMobileSectionReturn = () => {
    openChatTab();
  };
  const useSettingsMobileChrome = !isDesktopViewport && mainTab === "settings" && Boolean(selectedAgent) && !openclawSettingsOpen;

  return (
    <AgentGatewaySessionProvider session={gatewayChat}>
      <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header + menu (hidden on desktop) */}
      {!isDesktopViewport && !useSettingsMobileChrome && (
        <div className="relative flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <HyperCLILogoLink className="h-[31px] w-[102px]" priority />
            <span className="text-text-muted font-medium">Agents</span>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-low/80 p-1">
            <AnimatePresence initial={false}>
              {showMobileSectionReturn && (
                <motion.button
                  key="mobile-chat-return"
                  type="button"
                  aria-label={mobileReturnAriaLabel}
                  title={mobileReturnAriaLabel}
                  onClick={handleMobileSectionReturn}
                  initial={{ opacity: 0, scale: 0.85, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 40 }}
                  exit={{ opacity: 0, scale: 0.85, width: 0 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-secondary transition-colors hover:bg-background hover:text-foreground"
                >
                  <ArrowLeft className="h-5 w-5 shrink-0" />
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
                  ? "border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
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
                  ? "border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
                  : "border-transparent text-text-secondary hover:bg-background hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} onOpenPlanCatalog={openUpgradeCatalog} />

      {checkoutSync && (
        <div
          className={`mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm sm:mx-6 lg:mx-8 ${
            checkoutSync.status === "pending" || checkoutSync.status === "cancelled"
              ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
              : "border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
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
                onClose={() => setMobileAgentLauncherOpen(false)}
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
                sessions={chat.sessions}
                sessionsFetched={chat.sessionsFetched}
                creatingSessionKeys={chat.creatingSessionKeys}
                thinkingSessionKeys={chat.thinkingSessionKeys}
                selectedSessionKey={selectedSessionKey}
                onSelectSession={selectSession}
                onRenameSession={renameSession}
                onDeleteSession={deleteSession}
                onCreateSession={createSession}
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
          tokenUsed={tokenUsage}
          tokenLimit={budget?.pooled_tpd ?? null}
          disabled={workspaceSidebarDisabled}
          disabledReason={workspaceSidebarDisabledReason}
          scheduledDisabled={!SCHEDULED_SECTION_ENABLED}
          scheduledDisabledReason={SCHEDULED_SECTION_DISABLED_REASON}
          isDesktopViewport={isDesktopViewport}
          sessions={chat.sessions}
          sessionsFetched={chat.sessionsFetched}
          creatingSessionKeys={chat.creatingSessionKeys}
          thinkingSessionKeys={chat.thinkingSessionKeys}
          selectedSessionKey={selectedSessionKey}
          onSelectSession={selectSession}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onCreateSession={createSession}
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
          isSelectedRunning={Boolean(isSelectedRunning)}
          burstAgentId={burstAgentId}
          onBurstComplete={() => setBurstAgentId(null)}
          agentStatus={agentStatus}
          activeConnectionStatus={activeConnectionStatus}
          chatConnected={chat.connected}
          chatConnecting={chat.connecting}
          sessionReturnTarget={selectedSessionReturnTarget}
          startingId={startingId}
          recentlyStoppedIds={recentlyStoppedIds}
          selectedAgentLaunchBlocked={selectedAgentLaunchBlocked}
          selectedAgentStartGuidanceTitle={selectedAgentStartBlockedTitle}
          blockedMessage={selectedAgentStartBlockedMessage}
          suggestedTierActions={selectedAgentSuggestedTierActions}
          currentPanel={selectedCenterPanel}
          skillsPanelActive={directoryCategory === "skills"}
          stoppedTabLabel={stoppedTabLabel[selectedCenterPanel]}
          persistentPanelContent={
            <AgentTerminalPanel
              status={shellStatus}
              shellBoxRef={shellBoxRef}
              visible={mainTab === "shell" && Boolean(isSelectedRunning)}
            />
          }
          panelContent={mainTab === "chat" ? (
            <AgentChatPanel
              chat={gatewayChat}
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
              onReadFileBytesFromChat={readAgentFileBytes}
              onOpenFileFromChat={openFilesTab}
              onDownloadFileFromChat={downloadAgentFileFromChat}
              fileReferenceCandidates={chatFileReferenceCandidates}
              journeyIntro={journeyIntroVisibleInChat ? {
                enabled: true,
                agentName: selectedJourneyAgentName,
                suggestedUserName: suggestedJourneyUserName,
                onStartBrief: (starterDirection, preferredName) => setJourneyPromptResult(buildJourneyBriefPrompt({
                  agentName: selectedJourneyAgentName,
                  preferredName,
                  starterDirection,
                })),
              } : undefined}
              journeyMissionCard={journeyMissionCardVisibleInChat && journeyMissionDay ? {
                enabled: true,
                agentName: selectedJourneyAgentName,
                preferredName: suggestedJourneyUserName,
                day: journeyMissionDay,
                capabilityContext: journeyCapabilityContext,
                onSetPrompt: setJourneyPrompt,
                onRunDayAction: runJourneyDayAction,
                onRunCapabilityPrompt: runJourneyCapabilityPrompt,
                onOpenCapability: openJourneyCapability,
              } : undefined}
              slashCommandActions={{
                onOpenFiles: openFilesTab,
                onOpenConfig: openOpenClawSettings,
                onOpenIntegrations: openIntegrationsTab,
                onOpenSkills: openSkillsTab,
                onOpenScheduled: openScheduledTab,
                onOpenLogs: openLogsTab,
                onOpenShell: openShellTab,
                onOpenPlans: openUpgradeCatalog,
                onOpenBilling: () => router.push("/dashboard/settings"),
                onNewConversation: createSession,
                onStartAgent: async () => {
                  if (selectedAgent) await handleStart(selectedAgent.id);
                },
                onStopAgent: async () => {
                  if (selectedAgent) await handleStop(selectedAgent.id);
                },
                onNewAgent: () => {
                  setMobileShowChat(false);
                  setSidebarCreatorSignal((v) => v + 1);
                },
                onRenameAgent: async (name) => {
                  if (!selectedAgent) return;
                  const token = await getToken();
                  const updatedAgent = await createAgentClient(token).update(selectedAgent.id, { name });
                  setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
                },
                onOpenAgentSettings: openAgentSettingsTab,
                onCreateDirectory: async (name) => {
                  await createAgentDirectory(`${OPENCLAW_WORKSPACE_PREFIX}/${name}`);
                },
              }}
            />
          ) : mainTab === "files" ? (
            <AgentFilesPanel
              key={selectedAgent?.id ?? "no-agent"}
              agentId={selectedAgentId}
              agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
              rootPath={OPENCLAW_WORKSPACE_PREFIX}
              connected={Boolean(selectedAgentId)}
              initialPreviewPath={filesPreviewPath}
              isDesktopViewport={isDesktopViewport}
              error={null}
              onListFiles={listAgentFiles}
              onOpenFile={readAgentFileResult}
              onOpenFileBytes={readAgentFileBytesResult}
              onDownloadFileBytes={readAgentFileBytesResult}
              onSaveFile={async (path, content) => {
                await saveAgentFile(path, content);
                completeJourneyForEvent("source-added");
              }}
              onDeleteFile={deleteAgentFile}
              onUploadFile={async (path, content) => {
                await uploadAgentFile(path, content);
                completeJourneyForEvent("source-added");
              }}
              onCreateDirectory={async (path) => {
                await createAgentDirectory(path);
                completeJourneyForEvent("source-added");
              }}
            />
          ) : mainTab === "integrations" ? (
            <IntegrationsDirectoryPanel
              initialCategory={directoryCategory}
              initialPluginId={directoryItemId}
              detailBackLabel={directoryDetailOrigin === "chat" ? "Back to chat" : undefined}
              onDetailBack={directoryDetailOrigin === "chat" ? openChatTab : undefined}
              agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
              config={chat.config as Record<string, unknown> | null}
              configSchema={chat.configSchema}
              connected={chat.connected}
              onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
              onChannelProbe={async () => chat.channelsStatus(true)}
              onOpenShell={openShellTab}
              onLoadSkills={loadAgentSkills}
              onListFiles={listAgentFiles}
              onReadFile={readAgentFile}
              onIntegrationAuthStart={chat.integrationsAuthStart}
              onIntegrationAuthStatus={chat.integrationsAuthStatus}
              onIntegrationStatus={chat.integrationsStatus}
              onIntegrationDisconnect={chat.integrationsDisconnect}
            />
          ) : mainTab === "scheduled" ? (
            <AgentScheduledPanel
              key={`${selectedAgent?.id ?? "agent"}:${scheduledInitialCommand?.id ?? 0}`}
              agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
              sessionKey={selectedSessionKey}
              sessionOptions={scheduledSessionOptions}
              jobs={agentCronJobsForView ?? []}
              connected={chat.connected}
              connecting={chat.connecting}
              hydrating={chat.hydrating}
              error={chat.error}
              isSelectedRunning={Boolean(isSelectedRunning)}
              onRefresh={async () => {
                await chat.refreshCron();
              }}
              onCreate={async (job) => {
                await chat.addCron(job);
              }}
              onUpdate={async (jobId, job) => {
                await chat.updateCron(jobId, job);
              }}
              onRun={async (jobId) => {
                await chat.runCron(jobId);
                await chat.refreshCron();
              }}
              onDelete={async (jobId) => {
                await chat.removeCron(jobId);
              }}
              onStartAgent={async () => {
                if (selectedAgent) await handleStart(selectedAgent.id);
              }}
              initialCommand={scheduledInitialCommand?.command ?? null}
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
              openclawConfig={chat.config}
              openclawModels={chat.models}
              onUpdateAgentName={async (agentId, name) => {
                const token = await getToken();
                const updatedAgent = await createAgentClient(token).update(agentId, { name });
                setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
              }}
              onSaveOpenClawConfig={async (patch) => {
                await chat.saveConfig(patch);
                completeJourneyForEvent("rules-confirmed");
              }}
              isDesktopViewport={isDesktopViewport}
              showSessionReturn={showMobileSectionReturn}
              onSessionReturn={handleMobileSectionReturn}
              mobileReturnLabel={selectedSessionReturnTarget?.label ?? "Session"}
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
            null
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
              onMarketplaceClick: openIntegrationsTab,
              onAgentStart: () => { if (selectedAgent) void handleStart(selectedAgent.id); },
              onAgentStop: () => { if (selectedAgent) void handleStop(selectedAgent.id); },
              agentStarting: selectedAgentStarting,
              agentStopping: Boolean(selectedAgent && stoppingId === selectedAgent.id),
              agentStartBlocked: selectedAgentLaunchBlocked,
              agentStartBlockedReason: selectedAgentStartBlockedTitle,
              onOpenFiles: openFilesTab,
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
        config={chat.config}
        configSchema={chat.configSchema}
        connected={chat.connected}
        connecting={chat.connecting}
        onSaveConfig={async (patch) => {
          await chat.saveConfig(patch);
          completeJourneyForEvent("rules-confirmed");
        }}
        isDesktopViewport={isDesktopViewport}
      />

      {!journeyChatSurfaceVisible ? (
        <JourneyFloatingPanel
          journey={journey}
          onRunDayAction={runJourneyDayAction}
          onRunCapabilityPrompt={runJourneyCapabilityPrompt}
          onOpenCapability={openJourneyCapability}
          capabilityContext={journeyCapabilityContext}
        />
      ) : null}

      </div>
    </AgentGatewaySessionProvider>
  );
}
