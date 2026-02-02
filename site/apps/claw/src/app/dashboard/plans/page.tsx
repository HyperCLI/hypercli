"use client";

import { useState, useEffect } from "react";
import { Check, ArrowRight } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";

interface CurrentPlan {
  plan_id: string;
  name: string;
  aiu: number;
  tpm_limit: number;
  rpm_limit: number;
  expires_at: string | null;
}

const tiers = [
  {
    id: "starter",
    name: "Starter",
    aiu: 1,
    price: 49,
    tpm: "50K",
    rpm: "1,000",
    features: [
      "1 AIU allocation",
      "~3M tokens/hour",
      "50K TPM / 1,000 RPM",
      "OpenAI-compatible API",
      "Email support",
    ],
  },
  {
    id: "team",
    name: "Team",
    aiu: 2,
    price: 89,
    tpm: "100K",
    rpm: "2,000",
    features: [
      "2 AIU allocation",
      "~6M tokens/hour",
      "100K TPM / 2,000 RPM",
      "OpenAI-compatible API",
      "Priority support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    aiu: 5,
    price: 199,
    tpm: "250K",
    rpm: "5,000",
    highlighted: true,
    features: [
      "5 AIU allocation",
      "~15M tokens/hour",
      "250K TPM / 5,000 RPM",
      "OpenAI-compatible API",
      "Priority support",
      "Usage analytics",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    aiu: 10,
    price: 349,
    tpm: "500K",
    rpm: "10,000",
    features: [
      "10 AIU allocation",
      "~30M tokens/hour",
      "500K TPM / 10,000 RPM",
      "OpenAI-compatible API",
      "Dedicated support",
      "Usage analytics",
      "Custom models",
    ],
  },
];

export default function PlansPage() {
  const { getToken } = useClawAuth();
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const token = await getToken();
        const data = await clawFetch<CurrentPlan>("/plans/current", token);
        setCurrentPlan(data);
      } catch {
        // Backend may not be implemented yet
      } finally {
        setLoading(false);
      }
    };

    fetchPlan();
  }, [getToken]);

  const handleSubscribe = async (tierId: string) => {
    setSubscribing(tierId);
    setError(null);

    try {
      const token = await getToken();
      await clawFetch(`/x402/plan/${tierId}`, token, { method: "POST" });
      // Refresh plan data
      const data = await clawFetch<CurrentPlan>("/plans/current", token);
      setCurrentPlan(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to subscribe to plan"
      );
    } finally {
      setSubscribing(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Plans</h1>
        <p className="text-text-secondary">
          {currentPlan
            ? `You're currently on the ${currentPlan.name} plan.`
            : "Choose a plan to get started with HyperClaw."}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
          {error}
        </div>
      )}

      {/* Plan grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiers.map((tier) => {
          const isCurrent = currentPlan?.plan_id === tier.id;
          const isHigher =
            currentPlan &&
            tiers.findIndex((t) => t.id === tier.id) >
              tiers.findIndex((t) => t.id === currentPlan.plan_id);

          return (
            <div
              key={tier.id}
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
                {tier.name}
              </h3>
              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-foreground">
                  ${tier.price}
                </span>
                <span className="text-text-muted text-sm">/month</span>
              </div>
              <p className="text-sm text-text-tertiary mb-6">
                {tier.aiu} AIU &middot; {tier.tpm} TPM &middot; {tier.rpm} RPM
              </p>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
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
                  onClick={() => handleSubscribe(tier.id)}
                  disabled={subscribing === tier.id || loading}
                  className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {subscribing === tier.id ? (
                    "Processing..."
                  ) : isHigher ? (
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
    </div>
  );
}
