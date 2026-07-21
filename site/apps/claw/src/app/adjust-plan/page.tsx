"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  HyperAgentCurrentPlan,
  HyperAgentPlan,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import {
  ArrowLeft,
  Bot,
  Brain,
  BriefcaseBusiness,
  Check,
  Code2,
  CreditCard,
  Eye,
  FileText,
  Globe2,
  Mic,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { formatTokens } from "@/lib/format";

type CatalogPlan = HyperAgentPlan & {
  hidden?: boolean;
  meta?: {
    subtitle?: string | null;
    hidden?: boolean | null;
  } | null;
  price_usd?: number;
  subtitle?: string | null;
};

type DisplayPlan = {
  id: string;
  name: string;
  eyebrow: string;
  icon: LucideIcon;
  price: string;
  priceSuffix?: string;
  priceNote?: string;
  action: string;
  actionHref?: string;
  badge?: string;
  current: boolean;
  muted?: boolean;
  intro: string;
  features: Array<{ label: string; included?: boolean }>;
  raw: HyperAgentPlan;
};

type CompareValue = string | boolean;

type CompareRow = {
  label: string;
  icon: LucideIcon;
  values: Record<string, CompareValue>;
};

const PLAN_FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_FETCH_TIMEOUT_MS = 4_000;

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function planPrice(plan: HyperAgentPlan): number {
  const catalogPlan = plan as CatalogPlan;
  return finiteNumber(catalogPlan.priceUsd ?? catalogPlan.price_usd ?? plan.price);
}

function formatPlanPrice(plan: HyperAgentPlan): string {
  const price = planPrice(plan);
  if (price <= 0) return "Included";
  return `$${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

function planSubtitle(plan: HyperAgentPlan): string {
  const catalogPlan = plan as CatalogPlan;
  const explicitSubtitle = catalogPlan.subtitle ?? catalogPlan.meta?.subtitle;
  if (explicitSubtitle) return explicitSubtitle;
  if (plan.agents > 1) return `Up to ${plan.agents} agents`;
  const tpd = finiteNumber(plan.limits?.tpd);
  if (tpd > 0) return `${formatTokens(tpd)} tokens / day`;
  return "Agent plan";
}

function getPlanIcon(plan: HyperAgentPlan): LucideIcon {
  const label = `${plan.id} ${plan.name}`.toLowerCase();
  if (label.includes("enterprise") || label.includes("business")) return BriefcaseBusiness;
  if (label.includes("team") || label.includes("org")) return UsersRound;
  if (label.includes("pro") || label.includes("plus")) return Rocket;
  if (label.includes("free") || label.includes("simple") || label.includes("basic")) return Sparkles;
  return Bot;
}

function planFeatureLabels(plan: HyperAgentPlan): string[] {
  const features = Array.isArray(plan.features) ? plan.features.filter(Boolean) : [];
  const labels = features.slice(0, 5);
  if (labels.length > 0) return labels;

  const limits = plan.limits ?? ({} as HyperAgentPlan["limits"]);
  const generated = [];
  const tpd = finiteNumber(limits.tpd);
  const burstTpm = finiteNumber(limits.burstTpm ?? (limits as { burst_tpm?: number }).burst_tpm);
  const rpm = finiteNumber(limits.rpm ?? plan.rpmLimit);

  if (tpd > 0) generated.push(`${formatTokens(tpd)} tokens / day`);
  if (burstTpm > 0) generated.push(`Up to ${formatTokens(burstTpm)} TPM burst`);
  if (rpm > 0) generated.push(`${formatTokens(rpm)} RPM`);
  if (plan.agents > 0) generated.push(`${plan.agents} agent${plan.agents === 1 ? "" : "s"}`);

  return generated.slice(0, 5);
}

function normalizedFeatureText(plan: HyperAgentPlan): string {
  return [
    plan.id,
    plan.name,
    ...planFeatureLabels(plan),
    ...(Array.isArray(plan.models) ? plan.models : []),
  ]
    .join(" ")
    .toLowerCase();
}

function planHasAny(plan: HyperAgentPlan, words: string[]): boolean {
  const text = normalizedFeatureText(plan);
  return words.some((word) => text.includes(word));
}

function featureValue(plan: HyperAgentPlan, words: string[], fallback = false): boolean {
  if (fallback) return true;
  return planHasAny(plan, words);
}

function firstMatchingFeature(plan: HyperAgentPlan, words: string[]): string | null {
  return planFeatureLabels(plan).find((feature) => words.some((word) => feature.toLowerCase().includes(word))) ?? null;
}

function isCurrentPlan(
  plan: HyperAgentPlan,
  currentPlan: HyperAgentCurrentPlan | null,
  summary: HyperAgentSubscriptionSummary | null,
): boolean {
  if (currentPlan?.id && currentPlan.id === plan.id) return true;
  if (summary?.effectivePlanId && summary.effectivePlanId === plan.id) return true;
  return Boolean(summary?.activeSubscriptions?.some((subscription) => subscription.isCurrent && subscription.planId === plan.id));
}

function buildDisplayPlans(
  catalogPlans: HyperAgentPlan[],
  currentPlan: HyperAgentCurrentPlan | null,
  summary: HyperAgentSubscriptionSummary | null,
): DisplayPlan[] {
  return catalogPlans
    .filter(isVisibleCurrentAgentPlan)
    .sort((a, b) => {
      const priceDelta = planPrice(a) - planPrice(b);
      return priceDelta !== 0 ? priceDelta : a.name.localeCompare(b.name);
    })
    .map((plan) => {
      const current = isCurrentPlan(plan, currentPlan, summary);
      const price = planPrice(plan);
      const featureLabels = planFeatureLabels(plan);
      const includedFeatures =
        featureLabels.length > 0
          ? featureLabels.map((label) => ({ label }))
          : [{ label: "Plan details from billing data" }];

      return {
        id: plan.id,
        name: plan.name,
        eyebrow: planSubtitle(plan),
        icon: getPlanIcon(plan),
        price: formatPlanPrice(plan),
        priceSuffix: price > 0 ? "USD/month" : undefined,
        priceNote: plan.agents > 1 ? `${plan.agents} agents` : "per agent",
        action: current ? "Current" : price > 0 ? "Select plan" : "Included",
        actionHref: current ? undefined : "/plans",
        badge: plan.highlighted ? "Most popular" : undefined,
        current,
        intro: current ? "Your current plan includes:" : "Includes:",
        features: includedFeatures,
        raw: plan,
      };
    });
}

function buildCompareRows(plans: DisplayPlan[]): CompareRow[] {
  const valuesFor = (reader: (plan: DisplayPlan) => CompareValue): Record<string, CompareValue> =>
    Object.fromEntries(plans.map((plan) => [plan.id, reader(plan)]));

  return [
    {
      label: "Price",
      icon: CreditCard,
      values: valuesFor((plan) => (plan.raw.price > 0 || planPrice(plan.raw) > 0 ? `${formatPlanPrice(plan.raw)}/mo` : "Included")),
    },
    {
      label: "Best for",
      icon: UsersRound,
      values: valuesFor((plan) => plan.eyebrow),
    },
    {
      label: "Reasoning & text",
      icon: Brain,
      values: valuesFor((plan) => featureValue(plan.raw, ["reason", "text", "model"], true)),
    },
    {
      label: "Vision & OCR",
      icon: Eye,
      values: valuesFor((plan) => featureValue(plan.raw, ["vision", "ocr", "image"])),
    },
    {
      label: "Audio & transcription",
      icon: Mic,
      values: valuesFor((plan) => featureValue(plan.raw, ["audio", "transcription", "voice"])),
    },
    {
      label: "Web browser",
      icon: Globe2,
      values: valuesFor((plan) => featureValue(plan.raw, ["web", "browser"])),
    },
    {
      label: "Code execution",
      icon: Code2,
      values: valuesFor((plan) => featureValue(plan.raw, ["code", "execution", "terminal"])),
    },
    {
      label: "File parser",
      icon: FileText,
      values: valuesFor((plan) => firstMatchingFeature(plan.raw, ["file", "format", "parser"]) ?? false),
    },
    {
      label: "Daily tokens",
      icon: Zap,
      values: valuesFor((plan) => {
        const tpd = finiteNumber(plan.raw.limits?.tpd);
        return tpd > 0 ? formatTokens(tpd) : "Plan limit";
      }),
    },
    {
      label: "SSO & admin controls",
      icon: ShieldCheck,
      values: valuesFor((plan) => featureValue(plan.raw, ["sso", "admin", "audit"])),
    },
    {
      label: "Self-host & SLA",
      icon: Server,
      values: valuesFor((plan) => featureValue(plan.raw, ["self-host", "self host", "sla"])),
    },
  ];
}

function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-flex h-4 items-center rounded-full px-2 text-[10px] font-semibold leading-none ${
        muted ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
      }`}
    >
      {children}
    </span>
  );
}

