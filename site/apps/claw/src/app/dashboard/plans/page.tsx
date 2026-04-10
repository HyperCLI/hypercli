"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { Check, X } from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
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

export default function PlansPage() {
  const { getToken } = useAgentAuth();
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<HyperAgentSubscription | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  const handleCancelSubscription = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await getToken();
      const agentClient = createHyperAgentClient(token);
      await agentClient.cancelSubscription(cancelTarget.id);
      setCancelTarget(null);
      await refreshPlan();
    } catch (err) {
      setCancelTarget(null);
      setCancelError(err instanceof Error ? err.message : "Failed to cancel entitlement");
    } finally {
      setCancelling(false);
    }
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
    return Object.entries(summary?.slotInventory ?? currentPlan?.slotInventory ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [currentPlan?.slotInventory, summary?.slotInventory]);

  const displayProducts = useMemo(() => buildDisplayProducts(), []);

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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Plans</h1>
        <p className="text-text-secondary">
          Inference pools across all active entitlements. Agent capacity is tracked as exact-tier slots, so you can buy
          another bundle whenever you need more agents.
        </p>
      </div>

      {(summary || currentPlan) && (
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Pooled Inference</p>
            <p className="text-2xl font-semibold text-foreground">
              {formatTokens(summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0)}
            </p>
            <p className="text-sm text-text-secondary mt-1">tokens/day across all active entitlements</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted mb-2">Active Entitlements</p>
            <p className="text-2xl font-semibold text-foreground">{summary?.activeSubscriptionCount ?? 0}</p>
            <p className="text-sm text-text-secondary mt-1">
              {currentPlan?.name ? `Current anchor: ${currentPlan.name}` : "No paid entitlements yet"}
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

      {(summary?.activeSubscriptions?.length ?? 0) > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Active Entitlements</h2>

          {cancelError && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-[#d05f5f]/10 text-sm text-[#d05f5f]">
              <span className="flex-1">{cancelError}</span>
              <button onClick={() => setCancelError(null)} className="text-[#d05f5f] hover:text-[#c04e4e]">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-3">
            {summary!.activeSubscriptions.map((sub) => {
              const bundle = formatBundle(bundleFromSubscription(sub));
              const isCancelling = sub.cancelAtPeriodEnd;
              const expiryDate = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : null;

              return (
                <div key={sub.id} className="glass-card p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-foreground">{sub.planName}</span>
                      {isCancelling ? (
                        <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                          Cancels {expiryDate ?? "at period end"}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-[#38D39F] bg-[#38D39F]/10 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                      <span className="text-[10px] font-medium text-text-muted bg-white/5 px-2 py-0.5 rounded-full uppercase">
                        {sub.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                      {bundle && <span>{bundle}</span>}
                      <span>{formatTokens(sub.planTpd)} tokens/day</span>
                      {expiryDate && !isCancelling && <span>Renews {expiryDate}</span>}
                    </div>
                  </div>
                  {sub.canCancel && !isCancelling && (
                    <button
                      onClick={() => setCancelTarget(sub)}
                      className="text-xs text-text-muted hover:text-[#d05f5f] transition-colors px-3 py-1.5 rounded-lg hover:bg-[#d05f5f]/10"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-text-muted mt-3">
            Need to change plans? Cancel your current entitlement and purchase a different one, or{" "}
            <a href="mailto:support@hypercli.com" className="text-primary hover:underline">
              contact support
            </a>{" "}
            for help with downgrades and pausing.
          </p>
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

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel Entitlement"
        message={`Your ${cancelTarget?.planName ?? ""} entitlement will remain active until ${cancelTarget?.expiresAt ? new Date(cancelTarget.expiresAt).toLocaleDateString() : "the end of your current billing period"}. After that, the associated slots and inference pool will be removed.`}
        confirmLabel="Cancel Entitlement"
        danger
        loading={cancelling}
        onConfirm={handleCancelSubscription}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
