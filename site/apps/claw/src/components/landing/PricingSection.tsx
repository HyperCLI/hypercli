"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Check, ArrowRight, Users, Shield } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";

// Agent-based pricing tiers
const AGENT_TIERS = [
  {
    name: "Skill",
    agents: 1,
    price: 29,
    aiu: 1,
    tpm: 50000,
    rpm: 1000,
    highlighted: false,
  },
  {
    name: "Team",
    agents: 5,
    price: 99,
    aiu: 5,
    tpm: 250000,
    rpm: 5000,
    highlighted: true,
  },
  {
    name: "Business",
    agents: 20,
    price: 299,
    aiu: 20,
    tpm: 1000000,
    rpm: 20000,
    highlighted: false,
  },
];

function AgentTierCard({
  tier,
  onSelect,
  isAuthenticated,
  index,
  isInView,
}: {
  tier: typeof AGENT_TIERS[0];
  onSelect: () => void;
  isAuthenticated: boolean;
  index: number;
  isInView: boolean;
}) {
  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay: 0.2 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
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

      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">{tier.name}</h3>
      </div>

      <div className="mt-2 mb-1">
        <span className="text-3xl font-bold text-foreground">${tier.price}</span>
        <span className="text-text-muted text-sm">/month</span>
      </div>
      <p className="text-sm text-text-tertiary mb-6">
        {tier.agents} {tier.agents === 1 ? "Agent" : "Agents"} &middot; {tier.aiu} AIU &middot; {fmtLimit(tier.tpm)} TPM
      </p>

      <ul className="space-y-3 mb-8 flex-1">
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{tier.agents} concurrent {tier.agents === 1 ? "agent" : "agents"}</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{tier.aiu} AI Units per month</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{fmtLimit(tier.tpm)} tokens per minute</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{fmtLimit(tier.rpm)} requests per minute</span>
        </li>
        {tier.name === "Skill" && (
          <>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>API access</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Basic dashboard</span>
            </li>
          </>
        )}
        {tier.name === "Team" && (
          <>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Everything in Skill</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>GitHub integration</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Team dashboard</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Priority support</span>
            </li>
          </>
        )}
        {tier.name === "Business" && (
          <>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Everything in Team</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Fleet management</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Custom workflows</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Dedicated infrastructure</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>Dedicated support</span>
            </li>
          </>
        )}
      </ul>

      <button
        onClick={onSelect}
        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
          tier.highlighted ? "btn-primary" : "btn-secondary"
        }`}
      >
        {isAuthenticated ? "Upgrade" : "Get Started"}
      </button>
    </motion.div>
  );
}

function EnterpriseCard({
  onSelect,
  isAuthenticated,
  isInView,
}: {
  onSelect: () => void;
  isAuthenticated: boolean;
  isInView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card p-6 flex flex-col border-border/60"
    >
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Enterprise</h3>
      </div>

      <div className="mt-2 mb-1">
        <span className="text-3xl font-bold text-foreground">Contact Us</span>
      </div>
      <p className="text-sm text-text-tertiary mb-6">
        Unlimited Agents &middot; Custom AIU &middot; SLA Guarantee
      </p>

      <ul className="space-y-3 mb-8 flex-1">
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Unlimited agents</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Custom AIU allocation</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>SSO / SAML</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Audit logs</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>SLA guarantee</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>On-premise option</span>
        </li>
        <li className="flex items-start gap-2 text-sm text-text-secondary">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>Dedicated account manager</span>
        </li>
      </ul>

      <button
        onClick={onSelect}
        className="w-full py-2.5 rounded-lg text-sm font-medium btn-secondary"
      >
        Contact Sales
      </button>
    </motion.div>
  );
}

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
          className="text-center mb-12"
        >
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Hire Agents, Not{" "}
            <span className="gradient-text-primary">Headcount</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Deploy AI agents in minutes. One flat fee per agent. No surprise bills.
          </p>
        </motion.div>

        {/* Pricing grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {AGENT_TIERS.map((tier, index) => (
            <AgentTierCard
              key={tier.name}
              tier={tier}
              onSelect={handleSelect}
              isAuthenticated={isAuthenticated}
              index={index}
              isInView={isInView}
            />
          ))}
          
          <EnterpriseCard 
            onSelect={handleSelect} 
            isAuthenticated={isAuthenticated}
            isInView={isInView}
          />
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
          </p>
          <a
            href="/pricing"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
          >
            View API pricing
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
