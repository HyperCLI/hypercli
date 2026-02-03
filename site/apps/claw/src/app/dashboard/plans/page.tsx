"use client";

import { useState, useEffect } from "react";
import { Check, ArrowRight } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch, CLAW_API_BASE } from "@/lib/api";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";

interface Plan {
  id: string;
  name: string;
  price: number;
  aiu: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  highlighted?: boolean;
  expires_at: string | null;
}

export default function PlansPage() {
  const { getToken } = useClawAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const plansRes = await fetch(`${CLAW_API_BASE}/plans`);
        if (plansRes.ok) {
          const data = await plansRes.json();
          setPlans(data.plans ?? []);
        }

        const token = await getToken();
        const current = await clawFetch<Plan>("/plans/current", token);
        setCurrentPlan(current);
      } catch {
        // graceful fallback
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [getToken]);

  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const refreshPlan = async () => {
    try {
      const token = await getToken();
      const data = await clawFetch<Plan>("/plans/current", token);
      setCurrentPlan(data);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-text-muted">Loading plans...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Plans</h1>
        <p className="text-text-secondary">
          {currentPlan
            ? `You're currently on the ${currentPlan.name} plan.`
            : "Choose a plan to get started with HyperClaw."}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          const currentIdx = plans.findIndex((p) => p.id === currentPlan?.id);
          const thisIdx = plans.findIndex((p) => p.id === plan.id);
          const isHigher = currentPlan && thisIdx > currentIdx;

          return (
            <div
              key={plan.id}
              className={`glass-card p-6 flex flex-col ${
                isCurrent
                  ? "border-[#38D39F]/40 shadow-[0_0_40px_rgba(56,211,159,0.12)]"
                  : ""
              }`}
            >
              {isCurrent && (
                <div className="text-xs font-semibold text-primary bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
                  Current Plan
                </div>
              )}

              <h3 className="text-lg font-semibold text-foreground">
                {plan.name}
              </h3>
              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-foreground">
                  ${plan.price}
                </span>
                <span className="text-text-muted text-sm">/month</span>
              </div>
              <p className="text-sm text-text-tertiary mb-6">
                {plan.aiu} AIU &middot; {fmtLimit(plan.tpm_limit)} TPM &middot;{" "}
                {fmtLimit(plan.rpm_limit)} RPM
              </p>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-text-secondary"
                  >
                    <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="w-full py-2.5 rounded-lg text-sm font-medium text-center text-primary bg-[#38D39F]/10">
                  Active
                </div>
              ) : (
                <button
                  onClick={() => setCheckoutPlan(plan)}
                  className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2"
                >
                  {isHigher ? (
                    <>
                      Upgrade <ArrowRight className="w-3 h-3" />
                    </>
                  ) : (
                    "Subscribe"
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {checkoutPlan && (
        <PlanCheckoutModal
          plan={checkoutPlan}
          isOpen={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={refreshPlan}
          getToken={getToken}
        />
      )}
    </div>
  );
}
