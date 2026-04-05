"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Key, Bot, ArrowRight, X, Zap, MessageSquare } from "lucide-react";
import Link from "next/link";

const DISMISSED_KEY = "hyperclaw_onboarding_dismissed";

interface OnboardingGuideProps {
  onDismiss?: () => void;
}

export function OnboardingGuide({ onDismiss }: OnboardingGuideProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(DISMISSED_KEY) === "1";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 mb-6"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Get Started with HyperClaw</h2>
          <p className="text-sm text-text-muted mt-1">Choose your path to get up and running.</p>
        </div>
        <button onClick={handleDismiss} className="text-text-muted hover:text-foreground p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* API Inference track */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-border p-4 hover:border-border-medium transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-surface-low flex items-center justify-center">
              <Zap className="w-4 h-4 text-text-secondary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">API Inference</h3>
          </div>
          <div className="space-y-2.5">
            <Step number={1} icon={Key} text="Create an API key" />
            <Step number={2} icon={ArrowRight} text="Make your first request" />
            <Step number={3} icon={Zap} text="Monitor usage in dashboard" />
          </div>
          <Link
            href="/keys"
            className="mt-4 btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 w-full"
          >
            Create API Key
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>

        {/* Agent Hosting track */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-lg border border-border p-4 hover:border-border-medium transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-surface-low flex items-center justify-center">
              <Bot className="w-4 h-4 text-text-secondary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Agent Hosting</h3>
          </div>
          <div className="space-y-2.5">
            <Step number={1} icon={Bot} text="Create a persistent agent" />
            <Step number={2} icon={MessageSquare} text="Chat with your agent" />
            <Step number={3} icon={ArrowRight} text="Deploy and go live" />
          </div>
          <Link
            href="/agents"
            className="mt-4 btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 w-full"
          >
            Create Agent
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Step({ number, icon: Icon, text }: { number: number; icon: typeof Key; text: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center text-[10px] font-bold text-text-muted flex-shrink-0">
        {number}
      </div>
      <Icon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
      <span className="text-sm text-text-secondary">{text}</span>
    </div>
  );
}
