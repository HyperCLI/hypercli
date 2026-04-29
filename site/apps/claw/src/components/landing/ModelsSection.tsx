"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Check, X } from "lucide-react";
import type { HyperAgentModel } from "@hypercli.com/sdk/agent";
import { createPublicHyperAgentClient } from "@/lib/agent-client";

interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_structured_outputs: boolean;
  supports_reasoning: boolean;
  input_modalities: string[];
}

const MODEL_DISPLAY: Record<
  string,
  { title: string; tagline: string; highlighted?: boolean }
> = {
  "kimi-k2.5": {
    title: "Kimi K2.5",
    tagline: "Full-featured MoE with vision & tools",
    highlighted: true,
  },
  "glm-5": {
    title: "GLM-5",
    tagline: "754B MIT-licensed reasoning model",
  },
  "minimax-m2.5": {
    title: "MiniMax M2.5",
    tagline: "Fast & affordable reasoning",
  },
};

function fmtCtx(n: number | null): string {
  if (!n) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1024)}K`;
}

function normalizeModel(model: HyperAgentModel): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    context_length: model.contextLength,
    max_completion_tokens: null,
    supports_vision: model.supportsVision,
    supports_tools: model.supportsFunctionCalling || model.supportsToolChoice,
    supports_structured_outputs: model.supportsToolChoice,
    supports_reasoning: false,
    input_modalities: model.supportsVision ? ["text", "image"] : ["text"],
  };
}

export function ModelsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    createPublicHyperAgentClient()
      .models()
      .then((data) => {
        if (!cancelled) setModels(data.map(normalizeModel));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (models.length === 0) return null;

  const capabilities = (m: ModelInfo) => [
    { label: "Reasoning", active: m.supports_reasoning },
    { label: "Vision", active: m.supports_vision },
    { label: "Tool Use", active: m.supports_tools },
    { label: "Structured Output", active: m.supports_structured_outputs },
  ];

  const reveal = isInView || hasMounted;

  return (
    <section
      ref={sectionRef}
      id="models"
      className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden bg-background-secondary"
    >
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

      <div className="max-w-7xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={reveal ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Frontier <span className="gradient-text-primary">Models</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            All models included in every plan. Choose the right one for your
            workload.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {models.map((model, index) => {
            const display = MODEL_DISPLAY[model.id] || {
              title: model.name || model.id,
              tagline: "",
            };

            return (
              <motion.div
                key={model.id}
                initial={{ opacity: 0, y: 30 }}
                animate={reveal ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{
                  duration: 0.6,
                  delay: 0.2 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`glass-card p-6 flex flex-col ${
                  display.highlighted
                    ? "border-[#38D39F]/40 shadow-[0_0_40px_rgba(56,211,159,0.12)]"
                    : ""
                }`}
              >
                <code className="text-xs text-text-tertiary bg-surface-low px-2.5 py-1 rounded font-mono self-start mb-4">
                  {model.id}
                </code>

                <h3 className="text-lg font-semibold text-foreground">
                  {display.title}
                </h3>
                <p className="text-sm text-text-tertiary mt-1 mb-4">
                  {display.tagline}
                </p>

                <div className="flex items-baseline gap-1 mt-auto mb-1">
                  <span className="text-3xl font-bold text-foreground">
                    {fmtCtx(model.context_length)}
                  </span>
                  <span className="text-text-muted text-sm">context</span>
                </div>

                <ul className="space-y-3 mb-2">
                  {capabilities(model).map((cap) => (
                    <li
                      key={cap.label}
                      className="flex items-center gap-2 text-sm"
                    >
                      {cap.active ? (
                        <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      ) : (
                        <X className="w-4 h-4 text-text-muted/40 flex-shrink-0" />
                      )}
                      <span
                        className={
                          cap.active ? "text-text-secondary" : "text-text-muted/50"
                        }
                      >
                        {cap.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={reveal ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center text-sm text-text-muted mt-8"
        >
          All model usage is included in your active plan.
        </motion.p>
      </div>
    </section>
  );
}
