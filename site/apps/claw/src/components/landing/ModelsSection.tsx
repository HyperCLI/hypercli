"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import {
  Eye,
  Wrench,
  Brain,
  ListChecks,
  MessageSquare,
  ImageIcon,
} from "lucide-react";
import { CLAW_API_BASE } from "@/lib/api";

interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  input_cost_per_m: number;
  output_cost_per_m: number;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_structured_outputs: boolean;
  supports_reasoning: boolean;
  input_modalities: string[];
}

const MODEL_DISPLAY: Record<
  string,
  { title: string; tagline: string; accent: string }
> = {
  "kimi-k2.5": {
    title: "Kimi K2.5",
    tagline: "Full-featured MoE with vision",
    accent: "#38D39F",
  },
  "glm-5": {
    title: "GLM-5",
    tagline: "754B MIT-licensed reasoning",
    accent: "#6C63FF",
  },
  "minimax-m2.5": {
    title: "MiniMax M2.5",
    tagline: "Fast & affordable reasoning",
    accent: "#FF6B6B",
  },
};

function fmtCtx(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1024)}K`;
}

function CapBadge({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-[#38D39F]/10 text-primary border border-[#38D39F]/20"
          : "bg-surface-low text-text-muted border border-border/30"
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </div>
  );
}

export function ModelsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    fetch(`${CLAW_API_BASE}/models`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.models) setModels(data.models);
      })
      .catch(() => {});
  }, []);

  if (models.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      id="models"
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
            Frontier{" "}
            <span className="gradient-text-primary">Models</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            All models included in every plan. Choose the right one for your
            workload.
          </p>
        </motion.div>

        {/* Model cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {models.map((model, index) => {
            const display = MODEL_DISPLAY[model.id] || {
              title: model.name,
              tagline: "",
              accent: "#38D39F",
            };

            return (
              <motion.div
                key={model.id}
                initial={{ opacity: 0, y: 30 }}
                animate={
                  isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
                }
                transition={{
                  duration: 0.6,
                  delay: 0.2 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="glass-card p-6 flex flex-col"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3
                      className="text-xl font-bold"
                      style={{ color: display.accent }}
                    >
                      {display.title}
                    </h3>
                    <p className="text-sm text-text-muted mt-0.5">
                      {display.tagline}
                    </p>
                  </div>
                  <code className="text-xs text-text-tertiary bg-surface-low px-2 py-1 rounded font-mono">
                    {model.id}
                  </code>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div>
                    <p className="text-xs text-text-muted mb-0.5">Context</p>
                    <p className="text-lg font-bold text-foreground">
                      {fmtCtx(model.context_length)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted mb-0.5">Input</p>
                    <p className="text-lg font-bold text-foreground">
                      ${model.input_cost_per_m.toFixed(2)}
                      <span className="text-xs text-text-muted font-normal">
                        /M
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted mb-0.5">Output</p>
                    <p className="text-lg font-bold text-foreground">
                      ${model.output_cost_per_m.toFixed(2)}
                      <span className="text-xs text-text-muted font-normal">
                        /M
                      </span>
                    </p>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="flex flex-wrap gap-2 mt-auto">
                  <CapBadge
                    icon={Brain}
                    label="Reasoning"
                    active={model.supports_reasoning}
                  />
                  <CapBadge
                    icon={Eye}
                    label="Vision"
                    active={model.supports_vision}
                  />
                  <CapBadge
                    icon={Wrench}
                    label="Tools"
                    active={model.supports_tools}
                  />
                  <CapBadge
                    icon={ListChecks}
                    label="Structured"
                    active={model.supports_structured_outputs}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footnote */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center text-sm text-text-muted mt-8"
        >
          Pricing shown is OpenRouter passthrough cost — included in your flat-rate plan.
          No per-token charges.
        </motion.p>
      </div>
    </section>
  );
}
