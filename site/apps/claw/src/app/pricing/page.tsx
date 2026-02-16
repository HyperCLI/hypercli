"use client";

import { useState, useRef, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { Check, ArrowRight, Users } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE } from "@/lib/api";
import { ClawHeader } from "@/components/landing/ClawHeader";
import { ClawFooter } from "@/components/landing/ClawFooter";

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

// Business plans: 5, 10, 20 coding agents
// Base: 1 AIU per coding agent, $20 per agent, 50K TPM, 1K RPM
const BUSINESS_AGENTS = [5, 10, 20];

interface BusinessPlan {
  agents: number;
  aiu: number;
  price: number;
  tpm: number;
  rpm: number;
}

function getBusinessPlan(agents: number): BusinessPlan {
  const basePricePerAgent = 20;
  const baseTpmPerAgent = 50000;
  const baseRpmPerAgent = 1000;

  return {
    agents,
    aiu: agents,
    price: basePricePerAgent * agents,
    tpm: baseTpmPerAgent * agents,
    rpm: baseRpmPerAgent * agents,
  };
}

function BusinessPricingCard({
  plan,
  onSelect,
  isAuthenticated,
  highlighted,
}: {
  plan: BusinessPlan;
  onSelect: () => void;
  isAuthenticated: boolean;
  highlighted?: boolean;
}) {
  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`glass-card p-6 flex flex-col ${
        highlighted
          ? "border-[#38D39F]/40 shadow-[0_0_40px_rgba(56,211,159,0.12)]"
          : ""
      }`}
    >
      {highlighted && (
        <div className="text-xs font-semibold text-primary bg-[#38D39F]/10 px-3 py-1 rounded-full self-start mb-4">
          Most Popular
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          {plan.agents} Agents
        </h3>
      </div>

      <div className="mt-2 mb-1">
        <span className="text-3xl font-bold text-foreground">${plan.price}</span>
        <span className="text-text-muted text-sm">/month</span>
      </div>
      <p className="text-sm text-text-tertiary mb-6">
        {plan.aiu} AIU &middot; {fmtLimit(plan.tpm)} TPM &middot; {fmtLimit(plan.rpm)} RPM
      </p>

      <ul className="space-y-3 mb-8 flex-1">
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{plan.agents} concurrent coding agents</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{plan.aiu} AI Units per month</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{fmtLimit(plan.tpm)} tokens per minute</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{fmtLimit(plan.rpm)} requests per minute</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Priority support</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Custom SLA available</span>
        </li>
      </ul>

      <button
        onClick={onSelect}
        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
          highlighted ? "btn-primary" : "btn-secondary"
        }`}
      >
        {isAuthenticated ? "Contact Sales" : "Get Started"}
      </button>
    </motion.div>
  );
}

function StandardPricing({
  plans,
  onSelect,
  isAuthenticated,
}: {
  plans: Plan[];
  onSelect: () => void;
  isAuthenticated: boolean;
}) {
  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const fmtTPD = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(0)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {plans.map((plan, index) => (
        <motion.div
          key={plan.id}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            delay: index * 0.1,
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

          <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
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
            onClick={onSelect}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
              plan.highlighted ? "btn-primary" : "btn-secondary"
            }`}
          >
            Get Started
          </button>
        </motion.div>
      ))}
    </div>
  );
}

function BusinessPricing({
  onSelect,
  isAuthenticated,
}: {
  onSelect: () => void;
  isAuthenticated: boolean;
}) {
  return (
    <div>
      <div className="text-center mb-12">
        <p className="text-text-secondary max-w-2xl mx-auto text-lg">
          Serious coding agents for serious development.
        </p>
        <p className="text-text-muted max-w-2xl mx-auto mt-2">
          Scale your engineering team with dedicated AI agents. Each agent includes 
          1 AIU, 50K TPM, and 1K RPM — fully isolated and ready to ship code.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {BUSINESS_AGENTS.map((agents, index) => {
          const plan = getBusinessPlan(agents);
          const highlighted = agents === 10;
          return (
            <BusinessPricingCard
              key={agents}
              plan={plan}
              onSelect={onSelect}
              isAuthenticated={isAuthenticated}
              highlighted={highlighted}
            />
          );
        })}
      </div>
      <div className="mt-12 text-center">
        <p className="text-text-secondary mb-6">
          Need more than 20 agents? Contact us for custom enterprise pricing.
        </p>
        <button
          onClick={onSelect}
          className="inline-flex items-center gap-2 btn-primary px-6 py-3 rounded-lg text-sm font-medium"
        >
          Contact Sales <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const [activeTab, setActiveTab] = useState<"standard" | "business">(
    "standard"
  );
  const [plans, setPlans] = useState<Plan[]>([]);
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const { login, isAuthenticated } = useClawAuth();

  useEffect(() => {
    fetch(`${CLAW_API_BASE}/plans`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.plans) setPlans(data.plans);
      })
      .catch(() => {});
  }, []);

  const handleSelect = () => {
    if (isAuthenticated) {
      window.location.href = "/dashboard/plans";
    } else {
      login();
    }
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <ClawHeader />
      <main>
        <section
          ref={sectionRef}
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
              className="text-center mb-12"
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

            {/* Tabs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex justify-center mb-12"
            >
              <div className="inline-flex bg-surface rounded-lg p-1 border border-border">
                <button
                  onClick={() => setActiveTab("standard")}
                  className={`px-6 py-2.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === "standard"
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-foreground"
                  }`}
                >
                  Standard
                </button>
                <button
                  onClick={() => setActiveTab("business")}
                  className={`px-6 py-2.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === "business"
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-foreground"
                  }`}
                >
                  Business
                </button>
              </div>
            </motion.div>

            {/* Content */}
            {activeTab === "standard" ? (
              <StandardPricing
                plans={plans}
                onSelect={handleSelect}
                isAuthenticated={isAuthenticated}
              />
            ) : (
              <BusinessPricing
                onSelect={handleSelect}
                isAuthenticated={isAuthenticated}
              />
            )}
          </div>
        </section>
      </main>
      <ClawFooter />
    </div>
  );
}
