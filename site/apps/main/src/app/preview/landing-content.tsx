"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import {
  DollarSign,
  Heart,
  Shield,
  Building2,
  ArrowRight,
} from "lucide-react"
import { HeroSection } from "./components/HeroSection"
import { CTASection } from "./components/CTASection"
import { ComparisonTable } from "./components/ComparisonTable"
import { SocialProof } from "./components/SocialProof"

const problemOptions = [
  {
    label: "Option A",
    title: "Ship Data to Their Cloud",
    description: "Shared models, no audit trail, no control.",
    highlighted: false,
  },
  {
    label: "Option B",
    title: "Build It Yourself",
    description: "6-12 months, $800K-$1.5M, ongoing maintenance.",
    highlighted: false,
  },
  {
    label: "Option C",
    title: "HyperCLI",
    description: "Dedicated GPUs, full compliance, deploy in 30 minutes.",
    highlighted: true,
  },
]

const comparisonRows = [
  {
    capability: "Infrastructure",
    values: ["Shared servers", "Your servers", "Your dedicated GPUs"],
  },
  {
    capability: "Data Isolation",
    values: ["no", "yes", "yes"],
  },
  {
    capability: "Audit Trail",
    values: ["Limited", "Full, per-user", "Full, per-user"],
  },
  {
    capability: "Data Leaves Control",
    values: ["yes", "no", "no"],
  },
  {
    capability: "Time to Deploy",
    values: ["Instant", "30 minutes", "5 minutes"],
  },
  {
    capability: "Billing",
    values: ["Per-token", "License + infra", "Per-second active"],
  },
]

const industryCards = [
  {
    icon: DollarSign,
    title: "Financial Services",
    description: "MNPI stays inside your perimeter.",
    href: "/preview/finance",
  },
  {
    icon: Heart,
    title: "Healthcare & Life Sciences",
    description: "PHI never leaves your environment.",
    href: "/preview/healthcare",
  },
  {
    icon: Shield,
    title: "Defense & Government",
    description: "Deployable where the internet isn't.",
    href: "/preview/defense",
  },
  {
    icon: Building2,
    title: "Enterprise SaaS",
    description: "Stop shipping customer data to OpenAI.",
    href: "/preview/saas",
  },
]

export function LandingContent() {
  return (
    <>
      {/* Hero */}
      <HeroSection
        headline="Own Your AI. Completely."
        subheadline="Deploy private AI infrastructure on your servers or our dedicated cloud GPUs. Full compliance. Full control. Deploy in minutes, not months."
        primaryCTA={{
          label: "Deploy Self-Hosted",
          href: "/preview/self-hosted",
        }}
        secondaryCTA={{
          label: "Launch Cloud Instance",
          href: "/preview/cloud",
        }}
        trustBadges={["SOC 2", "GDPR", "HIPAA Ready", "Air-Gap Capable"]}
      />

      {/* The Problem */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Every AI Platform Forces You to Choose.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {problemOptions.map((option, index) => (
              <motion.div
                key={option.label}
                className={`p-8 rounded-lg border ${
                  option.highlighted
                    ? "border-primary/30 bg-primary/5"
                    : "border-border-medium/30 bg-surface-low"
                }`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <p
                  className={`text-sm font-semibold mb-3 ${
                    option.highlighted
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {option.label}
                </p>
                <h3 className="text-xl text-white font-bold mb-2">
                  {option.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <ComparisonTable
        headline="How We're Different"
        columns={[
          "",
          "OpenAI / Anthropic",
          "HyperCLI Self-Hosted",
          "HyperCLI Cloud",
        ]}
        rows={comparisonRows}
      />

      {/* Industry Cards */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Built for Your Industry.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {industryCards.map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <Link
                  href={card.href}
                  className="block p-8 rounded-lg border border-border-medium/30 bg-surface-low hover:border-primary/30 transition-colors group"
                >
                  <card.icon className="w-6 h-6 text-primary mb-4" />
                  <h3 className="text-xl text-white font-bold mb-2 flex items-center gap-2">
                    {card.title}
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {card.description}
                  </p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <SocialProof
        quote="We were 6 months into building this ourselves. HyperCLI got us to production in a week with full compliance coverage. Our legal team approved it in one meeting."
        attribution={{
          name: "CTO",
          role: "Chief Technology Officer",
          company: "$2B AUM Quantitative Fund",
        }}
        metrics={[
          { value: "30 min", label: "To deploy" },
          { value: "85%", label: "Cost reduction vs. build" },
          { value: "40+", label: "Models supported" },
          { value: "$0", label: "When idle (Cloud)" },
        ]}
      />

      {/* CTA */}
      <CTASection
        headline="Stop Compromising. Start Controlling."
        body="Deploy private AI on your own servers or launch a dedicated cloud instance. Full compliance, full control, deploy in minutes."
        primaryCTA={{
          label: "Deploy Self-Hosted",
          href: "/preview/self-hosted",
        }}
        secondaryCTA={{
          label: "Launch Cloud Instance",
          href: "/preview/cloud",
        }}
      />
    </>
  )
}
