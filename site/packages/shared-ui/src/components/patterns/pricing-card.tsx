"use client";

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../ui/utils";
import { GlassCard } from "./surface-card";

export interface PricingCardFeature {
  label: ReactNode;
  included?: boolean;
}

export function PricingCard({
  name,
  price,
  cadence = "/month",
  eyebrow,
  summary,
  detail,
  features,
  highlighted = false,
  actionLabel,
  onAction,
  className,
}: {
  name: ReactNode;
  price: ReactNode;
  cadence?: ReactNode;
  eyebrow?: ReactNode;
  summary?: ReactNode;
  detail?: ReactNode;
  features: PricingCardFeature[];
  highlighted?: boolean;
  actionLabel?: ReactNode;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <GlassCard highlighted={highlighted} className={cn("flex flex-col p-6", className)}>
      {eyebrow && (
        <div className="mb-4 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {eyebrow}
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground">{name}</h3>
      <div className="mb-1 mt-2">
        <span className="text-3xl font-bold text-foreground">{price}</span>
        {cadence && <span className="text-sm text-text-muted">{cadence}</span>}
      </div>
      {summary && <p className="mb-1 text-sm text-text-tertiary">{summary}</p>}
      {detail && <p className="mb-6 text-xs text-text-muted">{detail}</p>}
      <ul className="mb-8 flex-1 space-y-3">
        {features.map((feature, index) => {
          const included = feature.included ?? true;
          return (
            <li key={index} className="flex items-start gap-2 text-sm text-text-secondary">
              {included ? (
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              ) : (
                <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted/40" />
              )}
              <span className={included ? undefined : "text-text-muted/60"}>{feature.label}</span>
            </li>
          );
        })}
      </ul>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn("w-full rounded-lg py-2.5 text-sm font-medium transition-all", highlighted ? "btn-primary" : "btn-secondary")}
        >
          {actionLabel}
        </button>
      )}
    </GlassCard>
  );
}

export function CapabilityList({
  items,
  className,
}: {
  items: PricingCardFeature[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((item, index) => {
        const included = item.included ?? true;
        return (
          <li key={index} className="flex items-center gap-2 text-sm">
            {included ? <Check className="h-4 w-4 flex-shrink-0 text-primary" /> : <X className="h-4 w-4 flex-shrink-0 text-text-muted/40" />}
            <span className={included ? "text-text-secondary" : "text-text-muted/50"}>{item.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
