"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Infinity, Code, Cpu, Wallet, AlertTriangle, TrendingUp, Zap } from "lucide-react";

const problems = [
  {
    icon: AlertTriangle,
    title: "Per-token pricing that penalizes success",
    description: "Every user you gain costs more. Your reward for product-market fit? A bill that scales faster than your revenue.",
  },
  {
    icon: TrendingUp,
    title: "Rate limits that throttle your growth",
    description: "Hit the ceiling at the worst possible moment. Viral traffic becomes a crisis instead of a win.",
  },
  {
    icon: Zap,
    title: "Optimization meetings instead of building",
    description: '"How do we use fewer tokens?" replaces "How do we build something better?"',
  },
];

const solutions = [
  {
    icon: Infinity,
    title: "Unlimited Inference",
    description: "Your agent made 4 million calls last night? Same price. No alerts. No pager duty. No explaining to finance.",
  },
  {
    icon: Code,
    title: "Drop-in OpenAI Compatible",
    description: "Change two lines. Keep your code. Keep your sanity. We speak OpenAI so you don't have to rewrite.",
  },
  {
    icon: Cpu,
    title: "Frontier Models on B200 GPUs",
    description: "Kimi. GLM-5. MiniMax. Running on NVIDIA B200s that would cost $11/hr retail. We bring the GPUs. You bring the prompts.",
  },
  {
    icon: Wallet,
    title: "Crypto-Native by Design",
    description: "USDC. x402. Agent-to-agent payments without the billing department. The future doesn't invoice in fiat.",
  },
];

export function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <section
      ref={sectionRef}
      id="features"
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden bg-background-secondary"
    >
      {/* Grain texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

      <div className="max-w-7xl mx-auto relative">
        {/* VILLAIN SECTION */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-red-500/20 bg-red-500/5 mb-6">
            <span className="text-sm text-red-400 font-medium">The Villain</span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Per-Token Billing{" "}
            <span className="text-red-400">Punishes Success</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            The hidden tax on every successful agent.
          </p>
        </motion.div>

        {/* Problem grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-24">
          {problems.map((problem, index) => {
            const Icon = problem.icon;
            return (
              <motion.div
                key={problem.title}
                initial={{ opacity: 0, y: 30 }}
                animate={
                  isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
                }
                transition={{
                  duration: 0.6,
                  delay: 0.2 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="glass-card p-6 sm:p-8 border-red-500/10"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {problem.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {problem.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* HERO SECTION */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#38D39F]/20 bg-[#38D39F]/5 mb-6">
            <span className="text-sm text-primary font-medium">The Hero</span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Unlimited Inference{" "}
            <span className="gradient-text-primary">Unlimited Potential</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            One price. Unlimited calls. Sleep through the spikes.
          </p>
        </motion.div>

        {/* Solution grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {solutions.map((solution, index) => {
            const Icon = solution.icon;
            return (
              <motion.div
                key={solution.title}
                initial={{ opacity: 0, y: 30 }}
                animate={
                  isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
                }
                transition={{
                  duration: 0.6,
                  delay: 0.5 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="glass-card p-6 sm:p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {solution.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {solution.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
