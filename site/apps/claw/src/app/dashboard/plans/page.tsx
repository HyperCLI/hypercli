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

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatSlotBundle(planId: string, catalog: AgentTypeCatalogResponse | null): string | null {
  const mapping = catalog?.plans?.find((plan) => plan.id === planId);
  if (!mapping || mapping.agents <= 0) return null;
  const tierLabel = titleizeTier(mapping.agent_type);
  return `${mapping.agents} ${tierLabel} slot${mapping.agents === 1 ? "" : "s"}`;
}

export default function PlansPage() {
  const { getToken } = useAgentAuth();
  const [plans, setPlans] = useState<HyperAgentPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [typeCatalog, setTypeCatalog] = useState<AgentTypeCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<HyperAgentPlan | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        const agentClient = createHyperAgentClient(token);
        const [plansData, current, subscriptions, catalogResponse] = await Promise.all([
          agentClient.plans(),
          agentClient.currentPlan(),
          agentClient.subscriptionSummary(),
          fetch(`${API_BASE_URL}/types`),
        ]);
        setPlans(plansData ?? []);
        setCurrentPlan(current);
        setSummary(subscriptions);
        if (catalogResponse.ok) {
          setTypeCatalog((await catalogResponse.json()) as AgentTypeCatalogResponse);
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
      const [current, subscriptions] = await Promise.all([
        agentClient.currentPlan(),
        agentClient.subscriptionSummary(),
      ]);
      setCurrentPlan(current);
      setSummary(subscriptions);
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
        {plans.map((plan) => {
          const ownedCount = ownedQuantities.get(plan.id) ?? 0;
          const slotBundle = formatSlotBundle(plan.id, typeCatalog);
          const burstTpm = plan.limits?.burstTpm ?? plan.tpmLimit ?? 0;
          const rpm = plan.limits?.rpm ?? plan.rpmLimit ?? 0;

          return (
            <div key={plan.id} className="glass-card p-6 flex flex-col">
              {ownedCount > 0 ? (
                <div className="text-xs font-semibold text-[#38D39F] bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
                  You own {ownedCount}
                </div>
              ) : plan.highlighted ? (
                <div className="text-xs font-semibold text-foreground bg-white/5 px-3 py-1 rounded-full self-start mb-4">
                  Popular
                </div>
              ) : null}

              <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-foreground">${plan.price}</span>
                <span className="text-text-muted text-sm">/month</span>
              </div>
              <p className="text-sm text-text-tertiary mb-1">
                {plan.aiu ? `${plan.aiu} AIU · ` : ""}
                {formatTokens(plan.limits?.tpd ?? 0)} tokens/day
              </p>
              <p className="text-xs text-text-muted mb-2">
                Up to {formatTokens(burstTpm)} TPM burst &middot; {formatTokens(rpm)} RPM
              </p>
              {slotBundle && <p className="text-xs text-text-muted mb-6">{slotBundle}</p>}

              <ul className="space-y-3 mb-8 flex-1">
                {(plan.features ?? []).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                    <Check className="w-4 h-4 text-text-secondary flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setCheckoutPlan(plan)}
                className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2"
              >
                {ownedCount > 0 ? "Add Another" : "Purchase"}
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
