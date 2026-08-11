"use client";

import { useState } from "react";
import { PLAN_TIERS } from "@/lib/plans";

const COMPETITORS = [
  { name: "Claude Fable 5", rateNote: "$10 / $50 per M", blendedPerM: 0.8 * 10 + 0.2 * 50 },
  { name: "GPT-5.6 Sol", rateNote: "$5 / $30 per M", blendedPerM: 0.8 * 5 + 0.2 * 30 },
  { name: "Claude Opus 5", rateNote: "$5 / $25 per M", blendedPerM: 0.8 * 5 + 0.2 * 25 },
  { name: "GPT-5.6 Terra", rateNote: "$2 / $12 per M", blendedPerM: 0.8 * 2 + 0.2 * 12 },
];

function fmtMonthly(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}/mo`;
}

export function InferenceCostCalculator() {
  const [dailyM, setDailyM] = useState(50);
  const pro = PLAN_TIERS.find((tier) => tier.id === "pro");
  const team = PLAN_TIERS.find((tier) => tier.id === "team");
  const hyperRows = [
    { tier: pro, label: `HyperCLI — Pro (${pro?.models[0]}), flat` },
    { tier: team, label: `HyperCLI — Team (${team?.models[0]}), flat` },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <label htmlFor="tok" className="whitespace-nowrap text-sm text-text-secondary">
          Tokens per day
        </label>
        <input
          id="tok"
          type="range"
          min={5}
          max={100}
          step={5}
          value={dailyM}
          onChange={(event) => setDailyM(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <output htmlFor="tok" className="min-w-12 text-right text-lg font-bold tabular-nums text-foreground">
          {dailyM}M
        </output>
      </div>

      <div className="space-y-2.5">
        {COMPETITORS.map((competitor) => (
          <div
            key={competitor.name}
            className="flex items-center justify-between gap-3 rounded-xl border border-border-medium bg-surface-low px-5 py-3.5"
          >
            <span className="text-sm text-text-secondary">
              {competitor.name} <small className="text-text-muted">({competitor.rateNote})</small>
            </span>
            <span className="whitespace-nowrap font-bold tabular-nums text-foreground">
              {fmtMonthly(dailyM * 30 * competitor.blendedPerM)}
            </span>
          </div>
        ))}
        {hyperRows.map(
          (row) =>
            row.tier && (
              <div
                key={row.tier.id}
                className="flex items-center justify-between gap-3 rounded-xl border-2 border-primary bg-primary/10 px-5 py-3.5"
              >
                <span className="text-sm font-semibold text-primary">{row.label}</span>
                <span className="whitespace-nowrap font-bold tabular-nums text-primary">${row.tier.price}/mo</span>
              </div>
            ),
        )}
      </div>

      <p className="mt-4 text-center text-xs text-text-muted">
        Assumes 80% input / 20% output at list prices, 30-day month. Solo includes 25M tokens/day, Team 50M, Pro 100M
        — pooled across your agents and your API key.
      </p>
    </div>
  );
}
