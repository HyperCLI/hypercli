"use client";

import React, { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Check,
  Loader2,
  Menu,
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

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useAgentRosterCollapsed } from "@/hooks/useAgentRosterCollapsed";
import { useAccountProfileAvatar } from "@/hooks/useAccountProfileAvatar";
import { useAccountProfileName } from "@/hooks/useAccountProfileName";
import { useAgentDashboardDesktopViewport } from "@/hooks/useAgentDashboardViewport";
import {
  AGENT_CLEANUP_START_MESSAGE,
  archiveAgent,
  createAgentClient,
  createHermesAgentDeployment,
  createHyperAgentClient,
  createOpenClawAgent,
  createPublicHyperAgentClient,
  deleteStoppedAgent,
  isAgentCleanupConflictError,
  isAgentLifecycleStateConflictError,
  requestAgentStart,
  restoreAgent,
  startAgent,
  stopAgent,
  waitForCreatedAgentStopped,
  waitForAgentRunning,
} from "@/lib/agent-client";
import {
  createAgentMutationQueue,
  managedAgentHandleFromDisplayName,
  mergeAgentListAfterMutations,
  persistAgentCanonicalName,
  persistAgentDisplayName,
  shouldReplaceAgentSnapshot,
  upsertAgentSnapshot,
} from "@/lib/agent-profile-updates";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { formatCpu, formatMemory, formatTokens } from "@/lib/format";
import { useOpenClawSession, type OpenClawHydrationMode } from "@/hooks/useOpenClawSession";
import type { ShellStatus } from "@/hooks/useAgentShell";
import { useAgentShellActivation } from "@/hooks/useAgentShellActivation";
import { preloadAgentShellTerminalRuntime } from "@/lib/agent-shell-terminal-loader";
import { clearOpenClawSessionPins, useOpenClawSessionPins } from "@/hooks/useOpenClawSessionPins";
import { useAgentRosterOrder } from "@/hooks/useAgentRosterOrder";
import { agentProfileImageUrl } from "@/lib/avatar";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { AccountOperationsHome } from "@/components/dashboard/AccountOperationsHome";
import {
  SkillDraftTestBanner,
  assertSkillDraftTestable,
  buildSkillTestPrompt,
  createSkillDraftRevision,
  linkSkillDraftTestSession,
  saveSkillDraftFromTest,
  useAgentSkills,
  useSkillDraftTestSession,
  type AgentSkill,
} from "@/components/dashboard/skills";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import type { TabId as AgentViewTabId } from "@/components/dashboard/agentViewTypes";
import { MOCK_PARTICIPANTS, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { ChannelCreationWizard } from "@/components/dashboard/ChannelCreationWizard";
import { getCategoryForPlugin, type DirectoryCategory } from "@/components/dashboard/directory/directory-utils";
import { PlanComparisonModal } from "@/components/dashboard/agents/PlanComparisonModal";
import { AgentCreationSetupWizard, type AgentCreationSetupCreateParams } from "@/components/dashboard/agents/AgentCreationSetupWizard";
import { EmbeddedPlanCheckout } from "@/components/dashboard/agents/EmbeddedPlanCheckout";
import { AgentDashboardTour } from "@/components/dashboard/agents/AgentDashboardTour";
import { clearFirstAgentSetupDraft, updateFirstAgentSetupDraftPlan, useFirstAgentSetupDraft } from "@/hooks/useFirstAgentSetupDraft";
import type { AgentFileEntry, SdkAgent } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@hypercli/shared-ui";
import { inferFileMimeType, isAudioFileReference, isFileTypeReference, isImageFileReference, type FileEntry } from "@hypercli/shared-ui/files";
import { buildBrowserDesktopUrl } from "@hypercli.com/sdk/agents";
import type { DeploymentEvent, Deployments, HermesAgent as SdkHermesAgent, OpenClawAgent as SdkOpenClawAgent } from "@hypercli.com/sdk/agents";
import {
  hasActivePlan,
  type HyperAgentCurrentPlan,
  type HyperAgentEntitlement,
  type HyperAgentPlan,
  type HyperAgentSubscription,
  type HyperAgentSubscriptionSummary,
  type HyperAgentTypeCatalog,
} from "@hypercli.com/sdk/agent";
import type { Agent, AgentBudget, AgentDesktopTokenResponse, AgentState } from "./types";
import { isAgentDeletable, isAgentStartable, isAgentStoppable, isAgentTransitionalState, resolveAgentLaunchLifecycleAction } from "./types";
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
import { buildOpenClawLaunchOptions } from "@/lib/openclaw-launch";
import { buildHermesLaunchOptions } from "@/lib/hermes-launch";
import { isHermesAgentRuntime } from "@/lib/agent-runtime";
import { useHermesSession } from "@/hooks/useHermesSession";
import {
  buildOpenClawBootstrapFileGenerationMessages,
  buildOpenClawBootstrapFileResponseFormat,
  createOpenClawBootstrapDraft,
  parseGeneratedOpenClawBootstrapFile,
  type OpenClawBootstrapFileName,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";
import { displayNameForDashboard } from "@/lib/dashboard-greeting";
import {
  clearStripeCheckoutReturnState,
  clearPendingPlanCheckout,
  buildStripeCheckoutReturnUrl,
  catalogPlanOffersTeamTrial,
  createPlanCheckoutAttemptId,
  createTeamTrialCheckoutState,
  getCheckoutReflectionStatus,
  getCheckoutOwnedCountFromSummary,
  getEffectivePlanName,
  getGrantedLaunchSlotsByTier,
  isTeamTrialCheckoutFlow,
  markPendingPlanCheckoutReturned,
  mergeLaunchSlotInventories,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
  TEAM_TRIAL_PLAN_ID,
  type PendingPlanCheckout,
  type FirstAgentTrialCheckoutContext,
  writePendingPlanCheckout,
} from "@/lib/plan-checkout-state";
import { getActiveAgentTrial } from "@/lib/agent-trial";
import { startTrial as requestTrialCheckout } from "@/lib/trial-checkout";
import {
  billingReflectionReducer,
  checkoutSyncBannerFromBillingState,
  initialBillingReflectionState,
} from "@/lib/billing-reflection-machine";
import {
  OPENCLAW_INTERNAL_SESSION_KEY,
  createOpenClawDashboardSessionKey,
} from "@/lib/openclaw-session-key";
import {
  displayOpenClawSessionName,
  fallbackOpenClawSessionDisplayName,
  isGeneratedOpenClawSessionName,
  isOpenClawHeartbeatSessionKey,
  isOpenClawMainSessionKey,
  resolveOpenClawResumeSessionKey,
  sameOpenClawSelectableSessionKey,
  unscopedOpenClawSessionKey,
} from "@/lib/openclaw-session-sdk-surface";
import {
  launchConfigSyncRoot,
  normalizeAgentBrowserFilePath,
  normalizeOpenClawWorkspaceFilePath,
} from "@/lib/agent-file-path";
import {
  AgentLoadingState,
  type AgentStatusChipModel,
  type CenterPanel,
} from "@/components/dashboard/agents/page-helpers";
import { AgentDesktopEmptyState, AgentSettingsPanel, AgentList, AgentTierSelectionModal, ErrorBanner, type AgentSettingsSection } from "@/components/dashboard/agents/AgentPanels";
import {
  AgentChatPanel,
  normalizeChatFileDropItems,
  scrollTranscriptToBottom,
  type ChatConnectionSuggestion,
  type ChatFileDropInput,
  type ChatPendingFileRemovalState,
} from "@/components/dashboard/agents/AgentChatPanel";
import {
  deleteChatImageCollection,
  shouldStageChatImageCollection,
  uploadChatImageCollection,
  type ChatImageCollectionDescriptor,
  type ChatImageCollectionProgress,
} from "@/lib/chat-image-collection";
import {
  type AgentFilePreviewReadOptions,
} from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLogsController, type AgentLogsControllerHandle } from "@/components/dashboard/agents/AgentLogsController";
import { AgentShellController, type AgentShellControllerHandle } from "@/components/dashboard/agents/AgentShellController";
import { AgentInspector } from "@/components/dashboard/agents/AgentInspector";
import { AgentMainPanel, type DashboardSurfaceHeader } from "@/components/dashboard/agents/AgentMainPanel";
import { AgentDisplayNameEditor } from "@/components/dashboard/agents/AgentDisplayNameEditor";
import { AgentPrivateChatControl } from "@/components/dashboard/agents/AgentPrivateChatControl";
import { AgentWorkspaceSidebar, CollectionCreationDialog } from "@/components/dashboard/agents/AgentWorkspaceSidebar";
import { AgentGatewaySessionProvider, asAgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import {
  SettingsMenu,
  SettingsSectionHeader,
  resolveSettingsSectionId,
  type SettingsSectionId,
} from "@/components/dashboard/settings/SettingsMenu";
import { SettingsCollectionSelector } from "@/components/dashboard/settings/SettingsCollectionSelector";
import { SettingsAgentSelector } from "@/components/dashboard/settings/SettingsAgentSelector";
import {
  useWorkspace,
  workspaceDisplayName,
} from "@/components/dashboard/WorkspaceContext";
import { JourneyFloatingPanel } from "@/components/dashboard/journey/JourneyFloatingPanel";
import type { JourneyCapabilityCard } from "@/components/dashboard/journey/journey-capabilities";
import { buildJourneyBriefPrompt, buildJourneyCapabilityPrompt, buildJourneyPrompt } from "@/components/dashboard/journey/journey-prompt-builder";
import { useJourney } from "@/components/dashboard/journey/useJourney";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { agentDisplayLabel, didAnyAgentFinishCleanup, toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import {
  createDeploymentRefreshScheduler,
  createDeploymentSubscriptionRefreshHandlers,
  createDeploymentSubscriptionRecovery,
  type DeploymentRefreshScheduler,
} from "@/components/dashboard/agents/deploymentRefreshScheduler";
import {
  countPendingSlotReleasesByTier,
  markPendingSlotReleaseComplete,
  reconcileCompletedSlotReleases,
  registerPendingSlotRelease,
  type PendingSlotReleaseMap,
} from "@/components/dashboard/agents/pendingSlotReleases";
import { compactBundle, formatBundle, subscriptionSlotBundle, type SlotBundle } from "@/lib/subscriptions";
import { createAudioMediaRecorder } from "@/lib/audio-recorder";
import { downloadFileBytes } from "@/lib/download-file";
import { buildAgentWorkspaceTabHref, resolveAgentRouteTab, type AgentRouteTab } from "@/lib/agent-workspace-route";
import { agentPrimarySurface } from "@/lib/agent-runtime-surface";
import {
  ACCOUNT_PAGE_HREFS,
  buildAgentSettingsHref,
  buildDashboardViewHref,
  buildKnowledgeHubHref,
  resolveDashboardView,
  resolveKnowledgeCollectionId,
  syncDashboardSearchParams,
  type DashboardView,
} from "@/lib/dashboard-route";
import { describeStarterFileFailures, stageAgentStarterFilesAndStart } from "@/lib/agent-starter-files";
import { markDashboardPerformance, measureDashboardPerformance } from "@/lib/agent-dashboard-performance";
import { normalizeCronJob } from "@/lib/cron-jobs";
import {
  readAgentFileWithRecovery,
  type AgentFileReadRecoveryResult,
} from "@/lib/agent-file-recovery";
import type { ChatPendingFile } from "@/lib/openclaw-chat";
import type { JourneyCompletionEvent, JourneyDay } from "@/components/dashboard/journey/types";
import { resolveWorkspaceAgentSelection } from "@/lib/workspace-agent-roster";
import type { KnowledgeHubSelectedCollection } from "@/components/dashboard/knowledge/KnowledgeHub";

type MainTab = AgentMainTab;
type AgentOnboardingOverlay = "tour" | "launcher" | null;
type AnonymousAgentPreviewSection = Extract<MainTab, "chat" | "files" | "integrations" | "skills" | "scheduled"> | "desktop";
type PendingJourneyChatCompletion = {
  event: JourneyCompletionEvent | null;
  dayId?: string | null;
  receiptText?: string | null;
};
type SubscriptionSummaryWithEntitlementItems = HyperAgentSubscriptionSummary & {
  entitlementItems?: HyperAgentEntitlement[];
};

const SHOW_AGENT_INSPECTOR = false;
const AGENT_DASHBOARD_TOUR_ENABLED = false;
const SCHEDULED_SECTION_ENABLED = true;
const SCHEDULED_SECTION_DISABLED_REASON = "Scheduled workflows are not available yet.";
const BILLING_MOCK_PARAM = "billingMock";
const BILLING_MOCK_ACTIVE_NO_SLOT = "active-no-slot";
const ANONYMOUS_AGENT_PREVIEW_ROTATION_MS = 10_000;
const ANONYMOUS_AGENT_PREVIEW_SECTIONS: readonly AnonymousAgentPreviewSection[] = [
  "chat",
  "files",
  "integrations",
  "skills",
  "scheduled",
  "desktop",
];
const AGENT_LAUNCHER_OPEN_VALUES = new Set(["agent-launcher", "launcher", "launch-agent"]);
const INTEGRATION_QUERY_IDS = new Set(["telegram", "discord", "slack", "whatsapp", "github"]);
const TOKEN_USAGE_RECONCILE_DELAYS_MS = [2000, 5000] as const;
const AGENT_CLEANUP_CONFLICT_COOLDOWN_MS = 30_000;
const CHAT_UPLOAD_DRAIN_WAIT_MS = 1_500;
const TOKEN_USAGE_RUNNING_REFRESH_INTERVAL_MS = 60_000;
const AGENT_DASHBOARD_ENRICHMENT_TIMEOUT_MS = 10_000;
const SHELL_INTENT_TTL_MS = 12_000;
const AGENT_DIRECTORY_MARKER_NAME = ".hypercli-folder";
const KNOWLEDGE_HUB_SURFACE_CONTROLS_ID = "knowledge-hub-surface-controls";

function DeferredDashboardPanel() {
  return (
    <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Loading workspace panel">
      <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
    </div>
  );
}

const AgentFilesPanel = dynamic(
  () => import("@/components/dashboard/agents/AgentFilesPanel").then((module) => module.AgentFilesPanel),
  { loading: DeferredDashboardPanel },
);
const AgentScheduledPanel = dynamic(
  () => import("@/components/dashboard/agents/AgentScheduledPanel").then((module) => module.AgentScheduledPanel),
  { loading: DeferredDashboardPanel },
);
const IntegrationsDirectoryPanel = dynamic(
  () => import("@/components/dashboard/integrations/IntegrationsDirectoryPanel").then((module) => module.IntegrationsDirectoryPanel),
  { loading: DeferredDashboardPanel },
);
const SkillsPanel = dynamic(
  () => import("@/components/dashboard/skills/SkillsPanel").then((module) => module.SkillsPanel),
  { loading: DeferredDashboardPanel },
);
const SharedKnowledgeSection = dynamic(
  () => import("@/components/dashboard/knowledge/SharedKnowledgeSection").then((module) => module.SharedKnowledgeSection),
  { loading: DeferredDashboardPanel },
);
const KnowledgeHub = dynamic(
  () => import("@/components/dashboard/knowledge/KnowledgeHub").then((module) => module.KnowledgeHub),
  { loading: DeferredDashboardPanel },
);
const MembersSection = dynamic(
  () => import("@/components/dashboard/members/MembersSection").then((module) => module.MembersSection),
  { loading: DeferredDashboardPanel },
);
const WorkspaceOverviewPanel = dynamic(
  () => import("@/components/dashboard/WorkspaceOverviewPanel").then((module) => module.WorkspaceOverviewPanel),
  { loading: DeferredDashboardPanel },
);
const WorkspaceUsagePanel = dynamic(
  () => import("@/components/dashboard/WorkspaceUsagePanel"),
  { loading: DeferredDashboardPanel },
);
const AccountSettingsPanel = dynamic(
  () => import("@/components/dashboard/AccountSettingsPanel"),
  { loading: DeferredDashboardPanel },
);
const ApiKeysSettingsPanel = dynamic(
  () => import("@/app/dashboard/keys/page"),
  { loading: DeferredDashboardPanel },
);
const ProfileBillingSection = dynamic(
  () => import("@/components/billing/ProfileBillingSection").then((module) => module.ProfileBillingSection),
  { loading: DeferredDashboardPanel },
);
const PlansPage = dynamic(
  () => import("@/components/plans/PlansPage"),
  { loading: DeferredDashboardPanel },
);
const OpenClawSettingsDrawer = dynamic(
  () => import("@/components/dashboard/agents/OpenClawSettingsDrawer").then((module) => module.OpenClawSettingsDrawer),
);

function optionalDashboardData<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), AGENT_DASHBOARD_ENRICHMENT_TIMEOUT_MS);
  });
  return Promise.race([
    promise.catch(() => fallback),
    timeoutPromise,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function pendingFileIsImage(file: ChatPendingFile): boolean {
  return isImageFileReference(file);
}

function pendingFileIsAudio(file: ChatPendingFile): boolean {
  return isAudioFileReference(file);
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
    type: entry.mimeType || inferFileMimeType(entry),
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

type AgentAuthIntent =
  | { kind: "checkout"; plan: UpgradeCheckoutPlan; presentation?: "modal" | "embedded" }
  | { kind: "trial"; firstAgentSetup?: FirstAgentTrialCheckoutContext }
  | { kind: "launch" }
  | { kind: "workspace" }
  | { kind: "navigate"; href: string };

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

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function trialClaimErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = String((error as { detail?: unknown }).detail ?? "").trim();
    if (detail) return detail;
  }
  return error instanceof Error && error.message
    ? error.message
    : "Trial access could not be started. Try again.";
}

function clearTeamTrialIntentSearchParams(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete("intent");
  if (params.get("plan")?.toLowerCase() === TEAM_TRIAL_PLAN_ID) params.delete("plan");
  syncDashboardSearchParams(params);
}

function agentTokenUsageMap(
  usage: { agents?: Array<{ agentId?: unknown; totalTokens?: unknown }> } | null | undefined,
): Record<string, number> | null {
  if (!Array.isArray(usage?.agents)) return null;
  return Object.fromEntries(usage.agents.flatMap((entry) => {
    const agentId = typeof entry.agentId === "string" ? entry.agentId.trim() : "";
    return agentId ? [[agentId, finiteNumber(entry.totalTokens)]] : [];
  }));
}

function dailyTokenUsageTotal(
  usage: {
    agents?: Array<{ totalTokens?: unknown }>;
    unattributed?: { totalTokens?: unknown };
  } | null | undefined,
): number | null {
  if (!usage) return null;
  const attributed = Array.isArray(usage.agents)
    ? usage.agents.reduce((total, entry) => total + Math.max(finiteNumber(entry.totalTokens), 0), 0)
    : 0;
  return attributed + Math.max(finiteNumber(usage.unattributed?.totalTokens), 0);
}

function agentTokenLimit(
  summary: HyperAgentSubscriptionSummary | null,
  agentId: string | null,
): number | null {
  if (!agentId) return null;
  const entitlement = summary?.entitlementItems.find((item) => item.activeAgentIds.includes(agentId));
  return entitlement && Number.isFinite(entitlement.tpdLimit) && entitlement.tpdLimit > 0
    ? entitlement.tpdLimit
    : null;
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

function primaryLaunchTier(bundle: SlotBundle): string | null {
  const tiers: Array<keyof Pick<SlotBundle, "large" | "medium" | "small">> = ["large", "medium", "small"];
  return tiers.find((tier) => Number(bundle[tier] || 0) > 0) ?? null;
}

function isFirstAgentSetupCheckout(
  pending: PendingPlanCheckout | null,
): pending is PendingPlanCheckout & {
  flow: "first-agent-setup" | "first-agent-trial";
  setupId: string;
  agentSize: string;
} {
  return (
    pending?.flow === "first-agent-setup"
    || pending?.flow === "first-agent-trial"
  ) && Boolean(pending.setupId && pending.agentSize);
}

function getCheckoutLaunchReflectionStatus(
  summary: HyperAgentSubscriptionSummary | null,
  pending: PendingPlanCheckout | null,
  billingBudget: AgentBudget | null,
) {
  const reflectionStatus = getCheckoutReflectionStatus(summary, pending);
  if (
    reflectionStatus === "ready" &&
    isFirstAgentSetupCheckout(pending) &&
    Math.max(billingBudget?.slots?.[pending.agentSize]?.available ?? 0, 0) <= 0
  ) return "waiting-entitlement" as const;
  return reflectionStatus;
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
  const existingSubscription = summary?.activeSubscriptions?.find((subscription) => primaryLaunchTier(subscriptionSlotBundle(subscription)));
  const tier = primaryLaunchTier(existingSubscription ? subscriptionSlotBundle(existingSubscription) : (catalogProduct?.bundle ?? {})) ?? "medium";
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
    agentSlots: existingSubscription?.agentSlots || [],
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
    agentSlots: summary?.agentSlots ?? [],
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
      agentSlots: summary?.entitlements?.agentSlots ?? [],
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
  if (!checkoutPlan) return 0;
  return getCheckoutOwnedCountFromSummary(summary, {
    planId: checkoutPlan.id,
    bundle: checkoutPlan.bundle,
  });
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
  billingReady: boolean;
};

function UpgradePlanCatalogContent({
  products,
  ownedCounts,
  loading,
  error,
  onSelectPlan,
  onStartTrial,
  onOpenPlans,
  trialAvailable = false,
  trialCheckoutPending = false,
  embedded = false,
}: {
  products: UpgradeDisplayProduct[];
  ownedCounts: Record<string, number>;
  loading: boolean;
  error: string | null;
  onSelectPlan: (product: UpgradeDisplayProduct) => void;
  onStartTrial?: (product: UpgradeDisplayProduct) => void;
  onOpenPlans: () => void;
  trialAvailable?: boolean;
  trialCheckoutPending?: boolean;
  embedded?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5" data-slot="capacity-catalog-content">
      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
        <div
          data-slot={embedded ? "embedded-plan-card-grid" : undefined}
          className={embedded
            ? "flex min-h-full flex-wrap content-center justify-evenly gap-3"
            : "flex flex-wrap justify-evenly gap-3"}
        >
          {products.map((product) => {
            const ownedCount = ownedCounts[product.id] ?? 0;
            const trialOffer = Boolean(onStartTrial) && catalogPlanOffersTeamTrial(
              product.id,
              ownedCount,
              trialAvailable,
            );
            const ProductIcon = product.highlighted ? Sparkles : Bot;
            const featureRows = upgradeProductFeatures(product);
            return (
              <div
                key={product.id}
                data-slot={embedded ? "embedded-plan-card" : undefined}
                className="relative flex min-h-[302px] w-full max-w-[300px] flex-col rounded-[8px] border border-border bg-surface-low p-4 text-left transition-colors hover:border-border-strong"
              >
                {(product.highlighted || trialOffer) && (
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--selection-accent)] px-2.5 py-1 text-[12px] font-medium leading-none text-[var(--selection-accent-foreground)]">
                    {trialOffer ? "7 days free" : "Most Popular"}
                  </span>
                )}

                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-border bg-surface-high text-foreground">
                    <ProductIcon className="h-4 w-4" />
                  </span>
                  <h3 className="truncate text-[18px] font-semibold leading-none text-foreground">{product.name}</h3>
                  {ownedCount > 0 && (
                    <span className="ml-auto shrink-0 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2 py-0.5 text-[11px] font-medium text-[var(--selection-accent)]">
                      You own {ownedCount}
                    </span>
                  )}
                </div>

                <p className="mt-5 min-h-[34px] text-[13px] leading-[1.35] text-text-muted">
                  {describeUpgradeProduct(product)}
                </p>

                <div className="mt-3 flex min-h-[42px] items-center gap-2.5">
                  <span className="text-[28px] font-bold leading-none text-foreground">${product.price}</span>
                  <span className="max-w-[78px] text-[10px] font-semibold leading-[1.1] text-text-secondary">
                    {trialOffer ? "USD/month after trial" : "USD/month per plan"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (trialOffer) onStartTrial?.(product);
                    else onSelectPlan(product);
                  }}
                  disabled={trialCheckoutPending}
                  className={`mt-3 flex h-8 w-full items-center justify-center rounded-[8px] px-3 text-[13px] font-medium leading-tight transition-colors ${
                    product.highlighted || trialOffer
                      ? "bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)]"
                      : "border border-border bg-surface-high text-foreground hover:bg-surface-medium"
                  } disabled:cursor-wait disabled:opacity-70`}
                >
                  {trialOffer
                    ? trialCheckoutPending ? "Starting trial..." : "Start free trial"
                    : ownedCount > 0 ? "Add another" : product.highlighted ? `Upgrade to ${product.name}` : "Select plan"}
                </button>

                <div className="mt-5 space-y-2.5">
                  {featureRows.map((feature, featureIndex) => (
                    <div key={`${product.id}-${featureIndex}-${feature}`} className="flex items-start gap-2.5 text-[13px] leading-tight text-text-secondary">
                      <Check className="mt-px h-4 w-4 shrink-0 text-text-muted" />
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
  );
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
  onStartTrial,
  onOpenPlans,
  trialAvailable,
  trialCheckoutPending,
}: {
  open: boolean;
  products: UpgradeDisplayProduct[];
  catalogPlans: HyperAgentPlan[] | null;
  ownedCounts: Record<string, number>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectPlan: (product: UpgradeDisplayProduct) => void;
  onStartTrial?: (product: UpgradeDisplayProduct) => void;
  onOpenPlans: () => void;
  trialAvailable?: boolean;
  trialCheckoutPending?: boolean;
}) {
  const [comparisonOpen, setComparisonOpen] = useState(false);

  if (!open) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-capacity-dialog-title"
        aria-describedby="add-capacity-dialog-description"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 pr-12 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 id="add-capacity-dialog-title" className="text-base font-semibold leading-5 text-foreground">Add capacity</h2>
              <p id="add-capacity-dialog-description" className="mt-1 text-xs leading-4 text-text-muted">Choose a plan to add agent capacity.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setComparisonOpen(true)}
            className="ml-[52px] inline-flex h-8 w-fit shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-high sm:ml-0 sm:mt-1"
          >
            Compare plans
          </button>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close capacity dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <UpgradePlanCatalogContent
          products={products}
          ownedCounts={ownedCounts}
          loading={loading}
          error={error}
          onSelectPlan={onSelectPlan}
          onStartTrial={onStartTrial}
          onOpenPlans={onOpenPlans}
          trialAvailable={trialAvailable}
          trialCheckoutPending={trialCheckoutPending}
        />
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
  return normalizeAgentBrowserFilePath(path);
}

function routableOpenClawSessionKey(value: string | null | undefined): string | null {
  const sessionKey = value?.trim() || null;
  if (!sessionKey || isOpenClawMainSessionKey(sessionKey)) return null;
  return isGeneratedOpenClawSessionName(sessionKey)
    ? unscopedOpenClawSessionKey(sessionKey)
    : sessionKey;
}

function stringFileMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    mimeType: stringFileMetadata(entry.mime_type)
      ?? stringFileMetadata(entry.mimeType)
      ?? stringFileMetadata(entry.content_type)
      ?? stringFileMetadata(entry.contentType),
    lastModified: stringFileMetadata(entry.last_modified ?? entry.lastModified),
    checksum: stringFileMetadata(entry.checksum),
    checksumAlgorithm: stringFileMetadata(entry.checksum_algorithm ?? entry.checksumAlgorithm ?? entry.checksum_algo),
    hash: stringFileMetadata(entry.hash),
    hashAlgorithm: stringFileMetadata(entry.hash_algorithm ?? entry.hashAlgorithm),
    sha256: stringFileMetadata(entry.sha256 ?? entry.sha_256),
    md5: stringFileMetadata(entry.md5),
    etag: stringFileMetadata(entry.etag ?? entry.eTag),
    versionId: stringFileMetadata(entry.version_id ?? entry.versionId),
  };
}

function isAgentDirectoryMarkerEntry(entry: AgentFileEntry): boolean {
  const name = entry.name || entry.path.split("/").filter(Boolean).pop() || "";
  return name === AGENT_DIRECTORY_MARKER_NAME;
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
  const {
    getToken,
    isAuthenticated,
    isLoading: authLoading,
    flowState: authFlowState,
    isAuthenticationModalOpen,
    isIdentityAuthenticated,
    user,
    login,
    logout,
  } = useAgentAuth();
  const {
    avatarUrl: accountAvatarUrl,
    setAvatarUrl: setAccountAvatarUrl,
  } = useAccountProfileAvatar({
    enabled: isAuthenticated,
    getToken,
    userId: user?.id ?? null,
  });
  const {
    name: accountProfileName,
    setName: setAccountProfileName,
  } = useAccountProfileName({
    enabled: isAuthenticated,
    getToken,
    userId: user?.id ?? null,
  });
  useEffect(() => {
    markDashboardPerformance("page-mounted");
  }, []);
  useEffect(() => {
    if (authLoading) return;
    markDashboardPerformance("auth-ready");
    measureDashboardPerformance("page-to-auth", "page-mounted", "auth-ready");
  }, [authLoading]);
  const firstAgentSetupDraft = useFirstAgentSetupDraft();
  const runAgentMutation = useMemo(() => createAgentMutationQueue(), []);
  const {
    workspacesClient,
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceAgentIds,
    isAgentRosterLoading,
    agentRosterError,
    error: workspacesError,
    isLoading: workspacesLoading,
    assignAgentToCollection,
    selectWorkspace,
  } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedAgentId = searchParams.get("agentId")?.trim() || null;
  const requestedSessionRouteValue = searchParams.get("session")?.trim() || null;
  const requestedSessionKey = routableOpenClawSessionKey(requestedSessionRouteValue);
  const requestedLegacyMainSession = Boolean(requestedSessionRouteValue && !requestedSessionKey);
  const requestedIntegrationId = searchParams.get("integration")?.trim() || null;
  const requestedOpen = searchParams.get("open")?.trim() || null;
  const requestedIntent = searchParams.get("intent")?.trim().toLowerCase() || null;
  const requestedPlanId = searchParams.get("plan")?.trim() || null;
  const teamTrialIntentRequested = requestedIntent === "trial" && (!requestedPlanId || requestedPlanId.toLowerCase() === TEAM_TRIAL_PLAN_ID);
  const stripeCheckoutRecoveryRequested = searchParams.get("checkout") === "success" && Boolean(searchParams.get("session_id")?.trim());
  const requestedSection = searchParams.get("section")?.trim() || null;
  const requestedKnowledgeCollectionId = resolveKnowledgeCollectionId(searchParams);
  const requestedTab = searchParams.get("tab")?.trim() || null;
  const requestedView = searchParams.get("view")?.trim() || null;
  const dashboardView = isAuthenticated ? resolveDashboardView(requestedView) : null;
  const accountSettingsSection = resolveSettingsSectionId(searchParams.get("settings")) ?? "profile";
  const settingsAgentConfigurationActive = dashboardView === "settings" && (
    (accountSettingsSection === "agent" && Boolean(requestedAgentId)) || accountSettingsSection === "memory-index"
  );
  const requestedAgentTab = resolveAgentRouteTab(requestedTab);
  const requestedCenterTab: MainTab | null = requestedAgentTab === "openclaw" ? "chat" : requestedAgentTab;
  const knowledgeHubSectionActive = isAuthenticated && requestedSection === "knowledge-hub";
  const knowledgeSectionActive = isAuthenticated && requestedSection === "knowledge";
  const membersSectionActive = isAuthenticated && requestedSection === "members";
  const administrationSectionTab: Extract<MainTab, "knowledge-hub" | "knowledge" | "members"> | null = knowledgeHubSectionActive
    ? "knowledge-hub"
    : knowledgeSectionActive
      ? "knowledge"
      : membersSectionActive
        ? "members"
        : null;
  const slackOAuthOk = searchParams.get("slack_oauth_ok")?.trim() || null;
  const slackOAuthError = searchParams.get("slack_oauth_error")?.trim() || null;
  const slackOAuthResult = slackOAuthOk === "true" ? "success" : slackOAuthOk === "false" ? "failure" : null;
  const queryKey = searchParams.toString();
  const shouldOpenAgentLauncherFromQuery = requestedOpen ? AGENT_LAUNCHER_OPEN_VALUES.has(requestedOpen) : false;
  const shouldOpenAgentTourFromPageEntry = AGENT_DASHBOARD_TOUR_ENABLED && !isAuthenticated && !requestedOpen && !requestedAgentId && !requestedSessionKey &&
    !requestedIntegrationId && !requestedSection && !requestedTab && !requestedView &&
    !slackOAuthOk && !slackOAuthError && !firstAgentSetupDraft;
  const { setAgentMenu } = useDashboardMobileAgentMenu();
  const dashboardDisplayName = displayNameForDashboard(user);
  const suggestedJourneyUserName = dashboardDisplayName === "there" ? null : dashboardDisplayName;
  const chatGreetingName = accountProfileName;
  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const agentCreationDisabledReason = null;
  const agentCreationBlockedReason = null;
  const shouldOfferWorkspaceCreation = false;
  const journey = useJourney({ searchParams, searchKey: queryKey, storageScope: user?.email ?? null });
  const journeyChatCompletionRef = useRef<PendingJourneyChatCompletion | null>(null);
  const completeJourneyForEvent = journey.completeForEvent;
  const completeJourneyDay = journey.completeDay;
  const recordJourneyReceipt = journey.recordReceipt;
  const [agentWorkspaceActivated, setAgentWorkspaceActivated] = useState(() => !dashboardView || settingsAgentConfigurationActive);

  useEffect(() => {
    if (dashboardView && !settingsAgentConfigurationActive) return;
    const timeout = window.setTimeout(() => setAgentWorkspaceActivated(true), 0);
    return () => window.clearTimeout(timeout);
  }, [dashboardView, settingsAgentConfigurationActive]);

  useEffect(() => {
    if (!requestedView || dashboardView) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    const query = params.toString();
    router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
  }, [dashboardView, requestedView, router, searchParams]);

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    const params = new URLSearchParams(searchParams.toString());
    const privateParams = [
      "agentId",
      "session",
      "integration",
      "section",
      "settings",
      "tab",
      "view",
      "slack_oauth_ok",
      "slack_oauth_error",
    ];
    const changed = privateParams.some((key) => {
      if (!params.has(key)) return false;
      params.delete(key);
      return true;
    });
    if (!changed) return;
    const query = params.toString();
    router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
  }, [authLoading, isAuthenticated, router, searchParams]);

  // Agent data
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [agentAvatarOverrides, setAgentAvatarOverrides] = useState<Map<string, string | null>>(() => new Map());
  const [agentDataPrincipalId, setAgentDataPrincipalId] = useState<string | null>(null);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [planName, setPlanName] = useState<string | null>(null);
  const [subscriptionSummary, setSubscriptionSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [hasBillingHistory, setHasBillingHistory] = useState<boolean | null>(null);
  const [billingDataPrincipalId, setBillingDataPrincipalId] = useState<string | null>(null);
  const [billingDataError, setBillingDataError] = useState<string | null>(null);
  const [tokenUsageByAgent, setTokenUsageByAgent] = useState<Record<string, number> | null>(null);
  const [dailyTokenUsage, setDailyTokenUsage] = useState<number | null>(null);
  const [upgradeCatalogOpen, setUpgradeCatalogOpen] = useState(false);
  const [upgradeCatalogError, setUpgradeCatalogError] = useState<string | null>(null);
  const [upgradeCheckoutPlan, setUpgradeCheckoutPlan] = useState<UpgradeCheckoutPlan | null>(null);
  const [embeddedCheckoutPlan, setEmbeddedCheckoutPlan] = useState<UpgradeCheckoutPlan | null>(null);
  const [embeddedCheckoutProcessing, setEmbeddedCheckoutProcessing] = useState(false);
  const [paidFirstAgentCheckout, setPaidFirstAgentCheckout] = useState<PendingPlanCheckout | null>(null);
  const [checkoutReturnRecoveryActive, setCheckoutReturnRecoveryActive] = useState(stripeCheckoutRecoveryRequested);
  const [upgradeCatalogLoading, setUpgradeCatalogLoading] = useState(false);
  const [checkoutRecoveryDialogOpen, setCheckoutRecoveryDialogOpen] = useState(false);
  const [pendingAuthIntent, setPendingAuthIntent] = useState<AgentAuthIntent | null>(null);
  const [trialCheckoutPending, setTrialCheckoutPending] = useState(false);
  const [trialClock, setTrialClock] = useState(() => Date.now());
  const [trialSummaryObservedAt, setTrialSummaryObservedAt] = useState(() => Date.now());
  const [billingReflectionState, dispatchBillingReflection] = useReducer(
    billingReflectionReducer,
    initialBillingReflectionState,
  );
  const checkoutSync = useMemo(
    () => checkoutSyncBannerFromBillingState(billingReflectionState),
    [billingReflectionState],
  );
  const checkoutSyncPending = billingReflectionState.status === "syncing"
    || billingReflectionState.status === "pending"
    || billingReflectionState.status === "success"
    ? billingReflectionState.pending
    : null;
  const checkoutAuthRecoveryOpen = Boolean(
    isAuthenticated &&
    pendingAuthIntent?.kind === "checkout" &&
    billingDataError &&
    billingDataPrincipalId !== user?.id,
  );
  const checkoutRecoveryDialogVisible = checkoutRecoveryDialogOpen || checkoutAuthRecoveryOpen;
  const agentLauncherSuspended = upgradeCatalogOpen || Boolean(upgradeCheckoutPlan) || checkoutRecoveryDialogVisible;
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const deploymentsRef = useRef<Deployments | null>(null);
  const deploymentRefreshSchedulerRef = useRef<DeploymentRefreshScheduler | null>(null);
  const deploymentSubscriptionRecoveryRef = useRef(
    createDeploymentSubscriptionRecovery(),
  );
  useEffect(() => () => deploymentSubscriptionRecoveryRef.current.reset(), []);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsLoadError, setAgentsLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const launchLifecycleActionIdsRef = useRef<Set<string>>(new Set());
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);
  const [recentlyStoppedIds, setRecentlyStoppedIds] = useState<Set<string>>(new Set());
  const [pendingSlotReleases, setPendingSlotReleases] = useState<Record<string, number>>({});
  const stoppedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingSlotReleasesRef = useRef<PendingSlotReleaseMap>(new Map());
  const tokenUsageRefreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tokenUsageRefreshInFlightRef = useRef(false);
  const checkoutReturnHandledRef = useRef(false);
  const appliedTeamTrialIntentRef = useRef<string | null>(null);
  const trialClaimPrincipalRef = useRef<string | null>(null);
  const agentDataGenerationRef = useRef(0);
  const agentMutationVersionsRef = useRef<Map<string, number>>(new Map());
  const agentAvatarObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const deletingAgentIdsRef = useRef<Set<string>>(new Set());
  const cancelledStartAgentIdsRef = useRef<Set<string>>(new Set());
  const fetchAgentsRequestRef = useRef(0);
  const fetchBillingRequestRef = useRef(0);
  const fetchAgentsInFlightRef = useRef<{
    generation: number;
    principalId: string;
    promise: Promise<FetchAgentsResult | null>;
  } | null>(null);
  const fetchBillingInFlightRef = useRef<{
    generation: number;
    principalId: string;
    promise: Promise<FetchAgentsResult | null>;
  } | null>(null);
  const pageActiveRef = useRef(true);
  const privatePrincipalRef = useRef<string | null>(isAuthenticated ? user?.id ?? null : null);
  const appliedAgentSessionQueryRef = useRef<string | null>(null);
  const appliedIntegrationQueryRef = useRef<string | null>(null);
  const appliedOpenQueryRef = useRef<string | null>(null);
  const appliedAgentTourEntryRef = useRef(false);
  const focusScopedAgentSettingsRef = useRef(false);
  const scopedAgentSettingsRef = useRef<HTMLElement | null>(null);
  const focusAgentSettingsListRef = useRef(false);
  const settingsAgentFilterRef = useRef<HTMLInputElement | null>(null);
  const mobileSettingsMenuRef = useRef<HTMLElement | null>(null);
  const authenticationModalObservedRef = useRef(false);
  const authenticationLoginPendingRef = useRef(false);
  const embeddedCheckoutSelectionRequestRef = useRef(0);
  const paidFirstAgentCreationAttemptsRef = useRef<Set<string>>(new Set());
  const selectedAgentIdRef = useRef<string | null>(null);
  const endTemporaryChatBeforeSelectionRef = useRef<() => Promise<void>>(async () => undefined);
  const agentSelectionOperationRef = useRef(0);
  const sessionSelectionOperationRef = useRef(0);
  const chatAsyncOperationRef = useRef(0);
  const discardChatAudioRef = useRef<() => void>(() => undefined);
  const chatUploadsInFlightRef = useRef(0);
  const chatUploadGenerationRef = useRef(0);
  const chatUploadIdleWaitersRef = useRef<Set<() => void>>(new Set());
  const retireChatUploadsRef = useRef<() => void>(() => undefined);
  const handleChatFileDropRef = useRef<(files: ChatFileDropInput) => Promise<void>>(async () => undefined);
  const markAgentMutation = useCallback((agentId: string) => {
    agentMutationVersionsRef.current.set(
      agentId,
      (agentMutationVersionsRef.current.get(agentId) ?? 0) + 1,
    );
  }, []);
  const applyAgentMutationResult = useCallback((updatedAgent: SdkAgent) => {
    markAgentMutation(updatedAgent.id);
    setSdkAgents((current) => upsertAgentSnapshot(current, updatedAgent));
  }, [markAgentMutation]);
  const revokeAgentAvatarObjectUrl = useCallback((agentId: string) => {
    const objectUrl = agentAvatarObjectUrlsRef.current.get(agentId);
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    agentAvatarObjectUrlsRef.current.delete(agentId);
  }, []);
  const setAgentAvatarOverride = useCallback((agentId: string, avatarUrl: string | null, file?: File) => {
    markAgentMutation(agentId);
    revokeAgentAvatarObjectUrl(agentId);
    let displayUrl = avatarUrl;
    if (file) {
      displayUrl = URL.createObjectURL(file);
      agentAvatarObjectUrlsRef.current.set(agentId, displayUrl);
    }
    setAgentAvatarOverrides((current) => {
      const next = new Map(current);
      next.set(agentId, displayUrl);
      return next;
    });
  }, [markAgentMutation, revokeAgentAvatarObjectUrl]);
  const removeAgentAvatarOverride = useCallback((agentId: string) => {
    revokeAgentAvatarObjectUrl(agentId);
    setAgentAvatarOverrides((current) => {
      if (!current.has(agentId)) return current;
      const next = new Map(current);
      next.delete(agentId);
      return next;
    });
  }, [revokeAgentAvatarObjectUrl]);
  const clearAgentAvatarOverrides = useCallback(() => {
    for (const agentId of agentAvatarObjectUrlsRef.current.keys()) {
      revokeAgentAvatarObjectUrl(agentId);
    }
    setAgentAvatarOverrides(new Map());
  }, [revokeAgentAvatarObjectUrl]);
  const waitForChatUploads = useCallback((retireAfterMs: number | null = CHAT_UPLOAD_DRAIN_WAIT_MS): Promise<void> => {
    if (chatUploadsInFlightRef.current === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (timeout) clearTimeout(timeout);
        chatUploadIdleWaitersRef.current.delete(finish);
        resolve();
      };
      if (retireAfterMs !== null) {
        timeout = setTimeout(() => {
          retireChatUploadsRef.current();
          finish();
        }, retireAfterMs);
      }
      chatUploadIdleWaitersRef.current.add(finish);
    });
  }, []);

  useEffect(() => {
    pageActiveRef.current = true;
    return () => {
      pageActiveRef.current = false;
      stoppedTimersRef.current.forEach((t) => clearTimeout(t));
      tokenUsageRefreshTimersRef.current.forEach((t) => clearTimeout(t));
      tokenUsageRefreshTimersRef.current = [];
      for (const objectUrl of agentAvatarObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      agentAvatarObjectUrlsRef.current.clear();
    };
  }, []);

  const markAgentCleanupCooldown = useCallback((agentId: string) => {
    setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
    const existing = stoppedTimersRef.current.get(agentId);
    if (existing) clearTimeout(existing);
    stoppedTimersRef.current.set(agentId, setTimeout(() => {
      setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
      stoppedTimersRef.current.delete(agentId);
    }, AGENT_CLEANUP_CONFLICT_COOLDOWN_MS));
  }, []);

  const [tierSelection, setTierSelection] = useState<AgentTierSelectionState | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedKnowledgeCollection, setSelectedKnowledgeCollection] = useState<KnowledgeHubSelectedCollection | null>(null);
  const handleKnowledgeCollectionChange = useCallback((collection: KnowledgeHubSelectedCollection | null) => {
    setSelectedKnowledgeCollection((current) => (
      current?.id === collection?.id && current?.name === collection?.name ? current : collection
    ));
  }, []);
  const tokenUsage = selectedAgentId && tokenUsageByAgent
    ? tokenUsageByAgent[selectedAgentId] ?? 0
    : null;
  const tokenLimit = agentTokenLimit(subscriptionSummary, selectedAgentId);
  const dailyTokenLimit = subscriptionSummary
    ? Math.max(subscriptionSummary.entitlements?.pooledTpd ?? subscriptionSummary.pooledTpd ?? 0, 0)
    : null;
  const tokenUsageLoading = isAuthenticated && billingDataPrincipalId !== user?.id && !billingDataError;
  const [selectedSessionKeysByAgent, setSelectedSessionKeysByAgent] = useState<Record<string, string>>(() => (
    requestedAgentId && requestedSessionKey
      ? { [requestedAgentId]: requestedSessionKey }
      : {}
  ));
  const generatedSessionKeysByAgentRef = useRef<Record<string, string>>({});
  const sessionKeyForAgent = useCallback((agentId: string | null | undefined): string => {
    const sessionOwnerKey = agentId ?? "__no-agent__";
    const selected = agentId ? selectedSessionKeysByAgent[agentId] : null;
    if (selected) return selected;
    const existing = generatedSessionKeysByAgentRef.current[sessionOwnerKey];
    if (existing) return existing;
    const generated = createOpenClawDashboardSessionKey(Object.values({
      ...selectedSessionKeysByAgent,
      ...generatedSessionKeysByAgentRef.current,
    }));
    generatedSessionKeysByAgentRef.current[sessionOwnerKey] = generated;
    return generated;
  }, [selectedSessionKeysByAgent]);
  const { pinnedSessionKeys, setSessionPinned } = useOpenClawSessionPins(selectedAgentId);
  const mainTabBeforeAdministrationRef = useRef<MainTab>("chat");
  const appliedAgentRouteTabRef = useRef<AgentRouteTab | null>(null);
  const preserveMainTabOnRouteCleanupRef = useRef(false);
  const [mainTab, setMainTab] = useState<MainTab>(() => administrationSectionTab ?? requestedCenterTab ?? "chat");
  const selectMainTab = useCallback((tab: MainTab) => {
    if (tab !== "knowledge-hub") setSelectedKnowledgeCollection(null);
    if (tab === "knowledge-hub" || tab === "knowledge" || tab === "members") {
      setMainTab((current) => {
        if (current !== "knowledge-hub" && current !== "knowledge" && current !== "members") mainTabBeforeAdministrationRef.current = current;
        return tab;
      });
      return;
    }

    setMainTab(tab);
    if (!administrationSectionTab && !requestedAgentTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("section");
    params.delete("tab");
    const query = params.toString();
    preserveMainTabOnRouteCleanupRef.current = true;
    router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
  }, [administrationSectionTab, requestedAgentTab, router, searchParams]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (administrationSectionTab !== "knowledge-hub") setSelectedKnowledgeCollection(null);
      setMainTab((current) => {
        if (administrationSectionTab) {
          appliedAgentRouteTabRef.current = null;
          if (current !== "knowledge-hub" && current !== "knowledge" && current !== "members") mainTabBeforeAdministrationRef.current = current;
          return administrationSectionTab;
        }
        if (requestedAgentTab && requestedCenterTab) {
          appliedAgentRouteTabRef.current = requestedAgentTab;
          return requestedCenterTab;
        }
        if (preserveMainTabOnRouteCleanupRef.current) {
          preserveMainTabOnRouteCleanupRef.current = false;
          appliedAgentRouteTabRef.current = null;
          return current;
        }
        if (current === "knowledge-hub" || current === "knowledge" || current === "members") return mainTabBeforeAdministrationRef.current;
        if (appliedAgentRouteTabRef.current) {
          appliedAgentRouteTabRef.current = null;
          return "chat";
        }
        return current;
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [administrationSectionTab, requestedAgentTab, requestedCenterTab]);
  useEffect(() => {
    if (!requestedTab || requestedAgentTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const query = params.toString();
    router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
  }, [requestedAgentTab, requestedTab, router, searchParams]);
  const [scheduledInitialCommand, setScheduledInitialCommand] = useState<{ id: number; command: string } | null>(null);
  const scheduledInitialCommandIdRef = useRef(0);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const isDesktopViewport = useAgentDashboardDesktopViewport(() => setMobileNavigationOpen(false));
  const [mobileRosterCollapsed, setMobileRosterCollapsed] = useState(true);
  const [agentOnboardingOverlay, setAgentOnboardingOverlay] = useState<AgentOnboardingOverlay>(null);
  const [anonymousDesktopPreviewOpen, setAnonymousDesktopPreviewOpen] = useState(false);
  const [anonymousPreviewSelectionMade, setAnonymousPreviewSelectionMade] = useState(false);
  const anonymousAgentPreviewMode = !authLoading && !isAuthenticated;
  const agentTourOpen = AGENT_DASHBOARD_TOUR_ENABLED && anonymousAgentPreviewMode && agentOnboardingOverlay === "tour";
  const agentLauncherOpen = agentOnboardingOverlay === "launcher";
  const anonymousDesktopPreviewMode = anonymousAgentPreviewMode && anonymousDesktopPreviewOpen;
  const agentRosterTruthPending = authLoading || Boolean(
    isAuthenticated && (agentsLoading || workspacesLoading || isAgentRosterLoading),
  );
  const agentLauncherReturnHrefRef = useRef<string | null>(null);
  const setAgentTourOpen = useCallback((open: boolean) => {
    setAgentOnboardingOverlay((current) => open ? "tour" : current === "tour" ? null : current);
  }, []);
  const setAgentLauncherOpen = useCallback((open: boolean) => {
    setAgentOnboardingOverlay((current) => open ? "launcher" : current === "launcher" ? null : current);
  }, []);
  const closeAgentCreationFlow = useCallback(() => {
    agentLauncherReturnHrefRef.current = null;
    embeddedCheckoutSelectionRequestRef.current += 1;
    setEmbeddedCheckoutPlan(null);
    setEmbeddedCheckoutProcessing(false);
    setUpgradeCatalogLoading(false);
    setAgentLauncherOpen(false);
    window.setTimeout(() => mobileNavigationTriggerRef.current?.focus(), 0);
  }, [setAgentLauncherOpen]);
  const closeAgentCreationFlowAndReturn = useCallback(() => {
    const returnHref = agentLauncherReturnHrefRef.current;
    closeAgentCreationFlow();
    if (returnHref) router.replace(returnHref, { scroll: false });
  }, [closeAgentCreationFlow, router]);
  const [launcherPreferredPlanId, setLauncherPreferredPlanId] = useState<string | null>(requestedPlanId);
  const [launcherSelectedCatalogPlanId, setLauncherSelectedCatalogPlanId] = useState<string | null>(null);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationCloseRef = useRef<HTMLButtonElement>(null);
  const [workspaceCreationOpen, setWorkspaceCreationOpen] = useState(false);
  const [resumeAgentLauncher, setResumeAgentLauncher] = useState(false);
  const [agentLauncherGeneration, setAgentLauncherGeneration] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useAgentRosterCollapsed();
  const [anonymousPreviewRosterCollapsed, setAnonymousPreviewRosterCollapsed] = useState(true);
  const effectiveSidebarCollapsed = anonymousAgentPreviewMode
    ? anonymousPreviewRosterCollapsed
    : sidebarCollapsed;
  const setEffectiveSidebarCollapsed = anonymousAgentPreviewMode
    ? setAnonymousPreviewRosterCollapsed
    : setSidebarCollapsed;
  const rotateAnonymousAgentPreview = useEffectEvent(() => {
    const currentSection: AnonymousAgentPreviewSection = anonymousDesktopPreviewOpen
      ? "desktop"
      : mainTab === "files" || mainTab === "integrations" || mainTab === "skills" || mainTab === "scheduled"
        ? mainTab
        : "chat";
    const currentIndex = ANONYMOUS_AGENT_PREVIEW_SECTIONS.indexOf(currentSection);
    const nextSection = ANONYMOUS_AGENT_PREVIEW_SECTIONS[(currentIndex + 1) % ANONYMOUS_AGENT_PREVIEW_SECTIONS.length];
    setAnonymousDesktopPreviewOpen(nextSection === "desktop");
    if (nextSection !== "desktop") selectMainTab(nextSection);
    setMobileShowChat(true);
  });
  useEffect(() => {
    if (!anonymousAgentPreviewMode || anonymousPreviewSelectionMade || agentTourOpen || agentLauncherOpen || isAuthenticationModalOpen) return;
    const interval = window.setInterval(rotateAnonymousAgentPreview, ANONYMOUS_AGENT_PREVIEW_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [agentLauncherOpen, agentTourOpen, anonymousAgentPreviewMode, anonymousPreviewSelectionMade, isAuthenticationModalOpen]);
  const requestAuthentication = useCallback((intent: AgentAuthIntent) => {
    if (intent.kind === "launch" || intent.kind === "workspace" || intent.kind === "checkout" || intent.kind === "trial") {
      appliedAgentTourEntryRef.current = true;
    }
    authenticationLoginPendingRef.current = !isAuthenticationModalOpen;
    setPendingAuthIntent(intent);
  }, [isAuthenticationModalOpen]);
  useEffect(() => {
    if (
      !pendingAuthIntent
      || !authenticationLoginPendingRef.current
      || authLoading
      || isAuthenticated
      || isAuthenticationModalOpen
    ) return;
    authenticationLoginPendingRef.current = false;
    login();
  }, [authLoading, isAuthenticated, isAuthenticationModalOpen, login, pendingAuthIntent]);
  useEffect(() => {
    if (!pendingAuthIntent || isAuthenticated) {
      authenticationModalObservedRef.current = false;
      authenticationLoginPendingRef.current = false;
      return;
    }
    if (isAuthenticationModalOpen) {
      authenticationModalObservedRef.current = true;
      return;
    }
    if (!authenticationModalObservedRef.current) return;
    if (isIdentityAuthenticated && authFlowState !== "error") return;
    authenticationModalObservedRef.current = false;
    const timeout = window.setTimeout(() => setPendingAuthIntent(null), 0);
    return () => window.clearTimeout(timeout);
  }, [authFlowState, isAuthenticated, isAuthenticationModalOpen, isIdentityAuthenticated, pendingAuthIntent]);
  const showAgentCreationFlow = useCallback(() => {
    setMobileShowChat(true);
    setMobileNavigationOpen(false);
    setAgentLauncherOpen(true);
    return true;
  }, [setAgentLauncherOpen]);
  const openAgentCreationFlow = useCallback(() => {
    if (!isAuthenticated) {
      setMobileNavigationOpen(false);
      requestAuthentication({ kind: "launch" });
      return true;
    }
    if (shouldOfferWorkspaceCreation) {
      setWorkspaceCreationOpen(true);
      return true;
    }
    if (agentCreationBlockedReason) {
      setError(agentCreationBlockedReason);
      return false;
    }
    return showAgentCreationFlow();
  }, [agentCreationBlockedReason, isAuthenticated, requestAuthentication, shouldOfferWorkspaceCreation, showAgentCreationFlow]);
  const openWorkspaceCreationFlow = useCallback(() => {
    setMobileNavigationOpen(false);
    if (!isAuthenticated) {
      requestAuthentication({ kind: "workspace" });
      return;
    }
    setWorkspaceCreationOpen(true);
  }, [isAuthenticated, requestAuthentication]);
  const openAgentTourFlow = useCallback(() => {
    if (!AGENT_DASHBOARD_TOUR_ENABLED) return openAgentCreationFlow();
    if (isAuthenticated) return false;
    embeddedCheckoutSelectionRequestRef.current += 1;
    setEmbeddedCheckoutPlan(null);
    setEmbeddedCheckoutProcessing(false);
    setAnonymousDesktopPreviewOpen(false);
    setAnonymousPreviewSelectionMade(false);
    setMobileShowChat(false);
    setMobileNavigationOpen(false);
    setAgentTourOpen(true);
    return true;
  }, [isAuthenticated, openAgentCreationFlow, setAgentTourOpen]);
  const startAgentCreationFromTour = useCallback(() => {
    if (openAgentCreationFlow()) setAgentTourOpen(false);
  }, [openAgentCreationFlow, setAgentTourOpen]);
  const skipAgentTour = useCallback(() => {
    setAgentOnboardingOverlay(null);
    setMobileShowChat(true);
    setMobileNavigationOpen(false);
    if (!isAuthenticated) {
      setAnonymousPreviewRosterCollapsed(true);
      setMobileRosterCollapsed(true);
      setAnonymousDesktopPreviewOpen(false);
      setAnonymousPreviewSelectionMade(false);
      selectMainTab("chat");
    }
  }, [isAuthenticated, selectMainTab]);
  const createAccountFromTour = useCallback(() => {
    startAgentCreationFromTour();
  }, [startAgentCreationFromTour]);
  const launchAgentFromPreview = useCallback(() => {
    openAgentCreationFlow();
  }, [openAgentCreationFlow]);

  useLayoutEffect(() => {
    agentDataGenerationRef.current += 1;
    fetchAgentsRequestRef.current += 1;
    fetchBillingRequestRef.current += 1;
    fetchAgentsInFlightRef.current = null;
    fetchBillingInFlightRef.current = null;
    agentMutationVersionsRef.current.clear();
    deletingAgentIdsRef.current.clear();
    cancelledStartAgentIdsRef.current.clear();
    deploymentsRef.current = null;
    const nextPrincipal = isAuthenticated ? user?.id ?? null : null;
    deploymentSubscriptionRecoveryRef.current.reset();
    if (privatePrincipalRef.current === nextPrincipal) return;
    const previousPrincipal = privatePrincipalRef.current;
    privatePrincipalRef.current = nextPrincipal;
    setAnonymousDesktopPreviewOpen(false);
    setAnonymousPreviewSelectionMade(false);
    clearAgentAvatarOverrides();
    setSdkAgents([]);
    setAgentDataPrincipalId(null);
    setBudget(null);
    setPlanName(null);
    setSubscriptionSummary(null);
    setHasBillingHistory(null);
    setBillingDataPrincipalId(null);
    setBillingDataError(null);
    setTokenUsageByAgent(null);
    setDailyTokenUsage(null);
    setDeployments(null);
    setAgentsLoadError(null);
    setSelectedAgentId(null);
    setSelectedSessionKeysByAgent({});
    pendingSlotReleasesRef.current.clear();
    paidFirstAgentCreationAttemptsRef.current.clear();
    setPendingSlotReleases({});
    setDeletingId(null);
    setStartingId(null);
    setStoppingId(null);
    setArchivingId(null);
    setRestoringId(null);
    setOpeningDesktopId(null);
    setRecentlyStoppedIds(new Set());
    setTierSelection(null);
    setPendingAgentDelete(null);
    setUpgradeCheckoutPlan(null);
    setEmbeddedCheckoutPlan(null);
    setEmbeddedCheckoutProcessing(false);
    embeddedCheckoutSelectionRequestRef.current += 1;
    setUpgradeCatalogOpen(false);
    setUpgradeCatalogLoading(false);
    setWorkspaceCreationOpen(false);
    setAgentOnboardingOverlay(null);
    setCheckoutRecoveryDialogOpen(false);
    setTrialCheckoutPending(false);
    trialClaimPrincipalRef.current = null;
    setPaidFirstAgentCheckout(null);
    setResumeAgentLauncher(false);
    if (previousPrincipal || !nextPrincipal) setCheckoutReturnRecoveryActive(false);
    if (!nextPrincipal || (previousPrincipal && nextPrincipal)) setPendingAuthIntent(null);
    setAgentsLoading(true);
    checkoutReturnHandledRef.current = false;
    dispatchBillingReflection({ type: "DISMISS" });
  }, [clearAgentAvatarOverrides, isAuthenticated, user?.id]);

  useEffect(() => {
    if (!pendingAuthIntent || authLoading || !isAuthenticated) return;
    if (pendingAuthIntent.kind === "trial") return;
    if (pendingAuthIntent.kind === "launch" && (workspacesLoading || isAgentRosterLoading)) return;
    if (pendingAuthIntent.kind === "workspace" && workspacesLoading) return;
    if (
      pendingAuthIntent.kind === "checkout" &&
      (!user?.id || billingDataPrincipalId !== user.id)
    ) return;
    const timeout = window.setTimeout(() => {
      const intent = pendingAuthIntent;
      setCheckoutRecoveryDialogOpen(false);
      setPendingAuthIntent(null);
      if (intent.kind === "checkout") {
        if (intent.presentation === "embedded") {
          showAgentCreationFlow();
          setEmbeddedCheckoutPlan(intent.plan);
        } else {
          setUpgradeCheckoutPlan(intent.plan);
        }
      } else if (intent.kind === "launch") {
        if (shouldOfferWorkspaceCreation) {
          setWorkspaceCreationOpen(true);
          return;
        }
        if (agentCreationBlockedReason) {
          setError(agentCreationBlockedReason);
          return;
        }
        showAgentCreationFlow();
      } else if (intent.kind === "workspace") {
        if (workspacesError) {
          setError("Knowledge Hub could not be loaded. Refresh before creating a Collection.");
          return;
        }
        if (!workspacesClient) {
          setError("Collection access is unavailable right now.");
          return;
        }
        setWorkspaceCreationOpen(true);
      } else if (intent.kind === "navigate") {
        router.push(intent.href);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    agentCreationBlockedReason,
    authLoading,
    billingDataPrincipalId,
    isAgentRosterLoading,
    isAuthenticated,
    pendingAuthIntent,
    router,
    shouldOfferWorkspaceCreation,
    showAgentCreationFlow,
    user?.id,
    workspacesClient,
    workspacesError,
    workspacesLoading,
  ]);

  useLayoutEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  const replaceAgentChatRoute = useCallback((
    agentId: string | null,
    sessionKey?: string | null,
    clearRoutedPanel = false,
    pushRoute = false,
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    if (agentId) {
      params.set("agentId", agentId);
    } else {
      params.delete("agentId");
    }

    const normalizedSessionKey = routableOpenClawSessionKey(sessionKey);
    if (agentId && normalizedSessionKey) {
      params.set("session", normalizedSessionKey);
    } else {
      params.delete("session");
    }
    if (clearRoutedPanel) {
      params.delete("section");
      params.delete("collectionId");
      params.delete("domainId");
      params.delete("settings");
      params.delete("tab");
      params.delete("view");
    }
    syncDashboardSearchParams(params, pushRoute);
  }, [searchParams]);

  // Logs
  const logsControllerRef = useRef<AgentLogsControllerHandle | null>(null);
  const [logsStatus, setLogsStatus] = useState<ShellStatus>("disconnected");

  // Shell
  const shellControllerRef = useRef<AgentShellControllerHandle | null>(null);
  const [shellStatus, setShellStatus] = useState<ShellStatus>("disconnected");

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
  const [requestedSkillId, setRequestedSkillId] = useState<string | null>(null);

  // Hatching animation state tracking
  const prevStatesRef = useRef<Map<string, Pick<Agent, "state">>>(new Map());
  const [burstAgentId, setBurstAgentId] = useState<string | null>(null);

  // Settings panel state
  const [settingsName, setSettingsName] = useState("");
  const [agentSettingsSection, setAgentSettingsSection] = useState<AgentSettingsSection>("general");
  const [, setAgentClusterUnavailable] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [openclawSettingsOpen, setOpenclawSettingsOpen] = useState(false);
  const [chatDragActive, setChatDragActive] = useState(false);
  const chatDragDepthRef = useRef(0);

  useEffect(() => {
    if (requestedAgentTab !== "openclaw" || !selectedAgentId) return;
    const timeout = window.setTimeout(() => setOpenclawSettingsOpen(true), 0);
    return () => window.clearTimeout(timeout);
  }, [requestedAgentTab, selectedAgentId]);

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

  const clearScheduledTokenUsageRefreshes = useCallback(() => {
    tokenUsageRefreshTimersRef.current.forEach((timer) => clearTimeout(timer));
    tokenUsageRefreshTimersRef.current = [];
  }, []);

  const syncPendingSlotReleaseCounts = useCallback(() => {
    setPendingSlotReleases(countPendingSlotReleasesByTier(pendingSlotReleasesRef.current));
  }, []);

  const clearPendingSlotRelease = useCallback((releaseId: string) => {
    if (!pendingSlotReleasesRef.current.delete(releaseId)) return;
    syncPendingSlotReleaseCounts();
  }, [syncPendingSlotReleaseCounts]);

  const trackPendingSlotRelease = useCallback((releaseId: string, tier: string) => {
    registerPendingSlotRelease(pendingSlotReleasesRef.current, releaseId, tier);
    syncPendingSlotReleaseCounts();
  }, [syncPendingSlotReleaseCounts]);

  const completePendingSlotRelease = useCallback((releaseId: string) => {
    markPendingSlotReleaseComplete(
      pendingSlotReleasesRef.current,
      releaseId,
      fetchBillingRequestRef.current + 1,
    );
  }, []);

  const reconcilePendingSlotReleases = useCallback((snapshot: number) => {
    if (reconcileCompletedSlotReleases(pendingSlotReleasesRef.current, snapshot)) {
      syncPendingSlotReleaseCounts();
    }
  }, [syncPendingSlotReleaseCounts]);

  const refreshTokenUsage = useCallback(async () => {
    if (!isAuthenticated) return;
    if (tokenUsageRefreshInFlightRef.current) return;
    const generation = agentDataGenerationRef.current;
    tokenUsageRefreshInFlightRef.current = true;
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const usage = await hyperAgent.agentUsage(1);
      if (generation === agentDataGenerationRef.current) {
        setTokenUsageByAgent(agentTokenUsageMap(usage));
        setDailyTokenUsage(dailyTokenUsageTotal(usage));
      }
    } catch {
      // Keep the last displayed value on transient usage refresh failures.
    } finally {
      tokenUsageRefreshInFlightRef.current = false;
    }
  }, [getToken, isAuthenticated]);

  const refreshTokenUsageAfterChat = useCallback(() => {
    clearScheduledTokenUsageRefreshes();
    void refreshTokenUsage();
    tokenUsageRefreshTimersRef.current = TOKEN_USAGE_RECONCILE_DELAYS_MS.map((delay) => (
      setTimeout(() => {
        void refreshTokenUsage();
      }, delay)
    ));
  }, [clearScheduledTokenUsageRefreshes, refreshTokenUsage]);

  const refreshAgentEnrichment = useCallback((options?: {
    force?: boolean;
    token?: string;
  }): Promise<FetchAgentsResult | null> => {
    const principalId = user?.id ?? null;
    if (!isAuthenticated || !principalId) return Promise.resolve(null);
    const generation = agentDataGenerationRef.current;
    const inFlight = fetchBillingInFlightRef.current;
    if (!options?.force && inFlight?.generation === generation && inFlight.principalId === principalId) {
      return inFlight.promise;
    }
    const requestId = ++fetchBillingRequestRef.current;
    const isCurrentRequest = () => (
      generation === agentDataGenerationRef.current && requestId === fetchBillingRequestRef.current
    );
    const promise = (async () => {
      try {
        const token = options?.token ?? await getToken();
        if (!isCurrentRequest()) return null;
        const hyperAgent = createHyperAgentClient(token);
        markDashboardPerformance("enrichment-start");
        const [catalogData, currentPlan, summaryResult, billingHistoryResult, agentUsage, typeCatalogData] = await Promise.all([
          optionalDashboardData(hyperAgent.plans(), [] as HyperAgentPlan[]),
          optionalDashboardData(hyperAgent.currentPlan(), null),
          hyperAgent.subscriptionSummary().then(
            (value) => ({ status: "fulfilled" as const, value }),
            () => ({ status: "rejected" as const }),
          ),
          hyperAgent.billingHistory().then(
            (value) => ({ status: "fulfilled" as const, value }),
            () => ({ status: "rejected" as const }),
          ),
          optionalDashboardData(hyperAgent.agentUsage(1), null),
          optionalDashboardData(hyperAgent.agentTypes(), null),
        ]);
        if (!isCurrentRequest()) return null;
        const plans = Array.isArray(catalogData) ? catalogData : [];
        const normalizedCurrentPlan = currentPlan as HyperAgentCurrentPlan | null;
        const billingReady = summaryResult.status === "fulfilled";
        const rawSummary = billingReady ? summaryResult.value : null;
        const summary = isActiveNoSlotBillingMockEnabled()
          ? applyActiveNoSlotBillingMock(rawSummary, normalizedCurrentPlan, plans)
          : rawSummary;
        const typeCatalog = (typeCatalogData as HyperAgentTypeCatalog | null) || null;
        const nextBudget = buildBillingBudget(summary, normalizedCurrentPlan, typeCatalog);
        setBudget(nextBudget);
        if (billingReady) reconcilePendingSlotReleases(requestId);
        setCatalogPlans(plans);
        setPlanName(getEffectivePlanName(summary, normalizedCurrentPlan, plans));
        const summaryObservedAt = Date.now();
        setSubscriptionSummary(summary);
        setHasBillingHistory(
          billingHistoryResult.status === "fulfilled"
            ? billingHistoryResult.value.hasBillingHistory
            : null,
        );
        setTrialSummaryObservedAt(summaryObservedAt);
        setTrialClock(summaryObservedAt);
        setBillingDataPrincipalId(billingReady ? principalId : null);
        setBillingDataError(billingReady ? null : "Billing data could not be loaded. Retry before checkout.");
        setTokenUsageByAgent(agentTokenUsageMap(agentUsage));
        setDailyTokenUsage(dailyTokenUsageTotal(agentUsage));
        markDashboardPerformance("enrichment-ready");
        measureDashboardPerformance("enrichment", "enrichment-start", "enrichment-ready");
        return { subscriptionSummary: summary, budget: nextBudget, billingReady };
      } catch {
        if (!isCurrentRequest()) return null;
        setBillingDataPrincipalId(null);
        setBillingDataError("Billing data could not be loaded. Retry before checkout.");
        setHasBillingHistory(null);
        return null;
      }
    })();
    fetchBillingInFlightRef.current = { generation, principalId, promise };
    void promise.finally(() => {
      if (fetchBillingInFlightRef.current?.promise === promise) {
        fetchBillingInFlightRef.current = null;
      }
    });
    return promise;
  }, [getToken, isAuthenticated, reconcilePendingSlotReleases, user?.id]);

  const invalidateAgentCapacity = useCallback(() => {
    const scheduler = deploymentRefreshSchedulerRef.current;
    if (scheduler) {
      scheduler.invalidate(true);
      return;
    }
    void refreshAgentEnrichment({ force: true });
  }, [refreshAgentEnrichment]);

  const fetchAgents = useCallback((options?: {
    force?: boolean;
    includeEnrichment?: boolean;
  }): Promise<FetchAgentsResult | null> => {
    const principalId = user?.id ?? null;
    if (!isAuthenticated || !principalId) return Promise.resolve(null);
    const generation = agentDataGenerationRef.current;
    const mutationVersionsAtRequest = new Map(agentMutationVersionsRef.current);
    const inFlight = fetchAgentsInFlightRef.current;
    if (!options?.force && inFlight?.generation === generation && inFlight.principalId === principalId) {
      return inFlight.promise;
    }
    const requestId = ++fetchAgentsRequestRef.current;
    const isCurrentRequest = () => (
      generation === agentDataGenerationRef.current && requestId === fetchAgentsRequestRef.current
    );
    const promise = (async () => {
      try {
        markDashboardPerformance("deployments-start");
        const token = await getToken();
        if (!isCurrentRequest()) return null;
        const agentClient = deploymentsRef.current ?? createAgentClient(token);
        if (!deploymentsRef.current) {
          deploymentsRef.current = agentClient;
          setDeployments(agentClient);
        }
        const listedAgents = await agentClient.list();
        if (!isCurrentRequest()) return null;
        setAgentsLoadError(null);
        const listedAgentIds = new Set(listedAgents.map((listedAgent) => listedAgent.id));
        setSdkAgents((current) => mergeAgentListAfterMutations(
          current,
          listedAgents,
          mutationVersionsAtRequest,
          agentMutationVersionsRef.current,
          shouldReplaceAgentSnapshot,
        ));
        setAgentDataPrincipalId(principalId);
        setSelectedSessionKeysByAgent((current) => {
          let changed = false;
          const next: Record<string, string> = {};
          for (const [listedAgentId, sessionKey] of Object.entries(current)) {
            if (listedAgentIds.has(listedAgentId)) {
              next[listedAgentId] = sessionKey;
            } else {
              changed = true;
            }
          }
          return changed ? next : current;
        });
        setAgentClusterUnavailable(false);
        setAgentsLoading(false);
        markDashboardPerformance("deployments-ready");
        measureDashboardPerformance("deployments", "deployments-start", "deployments-ready");
        measureDashboardPerformance("auth-to-deployments", "auth-ready", "deployments-ready");

        if (options?.includeEnrichment === false) {
          return { subscriptionSummary: null, budget: null, billingReady: false };
        }
        return await refreshAgentEnrichment({ force: options?.force, token });
      } catch (err) {
        if (!isCurrentRequest()) return null;
        const described = describeAgentsPageError(err);
        setAgentsLoadError(described.message);
        setError(described.message);
        setAgentClusterUnavailable(described.clusterUnavailable);
        // Keep the last authoritative snapshot and the live subscription.
        // The event scheduler treats this null result as a failed
        // reconciliation and retries it with backoff. Clearing `deployments`
        // here would dispose that scheduler and permanently lose the edge.
        return null;
      } finally {
        if (isCurrentRequest()) setAgentsLoading(false);
      }
    })();
    fetchAgentsInFlightRef.current = { generation, principalId, promise };
    void promise.finally(() => {
      if (fetchAgentsInFlightRef.current?.promise === promise) {
        fetchAgentsInFlightRef.current = null;
      }
    });
    return promise;
  }, [getToken, isAuthenticated, refreshAgentEnrichment, user?.id]);

  const getAgentClient = useCallback(async () => {
    if (deployments) return deployments;
    return createAgentClient(await getToken());
  }, [deployments, getToken]);
  const getFreshShellDeployments = useCallback(async (signal: AbortSignal) => {
    const token = await getToken(signal);
    if (signal.aborted) throw signal.reason ?? new Error("Shell connection cancelled");
    return createAgentClient(token);
  }, [getToken]);

  useEffect(() => {
    if (!isAuthenticated || !deployments || !user?.id) return;
    const controller = new AbortController();
    const scheduler = createDeploymentRefreshScheduler(async (includeEnrichment) => {
      const inFlight = fetchAgentsInFlightRef.current?.promise;
      if (inFlight) await inFlight;
      const refreshed = await fetchAgents({
        includeEnrichment,
        force: includeEnrichment,
      });
      if (!refreshed && !controller.signal.aborted) {
        throw new Error("Deployment refresh failed");
      }
    });
    deploymentRefreshSchedulerRef.current = scheduler;
    const subscriptionRefresh = createDeploymentSubscriptionRefreshHandlers(
      scheduler,
      deploymentSubscriptionRecoveryRef.current,
      { includeEnrichmentOnReady: true, includeEnrichmentOnTransition: true },
    );
    const reconcileTransition = async (event: DeploymentEvent) => {
      try {
        await runAgentMutation(event.agent_id, async () => {
          if (controller.signal.aborted || deploymentsRef.current !== deployments) return;
          const exactAgent = await deployments.get(event.agent_id, { signal: controller.signal });
          if (controller.signal.aborted || deploymentsRef.current !== deployments) return;
          applyAgentMutationResult(exactAgent);
        });
      } catch {
        // The coalesced collection reconciliation below is the fallback when
        // an event-triggered exact read races deletion or transient I/O.
      } finally {
        // The exact read advances the per-Agent UI immediately. The coalesced
        // collection read remains the deletion/reconnect safety net and keeps
        // capacity enrichment synchronized.
        subscriptionRefresh.onTransition();
      }
    };
    void deployments.subscribe(reconcileTransition, {
      signal: controller.signal,
      onReady: subscriptionRefresh.onReady,
    }).catch(() => {
      if (controller.signal.aborted || deploymentsRef.current !== deployments) return;
      deploymentsRef.current = null;
      setDeployments(null);
      deploymentSubscriptionRecoveryRef.current.retryAfterFailure(() => {
        void fetchAgents({ force: true });
      });
    });
    return () => {
      if (deploymentRefreshSchedulerRef.current === scheduler) {
        deploymentRefreshSchedulerRef.current = null;
      }
      scheduler.dispose();
      controller.abort();
    };
  }, [applyAgentMutationResult, deployments, fetchAgents, isAuthenticated, runAgentMutation, user?.id]);

  const handleOpenDesktop = useCallback(async (agent: Agent) => {
    const desktopBaseUrl = agent.desktopUrl || (agent.hostname ? `https://desktop-${agent.hostname}` : "");
    if (!desktopBaseUrl) {
      setError("Desktop hostname is not ready.");
      return;
    }

    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningDesktopId(agent.id);
    setError(null);
    try {
      const tokenData = await (await getAgentClient()).refreshToken(agent.id) as AgentDesktopTokenResponse;
      const token = tokenData.token?.trim();
      if (!token) throw new Error("Desktop token was not returned.");
      const desktopUrl = buildBrowserDesktopUrl(desktopBaseUrl, token);
      if (popup) {
        popup.location.href = desktopUrl;
      } else {
        const fallback = window.open(desktopUrl, "_blank");
        if (fallback) fallback.opener = null;
      }
    } catch (err) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : "Failed to open desktop");
    } finally {
      setOpeningDesktopId(null);
    }
  }, [getAgentClient]);

  const refreshAgentsForChildren = useCallback(async () => {
    return Boolean(await fetchAgents({ force: true }));
  }, [fetchAgents]);

  const handleReflectedCheckout = useCallback((principalId: string, pending: PendingPlanCheckout | null) => {
    if (isFirstAgentSetupCheckout(pending)) {
      setPaidFirstAgentCheckout(pending);
      return;
    }
    clearPendingPlanCheckout(principalId, pending);
    setResumeAgentLauncher(true);
  }, []);

  const refreshCheckoutEntitlements = useCallback(async (targetPending?: PendingPlanCheckout | null) => {
    const principalId = user?.id ?? null;
    if (!principalId) return;
    const pending = targetPending ?? readPendingPlanCheckout(principalId);
    dispatchBillingReflection({
      type: "SYNC_STARTED",
      pending,
      message: `Refreshing ${pending?.planName ?? "your plan"} entitlements from billing...`,
    });
    let reflectionStatus = getCheckoutLaunchReflectionStatus(null, pending, null);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const refreshed = await refreshAgentEnrichment({ force: true });
      if (privatePrincipalRef.current !== principalId) return;
      reflectionStatus = getCheckoutLaunchReflectionStatus(
        refreshed?.subscriptionSummary ?? null,
        pending,
        refreshed?.budget ?? null,
      );
      if (reflectionStatus === "ready") break;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 2 ? 1500 : 3000));
        if (privatePrincipalRef.current !== principalId) return;
      }
    }

    if (reflectionStatus === "ready") {
      clearStripeCheckoutReturnState();
      handleReflectedCheckout(principalId, pending);
    }
    dispatchBillingReflection({
      type: "REFLECTION_RECEIVED",
      pending,
      reflectionStatus,
    });
  }, [handleReflectedCheckout, refreshAgentEnrichment, user?.id]);

  const openUpgradeCatalog = useCallback(async (preferredPlanId?: string) => {
    if (preferredPlanId === "free") {
      if (!isAuthenticated) {
        requestAuthentication({ kind: "launch" });
      } else {
        await fetchAgents({ force: true });
      }
      return;
    }
    if (upgradeCatalogLoading) return;

    setUpgradeCatalogOpen(true);
    setUpgradeCatalogError(null);
    if (catalogPlans.length > 0) {
      return;
    }

    setUpgradeCatalogLoading(true);
    try {
      const hyperAgent = isAuthenticated
        ? createHyperAgentClient(await getToken())
        : createPublicHyperAgentClient();
      const plans = await hyperAgent.plans();
      const visiblePlans = plans.filter(isVisibleCurrentAgentPlan);
      setCatalogPlans(visiblePlans);
      if (buildUpgradeProducts(visiblePlans).filter((product) => product.id !== "free" && product.price > 0).length === 0) {
        setUpgradeCatalogError("No paid plans are available right now.");
      }
    } catch (error) {
      setUpgradeCatalogError(error instanceof Error ? error.message : "Plan catalog is unavailable right now.");
    } finally {
      setUpgradeCatalogLoading(false);
    }
  }, [catalogPlans, fetchAgents, getToken, isAuthenticated, requestAuthentication, upgradeCatalogLoading]);

  useEffect(() => {
    if (authLoading) return;
    const generation = agentDataGenerationRef.current;
    const timeout = window.setTimeout(() => {
      if (isAuthenticated) {
        setAgentsLoading(true);
        void fetchAgents();
        return;
      }

      setSdkAgents([]);
      setAgentDataPrincipalId(null);
      clearScheduledTokenUsageRefreshes();
      tokenUsageRefreshInFlightRef.current = false;
      setBudget(null);
      setPlanName(null);
      setSubscriptionSummary(null);
      setBillingDataPrincipalId(null);
      setBillingDataError(null);
      setTokenUsageByAgent(null);
      setDailyTokenUsage(null);
      deploymentsRef.current = null;
      setDeployments(null);
      setAgentsLoadError(null);
      setSelectedAgentId(null);
      setAgentsLoading(true);
      setUpgradeCatalogError(null);
      void createPublicHyperAgentClient().plans()
        .then((plans) => {
          if (generation !== agentDataGenerationRef.current) return;
          setCatalogPlans(plans.filter(isVisibleCurrentAgentPlan));
        })
        .catch((catalogError) => {
          if (generation !== agentDataGenerationRef.current) return;
          setCatalogPlans([]);
          setUpgradeCatalogError(catalogError instanceof Error ? catalogError.message : "Plan catalog is unavailable right now.");
        })
        .finally(() => {
          if (generation === agentDataGenerationRef.current) setAgentsLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [authLoading, clearScheduledTokenUsageRefreshes, fetchAgents, isAuthenticated, user?.id]);

  useEffect(() => {
    if (!requestedIntegrationId || !INTEGRATION_QUERY_IDS.has(requestedIntegrationId)) {
      appliedIntegrationQueryRef.current = null;
      return;
    }
    if (!requestedAgentId) return;
    const integrationQueryKey = JSON.stringify([requestedAgentId, requestedIntegrationId]);
    if (appliedIntegrationQueryRef.current === integrationQueryKey) return;
    if (selectedAgentId !== requestedAgentId) return;

    appliedIntegrationQueryRef.current = integrationQueryKey;
    setDirectoryCategory("channels");
    setDirectoryItemId(requestedIntegrationId);
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    setMainTab("integrations");
    setMobileShowChat(true);
  }, [requestedAgentId, requestedIntegrationId, selectedAgentId]);

  useEffect(() => {
    if (!shouldOpenAgentLauncherFromQuery) {
      appliedOpenQueryRef.current = null;
      return;
    }
    if (appliedOpenQueryRef.current === requestedOpen) return;
    if (authLoading) return;
    if (isAuthenticated && (workspacesLoading || isAgentRosterLoading)) return;

    const timeout = window.setTimeout(() => {
      if (appliedOpenQueryRef.current === requestedOpen) return;
      appliedOpenQueryRef.current = requestedOpen;
      appliedAgentTourEntryRef.current = true;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("open");
      const query = params.toString();
      router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
      if (isAuthenticated) openAgentCreationFlow();
      else openAgentTourFlow();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    authLoading,
    isAgentRosterLoading,
    isAuthenticated,
    openAgentCreationFlow,
    openAgentTourFlow,
    requestedOpen,
    router,
    searchParams,
    shouldOpenAgentLauncherFromQuery,
    workspacesLoading,
  ]);

  useEffect(() => {
    if (!shouldOpenAgentTourFromPageEntry || appliedAgentTourEntryRef.current) return;
    if (authLoading) return;
    if (agentOnboardingOverlay || isAuthenticationModalOpen || pendingAuthIntent || workspaceCreationOpen) return;
    const timeout = window.setTimeout(() => {
      if (appliedAgentTourEntryRef.current) return;
      appliedAgentTourEntryRef.current = true;
      openAgentTourFlow();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    agentOnboardingOverlay,
    authLoading,
    isAuthenticationModalOpen,
    openAgentTourFlow,
    pendingAuthIntent,
    shouldOpenAgentTourFromPageEntry,
    workspaceCreationOpen,
  ]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (dashboardView === "settings" && accountSettingsSection === "plans") return;
    if (checkoutReturnHandledRef.current) return;
    const checkoutReturn = readStripeCheckoutReturnState();
    if (!checkoutReturn) return;
    const principalId = user?.id ?? null;
    if (!principalId) return;
    let pending = readPendingPlanCheckout(principalId, {
      sessionId: checkoutReturn.sessionId,
      attemptId: checkoutReturn.attemptId,
    });
    if (!pending) {
      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
      const timeout = window.setTimeout(() => setCheckoutReturnRecoveryActive(false), 0);
      return () => window.clearTimeout(timeout);
    }

    if (checkoutReturn.status === "cancelled") {
      checkoutReturnHandledRef.current = true;
      clearPendingPlanCheckout(principalId, pending);
      dispatchBillingReflection({ type: "CHECKOUT_CANCELLED" });
      clearStripeCheckoutReturnState();
      const timeout = window.setTimeout(() => setResumeAgentLauncher(true), 0);
      return () => window.clearTimeout(timeout);
    }

    if (billingDataPrincipalId !== principalId) {
      if (billingDataError) {
        dispatchBillingReflection({ type: "REFLECTION_RECEIVED", pending, reflectionStatus: "waiting-payment" });
      } else {
        dispatchBillingReflection({
          type: "SYNC_STARTED",
          pending,
          message: `Loading billing data for ${pending.planName}...`,
        });
      }
      return;
    }

    pending = markPendingPlanCheckoutReturned(
      principalId,
      checkoutReturn.sessionId ?? "",
      checkoutReturn.attemptId,
    );
    if (!pending) {
      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
      const timeout = window.setTimeout(() => setCheckoutReturnRecoveryActive(false), 0);
      return () => window.clearTimeout(timeout);
    }
    let active = true;
    const planLabel = pending?.planName ? `${pending.planName} plan` : "your plan";
    const trialCheckout = isTeamTrialCheckoutFlow(pending);
    dispatchBillingReflection({
      type: "SYNC_STARTED",
      pending,
      message: trialCheckout
        ? `Trial checkout complete. Activating the ${pending?.planName ?? "Team"} trial...`
        : `Payment received. Finalizing ${planLabel} setup...`,
    });

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    void (async () => {
      let reflectionStatus = getCheckoutLaunchReflectionStatus(null, pending, null);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const refreshed = await refreshAgentEnrichment({ force: true });
        if (!active) return;

        reflectionStatus = getCheckoutLaunchReflectionStatus(
          refreshed?.subscriptionSummary ?? null,
          pending,
          refreshed?.budget ?? null,
        );
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
        handleReflectedCheckout(principalId, pending);
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
  }, [accountSettingsSection, authLoading, billingDataError, billingDataPrincipalId, dashboardView, handleReflectedCheckout, isAuthenticated, refreshAgentEnrichment, user?.id]);

  useEffect(() => {
    const principalId = user?.id ?? null;
    if (
      authLoading ||
      !isAuthenticated ||
      (dashboardView === "settings" && accountSettingsSection === "plans") ||
      !principalId ||
      billingDataPrincipalId !== principalId ||
      readStripeCheckoutReturnState()
    ) return;
    const pending = readPendingPlanCheckout(principalId);
    if (!pending?.returnSessionId) return;
    const reflectionStatus = getCheckoutLaunchReflectionStatus(subscriptionSummary, pending, budget);
    if (reflectionStatus === "ready") {
      const timeout = window.setTimeout(() => handleReflectedCheckout(principalId, pending), 0);
      dispatchBillingReflection({ type: "REFLECTION_RECEIVED", pending, reflectionStatus });
      return () => window.clearTimeout(timeout);
    }
    dispatchBillingReflection({ type: "REFLECTION_RECEIVED", pending, reflectionStatus });
  }, [accountSettingsSection, authLoading, billingDataPrincipalId, budget, dashboardView, handleReflectedCheckout, isAuthenticated, subscriptionSummary, user?.id]);

  useEffect(() => {
    if (!resumeAgentLauncher || authLoading || !isAuthenticated || agentsLoading) return;
    const timeout = window.setTimeout(() => {
      showAgentCreationFlow();
      setCheckoutReturnRecoveryActive(false);
      setResumeAgentLauncher(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [agentsLoading, authLoading, isAuthenticated, resumeAgentLauncher, showAgentCreationFlow]);

  useEffect(() => {
    if (!checkoutSync || (checkoutSync.status !== "success" && checkoutSync.status !== "cancelled")) return;
    const timer = setTimeout(() => dispatchBillingReflection({ type: "DISMISS" }), 5000);
    return () => clearTimeout(timer);
  }, [checkoutSync]);

  const accountSdkAgents = useMemo(
    () => agentDataPrincipalId === user?.id ? sdkAgents : [],
    [agentDataPrincipalId, sdkAgents, user?.id],
  );
  const accountAgents = useMemo(
    () => accountSdkAgents.map((agent) => toAgentViewModel(
      agent,
      agentAvatarOverrides.has(agent.id) ? agentAvatarOverrides.get(agent.id) : undefined,
    )),
    [accountSdkAgents, agentAvatarOverrides],
  );
  const selectedWorkspaceAgentIdSet = useMemo(
    () => new Set(selectedWorkspaceAgentIds),
    [selectedWorkspaceAgentIds],
  );
  const workspaceAgents = useMemo(
    () => isAgentRosterLoading || agentRosterError
      ? []
      : accountAgents.filter((agent) => selectedWorkspaceAgentIdSet.has(agent.id)),
    [accountAgents, agentRosterError, isAgentRosterLoading, selectedWorkspaceAgentIdSet],
  );
  const agents = accountAgents;
  const updateAgentCanonicalName = useCallback(async (agentId: string, name: string) => {
    const generation = agentDataGenerationRef.current;
    const agent = sdkAgents.find((entry) => entry.id === agentId);
    if (!agent) throw new Error("Agent is unavailable.");
    const updatedAgent = await runAgentMutation(agentId, async () => {
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
      const token = await getToken();
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
      return persistAgentCanonicalName(createAgentClient(token), agent, name);
    });
    if (!updatedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
    applyAgentMutationResult(updatedAgent);
  }, [applyAgentMutationResult, getToken, runAgentMutation, sdkAgents]);
  const updateAgentDisplayName = useCallback(async (agentId: string, displayName: string) => {
    const generation = agentDataGenerationRef.current;
    const agent = sdkAgents.find((entry) => entry.id === agentId);
    if (!agent) throw new Error("Agent is unavailable.");
    const updatedAgent = await runAgentMutation(agentId, async () => {
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
      const token = await getToken();
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
      return persistAgentDisplayName(createAgentClient(token), agent, displayName);
    });
    if (!updatedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
    applyAgentMutationResult(updatedAgent);
  }, [applyAgentMutationResult, getToken, runAgentMutation, sdkAgents]);
  const agentRosterIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const { orderedAgentIds } = useAgentRosterOrder(agentRosterIds, selectedWorkspaceId);
  const orderedRosterAgents = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    return orderedAgentIds.map((agentId) => agentById.get(agentId)).filter((agent): agent is Agent => Boolean(agent));
  }, [agents, orderedAgentIds]);
  const upgradeProducts = useMemo(
    () => buildUpgradeProducts(catalogPlans).filter((product) => product.id !== "free" && product.price > 0),
    [catalogPlans],
  );
  const teamTrialProduct = useMemo(
    () => upgradeProducts.find((product) => product.id === TEAM_TRIAL_PLAN_ID) ?? null,
    [upgradeProducts],
  );
  const upgradeOwnedCounts = useMemo(
    () => Object.fromEntries(upgradeProducts.map((product) => [product.id, countOwnedProduct(subscriptionSummary, product)])),
    [subscriptionSummary, upgradeProducts],
  );
  const upgradeCheckoutOwnedCount = useMemo(
    () => countOwnedCheckoutPlan(subscriptionSummary, upgradeCheckoutPlan),
    [subscriptionSummary, upgradeCheckoutPlan],
  );
  const embeddedCheckoutOwnedCount = useMemo(
    () => countOwnedCheckoutPlan(subscriptionSummary, embeddedCheckoutPlan),
    [embeddedCheckoutPlan, subscriptionSummary],
  );
  const upgradeCheckoutBaselineGrantedSlots = useMemo(
    () => getGrantedLaunchSlotsByTier(subscriptionSummary),
    [subscriptionSummary],
  );
  const activeTrial = useMemo(
    () => getActiveAgentTrial(subscriptionSummary, trialClock, trialSummaryObservedAt),
    [subscriptionSummary, trialClock, trialSummaryObservedAt],
  );
  const canStartTeamTrial = !activeTrial;
  // Activation-code grant entitlements carry no subscription or payment history,
  // so the billing-history check alone would wrongly offer a trial to grant holders.
  const hasActivePlanAccess = subscriptionSummary ? hasActivePlan(subscriptionSummary) : false;

  useEffect(() => {
    if (
      authLoading ||
      !isAuthenticated ||
      !user?.id ||
      billingDataPrincipalId !== user.id ||
      hasBillingHistory !== false ||
      hasActivePlanAccess ||
      stripeCheckoutRecoveryRequested ||
      checkoutReturnRecoveryActive ||
      pendingAuthIntent ||
      trialCheckoutPending
    ) return;
    router.replace("/trial");
  }, [
    authLoading,
    billingDataPrincipalId,
    checkoutReturnRecoveryActive,
    hasActivePlanAccess,
    hasBillingHistory,
    isAuthenticated,
    pendingAuthIntent,
    router,
    stripeCheckoutRecoveryRequested,
    trialCheckoutPending,
    user?.id,
  ]);

  useEffect(() => {
    if (!activeTrial) return;
    const interval = window.setInterval(() => setTrialClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [activeTrial]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      trialClaimPrincipalRef.current = null;
      setTrialCheckoutPending(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const startTrial = useCallback(async (
    firstAgentSetup?: FirstAgentTrialCheckoutContext,
  ) => {
    const principalId = user?.id ?? null;
    if (!principalId || trialClaimPrincipalRef.current === principalId) return;
    if (activeTrial) {
      setError("Your trial is already active.");
      return;
    }
    trialClaimPrincipalRef.current = principalId;
    setTrialCheckoutPending(true);
    setError(null);

    try {
      const token = await getToken();
      if (!pageActiveRef.current || privatePrincipalRef.current !== principalId) return;
      clearTeamTrialIntentSearchParams();
      const checkoutAttemptId = createPlanCheckoutAttemptId();
      const { checkout, pending } = await createTeamTrialCheckoutState(
        { startTrial: (request) => requestTrialCheckout(token, request) },
        {
          successUrl: buildStripeCheckoutReturnUrl("success", checkoutAttemptId),
          cancelUrl: buildStripeCheckoutReturnUrl("cancelled", checkoutAttemptId),
        },
        {
          principalId,
          summary: subscriptionSummary,
          catalogProduct: teamTrialProduct,
          firstAgentSetup,
          checkoutAttemptId,
        },
      );
      if (!pageActiveRef.current || privatePrincipalRef.current !== principalId) return;
      writePendingPlanCheckout(pending);
      setLauncherPreferredPlanId(TEAM_TRIAL_PLAN_ID);
      setLauncherSelectedCatalogPlanId(TEAM_TRIAL_PLAN_ID);
      window.location.href = checkout.checkoutUrl;
    } catch (claimError) {
      if (!pageActiveRef.current || privatePrincipalRef.current !== principalId) return;
      trialClaimPrincipalRef.current = null;
      setTrialCheckoutPending(false);
      setError(trialClaimErrorMessage(claimError));
    }
  }, [activeTrial, getToken, subscriptionSummary, teamTrialProduct, user?.id]);

  const beginTeamTrial = useCallback((
    firstAgentSetup?: FirstAgentTrialCheckoutContext,
  ) => {
    if (trialCheckoutPending || activeTrial) return;
    setError(null);
    if (!isAuthenticated) {
      requestAuthentication({
        kind: "trial",
        ...(firstAgentSetup ? { firstAgentSetup } : {}),
      });
      return;
    }
    setPendingAuthIntent({
      kind: "trial",
      ...(firstAgentSetup ? { firstAgentSetup } : {}),
    });
  }, [activeTrial, isAuthenticated, requestAuthentication, trialCheckoutPending]);

  useEffect(() => {
    if (pendingAuthIntent?.kind !== "trial" || authLoading || !isAuthenticated || !user?.id) return;
    const timeout = window.setTimeout(() => {
      const intent = pendingAuthIntent;
      setPendingAuthIntent(null);
      if (activeTrial) {
        clearTeamTrialIntentSearchParams();
        setError("Your trial is already active.");
        return;
      }
      if (intent.firstAgentSetup) {
        const draftMatchesIntent = firstAgentSetupDraft?.setupId === intent.firstAgentSetup.setupId;
        const draftMatchesPrincipal = !firstAgentSetupDraft?.principalId
          || firstAgentSetupDraft.principalId === user.id;
        if (!draftMatchesIntent || !draftMatchesPrincipal) {
          clearTeamTrialIntentSearchParams();
          setError("This agent setup belongs to a different account. Start a fresh setup before starting the Team trial.");
          return;
        }
      }
      void startTrial(intent.firstAgentSetup);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeTrial, authLoading, firstAgentSetupDraft, isAuthenticated, pendingAuthIntent, startTrial, user?.id]);

  useEffect(() => {
    if (!teamTrialIntentRequested || stripeCheckoutRecoveryRequested) {
      appliedTeamTrialIntentRef.current = null;
      return;
    }
    const key = `${requestedIntent}:${requestedPlanId ?? TEAM_TRIAL_PLAN_ID}`;
    if (authLoading || appliedTeamTrialIntentRef.current === key) return;
    appliedTeamTrialIntentRef.current = key;
    beginTeamTrial();
  }, [authLoading, beginTeamTrial, requestedIntent, requestedPlanId, stripeCheckoutRecoveryRequested, teamTrialIntentRequested]);

  const beginEmbeddedTeamTrial = useCallback((product: UpgradeDisplayProduct) => {
    const agentSize = primaryLaunchTier(product.bundle);
    updateFirstAgentSetupDraftPlan(product.id, agentSize);
    setLauncherPreferredPlanId(product.id);
    setLauncherSelectedCatalogPlanId(product.id);
    setUpgradeCatalogError(null);

    const principalId = user?.id ?? null;
    const draftMatchesPrincipal = !firstAgentSetupDraft?.principalId
      || firstAgentSetupDraft.principalId === principalId;
    const draftMatchesWorkspace = !firstAgentSetupDraft?.workspaceId
      || firstAgentSetupDraft.workspaceId === selectedWorkspaceId;
    const setupWorkspaceId = firstAgentSetupDraft?.workspaceId ?? selectedWorkspaceId;
    const firstAgentSetup: FirstAgentTrialCheckoutContext | undefined = agentSize
      && firstAgentSetupDraft
      && draftMatchesPrincipal
      && draftMatchesWorkspace
      ? {
          setupId: firstAgentSetupDraft.setupId,
          ...(setupWorkspaceId ? { workspaceId: setupWorkspaceId } : {}),
          knowledgeCollectionId: firstAgentSetupDraft.knowledgeCollectionId,
          agentSize,
        }
      : undefined;
    beginTeamTrial(firstAgentSetup);
  }, [beginTeamTrial, firstAgentSetupDraft, selectedWorkspaceId, user?.id]);

  const embeddedFirstAgentSetup = (() => {
    if (!embeddedCheckoutPlan || !firstAgentSetupDraft || !user?.id) return undefined;
    const size = primaryLaunchTier(normalizeBundle(embeddedCheckoutPlan.bundle));
    if (!size) return undefined;
    if (firstAgentSetupDraft.principalId && firstAgentSetupDraft.principalId !== user.id) return undefined;
    if (firstAgentSetupDraft.workspaceId && firstAgentSetupDraft.workspaceId !== selectedWorkspaceId) return undefined;
    return {
      setupId: firstAgentSetupDraft.setupId,
      workspaceId: firstAgentSetupDraft.workspaceId ?? selectedWorkspaceId,
      knowledgeCollectionId: firstAgentSetupDraft.knowledgeCollectionId,
      size,
    };
  })();
  const selectUpgradeProduct = useCallback(async (product: UpgradeDisplayProduct) => {
    const generation = agentDataGenerationRef.current;
    const checkoutPlan = toUpgradeCheckoutPlan(product);
    setEmbeddedCheckoutPlan(null);
    setLauncherPreferredPlanId(product.id);
    setLauncherSelectedCatalogPlanId(product.id);
    updateFirstAgentSetupDraftPlan(product.id, primaryLaunchTier(product.bundle));
    setUpgradeCatalogOpen(false);
    if (!isAuthenticated) {
      requestAuthentication({ kind: "checkout", plan: checkoutPlan });
      return;
    }
    setUpgradeCatalogLoading(true);
    const refreshed = await fetchAgents({ force: true });
    if (generation !== agentDataGenerationRef.current) return;
    setUpgradeCatalogLoading(false);
    if (!refreshed?.billingReady) {
      setUpgradeCatalogError("Billing data could not be refreshed. Try again before checkout.");
      setUpgradeCatalogOpen(true);
      return;
    }
    setUpgradeCheckoutPlan(checkoutPlan);
  }, [fetchAgents, isAuthenticated, requestAuthentication]);

  const selectEmbeddedUpgradeProduct = useCallback(async (product: UpgradeDisplayProduct) => {
    const generation = agentDataGenerationRef.current;
    const selectionRequestId = embeddedCheckoutSelectionRequestRef.current + 1;
    embeddedCheckoutSelectionRequestRef.current = selectionRequestId;
    const checkoutPlan = toUpgradeCheckoutPlan(product);
    setUpgradeCheckoutPlan(null);
    setPaidFirstAgentCheckout(null);
    setEmbeddedCheckoutProcessing(false);
    setUpgradeCatalogError(null);
    setLauncherPreferredPlanId(product.id);
    setLauncherSelectedCatalogPlanId(product.id);
    updateFirstAgentSetupDraftPlan(product.id, primaryLaunchTier(product.bundle));
    if (!isAuthenticated) {
      requestAuthentication({ kind: "checkout", plan: checkoutPlan, presentation: "embedded" });
      return;
    }

    setUpgradeCatalogLoading(true);
    const refreshed = await fetchAgents({ force: true });
    if (
      generation !== agentDataGenerationRef.current ||
      selectionRequestId !== embeddedCheckoutSelectionRequestRef.current
    ) return;
    setUpgradeCatalogLoading(false);
    if (!refreshed?.billingReady) {
      setUpgradeCatalogError("Billing data could not be refreshed. Try again before checkout.");
      return;
    }
    setEmbeddedCheckoutPlan(checkoutPlan);
  }, [fetchAgents, isAuthenticated, requestAuthentication]);

  // Detect lifecycle completions for UI effects and released-slot enrichment.
  useEffect(() => {
    const prev = prevStatesRef.current;
    const cleanupFinished = didAnyAgentFinishCleanup(prev, agents);
    for (const agent of agents) {
      const prevState = prev.get(agent.id)?.state;
      if (prevState && isAgentTransitionalState(prevState) && agent.state === "RUNNING") {
        setBurstAgentId(agent.id);
      }
    }
    const next = new Map<string, Pick<Agent, "state">>();
    for (const agent of agents) next.set(agent.id, { state: agent.state });
    prevStatesRef.current = next;
    if (cleanupFinished) {
      void refreshAgentEnrichment({ force: true });
    }
  }, [agents, refreshAgentEnrichment]);

  const selectedSdkAgent = useMemo(
    () => (selectedAgentId
      ? sdkAgents.find((agent) => agent.id === selectedAgentId) ?? null
      : null),
    [sdkAgents, selectedAgentId],
  );
  const selectedAgent = useMemo(
    () => (selectedAgentId ? agents.find((agent) => agent.id === selectedAgentId) ?? null : null),
    [agents, selectedAgentId],
  );
  const filesSyncRoot = useMemo(() => {
    return launchConfigSyncRoot(selectedSdkAgent?.launchConfig);
  }, [selectedSdkAgent]);
  useEffect(() => {
    if (workspacesLoading || agentsLoading) return;

    const availableAgentIds = agents.map((agent) => agent.id);
    const availableAgentIdSet = new Set(availableAgentIds);
    const currentAgentId = selectedAgentIdRef.current;
    const nextAgentId = resolveWorkspaceAgentSelection(
      availableAgentIds,
      requestedAgentId,
      currentAgentId,
    );
    const agentRosterAuthoritative = agentDataPrincipalId === user?.id && !agentsLoadError;

    if (requestedAgentId && !availableAgentIdSet.has(requestedAgentId)) {
      if (!agentRosterAuthoritative) return;
      appliedAgentSessionQueryRef.current = null;
      const params = new URLSearchParams(searchParams.toString());
      if (dashboardView === "settings" && accountSettingsSection === "agent") params.delete("agentId");
      else if (nextAgentId) params.set("agentId", nextAgentId);
      else params.delete("agentId");
      params.delete("session");
      params.delete("integration");
      const query = params.toString();
      router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
      return;
    }

    const selectionQueryKey = requestedAgentId
      ? JSON.stringify([requestedAgentId, requestedSessionKey, requestedLegacyMainSession])
      : null;
    const applyRequestedSession = () => {
      if (!requestedAgentId) {
        appliedAgentSessionQueryRef.current = null;
        return;
      }
      appliedAgentSessionQueryRef.current = selectionQueryKey;
      if (requestedSessionKey) {
        setSelectedSessionKeysByAgent((current) => (
          current[requestedAgentId] === requestedSessionKey
            ? current
            : { ...current, [requestedAgentId]: requestedSessionKey }
        ));
      } else if (requestedLegacyMainSession) {
        setSelectedSessionKeysByAgent((current) => {
          if (!(requestedAgentId in current)) return current;
          const next = { ...current };
          delete next[requestedAgentId];
          return next;
        });
      }
      setMobileShowChat(true);
    };

    if (nextAgentId === currentAgentId) {
      if (appliedAgentSessionQueryRef.current !== selectionQueryKey) applyRequestedSession();
      return;
    }

    let cancelled = false;
    const selectionOperation = agentSelectionOperationRef.current + 1;
    agentSelectionOperationRef.current = selectionOperation;
    void (async () => {
      await endTemporaryChatBeforeSelectionRef.current();
      if (cancelled || agentSelectionOperationRef.current !== selectionOperation) return;
      setSelectedAgentId(nextAgentId);
      applyRequestedSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    agentRosterError,
    accountSettingsSection,
    agentDataPrincipalId,
    agents,
    agentsLoadError,
    agentsLoading,
    isAgentRosterLoading,
    requestedAgentId,
    requestedLegacyMainSession,
    requestedSessionKey,
    dashboardView,
    router,
    searchParams,
    selectedAgentId,
    user?.id,
    workspacesLoading,
  ]);
  const selectedOpenClawAgent = useMemo(
    () => (selectedSdkAgent
      && !isHermesAgentRuntime(selectedSdkAgent.runtime)
      && typeof (selectedSdkAgent as { connect?: unknown }).connect === "function"
      ? (selectedSdkAgent as SdkOpenClawAgent)
      : null),
    [selectedSdkAgent],
  );
  const selectedHermesAgent = useMemo(
    () => (selectedSdkAgent && isHermesAgentRuntime(selectedSdkAgent.runtime)
      ? (selectedSdkAgent as SdkHermesAgent)
      : null),
    [selectedSdkAgent],
  );
  const selectedAgentState = selectedAgent?.state ?? null;
  const isSelectedTransitioning = selectedAgent && isAgentTransitionalState(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";
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
      selectedAgent && isAgentStartable(selectedAgent)
        ? describeAgentTierStartGuidance(selectedAgent, budget)
        : null,
    [selectedAgent, budget],
  );
  const stoppedTabLabel: Record<CenterPanel, string> = {
    chat: "Chat",
    files: "Files",
    desktop: "Desktop",
    "knowledge-hub": "Knowledge Hub",
    knowledge: "Shared knowledge",
    members: "Members",
    integrations: "Integrations",
    skills: "Skills",
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
  const [shellIntentAgentId, setShellIntentAgentId] = useState<string | null>(null);
  const shellIntentAgentIdRef = useRef<string | null>(null);
  const shellIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelShellIntent = useCallback(() => {
    if (shellIntentTimerRef.current) {
      clearTimeout(shellIntentTimerRef.current);
      shellIntentTimerRef.current = null;
    }
    shellIntentAgentIdRef.current = null;
    setShellIntentAgentId(null);
  }, []);
  const prepareShell = useCallback(() => {
    if (
      selectedAgentId &&
      shellIntentAgentIdRef.current === selectedAgentId &&
      shellIntentTimerRef.current
    ) return;
    preloadAgentShellTerminalRuntime();
    if (selectedAgentId && selectedAgentState === "RUNNING") {
      shellIntentAgentIdRef.current = selectedAgentId;
      setShellIntentAgentId(selectedAgentId);
      if (shellIntentTimerRef.current) clearTimeout(shellIntentTimerRef.current);
      const intendedAgentId = selectedAgentId;
      shellIntentTimerRef.current = setTimeout(() => {
        shellIntentTimerRef.current = null;
        if (shellIntentAgentIdRef.current === intendedAgentId) shellIntentAgentIdRef.current = null;
        setShellIntentAgentId((current) => current === intendedAgentId ? null : current);
      }, SHELL_INTENT_TTL_MS);
    }
  }, [selectedAgentId, selectedAgentState]);
  useEffect(() => () => {
    if (shellIntentTimerRef.current) clearTimeout(shellIntentTimerRef.current);
  }, []);

  const shellEnabled = useAgentShellActivation({
    agentId: selectedAgentId,
    agentState: selectedAgentState,
    activeTab: mainTab,
    intent: shellIntentAgentId === selectedAgentId,
  });
  const selectedAgentPrimarySurface = agentPrimarySurface(selectedAgent?.runtime);

  useEffect(() => {
    if (
      selectedAgentPrimarySurface !== "shell" ||
      !selectedAgentId ||
      !isSelectedRunning ||
      mainTab !== "chat"
    ) return;

    const timeout = window.setTimeout(() => {
      prepareShell();
      setOpenclawSettingsOpen(false);
      setMainTab("shell");
      setMobileShowChat(true);

      const params = new URLSearchParams(searchParams.toString());
      params.set("agentId", selectedAgentId);
      params.set("tab", "shell");
      params.delete("session");
      router.replace(`/dashboard/agents?${params.toString()}`, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    isSelectedRunning,
    mainTab,
    prepareShell,
    router,
    searchParams,
    selectedAgentId,
    selectedAgentPrimarySurface,
  ]);

  const routedSelectedSessionKey = selectedAgentId && requestedAgentId === selectedAgentId
    ? requestedSessionKey
    : null;
  const selectedAgentHasExplicitSessionRoute = Boolean(
    selectedAgentId && requestedAgentId === selectedAgentId && requestedSessionRouteValue,
  );
  const storedSelectedSessionKey = selectedAgentId
    ? routableOpenClawSessionKey(selectedSessionKeysByAgent[selectedAgentId])
    : null;
  const selectedSessionRouteValue = selectedAgentId
    ? selectedAgentHasExplicitSessionRoute
      ? routedSelectedSessionKey
      : storedSelectedSessionKey
    : null;
  const gatewayEnabled = selectedAgentPrimarySurface === "chat" && isSelectedRunning && agentWorkspaceActivated;
  const openClawHydrationMode: OpenClawHydrationMode = !dashboardView &&
    mainTab === "chat" &&
    !openclawSettingsOpen
    ? "chat"
    : !dashboardView && (
    mainTab === "workspace" ||
    mainTab === "integrations" ||
    mainTab === "skills" ||
    mainTab === "scheduled" ||
    mainTab === "settings" ||
    mainTab === "openclaw" ||
    openclawSettingsOpen
    ) ? "full" : settingsAgentConfigurationActive ? "full" : "sessions";

  const openClawChat = useOpenClawSession(
    selectedAgent && isSelectedRunning ? selectedOpenClawAgent : null,
    gatewayEnabled,
    selectedSessionRouteValue,
    { hydrationMode: openClawHydrationMode },
  );
  const hermesChat = useHermesSession(
    selectedHermesAgent,
    Boolean(selectedHermesAgent && isSelectedRunning && gatewayEnabled),
    selectedSessionRouteValue,
  );
  const chat = selectedHermesAgent ? hermesChat : openClawChat;
  const userVisibleChatSessions = useMemo(
    () => chat.sessions.filter((session) => !isOpenClawMainSessionKey(session.key)),
    [chat.sessions],
  );
  const selectedSessionKey = selectedSessionRouteValue ?? chat.activeSessionKey;
  const canonicalSelectedSessionKey = routableOpenClawSessionKey(selectedSessionRouteValue ?? (
    chat.activeSessionSelectionResolved ? chat.activeSessionKey : null
  ));
  useEffect(() => {
    if (!selectedAgentId || !chat.activeSessionSelectionResolved) return;
    const resolvedSessionKey = routableOpenClawSessionKey(chat.activeSessionKey);
    if (!resolvedSessionKey) return;
    const timeout = window.setTimeout(() => {
      setSelectedSessionKeysByAgent((current) => (
        current[selectedAgentId] === resolvedSessionKey
          ? current
          : { ...current, [selectedAgentId]: resolvedSessionKey }
      ));
      if (requestedAgentId === selectedAgentId && !requestedSessionKey) {
        replaceAgentChatRoute(selectedAgentId, resolvedSessionKey);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [chat.activeSessionKey, chat.activeSessionSelectionResolved, replaceAgentChatRoute, requestedAgentId, requestedSessionKey, selectedAgentId]);
  const knowledgeSectionHref = useMemo(() => {
    const params = new URLSearchParams({ section: "knowledge" });
    if (selectedAgentId) {
      params.set("agentId", selectedAgentId);
      if (canonicalSelectedSessionKey) params.set("session", canonicalSelectedSessionKey);
    }
    return `/dashboard/agents?${params.toString()}`;
  }, [canonicalSelectedSessionKey, selectedAgentId]);
  const knowledgeHubSectionHref = useMemo(() => {
    return buildKnowledgeHubHref({
      agentId: selectedAgentId,
      session: selectedAgentId ? canonicalSelectedSessionKey : null,
    });
  }, [canonicalSelectedSessionKey, selectedAgentId]);
  const membersSectionHref = useMemo(() => {
    const params = new URLSearchParams({ section: "members" });
    if (selectedAgentId) {
      params.set("agentId", selectedAgentId);
      if (canonicalSelectedSessionKey) params.set("session", canonicalSelectedSessionKey);
    }
    return `/dashboard/agents?${params.toString()}`;
  }, [canonicalSelectedSessionKey, selectedAgentId]);
  const selectedAgentHref = useMemo(() => {
    if (!selectedAgentId) return "/dashboard/agents";
    const params = new URLSearchParams({ agentId: selectedAgentId });
    if (canonicalSelectedSessionKey) params.set("session", canonicalSelectedSessionKey);
    return `/dashboard/agents?${params.toString()}`;
  }, [canonicalSelectedSessionKey, selectedAgentId]);
  const dashboardViewHrefs = useMemo<Record<DashboardView, string>>(() => ({
    overview: buildDashboardViewHref("overview", {
      agentId: selectedAgentId,
      session: selectedAgentId ? canonicalSelectedSessionKey : null,
    }),
    usage: buildDashboardViewHref("usage", {
      agentId: selectedAgentId,
      session: selectedAgentId ? canonicalSelectedSessionKey : null,
    }),
    settings: buildDashboardViewHref("settings", {
      agentId: selectedAgentId,
      session: selectedAgentId ? canonicalSelectedSessionKey : null,
    }),
  }), [canonicalSelectedSessionKey, selectedAgentId]);
  const skillDraftScope = useMemo(() => ({ ownerId: user?.email ?? "local", agentId: selectedAgentId ?? "unknown-agent" }), [selectedAgentId, user?.email]);
  const activeSkillDraftTest = useSkillDraftTestSession(skillDraftScope, selectedSessionKey);
  const gatewayChat = asAgentGatewaySession(
    chat,
    isHermesAgentRuntime(selectedAgent?.runtime) ? "hermes" : "openclaw",
  );
  const activeChatTargetRef = useRef({ agentId: selectedAgentId, sessionKey: chat.activeSessionKey });
  useLayoutEffect(() => {
    activeChatTargetRef.current = { agentId: selectedAgentId, sessionKey: chat.activeSessionKey };
  }, [chat.activeSessionKey, selectedAgentId]);
  useLayoutEffect(() => {
    endTemporaryChatBeforeSelectionRef.current = async () => {
      discardChatAudioRef.current();
      chatAsyncOperationRef.current += 1;
      await waitForChatUploads();
      await chat.endTemporaryChat();
    };
  }, [chat.endTemporaryChat, waitForChatUploads]);
  useEffect(() => {
    if (!dashboardView) return;
    const timeout = window.setTimeout(() => {
      setMobileNavigationOpen(false);
      setOpenclawSettingsOpen(false);
      void endTemporaryChatBeforeSelectionRef.current();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [dashboardView]);
  const selectAgent = useCallback(async (
    agentId: string,
    clearRoutedPanel = false,
    pushRoute = false,
  ) => {
    const selectionOperation = agentSelectionOperationRef.current + 1;
    agentSelectionOperationRef.current = selectionOperation;
    if (agentId !== selectedAgentId) {
      await endTemporaryChatBeforeSelectionRef.current();
    }
    if (agentSelectionOperationRef.current !== selectionOperation) return;
    const sessionKey = selectedSessionKeysByAgent[agentId] ?? null;
    setSelectedAgentId(agentId);
    replaceAgentChatRoute(agentId, sessionKey, clearRoutedPanel, pushRoute);
  }, [replaceAgentChatRoute, selectedAgentId, selectedSessionKeysByAgent]);
  const selectAgentFromRoster = useCallback((agentId: string) => {
    if (embeddedCheckoutProcessing) {
      setError("Finish the current checkout before switching agents.");
      return;
    }
    closeAgentCreationFlow();
    const leavingRoutedSurface = Boolean(dashboardView || administrationSectionTab);
    void selectAgent(agentId, leavingRoutedSurface, leavingRoutedSurface);
  }, [administrationSectionTab, closeAgentCreationFlow, dashboardView, embeddedCheckoutProcessing, selectAgent]);
  const activeConnectionStatus = useMemo(() => {
    if (mainTab === "files") {
      return selectedAgentId ? "connected" as const : null;
    }
    if (!isSelectedRunning) return null;
    if (mainTab === "logs") return logsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "integrations" || mainTab === "skills" || mainTab === "scheduled" || mainTab === "settings") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, logsStatus, mainTab, selectedAgentId, shellStatus]);

  const listAgentFiles = useCallback(async (path?: string) => {
    if (!selectedAgentId) return [];
    const agentClient = await getAgentClient();
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const entries = await agentClient.filesList(selectedAgentId, normalizedPath);
    return (entries as AgentFileEntry[])
      .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
      .map(toDashboardFileEntry);
  }, [getAgentClient, selectedAgentId]);

  const refreshChatFileReferences = useCallback(async () => {
    if (mainTab !== "chat") return;
    if (!selectedAgentId || !chat.connected || selectedHermesAgent) {
      // Workspace file mentions read the OpenClaw workspace prefix; hermes
      // agents have no such directory, and probing it spams 404s.
      setChatFileReferenceCandidates([]);
      return;
    }
    const target = { agentId: selectedAgentId, sessionKey: chat.activeSessionKey };
    const entries = await listAgentFiles(OPENCLAW_WORKSPACE_PREFIX);
    if (
      activeChatTargetRef.current.agentId !== target.agentId ||
      activeChatTargetRef.current.sessionKey !== target.sessionKey
    ) return;
    setChatFileReferenceCandidates(entries.map(workspaceFileReferenceFromEntry).filter((file): file is ChatPendingFile => Boolean(file)));
  }, [chat.activeSessionKey, chat.connected, listAgentFiles, mainTab, selectedAgentId, selectedHermesAgent]);

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
    options?: AgentFilePreviewReadOptions,
  ) => {
    const agentId = selectedAgentId;
    if (!agentId) throw new Error("No agent selected");

    const normalizedFromPath = normalizeOpenClawWorkspaceFilePath(fromPath);
    const normalizedSafePath = normalizeOpenClawWorkspaceFilePath(safeCandidatePath);
    if (
      !normalizedFromPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`) ||
      !normalizedSafePath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)
    ) {
      throw new Error("Only workspace files can be renamed safely.");
    }

    const content = await agentClient.fileReadBytes(agentId, normalizedFromPath, options);
    options?.signal.throwIfAborted();
    await agentClient.fileWriteBytes(agentId, normalizedSafePath, content);
    try {
      await agentClient.fileDelete(agentId, normalizedFromPath);
    } catch {}
    return normalizedSafePath;
  }, [selectedAgentId]);

  const readAgentFileResult = useCallback(async (path: string): Promise<AgentFileReadRecoveryResult<string>> => {
    const agentId = selectedAgentId;
    const normalizedPath = normalizeAgentFilePath(path);
    if (!agentId) return { content: "", path: normalizedPath, renamed: false };

    const agentClient = await getAgentClient();
    const canUseWorkspaceRecovery = !normalizedPath.startsWith("/")
      || normalizedPath === OPENCLAW_WORKSPACE_DIR
      || normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_DIR}/`);
    if (!canUseWorkspaceRecovery) {
      const content = await agentClient.fileRead(agentId, normalizedPath);
      return { content, path: normalizedPath, renamed: false };
    }
    return readAgentFileWithRecovery({
      path: normalizedPath,
      read: (targetPath) => agentClient.fileRead(agentId, targetPath),
      rename: (fromPath, safeCandidatePath) => renameAgentFileToSafeName(agentClient, fromPath, safeCandidatePath),
    });
  }, [getAgentClient, renameAgentFileToSafeName, selectedAgentId]);

  const readAgentFile = useCallback(async (path: string) => {
    const result = await readAgentFileResult(path);
    return result.content;
  }, [readAgentFileResult]);

  const readAgentFileBytesResult = useCallback(async (
    path: string,
    options?: AgentFilePreviewReadOptions,
  ): Promise<AgentFileReadRecoveryResult<Uint8Array>> => {
    const agentId = selectedAgentId;
    const normalizedPath = normalizeAgentFilePath(path);
    if (!agentId) return { content: new Uint8Array(), path: normalizedPath, renamed: false };

    const agentClient = await getAgentClient();
    const canUseWorkspaceRecovery = !normalizedPath.startsWith("/")
      || normalizedPath === OPENCLAW_WORKSPACE_DIR
      || normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_DIR}/`);
    if (!canUseWorkspaceRecovery) {
      const result = await agentClient.fileReadBytesWithMetadata(agentId, normalizedPath, options);
      return { ...result, content: result.content, path: normalizedPath, renamed: false };
    }
    const recovered = await readAgentFileWithRecovery({
      path: normalizedPath,
      read: (targetPath) => agentClient.fileReadBytesWithMetadata(agentId, targetPath, options),
      rename: (fromPath, safeCandidatePath) => renameAgentFileToSafeName(agentClient, fromPath, safeCandidatePath, options),
      signal: options?.signal,
    });
    return {
      ...recovered,
      content: recovered.content.content,
      mimeType: recovered.content.mimeType,
    };
  }, [getAgentClient, renameAgentFileToSafeName, selectedAgentId]);

  const readAgentFileBytes = useCallback(async (path: string, options?: AgentFilePreviewReadOptions) => {
    const result = await readAgentFileBytesResult(path, options);
    return result.content;
  }, [readAgentFileBytesResult]);

  const agentSkills = useAgentSkills({
    enabled: mainTab === "integrations" || mainTab === "skills",
    connected: chat.connected,
    provider: selectedAgentId ? chat.skillsProvider : null,
  });

  const saveAgentFile = useCallback(async (path: string, content: string) => {
    if (!selectedAgentId) return;
    const agentClient = await getAgentClient();
    await agentClient.fileWrite(
      selectedAgentId,
      normalizeAgentFilePath(path),
      content,
    );
    await refreshChatFileReferences().catch(() => undefined);
  }, [getAgentClient, refreshChatFileReferences, selectedAgentId]);

  const uploadAgentFile = useCallback(async (path: string, content: Uint8Array) => {
    if (!selectedAgentId) return;
    const agentClient = await getAgentClient();
    await agentClient.fileWriteBytes(
      selectedAgentId,
      normalizeAgentFilePath(path),
      content,
    );
    await refreshChatFileReferences().catch(() => undefined);
  }, [getAgentClient, refreshChatFileReferences, selectedAgentId]);

  const createAgentDirectory = useCallback(async (path: string) => {
    if (!selectedAgentId) return;
    const normalizedPath = normalizeAgentFilePath(path);
    if (!normalizedPath) {
      throw new Error("Folder path is required.");
    }

    const agentClient = await getAgentClient();
    await agentClient.fileWriteBytes(
      selectedAgentId,
      `${normalizedPath}/${AGENT_DIRECTORY_MARKER_NAME}`,
      new Uint8Array(),
    );
  }, [getAgentClient, selectedAgentId]);

  const deleteAgentFile = useCallback(async (
    path: string,
    options?: { recursive?: boolean },
  ) => {
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
        detail: "Needs attention before it can run.",
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

    if (selectedAgent.state === "ARCHIVED") {
      return {
        label: "Archived",
        detail: "Restore the verified archive before starting the agent.",
        tone: "stopped",
      };
    }

    if (selectedAgent.state === "CREATING") {
      return {
        label: "Creating",
        detail: "Preparing persistent storage and admitting the runtime.",
        tone: "starting",
        loading: true,
      };
    }

    if (selectedAgent.state === "RESTORING") {
      return {
        label: "Restoring files",
        detail: "Restoring the agent home directory to stopped storage.",
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

    if (selectedAgent.state === "ARCHIVING") {
      return {
        label: "Archiving",
        detail: "Verifying the cold archive before releasing runtime resources.",
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
    return orderedRosterAgents.map((agent) => {
      const displayName = agentDisplayLabel(agent);
      return {
        id: agent.id,
        sessionKey: sessionKeyForAgent(agent.id),
        participants: [
          { id: "user", name: "You", type: "user" as const },
          {
            id: agent.id,
            name: displayName,
            type: "agent" as const,
            meta: agent.meta ?? null,
            avatarUrl: agentProfileImageUrl(agent),
          },
        ],
        kind: "user-agent" as const,
        title: displayName,
        lastMessage: agent.state === "RUNNING" ? "Connected" : agent.state.toLowerCase(),
        lastMessageBy: agent.id,
        lastMessageAt: agent.updated_at
          ? new Date(agent.updated_at).getTime()
          : agent.created_at
            ? new Date(agent.created_at).getTime()
            : 0,
        messageCount: agent.id === selectedAgentId ? chat.messages.length : 0,
        unreadCount: 0,
        isActive: agent.state === "RUNNING",
      };
    });
  }, [chat.messages.length, orderedRosterAgents, selectedAgentId, sessionKeyForAgent]);
  // Derive RecentToolCall[] by flattening toolCalls across assistant messages.
  // Newest last (matches the Activity tab order).
  const recentToolCallsForView = useMemo(() => {
    if (!SHOW_AGENT_INSPECTOR || chat.messages.length === 0) return null;
    const out: Array<{ id: string; name: string; args: string; result?: string; timestamp: number }> = [];
    chat.messages.forEach((msg) => {
      if (msg.role !== "assistant" || !msg.toolCalls) return;
      const ts = msg.timestamp ?? 0;
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
    if (userVisibleChatSessions.length === 0) return null;
    return userVisibleChatSessions.filter((session) => (
      !isOpenClawHeartbeatSessionKey(session.key)
    )).map((session) => {
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
  }, [userVisibleChatSessions]);

  const scheduledSessionOptions = useMemo(() => {
    const options: Array<{ key: string; label: string }> = [];
    const addSession = (key: string, label: string) => {
      const normalizedKey = key.trim();
      if (isOpenClawMainSessionKey(normalizedKey) || isOpenClawHeartbeatSessionKey(normalizedKey)) return;
      if (!normalizedKey || options.some((option) => sameOpenClawSelectableSessionKey(option.key, normalizedKey))) return;
      options.push({ key: normalizedKey, label: label.trim() || (normalizedKey === "main" ? "Main Session" : "Current Session") });
    };

    for (const session of userVisibleChatSessions) {
      addSession(session.key, displayOpenClawSessionName(session));
    }
    // Hermes sessions are server-assigned and absent until the first connect;
    // there is no "main" fallback to offer, so a null selection adds nothing.
    if (selectedSessionKey) {
      addSession(selectedSessionKey, selectedSessionKey === "main" ? "Main Session" : "Current Session");
    }
    return options;
  }, [selectedSessionKey, userVisibleChatSessions]);

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
        name: agentDisplayLabel(selectedAgent),
        state: selectedAgent.state,
        cpuMillicores: selectedAgent.cpu_millicores,
        memoryMib: selectedAgent.memory_mib,
        hostname: selectedAgent.hostname,
        startedAt: selectedAgent.started_at,
        updatedAt: selectedAgent.updated_at,
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

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);
  const chatScrollFrameRef = useRef<number | null>(null);
  const pendingChatScrollRef = useRef<{
    behavior: ScrollBehavior;
    onlyIfNearBottom: boolean;
  } | null>(null);
  const chatScrollTarget = `${selectedAgentId ?? ""}\0${chat.activeSessionKey}`;
  const previousChatScrollTargetRef = useRef(chatScrollTarget);

  const cancelScheduledChatScroll = useCallback(() => {
    if (chatScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
      chatScrollFrameRef.current = null;
    }
    pendingChatScrollRef.current = null;
  }, []);

  const scheduleChatScroll = useCallback((behavior: ScrollBehavior, onlyIfNearBottom = false) => {
    const pending = pendingChatScrollRef.current;
    pendingChatScrollRef.current = {
      behavior: pending?.behavior === "smooth" || behavior === "smooth" ? "smooth" : behavior,
      onlyIfNearBottom: (pending?.onlyIfNearBottom ?? true) && onlyIfNearBottom,
    };
    if (chatScrollFrameRef.current !== null) return;
    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      const request = pendingChatScrollRef.current;
      pendingChatScrollRef.current = null;
      if (!request || (request.onlyIfNearBottom && !isNearBottomRef.current)) return;
      const scrollElement = chatScrollRef.current;
      if (!scrollElement) return;
      scrollTranscriptToBottom(scrollElement, request.behavior);
    });
  }, []);

  const handleChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const handleTranscriptResize = useCallback((behavior: ScrollBehavior) => {
    scheduleChatScroll(behavior, true);
  }, [scheduleChatScroll]);

  const chatMessageCount = chat.messages.length;
  const latestChatMessage = chat.messages[chatMessageCount - 1];
  const latestChatMessageRole = latestChatMessage?.role;
  const latestChatMessageClientTurnId = latestChatMessage?.clientTurnId;
  useEffect(() => {
    const count = chatMessageCount;
    const previousCount = lastMsgCountRef.current;
    lastMsgCountRef.current = count;
    if (mainTab !== "chat" || count <= previousCount) return;

    const appendedLocalUserMessage = count === previousCount + 1 &&
      latestChatMessageRole === "user" &&
      Boolean(latestChatMessageClientTurnId);
    if (appendedLocalUserMessage) {
      isNearBottomRef.current = true;
      scheduleChatScroll("smooth");
    } else {
      scheduleChatScroll("auto", true);
    }
  }, [chatMessageCount, latestChatMessageClientTurnId, latestChatMessageRole, mainTab, scheduleChatScroll]);

  const prevSendingRef = useRef(chat.sending);
  useEffect(() => {
    if (prevSendingRef.current && !chat.sending) refreshTokenUsageAfterChat();
    prevSendingRef.current = chat.sending;
  }, [chat.sending, refreshTokenUsageAfterChat]);

  const prevActiveSessionSendingRef = useRef(chat.activeSessionSending);
  useEffect(() => {
    if (prevActiveSessionSendingRef.current && !chat.activeSessionSending) {
      scheduleChatScroll("auto", true);
    }
    prevActiveSessionSendingRef.current = chat.activeSessionSending;
  }, [chat.activeSessionSending, scheduleChatScroll]);

  useLayoutEffect(() => {
    if (mainTab !== "chat") return;
    const targetChanged = previousChatScrollTargetRef.current !== chatScrollTarget;
    previousChatScrollTargetRef.current = chatScrollTarget;
    if (targetChanged) {
      cancelScheduledChatScroll();
      isNearBottomRef.current = true;
      lastMsgCountRef.current = 0;
    }
    scheduleChatScroll("auto");
  }, [cancelScheduledChatScroll, chatScrollTarget, mainTab, scheduleChatScroll]);

  useEffect(() => cancelScheduledChatScroll, [cancelScheduledChatScroll]);

  // ── Actions ──

  const refreshExactAgentAfterLifecycleConflict = useCallback(async (
    agentId: string,
    token: string,
    generation: number,
    error: unknown,
    cancelled = false,
  ) => {
    if (!isAgentLifecycleStateConflictError(error) || cancelled) return;
    try {
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      const refreshedAgent = await createAgentClient(token).get(agentId);
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(refreshedAgent);
    } catch {
      // Keep the original lifecycle conflict as the user-visible error. A
      // failed reconciliation must not replace or hide the rejected action.
    }
  }, [applyAgentMutationResult]);

  const handleStart = async (agentId: string, authoritativeAgent?: SdkAgent | null) => {
    cancelledStartAgentIdsRef.current.delete(agentId);
    const sdkAgent = authoritativeAgent ?? sdkAgents.find((entry) => entry.id === agentId) ?? null;
    const agent = sdkAgent ? toAgentViewModel(sdkAgent) : null;
    if (!agent || !isAgentStartable(agent)) {
      setError(agent?.isLaunchable === false ? "This agent cannot be launched." : "The agent is not ready to start.");
      return;
    }
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
    const generation = agentDataGenerationRef.current;
    try {
      const acceptedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        try {
          return await requestAgentStart(token, agentId, (accepted) => {
            if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
              applyAgentMutationResult(accepted);
              invalidateAgentCapacity();
            }
          }, (observed) => {
            if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
              applyAgentMutationResult(observed);
            }
          });
        } catch (error) {
          await refreshExactAgentAfterLifecycleConflict(
            agentId,
            token,
            generation,
            error,
            cancelledStartAgentIdsRef.current.has(agentId),
          );
          throw error;
        }
      });
      if (!acceptedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      const startedAgent = await waitForAgentRunning(acceptedAgent);
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(startedAgent);
      invalidateAgentCapacity();
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      if (cancelledStartAgentIdsRef.current.has(agentId)) return;
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
      cancelledStartAgentIdsRef.current.delete(agentId);
      if (generation === agentDataGenerationRef.current) setStartingId(null);
    }
  };

  const generateOpenClawBootstrap = useCallback(async (
    name: OpenClawBootstrapFileName,
    inputs: OpenClawBootstrapInputs,
  ) => {
    const token = await getToken();
    const result = await createAgentClient(token).bootstrapInference(
      buildOpenClawBootstrapFileGenerationMessages(name, inputs),
      buildOpenClawBootstrapFileResponseFormat(name),
      { timeout: 330_000, retries: 0 },
    );
    if (result.finish_reason && result.finish_reason !== "stop") {
      throw new Error(`${name} generation did not finish (${result.finish_reason}).`);
    }
    return parseGeneratedOpenClawBootstrapFile(result.content, name);
  }, [getToken]);

  const handleCreateFirstAgent = useCallback(async ({
    name,
    handle = null,
    iconIndex,
    size,
    agentType = "openclaw",
    files,
    enableDesktop,
    enableMemoryIndex = false,
    customImage = null,
    knowledgeCollectionId,
  }: AgentCreationSetupCreateParams, onLaunchAccepted?: (accepted: SdkAgent) => void) => {
    if (!isAuthenticated) {
      requestAuthentication({ kind: "launch" });
      return null;
    }
    if (shouldOfferWorkspaceCreation) {
      setWorkspaceCreationOpen(true);
      return null;
    }
    const generation = agentDataGenerationRef.current;
    try {
      if (agentCreationBlockedReason) throw new Error(agentCreationBlockedReason);
      const knowledgeCollection = knowledgeCollectionId
        ? workspaces.find((workspace) => workspace.id === knowledgeCollectionId) ?? null
        : null;
      if (knowledgeCollectionId && !knowledgeCollection) {
        throw new Error("The selected Collection is no longer available.");
      }
      if (knowledgeCollection && knowledgeCollection.role !== "admin") {
        throw new Error("Collection admin access is required to assign this agent.");
      }
      setError(null);
      const token = await getToken();
      if (generation !== agentDataGenerationRef.current) return null;
      const created = agentType === "hermes"
        ? await createHermesAgentDeployment(token, {
          name: name || undefined,
          handle,
          size,
          meta: {
            ui: {
              avatar: { icon_index: iconIndex },
            },
          },
          ...buildHermesLaunchOptions({ customImage }),
        })
        : await createOpenClawAgent(token, {
          name: name || undefined,
          handle,
          size,
          meta: {
            ui: {
              avatar: { icon_index: iconIndex },
            },
          },
          ...buildOpenClawLaunchOptions({
            desktopEnabled: enableDesktop,
            customImage,
            skipBootstrap: files.length > 0,
            memoryIndex: enableMemoryIndex
              ? { onSessionStart: true, onSearch: true, watch: true, watchDebounceMs: 30000, intervalMinutes: 0 }
              : null,
          }),
        });
      if (generation !== agentDataGenerationRef.current) return null;
      if (created.id) {
        const agentClient = createAgentClient(token);
        const stoppedAgent = await waitForCreatedAgentStopped(agentClient, created);
        if (generation !== agentDataGenerationRef.current) return null;
        applyAgentMutationResult(stoppedAgent);
        if (knowledgeCollection) {
          try {
            await assignAgentToCollection(created.id, knowledgeCollection.id);
            if (generation !== agentDataGenerationRef.current) return null;
          } catch (assignmentError) {
            const detail = assignmentError instanceof Error
              ? assignmentError.message
              : "Collection access is unavailable right now.";
            throw new Error(`Agent was created, but Collection assignment did not complete: ${detail}`);
          }
        }
        const startCreatedAgent = async (agentId: string) => {
          const runningAgent = await startAgent(token, agentId, (accepted) => {
            if (generation === agentDataGenerationRef.current) {
              applyAgentMutationResult(accepted);
              invalidateAgentCapacity();
              onLaunchAccepted?.(accepted);
            }
          });
          if (generation === agentDataGenerationRef.current) applyAgentMutationResult(runningAgent);
        };
        cancelledStartAgentIdsRef.current.delete(created.id);
        // Starter files can only be written once the deployment's pod answers,
        // so staging runs alongside the start instead of gating it. Files that
        // never land are a warning, never a failed launch.
        let starterFileWarning: string | null = null;
        try {
          if (files.length > 0 && agentType !== "hermes") {
            const staged = await stageAgentStarterFilesAndStart({
              agentId: created.id,
              files,
              writeFileBytes: (agentId, path, content) => (
                agentClient.fileWriteBytes(agentId, path, content)
              ),
              startAgent: startCreatedAgent,
            });
            starterFileWarning = describeStarterFileFailures(staged.failures) || null;
          } else {
            await startCreatedAgent(created.id);
          }
        } catch (startError) {
          if (!cancelledStartAgentIdsRef.current.has(created.id)) throw startError;
        } finally {
          cancelledStartAgentIdsRef.current.delete(created.id);
        }
        if (generation !== agentDataGenerationRef.current) return null;
        const agentsRefreshed = await fetchAgents({ force: true });
        if (generation !== agentDataGenerationRef.current) return null;
        if (!agentsRefreshed) {
          throw new Error("Agent was created, but agents could not be refreshed.");
        }
        await selectAgent(created.id, true);
        if (generation !== agentDataGenerationRef.current) return null;
        setOpenclawSettingsOpen(false);
        setMainTab("chat");
        setMobileShowChat(true);
        completeJourneyForEvent("agent-created");
        if (starterFileWarning) setError(starterFileWarning);
        return created.id;
      }
      await fetchAgents({ force: true });
      if (generation !== agentDataGenerationRef.current) return null;
      setError("Agent was created, but no agent id was returned.");
      return null;
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return null;
      const message = err instanceof Error ? err.message : "Failed to create agent";
      if (!parseAgentCapacityError(err)) {
        setError(message);
      }
      throw err;
    }
  }, [
    agentCreationBlockedReason,
    applyAgentMutationResult,
    assignAgentToCollection,
    completeJourneyForEvent,
    fetchAgents,
    getToken,
    invalidateAgentCapacity,
    isAuthenticated,
    requestAuthentication,
    selectAgent,
    shouldOfferWorkspaceCreation,
    workspaces,
  ]);

  useEffect(() => {
    const pending = paidFirstAgentCheckout;
    const principalId = user?.id ?? null;
    if (!isFirstAgentSetupCheckout(pending) || !principalId || pending.principalId !== principalId) return;

    const timeout = window.setTimeout(() => {
      const draft = firstAgentSetupDraft;
      if (!draft || draft.setupId !== pending.setupId || (draft.principalId && draft.principalId !== principalId)) {
        clearPendingPlanCheckout(principalId, pending);
        setPaidFirstAgentCheckout(null);
        setCheckoutReturnRecoveryActive(false);
        setResumeAgentLauncher(true);
        return;
      }

      if (pending.workspaceId && selectedWorkspaceId !== pending.workspaceId) {
        const checkoutWorkspace = workspaces.find((workspace) => workspace.id === pending.workspaceId);
        if (checkoutWorkspace) {
          selectWorkspace(checkoutWorkspace.id, checkoutWorkspace);
        } else if (!workspacesLoading) {
          clearPendingPlanCheckout(principalId, pending);
          setPaidFirstAgentCheckout(null);
          setCheckoutReturnRecoveryActive(false);
          setError("The Collection used for this agent setup is no longer available. Choose a Collection to finish launching it.");
          setResumeAgentLauncher(true);
        }
        return;
      }

      if (
        authLoading ||
        agentsLoading ||
        workspacesLoading ||
        billingDataPrincipalId !== principalId ||
        agentCreationBlockedReason
      ) return;

      // Checkout recovery is correlated locally by the persisted draft name;
      // setup IDs are UI state and never cross the public Agent API boundary.
      const completedAgent = accountAgents.find((agent) => agent.name === draft.name);
      if (completedAgent) {
        clearPendingPlanCheckout(principalId, pending);
        clearFirstAgentSetupDraft();
        setPaidFirstAgentCheckout(null);
        setEmbeddedCheckoutPlan(null);
        setEmbeddedCheckoutProcessing(false);
        agentLauncherReturnHrefRef.current = null;
        setAgentLauncherOpen(false);
        void selectAgent(completedAgent.id, true).finally(() => setCheckoutReturnRecoveryActive(false));
        return;
      }

      if (Math.max(budget?.slots?.[pending.agentSize]?.available ?? 0, 0) <= 0) return;
      const attemptKey = `${pending.setupId}:${pending.returnSessionId ?? pending.startedAt}`;
      if (paidFirstAgentCreationAttemptsRef.current.has(attemptKey)) return;
      paidFirstAgentCreationAttemptsRef.current.add(attemptKey);

      const bootstrap = draft.bootstrapDraft ?? createOpenClawBootstrapDraft(draft.name);
      const draftAgentType = draft.agentType === "hermes" ? "hermes" : "openclaw";
      void handleCreateFirstAgent({
        name: draft.name,
        handle: draft.displayName ? managedAgentHandleFromDisplayName(draft.displayName) : null,
        iconIndex: draft.iconIndex,
        size: pending.agentSize,
        agentType: draftAgentType,
        files: draftAgentType === "hermes" ? [] : bootstrap.files.map((file) => new File([file.content], file.name, { type: "text/markdown" })),
        enableDesktop: draft.enableDesktop,
        enableMemoryIndex: draft.enableMemoryIndex,
        customImage: draft.enableCustomImage ? draft.customImage || null : null,
        knowledgeCollectionId: draft.knowledgeCollectionId,
        creationId: pending.setupId,
      }).then((createdId) => {
        if (privatePrincipalRef.current !== principalId) return;
        if (!createdId) {
          setPaidFirstAgentCheckout(null);
          setResumeAgentLauncher(true);
          return;
        }
        clearPendingPlanCheckout(principalId, pending);
        clearFirstAgentSetupDraft();
        setPaidFirstAgentCheckout(null);
        setEmbeddedCheckoutPlan(null);
        setEmbeddedCheckoutProcessing(false);
        agentLauncherReturnHrefRef.current = null;
        setAgentLauncherOpen(false);
        setCheckoutReturnRecoveryActive(false);
      }).catch(() => {
        if (privatePrincipalRef.current !== principalId) return;
        setPaidFirstAgentCheckout(null);
        setResumeAgentLauncher(true);
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [
    accountSdkAgents,
    agentCreationBlockedReason,
    agentsLoading,
    authLoading,
    billingDataPrincipalId,
    budget?.slots,
    firstAgentSetupDraft,
    handleCreateFirstAgent,
    paidFirstAgentCheckout,
    selectAgent,
    selectedWorkspaceId,
    selectWorkspace,
    setAgentLauncherOpen,
    user?.id,
    workspaces,
    workspacesLoading,
  ]);

  const handleResizeAndStart = useCallback(async (agentId: string, tier: string) => {
    cancelledStartAgentIdsRef.current.delete(agentId);
    const generation = agentDataGenerationRef.current;
    setStartingId(agentId);
    setError(null);
    setTierSelection(null);
    try {
      const acceptedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const agentClient = createAgentClient(token);
        const currentSdkAgent = await agentClient.get(agentId);
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        applyAgentMutationResult(currentSdkAgent);
        const currentAgent = toAgentViewModel(currentSdkAgent);
        if (!isAgentStartable(currentAgent)) {
          throw new Error(currentAgent.isLaunchable === false ? "This agent cannot be launched." : "The agent is not ready to start.");
        }
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const resizedAgent = await agentClient.resize(agentId, { size: tier });
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        applyAgentMutationResult(resizedAgent);
        try {
          return await requestAgentStart(token, agentId, (accepted) => {
            if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
              applyAgentMutationResult(accepted);
              invalidateAgentCapacity();
            }
          }, (observed) => {
            if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
              applyAgentMutationResult(observed);
            }
          });
        } catch (error) {
          await refreshExactAgentAfterLifecycleConflict(
            agentId,
            token,
            generation,
            error,
            cancelledStartAgentIdsRef.current.has(agentId),
          );
          throw error;
        }
      });
      if (!acceptedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      const startedAgent = await waitForAgentRunning(acceptedAgent);
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(startedAgent);
      invalidateAgentCapacity();
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      if (cancelledStartAgentIdsRef.current.has(agentId)) return;
      if (isAgentCleanupConflictError(err)) {
        markAgentCleanupCooldown(agentId);
        setError(AGENT_CLEANUP_START_MESSAGE);
      } else {
        setError(err instanceof Error ? err.message : "Failed to resize and start agent");
      }
    } finally {
      cancelledStartAgentIdsRef.current.delete(agentId);
      if (generation === agentDataGenerationRef.current) setStartingId(null);
    }
  }, [applyAgentMutationResult, getToken, invalidateAgentCapacity, markAgentCleanupCooldown, refreshExactAgentAfterLifecycleConflict, runAgentMutation]);

  const selectedAgentHasTierOptions = Boolean(selectedAgentStartGuidance?.availableTiers?.length);
  const selectedAgentRecentlyStopped = Boolean(selectedAgent && recentlyStoppedIds.has(selectedAgent.id));
  const selectedAgentTierLaunchBlocked = Boolean(selectedAgentStartGuidance && !selectedAgentHasTierOptions);
  const selectedAgentNotLaunchable = selectedAgent?.isLaunchable === false;
  const selectedAgentLaunchBlocked = selectedAgentTierLaunchBlocked || selectedAgentRecentlyStopped || selectedAgentNotLaunchable;
  const selectedAgentStartBlockedTitle = selectedAgentNotLaunchable
    ? "This agent cannot be launched"
    : selectedAgentRecentlyStopped
    ? "Agent is finishing shutdown"
    : selectedAgentStartGuidance?.title;
  const selectedAgentStartBlockedMessage = selectedAgentNotLaunchable
    ? "Lifecycle controls are unavailable for this agent."
    : selectedAgentRecentlyStopped
    ? "Wait a few seconds before starting this agent again."
    : selectedAgentStartGuidance?.message;
  const selectedAgentStarting = Boolean(selectedAgent && startingId === selectedAgent.id);
  const selectedAgentLaunchLifecycleAction = resolveAgentLaunchLifecycleAction(selectedAgent);
  const workspaceSidebarDisabled = agentsLoading && !anonymousAgentPreviewMode;
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
    const sdkAgent = sdkAgents.find((entry) => entry.id === agentId) ?? null;
    const agent = sdkAgent ? toAgentViewModel(sdkAgent) : null;
    if (!agent || !isAgentStoppable(agent)) {
      setError("The agent is not ready to stop.");
      return;
    }
    const cancellingStart = agent.state === "CREATING" || agent.state === "STARTING";
    if (cancellingStart) cancelledStartAgentIdsRef.current.add(agentId);
    const generation = agentDataGenerationRef.current;
    setStoppingId(agentId);
    setError(null);
    try {
      if (agentId === selectedAgentId) {
        await endTemporaryChatBeforeSelectionRef.current();
        if (generation !== agentDataGenerationRef.current) return;
      }
      const stoppedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        return stopAgent(token, agentId, (accepted) => {
          if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
            applyAgentMutationResult(accepted);
          }
        });
      });
      if (!stoppedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(stoppedAgent);
      invalidateAgentCapacity();
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      if (cancellingStart) cancelledStartAgentIdsRef.current.delete(agentId);
      setError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      if (generation === agentDataGenerationRef.current) setStoppingId(null);
    }
  };

  const handleArchive = async (agentId: string) => {
    const sdkAgent = sdkAgents.find((entry) => entry.id === agentId) ?? null;
    if (sdkAgent?.state.toUpperCase() !== "STOPPED") {
      setError("Stop the agent before archiving it.");
      return;
    }
    const generation = agentDataGenerationRef.current;
    setArchivingId(agentId);
    setError(null);
    try {
      const archivedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        return archiveAgent(token, agentId, (accepted) => {
          if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
            applyAgentMutationResult(accepted);
          }
        });
      });
      if (!archivedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(archivedAgent);
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to archive agent");
    } finally {
      if (generation === agentDataGenerationRef.current) setArchivingId(null);
    }
  };

  const handleRestore = async (agentId: string, authoritativeAgent?: SdkAgent | null) => {
    const sdkAgent = authoritativeAgent ?? sdkAgents.find((entry) => entry.id === agentId) ?? null;
    if (sdkAgent?.state.toUpperCase() !== "ARCHIVED") {
      setError("Only an archived agent can be restored.");
      return;
    }
    const generation = agentDataGenerationRef.current;
    setRestoringId(agentId);
    setError(null);
    try {
      const restoredAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        try {
          return await restoreAgent(token, agentId, (accepted) => {
            if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
              applyAgentMutationResult(accepted);
            }
          });
        } catch (error) {
          await refreshExactAgentAfterLifecycleConflict(agentId, token, generation, error);
          throw error;
        }
      });
      if (!restoredAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(restoredAgent);
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to restore agent");
    } finally {
      if (generation === agentDataGenerationRef.current) setRestoringId(null);
    }
  };

  const handleLaunchLifecycleAction = async (agentId: string) => {
    if (launchLifecycleActionIdsRef.current.has(agentId)) return;
    launchLifecycleActionIdsRef.current.add(agentId);
    const generation = agentDataGenerationRef.current;
    try {
      const token = await getToken();
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      const authoritativeAgent = await createAgentClient(token).get(agentId);
      if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(authoritativeAgent);
      const action = resolveAgentLaunchLifecycleAction(toAgentViewModel(authoritativeAgent));
      if (action === "restore") {
        await handleRestore(agentId, authoritativeAgent);
      } else if (action === "start") {
        await handleStart(agentId, authoritativeAgent);
      } else {
        setError(authoritativeAgent.isLaunchable === false
          ? "This agent cannot be launched."
          : `Agent is ${authoritativeAgent.state.toLowerCase()} and cannot be launched.`);
      }
    } catch (err) {
      if (generation === agentDataGenerationRef.current) {
        setError(err instanceof Error ? err.message : "Failed to resolve the agent lifecycle action");
      }
    } finally {
      launchLifecycleActionIdsRef.current.delete(agentId);
    }
  };

  const handleDelete = async (agentId: string) => {
    const generation = agentDataGenerationRef.current;
    const agentToDelete = agents.find((agent) => agent.id === agentId) ?? null;
    if (!agentToDelete || !isAgentDeletable(agentToDelete)) {
      setError("Stop the agent and wait for cleanup to finish before deleting it.");
      return;
    }
    const releaseTier = agentToDelete ? inferAgentTier(agentToDelete, budget) : null;
    const releaseBaseline = releaseTier ? budget?.slots?.[releaseTier] : null;
    const releaseId = releaseTier && releaseBaseline && Math.max(releaseBaseline.used ?? 0, 0) > 0
      ? `${agentId}:${releaseTier}`
      : null;
    deletingAgentIdsRef.current.add(agentId);
    setDeletingId(agentId);
    setError(null);
    try {
      if (agentId === selectedAgentId) {
        await endTemporaryChatBeforeSelectionRef.current();
        if (generation !== agentDataGenerationRef.current) return;
      }
      if (releaseId && releaseTier && releaseBaseline) {
        trackPendingSlotRelease(releaseId, releaseTier);
      }
      const deleted = await runAgentMutation(agentId, async () => {
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current) return false;
        await deleteStoppedAgent(token, agentId);
        return true;
      });
      if (!deleted || generation !== agentDataGenerationRef.current) {
        if (releaseId) clearPendingSlotRelease(releaseId);
        return;
      }
      if (releaseId) completePendingSlotRelease(releaseId);
      fetchAgentsRequestRef.current += 1;
      agentMutationVersionsRef.current.delete(agentId);
      clearOpenClawSessionPins(agentId);
      const nextAgents = removeSdkAgent(sdkAgents, agentId);
      setSdkAgents((current) => removeSdkAgent(current, agentId));
      removeAgentAvatarOverride(agentId);
      setSelectedSessionKeysByAgent((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, agentId)) return current;
        const next = { ...current };
        delete next[agentId];
        return next;
      });
      // Deleting the selected agent returns to the agents overview rather
      // than silently jumping into a different agent's workspace.
      const nextSelectedAgentId = selectedAgentId === agentId || !selectedAgentId || !nextAgents.some((agent) => agent.id === selectedAgentId)
        ? null
        : selectedAgentId;
      setSelectedAgentId(nextSelectedAgentId);
      replaceAgentChatRoute(nextSelectedAgentId, null);
      const scheduler = deploymentRefreshSchedulerRef.current;
      if (scheduler) {
        // Register a post-response invalidation even if the server event raced
        // ahead of the mutation response. The scheduler retries transient REST
        // failures and coalesces this with the server-sent transition.
        scheduler.invalidate(Boolean(releaseId));
      } else {
        await fetchAgents({ force: true });
      }
      if (generation !== agentDataGenerationRef.current) return;
    } catch (err) {
      if (generation !== agentDataGenerationRef.current) return;
      if (releaseId) clearPendingSlotRelease(releaseId);
      deletingAgentIdsRef.current.delete(agentId);
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      if (generation === agentDataGenerationRef.current) {
        setDeletingId(null);
        setPendingAgentDelete(null);
      }
    }
  };

  const handleSaveName = async () => {
    if (!selectedAgent || selectedAgent.state !== "STOPPED") return;
    const trimmed = settingsName.trim();
    if (!trimmed || trimmed === (selectedAgent.name || "")) return;
    setSavingName(true);
    try {
      await updateAgentCanonicalName(selectedAgent.id, trimmed);
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
  const [preparingAudioPreview, setPreparingAudioPreview] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const [uploadingChatFiles, setUploadingChatFiles] = useState(0);
  const [chatFileUploadProgress, setChatFileUploadProgress] = useState<ChatImageCollectionProgress | null>(null);
  const [pendingFileRemovalStates, setPendingFileRemovalStates] = useState<Record<string, ChatPendingFileRemovalState>>({});
  const pendingFileRemovalStatesRef = useRef<Record<string, ChatPendingFileRemovalState>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const beginChatUpload = useCallback((): number => {
    const generation = chatUploadGenerationRef.current;
    chatUploadsInFlightRef.current += 1;
    setUploadingChatFiles(chatUploadsInFlightRef.current);
    return generation;
  }, []);
  const finishChatUpload = useCallback((generation: number) => {
    if (generation !== chatUploadGenerationRef.current) return;
    chatUploadsInFlightRef.current = Math.max(0, chatUploadsInFlightRef.current - 1);
    setUploadingChatFiles(chatUploadsInFlightRef.current);
    if (chatUploadsInFlightRef.current > 0) return;
    chatUploadIdleWaitersRef.current.forEach((resolve) => resolve());
    chatUploadIdleWaitersRef.current.clear();
  }, []);
  const setPendingFileRemovalState = useCallback((path: string, state: ChatPendingFileRemovalState | null) => {
    const next = { ...pendingFileRemovalStatesRef.current };
    if (state) next[path] = state;
    else delete next[path];
    pendingFileRemovalStatesRef.current = next;
    setPendingFileRemovalStates(next);
  }, []);
  const retireChatUploads = useCallback(() => {
    chatUploadGenerationRef.current += 1;
    chatUploadsInFlightRef.current = 0;
    setUploadingChatFiles(0);
    setChatFileUploadProgress(null);
    setSendingAudio(false);
    chatUploadIdleWaitersRef.current.forEach((resolve) => resolve());
    chatUploadIdleWaitersRef.current.clear();
  }, []);
  useLayoutEffect(() => {
    retireChatUploadsRef.current = retireChatUploads;
  }, [retireChatUploads]);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelAnimRef = useRef<number>(0);
  const discardRecordingRef = useRef(false);
  const recordingRequestRef = useRef(0);

  const startRecording = useCallback(async () => {
    const requestId = recordingRequestRef.current + 1;
    recordingRequestRef.current = requestId;
    const target = { ...activeChatTargetRef.current };
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio recording is not available in this browser.");
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        recordingRequestRef.current !== requestId ||
        activeChatTargetRef.current.agentId !== target.agentId ||
        activeChatTargetRef.current.sessionKey !== target.sessionKey
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

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
          let lastLevelUpdate = 0;
          const updateLevel = (timestamp = performance.now()) => {
            if (timestamp - lastLevelUpdate >= 80) {
              analyser.getByteFrequencyData(dataArray);
              const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
              setAudioLevel(Math.min(avg / 128, 1));
              lastLevelUpdate = timestamp;
            }
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
      discardRecordingRef.current = false;
      setPreparingAudioPreview(false);
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
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          audioChunksRef.current = [];
          setAudioBlob(null);
          setAudioUrl(null);
          setPreparingAudioPreview(false);
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || audioChunksRef.current[0]?.type || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setPreparingAudioPreview(false);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (recordingRequestRef.current !== requestId) return;
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
      setPreparingAudioPreview(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    discardRecordingRef.current = false;
    setPreparingAudioPreview(true);
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
    setPreparingAudioPreview(false);
  }, [audioUrl]);

  const discardChatAudio = useCallback(() => {
    recordingRequestRef.current += 1;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      discardRecordingRef.current = true;
      recorder.stop();
    }
    setRecording(false);
    discardAudio();
  }, [discardAudio]);

  useLayoutEffect(() => {
    discardChatAudioRef.current = discardChatAudio;
  }, [discardChatAudio]);

  const audioTargetRef = useRef({ agentId: selectedAgentId, sessionKey: chat.activeSessionKey });
  useEffect(() => {
    if (
      audioTargetRef.current.agentId === selectedAgentId &&
      audioTargetRef.current.sessionKey === chat.activeSessionKey
    ) return;
    audioTargetRef.current = { agentId: selectedAgentId, sessionKey: chat.activeSessionKey };
    discardChatAudio();
  }, [chat.activeSessionKey, discardChatAudio, selectedAgentId]);

  useEffect(() => {
    const discardPageChatWork = () => {
      chatAsyncOperationRef.current += 1;
      discardChatAudio();
    };
    window.addEventListener("pagehide", discardPageChatWork);
    return () => {
      window.removeEventListener("pagehide", discardPageChatWork);
    };
  }, [discardChatAudio]);

  useEffect(() => () => {
    chatAsyncOperationRef.current += 1;
    discardChatAudioRef.current();
  }, []);

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
    const target = { agentId: selectedAgent.id, sessionKey: chat.activeSessionKey };
    const operation = chatAsyncOperationRef.current;
    const targetIsCurrent = () => (
      chatAsyncOperationRef.current === operation &&
      activeChatTargetRef.current.agentId === target.agentId &&
      activeChatTargetRef.current.sessionKey === target.sessionKey
    );
    setSendingAudio(true);
    const uploadGeneration = beginChatUpload();
    let uploadInFlight = true;
    try {
      const token = await getToken();
      const timestamp = Date.now();
      const filename = `voice-${timestamp}.webm`;
      const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${filename}`;
      const agentPath = `${OPENCLAW_WORKSPACE_DIR}/${filename}`;
      const voiceMessage = `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${agentPath}\``;
      const voiceFile = { name: filename, path: agentPath, type: audioBlob.type || "audio/webm" };
      const agentClient = createAgentClient(token);
      const content = await audioBlob.arrayBuffer();
      if (!targetIsCurrent()) {
        return;
      }
      await agentClient.fileWriteBytes(selectedAgent.id, uploadPath, content);
      if (!targetIsCurrent()) {
        await agentClient.fileDelete(selectedAgent.id, uploadPath).catch(() => undefined);
        return;
      }
      finishChatUpload(uploadGeneration);
      uploadInFlight = false;
      await chat.sendMessage(voiceMessage, { displayContent: "", files: [voiceFile] });
      if (targetIsCurrent()) discardAudio();
    } catch (e) {
      console.error("Audio upload failed:", e);
      if (targetIsCurrent()) setError(e instanceof Error ? e.message : "Audio upload failed");
    } finally {
      if (uploadGeneration === chatUploadGenerationRef.current) setSendingAudio(false);
      if (uploadInFlight) finishChatUpload(uploadGeneration);
    }
  }, [audioBlob, beginChatUpload, chat, discardAudio, finishChatUpload, selectedAgent, getToken, sendingAudio]);

  const handleChatFileDrop = useCallback(async (fileList: ChatFileDropInput) => {
    if (!selectedAgent || !chat.connected) return;
    const droppedItems = normalizeChatFileDropItems(fileList);
    const target = { agentId: selectedAgent.id, sessionKey: chat.activeSessionKey };
    const operation = chatAsyncOperationRef.current;
    if (chatUploadsInFlightRef.current > 0) {
      await waitForChatUploads(null);
      if (
        chatAsyncOperationRef.current !== operation ||
        activeChatTargetRef.current.agentId !== target.agentId ||
        activeChatTargetRef.current.sessionKey !== target.sessionKey
      ) return;
      await handleChatFileDropRef.current(droppedItems);
      return;
    }
    const imageItems = droppedItems.filter(({ file }) => (
      file.type.startsWith("image/") || isFileTypeReference({ name: file.name, mimeType: file.type }, "image")
    ));
    const imageFiles = imageItems.map(({ file }) => file);
    const workspaceItems = droppedItems.filter((item) => !imageItems.includes(item));
    const stageImageCollection = imageFiles.length > 0 && (
      chat.pendingAttachmentReads > 0 ||
      shouldStageChatImageCollection([
        ...chat.pendingAttachments.map((attachment) => ({ size: Math.ceil((attachment.content?.length ?? 0) * 3 / 4) })),
        ...imageFiles,
      ])
    );
    let uploadGeneration: number | null = null;
    const targetIsCurrent = () => (
      chatAsyncOperationRef.current === operation &&
      (uploadGeneration === null || uploadGeneration === chatUploadGenerationRef.current) &&
      activeChatTargetRef.current.agentId === target.agentId &&
      activeChatTargetRef.current.sessionKey === target.sessionKey
    );

    if (imageFiles.length > 0 && !stageImageCollection) {
      const result = await chat.addAttachments(imageFiles, imageItems.map(({ relativePath }) => relativePath));
      if (result.failures.length > 0) throw new Error(result.failures[0].message);
    }
    if (workspaceItems.length === 0 && !stageImageCollection) return;

    uploadGeneration = beginChatUpload();
    let uploadInFlight = true;
    let uploadCommitted = false;
    let agentClient: ReturnType<typeof createAgentClient> | null = null;
    let stagedCollection: ChatImageCollectionDescriptor | null = null;
    try {
      const token = await getToken();
      const client = createAgentClient(token);
      agentClient = client;
      const uploaded: Array<{
        name: string;
        path: string;
        type: string;
        imageCollection?: ChatImageCollectionDescriptor;
      }> = [];

      if (stageImageCollection) {
        const result = await uploadChatImageCollection({
          files: imageItems.map(({ file, relativePath }) => ({
            name: relativePath,
            size: file.size,
            type: file.type,
            arrayBuffer: () => file.arrayBuffer(),
          })),
          isActive: targetIsCurrent,
          onProgress: (progress) => {
            if (targetIsCurrent()) setChatFileUploadProgress(progress);
          },
          writeFile: (path, content) => client.fileWriteBytes(selectedAgent.id, path, content),
          deleteFile: (path) => client.fileDelete(selectedAgent.id, path),
        });
        if (result.cleanupFailures.length > 0) {
          console.error("Image collection rollback was incomplete:", result.cleanupFailures);
        }
        if (result.cancelled || !targetIsCurrent()) return;
        if (!result.collection || !result.manifestName) {
          const failure = result.failures[0];
          throw new Error(failure
            ? `Could not upload "${failure.name}": ${failure.message}`
            : "The image collection could not be uploaded.");
        }
        uploaded.push({
          name: result.manifestName,
          path: result.collection.manifestPath,
          type: "application/json",
          imageCollection: result.collection,
        });
        stagedCollection = result.collection;
      }

      for (const [index, { file, relativePath }] of workspaceItems.entries()) {
        if (!targetIsCurrent()) return;
        setChatFileUploadProgress({
          completed: index,
          total: workspaceItems.length,
          label: workspaceItems.length === 1 ? "Uploading file" : `Uploading ${workspaceItems.length} files`,
        });
        const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${relativePath}`;
        let content: ArrayBuffer;
        try {
          content = await file.arrayBuffer();
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : "The file could not be read.";
          throw new Error(`Could not read "${relativePath}": ${detail}`);
        }
        if (!targetIsCurrent()) return;
        await client.fileWriteBytes(selectedAgent.id, uploadPath, content);
        if (!targetIsCurrent()) return;
        uploaded.push({
          name: file.name,
          path: `${OPENCLAW_SYNC_ROOT}/${uploadPath}`,
          type: file.type,
        });
        setChatFileUploadProgress({
          completed: index + 1,
          total: workspaceItems.length,
          label: workspaceItems.length === 1 ? "Uploading file" : `Uploading ${workspaceItems.length} files`,
        });
      }

      if (!targetIsCurrent()) return;
      chat.addPendingFiles(uploaded);
      uploadCommitted = true;
      finishChatUpload(uploadGeneration);
      uploadInFlight = false;
      await refreshChatFileReferences().catch(() => undefined);
    } catch (e) {
      console.error("Chat file upload failed:", e);
      const uploadError = e instanceof Error ? e : new Error("File upload failed");
      if (targetIsCurrent()) setError(uploadError.message);
      throw uploadError;
    } finally {
      const cleanupClient = agentClient;
      if (!uploadCommitted && cleanupClient) {
        if (stagedCollection) {
          const cleanupFailures = await deleteChatImageCollection(
            stagedCollection,
            (path) => cleanupClient.fileDelete(selectedAgent.id, path),
          );
          if (cleanupFailures.length > 0) {
            console.error("Image collection cleanup was incomplete:", cleanupFailures);
          }
        }
      }
      if (uploadInFlight) finishChatUpload(uploadGeneration);
      if (
        uploadGeneration === chatUploadGenerationRef.current &&
        chatUploadsInFlightRef.current === 0
      ) setChatFileUploadProgress(null);
    }
  }, [beginChatUpload, chat, finishChatUpload, getToken, refreshChatFileReferences, selectedAgent, waitForChatUploads]);
  useLayoutEffect(() => {
    handleChatFileDropRef.current = handleChatFileDrop;
  }, [handleChatFileDrop]);

  const removePendingChatFile = useCallback((index: number, file: ChatPendingFile) => {
    const target = { agentId: selectedAgent?.id ?? null, sessionKey: chat.activeSessionKey };
    if (!selectedAgent || !file.imageCollection) {
      chat.removePendingFile(index, file.path, target);
      return;
    }
    const agentId = selectedAgent.id;
    const collection = file.imageCollection;
    setPendingFileRemovalState(file.path, "removing");
    void (async () => {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const cleanupFailures = await deleteChatImageCollection(collection, (path) => agentClient.fileDelete(agentId, path));
      if (cleanupFailures.length > 0) {
        throw new Error("The image collection could not be removed completely. Please retry.");
      }
      chat.removePendingFile(index, file.path, target);
      setPendingFileRemovalState(file.path, null);
      await refreshChatFileReferences().catch(() => undefined);
    })().catch((cause: unknown) => {
      console.error("Image collection cleanup failed:", cause);
      setPendingFileRemovalState(file.path, "failed");
      setError(cause instanceof Error ? cause.message : "The image collection could not be removed.");
    });
  }, [chat, getToken, refreshChatFileReferences, selectedAgent, setPendingFileRemovalState]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleSendChat = () => {
    if (chat.activeSessionReadOnly || uploadingChatFiles > 0) return;
    if (chat.pendingFiles.some((file) => pendingFileRemovalStatesRef.current[file.path])) return;
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
      chat.addPendingMessage(draftInput, {
        attachments: chat.pendingAttachments,
        files: chat.pendingFiles,
        consumeDraft: true,
      });
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
    mainTab === "desktop" ||
    mainTab === "integrations" ||
    mainTab === "skills" ||
    mainTab === "knowledge-hub" ||
    mainTab === "knowledge" ||
    mainTab === "members" ||
    mainTab === "scheduled" ||
    mainTab === "logs" ||
    mainTab === "shell" ||
    mainTab === "settings"
      ? mainTab
      : "chat";
  const knowledgeSurfaceHeader: DashboardSurfaceHeader | null = selectedCenterPanel === "knowledge-hub"
    ? {
        title: "Knowledge",
        description: selectedKnowledgeCollection
          ? "Review Collection knowledge, processing health, and direct agent access."
          : "Organize knowledge by business area and keep every agent focused.",
        controlsTargetId: KNOWLEDGE_HUB_SURFACE_CONTROLS_ID,
      }
    : null;
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
  const selectedJourneyAgentName = selectedAgent ? agentDisplayLabel(selectedAgent) : "your agent";
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
    if (!SCHEDULED_SECTION_ENABLED && !anonymousAgentPreviewMode && mainTab === "scheduled") {
      setMainTab("chat");
    }
  }, [anonymousAgentPreviewMode, mainTab]);

  useEffect(() => {
    if (!selectedAgent && openclawSettingsOpen) {
      setOpenclawSettingsOpen(false);
    }
  }, [openclawSettingsOpen, selectedAgent]);

  // OpenClaw settings surfaces are openclaw-only; other runtimes (hermes has
  // no gateway config schema) fall back to the chat tab.
  const selectedAgentIsOpenClaw = !selectedAgent?.runtime
    || selectedAgent.runtime === "openclaw"
    || selectedAgent.runtime === "openclaw-pro";
  useEffect(() => {
    if (!selectedAgent || selectedAgentIsOpenClaw) return;
    if (!openclawSettingsOpen && mainTab !== "openclaw") return;
    const timeout = window.setTimeout(() => {
      if (openclawSettingsOpen) setOpenclawSettingsOpen(false);
      if (mainTab === "openclaw") setMainTab("chat");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [mainTab, openclawSettingsOpen, selectedAgent, selectedAgentIsOpenClaw]);

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
          selectMainTab("files");
          setMobileShowChat(true);
          return;
        }
        if (tab === "workspace") {
          setDirectoryDetailOrigin(null);
          setOpenclawSettingsOpen(false);
          selectMainTab("chat");
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
          selectMainTab("integrations");
          setMobileShowChat(true);
          return;
        }
        if (tab === "skills") {
          setDirectoryCategory(undefined);
          setDirectoryItemId(undefined);
          setDirectoryDetailOrigin(null);
          setOpenclawSettingsOpen(false);
          selectMainTab(tab);
          setMobileShowChat(true);
          return;
        }
        if (tab === "settings") {
          setOpenclawSettingsOpen(false);
          selectMainTab("settings");
          setMobileShowChat(true);
          return;
        }
        if (tab === "scheduled" && !SCHEDULED_SECTION_ENABLED) {
          setOpenclawSettingsOpen(false);
          selectMainTab("chat");
          setMobileShowChat(true);
          return;
        }
        setOpenclawSettingsOpen(false);
        selectMainTab(tab);
        setMobileShowChat(true);
      },
      onDelete: () => {
        setPendingAgentDelete({
          id: selectedAgent.id,
          name: agentDisplayLabel(selectedAgent),
        });
      },
      deleting: deletingId === selectedAgent.id,
    });
    return () => setAgentMenu(null);
  }, [selectedAgent, mainTab, deletingId, selectMainTab, setAgentMenu, router]);

  // ── Render ──
  const mobileMainPanelVisible = !isDesktopViewport || mobileShowChat || agentsLoading || !selectedAgent;
  const closeMobileNavigation = () => setMobileNavigationOpen(false);
  const openDashboardView = (view: DashboardView) => {
    closeMobileNavigation();
    setOpenclawSettingsOpen(false);
    if (!isAuthenticated) {
      requestAuthentication({
        kind: "navigate",
        href: dashboardViewHrefs[view],
      });
      return;
    }
    if (dashboardView === view) return;
    router.push(dashboardViewHrefs[view], { scroll: false });
  };
  const openAgentSurfaceRoute = (tab: AgentRouteTab = "chat") => {
    if (!dashboardView) return;
    if (!selectedAgentId) {
      router.push("/dashboard/agents", { scroll: false });
      return;
    }
    const params = new URLSearchParams({ agentId: selectedAgentId });
    if (canonicalSelectedSessionKey) params.set("session", canonicalSelectedSessionKey);
    if (tab !== "chat") params.set("tab", tab);
    router.push(`/dashboard/agents?${params.toString()}`, { scroll: false });
  };
  const openAgentLauncherFromCurrentSection = () => {
    const returnHref = dashboardView
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : null;
    if (!openAgentCreationFlow()) return;
    if (!dashboardView || !isAuthenticated || shouldOfferWorkspaceCreation) return;
    agentLauncherReturnHrefRef.current = returnHref;
    openAgentSurfaceRoute("chat");
  };
  const openAgentSettingsTab = (section: AgentSettingsSection = "general") => {
    setAgentSettingsSection(section);
    openAgentSurfaceRoute("settings");
    setOpenclawSettingsOpen(false);
    selectMainTab("settings");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const showChatTab = (sectionRouteUpdated = false) => {
    setAnonymousDesktopPreviewOpen(false);
    if (sectionRouteUpdated) setMainTab("chat");
    else {
      openAgentSurfaceRoute("chat");
      selectMainTab("chat");
    }
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const openChatTab = () => showChatTab(false);
  const selectSession = async (sessionKey: string) => {
    const targetAgentId = selectedAgentId;
    if (!targetAgentId) return;
    const selectionOperation = sessionSelectionOperationRef.current + 1;
    sessionSelectionOperationRef.current = selectionOperation;
    if (chat.temporaryChatState !== "inactive") {
      await endTemporaryChatBeforeSelectionRef.current();
    }
    if (
      sessionSelectionOperationRef.current !== selectionOperation ||
      selectedAgentIdRef.current !== targetAgentId
    ) return;
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [targetAgentId]: sessionKey }));
    replaceAgentChatRoute(targetAgentId, sessionKey, true, Boolean(dashboardView));
    showChatTab(true);
  };
  const renameSession = async (sessionKey: string, title: string) => {
    await chat.renameSession(sessionKey, title);
  };
  const deleteSession = async (sessionKey: string) => {
    const targetAgentId = selectedAgentId;
    await chat.deleteSession(sessionKey);
    setSessionPinned(sessionKey, false);
    if (!targetAgentId) return;

    const fallbackSessionKey = resolveOpenClawResumeSessionKey(
      userVisibleChatSessions.filter((session) => !sameOpenClawSelectableSessionKey(session.key, sessionKey)),
    );
    const deletedSelectedSession = sameOpenClawSelectableSessionKey(sessionKey, selectedSessionKey);
    if (fallbackSessionKey && !deletedSelectedSession) return;

    const nextSessionKey = fallbackSessionKey ?? await chat.createSession({ waitForCreation: true });
    if (selectedAgentIdRef.current !== targetAgentId) return;
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [targetAgentId]: nextSessionKey }));
    replaceAgentChatRoute(targetAgentId, nextSessionKey);
  };
  const createSession = async () => {
    if (!selectedAgentId) return;
    if (chat.temporaryChatState !== "inactive") {
      await endTemporaryChatBeforeSelectionRef.current();
    }
    const sessionKey = await chat.createSession();
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [selectedAgentId]: sessionKey }));
    replaceAgentChatRoute(selectedAgentId, sessionKey, true, Boolean(dashboardView));
    showChatTab(true);
  };
  const testSkillInNewSession = async (skill: AgentSkill) => {
    if (!selectedAgentId) throw new Error("Select an agent before testing a skill.");
    if (chat.temporaryChatState !== "inactive") {
      await endTemporaryChatBeforeSelectionRef.current();
    }
    let revision = null;
    if (skill.localPreview) {
      assertSkillDraftTestable(skill);
      revision = await createSkillDraftRevision(skillDraftScope, {
        id: skill.id,
        content: skill.content,
        directories: skill.localDirectories ?? [],
      });
    }
    const initialMessage = buildSkillTestPrompt(skill, revision ? { revisionHash: revision.contentHash, directories: revision.directories } : undefined);
    const sessionKey = await chat.createSession({
      initialMessage,
      initialDisplayContent: skill.localPreview ? `Test the ${skill.name} draft.` : `Test the ${skill.name} skill.`,
      waitForCreation: true,
    });
    if (revision) {
      await linkSkillDraftTestSession(skillDraftScope, {
        draftId: skill.id,
        revisionId: revision.id,
        skillId: skill.id,
        skillName: skill.name,
        requestedSessionKey: sessionKey,
      });
    }
    setSelectedSessionKeysByAgent((prev) => ({ ...prev, [selectedAgentId]: sessionKey }));
    replaceAgentChatRoute(selectedAgentId, sessionKey, true);
    showChatTab(true);
  };
  const openFilesTab = (path?: string) => {
    setAnonymousDesktopPreviewOpen(false);
    openAgentSurfaceRoute("files");
    const previewPath = typeof path === "string" ? path.trim() : "";
    setFilesPreviewPath(previewPath || null);
    setOpenclawSettingsOpen(false);
    selectMainTab("files");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const openDesktopTab = () => {
    setAnonymousDesktopPreviewOpen(false);
    openAgentSurfaceRoute("desktop");
    setOpenclawSettingsOpen(false);
    selectMainTab("desktop");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const downloadAgentFileFromChat = useCallback(async (file: ChatPendingFile) => {
    const result = await readAgentFileBytesResult(file.path);
    const name = result.renamed
      ? result.path.split("/").filter(Boolean).pop() || file.name || "download"
      : file.name || file.path.split("/").filter(Boolean).pop() || "download";
    downloadFileBytes(name, result.content, result.mimeType || file.type || inferFileMimeType(file));
  }, [readAgentFileBytesResult]);
  const openIntegrationsTab = () => {
    setAnonymousDesktopPreviewOpen(false);
    openAgentSurfaceRoute("integrations");
    setRequestedSkillId(null);
    setDirectoryCategory(undefined);
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    selectMainTab("integrations");
    setMobileShowChat(true);
    closeMobileNavigation();
    completeJourneyForEvent("integrations-opened");
  };
  const openJourneyCapability = (capability: JourneyCapabilityCard, day?: JourneyDay | null) => {
    const category = getCategoryForPlugin(capability.pluginId) ?? undefined;
    setDirectoryCategory(category);
    setDirectoryItemId(capability.pluginId);
    setDirectoryDetailOrigin("chat");
    setOpenclawSettingsOpen(false);
    selectMainTab("integrations");
    setMobileShowChat(true);
    closeMobileNavigation();
    if (day?.id === "connections") {
      completeJourneyDay(day.id, capability.receipt);
    } else if (day?.id) {
      recordJourneyReceipt(day.id, capability.receipt);
    }
  };
  const openSkillsTab = (skillId?: string) => {
    setAnonymousDesktopPreviewOpen(false);
    openAgentSurfaceRoute("skills");
    setRequestedSkillId(skillId?.trim() || null);
    setDirectoryCategory(undefined);
    setDirectoryItemId(undefined);
    setDirectoryDetailOrigin(null);
    setOpenclawSettingsOpen(false);
    selectMainTab("skills");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const saveActiveSkillDraft = async () => {
    const testSession = activeSkillDraftTest.testSession;
    if (!testSession) throw new Error("This session is not linked to a skill draft.");
    if (!agentSkills.capabilities?.createSkill) throw new Error("Saving skills to this agent is unavailable.");
    await saveSkillDraftFromTest({
      scope: skillDraftScope,
      testSession,
      createSkill: agentSkills.create,
      closeSession: deleteSession,
      openSkill: openSkillsTab,
    });
  };
  const leaveAgentsPage = (href: string) => {
    void (async () => {
      await endTemporaryChatBeforeSelectionRef.current();
      router.push(href);
    })();
  };
  const openKnowledgeHubSurface = (collectionId: string | null) => {
    const targetHref = buildKnowledgeHubHref({
      collectionId,
      agentId: selectedAgentId,
      session: selectedAgentId ? canonicalSelectedSessionKey : null,
    });
    closeMobileNavigation();
    if (!isAuthenticated) {
      requestAuthentication({ kind: "navigate", href: targetHref });
      return;
    }
    setOpenclawSettingsOpen(false);
    setMobileShowChat(true);
    setSelectedKnowledgeCollection(null);
    selectMainTab("knowledge-hub");
    if (knowledgeHubSectionActive && requestedKnowledgeCollectionId === collectionId) return;
    router.push(targetHref, { scroll: false });
  };
  const openKnowledgeHub = () => openKnowledgeHubSurface(null);
  const openActivityCollection = (collectionId: string) => openKnowledgeHubSurface(collectionId);
  const openActivityConversation = (agentId: string, sessionKey: string) => {
    const selectionOperation = agentSelectionOperationRef.current + 1;
    agentSelectionOperationRef.current = selectionOperation;
    void (async () => {
      await endTemporaryChatBeforeSelectionRef.current();
      if (agentSelectionOperationRef.current !== selectionOperation) return;
      setSelectedSessionKeysByAgent((current) => ({ ...current, [agentId]: sessionKey }));
      setSelectedAgentId(agentId);
      setMobileShowChat(true);
      selectMainTab("chat");
      replaceAgentChatRoute(agentId, sessionKey, true, true);
    })();
  };
  const openActivityScheduled = (agentId: string) => {
    leaveAgentsPage(buildAgentWorkspaceTabHref(agentId, "scheduled"));
  };
  const openMembersTab = () => {
    if (!isAuthenticated) {
      requestAuthentication({ kind: "navigate", href: membersSectionHref });
      return;
    }
    closeMobileNavigation();
    setOpenclawSettingsOpen(false);
    setMobileShowChat(true);
    selectMainTab("members");
    if (membersSectionActive) return;
    router.push(membersSectionHref, { scroll: false });
  };
  const openDashboardUsage = () => openDashboardView("usage");
  const openDashboardHome = () => openDashboardView("overview");
  const openAccountSettings = () => {
    closeMobileNavigation();
    setOpenclawSettingsOpen(false);
    const href = buildDashboardViewHref("settings");
    if (!isAuthenticated) {
      requestAuthentication({
        kind: "navigate",
        href,
      });
      return;
    }
    router.push(href, { scroll: false });
  };
  const openAgentAccountSettings = () => {
    closeMobileNavigation();
    setOpenclawSettingsOpen(false);
    const href = buildAgentSettingsHref(selectedAgent?.id);
    if (!isAuthenticated) {
      requestAuthentication({ kind: "navigate", href });
      return;
    }
    router.push(href, { scroll: false });
  };
  const selectAccountSettingsSection = (section: SettingsSectionId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "settings");
    params.set("settings", section);
    params.delete("section");
    params.delete("tab");
    params.delete("open");
    syncDashboardSearchParams(params, true);
  };
  const selectSettingsAgent = (agentId: string) => {
    focusScopedAgentSettingsRef.current = true;
    const params = new URLSearchParams({
      view: "settings",
      settings: "agent",
      agentId,
    });
    syncDashboardSearchParams(params, true);
  };
  const openSettingsAgentList = () => {
    focusAgentSettingsListRef.current = true;
    syncDashboardSearchParams(new URLSearchParams({
      view: "settings",
      settings: "agent",
    }), true);
  };
  const openMobileSettingsMenu = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    syncDashboardSearchParams(params, true);
    window.setTimeout(() => mobileSettingsMenuRef.current?.focus(), 0);
  };
  const openScheduledTab = (draftCommand?: unknown) => {
    if (!SCHEDULED_SECTION_ENABLED && !anonymousAgentPreviewMode) return;
    setAnonymousDesktopPreviewOpen(false);
    openAgentSurfaceRoute("scheduled");
    const command = typeof draftCommand === "string" ? draftCommand.trim() : "";
    if (command) {
      scheduledInitialCommandIdRef.current += 1;
      setScheduledInitialCommand({ id: scheduledInitialCommandIdRef.current, command });
    } else {
      setScheduledInitialCommand(null);
    }
    setOpenclawSettingsOpen(false);
    selectMainTab("scheduled");
    setMobileShowChat(true);
    closeMobileNavigation();
    if (chat.connected) void chat.refreshCron().catch(() => undefined);
  };
  const openDesktopPreview = () => {
    if (!anonymousAgentPreviewMode) return;
    setAnonymousDesktopPreviewOpen(true);
    setOpenclawSettingsOpen(false);
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const markAnonymousPreviewSelection = () => {
    if (anonymousAgentPreviewMode) setAnonymousPreviewSelectionMade(true);
  };
  const openFilesFromNavigation = () => {
    markAnonymousPreviewSelection();
    openFilesTab();
  };
  const openIntegrationsFromNavigation = () => {
    markAnonymousPreviewSelection();
    openIntegrationsTab();
  };
  const openSkillsFromNavigation = () => {
    markAnonymousPreviewSelection();
    openSkillsTab();
  };
  const openScheduledFromNavigation = () => {
    markAnonymousPreviewSelection();
    openScheduledTab();
  };
  const openDesktopPreviewFromNavigation = () => {
    markAnonymousPreviewSelection();
    openDesktopPreview();
  };
  const openLogsTab = () => {
    openAgentSurfaceRoute("logs");
    setOpenclawSettingsOpen(false);
    selectMainTab("logs");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const openShellTab = () => {
    prepareShell();
    openAgentSurfaceRoute("shell");
    setOpenclawSettingsOpen(false);
    selectMainTab("shell");
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const openOpenClawSettings = () => {
    if (!selectedAgent) {
      openAgentSettingsTab();
      return;
    }
    openAgentSurfaceRoute("openclaw");
    setOpenclawSettingsOpen(true);
    setMobileShowChat(true);
    closeMobileNavigation();
  };
  const closeOpenClawSettings = () => {
    setOpenclawSettingsOpen(false);
    if (requestedAgentTab !== "openclaw") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const query = params.toString();
    preserveMainTabOnRouteCleanupRef.current = true;
    router.replace(`/dashboard/agents${query ? `?${query}` : ""}`, { scroll: false });
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
  const createAgentFromLauncher = async (params: AgentCreationSetupCreateParams) => {
    try {
      const createdId = await handleCreateFirstAgent(params, (accepted) => {
        agentLauncherReturnHrefRef.current = null;
        setOpenclawSettingsOpen(false);
        setMainTab("chat");
        setMobileShowChat(true);
        setAgentLauncherOpen(false);
        void selectAgent(accepted.id, true);
      });
      if (createdId) {
        const principalId = user?.id ?? null;
        const pending = principalId ? readPendingPlanCheckout(principalId) : null;
        if (
          principalId
          && isFirstAgentSetupCheckout(pending)
          && params.creationId
          && pending.setupId === params.creationId
        ) {
          clearPendingPlanCheckout(principalId, pending);
          setPaidFirstAgentCheckout(null);
        }
        setCheckoutReturnRecoveryActive(false);
        agentLauncherReturnHrefRef.current = null;
        setAgentLauncherOpen(false);
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

      openAgentCreationFlow();
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
    if (chat.temporaryChatActive) return "Private chat";
    const session = userVisibleChatSessions.find((item) => sameOpenClawSelectableSessionKey(item.key, selectedSessionKey));
    if (!session) {
      const routableSessionKey = routableOpenClawSessionKey(selectedSessionKey);
      return routableSessionKey ? fallbackOpenClawSessionDisplayName(routableSessionKey) : "New Session";
    }
    return displayOpenClawSessionName(session);
  }, [chat.temporaryChatActive, selectedSessionKey, userVisibleChatSessions]);
  const selectedSessionReturnTarget = selectedAgent && (mainTab !== "chat" || openclawSettingsOpen)
    ? { label: selectedSessionLabel, onSelect: openChatTab }
    : null;
  const privateChatHasDraft = Boolean(
    chat.input.trim() ||
    chat.pendingAttachments.length > 0 ||
    chat.pendingAttachmentReads > 0 ||
    chat.pendingFiles.length > 0 ||
    recording ||
    audioUrl ||
    sendingAudio ||
    uploadingChatFiles > 0,
  );
  const privateChatControlVisible = Boolean(
    selectedAgent &&
    isSelectedRunning &&
    mainTab === "chat" &&
    (chat.temporaryChatActive || chat.messages.length === 0),
  );
  const privateChatDisabledReason = chat.temporaryChatActive
    ? undefined
    : !chat.temporaryChatAvailable || !chat.connected
      ? "Private chat is available when the agent is connected"
      : chat.sending
        ? "Wait for the current reply to finish"
        : privateChatHasDraft
          ? "Clear the current draft before starting a private chat"
          : undefined;
  const startPrivateChat = async () => {
    try {
      await chat.startTemporaryChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Private chat could not be started.");
    }
  };
  const endPrivateChat = async () => {
    await endTemporaryChatBeforeSelectionRef.current();
  };
  const renderPrivateChatControl = (compact = false) => privateChatControlVisible ? (
    <AgentPrivateChatControl
      state={chat.temporaryChatState}
      compact={compact}
      disabled={Boolean(privateChatDisabledReason)}
      disabledReason={privateChatDisabledReason}
      onStart={startPrivateChat}
      onEnd={endPrivateChat}
    />
  ) : null;
  const mobileNavigation = (
    <div
      className="agent-desktop-navigation relative flex h-full min-h-0 w-64 shrink-0 flex-col pt-14"
      data-roster-collapsed={mobileRosterCollapsed}
      data-expanded-section={mobileRosterCollapsed ? "workspace" : "agents"}
    >
      <div className="agent-desktop-navigation-sections relative isolate mt-2 flex min-h-0 w-full flex-1">
        <AgentList
          sidebarCollapsed={mobileRosterCollapsed}
          isDesktopViewport={false}
          renderMobileNavigation
          mobileShowChat={false}
          agents={agents}
          rosterLoading={agentsLoading || isAgentRosterLoading}
          rosterOrderScope={selectedWorkspaceId}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={(agentId) => {
            selectAgentFromRoster(agentId);
            setMobileRosterCollapsed(true);
          }}
          setMobileShowChat={setMobileShowChat}
          setSidebarCollapsed={setMobileRosterCollapsed}
          syntheticThreads={syntheticThreads}
          agentCardDataById={agentCardDataById}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          onCreateAgent={handleCreateFirstAgent}
          associateCreatedAgent={assignAgentToCollection}
          agentCreationDisabledReason={agentCreationDisabledReason}
          fetchAgents={refreshAgentsForChildren}
          setError={setError}
          sidebarCreatorSignal={0}
          onOpenAgentLauncher={() => {
            closeMobileNavigation();
            openAgentLauncherFromCurrentSection();
          }}
          agentLauncherSuspended={agentLauncherSuspended}
          setPendingAgentDelete={(value) => {
            setPendingAgentDelete(value);
            if (value) closeMobileNavigation();
          }}
          accountInitial={accountInitial}
          accountAvatarUrl={accountAvatarUrl}
          accountName={dashboardDisplayName}
          accountEmail={user?.email ?? null}
          onLogin={!isAuthenticated ? () => requestAuthentication({ kind: "navigate", href: "/dashboard/agents" }) : undefined}
          onLogout={isAuthenticated ? logout : undefined}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          preferredPlanId={launcherPreferredPlanId}
          pendingSlotReleases={pendingSlotReleases}
          onOpenPlanCatalog={(planId) => {
            closeMobileNavigation();
            return openUpgradeCatalog(planId);
          }}
          onOpenHome={openDashboardHome}
          homeActive={dashboardView === "overview"}
          homeHref={dashboardViewHrefs.overview}
          onOpenKnowledgeHub={openKnowledgeHub}
          knowledgeHubActive={knowledgeHubSectionActive}
          knowledgeHubHref={knowledgeHubSectionHref}
          onOpenMembers={openMembersTab}
          membersActive={membersSectionActive}
          membersHref={membersSectionHref}
          onOpenUsage={openDashboardUsage}
          usageActive={dashboardView === "usage"}
          usageHref={dashboardViewHrefs.usage}
          onOpenAccountSettings={openAccountSettings}
          embeddedInNavigation
        />

        <AgentWorkspaceSidebar
          selectedAgent={selectedAgent}
          activeTab={anonymousDesktopPreviewMode ? null : dashboardView ? null : openclawSettingsOpen && selectedAgent ? "openclaw" : mainTab}
          skillsActive={!anonymousDesktopPreviewMode && mainTab === "skills"}
          tokenUsed={tokenUsage}
          tokenLimit={tokenLimit}
          isAuthenticated={isAuthenticated}
          activeTrial={activeTrial}
          canStartTrial={canStartTeamTrial}
          trialCheckoutPending={trialCheckoutPending}
          disabled={workspaceSidebarDisabled}
          disabledReason={workspaceSidebarDisabledReason}
          allowAgentlessFeaturePreviews={anonymousAgentPreviewMode}
          desktopPreviewActive={anonymousDesktopPreviewMode}
          scheduledDisabled={!SCHEDULED_SECTION_ENABLED && !anonymousAgentPreviewMode}
          scheduledDisabledReason={SCHEDULED_SECTION_DISABLED_REASON}
          isDesktopViewport={false}
          renderMobile
          collapsed={!mobileRosterCollapsed}
          onCollapsedChange={(collapsed) => setMobileRosterCollapsed(!collapsed)}
          embeddedInNavigation
          footerAction={renderPrivateChatControl()}
          closeButtonRef={mobileNavigationCloseRef}
          onClose={closeMobileNavigation}
          sessions={userVisibleChatSessions}
          activeUnindexedInitialSession={chat.activeUnindexedInitialSession}
          sessionsFetched={chat.sessionsFetched}
          creatingSessionKeys={chat.creatingSessionKeys}
          thinkingSessionKeys={chat.thinkingSessionKeys}
          selectedSessionKey={selectedSessionKey}
          pinnedSessionKeys={pinnedSessionKeys}
          onSelectSession={selectSession}
          onSetSessionPinned={setSessionPinned}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onCreateSession={createSession}
          onOpenFiles={openFilesFromNavigation}
          onOpenIntegrations={openIntegrationsFromNavigation}
          onOpenSkills={openSkillsFromNavigation}
          onOpenScheduled={openScheduledFromNavigation}
          onOpenDesktop={openDesktopTab}
          onOpenDesktopPreview={openDesktopPreviewFromNavigation}
          onOpenLogs={openLogsTab}
          onOpenShell={openShellTab}
          onShellIntent={prepareShell}
          onShellIntentEnd={cancelShellIntent}
          onOpenOpenClaw={openOpenClawSettings}
          onOpenSettings={openAgentAccountSettings}
          settingsActive={dashboardView === "settings" && accountSettingsSection === "agent"}
          onUpgrade={() => {
            closeMobileNavigation();
            void openUpgradeCatalog();
          }}
          onStartTrial={() => {
            closeMobileNavigation();
            beginTeamTrial();
          }}
          onManageTrial={() => {
            closeMobileNavigation();
            selectAccountSettingsSection("billing");
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute -top-2 bottom-0 right-0 z-[60] w-px bg-border" />
      </div>
    </div>
  );

  const agentSettingsSharedProps: Omit<React.ComponentProps<typeof AgentSettingsPanel>, "activeSection" | "onSectionChange" | "showSectionNavigation"> = {
    agent: selectedAgent,
    user,
    getToken,
    onProfileNameChange: setAccountProfileName,
    onProfileAvatarChange: setAccountAvatarUrl,
    onStartAgent: () => {
      if (selectedAgent) void handleLaunchLifecycleAction(selectedAgent.id);
    },
    onStopAgent: () => {
      if (selectedAgent) void handleStop(selectedAgent.id);
    },
    onArchiveAgent: () => {
      if (selectedAgent) void handleArchive(selectedAgent.id);
    },
    onRestoreAgent: () => {
      if (selectedAgent) void handleLaunchLifecycleAction(selectedAgent.id);
    },
    onDeleteAgent: () => {
      if (selectedAgent) {
        setPendingAgentDelete({ id: selectedAgent.id, name: agentDisplayLabel(selectedAgent) });
      }
    },
    onLogout: logout,
    agentStarting: selectedAgentStarting,
    agentStopping: Boolean(selectedAgent && stoppingId === selectedAgent.id),
    agentArchiving: Boolean(selectedAgent && archivingId === selectedAgent.id),
    agentRestoring: Boolean(selectedAgent && restoringId === selectedAgent.id),
    agentDeleting: Boolean(selectedAgent && deletingId === selectedAgent.id),
    agentStartBlocked: selectedAgentLaunchBlocked,
    agentStartBlockedReason: selectedAgentStartBlockedTitle,
    openclawConfig: chat.config,
    openclawModels: chat.models,
    reportedChannels: chat.reportedChannels,
    reportedChannelsReady: chat.reportedChannelsReady,
    onUpdateAgentProfile: async (agentId, profile) => {
      const generation = agentDataGenerationRef.current;
      const updatedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        return createAgentClient(token).update(agentId, profile);
      });
      if (!updatedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(updatedAgent);
    },
    onUpdateExternalAgentProfile: async (agentId, profile) => {
      const generation = agentDataGenerationRef.current;
      const updatedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        return createAgentClient(token).updateExternalAgent(agentId, profile);
      });
      if (!updatedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(updatedAgent);
    },
    onUploadAgentAvatar: async (agentId, file) => {
      const generation = agentDataGenerationRef.current;
      return runAgentMutation(agentId, async () => {
        if (deletingAgentIdsRef.current.has(agentId)) throw new Error("Agent is being deleted.");
        const targetAgent = sdkAgents.find((agent) => agent.id === agentId);
        if (!targetAgent) throw new Error("Agent is no longer available.");
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current) throw new Error("Account changed during upload.");
        if (deletingAgentIdsRef.current.has(agentId)) throw new Error("Agent is being deleted.");
        const client = createAgentClient(token);
        const external = targetAgent.managed === false;
        const upload = external
          ? await client.uploadExternalAgentProfileImage(agentId, file, file.type || "image/png")
          : await client.uploadProfileImage(agentId, file, file.type || "image/png");
        if (!upload.avatar_url) throw new Error("Avatar upload returned no URL.");
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return upload.avatar_url;
        setAgentAvatarOverride(agentId, upload.avatar_url, file);
        try {
          const updatedAgent = external
            ? await client.getExternalAgent(agentId)
            : await client.get(agentId);
          if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
            applyAgentMutationResult(updatedAgent);
          }
        } catch {
          // The upload response is authoritative; roster reconciliation can happen on the next refresh.
        }
        return upload.avatar_url;
      });
    },
    onDeleteAgentAvatar: async (agentId) => {
      const generation = agentDataGenerationRef.current;
      await runAgentMutation(agentId, async () => {
        if (deletingAgentIdsRef.current.has(agentId)) throw new Error("Agent is being deleted.");
        const targetAgent = sdkAgents.find((agent) => agent.id === agentId);
        if (!targetAgent) throw new Error("Agent is no longer available.");
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current) throw new Error("Account changed during avatar removal.");
        if (deletingAgentIdsRef.current.has(agentId)) throw new Error("Agent is being deleted.");
        const client = createAgentClient(token);
        const external = targetAgent.managed === false;
        if (external) await client.deleteExternalAgentProfileImage(agentId);
        else await client.deleteProfileImage(agentId);
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
        setAgentAvatarOverride(agentId, null);
        try {
          const updatedAgent = external
            ? await client.getExternalAgent(agentId)
            : await client.get(agentId);
          if (generation === agentDataGenerationRef.current && !deletingAgentIdsRef.current.has(agentId)) {
            applyAgentMutationResult(updatedAgent);
          }
        } catch {
          // The delete already committed; roster reconciliation can happen on the next refresh.
        }
      });
    },
    onUpdateAgentLaunchConfig: async (agentId, launchConfig) => {
      const generation = agentDataGenerationRef.current;
      const updatedAgent = await runAgentMutation(agentId, async () => {
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        const token = await getToken();
        if (generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return null;
        return createAgentClient(token).update(agentId, { launchConfig });
      });
      if (!updatedAgent || generation !== agentDataGenerationRef.current || deletingAgentIdsRef.current.has(agentId)) return;
      applyAgentMutationResult(updatedAgent);
    },
    onSaveOpenClawConfig: async (patch) => {
      await chat.saveConfig(patch);
      completeJourneyForEvent("rules-confirmed");
    },
    isDesktopViewport,
  };

  const renderAgentSettingsPanel = (
    activeSection: AgentSettingsSection,
    showSectionNavigation: boolean,
    onSectionChange?: (section: AgentSettingsSection) => void,
  ) => selectedAgent ? (
    <AgentSettingsPanel
      key={selectedAgent.id}
      {...agentSettingsSharedProps}
      activeSection={activeSection}
      onSectionChange={onSectionChange}
      showSectionNavigation={showSectionNavigation}
    />
  ) : (
    <div className="flex h-full items-center justify-center bg-background px-6 text-center">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Select an agent</h1>
        <p className="mt-2 text-sm text-text-muted">Choose or create an agent before opening these settings.</p>
      </div>
    </div>
  );

  const explicitSettingsAgent = requestedAgentId
    ? accountAgents.find((agent) => agent.id === requestedAgentId) ?? null
    : null;
  const explicitSettingsAgentReady = Boolean(
    explicitSettingsAgent && selectedAgent?.id === explicitSettingsAgent.id,
  );
  const agentSettingsSelector = (
    <SettingsAgentSelector
      agents={orderedRosterAgents}
      loading={agentsLoading}
      error={agentsLoadError}
      onSelect={selectSettingsAgent}
      onRetry={() => fetchAgents({ force: true }).then(() => undefined)}
      onCreateAgent={openAgentLauncherFromCurrentSection}
      filterInputRef={settingsAgentFilterRef}
    />
  );
  useEffect(() => {
    if (!explicitSettingsAgentReady || !focusScopedAgentSettingsRef.current) return;
    focusScopedAgentSettingsRef.current = false;
    const timeout = window.setTimeout(() => scopedAgentSettingsRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [explicitSettingsAgentReady]);
  useEffect(() => {
    if (requestedAgentId || accountSettingsSection !== "agent" || !focusAgentSettingsListRef.current) return;
    focusAgentSettingsListRef.current = false;
    const timeout = window.setTimeout(() => settingsAgentFilterRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [accountSettingsSection, requestedAgentId]);
  const renderScopedAgentSettings = (section: AgentSettingsSection) => explicitSettingsAgent ? (
    explicitSettingsAgentReady ? (
      <section
        ref={scopedAgentSettingsRef}
        aria-label={`${agentDisplayLabel(explicitSettingsAgent)} settings`}
        tabIndex={-1}
        className="h-full min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {renderAgentSettingsPanel(section, false)}
      </section>
    ) : (
      <div role="status" className="flex h-full items-center justify-center gap-2 bg-background px-6 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Opening agent settings
      </div>
    )
  ) : agentSettingsSelector;

  const settingsMembersHref = `${buildDashboardViewHref("settings", { agentId: requestedAgentId })}&settings=members`;
  const showMobileSettingsMenu = !searchParams.has("settings");
  const settingsSectionContent = accountSettingsSection === "preferences" ? (
    <AccountSettingsPanel />
  ) : accountSettingsSection === "workspace" ? (
    <WorkspaceOverviewPanel
      accountAgents={accountAgents}
      workspaceAgents={workspaceAgents}
      agentsLoading={agentsLoading}
      workspaceAgentsLoading={agentsLoading || isAgentRosterLoading}
      agentCreationDisabledReason={agentCreationBlockedReason}
      agentsHref={selectedAgentHref}
      knowledgeHref={knowledgeSectionHref}
      membersHref={settingsMembersHref}
      onOpenMembers={() => selectAccountSettingsSection("members")}
      onOpenAgentLauncher={() => {
        openAgentLauncherFromCurrentSection();
      }}
    />
  ) : accountSettingsSection === "members" ? (
    <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-7 sm:px-6 lg:px-8">
      <MembersSection agents={accountAgents} agentsLoading={agentsLoading} />
    </div>
  ) : accountSettingsSection === "api-keys" ? (
    <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <ApiKeysSettingsPanel />
      </div>
    </div>
  ) : accountSettingsSection === "billing" ? (
    <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <ProfileBillingSection getToken={getToken} />
      </div>
    </div>
  ) : accountSettingsSection === "plans" ? (
    <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <PlansPage />
      </div>
    </div>
  ) : accountSettingsSection === "agent" ? (
    renderScopedAgentSettings("agent")
  ) : accountSettingsSection === "memory-index" ? (
    renderAgentSettingsPanel("index", false)
  ) : (
    renderAgentSettingsPanel("general", false)
  );
  const settingsContent = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SettingsSectionHeader
        activeSection={accountSettingsSection}
        onBackToSettings={!isDesktopViewport ? openMobileSettingsMenu : undefined}
        agentName={accountSettingsSection === "agent" && explicitSettingsAgent
          ? agentDisplayLabel(explicitSettingsAgent)
          : undefined}
        onBackToAgents={accountSettingsSection === "agent" && explicitSettingsAgent
          ? openSettingsAgentList
          : undefined}
      />
      {accountSettingsSection === "workspace" || accountSettingsSection === "members" ? (
        <SettingsCollectionSelector />
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{settingsSectionContent}</div>
    </div>
  );

  return (
    <AgentGatewaySessionProvider session={gatewayChat}>
      <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header and shared desktop-style navigation. */}
      {!isDesktopViewport && dashboardView !== "settings" && (
        <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
          <header className="relative z-20 grid h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)]">
            <Link
              href="/"
              aria-label="HyperCLI home"
              className="flex h-10 w-8 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
            >
              <HyperCLILogoMark className="h-6 w-6" />
            </Link>
            {dashboardView ? (
              <div className="min-w-0 px-1 text-center">
                <p className="truncate text-xs font-semibold text-foreground">
                  {dashboardView === "overview" ? "Home" : dashboardView === "usage" ? "Usage" : "Settings"}
                </p>
              </div>
            ) : knowledgeSurfaceHeader ? (
              <div data-slot="mobile-dashboard-surface-header" className="flex min-w-0 items-center justify-center gap-2 px-1">
                {knowledgeSurfaceHeader.icon ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]">
                    {knowledgeSurfaceHeader.icon}
                  </span>
                ) : null}
                <div className="min-w-0 text-left">
                  <p className="truncate text-xs font-semibold text-foreground">{knowledgeSurfaceHeader.title}</p>
                  {knowledgeSurfaceHeader.subtitle ? <p className="mt-0.5 truncate text-[9px] text-text-muted">{knowledgeSurfaceHeader.subtitle}</p> : null}
                </div>
              </div>
            ) : selectedAgent && !dashboardView ? (
              <AgentDisplayNameEditor
                key={selectedAgent.id}
                agent={selectedAgent}
                onUpdate={updateAgentDisplayName}
                className="w-full px-1"
              />
            ) : (
              <span aria-hidden="true" />
            )}
            <SheetTrigger asChild>
              <button
                ref={mobileNavigationTriggerRef}
                type="button"
                aria-label="Open navigation"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
              >
                <Menu className="h-6 w-6" />
              </button>
            </SheetTrigger>
          </header>
          <SheetContent
            side="left"
            showCloseButton={false}
            overlayClassName="z-[69] bg-black/65 backdrop-blur-[1px]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              mobileNavigationCloseRef.current?.focus();
            }}
            className="agent-mobile-navigation z-[70] h-dvh w-64 max-w-[calc(100vw-3.5rem)] gap-0 overflow-hidden border-r border-border bg-[var(--agent-panel-background)] p-0 pt-[env(safe-area-inset-top)] shadow-2xl sm:max-w-none motion-reduce:duration-0"
          >
            <SheetTitle className="sr-only">Agent navigation</SheetTitle>
            {mobileNavigation}
          </SheetContent>
        </Sheet>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} onOpenPlanCatalog={openUpgradeCatalog} />

      {checkoutSync && (
        <div
          className={`mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm sm:mx-6 lg:mx-8 ${
            checkoutSync.status === "pending" || checkoutSync.status === "cancelled"
              ? "border-warning/25 bg-warning/10 text-warning"
              : "border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
          }`}
        >
          <span>{checkoutSync.message}</span>
          <div className="flex shrink-0 items-center gap-2">
            {checkoutSync.status === "pending" && (
              <button
                type="button"
                onClick={() => { void refreshCheckoutEntitlements(checkoutSyncPending); }}
                className="rounded-md border border-current/20 px-2 py-1 text-xs font-medium text-current opacity-80 transition hover:opacity-100"
              >
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (user?.id && checkoutSyncPending) {
                  clearPendingPlanCheckout(user.id, checkoutSyncPending);
                }
                clearStripeCheckoutReturnState();
                checkoutReturnHandledRef.current = true;
                dispatchBillingReflection({ type: "DISMISS" });
              }}
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
            onClose={() => {
              setUpgradeCatalogOpen(false);
            }}
            onOpenPlans={() => {
              if (isAuthenticated) leaveAgentsPage("/plans");
              else requestAuthentication({ kind: "navigate", href: "/plans" });
            }}
            onSelectPlan={selectUpgradeProduct}
            onStartTrial={() => beginTeamTrial()}
            trialAvailable={canStartTeamTrial}
            trialCheckoutPending={trialCheckoutPending}
          />
        )}
      </AnimatePresence>

      {upgradeCheckoutPlan && (
        <PlanCheckoutModal
          plan={upgradeCheckoutPlan}
          ownedCount={upgradeCheckoutOwnedCount}
          baselineGrantedSlots={upgradeCheckoutBaselineGrantedSlots}
          principalId={user?.id ?? ""}
          isPrincipalCurrent={() => privatePrincipalRef.current === user?.id}
          isOpen={Boolean(upgradeCheckoutPlan)}
          onClose={() => {
            setUpgradeCheckoutPlan(null);
          }}
          onSuccess={(pending) => { void refreshCheckoutEntitlements(pending); }}
          getToken={getToken}
        />
      )}

      <Dialog
        open={checkoutRecoveryDialogVisible}
        onOpenChange={(open) => {
          setCheckoutRecoveryDialogOpen(open);
          if (!open) {
            setPendingAuthIntent(null);
          }
        }}
      >
        <DialogContent
          closeLabel="Close checkout preparation"
          overlayClassName="z-[10000] bg-background/80 backdrop-blur-sm"
          className="z-[10001] border-border bg-surface-low sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Preparing checkout</DialogTitle>
            <DialogDescription>Checking your current plan before checkout.</DialogDescription>
          </DialogHeader>
          {authLoading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Confirming your account
            </div>
          ) : isAuthenticated && pendingAuthIntent?.kind === "checkout" && billingDataPrincipalId !== user?.id ? (
            billingDataError ? (
              <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <p>{billingDataError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutRecoveryDialogOpen(true);
                    setBillingDataError(null);
                    setAgentsLoading(true);
                    void fetchAgents({ force: true });
                  }}
                  className="rounded-md border border-current/30 px-3 py-1.5 font-medium transition-colors hover:bg-destructive/10"
                >
                  Retry billing data
                </button>
              </div>
            ) : (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading billing data
              </div>
            )
          ) : (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Continuing
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChannelCreationWizard
        open={showChannelWizard}
        onClose={() => setShowChannelWizard(false)}
        availableAgents={agents.map((a) => ({
          id: a.id,
          name: agentDisplayLabel(a),
          type: "agent" as const,
          meta: a.meta ?? null,
          avatarUrl: agentProfileImageUrl(a),
        }))}
        availableUsers={MOCK_PARTICIPANTS.filter((p) => p.type === "user")}
        onCreate={async (channel) => {
          // TODO: raise an SDK/API requirement for channel creation. For now, log and close.
          console.log("Create channel:", channel);
        }}
      />
      <CollectionCreationDialog
        open={workspaceCreationOpen}
        onOpenChange={setWorkspaceCreationOpen}
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
        confirmTestId="agent-danger-delete-confirm"
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
      {AGENT_DASHBOARD_TOUR_ENABLED ? (
        <AgentDashboardTour
          open={agentTourOpen}
          onOpenChange={setAgentTourOpen}
          onSkipTour={skipAgentTour}
          onCreateAccount={createAccountFromTour}
        />
      ) : null}

      {/* Main layout: AgentList + AgentMainPanel + AgentInspector */}
      <div className="flex flex-1 min-h-0">
        {isDesktopViewport && (dashboardView === "settings" ? (
          <SettingsMenu
            activeSection={accountSettingsSection}
            backHref={selectedAgentHref}
            onSectionChange={selectAccountSettingsSection}
          />
        ) : (
        <div
          className="agent-desktop-navigation relative flex h-full min-h-0 w-64 shrink-0 flex-col pt-14"
          data-roster-collapsed={effectiveSidebarCollapsed}
          data-expanded-section={effectiveSidebarCollapsed ? "workspace" : "agents"}
        >
          <div className="agent-desktop-navigation-sections relative isolate mt-2 flex min-h-0 w-full flex-1">
          <AgentList
            sidebarCollapsed={effectiveSidebarCollapsed}
            isDesktopViewport={isDesktopViewport}
            mobileShowChat={mobileMainPanelVisible}
            agents={agents}
            rosterLoading={agentsLoading || isAgentRosterLoading}
            rosterOrderScope={selectedWorkspaceId}
            selectedAgentId={selectedAgentId}
            setSelectedAgentId={selectAgentFromRoster}
            setMobileShowChat={setMobileShowChat}
            setSidebarCollapsed={setEffectiveSidebarCollapsed}
            syntheticThreads={syntheticThreads}
            agentCardDataById={agentCardDataById}
            getToken={getToken}
            createOpenClawAgent={createOpenClawAgent}
            onCreateAgent={handleCreateFirstAgent}
            associateCreatedAgent={assignAgentToCollection}
            agentLauncherSuspended={agentLauncherSuspended}
            agentCreationDisabledReason={agentCreationDisabledReason}
            fetchAgents={refreshAgentsForChildren}
            setError={setError}
            sidebarCreatorSignal={0}
            onOpenAgentLauncher={() => {
              openAgentLauncherFromCurrentSection();
            }}
            setPendingAgentDelete={setPendingAgentDelete}
            accountInitial={accountInitial}
            accountAvatarUrl={accountAvatarUrl}
            accountName={dashboardDisplayName}
            accountEmail={user?.email ?? null}
            onLogin={!isAuthenticated ? () => requestAuthentication({ kind: "navigate", href: "/dashboard/agents" }) : undefined}
            onLogout={isAuthenticated ? logout : undefined}
            budget={budget}
            subscriptionSummary={subscriptionSummary}
            catalogPlans={catalogPlans}
            preferredPlanId={launcherPreferredPlanId}
            pendingSlotReleases={pendingSlotReleases}
            onOpenPlanCatalog={openUpgradeCatalog}
            onOpenHome={openDashboardHome}
            homeActive={dashboardView === "overview"}
            homeHref={dashboardViewHrefs.overview}
            onOpenKnowledgeHub={openKnowledgeHub}
            knowledgeHubActive={knowledgeHubSectionActive}
            knowledgeHubHref={knowledgeHubSectionHref}
            onOpenMembers={openMembersTab}
            membersActive={membersSectionActive}
            membersHref={membersSectionHref}
            onOpenUsage={openDashboardUsage}
            usageActive={dashboardView === "usage"}
            usageHref={dashboardViewHrefs.usage}
            onOpenAccountSettings={openAccountSettings}
            embeddedInNavigation
          />

          <AgentWorkspaceSidebar
            selectedAgent={selectedAgent}
            activeTab={anonymousDesktopPreviewMode ? null : dashboardView ? null : openclawSettingsOpen && selectedAgent ? "openclaw" : mainTab}
            skillsActive={!anonymousDesktopPreviewMode && mainTab === "skills"}
            tokenUsed={tokenUsage}
            tokenLimit={tokenLimit}
            isAuthenticated={isAuthenticated}
            activeTrial={activeTrial}
            canStartTrial={canStartTeamTrial}
            trialCheckoutPending={trialCheckoutPending}
            disabled={workspaceSidebarDisabled}
            disabledReason={workspaceSidebarDisabledReason}
            allowAgentlessFeaturePreviews={anonymousAgentPreviewMode}
            desktopPreviewActive={anonymousDesktopPreviewMode}
            scheduledDisabled={!SCHEDULED_SECTION_ENABLED && !anonymousAgentPreviewMode}
            scheduledDisabledReason={SCHEDULED_SECTION_DISABLED_REASON}
            isDesktopViewport={isDesktopViewport}
            collapsed={!effectiveSidebarCollapsed}
            onCollapsedChange={(collapsed) => setEffectiveSidebarCollapsed(!collapsed)}
            embeddedInNavigation
            sessions={userVisibleChatSessions}
            activeUnindexedInitialSession={chat.activeUnindexedInitialSession}
            sessionsFetched={chat.sessionsFetched}
            creatingSessionKeys={chat.creatingSessionKeys}
            thinkingSessionKeys={chat.thinkingSessionKeys}
            selectedSessionKey={selectedSessionKey}
            pinnedSessionKeys={pinnedSessionKeys}
            onSelectSession={selectSession}
            onSetSessionPinned={setSessionPinned}
            onRenameSession={renameSession}
            onDeleteSession={deleteSession}
            onCreateSession={createSession}
            onOpenFiles={openFilesFromNavigation}
            onOpenIntegrations={openIntegrationsFromNavigation}
            onOpenSkills={openSkillsFromNavigation}
            onOpenScheduled={openScheduledFromNavigation}
            onOpenDesktop={openDesktopTab}
            onOpenDesktopPreview={openDesktopPreviewFromNavigation}
            onOpenLogs={openLogsTab}
            onOpenShell={openShellTab}
            onShellIntent={prepareShell}
            onShellIntentEnd={cancelShellIntent}
            onOpenOpenClaw={openOpenClawSettings}
            onOpenSettings={openAgentAccountSettings}
            settingsActive={false}
            onUpgrade={() => { void openUpgradeCatalog(); }}
            onStartTrial={beginTeamTrial}
            onManageTrial={() => { selectAccountSettingsSection("billing"); }}
          />
          <div aria-hidden="true" className="pointer-events-none absolute -top-2 bottom-0 right-0 z-[60] w-px bg-border" />
          </div>
        </div>
        ))}

          <div className={dashboardView ? "hidden" : "contents"}>
          <AgentMainPanel
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileMainPanelVisible}
          selectedAgent={selectedAgent}
          showAgentlessSectionPreviews={anonymousAgentPreviewMode}
          showAgentlessDesktopPreview={anonymousDesktopPreviewMode}
          hasAgents={agents.length > 0}
          loadingInitialAgents={agentRosterTruthPending}
          isSelectedRunning={Boolean(isSelectedRunning)}
          burstAgentId={burstAgentId}
          onBurstComplete={() => setBurstAgentId(null)}
          agentStatus={agentStatus}
          activeConnectionStatus={activeConnectionStatus}
          chatConnected={chat.connected}
           chatConnecting={chat.connecting}
           sessionReturnTarget={selectedSessionReturnTarget}
          surfaceHeader={knowledgeSurfaceHeader}
          startingId={startingId}
          restoringId={restoringId}
          recentlyStoppedIds={recentlyStoppedIds}
          selectedAgentLaunchBlocked={selectedAgentLaunchBlocked}
          selectedAgentStartGuidanceTitle={selectedAgentStartBlockedTitle}
          blockedMessage={selectedAgentStartBlockedMessage}
          suggestedTierActions={selectedAgentSuggestedTierActions}
          currentPanel={selectedCenterPanel}
          skillsPanelActive={mainTab === "skills"}
          stoppedTabLabel={stoppedTabLabel[selectedCenterPanel]}
          headerAction={renderPrivateChatControl()}
          onUpdateAgentDisplayName={updateAgentDisplayName}
          launcherContent={agentLauncherOpen ? (
            <div
              aria-hidden={agentLauncherSuspended || undefined}
              className={`flex min-h-0 min-w-0 flex-1 ${agentLauncherSuspended ? "invisible pointer-events-none" : ""}`}
            >
              <AgentCreationSetupWizard
                key={agentLauncherGeneration}
                size="embedded"
                saveDraftAsYouGo={!isAuthenticated}
                skipPlanSelection
                capacityReady={!agentsLoading && (!isAuthenticated || Boolean(user?.id && billingDataPrincipalId === user.id))}
                capacityError={isAuthenticated ? billingDataError : null}
                onRetryCapacity={() => {
                  setBillingDataError(null);
                  void refreshAgentEnrichment({ force: true });
                }}
                capacityContent={(
                  <UpgradePlanCatalogContent
                    embedded
                    products={upgradeProducts}
                    ownedCounts={upgradeOwnedCounts}
                    loading={upgradeCatalogLoading}
                    error={upgradeCatalogError ?? billingDataError}
                    onSelectPlan={selectEmbeddedUpgradeProduct}
                    onStartTrial={beginEmbeddedTeamTrial}
                    onOpenPlans={() => {
                      if (isAuthenticated) leaveAgentsPage("/plans");
                      else requestAuthentication({ kind: "navigate", href: "/plans" });
                    }}
                    trialAvailable={canStartTeamTrial}
                    trialCheckoutPending={trialCheckoutPending}
                  />
                )}
                checkoutActive={Boolean(embeddedCheckoutPlan)}
                checkoutContent={embeddedCheckoutPlan ? (
                  <EmbeddedPlanCheckout
                    key={embeddedCheckoutPlan.id}
                    plan={embeddedCheckoutPlan}
                    ownedCount={embeddedCheckoutOwnedCount}
                    baselineGrantedSlots={upgradeCheckoutBaselineGrantedSlots}
                    principalId={user?.id ?? ""}
                    isPrincipalCurrent={() => pageActiveRef.current && privatePrincipalRef.current === user?.id}
                    getToken={getToken}
                    onSuccess={(pending) => { void refreshCheckoutEntitlements(pending); }}
                    onComplete={() => {
                      setEmbeddedCheckoutProcessing(false);
                      setEmbeddedCheckoutPlan(null);
                    }}
                    onProcessingChange={setEmbeddedCheckoutProcessing}
                    firstAgentSetup={embeddedFirstAgentSetup}
                  />
                ) : null}
                checkoutProcessing={embeddedCheckoutProcessing}
                onBackFromCheckout={() => {
                  if (embeddedCheckoutProcessing) return;
                  embeddedCheckoutSelectionRequestRef.current += 1;
                  setEmbeddedCheckoutPlan(null);
                }}
                onStartFresh={() => {
                  const principalId = user?.id ?? null;
                  const pending = principalId ? readPendingPlanCheckout(principalId) : null;
                  if (
                    principalId
                    && isFirstAgentSetupCheckout(pending)
                    && firstAgentSetupDraft?.setupId === pending.setupId
                  ) {
                    clearPendingPlanCheckout(principalId, pending);
                  }
                  clearFirstAgentSetupDraft();
                  setPaidFirstAgentCheckout(null);
                  setCheckoutReturnRecoveryActive(false);
                  embeddedCheckoutSelectionRequestRef.current += 1;
                  setEmbeddedCheckoutPlan(null);
                  setEmbeddedCheckoutProcessing(false);
                  setLauncherSelectedCatalogPlanId(null);
                  setAgentLauncherGeneration((generation) => generation + 1);
                }}
                onClose={() => {
                  if (embeddedCheckoutProcessing) return;
                  closeAgentCreationFlowAndReturn();
                }}
                initialPlanId={launcherPreferredPlanId}
                selectedCatalogPlanId={launcherSelectedCatalogPlanId}
                budget={budget}
                subscriptionSummary={subscriptionSummary}
                catalogPlans={catalogPlans}
                pendingSlotReleases={pendingSlotReleases}
                onOpenPlanCatalog={(planId) => {
                  return openUpgradeCatalog(planId);
                }}
                onGenerateBootstrap={generateOpenClawBootstrap}
                onCreateAgent={createAgentFromLauncher}
                draftPrincipalId={user?.id ?? null}
                draftWorkspaceId={selectedWorkspaceId}
                knowledgeCollections={workspaces.map((workspace) => ({
                  id: workspace.id,
                  name: workspaceDisplayName(workspace),
                  role: workspace.role,
                }))}
                knowledgeCollectionsLoading={workspacesLoading}
              />
            </div>
          ) : checkoutReturnRecoveryActive ? (
            <div data-slot="paid-first-agent-recovery" className="min-h-0 flex-1">
              <AgentLoadingState
                title="Preparing your agent"
                detail={checkoutSync?.message ?? "Confirming your new capacity and restoring the setup you saved before payment."}
                tone="loading"
                stage="runtime"
              />
            </div>
          ) : null}
          persistentPanelContent={shellEnabled ? (
            <AgentShellController
              ref={shellControllerRef}
              deployments={deployments}
              agentId={selectedAgentId}
              visible={!agentLauncherOpen && !dashboardView && mainTab === "shell" && Boolean(isSelectedRunning)}
              prewarm={shellIntentAgentId === selectedAgentId}
              getDeployments={getFreshShellDeployments}
              onStatusChange={setShellStatus}
            />
          ) : null}
          panelContent={mainTab === "chat" ? (
            <AgentChatPanel
              chat={gatewayChat}
              selectedAgent={selectedAgent!}
              userAvatarUrl={accountAvatarUrl}
              userName={chatGreetingName}
              isDesktopViewport={isDesktopViewport}
              isSelectedRunning={Boolean(isSelectedRunning)}
              chatDragActive={chatDragActive}
              setChatDragActive={setChatDragActive}
              chatDragDepthRef={chatDragDepthRef}
              handleChatFileDrop={handleChatFileDrop}
              chatFilesUploading={uploadingChatFiles > 0}
              chatFileUploadProgress={chatFileUploadProgress}
              pendingFileRemovalStates={pendingFileRemovalStates}
              onRemovePendingFile={removePendingChatFile}
              chatScrollRef={chatScrollRef}
              handleChatScroll={handleChatScroll}
              onTranscriptResize={handleTranscriptResize}
              onRequestTranscriptScroll={scheduleChatScroll}
              recording={recording}
              audioLevel={audioLevel}
              recordingDuration={recordingDuration}
              stopRecording={stopRecording}
              audioUrl={audioUrl}
              audioPreviewPlaying={audioPreviewPlaying}
              preparingAudioPreview={preparingAudioPreview}
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
              onReadGatewayMediaBytesFromChat={gatewayChat.readGatewayMediaBytes}
              onOpenFileFromChat={openFilesTab}
              onDownloadFileFromChat={downloadAgentFileFromChat}
              fileReferenceCandidates={chatFileReferenceCandidates}
              skillDraftTestBanner={activeSkillDraftTest.testSession ? (
                <SkillDraftTestBanner
                  testSession={activeSkillDraftTest.testSession}
                  onOpenDraft={() => openSkillsTab(activeSkillDraftTest.testSession?.draftId)}
                  onSaveDraft={agentSkills.capabilities?.createSkill ? saveActiveSkillDraft : undefined}
                />
              ) : undefined}
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
                onOpenBilling: () => leaveAgentsPage(ACCOUNT_PAGE_HREFS.billing),
                onNewConversation: createSession,
                onStartAgent: selectedAgent && isAgentStartable(selectedAgent)
                  ? async () => { await handleLaunchLifecycleAction(selectedAgent.id); }
                  : undefined,
                onStopAgent: async () => {
                  if (selectedAgent) await handleStop(selectedAgent.id);
                },
                onNewAgent: () => {
                  openAgentCreationFlow();
                },
                onRenameAgent: async (name) => {
                  if (!selectedAgent) return;
                  await updateAgentCanonicalName(selectedAgent.id, name);
                },
                onOpenAgentSettings: openAgentSettingsTab,
                onCreateDirectory: async (name) => {
                  await createAgentDirectory(`${OPENCLAW_WORKSPACE_PREFIX}/${name}`);
                },
              }}
            />
          ) : mainTab === "desktop" ? (
            <AgentDesktopEmptyState
              onCreate={() => undefined}
              desktopEnabled={selectedAgent?.hasDesktop === true}
              settingsHref={selectedAgentId
                ? `${buildAgentSettingsHref(selectedAgentId)}#agent-desktop-setting`
                : undefined}
              launching={openingDesktopId === selectedAgent?.id}
              launchBlocked={selectedAgent?.hasDesktop === true && (
                selectedAgent.state !== "RUNNING" || !selectedAgent.hostname
              )}
              launchBlockedReason={selectedAgent?.hasDesktop === true
                ? selectedAgent.state !== "RUNNING"
                  ? "Start the agent before launching its desktop."
                  : !selectedAgent.hostname
                    ? "Desktop hostname is not ready."
                    : undefined
                : undefined}
              onLaunchAction={() => {
                if (selectedAgent?.hasDesktop) void handleOpenDesktop(selectedAgent);
              }}
            />
          ) : mainTab === "files" ? (
            <AgentFilesPanel
              key={`${selectedAgent?.id ?? "no-agent"}:${filesSyncRoot}`}
              agentId={selectedAgentId}
              agentName={selectedAgent ? agentDisplayLabel(selectedAgent) : "Agent"}
              rootPath={filesSyncRoot}
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
              slackOAuthResult={slackOAuthResult}
              slackOAuthError={slackOAuthError}
              detailBackLabel={directoryDetailOrigin === "chat" ? "Back to chat" : undefined}
              onDetailBack={directoryDetailOrigin === "chat" ? openChatTab : undefined}
              agentId={selectedAgent?.id ?? selectedAgentId}
              agentName={selectedAgent ? agentDisplayLabel(selectedAgent) : "Agent"}
              agentPublicUrl={selectedOpenClawAgent?.publicUrl ?? (selectedAgent?.hostname ? `https://${selectedAgent.hostname}` : null)}
              gatewaySession={gatewayChat}
              channelsProvider={chat.channelsProvider}
              reportedChannels={chat.reportedChannels}
              reportedChannelSnapshot={chat.reportedChannelSnapshot}
              reportedChannelsReady={chat.reportedChannelsReady}
              reportedChannelsError={chat.reportedChannelsError}
              onRefreshChannels={chat.refreshReportedChannels}
              config={chat.config as Record<string, unknown> | null}
              connected={chat.connected}
              onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
              onChannelProbe={async () => chat.channelsStatus(true)}
              onOpenShell={openShellTab}
            />
          ) : mainTab === "skills" ? (
            <SkillsPanel
              key={selectedAgent?.id ?? "no-agent"}
              agentName={selectedAgent ? agentDisplayLabel(selectedAgent) : "Agent"}
              draftScope={skillDraftScope}
              connected={chat.connected}
              isDesktopViewport={isDesktopViewport}
              installedSkills={agentSkills.skills}
              loading={agentSkills.loading}
              error={agentSkills.error}
              recoveryCandidates={agentSkills.recoveryCandidates}
              recoveryError={agentSkills.recoveryError}
              requestedSkillId={requestedSkillId}
              onUpdateSkill={agentSkills.capabilities?.configure ? agentSkills.update : undefined}
              onLoadSkillDocument={agentSkills.capabilities?.readDocument ? agentSkills.loadDocument : undefined}
              skillResourceOperations={agentSkills.resourceOperations}
              onCreateSkill={agentSkills.capabilities?.createSkill ? agentSkills.create : undefined}
              onRefreshSkills={agentSkills.refresh}
              onRecoverSkill={agentSkills.capabilities?.recoverSkill ? agentSkills.recover : undefined}
              onGenerateSkill={chat.ready ? chat.runEphemeralPrompt : undefined}
              onTestSkill={testSkillInNewSession}
            />
          ) : mainTab === "knowledge-hub" ? (
            <KnowledgeHub
              agents={accountAgents}
              agentsLoading={agentsLoading}
              agentsError={agentsLoadError}
              initialCollectionId={requestedKnowledgeCollectionId}
              onRefreshAgents={refreshAgentsForChildren}
              onNavigateCollection={openKnowledgeHubSurface}
              onSelectedCollectionChange={handleKnowledgeCollectionChange}
              headerControlsTargetId={KNOWLEDGE_HUB_SURFACE_CONTROLS_ID}
            />
          ) : mainTab === "knowledge" ? (
            <div className="h-full overflow-y-auto bg-background px-4 py-6 sm:px-6 lg:px-8">
              <SharedKnowledgeSection
                agents={accountAgents}
                agentsLoading={agentsLoading}
                agentsError={agentsLoadError}
                preferredAgentId={selectedAgentId ?? requestedAgentId}
              />
            </div>
          ) : mainTab === "members" ? (
            <div className="h-full overflow-y-auto bg-background px-4 py-6 sm:px-6 lg:px-8">
              <MembersSection agents={accountAgents} agentsLoading={agentsLoading} />
            </div>
          ) : mainTab === "scheduled" ? (
            <AgentScheduledPanel
              key={`${selectedAgent?.id ?? "agent"}:${scheduledInitialCommand?.id ?? 0}`}
              agentName={selectedAgent ? agentDisplayLabel(selectedAgent) : "Agent"}
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
              onLaunchAgent={selectedAgent
                && selectedAgentLaunchLifecycleAction
                && startingId !== selectedAgent.id
                && restoringId !== selectedAgent.id
                ? async () => {
                    await handleLaunchLifecycleAction(selectedAgent.id);
                  }
                : undefined}
              launchActionLabel={selectedAgentLaunchLifecycleAction === "restore" ? "Restore agent" : "Start agent"}
              initialCommand={scheduledInitialCommand?.command ?? null}
            />
          ) : mainTab === "settings" ? (
            dashboardView ? null : renderAgentSettingsPanel(agentSettingsSection, true, setAgentSettingsSection)
          ) : mainTab === "logs" ? (
            <AgentLogsController
              ref={logsControllerRef}
              deployments={deployments}
              agentId={selectedAgentId}
              onStatusChange={setLogsStatus}
            />
          ) : mainTab === "shell" ? (
            null
          ) : null}
          onCreate={anonymousAgentPreviewMode ? launchAgentFromPreview : () => {
            openAgentCreationFlow();
          }}
          onCreateAgent={handleCreateFirstAgent}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          preferredPlanId={launcherPreferredPlanId}
          pendingSlotReleases={pendingSlotReleases}
          onOpenPlanCatalog={openUpgradeCatalog}
          workspaceName={selectedWorkspace ? workspaceDisplayName(selectedWorkspace) : null}
          hasAccountAgents={accountAgents.length > 0}
          creationDisabledReason={agentCreationBlockedReason}
          onCreateWorkspace={shouldOfferWorkspaceCreation ? openWorkspaceCreationFlow : undefined}
          onOpenMembers={openMembersTab}
          onShowList={() => setMobileShowChat(false)}
          showMobileListButton={false}
          onShowInspector={() => setInspectorSheetOpen(true)}
          showInspectorButton={SHOW_AGENT_INSPECTOR}
          onStart={() => {
            if (selectedAgent) {
              void handleLaunchLifecycleAction(selectedAgent.id);
            }
          }}
          onRestore={() => {
            if (selectedAgent) {
              void handleLaunchLifecycleAction(selectedAgent.id);
            }
          }}
          onStop={selectedAgent && isAgentStoppable(selectedAgent)
            ? () => { void handleStop(selectedAgent.id); }
            : undefined}
          onReconnect={() => {
            if (mainTab === "logs") logsControllerRef.current?.reconnect();
            if (mainTab === "shell") shellControllerRef.current?.reconnect();
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
              onAgentStart: () => { if (selectedAgent) void handleLaunchLifecycleAction(selectedAgent.id); },
              onAgentRestore: () => { if (selectedAgent) void handleLaunchLifecycleAction(selectedAgent.id); },
              onAgentStop: () => { if (selectedAgent) void handleStop(selectedAgent.id); },
              agentStarting: selectedAgentStarting,
              agentRestoring: Boolean(selectedAgent && restoringId === selectedAgent.id),
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

        {dashboardView ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            {dashboardView === "overview" ? (
              <AccountOperationsHome
                sdkAgents={accountSdkAgents}
                agents={accountAgents}
                workspaces={workspaces}
                spaceAccessClient={workspacesClient}
                displayName={suggestedJourneyUserName}
                agentsLoading={agentsLoading}
                agentsError={agentsLoadError}
                workspacesLoading={workspacesLoading}
                workspacesError={workspacesError}
                dailyTokenUsage={dailyTokenUsage}
                dailyTokenLimit={dailyTokenLimit}
                tokenUsageLoading={tokenUsageLoading}
                agentCreationDisabledReason={agentCreationBlockedReason}
                onOpenAgent={selectAgentFromRoster}
                onOpenConversation={openActivityConversation}
                onOpenScheduled={openActivityScheduled}
                onOpenCollection={openActivityCollection}
                onOpenKnowledge={openKnowledgeHub}
                onOpenUsage={() => openDashboardView("usage")}
                onOpenAgentLauncher={() => {
                  openAgentLauncherFromCurrentSection();
                }}
              />
            ) : dashboardView === "usage" ? (
              <WorkspaceUsagePanel
                accountAgentCount={accountAgents.length}
                workspaceAgents={workspaceAgents}
                rosterError={agentRosterError}
              />
            ) : isDesktopViewport ? (
              settingsContent
            ) : (
              <div className="h-full min-h-0 bg-background">
                <section
                  ref={mobileSettingsMenuRef}
                  aria-label="Settings"
                  tabIndex={-1}
                  className={`${showMobileSettingsMenu ? "h-full" : "hidden"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                >
                  <SettingsMenu
                    activeSection={accountSettingsSection}
                    backHref={selectedAgentHref}
                    onSectionChange={selectAccountSettingsSection}
                    className="w-full border-r-0"
                  />
                </section>
                <div className={showMobileSettingsMenu ? "hidden" : "h-full min-h-0"}>{settingsContent}</div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <OpenClawSettingsDrawer
        open={!dashboardView && openclawSettingsOpen && Boolean(selectedAgent)}
        onClose={closeOpenClawSettings}
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

      {!dashboardView && !journeyChatSurfaceVisible ? (
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
