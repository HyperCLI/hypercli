"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Infinity, Code, Cpu, Wallet } from "lucide-react";
import { FeatureCard, MarketingSection, SectionHeading } from "@hypercli/shared-ui";

const features = [
  {
    icon: Infinity,
    title: "Unlimited Inference",
    description:
      "No per-token pricing. Use as much as your agents need with flat-rate AIU subscriptions. Predictable costs for autonomous workloads.",
  },
  {
    icon: Code,
    title: "OpenAI-Compatible API",
    description:
      "Drop-in replacement for OpenAI-compatible clients. Zero code changes needed — just swap your base URL and API key.",
  },
  {
    icon: Cpu,
    title: "Frontier Models on B200 GPUs",
    description:
      "Kimi K2.5, GLM-5, and MiniMax M2.5 — reasoning, vision, and tool use. ~36M tokens/hour per AIU with 4x burst.",
  },
  {
    icon: Wallet,
    title: "Crypto-Native Payments",
    description:
      "Pay with USDC via the x402 protocol. Seamless on-chain subscriptions for agent-to-agent commerce.",
  },
];

export function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <MarketingSection
      ref={sectionRef}
      id="features"
      background="secondary"
    >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-16"
        >
          <SectionHeading
            title="Built for"
            accent="AI Agents"
            description="Purpose-built infrastructure for autonomous AI workloads that run 24/7."
          />
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              reveal={isInView}
              index={index}
            />
          ))}
        </div>
    </MarketingSection>
  );
}
