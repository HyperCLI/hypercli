"use client";

import Link from "next/link";
import { cn } from "../ui/utils";
import { GlassCard } from "./surface-card";

export interface PricingTierCardProps {
  name: string;
  tagline?: string;
  price: string;
  cadence?: string;
  specs: string[];
  models?: string[];
  gaugePercent?: number;
  highlighted?: boolean;
  ctaLabel: string;
  ctaHref?: string;
  ctaNote?: string;
  onCtaClick?: () => void;
  className?: string;
}

export function PricingTierCard({
  name,
  tagline,
  price,
  cadence = "/mo",
  specs,
  models,
  gaugePercent,
  highlighted = false,
  ctaLabel,
  ctaHref,
  ctaNote,
  onCtaClick,
  className,
}: PricingTierCardProps) {
  const gauge = typeof gaugePercent === "number" ? Math.min(100, Math.max(0, gaugePercent)) : undefined;
  const ctaClasses = cn(
    "inline-flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium transition-all",
    highlighted ? "btn-primary font-semibold" : "btn-secondary",
  );

  return (
    <GlassCard highlighted={highlighted} className={cn("relative flex flex-col p-6", className)}>
      {highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          Most popular
        </span>
      )}
      <h3 className="text-lg font-semibold text-foreground">{name}</h3>
      {tagline && <p className="mt-1 text-sm text-text-muted">{tagline}</p>}
      <div className="mb-1 mt-2">
        <span className="text-3xl font-bold text-foreground">{price}</span>
        {cadence && <span className="text-sm text-text-muted">{cadence}</span>}
      </div>
      {gauge !== undefined && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-high" role="presentation">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${gauge}%` }} />
        </div>
      )}
      <ul className="mb-6 mt-6 flex-1 space-y-2.5">
        {specs.map((spec, index) => (
          <li key={index} className="text-sm text-text-secondary">
            {spec}
          </li>
        ))}
      </ul>
      {models && models.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {models.map((model) => (
            <span key={model} className="rounded-full border border-border-medium/40 bg-surface-low px-2.5 py-0.5 text-xs text-text-muted">
              {model}
            </span>
          ))}
        </div>
      )}
      {ctaHref ? (
        <Link href={ctaHref} className={ctaClasses} onClick={onCtaClick}>
          {ctaLabel}
        </Link>
      ) : (
        <button type="button" onClick={onCtaClick} className={ctaClasses}>
          {ctaLabel}
        </button>
      )}
      {ctaNote && <p className="mt-2.5 text-center text-xs text-text-muted">{ctaNote}</p>}
    </GlassCard>
  );
}
