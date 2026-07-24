"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { MarketingSection, PricingCard, SectionHeading } from "@hypercli/shared-ui";
import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import { createPublicHyperAgentClient } from "@/lib/agent-client";
import { buildAgentLauncherHref } from "@/lib/dashboard-route";
import { Plan, formatTokens } from "@/lib/format";

function toDisplayPlan(plan: HyperAgentPlan): Plan {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    aiu: plan.aiu,
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

  useEffect(() => {
    let cancelled = false;
    createPublicHyperAgentClient()
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data.map(toDisplayPlan));
      })
      .catch(() => {});
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
              description="Pay per AIU, not per token. Scale your agents without surprise bills."
            />
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                    eyebrow={plan.highlighted ? "Most Popular" : undefined}
                    summary={<>{plan.aiu} AIU &middot; {formatTokens(plan.limits.tpd)} tokens/day</>}
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
    </MarketingSection>
  );
}
