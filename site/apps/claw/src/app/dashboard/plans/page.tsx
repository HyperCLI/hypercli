"use client";

import { useState, useEffect } from "react";
import { Check, ArrowRight, Loader2 } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch, CLAW_API_BASE } from "@/lib/api";
import { PlanCheckoutModal } from "@/components/PlanCheckoutModal";
import { AlertDialog } from "@hypercli/shared-ui";

interface Plan {
  id: string;
  name: string;
  price: number;
  aiu: number;
  tpd?: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  highlighted?: boolean;
  expires_at: string | null;
  cancel_at_period_end?: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PlansPage() {
  const { getToken } = useClawAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  const fmtTPD = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(0)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  const refreshPlan = async () => {
    try {
      const token = await getToken();
      const data = await clawFetch<Plan>("/plans/current", token);
      setCurrentPlan(data);
    } catch {}
  };

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await getToken();
      await clawFetch<{ ok: boolean }>("/stripe/cancel", token, { method: "POST" });
      setShowCancelConfirm(false);
      await refreshPlan();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel subscription");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-text-muted">Loading plans...</div>
      </div>
    );
  }

  const isPaid = currentPlan && currentPlan.price > 0;
  const isCancelling = currentPlan?.cancel_at_period_end;

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

      {/* Current plan summary */}
      {isPaid && (
        <div className="glass-card p-5 mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-foreground">{currentPlan.name}</h3>
              {isCancelling ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#e0a85f]/10 text-[#e0a85f]">
                  Cancels {formatDate(currentPlan.expires_at)}
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#38D39F]/10 text-primary">
                  Active
                </span>
              )}
            </div>
            <p className="text-sm text-text-muted mt-1">
              ${currentPlan.price}/mo · {currentPlan.aiu} AIU
              {currentPlan.expires_at && !isCancelling && (
                <> · Renews {formatDate(currentPlan.expires_at)}</>
              )}
            </p>
          </div>
          {!isCancelling && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-xs text-text-muted hover:text-[#d05f5f] transition-colors"
            >
              Cancel subscription
            </button>
          )}
        </div>
      )}

      {cancelError && (
        <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
          {cancelError}
        </div>
      )}

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
                {plan.aiu} AIU &middot;{" "}
                {plan.tpd
                  ? `${fmtTPD(plan.tpd)} tokens/day`
                  : `${fmtLimit(plan.tpm_limit)} TPM`}
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
                  {isCancelling ? "Expires soon" : "Active"}
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

      <AlertDialog
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        title="Cancel Subscription"
        message={`Your ${currentPlan?.name} plan will remain active until ${formatDate(currentPlan?.expires_at ?? null)}. After that, you'll be downgraded to the free tier. Are you sure?`}
        type="warning"
        confirmText={cancelling ? "Cancelling..." : "Cancel Subscription"}
        cancelText="Keep Plan"
        showCancel
        onConfirm={handleCancel}
      />
    </div>
  );
}
