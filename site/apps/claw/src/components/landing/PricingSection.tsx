"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { useRouter } from "next/navigation";
import { Check, ArrowRight } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE } from "@/lib/api";

interface Plan {
  id: string;
  name: string;
  displayName?: string;
  price: number;
  aiu: number;
  tpd?: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  highlighted?: boolean;
  description?: string;
}

// Plan metadata for display
const PLAN_META: Record<
  string,
  { displayName: string; description: string; userType: string }
> = {
  scout: {
    displayName: "Scout",
    description: "Side projects, experiments, first agents",
    userType: "1 AIU",
  },
  operator: {
    displayName: "Operator",
    description: "Production apps, our average 50M/day users",
    userType: "5 AIUs",
  },
  heavy: {
    displayName: "Heavy",
    description: "Relentless scale, our 400M/day power users",
    userType: "20 AIUs",
  },
  squad: {
    displayName: "Squad",
    description: "Teams, shared pools, enterprise deployments",
    userType: "Custom",
  },
};

export function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const { login, isAuthenticated } = useClawAuth();
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch(`${CLAW_API_BASE}/plans`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.plans) {
          // Enhance plans with metadata
          const enhancedPlans = data.plans.map((plan: Plan) => ({
            ...plan,
            ...PLAN_META[plan.id],
          }));
          setPlans(enhancedPlans);
        }
      })
      .catch(() => {});
  }, []);

  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const handleSelect = () => {
    if (isAuthenticated) {
      window.location.href = "/dashboard/plans";
    } else {
      login();
    }
  };

  return (
    <section
      ref={sectionRef}
      id="pricing"
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden bg-background-secondary"
    >
      {/* Grain texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

      <div className="max-w-7xl mx-auto relative">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Pick Your{" "}
            <span className="gradient-text-primary">Scale</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Stop calculating. Start shipping. One AIU = ~36M tokens/hour + 4x burst.
          </p>
        </motion.div>

        {/* Pricing grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan, index) => (
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
              className={`glass-card p-6 flex flex-col ${
                plan.highlighted
                  ? "border-[#38D39F]/40 shadow-[0_0_40px_rgba(56,211,159,0.12)]"
                  : ""
              }`}
            >
              {plan.highlighted && (
                <div className="text-xs font-semibold text-primary bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
                  Most Popular
                </div>
              )}

              <h3 className="text-xl font-bold text-foreground">
                {plan.displayName || plan.name}
              </h3>
              <p className="text-sm text-text-muted mt-1 mb-4">
                {plan.description || PLAN_META[plan.id]?.description}
              </p>

              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-foreground">
                  ${plan.price}
                </span>
                <span className="text-text-muted text-sm">/month</span>
              </div>
              <p className="text-sm text-primary font-medium mb-6">
                {PLAN_META[plan.id]?.userType || `${plan.aiu} AIU`}
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

              <button
                onClick={handleSelect}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                  plan.highlighted ? "btn-primary" : "btn-secondary"
                }`}
              >
                {plan.price === 0 ? "Start Free" : "Get Started"}
              </button>
            </motion.div>
          ))}
        </div>

        {/* Free trial note */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mt-12"
        >
          <p className="text-text-secondary mb-4">
            Every account starts with{" "}
            <span className="text-primary font-semibold">30 minutes free GPU time</span>.
            No credit card required.
          </p>          <a
            href="/pricing"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
          >
            View detailed specifications
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
