"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

const comparisonData = [
  {
    provider: "OpenAI",
    model: "GPT-4o",
    pricePerM: "$10",
    daily10M: "$100",
    monthly10M: "~$3,000",
    monthly50M: "~$15,000",
  },
  {
    provider: "Anthropic",
    model: "Claude 3.5 Sonnet",
    pricePerM: "$15",
    daily10M: "$150",
    monthly10M: "~$4,500",
    monthly50M: "~$22,500",
  },
  {
    provider: "Anthropic",
    model: "Claude Opus 4.6",
    pricePerM: "$75",
    daily10M: "$750",
    monthly10M: "~$22,500",
    monthly50M: "~$112,500",
    isExpensive: true,
  },
  {
    provider: "HyperClaw",
    model: "Kimi / GLM-5 / MiniMax",
    pricePerM: "Unlimited",
    daily10M: "—",
    monthly10M: "$99",
    monthly50M: "$99",
    isHyperClaw: true,
  },
];

export function ComparisonSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <section
      ref={sectionRef}
      id="comparison"
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden"
    >
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            The Brutal{" "}
            <span className="gradient-text-primary">Math</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            We're not 10% cheaper. We're a different universe.
          </p>
        </motion.div>

        {/* Real user metrics */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass-card p-8 mb-12 border-[#38D39F]/20"
        >
          <div className="text-center mb-6">
            <h3 className="text-xl font-semibold text-foreground mb-2">
              How Our Users Actually Scale
            </h3>
            <p className="text-text-secondary">
              Real workloads from real builders.
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="text-center p-8 rounded-xl bg-surface-low"
            >
              <div className="text-4xl font-bold text-primary mb-2">50M</div>
              <div className="text-sm text-text-secondary mb-1">tokens/day</div>
              <div className="text-lg font-semibold text-foreground">Average User</div>
              <div className="text-sm text-text-muted mt-2">
                Would cost ~$15,000/mo elsewhere
              </div>
              <div className="text-2xl font-bold text-primary mt-3">$99/mo with us</div>
            </div>
          </div>

          <div className="text-center mt-6">
            <div className="inline-flex items-center gap-2 text-lg">
              <span className="text-text-secondary">That's not 10% savings.</span>
              <span className="font-bold text-primary">That's 99.75% savings.</span>
            </div>
          </div>
        </motion.div>

        {/* Comparison table */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="glass-card overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left p-4 font-medium text-text-muted">Provider</th>
                  <th className="text-left p-4 font-medium text-text-muted">Model</th>
                  <th className="text-right p-4 font-medium text-text-muted">Price</th>
                  <th className="text-right p-4 font-medium text-text-muted hidden sm:table-cell">10M/day</th>
                  <th className="text-right p-4 font-medium text-text-muted">50M/day</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, index) => (
                  <tr
                    key={`${row.provider}-${row.model}`}
                    className={`border-b border-border/30 last:border-0 ${
                      row.isHyperClaw ? "bg-[#38D39F]/5" : ""
                    }`}
                  >
                    <td className="p-4 font-medium">
                      <span className={row.isHyperClaw ? "text-primary" : ""}>
                        {row.provider}
                      </span>
                    </td>
                    <td className="p-4 text-text-secondary">{row.model}</td>
                    <td className="p-4 text-right text-text-secondary">{row.pricePerM}</td>
                    <td className="p-4 text-right text-text-secondary hidden sm:table-cell">
                      {row.monthly10M}
                    </td>
                    <td
                      className={`p-4 text-right ${
                        row.isExpensive ? "text-red-400" : "text-text-secondary"
                      }`}
                    >
                      {row.monthly50M}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mt-12"
        >
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 btn-primary px-8 py-3 rounded-lg text-base font-semibold"
          >
            See Our Pricing
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
