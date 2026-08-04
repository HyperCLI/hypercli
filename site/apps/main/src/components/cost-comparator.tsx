"use client";

import { useState } from "react";
import { cn } from "@hypercli/shared-ui";
import { PLAN_TIERS } from "@/lib/plans";

const DAILY_TOKENS_M = [25, 50, 100];

const COMPETITORS = [
  { name: "Claude Fable 5", rateNote: "$10 in / $50 out per M", blendedPerM: 18 },
  { name: "GPT-5.6 Sol", rateNote: "$5 in / $30 out per M", blendedPerM: 10 },
];

function fmtMonthly(value: number) {
  return `$${Math.round(value).toLocaleString()}/mo`;
}

export function CostComparator() {
  const [selected, setSelected] = useState(2);
  const tier = PLAN_TIERS[selected];
  const dailyM = DAILY_TOKENS_M[selected];

  return (
    <div>
      <p className="mb-3.5 text-base font-semibold text-foreground">What does your daily usage cost?</p>
      <div className="inline-flex flex-wrap justify-center gap-2.5" role="tablist" aria-label="Daily token usage">
        {DAILY_TOKENS_M.map((tokens, index) => (
          <button
            key={tokens}
            type="button"
            role="tab"
            aria-selected={selected === index}
            onClick={() => setSelected(index)}
            className={cn(
              "rounded-2xl border px-6 py-3 text-base font-semibold transition-all",
              selected === index
                ? "border-primary bg-primary text-primary-foreground shadow-[0_6px_16px_-5px_rgb(var(--button-primary-rgb)_/_0.45)]"
                : "border-border-medium bg-surface text-foreground hover:-translate-y-0.5 hover:border-primary hover:text-primary",
            )}
          >
            {tokens}M / day
          </button>
        ))}
      </div>

      <div className="mx-auto mt-6 max-w-xl space-y-3 text-left">
        {COMPETITORS.map((competitor) => (
          <div
            key={competitor.name}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border-medium bg-surface-low px-6 py-5"
          >
            <span className="text-lg font-bold leading-snug text-foreground">
              {competitor.name}
              <small className="mt-0.5 block text-sm font-normal text-text-secondary">{competitor.rateNote}</small>
            </span>
            <span className="whitespace-nowrap text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
              {fmtMonthly(dailyM * 30 * competitor.blendedPerM)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-primary bg-primary/10 px-6 py-5">
          <span className="text-lg font-bold leading-snug text-primary">
            HyperCLI — {tier.models[0]}, flat
            <small className="mt-0.5 block text-sm font-medium text-primary/80">your tier price — no meter, ever</small>
          </span>
          <span className="whitespace-nowrap text-2xl font-extrabold tabular-nums tracking-tight text-primary">
            ${tier.price}/mo
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm text-text-secondary">
        Assumes 80% input / 20% output at published list prices, 30-day month. Yes, we double-checked.
      </p>
    </div>
  );
}
