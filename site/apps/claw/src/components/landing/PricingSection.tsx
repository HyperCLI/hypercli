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
  price: number;
  aiu: number;
  tpd?: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  highlighted?: boolean;
}

export function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const { login, isAuthenticated } = useClawAuth();
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch(`${CLAW_API_BASE}/plans`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.plans) setPlans(data.plans);
      })
      .catch(() => {});
  }, []);

  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const fmtTPD = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(0)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

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
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden"
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
            Simple, Predictable{" "}
            <span className="gradient-text-primary">Pricing</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Pay per AIU, not per token. Scale your agents without surprise
            bills.
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

              <button
                onClick={handleSelect}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                  plan.highlighted ? "btn-primary" : "btn-secondary"
                }`}
              >
                Get Started
              </button>
            </motion.div>
          ))}
        </div>

        {/* View All Plans Link */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mt-12"
        >
          <a
            href="/pricing"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
          >
            View all plans including Business pricing
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
