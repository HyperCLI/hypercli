"use client";

import React from "react";
import type { HyperAgentPlan, HyperAgentSubscription, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";

type CatalogPlan = HyperAgentPlan & {
  priceUsd?: number;
  price_usd?: number;
};

interface PurchasedPlanSummary {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  tpd: number;
  slotCount: number;
  score: number;
}

interface AgentPlanSummaryProps {
  planName?: string | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  tokenLimit?: number | null;
  tokenUsageLabel?: string;
  trigger?: React.ReactElement;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

function titleizePlanId(planId: string | null | undefined): string {
  const words = (planId || "").split(/[-_]/).filter(Boolean);
  if (words.length === 0) return "Current";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function inferPlanLabel(tokenTotal: number | null): string {
  if (!tokenTotal) return "Current";
  if (tokenTotal >= 500_000_000) return "Team";
  if (tokenTotal >= 250_000_000) return "Pro";
  if (tokenTotal >= 50_000_000) return "Starter";
  return "Free";
}

function formatPlanLabel(label: string): string {
  return /\bplan\b/i.test(label) ? label : `${label} plan`;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function catalogPrice(plan: HyperAgentPlan | null | undefined): number | null {
  if (!plan) return null;
  const price = finiteNumber((plan as CatalogPlan).priceUsd ?? (plan as CatalogPlan).price_usd ?? plan.price, Number.NaN);
  return Number.isFinite(price) ? price : null;
}

function planTpd(plan: HyperAgentPlan | null | undefined): number {
  return finiteNumber(plan?.limits?.tpd ?? 0);
}

function subscriptionQuantity(subscription: HyperAgentSubscription): number {
  if (subscription.quantity == null) return 1;
  return Math.max(finiteNumber(subscription.quantity, 0), 0);
}

function subscriptionSlotCount(subscription: HyperAgentSubscription): number {
  const quantity = subscriptionQuantity(subscription);
  return Object.values(subscription.slotGrants ?? {}).reduce(
    (total, count) => total + Math.max(finiteNumber(count), 0) * quantity,
    0,
  );
}

function isActiveLikeStatus(statusValue: string | null | undefined): boolean {
  const status = String(statusValue || "").trim().toLowerCase();
  if (!status) return true;
  return ["active", "trialing", "paid"].includes(status);
}

function activeEntitlementCount(subscription: HyperAgentSubscription): number {
  const entitlements = subscription.entitlements ?? [];
  if (entitlements.length > 0) {
    return entitlements.filter((entitlement) => isActiveLikeStatus(entitlement.status)).length;
  }
  return subscriptionSlotCount(subscription) > 0 ? subscriptionQuantity(subscription) : 0;
}

function isDisplayableSubscription(subscription: HyperAgentSubscription): boolean {
  const status = String(subscription.status || "").trim().toLowerCase();
  if (["canceled", "cancelled", "expired", "inactive", "incomplete", "past_due", "unpaid"].includes(status)) {
    return false;
  }
  return isActiveLikeStatus(status) && activeEntitlementCount(subscription) >= 1;
}

function purchasedSubscriptions(summary: HyperAgentSubscriptionSummary | null | undefined): HyperAgentSubscription[] {
  if (!summary) return [];
  const byId = new Map<string, HyperAgentSubscription>();
  for (const subscription of summary.activeSubscriptions ?? []) {
    if (!isDisplayableSubscription(subscription)) continue;
    byId.set(subscription.id || `${subscription.planId}:${subscription.planName}`, subscription);
  }
  for (const subscription of summary.subscriptions ?? []) {
    if (!isDisplayableSubscription(subscription)) continue;
    const key = subscription.id || `${subscription.planId}:${subscription.planName}`;
    if (!byId.has(key)) byId.set(key, subscription);
  }
  return Array.from(byId.values());
}

function buildPlanScore(unitPrice: number | null, tpd: number, slotCount: number): number {
  return (unitPrice ?? -1) * 1_000_000_000 + tpd + slotCount * 1_000_000;
}

function collectPurchasedPlans({
  planName,
  subscriptionSummary,
  catalogPlans,
  tokenLimit,
}: Pick<AgentPlanSummaryProps, "planName" | "subscriptionSummary" | "catalogPlans" | "tokenLimit">): PurchasedPlanSummary[] {
  const catalogById = new Map((catalogPlans ?? []).map((plan) => [plan.id, plan]));
  const groups = new Map<string, PurchasedPlanSummary>();

  for (const subscription of purchasedSubscriptions(subscriptionSummary)) {
    const planId = subscription.planId || subscription.planName || "current";
    const catalogPlan = catalogById.get(planId);
    const name = subscription.planName || catalogPlan?.name || titleizePlanId(planId);
    const quantity = activeEntitlementCount(subscription);
    if (quantity < 1) continue;
    const unitPrice = catalogPrice(catalogPlan);
    const tpd = finiteNumber(subscription.planTpd || planTpd(catalogPlan));
    const slotCount = subscriptionSlotCount(subscription);
    const score = buildPlanScore(unitPrice, tpd, slotCount);
    const key = `${planId}:${name}`;
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.tpd = Math.max(existing.tpd, tpd);
      existing.slotCount += slotCount;
      existing.score = Math.max(existing.score, score);
    } else {
      groups.set(key, { id: planId, name, quantity, unitPrice, tpd, slotCount, score });
    }
  }

  const purchasedPlans = Array.from(groups.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.name.localeCompare(right.name);
  });

  if (purchasedPlans.length > 0) return purchasedPlans;

  const fallbackName = planName?.trim() || inferPlanLabel(tokenLimit && tokenLimit > 0 ? tokenLimit : null);
  return [{
    id: fallbackName,
    name: fallbackName,
    quantity: 1,
    unitPrice: null,
    tpd: tokenLimit && tokenLimit > 0 ? tokenLimit : 0,
    slotCount: 0,
    score: buildPlanScore(null, tokenLimit && tokenLimit > 0 ? tokenLimit : 0, 0),
  }];
}

function PlanSummaryTooltip({
  plans,
  tokenUsageLabel,
}: {
  plans: PurchasedPlanSummary[];
  tokenUsageLabel?: string;
}) {
  return (
    <div className="w-[220px] space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">Purchased plans</p>
      <div className="space-y-1">
        {plans.map((plan) => (
          <div
            key={`${plan.id}-${plan.name}`}
            className="flex min-h-8 items-center justify-between gap-3 rounded-lg border border-border bg-surface-low/30 px-2.5 py-1.5"
          >
            <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{formatPlanLabel(plan.name)}</span>
            {plan.quantity > 1 ? (
              <span className="shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                x{plan.quantity}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {tokenUsageLabel ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-[11px]">
          <span className="text-text-muted">Tokens today</span>
          <span className="font-medium text-foreground">{tokenUsageLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AgentPlanSummary({
  planName,
  subscriptionSummary,
  catalogPlans,
  tokenLimit,
  tokenUsageLabel,
  trigger,
  tooltipSide = "top",
}: AgentPlanSummaryProps) {
  const plans = React.useMemo(
    () => collectPurchasedPlans({ planName, subscriptionSummary, catalogPlans, tokenLimit }),
    [catalogPlans, planName, subscriptionSummary, tokenLimit],
  );
  const displayPlan = formatPlanLabel(plans[0]?.name || planName?.trim() || inferPlanLabel(tokenLimit && tokenLimit > 0 ? tokenLimit : null));

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="block max-w-full truncate rounded-md text-left text-sm font-semibold text-foreground transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {displayPlan}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent
        side={tooltipSide}
        className="border border-border bg-background px-3 py-2 text-foreground shadow-xl [&>svg]:bg-background [&>svg]:fill-background"
      >
        <PlanSummaryTooltip plans={plans} tokenUsageLabel={tokenUsageLabel} />
      </TooltipContent>
    </Tooltip>
  );
}

export function getHighestValuePlanLabel({
  planName,
  subscriptionSummary,
  catalogPlans,
  tokenLimit,
}: Pick<AgentPlanSummaryProps, "planName" | "subscriptionSummary" | "catalogPlans" | "tokenLimit">): string {
  const plans = collectPurchasedPlans({ planName, subscriptionSummary, catalogPlans, tokenLimit });
  return formatPlanLabel(plans[0]?.name || planName?.trim() || inferPlanLabel(tokenLimit && tokenLimit > 0 ? tokenLimit : null));
}
