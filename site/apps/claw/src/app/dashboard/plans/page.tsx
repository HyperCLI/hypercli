"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentEntitlement,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { Check } from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { formatTokens } from "@/lib/format";
import { Skeleton } from "@/components/dashboard/Skeleton";
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
  bundle: Record<string, number>;
  price: number;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
}

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
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

function buildDisplayProducts(): DisplayProduct[] {
  return CLAW_PRODUCTS.filter((product) => !product.hidden).map((product) => ({
    id: product.id,
    name: product.name,
    bundle: compactBundle(product.bundle),
    price: product.price,
    features: product.features ?? [],
    highlighted: Boolean(product.highlighted),
    limits: product.limits,
    slotBundle: formatBundle(product.bundle),
    subtitle: product.subtitle,
  }));
}

function formatEntitlementDate(entitlement: HyperAgentEntitlement): string {
  if (!entitlement.expiresAt) {
    return "Expiry unavailable";
  }
  return `Expires ${entitlement.expiresAt.toLocaleDateString()}`;
}

export default function PlansPage() {
  const { getToken } = useAgentAuth();
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [subscriptionTargets, setSubscriptionTargets] = useState<Record<string, string>>({});
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [showRedeemPanel, setShowRedeemPanel] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemingCode, setRedeemingCode] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        const agentClient = createHyperAgentClient(token);
        const [current, subscriptions] = await Promise.allSettled([
          agentClient.currentPlan(),
          agentClient.subscriptionSummary(),
        ]);
        setCurrentPlan(current.status === "fulfilled" ? current.value : null);
        setSummary(subscriptions.status === "fulfilled" ? subscriptions.value : null);
      } catch {
        // graceful fallback
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [getToken]);

  const refreshPlan = async () => {
    try {
      const token = await getToken();
      const agentClient = createHyperAgentClient(token);
      const [current, subscriptions] = await Promise.allSettled([
        agentClient.currentPlan(),
        agentClient.subscriptionSummary(),
      ]);
      setCurrentPlan(current.status === "fulfilled" ? current.value : null);
      setSummary(subscriptions.status === "fulfilled" ? subscriptions.value : null);
    } catch {}
  };

  const ownedBundles = useMemo(() => {
    const entries = new Map<string, number>();
    for (const subscription of summary?.activeSubscriptions ?? []) {
      const key = bundleKey(bundleFromSubscription(subscription));
      if (key === "{}") continue;
      entries.set(key, (entries.get(key) ?? 0) + 1);
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

  const displayProducts = useMemo(() => buildDisplayProducts(), []);
  const paidProducts = useMemo(() => displayProducts.filter((product) => product.id !== "free"), [displayProducts]);

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
      const result = await agentClient.updateSubscription(subscription.id, { bundle: {} });
      if (!result.ok) {
        throw new Error(result.message || "Failed to cancel subscription");
      }
      setSubscriptionNotice(result.message || "Subscription updated");
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

  const handleRedeemCode = async () => {
    const normalizedCode = redeemCode.trim();
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
      setRedeemCode("");
      setShowRedeemPanel(false);
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
              onClick={() => setShowRedeemPanel((value) => !value)}
              className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
            >
              {showRedeemPanel ? "Close" : "Activate a Code"}
            </button>
          </div>
          {showRedeemPanel && (
            <div className="mt-4 flex flex-col gap-3">
              <input
                type="text"
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleRedeemCode();
                  }
                }}
                placeholder="Enter activation code"
                autoCapitalize="characters"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#38D39F]/70"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-text-muted">Codes are applied to the currently signed-in HyperClaw account.</p>
                <button
                  type="button"
                  onClick={() => void handleRedeemCode()}
                  disabled={redeemingCode}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {redeemingCode ? "Activating..." : "Redeem"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
              {currentPlan?.name ? `Current anchor: ${currentPlan.name}` : "No paid entitlements yet"}
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {displayProducts.map((product) => {
          const ownedCount = ownedBundles.get(bundleKey(product.bundle)) ?? 0;

          return (
            <div key={product.id} className="glass-card p-6 flex flex-col">
              {ownedCount > 0 ? (
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
                onClick={() =>
                  product.id !== "free"
                    ? setCheckoutPlan({
                        id: product.id,
                        name: product.name,
                        bundle: compactBundle(product.bundle) as Record<string, number>,
                        price: product.price,
                        limits: product.limits,
                      })
                    : undefined
                }
                disabled={product.id === "free"}
                className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {product.id === "free" ? "Included" : ownedCount > 0 ? "Add Another" : "Purchase"}
              </button>
            </div>
          );
        })}
      </div>

      {checkoutPlan && (
        <PlanCheckoutModal
          plan={checkoutPlan}
          ownedCount={ownedBundles.get(bundleKey(checkoutPlan.bundle)) ?? 0}
          isOpen={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={refreshPlan}
          getToken={getToken}
        />
      )}
    </div>
  );
}
