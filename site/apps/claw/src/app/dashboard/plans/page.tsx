"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentPlan,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { Check } from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { API_BASE_URL } from "@/lib/api";
import { createHyperAgentClient } from "@/lib/agent-client";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { formatTokens } from "@/lib/format";
import { Skeleton } from "@/components/dashboard/Skeleton";
import { CLAW_PRODUCTS } from "@/lib/subscriptions";

interface AgentTypePlan {
  id: string;
  name: string;
  price: number;
  agents: number;
  agent_type: string;
  highlighted: boolean;
}

interface AgentTypeCatalogResponse {
  plans: AgentTypePlan[];
}

interface DisplayProduct {
  id: string;
  name: string;
  checkoutPlanId: string | null;
  quantity: number;
  price: number;
  aiu: number;
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
  price: number;
  quantity: number;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
}

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatSlotBundle(planId: string, catalog: AgentTypeCatalogResponse | null): string | null {
  const mapping = catalog?.plans?.find((plan) => plan.id === planId);
  if (!mapping || mapping.agents <= 0) return null;
  const tierLabel = titleizeTier(mapping.agent_type);
  return `${mapping.agents} ${tierLabel} slot${mapping.agents === 1 ? "" : "s"}`;
}

function buildDisplayProducts(plans: HyperAgentPlan[], catalog: AgentTypeCatalogResponse | null): DisplayProduct[] {
  const planMap = new Map(plans.map((plan) => [plan.id, plan]));
  const products = CLAW_PRODUCTS.map((product): DisplayProduct | null => {
    const plan = planMap.get(product.planId);
    if (!plan && product.planId !== "free") {
      return null;
    }

    const burstTpm = (plan?.limits?.burstTpm ?? plan?.tpmLimit ?? 0) * product.quantity;
    const rpm = (plan?.limits?.rpm ?? plan?.rpmLimit ?? 0) * product.quantity;
    const tpd = (plan?.limits?.tpd ?? 0) * product.quantity;
    const aiu = (plan?.aiu ?? 0) * product.quantity;
    const baseFeatures = plan?.features ?? [];
    const slotBundle = product.planId === "free"
      ? "1 Free slot"
      : formatSlotBundle(product.planId, catalog)
        ? `${product.quantity > 1 ? `${product.quantity} x ` : ""}${formatSlotBundle(product.planId, catalog)}`
        : null;

    return {
      id: product.id,
      name: product.name,
      checkoutPlanId: product.planId === "free" ? null : product.planId,
      quantity: product.quantity,
      price: (plan?.price ?? 0) * product.quantity,
      aiu,
      features: product.features ?? baseFeatures,
      highlighted: Boolean(product.highlighted),
      limits: {
        tpd,
        burstTpm,
        rpm,
      },
      slotBundle,
      subtitle: product.subtitle,
    };
  });
  return products.filter((product): product is DisplayProduct => product !== null);
}

export default function PlansPage() {
  const { getToken } = useAgentAuth();
  const [plans, setPlans] = useState<HyperAgentPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [typeCatalog, setTypeCatalog] = useState<AgentTypeCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        const agentClient = createHyperAgentClient(token);
        const [plansData, current, subscriptions, catalogResponse] = await Promise.allSettled([
          agentClient.plans(),
          agentClient.currentPlan(),
          agentClient.subscriptionSummary(),
          fetch(`${API_BASE_URL}/types`),
        ]);
        setPlans(plansData.status === "fulfilled" ? (plansData.value ?? []) : []);
        setCurrentPlan(current.status === "fulfilled" ? current.value : null);
        setSummary(subscriptions.status === "fulfilled" ? subscriptions.value : null);
        if (catalogResponse.status === "fulfilled" && catalogResponse.value.ok) {
          setTypeCatalog((await catalogResponse.value.json()) as AgentTypeCatalogResponse);
        } else {
          setTypeCatalog(null);
        }
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

  const ownedQuantities = useMemo(() => {
    const entries = new Map<string, number>();
    for (const subscription of summary?.activeSubscriptions ?? []) {
      entries.set(
        subscription.planId,
        (entries.get(subscription.planId) ?? 0) + Math.max(1, subscription.quantity || 1),
      );
    }
    return entries;
  }, [summary]);

  const slotInventoryEntries = useMemo(() => {
    return Object.entries(summary?.slotInventory ?? currentPlan?.slotInventory ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [currentPlan?.slotInventory, summary?.slotInventory]);

  const displayProducts = useMemo(
    () => buildDisplayProducts(plans, typeCatalog),
    [plans, typeCatalog],
  );

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
                      {entry.available} free / {entry.granted} total
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {displayProducts.map((product) => {
          const ownedCount = product.checkoutPlanId ? ownedQuantities.get(product.checkoutPlanId) ?? 0 : 0;

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
              <p className="text-sm text-text-tertiary mb-1">
                {product.aiu ? `${product.aiu} AIU · ` : ""}
                {formatTokens(product.limits.tpd ?? 0)} tokens/day
              </p>
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
                  product.checkoutPlanId
                    ? setCheckoutPlan({
                        id: product.checkoutPlanId,
                        name: product.name,
                        price: product.price,
                        limits: {
                          tpd: product.limits.tpd,
                          burstTpm: product.limits.burstTpm,
                          rpm: product.limits.rpm,
                        },
                        quantity: product.quantity,
                      })
                    : undefined
                }
                disabled={!product.checkoutPlanId}
                className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {!product.checkoutPlanId ? "Included" : ownedCount > 0 ? "Add Another" : "Purchase"}
              </button>
            </div>
          );
        })}
      </div>

      {checkoutPlan && (
        <PlanCheckoutModal
          plan={checkoutPlan}
          ownedCount={ownedQuantities.get(checkoutPlan.id) ?? 0}
          isOpen={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={refreshPlan}
          getToken={getToken}
        />
      )}
    </div>
  );
}
