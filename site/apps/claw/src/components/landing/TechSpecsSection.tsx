"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Zap, Gauge, Plug } from "lucide-react";

const specs = [
  {
    icon: Zap,
    label: "Throughput",
    value: "~3M",
    unit: "tokens/hour per AIU",
    description: "Sustained throughput on NVIDIA B200 Blackwell GPUs",
  },
  {
    icon: Gauge,
    label: "Rate Limits",
    value: "50K TPM",
    unit: "/ 1,000 RPM per AIU",
    description: "Tokens per minute and requests per minute, scales linearly with AIUs",
  },
  {
    icon: Plug,
    label: "Compatibility",
    value: "OpenAI",
    unit: "SDK compatible",
    description: "Works with any client that speaks the OpenAI Chat Completions API",
  },
];

const sdkSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="https://api.hyperclaw.app/v1",
    api_key="YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="kimi-k2.5",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`;

export function TechSpecsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <section
      ref={sectionRef}
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden bg-background-secondary"
    >
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
            Technical{" "}
            <span className="gradient-text-primary">Specifications</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Enterprise-grade infrastructure built for autonomous AI workloads.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Spec cards */}
          <div className="space-y-4">
            {specs.map((spec, index) => {
              const Icon = spec.icon;
              return (
                <motion.div
                  key={spec.label}
                  initial={{ opacity: 0, x: -30 }}
                  animate={
                    isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }
                  }
                  transition={{
                    duration: 0.6,
                    delay: 0.2 + index * 0.1,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="glass-card p-5 flex items-start gap-4"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-2xl font-bold text-foreground">
                        {spec.value}
                      </span>
                      <span className="text-sm text-text-tertiary">
                        {spec.unit}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary">
                      {spec.description}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Code example */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={
              isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }
            }
            transition={{
              duration: 0.8,
              delay: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="glass-card p-1"
          >
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <span className="text-xs text-text-muted ml-2">example.py</span>
            </div>
            <pre className="p-4 text-sm text-text-secondary overflow-x-auto border-0 bg-transparent leading-relaxed">
              <code>{sdkSnippet}</code>
            </pre>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
