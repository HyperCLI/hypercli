"use client";

import React from "react";
import { createPortal } from "react-dom";
import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import {
  Check,
  CreditCard,
  Cpu,
  ListChecks,
  Package,
  Server,
  X,
  Zap,
} from "lucide-react";
import { formatTokens } from "@/lib/format";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";

type CatalogPlan = HyperAgentPlan & {
  price_usd?: number;
};

type ComparisonPlan = {
  id: string;
  name: string;
  plan: HyperAgentPlan;
};

type ComparisonRow = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  values: Record<string, string | boolean>;
};

interface PlanComparisonModalProps {
  open: boolean;
  onClose: () => void;
  catalogPlans?: HyperAgentPlan[] | null;
}

function catalogPrice(plan: HyperAgentPlan | null | undefined): number | null {
  if (!plan) return null;
  const price = Number((plan as CatalogPlan).priceUsd ?? (plan as CatalogPlan).price_usd ?? plan.price);
  return Number.isFinite(price) ? price : null;
}

function priceLabel(plan: HyperAgentPlan): string {
  const price = catalogPrice(plan);
  return price === null ? "Not available" : `$${price}/mo`;
}

function limitLabel(value: unknown, suffix = ""): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return `${formatTokens(numeric)}${suffix}`;
}

function textValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "-";
}

function planSortValue(plan: HyperAgentPlan): number {
  const price = catalogPrice(plan);
  return price === null ? Number.POSITIVE_INFINITY : price;
}

function visibleCatalogPlans(catalogPlans: HyperAgentPlan[] | null | undefined): ComparisonPlan[] {
  return (catalogPlans ?? [])
    .filter(isVisibleCurrentAgentPlan)
    .sort((left, right) => {
      const priceDelta = planSortValue(left) - planSortValue(right);
      if (priceDelta !== 0) return priceDelta;
      return left.name.localeCompare(right.name);
    })
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      plan,
    }));
}

function rowValues(
  plans: ComparisonPlan[],
  read: (plan: HyperAgentPlan) => string | boolean,
): Record<string, string | boolean> {
  return Object.fromEntries(plans.map((plan) => [plan.id, read(plan.plan)]));
}

function uniqueFeatures(plans: ComparisonPlan[]): string[] {
  const seen = new Set<string>();
  const features: string[] = [];
  for (const { plan } of plans) {
    for (const feature of plan.features ?? []) {
      const normalized = feature.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      features.push(normalized);
    }
  }
  return features;
}

function valueCell(value: string | boolean) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-[var(--selection-accent)]" aria-label="Included" />
    ) : (
      <X className="h-4 w-4 text-[#4c4c4f]" aria-label="Not included" />
    );
  }
  return <span className="text-[14px] leading-snug text-[#ececec]">{value}</span>;
}

export function PlanComparisonModal({ open, onClose, catalogPlans }: PlanComparisonModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const comparisonPlans = visibleCatalogPlans(catalogPlans);
  const featureRows = uniqueFeatures(comparisonPlans);

  const rows: ComparisonRow[] = [
    {
      label: "Price",
      icon: CreditCard,
      values: rowValues(comparisonPlans, priceLabel),
    },
    {
      label: "AIU",
      icon: Cpu,
      values: rowValues(comparisonPlans, (plan) => textValue(plan.aiu)),
    },
    {
      label: "Agents",
      icon: Package,
      values: rowValues(comparisonPlans, (plan) => textValue(plan.agents)),
    },
    {
      label: "Daily tokens",
      icon: Zap,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.tpd, "/day")),
    },
    {
      label: "TPM",
      icon: Zap,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.tpm)),
    },
    {
      label: "Burst TPM",
      icon: Zap,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.burstTpm)),
    },
    {
      label: "RPM",
      icon: Server,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.rpm)),
    },
    {
      label: "Models",
      icon: ListChecks,
      values: rowValues(comparisonPlans, (plan) => (plan.models?.length ? plan.models.join(", ") : "-")),
    },
    ...featureRows.map((feature): ComparisonRow => ({
      label: feature,
      icon: Check,
      values: rowValues(comparisonPlans, (plan) =>
        Boolean((plan.features ?? []).some((candidate) => candidate.trim().toLowerCase() === feature.toLowerCase())),
      ),
    })),
  ];
  const columnTemplate = `220px repeat(${Math.max(comparisonPlans.length, 1)}, minmax(180px, 1fr))`;

  return createPortal(
    <div
      data-theme="green"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plan comparison"
        className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[1420px] flex-col overflow-hidden rounded-[16px] border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[#171717] text-[#f3f3f3] shadow-[0_24px_70px_rgba(0,0,0,0.55),0_0_80px_rgb(var(--selection-accent-rgb)_/_0.08)]"
      >
        <button
          type="button"
          aria-label="Close plan comparison"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[8px] text-[#b9b9bc] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.12)] hover:text-[var(--selection-accent)]"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 flex-1 overflow-auto p-5 pt-12 sm:p-6 sm:pt-12">
          {comparisonPlans.length === 0 ? (
            <div className="rounded-[12px] border border-[#333336] bg-[#141414] px-5 py-4 text-[14px] text-[#a8a8ac]">
              Plan comparison is unavailable right now.
            </div>
          ) : (
            <div className="min-w-[760px] overflow-hidden rounded-[14px] border border-[rgb(var(--selection-accent-rgb)_/_0.16)] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="grid border-b border-[rgb(var(--selection-accent-rgb)_/_0.18)] bg-[#191919]" style={{ gridTemplateColumns: columnTemplate }}>
                <div className="px-6 py-7" />
                {comparisonPlans.map((plan) => (
                  <div key={plan.id} className="flex items-center gap-3 px-6 py-7">
                    <span className="text-[18px] font-semibold leading-none text-[#eeeeee]">
                      {plan.name}
                    </span>
                    {plan.plan.highlighted && (
                      <span className="rounded-full bg-[var(--selection-accent)] px-2 py-1 text-[12px] font-semibold leading-none text-[var(--selection-accent-foreground)] shadow-[0_8px_22px_rgb(var(--selection-accent-rgb)_/_0.22)]">
                        Popular
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {rows.map((row, rowIndex) => {
                const Icon = row.icon;
                const rowBackground = rowIndex % 2 === 0 ? "bg-[#1a1a19]" : "bg-[#141416]";
                return (
                  <div
                    key={row.label}
                    className={`grid min-h-[52px] ${rowBackground}`}
                    style={{ gridTemplateColumns: columnTemplate }}
                  >
                    <div className="flex items-center gap-3 px-6 py-4 text-[14px] text-[#e4e4e7]">
                      <Icon className="h-4 w-4 text-[var(--selection-accent)]" />
                      <span>{row.label}</span>
                    </div>
                    {comparisonPlans.map((plan) => (
                      <div key={`${row.label}-${plan.id}`} className="flex items-center px-6 py-4">
                        {valueCell(row.values[plan.id] ?? "-")}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
