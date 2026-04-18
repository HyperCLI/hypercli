"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Brain,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface IntelligencePanelProps {
  config: Record<string, unknown> | null;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
}

const MOCK_PLAN = {
  name: "1 AIU Plan",
  tokensPerDay: "500M",
  tpmLimit: "600K",
  rpmLimit: "3,000",
  billingReset: "2026-05-10",
};

const MOCK_MODELS = [
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    contextWindow: "262K",
    capabilities: ["Reasoning", "Vision", "Tool Use"],
    description: "High-performance reasoning model with extended context. Excellent for complex analysis and multi-step tasks.",
  },
  {
    id: "glm-5",
    name: "GLM-5",
    contextWindow: "202K",
    capabilities: ["Reasoning", "Tool Use"],
    description: "Fast, capable reasoning model. Great for general-purpose tasks and quick responses.",
  },
];

export function IntelligencePanel({ config, onSaveConfig }: IntelligencePanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-[#38D39F]/20 bg-[#38D39F]/5 p-5"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#38D39F]/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-[#38D39F]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">HyperClaw Intelligence</h3>
            <p className="text-sm text-text-muted mt-1">
              Your agent&apos;s reasoning is powered by HyperClaw&apos;s inference network.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Plan</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.name}</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Tokens / Day</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.tokensPerDay}</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Rate Limits</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.tpmLimit} TPM \u00b7 {MOCK_PLAN.rpmLimit} RPM</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Billing Reset</p>
            <p className="text-sm font-semibold text-foreground">{new Date(MOCK_PLAN.billingReset).toLocaleDateString()}</p>
          </div>
        </div>
      </motion.div>

      {/* Model Cards */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Available Models</h4>
        <div className="space-y-3">
          {MOCK_MODELS.map((model) => (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-surface-low/30 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-low flex items-center justify-center shrink-0 border border-border">
                  <Brain className="w-4 h-4 text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{model.name}</span>
                    <span className="text-[10px] text-text-muted font-mono">{model.contextWindow} ctx</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">{model.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {model.capabilities.map((cap) => (
                      <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-low border border-border text-text-muted">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Advanced: External Providers */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-foreground transition-colors"
        >
          {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Add External Provider
        </button>
        {advancedOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-3 rounded-xl border border-border bg-surface-low/30 p-4"
          >
            <p className="text-sm text-text-muted mb-3">
              HyperClaw provides all the intelligence your agent needs. Add external providers if you have specific model requirements.
            </p>
            <p className="text-xs text-text-muted">
              Configure external providers in the{" "}
              <span className="text-foreground font-medium">OpenClaw</span> tab for full control over provider settings, model aliases, and fallback chains.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
