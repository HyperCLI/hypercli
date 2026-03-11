"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import {
  ArrowRight,
  Building2,
  Cloud,
  DollarSign,
  FileSearch,
  Heart,
  Lock,
  Server,
  Shield,
  ShieldCheck,
} from "lucide-react"
import { HeroSection } from "./components/HeroSection"
import { CTASection } from "./components/CTASection"
import { ComparisonTable } from "./components/ComparisonTable"
import { SocialProof } from "./components/SocialProof"

const problemOptions = [
  {
    label: "Option A",
    title: "Ship Data to Their Cloud",
    description:
      "Send sensitive prompts and documents to shared model endpoints. Hope their controls are good enough. Accept terms you do not control.",
    highlighted: false,
  },
  {
    label: "Option B",
    title: "Build It Yourself",
    description:
      "Spend months building auth, rate limits, GPU orchestration, and audit logging. Then keep maintaining it while the stack changes again.",
    highlighted: false,
  },
  {
    label: "Option C",
    title: "HyperCLI",
    description:
      "Dedicated GPUs, isolated models, full audit trails, and a faster path to private AI in production.",
    highlighted: true,
  },
]

const comparisonRows = [
  {
    capability: "Infrastructure",
    values: ["Shared servers", "Shared routing layer", "Your servers or dedicated GPUs"],
  },
  {
    capability: "Data Isolation",
    values: ["Mixed with other customers", "Mixed with other customers", "Completely isolated"],
  },
  {
    capability: "Model Access",
    values: ["Provider models only", "Aggregated provider access", "Any model you choose"],
  },
  {
    capability: "Audit Trail",
    values: ["Limited", "Request-level visibility", "Full, per-user"],
  },
  {
    capability: "Data Stays In Your Control",
    values: ["no", "no", "yes"],
  },
  {
    capability: "Billing",
    values: ["Per-token, variable", "Per-token + routing margin", "License or per-second active"],
  },
  {
    capability: "Idle Costs",
    values: ["N/A", "N/A", "Infra cost or $0 auto-shutdown"],
  },
  {
    capability: "Time to Deploy",
    values: ["Instant", "Instant", "5-30 minutes"],
  },
]

const deploymentOptions = [
  {
    icon: Server,
    label: "Maximum control",
    title: "Self-Hosted",
    description:
      "Deploy into your own Kubernetes environment when residency, air-gaps, or infrastructure control are non-negotiable.",
    bullets: [
      "Your infrastructure and network perimeter",
      "Best fit for regulated or restricted environments",
      "Built for teams that need direct control",
    ],
    cta: { label: "Explore Self-Hosted", href: "/preview/self-hosted" },
  },
  {
    icon: Cloud,
    label: "Same isolation, less ops",
    title: "Cloud",
    description:
      "Launch dedicated GPU instances managed by HyperCLI when you want isolation and speed without running the stack yourself.",
    bullets: [
      "Dedicated single-tenant GPUs",
      "Per-second billing with scale-to-zero",
      "Built for teams that want fast deployment",
    ],
    cta: { label: "Explore Cloud", href: "/preview/cloud" },
  },
]

const securityPillars = [
  {
    icon: Lock,
    title: "Isolation",
    description:
      "Dedicated infrastructure and private deployment paths instead of shared model endpoints.",
  },
  {
    icon: ShieldCheck,
    title: "Governance",
    description:
      "Integrate with your auth stack and control how teams, users, and workloads consume AI.",
  },
  {
    icon: FileSearch,
    title: "Auditability",
    description:
      "Keep per-user request history, model lineage, and evidence for compliance and procurement reviews.",
  },
]

const industryCards = [
  {
    icon: DollarSign,
    title: "Financial Services",
    description: "Keep MNPI, research workflows, and strategy logic inside your perimeter.",
    href: "/preview/finance",
  },
  {
    icon: Heart,
    title: "Healthcare & Life Sciences",
    description: "Keep PHI in controlled environments with auditability your compliance team can inspect.",
    href: "/preview/healthcare",
  },
  {
    icon: Shield,
    title: "Defense & Government",
    description: "Support restricted, classified, and air-gapped deployments without shared infrastructure.",
    href: "/preview/defense",
  },
  {
    icon: Building2,
    title: "Enterprise SaaS",
    description: "Ship AI features without routing customer data through third-party shared APIs.",
    href: "/preview/saas",
  },
]

const faqItems = [
  {
    question: "Is HyperCLI Cloud the same as using OpenAI or Azure OpenAI?",
    answer:
      "No. HyperCLI Cloud uses dedicated GPU environments for a single customer, not shared model endpoints used by thousands of organizations.",
  },
  {
    question: "How do I choose between self-hosted and cloud?",
    answer:
      "Choose self-hosted when control, residency, or restricted environments drive the decision. Choose cloud when you want the same isolation model without operating the infrastructure yourself.",
  },
  {
    question: "Do I need to rewrite my application?",
    answer:
      "HyperCLI is designed around an OpenAI-compatible integration path so existing applications can move with minimal change.",
  },
  {
    question: "How is pricing handled?",
    answer:
      "Pricing depends on deployment model, infrastructure needs, and support scope. Choose the right path here, then go deeper on the product pages or through sales for current pricing details.",
  },
]

