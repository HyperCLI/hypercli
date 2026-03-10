"use client"

import { motion } from "framer-motion"
import { Check } from "lucide-react"
import { HeroSection } from "../components/HeroSection"
import { CTASection } from "../components/CTASection"
import { ComparisonTable } from "../components/ComparisonTable"

const steps = [
  {
    step: "Step 1",
    title: "Launch Your Instance",
    description: "Select GPU tier. Choose region. Click deploy.",
  },
  {
    step: "Step 2",
    title: "Connect Your Application",
    description: "Change API base URL. Same SDKs. Zero code changes.",
  },
  {
    step: "Step 3",
    title: "Run Inference",
    description: "Dedicated GPUs. Auto-scaling. Data stays isolated.",
  },
  {
    step: "Step 4",
    title: "Pay for Active Time",
    description: "Per-second billing. Auto-shutdown. $0 idle costs.",
  },
]

const comparisonRows = [
  {
    capability: "Infrastructure",
    values: [
      "Shared — thousands of customers",
      "Dedicated GPUs, single-tenant",
    ],
  },
  {
    capability: "Data Isolation",
    values: ["no", "yes"],
  },
  {
    capability: "Audit Trail",
    values: ["Limited / None", "Full, per-user, immutable"],
  },
  {
    capability: "Compliance",
    values: ["Fails enterprise requirements", "SOC 2, GDPR, HIPAA ready"],
  },
  {
    capability: "Billing",
    values: ["Per-token, unpredictable", "Per-second active usage"],
  },
  {
    capability: "Idle Costs",
    values: ["N/A", "$0 (auto-shutdown)"],
  },
]

const pricingTiers = [
  {
    name: "Developer",
    price: "$49/mo",
    includes: "2M tokens + auto-shutdown",
    bestFor: "Side projects",
  },
  {
    name: "Team",
    price: "$199/mo",
    includes: "10M tokens + priority support",
    bestFor: "Small teams",
  },
  {
    name: "Business",
    price: "$599/mo",
    includes: "50M tokens + dedicated support",
    bestFor: "Production workloads",
  },
  {
    name: "Enterprise",
    price: "Custom",
    includes: "Unlimited + custom SLA",
    bestFor: "Scale without limits",
  },
]

export function CloudContent() {
  return (
    <>
      {/* Hero */}
      <HeroSection
        headline="Dedicated GPUs. Zero DevOps."
        subheadline="Launch dedicated GPU instances that scale with your workload. Full data isolation, per-second billing, and auto-shutdown when idle."
        primaryCTA={{ label: "Launch Dedicated Instance", href: "#" }}
        secondaryCTA={{ label: "See Security Architecture", href: "#" }}
        trustBadges={[
          "SOC 2",
          "GDPR",
          "HIPAA",
          "Dedicated GPUs",
          "Per-Second Billing",
        ]}
      />

      {/* The Difference */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
              Not like OpenAI
            </p>
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
              Your Dedicated GPUs. Not Shared.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
              Most &ldquo;cloud AI&rdquo; platforms run your requests on shared
              infrastructure alongside thousands of other customers. Your data
              touches their servers, their logs, their storage. HyperCLI Cloud
              gives you dedicated, single-tenant GPU instances where your data
              never leaves your environment.
            </p>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              How It Works
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {steps.map((step, index) => (
              <motion.div
                key={step.step}
                className="p-6 rounded-lg border border-border-medium/30 bg-surface-low"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <p className="text-primary text-sm font-bold mb-2">
                  {step.step}
                </p>
                <h3 className="text-lg text-white font-semibold mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Cloud vs "Cloud AI" */}
      <ComparisonTable
        headline={'Cloud vs. \u201CCloud AI\u201D'}
        columns={["", "OpenAI / Azure OpenAI", "HyperCLI Cloud"]}
        rows={comparisonRows}
      />

      {/* Pricing */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Predictable Pricing. No Surprises.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricingTiers.map((tier, index) => (
              <motion.div
                key={tier.name}
                className="p-8 rounded-lg border border-border-medium/30 bg-surface-low"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <h3 className="text-xl text-white font-bold mb-2">
                  {tier.name}
                </h3>
                <p className="text-3xl text-white font-bold mb-4">
                  {tier.price}
                </p>
                <p className="text-sm text-muted-foreground mb-2">
                  <Check className="w-4 h-4 text-primary inline mr-1" />
                  {tier.includes}
                </p>
                <p className="text-xs text-muted-foreground">
                  Best for: {tier.bestFor}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <CTASection
        headline="Get Isolation Without the DevOps."
        body="Launch a dedicated GPU environment in minutes. Full compliance coverage, per-second billing, and zero idle costs."
        primaryCTA={{ label: "Launch Dedicated Instance", href: "#" }}
        secondaryCTA={{ label: "Talk to Sales", href: "#" }}
      />
    </>
  )
}
