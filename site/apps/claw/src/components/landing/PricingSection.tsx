"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { MarketingSection, PricingCard, SectionHeading, resolveCatalogPlanTier, type PlanTier } from "@hypercli/shared-ui";
import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import { createPublicHyperAgentClient } from "@/lib/agent-client";
import { buildAgentLauncherHref } from "@/lib/dashboard-route";
import { Plan, formatTokens } from "@/lib/format";

function toDisplayPlan(plan: HyperAgentPlan): Plan {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    agents: plan.agents,
    features: plan.features,
    models: plan.models,
    highlighted: plan.highlighted,
    expires_at: plan.expiresAt?.toISOString() ?? null,
    limits: {
      tpd: plan.limits.tpd,
      tpm: plan.limits.tpm,
      burst_tpm: plan.limits.burstTpm,
      rpm: plan.limits.rpm,
    },
  };
}

export function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planTiers, setPlanTiers] = useState<Record<string, PlanTier>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createPublicHyperAgentClient()
      .plans()
      .then((data) => {
        if (!cancelled) {
          setPlans(data.map(toDisplayPlan));
          setPlanTiers(Object.fromEntries(data.map((plan) => [plan.id, resolveCatalogPlanTier(plan, data)])));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlans([]);
          setCatalogError("Pricing is unavailable right now. Please try again shortly.");
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (planId: string) => {
    window.location.assign(buildAgentLauncherHref(planId));
  };

  return (
    <MarketingSection
      ref={sectionRef}
      id="pricing"
    >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mb-16"
          >
            <SectionHeading
              title="Simple, Predictable"
              accent="Pricing"
              description="Flat monthly plans, not per token. Scale by adding plans — never a surprise bill."
            />
          </motion.div>

          {catalogLoading ? (
            <p className="text-center text-sm text-text-muted">Loading current plans…</p>
          ) : catalogError ? (
            <p role="alert" className="text-center text-sm text-destructive">{catalogError}</p>
          ) : plans.length === 0 ? (
            <p className="text-center text-sm text-text-muted">No plans are currently available.</p>
          ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan, index) => {
              const includedAgents = plan.agents ?? 0;
              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={
                    isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
                  }
                  transition={{
                    duration: 0.6,
                    delay: 0.2 + index * 0.1,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <PricingCard
                    name={plan.name}
                    price={`$${plan.price}`}
                    highlighted={Boolean(plan.highlighted)}
                    planTier={planTiers[plan.id]}
                    eyebrow={plan.highlighted ? "Most Popular" : undefined}
                    summary={<>{includedAgents} agent slot{includedAgents === 1 ? "" : "s"} &middot; {formatTokens(plan.limits.tpd)} tokens/day</>}
                    detail={
                      <>
                        Up to {formatTokens(plan.limits.burst_tpm)} TPM burst &middot; {formatTokens(plan.limits.rpm)} RPM
                        {includedAgents > 0 && (
                          <span className="mt-4 block">
                            Includes {includedAgents} agent slot{includedAgents > 1 ? "s" : ""}
                          </span>
                        )}
                      </>
                    }
                    features={plan.features.map((feature) => ({ label: feature }))}
                    actionLabel="Get Started"
                    onAction={() => handleSelect(plan.id)}
                  />
                </motion.div>
              );
            })}
          </div>
          )}
    </MarketingSection>
  );
}
