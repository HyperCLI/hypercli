"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Check } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";

const tiers = [
  {
    name: "Starter",
    aiu: 1,
    price: 49,
    tpm: "50K",
    rpm: "1,000",
    highlighted: false,
    features: [
      "1 AIU allocation",
      "~3M tokens/hour",
      "50K TPM / 1,000 RPM",
      "OpenAI-compatible API",
      "Email support",
    ],
  },
  {
    name: "Team",
    aiu: 2,
    price: 89,
    tpm: "100K",
    rpm: "2,000",
    highlighted: false,
    features: [
      "2 AIU allocation",
      "~6M tokens/hour",
      "100K TPM / 2,000 RPM",
      "OpenAI-compatible API",
      "Priority support",
    ],
  },
  {
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
    name: "Enterprise",
    aiu: 10,
    price: 349,
    tpm: "500K",
    rpm: "10,000",
    highlighted: false,
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

export function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const { login, isAuthenticated } = useClawAuth();

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
          {tiers.map((tier, index) => (
            <motion.div
              key={tier.name}
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
                tier.highlighted
                  ? "border-[#38D39F]/40 shadow-[0_0_40px_rgba(56,211,159,0.12)]"
                  : ""
              }`}
            >
              {tier.highlighted && (
                <div className="text-xs font-semibold text-primary bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
                  Most Popular
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

              <button
                onClick={handleSelect}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                  tier.highlighted
                    ? "btn-primary"
                    : "btn-secondary"
                }`}
              >
                Get Started
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
