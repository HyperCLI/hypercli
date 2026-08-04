import type {
  HyperAgentPlan,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { parseHyperAgentPlanId, type HyperAgentCanonicalPlanId } from "@hypercli.com/sdk/agent";

import { cookieUtils } from "./cookies";

export type PlanTier = "solo" | "team" | "enterprise";
export type PlanCatalogGeneration = "current" | "legacy" | "unknown";

// The backend is authoritative for plans. Canonical IDs come from the SDK's
// parser of the backend payload; heuristics below are legacy fallbacks only.
const CANONICAL_PLAN_TIER: Record<HyperAgentCanonicalPlanId, PlanTier> = {
  solo: "solo",
  team: "team",
  pro: "enterprise",
};

function resolveCanonicalPlanTier(...ids: unknown[]): PlanTier | null {
  for (const id of ids) {
    const canonical = parseHyperAgentPlanId(id);
    if (canonical) return CANONICAL_PLAN_TIER[canonical];
  }
  return null;
}

export interface CachedPlanTier {
  version: 1;
  subject: string;
  environment: string;
  tier: PlanTier;
  expiresAt: number;
}

export const DEFAULT_PLAN_TIER: PlanTier = "solo";
export const PLAN_TIER_COOKIE_NAME = "hypercli_plan_tier";
export const PLAN_TIER_CHANGE_EVENT = "hypercli-plan-tier-changed";
export const BILLING_PLAN_CHANGE_EVENT = "hypercli-billing-plan-changed";
export const PLAN_TIER_CACHE_SECONDS = 24 * 60 * 60;

function normalizedPlanKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizePlanTier(value: unknown): PlanTier | null {
  return value === "solo" || value === "team" || value === "enterprise" ? value : null;
}

export function resolvePlanCatalogGeneration(plans: readonly HyperAgentPlan[]): PlanCatalogGeneration {
  const keys = new Set(plans.flatMap((plan) => [
    normalizedPlanKey(plan.id),
    normalizedPlanKey(plan.canonicalId),
    normalizedPlanKey(plan.name),
  ]));
  const hasCurrentContract = plans.some((plan) => {
    const contractVersion = (plan as HyperAgentPlan & { contractVersion?: string | null }).contractVersion;
    return /^2026(?:-|$)/.test(String(contractVersion ?? ""));
  });

  if (hasCurrentContract || keys.has("solo") || keys.has("enterprise")) return "current";
  if (["free", "starter", "basic", "plus"].some((key) => keys.has(key))) return "legacy";
  return "unknown";
}

export function resolvePlanTierForIdentity(
  planId: unknown,
  planName: unknown,
  generation: PlanCatalogGeneration,
): PlanTier | null {
  const keys = new Set([normalizedPlanKey(planId), normalizedPlanKey(planName)].filter(Boolean));
  const has = (...values: string[]) => values.some((value) => keys.has(value));

  if (generation === "current") {
    if (has("enterprise", "pro")) return "enterprise";
    if (has("team")) return "team";
    if (has("solo", "developer", "individual")) return "solo";
    return null;
  }

  if (generation === "legacy") {
    if (has("enterprise", "team")) return "enterprise";
    if (has("pro")) return "team";
    if (has("free", "starter", "basic", "plus", "solo")) return "solo";
    return null;
  }

  if (has("enterprise", "pro")) return "enterprise";
  if (has("team")) return "team";
  if (has("solo", "developer", "individual", "free", "starter", "basic", "plus")) return "solo";
  return null;
}

function resolveRelativeCatalogTier(
  plan: Pick<HyperAgentPlan, "id">,
  catalog: readonly HyperAgentPlan[],
): PlanTier | null {
  const planId = normalizedPlanKey(plan.id);
  const catalogPlan = catalog.find((candidate) => normalizedPlanKey(candidate.id) === planId);
  if (!catalogPlan) return null;

  const price = Number(catalogPlan.priceUsd ?? catalogPlan.price);
  const prices = [...new Set(catalog
    .map((candidate) => Number(candidate.priceUsd ?? candidate.price))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  if (!Number.isFinite(price) || prices.length <= 1) return null;

  const position = prices.indexOf(price) / (prices.length - 1);
  if (position <= 1 / 3) return "solo";
  if (position <= 2 / 3) return "team";
  return "enterprise";
}

export function resolveCatalogPlanTier(
  plan: Pick<HyperAgentPlan, "id" | "name"> & Partial<Pick<HyperAgentPlan, "canonicalId">>,
  catalog: readonly HyperAgentPlan[],
): PlanTier {
  const generation = resolvePlanCatalogGeneration(catalog);
  return (
    resolveCanonicalPlanTier(plan.canonicalId, plan.id) ??
    resolvePlanTierForIdentity(plan.canonicalId, plan.name, generation) ??
    resolvePlanTierForIdentity(plan.id, plan.name, generation) ??
    resolveRelativeCatalogTier(plan, catalog) ??
    DEFAULT_PLAN_TIER
  );
}

export function resolveAccountPlanTier(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  catalog: readonly HyperAgentPlan[],
): PlanTier {
  if (!summary) return DEFAULT_PLAN_TIER;

  const generation = resolvePlanCatalogGeneration(catalog);
  const effectivePlanId = summary.effectivePlanId || summary.entitlements?.effectivePlanId;
  if (!effectivePlanId) return DEFAULT_PLAN_TIER;

  const effectiveKey = normalizedPlanKey(effectivePlanId);
  const catalogPlan = catalog.find((plan) => (
    normalizedPlanKey(plan.id) === effectiveKey || normalizedPlanKey(plan.canonicalId) === effectiveKey
  ));
  if (catalogPlan) return resolveCatalogPlanTier(catalogPlan, catalog);

  const effectiveItem = [...(summary.activeSubscriptions ?? []), ...(summary.entitlementItems ?? [])]
    .find((item) => normalizedPlanKey(item.planId) === effectiveKey);
  return (
    resolveCanonicalPlanTier(effectivePlanId) ??
    resolvePlanTierForIdentity(effectivePlanId, effectiveItem?.planName, generation) ??
    DEFAULT_PLAN_TIER
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return null;
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getPlanTierSubject(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const expiresAtSeconds = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
  if (!Number.isFinite(expiresAtSeconds) || Date.now() >= expiresAtSeconds * 1000 - 60_000) return null;

  for (const key of ["sub", "user_id", "userId", "id"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function getPlanTierApiBaseUrl(
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  browserOrigin = typeof window !== "undefined" ? window.location.origin : "",
): string {
  const raw = apiBaseUrl.trim();
  try {
    const parsed = new URL(raw || browserOrigin, browserOrigin || undefined);
    const pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/(?:api|agents)$/i, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return (raw || browserOrigin).replace(/\/+$/, "").replace(/\/(?:api|agents)$/i, "");
  }
}

export function getPlanTierEnvironment(
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  browserOrigin = typeof window !== "undefined" ? window.location.origin : "",
): string {
  return getPlanTierApiBaseUrl(apiBaseUrl, browserOrigin).toLowerCase();
}

export function parseCachedPlanTier(value: string | null, now = Date.now()): CachedPlanTier | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CachedPlanTier>;
    const tier = normalizePlanTier(parsed.tier);
    if (
      parsed.version !== 1 ||
      typeof parsed.subject !== "string" ||
      !parsed.subject.trim() ||
      typeof parsed.environment !== "string" ||
      !parsed.environment.trim() ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now ||
      !tier
    ) {
      return null;
    }
    return {
      version: 1,
      subject: parsed.subject,
      environment: parsed.environment,
      tier,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function readCachedPlanTier(
  subject: string,
  environment: string,
  now = Date.now(),
): PlanTier | null {
  const cached = parseCachedPlanTier(cookieUtils.get(PLAN_TIER_COOKIE_NAME), now);
  if (!cached || cached.subject !== subject || cached.environment !== environment) return null;
  return cached.tier;
}

export function writeCachedPlanTier(subject: string, environment: string, tier: PlanTier): void {
  const cached: CachedPlanTier = {
    version: 1,
    subject,
    environment,
    tier,
    expiresAt: Date.now() + PLAN_TIER_CACHE_SECONDS * 1000,
  };
  cookieUtils.setWithMaxAge(PLAN_TIER_COOKIE_NAME, JSON.stringify(cached), PLAN_TIER_CACHE_SECONDS);
}

export function clearCachedPlanTier(): void {
  cookieUtils.remove(PLAN_TIER_COOKIE_NAME);
}

export function applyPlanTier(tier: PlanTier): void {
  if (typeof document === "undefined") return;
  const normalizedTier = normalizePlanTier(tier) ?? DEFAULT_PLAN_TIER;
  document.documentElement.setAttribute("data-plan-tier", normalizedTier);
  document.body?.setAttribute("data-plan-tier", normalizedTier);
}

export function publishPlanTier(tier: PlanTier): void {
  applyPlanTier(tier);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PLAN_TIER_CHANGE_EVENT, { detail: { tier } }));
  }
}

export function notifyBillingPlanChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BILLING_PLAN_CHANGE_EVENT));
}
