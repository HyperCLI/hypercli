"use client"

import { motion } from "framer-motion"
import { Shield, FileText, Users, Cpu, Code, Bot, Check } from "lucide-react"
import { HeroSection } from "../components/HeroSection"
import { CTASection } from "../components/CTASection"

const features = [
  {
    icon: Shield,
    title: "Complete Data Sovereignty",
    description:
      "All inference inside your network. No telemetry. No phoning home.",
  },
  {
    icon: FileText,
    title: "Enterprise Audit & Compliance",
    description:
      "Full request/response logging. SOC 2, GDPR, HIPAA-ready.",
  },
  {
    icon: Users,
    title: "Per-Team Governance",
    description:
      "Rate limits by department. Cost attribution. Resource isolation.",
  },
  {
    icon: Cpu,
    title: "GPU Orchestration",
    description:
      "Auto-scaling across AWS, Azure, GCP. Spot pricing. B200, H100, L40S.",
  },
  {
    icon: Code,
    title: "Drop-In API Replacement",
    description:
      "OpenAI-compatible API. Change one environment variable.",
  },
  {
    icon: Bot,
    title: "Agent Runtime Included",
    description:
      "Sandboxed containers, persistent storage, desktop access.",
  },
]

const pricingTiers = [
  {
    name: "Starter",
    users: "Up to 25 users",
    price: "$15,000/yr",
    features: ["Full platform", "Email support"],
  },
  {
    name: "Growth",
    users: "Up to 100 users",
    price: "$45,000/yr",
    features: ["Priority support", "Slack channel"],
  },
  {
    name: "Enterprise",
    users: "Unlimited",
    price: "Custom",
    features: ["SLA", "Dedicated engineer", "Custom integrations"],
  },
]

const deploymentOptions = [
  { name: "AWS", time: "30 min" },
  { name: "Azure", time: "30 min" },
  { name: "GCP", time: "30 min" },
  { name: "On-Premises", time: "1-2 hrs" },
  { name: "Air-Gapped", time: "1-2 days" },
]

export function SelfHostedContent() {
  return (
    <>
      {/* Hero */}
      <HeroSection
        headline="Your AI. Your Servers. Your Control."
        subheadline="Deploy a complete, private AI platform on your own infrastructure in 30 minutes. No data leaves your network. Ever."
        primaryCTA={{ label: "View Deployment Guide", href: "#" }}
        secondaryCTA={{ label: "Schedule Technical Demo", href: "#" }}
        trustBadges={["SOC 2", "GDPR", "HIPAA", "ITAR", "Air-Gap"]}
      />

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
              Three Commands to Production
            </h2>
          </motion.div>

          <motion.div
            className="bg-surface-low border border-border-medium/30 rounded-lg p-8 font-mono text-sm"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="text-muted-foreground"># Install the CLI</p>
            <p className="text-white mb-4">pip install hypercli</p>
            <p className="text-muted-foreground">
              # Configure your infrastructure target
            </p>
            <p className="text-white mb-4">
              hyper config set --provider aws --region us-east-1
            </p>
            <p className="text-muted-foreground">
              # Deploy your private AI platform
            </p>
            <p className="text-primary">pulumi up</p>
          </motion.div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Everything You Need. Nothing You Don&apos;t.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                className="p-6 rounded-lg border border-border-medium/30 bg-surface-low hover:border-primary/30 transition-colors"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <feature.icon className="w-6 h-6 text-primary mb-4" />
                <h3 className="text-lg text-white font-semibold mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

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
              Simple, Predictable Pricing
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {pricingTiers.map((tier, index) => (
              <motion.div
                key={tier.name}
                className="p-8 rounded-lg border border-border-medium/30 bg-surface-low"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <p className="text-sm text-muted-foreground mb-2">
                  {tier.users}
                </p>
                <h3 className="text-xl text-white font-bold mb-2">
                  {tier.name}
                </h3>
                <p className="text-3xl text-white font-bold mb-6">
                  {tier.price}
                </p>
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Deployment Options */}
      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Deploy Anywhere
            </h2>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
            {deploymentOptions.map((option, index) => (
              <motion.div
                key={option.name}
                className="p-6 rounded-lg border border-border-medium/30 bg-surface-low text-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <h3 className="text-white font-semibold mb-2">
                  {option.name}
                </h3>
                <p className="text-sm text-muted-foreground">{option.time}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <CTASection
        headline="Deploy Private AI in 30 Minutes."
        body="Get a complete AI infrastructure — LLMs, agents, RAG, media generation — running on your own servers with full compliance coverage."
        primaryCTA={{ label: "View Deployment Guide", href: "#" }}
        secondaryCTA={{ label: "Schedule Technical Demo", href: "#" }}
      />
    </>
  )
}
