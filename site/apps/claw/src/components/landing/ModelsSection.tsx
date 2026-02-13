"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { Check, X } from "lucide-react";
import { HYPERCLAW_MODELS_ENDPOINT } from "@/lib/api";

interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  input_cost_per_m: number | null;
  output_cost_per_m: number | null;
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
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1024)}K`;
}

function fmtCost(n: number | null): string {
  return n == null ? "N/A" : `$${n.toFixed(2)}`;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeModel(raw: Record<string, unknown>): ModelInfo | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;

  const name = typeof raw.name === "string" && raw.name ? raw.name : id;
  const inputModalities = Array.isArray(raw.input_modalities)
    ? raw.input_modalities.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  return {
    id,
    name,
    context_length: toNullableNumber(raw.context_length),
    max_completion_tokens: toNullableNumber(raw.max_completion_tokens),
    input_cost_per_m: toNullableNumber(raw.input_cost_per_m),
    output_cost_per_m: toNullableNumber(raw.output_cost_per_m),
    supports_vision: toBool(raw.supports_vision),
    supports_tools: toBool(raw.supports_tools),
    supports_structured_outputs: toBool(raw.supports_structured_outputs),
    supports_reasoning: toBool(raw.supports_reasoning),
    input_modalities: inputModalities,
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
    fetch(HYPERCLAW_MODELS_ENDPOINT)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.models)) return;
        const normalizedModels = data.models
          .map((entry: unknown) =>
            entry && typeof entry === "object"
              ? normalizeModel(entry as Record<string, unknown>)
              : null
          )
          .filter((entry: ModelInfo | null): entry is ModelInfo => entry !== null);
        setModels(normalizedModels);
      })
      .catch((error) => {
        console.error("Failed to load model cards", error);
      });
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
        {/* Title */}
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

        {/* Model cards — same grid as pricing */}
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
                {/* Model ID badge */}
                <code className="text-xs text-text-tertiary bg-surface-low px-2.5 py-1 rounded font-mono self-start mb-4">
                  {model.id}
                </code>

                {/* Name + tagline */}
                <h3 className="text-lg font-semibold text-foreground">
                  {display.title}
                </h3>
                <p className="text-sm text-text-tertiary mt-1 mb-4">
                  {display.tagline}
                </p>

                {/* Stats row */}
                <div className="flex items-baseline gap-1 mt-auto mb-1">
                  <span className="text-3xl font-bold text-foreground">
                    {fmtCtx(model.context_length)}
                  </span>
                  <span className="text-text-muted text-sm">context</span>
                </div>
                <p className="text-sm text-text-tertiary mb-6">
                  {fmtCost(model.input_cost_per_m)}/{fmtCost(model.output_cost_per_m)} per M tokens
                </p>

                {/* Capabilities list — same style as pricing features */}
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

        {/* Footnote */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={reveal ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center text-sm text-text-muted mt-8"
        >
          Pricing shown is OpenRouter passthrough cost — included in your
          flat-rate plan. No per-token charges.
        </motion.p>
      </div>
    </section>
  );
}
