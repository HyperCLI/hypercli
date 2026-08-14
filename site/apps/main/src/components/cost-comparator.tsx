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
  return `$${Math.round(value).toLocaleString("en-US")}/mo`;
}

export function CostComparator() {
  const [selected, setSelected] = useState(1);
  const tier = PLAN_TIERS[selected];
  const dailyM = DAILY_TOKENS_M[selected];

  return (
    <div>
      <div className="inline-flex flex-wrap justify-center gap-2.5" role="tablist" aria-label="Daily token usage">
        {DAILY_TOKENS_M.map((tokens, index) => (
          <button
            key={tokens}
            type="button"
            role="tab"
            aria-selected={selected === index}
            onClick={() => setSelected(index)}
            className={cn(
              "cursor-pointer rounded-2xl border px-3.5 py-2 text-[13px] font-semibold transition-[transform,translate,box-shadow,border-color,background-color,color] duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F7CFF] motion-reduce:transition-none sm:px-[26px] sm:py-[13px] sm:text-base",
              selected === index
                ? "border-[#3D68E6] bg-[#3D68E6] text-white shadow-[0_1px_0_#3157C7,0_6px_16px_-5px_rgba(79,124,255,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] dark:border-[#4F7CFF] dark:bg-[#4F7CFF] dark:shadow-[0_1px_0_#3D68E6,0_8px_20px_-5px_rgba(79,124,255,0.55),inset_0_1px_0_rgba(255,255,255,0.18)]"
                : "border-[#CBD5E1] bg-white text-[#1F2937] shadow-[0_1px_0_#CBD5E1,0_3px_8px_-2px_rgba(31,41,55,0.10)] hover:-translate-y-0.5 hover:border-[#4F7CFF] hover:text-[#3157C7] hover:shadow-[0_2px_0_#CBD5E1,0_8px_18px_-6px_rgba(79,124,255,0.25)] active:translate-y-0 active:shadow-[0_1px_0_#CBD5E1,0_2px_5px_-2px_rgba(31,41,55,0.12)] motion-reduce:hover:translate-y-0 dark:border-white/15 dark:bg-[#1B2331] dark:text-[#E8EDF4] dark:shadow-[0_1px_0_rgba(255,255,255,0.06),0_4px_10px_-2px_rgba(0,0,0,0.5)] dark:hover:border-[#5D87FF] dark:hover:text-[#9DB4FF] dark:hover:shadow-[0_2px_0_rgba(255,255,255,0.06),0_8px_18px_-6px_rgba(79,124,255,0.25)] dark:active:shadow-[0_1px_0_rgba(255,255,255,0.06),0_2px_5px_-2px_rgba(0,0,0,0.5)]",
            )}
          >
            {tokens}M / day
          </button>
        ))}
      </div>

      <div className="mx-auto mt-6 max-w-[540px] space-y-3 text-left">
        {COMPETITORS.map((competitor) => (
          <div
            key={competitor.name}
            className="flex items-center justify-between gap-3 rounded-[18px] border border-[#CBD5E1] bg-[#FDFDFB] px-5 py-5 dark:border-white/10 dark:bg-[#1A2230] sm:px-6"
          >
            <span className="text-[17px] font-bold leading-[1.35] text-foreground">
              {competitor.name}
              <small className="mt-0.5 block text-[13.5px] font-normal text-text-secondary">{competitor.rateNote}</small>
            </span>
            <span className="whitespace-nowrap text-xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-[22px]">
              {fmtMonthly(dailyM * 30 * competitor.blendedPerM)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-[18px] border-2 border-[#4F7CFF] bg-[#D6E2FB] px-[19px] py-[19px] dark:border-[#5D87FF] dark:bg-[rgba(79,124,255,0.17)] sm:px-[23px]">
          <span className="text-[17px] font-bold leading-[1.35] text-[#2D5BD1] dark:text-[#AFC5FF]">
            HyperCLI — {tier.models[0]}, flat
            <small className="mt-0.5 block text-[13.5px] font-medium text-[#4F7CFF] dark:text-[#8FADFF]">
              your tier price — no meter, ever
            </small>
          </span>
          <span className="whitespace-nowrap text-xl font-extrabold tabular-nums tracking-tight text-[#2D5BD1] dark:text-[#AFC5FF] sm:text-[22px]">
            ${tier.price}/mo
          </span>
        </div>
      </div>

      <p className="mx-auto mt-[18px] max-w-[560px] text-sm leading-relaxed text-text-secondary">
        What you&apos;d pay running this volume through their metered APIs: 80% input / 20% output at published list
        prices, 30-day month.
      </p>

      <details className="group mx-auto mt-3.5 max-w-[540px] text-left">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[#4F7CFF] hover:underline dark:text-[#5D87FF] [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="inline-block font-bold transition-transform group-open:rotate-45">
            +
          </span>
          How is this possible?
        </summary>
        <div className="mt-2.5 rounded-[14px] bg-surface-low px-5 py-4 text-sm leading-relaxed text-text-secondary">
          Kimi&apos;s weights are open, so we run the model on our own inference fleet instead of renting metered API
          capacity and marking it up. Your daily pool is sized for real agent workloads, and fair-use pooling absorbs
          the days that run hotter. <b className="font-semibold text-foreground">Flat rate is the cost structure.</b>
        </div>
      </details>
    </div>
  );
}