function FeatureMark({ included = true }: { included?: boolean }) {
  return included ? (
    <Check className="mt-0.5 h-3 w-3 shrink-0 text-text-secondary" />
  ) : (
    <X className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
  );
}

function PlanCard({ plan }: { plan: DisplayPlan }) {
  const Icon = plan.icon;

  const actionClass = `mt-3 inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold transition-colors ${
    plan.current
      ? "cursor-default border-transparent bg-surface-high text-text-muted"
      : "border-border bg-surface-low text-foreground hover:border-border-strong hover:bg-surface-high"
  }`;

  return (
    <article className={`relative flex min-h-[21.5rem] flex-col rounded-lg p-4 ${plan.current ? "bg-surface-low" : ""}`}>
      <div className="mb-4 flex h-6 items-center justify-between gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-high text-foreground">
          <Icon className="h-3 w-3" />
        </span>
        {plan.badge ? <Badge muted={plan.badge !== "Most popular"}>{plan.badge}</Badge> : null}
      </div>

      <h2 className="truncate text-base font-semibold text-foreground">{plan.name}</h2>
      <p className="mt-1.5 min-h-4 truncate text-xs text-text-muted">{plan.eyebrow}</p>

      <div className="mt-4 min-h-12">
        {plan.price.startsWith("$") ? (
          <div className="flex items-end gap-2">
            <span className="text-[2.1rem] font-extrabold leading-none text-foreground">{plan.price}</span>
            <span className="pb-1 text-[11px] font-semibold leading-tight text-foreground">
              {plan.priceSuffix}
              <br />
              <span className="font-normal text-text-muted">{plan.priceNote}</span>
            </span>
          </div>
        ) : (
          <div className="pt-1 text-xl font-bold text-foreground">{plan.price}</div>
        )}
      </div>

      {plan.actionHref ? (
        <Link href={plan.actionHref} className={actionClass}>
          {plan.action}
        </Link>
      ) : (
        <button type="button" disabled className={actionClass}>
          {plan.action}
        </button>
      )}

      <div className="mt-6">
        <p className="mb-3 text-xs text-text-muted">{plan.intro}</p>
        <ul className="space-y-2.5">
          {plan.features.map((feature) => (
            <li key={feature.label} className={`flex gap-2 text-xs ${feature.included === false ? "text-text-muted" : "text-foreground"}`}>
              <FeatureMark included={feature.included !== false} />
              <span className="line-clamp-1">{feature.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function PlanCardSkeleton() {
  return (
    <article className="min-h-[21.5rem] rounded-lg p-4">
      <div className="mb-4 h-6 w-6 animate-pulse rounded-md bg-surface-low" />
      <div className="h-5 w-24 animate-pulse rounded bg-surface-low" />
      <div className="mt-2 h-4 w-36 animate-pulse rounded bg-surface-low" />
      <div className="mt-5 h-10 w-20 animate-pulse rounded bg-surface-low" />
      <div className="mt-4 h-8 w-full animate-pulse rounded-md bg-surface-low" />
      <div className="mt-7 space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-3 w-full animate-pulse rounded bg-surface-low" />
        ))}
      </div>
    </article>
  );
}

function CompareValueCell({ value }: { value: CompareValue }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-3.5 w-3.5 text-foreground" aria-label="Included" />
    ) : (
      <X className="h-3.5 w-3.5 text-text-muted" aria-label="Not included" />
    );
  }
  return <span className="text-[13px] text-foreground">{value}</span>;
}

export default function AdjustPlanPage() {
  const { getToken } = useAgentAuth();
  const getTokenRef = useRef(getToken);
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<HyperAgentCurrentPlan | null>(null);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const refreshPlans = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getTokenRef.current();
      const hyperAgent = createHyperAgentClient(token ?? "");
      const [catalog, current, subscriptions] = await Promise.allSettled([
        withTimeout(hyperAgent.plans(), PLAN_FETCH_TIMEOUT_MS, "Plan catalog request"),
        withTimeout(hyperAgent.currentPlan(), PLAN_FETCH_TIMEOUT_MS, "Current plan request"),
        withTimeout(hyperAgent.subscriptionSummary(), SUMMARY_FETCH_TIMEOUT_MS, "Billing summary request"),
      ]);

      if (catalog.status === "fulfilled") {
        setCatalogPlans(catalog.value);
      } else {
        setCatalogPlans([]);
        setError("Plan catalog is unavailable right now.");
      }

      setCurrentPlan(current.status === "fulfilled" ? current.value : null);
      setSummary(subscriptions.status === "fulfilled" ? subscriptions.value : null);
    } catch {
      setCatalogPlans([]);
      setCurrentPlan(null);
      setSummary(null);
      setError("Plan catalog is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  const plans = useMemo(() => buildDisplayPlans(catalogPlans, currentPlan, summary), [catalogPlans, currentPlan, summary]);
  const compareRows = useMemo(() => buildCompareRows(plans), [plans]);

  return (
    <main className="min-h-screen bg-background px-4 pb-10 pt-6 text-foreground sm:px-6 lg:px-8">
      <Link
        href="/dashboard/agents"
        aria-label="Back to agents"
        className="fixed left-5 top-6 z-10 flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground sm:left-10 sm:top-8"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>

      <section className="mx-auto max-w-[1180px] pt-12">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl lg:text-[2.125rem]">
            Adjust your agent plan
          </h1>
          <p className="mt-2 text-sm text-text-muted">Choose the plan that fits this agent best.</p>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-background p-3 sm:p-4 lg:p-5">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <PlanCardSkeleton key={index} />
              ))}
            </div>
          ) : plans.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm font-semibold text-foreground">No plans are available right now.</p>
              <p className="max-w-md text-xs text-text-muted">{error ?? "Try refreshing the plan catalog."}</p>
              <button
                type="button"
                onClick={() => void refreshPlans()}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-low px-3 text-xs font-semibold text-foreground hover:bg-surface-high"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          Prices in USD. Cancel anytime. Taxes may apply where applicable.
        </p>
      </section>

      {!loading && plans.length > 0 ? (
        <section className="mx-auto mt-12 max-w-[1180px]">
          <h2 className="text-center text-xl font-semibold text-foreground">Compare features</h2>

          <div className="mt-7 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="w-[18%] px-5 py-5 text-xs font-medium text-text-muted" />
                  {plans.map((plan) => (
                    <th key={plan.id} className="px-5 py-5 text-sm font-semibold text-foreground">
                      <div className="flex items-center gap-2">
                        <span className={plan.muted ? "text-text-muted" : ""}>{plan.name}</span>
                        {plan.badge ? <Badge muted={plan.badge !== "Most popular"}>{plan.badge}</Badge> : null}
                        {plan.current ? <Badge muted>Current</Badge> : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, index) => {
                  const Icon = row.icon;
                  return (
                    <tr key={row.label} className={index % 2 === 0 ? "bg-background" : "bg-surface-low"}>
                      <th className="px-5 py-3 text-[13px] font-medium text-foreground">
                        <span className="flex items-center gap-2.5">
                          <Icon className="h-3.5 w-3.5 text-text-secondary" />
                          {row.label}
                        </span>
                      </th>
                      {plans.map((plan) => (
                        <td key={plan.id} className="px-5 py-3 align-middle">
                          <CompareValueCell value={row.values[plan.id]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
