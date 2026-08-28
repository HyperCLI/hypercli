"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentPlan,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import {
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  MoreHorizontal,
  Rocket,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import {
  updateFirstAgentSetupDraftPlan,
  useFirstAgentSetupDraft,
} from "@/hooks/useFirstAgentSetupDraft";
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { isDashboardReleaseSurfaceAvailable } from "@/lib/dashboard-release-boundary";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { ActivateCodeModal } from "@/components/ActivateCodeModal";
import { formatTokens } from "@/lib/format";
import { Skeleton } from "@/components/dashboard/Skeleton";
import {
  clearPendingPlanCheckout,
  clearStripeCheckoutReturnState,
  getCheckoutReflectionStatus,
  getLaunchSlotInventoryFromSummary,
  getGrantedLaunchSlotsByTier,
  getPlanOwnedCountFromSummary,
  markPendingPlanCheckoutReturned,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
  type FirstAgentTrialCheckoutContext,
  type PendingPlanCheckout,
} from "@/lib/plan-checkout-state";
import { bundleKey, compactBundle, formatBundle, type SlotBundle } from "@/lib/subscriptions";
import type { SdkAgent } from "@/types";
import {
  notifyBillingPlanChanged,
  RecoveryDetails,
  RecoveryState,
  resolveCatalogPlanTier,
  type PlanTier,
} from "@hypercli/shared-ui";

interface DisplayProduct {
  id: string;
  name: string;
  bundle: SlotBundle;
  price: number;
  features: string[];
  highlighted: boolean;
  planTier: PlanTier;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
  slotBundle: string | null;
  subtitle?: string;
}

interface CheckoutPlan {
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

interface PlanRecovery {
  title: string;
  description: string;
}

type CheckoutSyncState = {
  status: "syncing" | "success" | "pending" | "cancelled";
  message: string;
  pending?: PendingPlanCheckout | null;
};

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
  subtitle?: string | null;
};

const CORE_PLAN_FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_PLAN_FETCH_TIMEOUT_MS = 4_000;
const CHECKOUT_IDENTITY_HYDRATION_WAIT_MS = 15_000;

function readFirstAgentSetupIntentId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("intent") !== "first-agent-setup") return null;
  return params.get("setup")?.trim() || null;
}

function primaryLaunchTier(bundle: Record<string, number> | null | undefined): string | null {
  return ["large", "medium", "small", "free"].find((tier) => Number(bundle?.[tier] || 0) > 0) ?? null;
}

function firstAgentCheckoutRecoveryHref(pending: PendingPlanCheckout): string {
  const params = new URLSearchParams({
    checkout: "success",
    session_id: pending.returnSessionId ?? "",
  });
  if (pending.checkoutAttemptId) params.set("checkout_attempt", pending.checkoutAttemptId);
  return `/dashboard/agents?${params.toString()}`;
}

function isFirstAgentSetupCheckout(pending: PendingPlanCheckout | null | undefined): boolean {
  return (
    pending?.flow === "first-agent-setup"
    || pending?.flow === "first-agent-trial"
  ) && Boolean(pending.setupId && pending.agentSize);
}

function normalizeBundle(value: unknown): SlotBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([tier, count]) => [tier, Number(count)] as const)
    .filter(([, count]) => Number.isFinite(count) && count > 0);

  return Object.fromEntries(entries) as SlotBundle;
}

function firstBundle(...bundles: unknown[]): SlotBundle {
  for (const bundle of bundles) {
    const normalized = normalizeBundle(bundle);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }
  return {};
}

