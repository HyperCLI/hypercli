"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { CapabilityList, GlassCard, MarketingSection, SectionHeading } from "@hypercli/shared-ui";
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
    <MarketingSection
      ref={sectionRef}
      id="models"
      background="secondary"
    >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={reveal ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-16"
        >
          <SectionHeading
            title="Frontier"
            accent="Models"
            description="All models included in every plan. Choose the right one for your workload."
          />
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
              >
                <GlassCard highlighted={display.highlighted} className="flex h-full flex-col p-6">
                  <code className="mb-4 self-start rounded bg-surface-low px-2.5 py-1 font-mono text-xs text-text-tertiary">
                    {model.id}
                  </code>

                  <h3 className="text-lg font-semibold text-foreground">{display.title}</h3>
                  <p className="mb-4 mt-1 text-sm text-text-tertiary">{display.tagline}</p>

                  <div className="mb-1 mt-auto flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{fmtCtx(model.context_length)}</span>
                    <span className="text-sm text-text-muted">context</span>
                  </div>

                  <CapabilityList
                    className="mb-2"
                    items={capabilities(model).map((cap) => ({ label: cap.label, included: cap.active }))}
                  />
                </GlassCard>
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
    </MarketingSection>
  );
}