export function LandingContent() {
  return (
    <>
      <HeroSection
        headline="Own Your AI. Completely."
        subheadline="Deploy private AI on AWS, Azure, GCP, or on-prem. Dedicated GPUs. Isolated models. Your data stays in your environment, not on shared endpoints."
        primaryCTA={{
          label: "Deploy Self-Hosted",
          href: "/preview/self-hosted",
        }}
        secondaryCTA={{
          label: "Launch Cloud Instance",
          href: "/preview/cloud",
        }}
        trustBadges={[
          "SOC 2",
          "GDPR",
          "HIPAA Ready",
          "Air-Gap Capable",
          "OpenAI-Compatible API",
        ]}
      />

      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
              Every AI Platform Forces the Same Bad Tradeoff.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl mb-12">
              Trust shared infrastructure or spend months building your own. HyperCLI gives you a third option: private AI without the platform rebuild.
            </p>
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
                    option.highlighted ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {option.label}
                </p>
                <h3 className="text-xl text-white font-bold mb-3">{option.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {option.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <ComparisonTable
        headline="Why HyperCLI Isn’t Just Another AI API"
        columns={[
          "",
          "OpenAI / Anthropic",
          "Openrouter / API",
          "HyperCLI",
        ]}
        rows={comparisonRows}
      />

      <section className="pt-0 pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="p-8 rounded-lg border border-border-medium/30 bg-surface-low"
          >
            <h3 className="text-2xl text-white font-bold mb-4">
              Shared AI APIs optimize for convenience.
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              They are easy to start with because you inherit someone else&apos;s infrastructure. That is also the problem when security, procurement, or compliance asks where the data went.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="p-8 rounded-lg border border-primary/30 bg-primary/5"
          >
            <h3 className="text-2xl text-white font-bold mb-4">
              HyperCLI optimizes for control.
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Self-hosted or cloud, the point is the same: dedicated infrastructure, stronger auditability, and a path to production that does not force you into shared SaaS or a year-long internal build.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
              Choose your deployment model
            </p>
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
              Same thesis. Two operating models.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
              Choose between full infrastructure ownership and dedicated managed isolation.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {deploymentOptions.map((option, index) => (
              <motion.div
                key={option.title}
                className="p-8 rounded-lg border border-border-medium/30 bg-surface-low"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <option.icon className="w-6 h-6 text-primary mb-4" />
                <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-2">
                  {option.label}
                </p>
                <h3 className="text-2xl text-white font-bold mb-3">{option.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  {option.description}
                </p>
                <ul className="space-y-3 mb-8">
                  {option.bullets.map((bullet) => (
                    <li key={bullet} className="text-sm text-muted-foreground leading-relaxed">
                      {bullet}
                    </li>
                  ))}
                </ul>
                <Link
                  href={option.cta.href}
                  className="inline-flex items-center gap-2 text-white font-medium hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
                >
                  {option.cta.label}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
              Proof
            </p>
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
              Enough proof to qualify the conversation.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {securityPillars.map((pillar, index) => (
              <motion.div
                key={pillar.title}
                className="p-8 rounded-lg border border-border-medium/30 bg-surface-low"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <pillar.icon className="w-6 h-6 text-primary mb-4" />
                <h3 className="text-xl text-white font-bold mb-3">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {pillar.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <SocialProof
        quote="The friction is rarely model quality. It is getting security, infrastructure, and procurement aligned on where the data runs and who controls the environment."
        attribution={{
          name: "Common enterprise evaluation pattern",
          role: "Especially in regulated and security-sensitive teams",
          company: "Across regulated organizations",
        }}
        metrics={[
          { value: "30 min", label: "Target self-hosted deployment" },
          { value: "5 min", label: "Target cloud launch" },
          { value: "Per-second", label: "Cloud billing model" },
          { value: "Scale-to-zero", label: "Idle cloud behavior" },
        ]}
      />

      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
              Industry paths
            </p>
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
              Go deeper where the stakes are specific.
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
                  className="block h-full rounded-lg border border-border-medium/30 bg-surface-low p-8 transition-colors group hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <card.icon className="w-6 h-6 text-primary mb-4" />
                  <h3 className="text-xl text-white font-bold mb-3 flex items-center gap-2">
                    {card.title}
                    <ArrowRight className="w-4 h-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {card.description}
                  </p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <p className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
              FAQ
            </p>
            <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
              Questions worth answering early.
            </h2>
          </motion.div>

          <div className="space-y-4">
            {faqItems.map((item, index) => (
              <motion.details
                key={item.question}
                className="group rounded-lg border border-border-medium/30 bg-surface-low p-6"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <summary className="list-none cursor-pointer text-white font-semibold flex items-center justify-between gap-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <span>{item.question}</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-4 max-w-3xl text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </p>
              </motion.details>
            ))}
          </div>
        </div>
      </section>

      <CTASection
        headline="Own the infrastructure. Control the outcome."
        body="Keep your data in your environment, give compliance a real audit trail, and get private AI into production without turning your engineers into an infrastructure team."
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
