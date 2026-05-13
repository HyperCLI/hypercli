"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentEntitlement,
  HyperAgentPlan,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { Check } from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { ActivateCodeModal } from "@/components/ActivateCodeModal";
import { formatTokens } from "@/lib/format";
import { Skeleton } from "@/components/dashboard/Skeleton";
import {
  clearPendingPlanCheckout,
  clearStripeCheckoutReturnState,
  getCheckoutReflectionStatus,
  getEffectivePlanName,
  getLaunchSlotInventoryFromSummary,
  getPlanOwnedCountFromSummary,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
} from "@/lib/plan-checkout-state";
import { bundleKey, CLAW_PRODUCTS, compactBundle, formatBundle, type SlotBundle } from "@/lib/subscriptions";

interface DisplayProduct {
  id: string;
  name: string;
  bundle: SlotBundle;
  price: number;
  features: string[];
  highlighted: boolean;
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

type CheckoutSyncState = {
  status: "syncing" | "success" | "pending" | "cancelled";
  message: string;
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

const FALLBACK_PRODUCTS_BY_ID = new Map(CLAW_PRODUCTS.map((product) => [product.id, product]));

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
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

function buildDisplayProducts(catalogPlans: HyperAgentPlan[]): DisplayProduct[] {
  return catalogPlans
    .filter((plan) => !(plan as CatalogPlan).hidden)
    .map((plan) => {
      const catalogPlan = plan as CatalogPlan;
      const fallbackBundle = FALLBACK_PRODUCTS_BY_ID.get(plan.id)?.bundle;
      const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
      const bundle = firstBundle(
        catalogPlan.bundle,
        catalogPlan.checkoutBundle,
        catalogPlan.checkout_bundle,
        catalogPlan.meta?.bundle,
        catalogPlan.meta?.checkout_bundle,
        catalogPlan.slotGrants,
        catalogPlan.slot_grants,
        fallbackBundle,
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

function formatEntitlementDate(entitlement: HyperAgentEntitlement): string {
  if (!entitlement.expiresAt) {
    return "Expiry unavailable";
  }
  return `Expires ${entitlement.expiresAt.toLocaleDateString()}`;
}

export default function PlansPage() {
  const { getToken } = useAgentAuth();
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [subscriptionTargets, setSubscriptionTargets] = useState<Record<string, string>>({});
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [checkoutSync, setCheckoutSync] = useState<CheckoutSyncState | null>(null);
  const checkoutReturnHandledRef = useRef(false);

  const refreshPlan = useCallback(async () => {
    try {
      const token = await getToken();
      const agentClient = createHyperAgentClient(token);
      const [catalog, current, subscriptions] = await Promise.allSettled([
        agentClient.plans(),
        agentClient.currentPlan(),
        agentClient.subscriptionSummary(),
      ]);
      const nextCatalogPlans = catalog.status === "fulfilled" ? catalog.value : [];
      const nextCurrentPlan = current.status === "fulfilled" ? current.value : null;
      const nextSummary = subscriptions.status === "fulfilled" ? subscriptions.value : null;
      setCatalogPlans(nextCatalogPlans);
      setCatalogError(catalog.status === "fulfilled" ? null : "Plan catalog is unavailable right now.");
      setCurrentPlan(nextCurrentPlan);
      setSummary(nextSummary);
      return { currentPlan: nextCurrentPlan, subscriptionSummary: nextSummary };
    } catch {
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    setLoading(true);
    void refreshPlan().finally(() => setLoading(false));
  }, [refreshPlan]);

  const refreshCheckoutEntitlements = useCallback(async () => {
    const pending = readPendingPlanCheckout();
    setCheckoutSync({
      status: "syncing",
      message: `Refreshing ${pending?.planName ?? "your plan"} entitlements from billing...`,
    });
    const refreshed = await refreshPlan();
    const reflectionStatus = getCheckoutReflectionStatus(refreshed?.subscriptionSummary ?? null, pending);

    if (reflectionStatus === "ready") {
      clearPendingPlanCheckout();
      setCheckoutSync({
        status: "success",
        message: `${pending?.planName ?? "Your plan"} is active. Agent slots and limits are updated.`,
      });
      return;
    }

    if (reflectionStatus === "waiting-entitlement") {
      setCheckoutSync({
        status: "pending",
        message: "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
      });
      return;
    }

    setCheckoutSync({
      status: "pending",
      message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
    });
  }, [refreshPlan]);

  useEffect(() => {
    if (checkoutReturnHandledRef.current) return;
    const checkoutReturn = readStripeCheckoutReturnState();
    if (!checkoutReturn) return;

    if (checkoutReturn.status === "cancelled") {
      checkoutReturnHandledRef.current = true;
      clearPendingPlanCheckout();
      setCheckoutSync({
        status: "cancelled",
        message: "Checkout cancelled. No plan changes were made.",
      });
      clearStripeCheckoutReturnState();
      return;
    }

    let active = true;
    const pending = readPendingPlanCheckout();
    const planLabel = pending?.planName ? `${pending.planName} plan` : "your plan";
    setCheckoutSync({
      status: "syncing",
      message: `Payment received. Finalizing ${planLabel} setup...`,
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
        clearPendingPlanCheckout();
        setCheckoutSync({
          status: "success",
          message: `${pending?.planName ?? "Your plan"} is active. Agent slots and limits are updated.`,
        });
      } else if (reflectionStatus === "waiting-entitlement") {
        setCheckoutSync({
          status: "pending",
          message: "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
        });
      } else {
        setCheckoutSync({
          status: "pending",
          message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
        });
      }

      checkoutReturnHandledRef.current = true;
      clearStripeCheckoutReturnState();
    })();

    return () => {
      active = false;
    };
  }, [refreshPlan]);

  useEffect(() => {
    if (!checkoutSync || (checkoutSync.status !== "success" && checkoutSync.status !== "cancelled")) return;
    const timer = setTimeout(() => setCheckoutSync(null), 5000);
    return () => clearTimeout(timer);
  }, [checkoutSync]);

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
  const launchSlotInventory = useMemo(() => getLaunchSlotInventoryFromSummary(summary), [summary]);
  const effectivePlanName = useMemo(
    () => getEffectivePlanName(summary, currentPlan, catalogPlans),
    [catalogPlans, currentPlan, summary],
  );
  const paidProducts = useMemo(() => displayProducts.filter((product) => product.id !== "free"), [displayProducts]);
  const legacySubscriptions = useMemo(() => {
    const knownPlanIds = new Set(displayProducts.map((product) => product.id));
    return (summary?.activeSubscriptions ?? []).filter((subscription) => !knownPlanIds.has(subscription.planId));
  }, [displayProducts, summary?.activeSubscriptions]);

  const pooledTpd = summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0;
  const activeEntitlementCount =
    summary?.entitlements?.activeEntitlementCount ??
    summary?.activeEntitlementCount ??
    summary?.activeSubscriptionCount ??
    0;
  const billingResetAt = useMemo(() => {
    const explicit = summary?.entitlements?.billingResetAt ?? summary?.billingResetAt ?? null;
    if (explicit) return explicit;
    const recurring = [...billingSubscriptions, ...(summary?.activeSubscriptions ?? [])]
      .filter((subscription) => subscription.provider.toLowerCase() === "stripe" && subscription.expiresAt)
      .map((subscription) => subscription.expiresAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());
    return recurring[0] ?? null;
  }, [billingSubscriptions, summary?.activeSubscriptions, summary?.billingResetAt, summary?.entitlements?.billingResetAt]);

  const handleCancelSubscription = async (subscription: HyperAgentSubscription) => {
    if (!subscription.canCancel || subscription.cancelAtPeriodEnd) return;
    if (!window.confirm(`Cancel ${subscription.planName} at the end of the current billing period?`)) return;

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setMutatingSubscriptionId(subscription.id);
    try {
      const agentClient = createHyperAgentClient(await getToken());
      const result = await agentClient.cancelSubscription(subscription.id);
      if (!result.ok) {
        throw new Error(result.message || "Failed to cancel subscription");
      }
      setSubscriptionNotice(result.message || "Subscription cancellation scheduled");
      await refreshPlan();
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : "Failed to cancel subscription");
    } finally {
      setMutatingSubscriptionId(null);
    }
  };

  const handleUpdateSubscription = async (subscription: HyperAgentSubscription) => {
    const targetKey = subscriptionTargets[subscription.id] ?? bundleKey(bundleFromSubscription(subscription));
    const targetProduct = paidProducts.find((product) => bundleKey(product.bundle) === targetKey);
    if (!targetProduct) {
      setSubscriptionError("Select a target bundle first");
      return;
    }

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setMutatingSubscriptionId(subscription.id);
    try {
      const agentClient = createHyperAgentClient(await getToken());
      const result = await agentClient.updateSubscription(subscription.id, {
        bundle: compactBundle(targetProduct.bundle) as Record<string, number>,
      });
      if (!result.ok) {
        throw new Error(result.message || "Failed to update subscription");
      }
      setSubscriptionNotice(result.message || "Subscription updated");
      await refreshPlan();
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : "Failed to update subscription");
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
      setSubscriptionError("Enter a code to activate it.");
      return;
    }

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setRedeemingCode(true);
    try {
      const agentClient = createHyperAgentClient(await getToken());
      const result = await agentClient.redeemGrantCode(normalizedCode);
      const planLabel = result.entitlement.planName || result.entitlement.planId;
      const expiryLabel = result.entitlement.expiresAt
        ? ` until ${result.entitlement.expiresAt.toLocaleDateString()}`
        : "";
      setSubscriptionNotice(`Code activated. ${planLabel} is now active${expiryLabel}.`);
      setShowRedeemModal(false);
      await refreshPlan();
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : "Failed to activate code");
    } finally {
      setRedeemingCode(false);
    }
  };


  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <Skeleton className="w-32 h-8 mb-2" />
          <Skeleton className="w-64 h-5" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-6">
              <Skeleton className="w-20 h-5 mb-3" />
              <Skeleton className="w-24 h-8 mb-2" />
              <Skeleton className="w-full h-3 mb-1" />
              <Skeleton className="w-3/4 h-3 mb-6" />
              <div className="space-y-3 mb-8">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="w-full h-4" />
                ))}
              </div>
              <Skeleton className="w-full h-10 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Plans</h1>
          <p className="text-text-secondary">
            Inference pools across all active entitlements. Agent capacity is tracked as exact-tier slots, so you can buy
            another bundle whenever you need more agents.
          </p>
        </div>
        <div className="w-full max-w-md glass-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Have a promo code?</p>
              <p className="text-xs text-text-secondary">Redeem an activation code to add a plan-backed entitlement.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubscriptionError(null);
                setShowRedeemModal(true);
              }}
              className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
            >
              Activate a Code
            </button>
          </div>
        </div>
      </div>

      {checkoutSync && (
        <div
          className={`glass-card p-4 mb-6 flex items-start justify-between gap-3 ${
            checkoutSync.status === "pending" || checkoutSync.status === "cancelled"
              ? "border border-amber-400/25"
              : "border border-[#38D39F]/20"
          }`}
        >
          <p
            className={`text-sm ${
              checkoutSync.status === "pending" || checkoutSync.status === "cancelled"
                ? "text-amber-100"
                : "text-[#B7F5DF]"
            }`}
          >
            {checkoutSync.message}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            {checkoutSync.status === "pending" && (
              <button
                type="button"
                onClick={() => { void refreshCheckoutEntitlements(); }}
                className="text-sm font-medium text-foreground underline underline-offset-4 transition hover:text-[#B7F5DF]"
              >
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={() => setCheckoutSync(null)}
              className="text-sm text-text-muted transition hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {subscriptionNotice && (
        <div className="glass-card p-4 mb-6 border border-[#38D39F]/20">
          <p className="text-sm text-[#B7F5DF]">{subscriptionNotice}</p>
        </div>
      )}

      {subscriptionError && (
        <div className="glass-card p-4 mb-6 border border-red-500/30">
          <p className="text-sm text-red-200">{subscriptionError}</p>
        </div>
      )}

      {catalogError && (
        <div className="glass-card p-4 mb-6 border border-red-500/30">
          <p className="text-sm text-red-200">{catalogError}</p>
        </div>
      )}

      {(summary || currentPlan) && (
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Pooled Inference</p>
            <p className="text-2xl font-semibold text-foreground">{formatTokens(pooledTpd)}</p>
            <p className="text-sm text-text-secondary mt-1">tokens/day across all active entitlements</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Active Entitlements</p>
            <p className="text-2xl font-semibold text-foreground">{activeEntitlementCount}</p>
            <p className="text-sm text-text-secondary mt-1">
              {effectivePlanName ? `Current anchor: ${effectivePlanName}` : "No paid entitlements yet"}
            </p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Billing Reset</p>
            <p className="text-2xl font-semibold text-foreground">
              {billingResetAt ? billingResetAt.toLocaleDateString() : "N/A"}
            </p>
            <p className="text-sm text-text-secondary mt-1">
              {billingResetAt ? "Anchored to the earliest active recurring subscription." : "No recurring subscription anchor yet"}
            </p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Slot Inventory</p>
            {slotInventoryEntries.length > 0 ? (
              <div className="space-y-2">
                {slotInventoryEntries.map(([tier, entry]) => (
                  <div key={tier} className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">{titleizeTier(tier)}</span>
                    <span className="text-foreground">
                      {entry.used} / {entry.granted} used
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Buy your first agent bundle to unlock slots.</p>
            )}
          </div>
        </div>
      )}

      {billingSubscriptions.length > 0 && (
        <div className="mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-foreground">Billing Subscriptions</h2>
            <p className="text-sm text-text-secondary">
              Recurring card subscriptions are managed here. Effective entitlements above already include every active
              subscription and external grant.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {billingSubscriptions.map((subscription) => {
              const bundleLabel = formatBundle(bundleFromSubscription(subscription)) || "Custom";
              const canManage = subscription.canCancel && subscription.provider.toLowerCase() === "stripe";
              return (
                <div key={subscription.id} className="glass-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-foreground">{subscription.planName}</p>
                      <p className="text-sm text-text-secondary mt-1">{bundleLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">{subscription.provider}</p>
                      <p className="text-sm text-foreground mt-1">{subscription.status.toLowerCase()}</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-text-secondary">
                    <p>{formatSubscriptionDate(subscription)}</p>
                    <p>
                      {subscription.cancelAtPeriodEnd
                        ? "Cancellation scheduled at period end."
                        : canManage
                          ? "Self-serve cancellation is available from the web."
                          : "This entitlement is read-only here."}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{subscription.id}</span>
                    {canManage && !subscription.cancelAtPeriodEnd ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelSubscription(subscription)}
                        disabled={mutatingSubscriptionId === subscription.id}
                        className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at Period End"}
                      </button>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {subscription.cancelAtPeriodEnd ? "Pending cancellation" : "No self-serve changes"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {legacySubscriptions.length > 0 && (
        <div className="mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-foreground">Legacy Active Plans</h2>
            <p className="text-sm text-text-secondary">
              These subscriptions still contribute inference capacity, but they do not map to the current launchable slot catalog.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {legacySubscriptions.map((subscription) => (
              <div key={subscription.id} className="glass-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-foreground">{subscription.planName || subscription.planId}</p>
                    <p className="text-sm text-text-secondary mt-1">Inference only legacy entitlement</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-text-muted">{subscription.provider}</p>
                    <p className="text-sm text-foreground mt-1">{subscription.status.toLowerCase()}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2 text-sm text-text-secondary">
                  <p>{formatSubscriptionDate(subscription)}</p>
                  <p>
                    TPM {formatTokens(subscription.planTpmLimit)} · RPM {formatTokens(subscription.planRpmLimit)} · TPD{" "}
                    {formatTokens(subscription.planTpd)}
                  </p>
                </div>
                <div className="mt-4 text-xs text-text-muted">{subscription.id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayProducts.length === 0 ? (
        <div className="glass-card p-6">
          <p className="text-sm text-text-secondary">No plans are available from the SDK catalog right now.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              <div key={product.id} className="glass-card p-6 flex flex-col">
                {waitingForLaunchEntitlement ? (
                  <div className="text-xs font-semibold text-amber-100 bg-amber-400/10 px-3 py-1 rounded-full self-start mb-4">
                    Payment active, waiting for entitlement
                  </div>
                ) : ownedCount > 0 ? (
                  <div className="text-xs font-semibold text-[#38D39F] bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
                    You own {ownedCount}
                  </div>
                ) : product.highlighted ? (
                  <div className="text-xs font-semibold text-foreground bg-white/5 px-3 py-1 rounded-full self-start mb-4">
                    Popular
                  </div>
                ) : null}

                <h3 className="text-lg font-semibold text-foreground">{product.name}</h3>
                <div className="mt-2 mb-1">
                  <span className="text-3xl font-bold text-foreground">${product.price}</span>
                  <span className="text-text-muted text-sm">/month</span>
                </div>
                <p className="text-sm text-text-tertiary mb-1">{formatTokens(product.limits.tpd ?? 0)} tokens/day</p>
                <p className="text-xs text-text-muted mb-2">
                  Up to {formatTokens(product.limits.burstTpm)} TPM burst &middot; {formatTokens(product.limits.rpm)} RPM
                </p>
                {product.subtitle && <p className="text-xs text-text-muted mb-2">{product.subtitle}</p>}
                {product.slotBundle && <p className="text-xs text-text-muted mb-6">{product.slotBundle}</p>}

                <ul className="space-y-3 mb-8 flex-1">
                  {(product.features ?? []).map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check className="w-4 h-4 text-text-secondary flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => {
                    if (waitingForLaunchEntitlement) {
                      void refreshCheckoutEntitlements();
                      return;
                    }
                    if (product.id === "free") return;
                    setCheckoutPlan({
                      id: product.id,
                      name: product.name,
                      bundle: hasCheckoutBundle ? checkoutBundle : undefined,
                      price: product.price,
                      limits: product.limits,
                    });
                  }}
                  disabled={product.id === "free"}
                  className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {product.id === "free" ? "Included" : waitingForLaunchEntitlement ? "Refresh billing" : ownedCount > 0 ? "Add Another" : "Purchase"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {checkoutPlan && (
        <PlanCheckoutModal
          plan={checkoutPlan}
          ownedCount={
            Math.max(
              ownedPlanCounts.get(checkoutPlan.id) ?? 0,
              checkoutPlan.bundle ? (ownedBundles.get(bundleKey(checkoutPlan.bundle)) ?? 0) : 0,
            )
          }
          isOpen={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={() => { void refreshCheckoutEntitlements(); }}
          getToken={getToken}
        />
      )}

      <ActivateCodeModal
        isOpen={showRedeemModal}
        processing={redeemingCode}
        error={subscriptionError}
        onClose={() => setShowRedeemModal(false)}
        onSubmit={handleRedeemCode}
      />
    </div>
  );
}