function bundleFromSubscription(subscription: HyperAgentSubscription): SlotBundle {
  const metaBundle = compactBundle(
    (subscription.meta?.bundle as Record<string, number> | undefined) ??
      (subscription.meta?.checkout_bundle as Record<string, number> | undefined),
  );
  if (Object.keys(metaBundle).length > 0) {
    return metaBundle;
  }

  const derived: Record<string, number> = {};
  for (const [tier, granted] of Object.entries(subscription.slotGrants ?? {})) {
    const total = Math.max(Number(granted || 0), 0) * Math.max(subscription.quantity || 1, 1);
    if (total > 0) {
      derived[tier] = total;
    }
  }
  if (Object.keys(derived).length > 0) {
    return compactBundle(derived);
  }
  if (subscription.planId === "free") {
    return { free: Math.max(subscription.quantity || 1, 1) };
  }
  return {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function buildDisplayProducts(catalogPlans: HyperAgentPlan[]): DisplayProduct[] {
  return catalogPlans
    .filter(isVisibleCurrentAgentPlan)
    .map((plan) => {
      const catalogPlan = plan as CatalogPlan;
      const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
      const bundle = firstBundle(
        catalogPlan.bundle,
        catalogPlan.checkoutBundle,
        catalogPlan.checkout_bundle,
        catalogPlan.meta?.bundle,
        catalogPlan.meta?.checkout_bundle,
        catalogPlan.slotGrants,
        catalogPlan.slot_grants,
      );
      const tpd = finiteNumber(limits.tpd);
      const burstTpm = finiteNumber(
        limits.burstTpm ?? (limits as { burst_tpm?: number }).burst_tpm,
      );
      const rpm = finiteNumber(limits.rpm ?? plan.rpmLimit);

      return {
        id: plan.id,
        name: plan.name,
        bundle,
        price: finiteNumber(catalogPlan.priceUsd ?? catalogPlan.price_usd ?? plan.price),
        features: plan.features ?? [],
        highlighted: Boolean(plan.highlighted),
        planTier: resolveCatalogPlanTier(plan, catalogPlans),
        limits: {
          tpd,
          burstTpm,
          rpm,
        },
        slotBundle: formatBundle(bundle),
        subtitle: catalogPlan.subtitle ?? catalogPlan.meta?.subtitle ?? undefined,
      };
    });
}

function formatShortDate(value: Date | null | undefined): string {
  if (!value) return "Unavailable";
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function billingSourceLabel(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized === "stripe") return "Card billing";
  if (normalized === "x402") return "USDC billing";
  return "Account billing";
}

function billingStatusLabel(status: string): string {
  return status
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ") || "Status unavailable";
}

function PlanIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const normalized = name.toLowerCase();
  if (normalized.includes("solo") || normalized.includes("free")) return <CircleDot className={className} />;
  if (normalized.includes("pro")) return <Rocket className={className} />;
  if (normalized.includes("team")) return <Sparkles className={className} />;
  return <Code2 className={className} />;
}

export default function PlansPage() {
  const { getToken, isIdentityAuthenticated, user } = useAgentAuth();
  const firstAgentSetupDraft = useFirstAgentSetupDraft();
  const requestedFirstAgentSetupId = readFirstAgentSetupIntentId();
  const knowledgeHubAvailable = isDashboardReleaseSurfaceAvailable("knowledge-hub");
  const getTokenRef = useRef(getToken);
  const activePrincipalRef = useRef(user?.id ?? null);
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [agentsById, setAgentsById] = useState<Record<string, SdkAgent>>({});
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(new Set());
  const [billingReadyPrincipalId, setBillingReadyPrincipalId] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<PlanRecovery | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [checkoutSync, setCheckoutSync] = useState<CheckoutSyncState | null>(null);
  const checkoutReturnHandledRef = useRef(false);
  const planRequestRef = useRef(0);
  const checkoutBaselineGrantedSlots = useMemo(() => getGrantedLaunchSlotsByTier(summary), [summary]);
  const firstAgentSetupIntentMatchesDraft = Boolean(
    requestedFirstAgentSetupId
    && firstAgentSetupDraft?.setupId === requestedFirstAgentSetupId
    && (!firstAgentSetupDraft.principalId || firstAgentSetupDraft.principalId === user?.id),
  );
  const checkoutFirstAgentSetup = useMemo<FirstAgentTrialCheckoutContext | undefined>(() => {
    if (!checkoutPlan || !firstAgentSetupIntentMatchesDraft || !firstAgentSetupDraft) return undefined;
    const agentSize = primaryLaunchTier(checkoutPlan.bundle);
    if (!agentSize) return undefined;
    return {
      setupId: firstAgentSetupDraft.setupId,
      ...(knowledgeHubAvailable && firstAgentSetupDraft.workspaceId
        ? { workspaceId: firstAgentSetupDraft.workspaceId }
        : {}),
      knowledgeCollectionId: knowledgeHubAvailable ? firstAgentSetupDraft.knowledgeCollectionId : null,
      agentSize,
    };
  }, [checkoutPlan, firstAgentSetupDraft, firstAgentSetupIntentMatchesDraft, knowledgeHubAvailable]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useLayoutEffect(() => {
    const nextPrincipal = user?.id ?? null;
    if (activePrincipalRef.current !== nextPrincipal) {
      planRequestRef.current += 1;
      setCatalogPlans([]);
      setCurrentPlan(null);
      setSummary(null);
      setAgentsById({});
      setBillingReadyPrincipalId(null);
      setBillingError(null);
      setCheckoutPlan(null);
      setCheckoutSync(null);
      setLoading(true);
      checkoutReturnHandledRef.current = false;
    }
    activePrincipalRef.current = nextPrincipal;
  }, [user?.id]);

  const refreshPlan = useCallback(async () => {
    const principalId = user?.id ?? null;
    if (!principalId) return null;
    const requestId = ++planRequestRef.current;
    const isCurrentRequest = () => (
      requestId === planRequestRef.current && activePrincipalRef.current === principalId
    );
    try {
      const token = await getTokenRef.current();
      if (!isCurrentRequest()) return null;
      const agentClient = createHyperAgentClient(token);
      const [catalog, current, subscriptions, agents] = await Promise.allSettled([
        withTimeout(agentClient.plans(), CORE_PLAN_FETCH_TIMEOUT_MS, "Plan catalog request"),
        withTimeout(agentClient.currentPlan(), CORE_PLAN_FETCH_TIMEOUT_MS, "Current plan request"),
        withTimeout(agentClient.subscriptionSummary(), SUMMARY_PLAN_FETCH_TIMEOUT_MS, "Subscription summary request"),
        withTimeout(createAgentClient(token).list(), CORE_PLAN_FETCH_TIMEOUT_MS, "Agent list request"),
      ]);
      const nextCatalogPlans = catalog.status === "fulfilled" ? catalog.value : [];
      const nextCurrentPlan = current.status === "fulfilled" ? current.value : null;
      const nextSummary = subscriptions.status === "fulfilled" ? subscriptions.value : null;
      if (!isCurrentRequest()) return null;
      setCatalogPlans(nextCatalogPlans);
      setCatalogError(catalog.status === "fulfilled" ? null : "Plan catalog is unavailable right now.");
      setCurrentPlan(nextCurrentPlan);
      setSummary(nextSummary);
      setAgentsById(
        agents.status === "fulfilled"
          ? Object.fromEntries(agents.value.map((agent) => [agent.id, agent]))
          : {},
      );
      setBillingReadyPrincipalId(subscriptions.status === "fulfilled" ? principalId : null);
      setBillingError(subscriptions.status === "fulfilled" ? null : "Billing data could not be loaded. Retry before checkout.");
      return {
        currentPlan: nextCurrentPlan,
        subscriptionSummary: nextSummary,
        billingReady: subscriptions.status === "fulfilled",
      };
    } catch {
      if (isCurrentRequest()) {
        setBillingReadyPrincipalId(null);
        setBillingError("Billing data could not be loaded. Retry before checkout.");
      }
      return null;
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  const refreshCheckoutEntitlements = useCallback(async (targetPending?: PendingPlanCheckout | null) => {
    const principalId = user?.id ?? null;
    if (!principalId) return;
    const pending = targetPending ?? readPendingPlanCheckout(principalId);
    setCheckoutSync({
      status: "syncing",
      message: `Refreshing ${pending?.planName ?? "your plan"} entitlements from billing...`,
      pending,
    });
    const refreshed = await refreshPlan();
    if (activePrincipalRef.current !== principalId) return;
    if (!refreshed?.billingReady) {
      setCheckoutSync({
        status: "pending",
        message: "Billing data could not be loaded. Retry before checking checkout status.",
        pending,
      });
      return;
    }
    const reflectionStatus = getCheckoutReflectionStatus(refreshed?.subscriptionSummary ?? null, pending);

    if (reflectionStatus === "ready") {
      clearPendingPlanCheckout(principalId, pending);
      notifyBillingPlanChanged();
      setCheckoutSync({
        status: "success",
        message: `${pending?.planName ?? "Your plan"} is active. Agent slots and limits are updated.`,
        pending,
      });
      return;
    }

    if (reflectionStatus === "waiting-entitlement") {
      setCheckoutSync({
        status: "pending",
        message: "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
        pending,
      });
      return;
    }

    setCheckoutSync({
      status: "pending",
      message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
      pending,
    });
  }, [refreshPlan, user?.id]);

  useEffect(() => {
    if (checkoutReturnHandledRef.current) return;
    const checkoutReturn = readStripeCheckoutReturnState();
    if (!checkoutReturn) return;
    const principalId = user?.id;
    if (!principalId) return;
    let pending = readPendingPlanCheckout(principalId, {
      sessionId: checkoutReturn.sessionId,
      attemptId: checkoutReturn.attemptId,
    });
    if (!pending) {
      if (!isIdentityAuthenticated) {
        const timeout = window.setTimeout(() => {
          if (activePrincipalRef.current !== principalId) return;
          checkoutReturnHandledRef.current = true;
          clearStripeCheckoutReturnState();
        }, CHECKOUT_IDENTITY_HYDRATION_WAIT_MS);
        return () => window.clearTimeout(timeout);
      }
      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
      return;
    }

    if (isFirstAgentSetupCheckout(pending)) {
      checkoutReturnHandledRef.current = true;
      window.location.replace(`/dashboard/agents${window.location.search}${window.location.hash}`);
      return;
    }

    if (checkoutReturn.status === "cancelled") {
      checkoutReturnHandledRef.current = true;
      clearPendingPlanCheckout(principalId, pending);
      setCheckoutSync({
        status: "cancelled",
        message: "Checkout cancelled. No plan changes were made.",
        pending,
      });
      clearStripeCheckoutReturnState();
      return;
    }

    if (billingReadyPrincipalId !== principalId) {
      setCheckoutSync({
        status: billingError ? "pending" : "syncing",
        message: billingError ?? `Loading billing data for ${pending.planName}...`,
        pending,
      });
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
      return;
    }
    let active = true;
    const planLabel = pending?.planName ? `${pending.planName} plan` : "your plan";
    setCheckoutSync({
      status: "syncing",
      message: `Payment received. Finalizing ${planLabel} setup...`,
      pending,
    });

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    void (async () => {
      let reflectionStatus = getCheckoutReflectionStatus(null, pending);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const refreshed = await refreshPlan();
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
        clearPendingPlanCheckout(principalId, pending);
        notifyBillingPlanChanged();
        setCheckoutSync({
          status: "success",
          message: `${pending?.planName ?? "Your plan"} is active. Agent slots and limits are updated.`,
          pending,
        });
      } else if (reflectionStatus === "waiting-entitlement") {
        setCheckoutSync({
          status: "pending",
          message: "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
          pending,
        });
      } else {
        setCheckoutSync({
          status: "pending",
          message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
          pending,
        });
      }

      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
    })();

    return () => {
      active = false;
    };
  }, [billingError, billingReadyPrincipalId, isIdentityAuthenticated, refreshPlan, user?.id]);

  useEffect(() => {
    if (!checkoutSync || (checkoutSync.status !== "success" && checkoutSync.status !== "cancelled")) return;
    const timer = setTimeout(() => setCheckoutSync(null), 5000);
    return () => clearTimeout(timer);
  }, [checkoutSync]);

  useEffect(() => {
    if (loading || !user?.id || readStripeCheckoutReturnState()) return;
    const pending = readPendingPlanCheckout(user.id);
    if (!pending?.returnSessionId) return;
    if (isFirstAgentSetupCheckout(pending)) {
      window.location.replace(firstAgentCheckoutRecoveryHref(pending));
      return;
    }
    const reflectionStatus = getCheckoutReflectionStatus(summary, pending);
    if (reflectionStatus === "ready") {
      clearPendingPlanCheckout(user.id, pending);
      notifyBillingPlanChanged();
      setCheckoutSync({
        status: "success",
        message: `${pending.planName} is active. Agent slots and limits are updated.`,
        pending,
      });
    } else if (reflectionStatus === "waiting-entitlement") {
      setCheckoutSync({
        status: "pending",
        message: "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
        pending,
      });
    } else {
      setCheckoutSync({
        status: "pending",
        message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
        pending,
      });
    }
  }, [loading, summary, user?.id]);

  const ownedBundles = useMemo(() => {
    const entries = new Map<string, number>();
    for (const subscription of summary?.activeSubscriptions ?? []) {
      const key = bundleKey(bundleFromSubscription(subscription));
      if (key === "{}") continue;
      entries.set(key, (entries.get(key) ?? 0) + 1);
    }
    return entries;
  }, [summary]);

  const ownedPlanCounts = useMemo(() => {
    const entries = new Map<string, number>();
    for (const subscription of summary?.activeSubscriptions ?? []) {
      if (!subscription.planId) continue;
      entries.set(subscription.planId, (entries.get(subscription.planId) ?? 0) + Math.max(subscription.quantity || 1, 1));
    }
    if (summary?.effectivePlanId) {
      const effectiveOwnedCount = getPlanOwnedCountFromSummary(summary, summary.effectivePlanId);
      if (effectiveOwnedCount > 0) {
        entries.set(summary.effectivePlanId, Math.max(entries.get(summary.effectivePlanId) ?? 0, effectiveOwnedCount));
      }
    }
    return entries;
  }, [summary]);

  const slotInventoryEntries = useMemo(() => {
    return Object.entries(summary?.entitlements?.slotInventory ?? summary?.slotInventory ?? currentPlan?.slotInventory ?? {}).sort(
      ([a], [b]) => a.localeCompare(b),
    );
  }, [currentPlan?.slotInventory, summary?.entitlements?.slotInventory, summary?.slotInventory]);

  const billingSubscriptions = useMemo(() => {
    return summary?.subscriptions ?? [];
  }, [summary?.subscriptions]);

  const displayProducts = useMemo(() => buildDisplayProducts(catalogPlans), [catalogPlans]);
  const billingReady = Boolean(user?.id && billingReadyPrincipalId === user.id);
  const launchSlotInventory = useMemo(() => getLaunchSlotInventoryFromSummary(summary), [summary]);
  const legacySubscriptions = useMemo(() => {
    const knownPlanIds = new Set(displayProducts.map((product) => product.id));
    const byId = new Map<string, HyperAgentSubscription>();
    for (const subscription of [...(summary?.activeSubscriptions ?? []), ...billingSubscriptions]) {
      if (!knownPlanIds.has(subscription.planId)) byId.set(subscription.id, subscription);
    }
    return Array.from(byId.values());
  }, [billingSubscriptions, displayProducts, summary?.activeSubscriptions]);

  const pooledTpd = summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0;
  const billingResetAt = useMemo(() => {
    const explicit = summary?.entitlements?.billingResetAt ?? summary?.billingResetAt ?? null;
    if (explicit) return explicit;
    const recurring = [...billingSubscriptions, ...(summary?.activeSubscriptions ?? [])]
      .filter((subscription) => subscription.provider.toLowerCase() === "stripe" && subscription.expiresAt)
      .map((subscription) => subscription.expiresAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());
    return recurring[0] ?? null;
  }, [billingSubscriptions, summary?.activeSubscriptions, summary?.billingResetAt, summary?.entitlements?.billingResetAt]);

  const slotTotals = useMemo(() => {
    return slotInventoryEntries.reduce(
      (totals, [, entry]) => ({ granted: totals.granted + entry.granted, used: totals.used + entry.used }),
      { granted: 0, used: 0 },
    );
  }, [slotInventoryEntries]);

  const monthlySpend = useMemo(() => {
    const prices = new Map(displayProducts.map((product) => [product.id, product.price]));
    return (summary?.activeSubscriptions ?? []).reduce((total, subscription) => {
      if (subscription.provider.toLowerCase() !== "stripe") return total;
      return total + (prices.get(subscription.planId) ?? 0) * Math.max(subscription.quantity || 1, 1);
    }, 0);
  }, [displayProducts, summary?.activeSubscriptions]);

  const activeBundles = useMemo(() => {
    const entitlementItems = summary?.entitlementItems ?? [];
    return displayProducts
      .map((product) => {
        const subscriptions = (summary?.activeSubscriptions ?? []).filter((subscription) => subscription.planId === product.id);
        const entitlements = entitlementItems.filter((entitlement) => entitlement.planId === product.id);
        const ownedCount = Math.max(
          ownedPlanCounts.get(product.id) ?? 0,
          ownedBundles.get(bundleKey(product.bundle)) ?? 0,
          entitlements.length,
        );
        const agentIds = Array.from(new Set(entitlements.flatMap((entitlement) => entitlement.activeAgentIds ?? [])));
        return { product, subscriptions, entitlements, ownedCount, agentIds };
      })
      .filter((bundle) => bundle.ownedCount > 0);
  }, [displayProducts, ownedBundles, ownedPlanCounts, summary?.activeSubscriptions, summary?.entitlementItems]);

  const handleCancelSubscription = async (subscription: HyperAgentSubscription) => {
    if (!subscription.canCancel || subscription.cancelAtPeriodEnd) return;
    if (!window.confirm(`Cancel ${subscription.planName} at the end of the current billing period?`)) return;

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setMutatingSubscriptionId(subscription.id);
    let cancellationConfirmed = false;
    try {
      const agentClient = createHyperAgentClient(await getToken());
      const result = await agentClient.cancelSubscription(subscription.id);
      if (!result.ok) {
        throw new Error(result.message || "The cancellation request was not confirmed.");
      }
      cancellationConfirmed = true;
      setSubscriptionNotice("Cancellation scheduled");
      await refreshPlan();
      notifyBillingPlanChanged();
    } catch {
      setSubscriptionError(cancellationConfirmed ? {
        title: "Refresh to confirm cancellation details",
        description: "The cancellation was scheduled, but the latest billing details did not load. Refresh to see the updated period end.",
      } : {
        title: "Check billing before retrying cancellation",
        description: "Refresh billing before sending this request again. We could not confirm whether the cancellation was applied.",
      });
    } finally {
      setMutatingSubscriptionId(null);
    }
  };

  const formatSubscriptionDate = (subscription: HyperAgentSubscription): string => {
    if (!subscription.expiresAt) {
      return subscription.cancelAtPeriodEnd ? "Ends at period end" : "Renewal date unavailable";
    }
    const label = subscription.cancelAtPeriodEnd ? "Ends" : "Renews";
    return `${label} ${subscription.expiresAt.toLocaleDateString()}`;
  };

  const handleRedeemCode = async (code: string) => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setSubscriptionNotice(null);
      setSubscriptionError({
        title: "Enter an activation code",
        description: "Enter the complete code before activating it.",
      });
      return;
    }

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setRedeemingCode(true);
    let activationConfirmed = false;
    try {
      const agentClient = createHyperAgentClient(await getToken());
      const result = await agentClient.redeemGrantCode(normalizedCode);
      const planLabel = result.entitlement.planName || result.entitlement.planId;
      const expiryLabel = result.entitlement.expiresAt
        ? ` until ${result.entitlement.expiresAt.toLocaleDateString()}`
        : "";
      activationConfirmed = true;
      setSubscriptionNotice(`Code activated. ${planLabel} is now active${expiryLabel}.`);
      setShowRedeemModal(false);
      await refreshPlan();
      notifyBillingPlanChanged();
    } catch {
      setSubscriptionError(activationConfirmed ? {
        title: "Refresh to see the activated plan",
        description: "The code was activated, but the latest plan details did not load. Refresh billing to see the updated capacity.",
      } : {
        title: "Check your plan before retrying activation",
        description: "Check your plan before submitting this code again. We could not confirm whether it was activated.",
      });
    } finally {
      setRedeemingCode(false);
    }
  };


  if (loading) {
    return (
      <div>
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="min-h-24 rounded-xl border border-border bg-surface-low p-3">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="mb-1 h-6 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>

        <div className="my-6 border-t border-border" />
        <Skeleton className="mb-3 h-5 w-28" />
        <div className="grid overflow-hidden rounded-xl border border-border md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-b border-border p-4 last:border-b-0 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
              <Skeleton className="mb-4 h-9 w-9 rounded-lg" />
              <Skeleton className="mb-2 h-5 w-20" />
              <Skeleton className="mb-3 h-3 w-3/4" />
              <Skeleton className="mb-3 h-7 w-24" />
              <Skeleton className="mb-4 h-10 w-full rounded-lg" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-3 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-left">
      <h1 className="sr-only">Plans</h1>

      {checkoutSync?.status === "pending" ? (
        <RecoveryState
          presentation="compact"
          title="Retry to refresh billing status"
          description={checkoutSync.message}
          primaryAction={{
            label: "Refresh",
            onAction: () => { void refreshCheckoutEntitlements(checkoutSync.pending); },
          }}
          onDismiss={() => setCheckoutSync(null)}
          dismissLabel="Dismiss"
          className="mb-4"
        />
      ) : checkoutSync ? (
        <div
          className={`glass-card mb-4 flex items-start justify-between gap-3 border p-3 ${
            checkoutSync.status === "cancelled"
              ? "border border-warning/30"
              : "border-[rgb(var(--selection-accent-rgb)_/_0.24)]"
          }`}
        >
          <p
            className={`text-xs ${
              checkoutSync.status === "cancelled"
                ? "text-warning"
                : "text-[var(--selection-accent)]"
            }`}
          >
            {checkoutSync.message}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setCheckoutSync(null)}
              className="text-xs text-text-muted transition hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {billingError && (
        <RecoveryState
          presentation="compact"
          title="Retry to load billing"
          description={billingError}
          primaryAction={{
            label: "Retry",
            onAction: () => {
              setBillingError(null);
              void refreshPlan();
            },
          }}
          className="mb-4"
        />
      )}

      {subscriptionNotice && (
        <div className="glass-card mb-4 border border-[rgb(var(--selection-accent-rgb)_/_0.24)] p-3">
          <p className="text-xs text-[var(--selection-accent)]">{subscriptionNotice}</p>
        </div>
      )}

      {subscriptionError && (
        <RecoveryState
          presentation="compact"
          title={subscriptionError.title}
          description={subscriptionError.description}
          primaryAction={{ label: "Refresh billing", onAction: () => { void refreshPlan(); } }}
          onDismiss={() => setSubscriptionError(null)}
          className="mb-4"
        />
      )}

      {catalogError && (
        <RecoveryState
          presentation="compact"
          title="Retry to load available plans"
          description={catalogError}
          primaryAction={{ label: "Retry", onAction: () => { void refreshPlan(); } }}
          className="mb-4"
        />
      )}

      {summary && (
        <section aria-label="Plan summary" className="grid gap-3 lg:grid-cols-3">
          <div className="relative min-h-24 rounded-xl border border-border bg-surface-low p-3">
            <div className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-high text-text-muted">
              <CircleDot className="h-4 w-4" />
            </div>
            <p className="pr-12 text-sm font-semibold text-foreground">Tokens</p>
            <p className="mt-2 pr-12 text-[1.4rem] font-bold tracking-tight text-foreground">{formatTokens(pooledTpd)}</p>
            <p className="mt-0.5 pr-12 text-xs text-text-muted">tokens/day</p>
          </div>
          <div className="relative min-h-24 rounded-xl border border-border bg-surface-low p-3">
            <div className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-high text-text-muted">
              <Code2 className="h-4 w-4" />
            </div>
            <p className="pr-12 text-sm font-semibold text-foreground">Agent capacity</p>
            <p className="mt-2 pr-12 text-[1.4rem] font-bold tracking-tight text-foreground">{slotTotals.granted}</p>
            <p className="mt-0.5 pr-12 text-xs text-text-muted">{slotTotals.used} of {slotTotals.granted} in use</p>
          </div>
          <div className="relative min-h-24 rounded-xl border border-border bg-surface-low p-3">
            <div className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-high text-text-muted">
              <WalletCards className="h-4 w-4" />
            </div>
            <p className="pr-12 text-sm font-semibold text-foreground">Monthly spend</p>
            <p className="mt-2 pr-12 text-[1.4rem] font-bold tracking-tight text-foreground">
              {catalogError ? "Unavailable" : `$${monthlySpend.toLocaleString()}`}
            </p>
            <p className="mt-0.5 pr-12 text-xs text-text-muted">
              {catalogError ? "Plan prices are unavailable" : billingResetAt ? `Renews ${formatShortDate(billingResetAt)}` : "No recurring renewal"}
            </p>
          </div>
        </section>
      )}

      <div className="my-6 border-t border-border" />

      <section aria-labelledby="active-bundles-heading">
        <h2 id="active-bundles-heading" className="mb-3 text-lg font-semibold tracking-tight text-foreground">Active Bundles</h2>
        {!billingReady ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-xs text-text-secondary">
            Active bundle details will appear after billing is refreshed.
          </div>
        ) : catalogError ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-xs text-text-secondary">
            Active bundle details will appear after the plan catalog is refreshed.
          </div>
        ) : activeBundles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-xs text-text-secondary">
            No active bundles yet. Choose a plan below to add agent capacity.
          </div>
        ) : (
          <div className="space-y-3">
            {activeBundles.map(({ product, subscriptions, entitlements, ownedCount, agentIds }) => {
              const expanded = expandedPlanIds.has(product.id);
              const renewal = subscriptions
                .map((subscription) => subscription.expiresAt)
                .filter((date): date is Date => Boolean(date))
                .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
              const panelId = `active-bundle-${product.id}`;
              return (
                <article key={product.id} className="overflow-hidden rounded-xl border border-border bg-surface-low">
                  <button
                    type="button"
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${product.name} bundle`}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedPlanIds((current) => {
                      const next = new Set(current);
                      if (next.has(product.id)) next.delete(product.id);
                      else next.add(product.id);
                      return next;
                    })}
                    className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-surface-high/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--selection-accent)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-high text-foreground">
                      <PlanIcon name={product.name} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{product.name}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {formatTokens(product.limits.tpd)} tokens/day each · ${product.price}/mo each
                        {renewal ? ` · renew ${formatShortDate(renewal)}` : ""}
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>

                  {expanded && (
                    <div id={panelId} className="px-3 pb-3">
                      <div className="overflow-x-auto">
                        <div className="min-w-[620px]">
                          <div className="grid grid-cols-[minmax(0,1.8fr)_1fr_1fr_40px] gap-3 border-b border-border px-2 py-2 text-xs font-semibold text-foreground">
                            <span>Agent Name</span><span>Started</span><span>Renews</span><span className="sr-only">Actions</span>
                          </div>
                          {agentIds.length > 0 ? agentIds.map((agentId) => {
                            const agent = agentsById[agentId];
                            const entitlement = entitlements.find((item) => item.activeAgentIds?.includes(agentId));
                            return (
                              <div key={agentId} className="grid grid-cols-[minmax(0,1.8fr)_1fr_1fr_40px] items-center gap-3 border-b border-border px-2 py-2 text-xs last:border-b-0">
                                <span className="truncate font-medium text-foreground">{agent?.name || agent?.displayName || agentId}</span>
                                <span className="text-text-secondary">{formatShortDate(agent?.createdAt ?? entitlement?.startsAt)}</span>
                                <span className="text-text-secondary">{formatShortDate(entitlement?.expiresAt ?? renewal)}</span>
                                <button
                                  type="button"
                                  aria-label={`Open ${agent?.name || agentId}`}
                                  onClick={() => window.location.assign(`/dashboard/agents?agentId=${encodeURIComponent(agentId)}`)}
                                  className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground"
                                >
                                  <MoreHorizontal className="h-5 w-5" />
                                </button>
                              </div>
                            );
                          }) : (
                            <div className="px-2 py-3 text-xs text-text-secondary">
                              {ownedCount} available agent slot{ownedCount === 1 ? "" : "s"}. No agent is assigned yet.
                            </div>
                          )}
                        </div>
                      </div>
                      {subscriptions.some((subscription) => subscription.canCancel || subscription.cancelAtPeriodEnd) && (
                        <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                          {subscriptions.filter((subscription) => subscription.canCancel || subscription.cancelAtPeriodEnd).map((subscription) => (
                            subscription.cancelAtPeriodEnd ? (
                              <span key={subscription.id} className="px-3 py-2 text-xs text-text-muted">Cancellation pending · {formatSubscriptionDate(subscription)}</span>
                            ) : (
                              <button
                                key={subscription.id}
                                type="button"
                                onClick={() => void handleCancelSubscription(subscription)}
                                disabled={mutatingSubscriptionId === subscription.id}
                                className="btn-secondary rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                              >
                                {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at Period End"}
                              </button>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {!catalogError && legacySubscriptions.length > 0 && (
        <div className="mt-8">
          <div className="mb-3">
            <h2 className="text-[0.9375rem] font-semibold text-foreground">Legacy Active Plans</h2>
            <p className="text-xs text-text-secondary">
              These subscriptions still contribute inference capacity, but they do not map to the current launchable slot catalog.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {legacySubscriptions.map((subscription) => (
              <div key={subscription.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{subscription.planName || subscription.planId}</p>
                    <p className="mt-1 text-xs text-text-secondary">Inference only legacy entitlement</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-text-muted">{billingSourceLabel(subscription.provider)}</p>
                    <p className="mt-1 text-xs text-foreground">{billingStatusLabel(subscription.status)}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs text-text-secondary">
                  <p>{formatSubscriptionDate(subscription)}</p>
                  <p>
                    TPM {formatTokens(subscription.planTpmLimit)} · RPM {formatTokens(subscription.planRpmLimit)} · TPD{" "}
                    {formatTokens(subscription.planTpd)}
                  </p>
                </div>
                <RecoveryDetails
                  label="Subscription details"
                  technicalDetails={`Reference: ${subscription.id.slice(0, 8)}...${subscription.id.slice(-4)}`}
                  className="mt-4"
                />
                {subscription.canCancel && !subscription.cancelAtPeriodEnd && (
                  <button
                    type="button"
                    onClick={() => void handleCancelSubscription(subscription)}
                    disabled={mutatingSubscriptionId === subscription.id}
                    className="btn-secondary mt-3 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                  >
                    {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at Period End"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="my-6 border-t border-border" />

      <section aria-labelledby="add-capacity-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="add-capacity-heading" className="text-lg font-semibold tracking-tight text-foreground">Add capacity</h2>
          <button
            type="button"
            onClick={() => {
              setSubscriptionError(null);
              setShowRedeemModal(true);
            }}
            className="btn-secondary rounded-lg px-3 py-2 text-xs font-medium"
          >
            Activate a code
          </button>
        </div>

      {displayProducts.length === 0 ? (
        <div className="glass-card p-4">
          <p className="text-xs text-text-secondary">
            {catalogError
              ? "Plan options will appear after the plan catalog is refreshed."
              : "No plans are available from the plan catalog right now."}
          </p>
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-border md:grid-cols-2 xl:grid-flow-col xl:grid-cols-none xl:auto-cols-fr">
          {displayProducts.map((product) => {
            const productBundleKey = bundleKey(product.bundle);
            const ownedByBundle = productBundleKey === "{}" ? 0 : (ownedBundles.get(productBundleKey) ?? 0);
            const ownedCount = Math.max(ownedPlanCounts.get(product.id) ?? 0, ownedByBundle);
            const checkoutBundle = compactBundle(product.bundle) as Record<string, number>;
            const hasCheckoutBundle = Object.keys(checkoutBundle).length > 0;
            const hasGrantedLaunchSlots = Object.keys(checkoutBundle).some((tier) =>
              Math.max(Number(launchSlotInventory[tier]?.granted ?? 0), 0) > 0
            );
            const waitingForLaunchEntitlement = ownedCount > 0 && hasCheckoutBundle && !hasGrantedLaunchSlots;

            return (
              <article data-plan-tier={product.planTier} key={product.id} className={`flex min-w-0 flex-col border-b border-t-2 border-border border-t-[var(--plan-accent-strong)] p-4 last:border-b-0 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0 ${product.highlighted ? "bg-surface-low" : "bg-background"}`}>
                <div className="mb-4 flex h-9 items-center justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--plan-accent-border)] bg-[var(--plan-accent-soft)] text-[var(--plan-accent)]">
                    <PlanIcon name={product.name} className="h-4 w-4" />
                  </span>
                  {waitingForLaunchEntitlement ? (
                    <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">Provisioning</span>
                  ) : product.highlighted ? (
                    <span className="rounded-full bg-[var(--plan-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--plan-accent)]">Most Popular</span>
                  ) : null}
                </div>

                <h3 className="text-lg font-semibold tracking-tight text-foreground">{product.name}</h3>
                <p className="mt-1 h-8 line-clamp-2 text-xs leading-4 text-text-secondary" title={`${formatTokens(product.limits.tpd ?? 0)} tokens/day${product.slotBundle ? ` · ${product.slotBundle}` : ""}`}>
                  {formatTokens(product.limits.tpd ?? 0)} tokens/day{product.slotBundle ? ` · ${product.slotBundle}` : ""}
                </p>
                <div className="mb-3 mt-3 flex min-h-8 items-baseline gap-1.5">
                  <span className="text-[1.6875rem] font-bold tracking-tight text-foreground">${product.price}</span>
                  <span className="text-xs text-text-muted">/ month{product.id === "free" ? "" : " per bundle"}</span>
                </div>

                <button
                  onClick={() => {
                    if (!billingReady) return;
                    if (waitingForLaunchEntitlement) {
                      void refreshCheckoutEntitlements();
                      return;
                    }
                    if (product.id === "free") return;
                    if (firstAgentSetupIntentMatchesDraft) {
                      updateFirstAgentSetupDraftPlan(product.id, primaryLaunchTier(checkoutBundle));
                    }
                    setCheckoutPlan({
                      id: product.id,
                      name: product.name,
                      bundle: hasCheckoutBundle ? checkoutBundle : undefined,
                      price: product.price,
                      limits: product.limits,
                    });
                  }}
                  disabled={product.id === "free" || !billingReady}
                  className={`mb-4 flex min-h-10 w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${product.highlighted ? "btn-primary" : "btn-secondary"}`}
                >
                  {product.id === "free" ? "Included" : !billingReady ? "Billing unavailable" : waitingForLaunchEntitlement ? "Refresh billing" : ownedCount > 0 ? "Add another" : "Purchase"}
                </button>

                <p className="mb-2 text-xs text-text-muted">{product.subtitle || (product.features.length > 0 ? "Includes:" : "Plan details")}</p>
                <ul className="flex-1 space-y-2">
                  {(product.features ?? []).map((feature) => (
                    <li key={feature} className={`flex items-start gap-2 text-xs ${/^no\s/i.test(feature) ? "text-text-muted" : "text-foreground"}`}>
                      {/^no\s/i.test(feature) ? <X className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--plan-accent)]" />}
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
      </section>

      {checkoutPlan && (
        <PlanCheckoutModal
          plan={checkoutPlan}
          baselineGrantedSlots={checkoutBaselineGrantedSlots}
          principalId={user?.id ?? ""}
          isPrincipalCurrent={() => activePrincipalRef.current === user?.id}
          ownedCount={
            Math.max(
              ownedPlanCounts.get(checkoutPlan.id) ?? 0,
              checkoutPlan.bundle ? (ownedBundles.get(bundleKey(checkoutPlan.bundle)) ?? 0) : 0,
            )
          }
          isOpen={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={(pending) => {
            if (
              checkoutFirstAgentSetup
              && pending.flow === "first-agent-setup"
              && pending.setupId === checkoutFirstAgentSetup.setupId
              && pending.returnSessionId
            ) {
              window.location.assign(firstAgentCheckoutRecoveryHref(pending));
              return;
            }
            void refreshCheckoutEntitlements(pending);
          }}
          getToken={getToken}
          checkoutReturnHref={checkoutFirstAgentSetup ? "/dashboard/agents" : undefined}
          firstAgentSetup={checkoutFirstAgentSetup}
        />
      )}

      <ActivateCodeModal
        isOpen={showRedeemModal}
        processing={redeemingCode}
        error={subscriptionError?.description ?? null}
        onClose={() => setShowRedeemModal(false)}
        onSubmit={handleRedeemCode}
      />
    </div>
  );
}
