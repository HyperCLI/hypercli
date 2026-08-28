"use client";

import React from "react";
import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";
import {
  Check,
  CreditCard,
  Cpu,
  Package,
  Server,
  X,
  Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@hypercli/shared-ui";
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
  returnFocusRef?: React.RefObject<HTMLElement | null>;
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

function agentSizeLabel(plan: HyperAgentPlan): string {
  if (!plan.maxAgentSize) return "-";
  return plan.maxAgentSize.charAt(0).toUpperCase() + plan.maxAgentSize.slice(1);
}

function agentSlotsLabel(plan: HyperAgentPlan): string {
  const granted = Object.values(plan.slotGrants ?? {}).reduce((total, count) => total + Number(count || 0), 0);
  return textValue(granted > 0 ? granted : plan.agents);
}

function memoryPerAgentLabel(plan: HyperAgentPlan): string {
  const resources = plan.agentResources;
  if (!resources || resources.maxAgents <= 0 || resources.totalMemory <= 0) return "-";
  const memory = resources.totalMemory / resources.maxAgents;
  return `${Number.isInteger(memory) ? memory : memory.toFixed(1)} GB`;
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

function sharedFeatures(plans: ComparisonPlan[]): string[] {
  if (plans.length === 0) return [];
  const candidates = plans[0].plan.features ?? [];
  return candidates.filter((feature) => plans.every(({ plan }) => (
    (plan.features ?? []).some((candidate) => candidate.trim().toLowerCase() === feature.trim().toLowerCase())
  )));
}

function valueCell(value: string | boolean) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-success" aria-label="Included" />
    ) : (
      <X className="h-4 w-4 text-text-muted/55" aria-label="Not included" />
    );
  }
  return <span className="text-[14px] leading-snug text-foreground">{value}</span>;
}

export function PlanComparisonModal({ open, onClose, catalogPlans, returnFocusRef }: PlanComparisonModalProps) {
  const comparisonPlans = visibleCatalogPlans(catalogPlans);
  const includedInEveryPlan = sharedFeatures(comparisonPlans);
  const sharedFeatureNames = new Set(includedInEveryPlan.map((feature) => feature.trim().toLowerCase()));
  const featureRows = uniqueFeatures(comparisonPlans).filter((feature) => !sharedFeatureNames.has(feature.trim().toLowerCase()));

  const rows: ComparisonRow[] = [
    {
      label: "Price",
      icon: CreditCard,
      values: rowValues(comparisonPlans, priceLabel),
    },
    {
      label: "Agent slots",
      icon: Cpu,
      values: rowValues(comparisonPlans, agentSlotsLabel),
    },
    {
      label: "Agent size",
      icon: Package,
      values: rowValues(comparisonPlans, agentSizeLabel),
    },
    {
      label: "Memory per agent",
      icon: Server,
      values: rowValues(comparisonPlans, memoryPerAgentLabel),
    },
    {
      label: "Daily token pool",
      icon: Zap,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.tpd, "/day")),
    },
    {
      label: "Burst capacity",
      icon: Zap,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.burstTpm)),
    },
    {
      label: "Requests per minute",
      icon: Server,
      values: rowValues(comparisonPlans, (plan) => limitLabel(plan.limits?.rpm)),
    },
    ...featureRows.map((feature): ComparisonRow => ({
      label: feature,
      icon: Check,
      values: rowValues(comparisonPlans, (plan) =>
        Boolean((plan.features ?? []).some((candidate) => candidate.trim().toLowerCase() === feature.toLowerCase())),
      ),
    })),
  ];
  const planColumnCount = Math.max(comparisonPlans.length, 1);
  const comparisonMinWidth = 240 + planColumnCount * 180;
  const columnTemplate = `240px repeat(${planColumnCount}, minmax(180px, 1fr))`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        closeLabel="Close plan comparison"
        onCloseAutoFocus={(event) => {
          const returnTarget = returnFocusRef?.current;
          if (!returnTarget?.isConnected) return;
          event.preventDefault();
          if (!returnTarget.closest('[aria-hidden="true"]')) returnTarget.focus();
        }}
        overlayClassName="z-[10008] bg-black/85 backdrop-blur-[2px]"
        className="z-[10009] flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[900px] flex-col gap-0 overflow-hidden rounded-[14px] border-border bg-background-secondary p-0 text-foreground shadow-[0_24px_70px_rgb(0_0_0_/_0.5)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-[900px]"
      >
        <header className="shrink-0 px-4 pb-4 pt-4 pr-12">
          <DialogTitle className="text-[18px] font-medium leading-tight tracking-[-0.015em] text-foreground">Compare plans</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] leading-5 text-text-muted">
            See how capacity, performance, and features scale across each plan.
          </DialogDescription>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {comparisonPlans.length === 0 ? (
            <div className="rounded-[12px] border border-border bg-surface-low px-5 py-4 text-[14px] text-text-secondary">
              Plan comparison is unavailable right now.
            </div>
          ) : (
            <>
              <div
                className="overflow-hidden rounded-[14px] border border-border bg-surface-low"
                style={{ minWidth: `${comparisonMinWidth}px` }}
              >
                <div className="grid border-b border-border bg-surface-low" style={{ gridTemplateColumns: columnTemplate }}>
                  <div className="px-6 py-4" />
                  {comparisonPlans.map((plan) => (
                    <div key={plan.id} className="flex min-w-0 items-center gap-2 px-6 py-4">
                      <span className="min-w-0 truncate text-[16px] font-semibold leading-none text-foreground">
                        {plan.name}
                      </span>
                      {plan.plan.highlighted && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-selection-accent/20 px-2 py-1 text-[10px] font-semibold leading-none text-selection-accent">
                          Most Popular
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {rows.map((row, rowIndex) => {
                  const Icon = row.icon;
                  const rowBackground = rowIndex % 2 === 0 ? "bg-surface-high/45" : "bg-background/35";
                  return (
                    <div
                      key={row.label}
                      className={`grid min-h-10 ${rowBackground}`}
                      style={{ gridTemplateColumns: columnTemplate }}
                    >
                      <div className="flex min-w-0 items-center gap-2.5 px-6 py-2.5 text-[13px] text-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        <span className="min-w-0 break-words">{row.label}</span>
                      </div>
                      {comparisonPlans.map((plan) => (
                        <div key={`${row.label}-${plan.id}`} className="flex min-w-0 items-center px-6 py-2.5">
                          {valueCell(row.values[plan.id] ?? "-")}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <section
                className="mt-4 rounded-[12px] border border-border bg-background/35 p-4"
                style={{ minWidth: `${comparisonMinWidth}px` }}
              >
                <h3 className="text-[14px] font-semibold text-foreground">Included in every plan</h3>
                {includedInEveryPlan.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {includedInEveryPlan.map((feature) => (
                      <span key={feature} className="inline-flex items-center gap-1.5 rounded-full bg-selection-accent/20 px-2.5 py-0.5 text-[12px] font-medium text-selection-accent">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        {feature}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] text-text-muted">No shared plan features are reported in the current catalog.</p>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
