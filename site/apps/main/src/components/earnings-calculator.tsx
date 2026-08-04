"use client";

import { useState } from "react";
import { GlassCard } from "@hypercli/shared-ui";

const GPU_ANNUAL_SHARE_USD = 7000;

export function EarningsCalculator() {
  const [gpus, setGpus] = useState(100);
  const revenue = gpus * GPU_ANNUAL_SHARE_USD;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-4">
        <label htmlFor="gpu-count" className="whitespace-nowrap text-sm text-text-secondary">
          H100s connected
        </label>
        <input
          id="gpu-count"
          type="range"
          min={8}
          max={512}
          step={8}
          value={gpus}
          onChange={(event) => setGpus(Number(event.target.value))}
          className="flex-1 accent-primary"
        />
        <output className="min-w-12 text-right text-lg font-bold tabular-nums text-foreground">{gpus}</output>
      </div>
      <GlassCard className="border-primary/40 bg-primary/5 p-8 text-center">
        <p className="mb-1.5 text-sm text-text-secondary">Estimated annual data center share</p>
        <p className="text-4xl font-extrabold tracking-tight text-primary">~${revenue.toLocaleString()}/yr</p>
        <p className="mt-2.5 text-xs text-primary">Monthly payouts · per-job metering · full dashboard visibility</p>
      </GlassCard>
      <p className="mt-4 text-center text-xs text-text-muted">
        *Assumes typical availability at current utilization. Mixed and older fleets earn proportionally — if it runs
        Docker, it can earn.
      </p>
    </div>
  );
}
