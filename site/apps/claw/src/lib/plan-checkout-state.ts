import type {
  HyperAgentCurrentPlan,
  HyperAgentPlan,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";

const PENDING_CHECKOUT_KEY = "hyperclaw.pendingPlanCheckout.v1";

export interface PendingPlanCheckout {
  planId: string;
  planName: string;
  ownedCount: number;
  startedAt: number;
}

export interface StripeCheckoutReturnState {
  status: "success" | "cancelled";
  sessionId: string | null;
}

export type CheckoutReflectionStatus = "waiting-payment" | "waiting-entitlement" | "ready";

type LaunchSlotInventory = Record<string, { granted?: number; used?: number; available?: number }>;

export function writePendingPlanCheckout(checkout: PendingPlanCheckout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(checkout));
  } catch {}
}

export function readPendingPlanCheckout(): PendingPlanCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPlanCheckout>;
    if (!parsed.planId || !parsed.planName) return null;
    return {
      planId: parsed.planId,
      planName: parsed.planName,
      ownedCount: Number.isFinite(Number(parsed.ownedCount)) ? Number(parsed.ownedCount) : 0,
      startedAt: Number.isFinite(Number(parsed.startedAt)) ? Number(parsed.startedAt) : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearPendingPlanCheckout(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {}
}

export function buildStripeCheckoutReturnUrl(status: "success" | "cancelled"): string {
  const current = new URL(window.location.href);
  const params = new URLSearchParams(current.search);
  params.delete("checkout");
  params.delete("session_id");
  params.delete("cancelled");
  params.set("checkout", status);

  if (status === "success") {
    const query = params.toString();
    const separator = query ? "&" : "";
    return `${current.origin}${current.pathname}?${query}${separator}session_id={CHECKOUT_SESSION_ID}${current.hash}`;
  }

  return `${current.origin}${current.pathname}?${params.toString()}${current.hash}`;
}

export function readStripeCheckoutReturnState(): StripeCheckoutReturnState | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get("checkout");
  const cancelled = checkoutStatus === "cancelled" || params.get("cancelled") === "true";
  if (cancelled) {
    return { status: "cancelled", sessionId: null };
  }

  const sessionId = params.get("session_id");
  if (checkoutStatus === "success" || sessionId) {
    return { status: "success", sessionId };
  }

  return null;
}

export function clearStripeCheckoutReturnState(): void {
  if (typeof window === "undefined") return;

  const current = new URL(window.location.href);
  current.searchParams.delete("checkout");
  current.searchParams.delete("session_id");
  current.searchParams.delete("cancelled");

  const nextUrl = `${current.pathname}${current.search}${current.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function getPlanOwnedCountFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  planId: string | null | undefined,
): number {
  if (!summary || !planId) return 0;

  let count = 0;
  for (const subscription of summary.activeSubscriptions ?? []) {
    if (subscription.planId !== planId) continue;
    count += Math.max(subscription.quantity || 1, 1);
  }

  const activeEntitlementCount =
    summary.entitlements?.activeEntitlementCount ??
    summary.activeEntitlementCount ??
    summary.activeSubscriptionCount ??
    0;
  if (count === 0 && summary.effectivePlanId === planId && activeEntitlementCount > 0) {
    count = activeEntitlementCount;
  }

  return count;
}

export function getLaunchSlotInventoryFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): LaunchSlotInventory {
  return summary?.entitlements?.slotInventory ?? summary?.slotInventory ?? {};
}

export function getGrantedLaunchSlotCountFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): number {
  return Object.values(getLaunchSlotInventoryFromSummary(summary)).reduce(
    (total, entry) => total + Math.max(Number(entry?.granted ?? 0), 0),
    0,
  );
}

export function getAvailableLaunchSlotCountFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): number {
  return Object.values(getLaunchSlotInventoryFromSummary(summary)).reduce(
    (total, entry) => total + Math.max(Number(entry?.available ?? 0), 0),
    0,
  );
}

export function hasLaunchEntitlementSlots(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): boolean {
  return getGrantedLaunchSlotCountFromSummary(summary) > 0;
}

export function getCheckoutReflectionStatus(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  pending: PendingPlanCheckout | null,
): CheckoutReflectionStatus {
  if (!summary) return "waiting-payment";
  const activeEntitlementCount =
    summary.entitlements?.activeEntitlementCount ??
    summary.activeEntitlementCount ??
    summary.activeSubscriptionCount ??
    0;
  const effectivePlanId = summary.effectivePlanId && summary.effectivePlanId !== "free" ? summary.effectivePlanId : "";
  const planReflected = pending
    ? getPlanOwnedCountFromSummary(summary, pending.planId) > pending.ownedCount
    : activeEntitlementCount > 0 || Boolean(effectivePlanId);

  if (!planReflected) return "waiting-payment";
  return hasLaunchEntitlementSlots(summary) ? "ready" : "waiting-entitlement";
}

export function checkoutReflectedInSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  pending: PendingPlanCheckout | null,
): boolean {
  return getCheckoutReflectionStatus(summary, pending) === "ready";
}

export function getEffectivePlanName(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  currentPlan: HyperAgentCurrentPlan | null | undefined,
  catalogPlans: HyperAgentPlan[] | null | undefined,
): string | null {
  const currentSubscription = (summary?.activeSubscriptions ?? []).find((subscription) =>
    subscription.isCurrent ||
    subscription.id === summary?.currentSubscriptionId ||
    subscription.planId === summary?.effectivePlanId
  );
  if (currentSubscription?.planName) return currentSubscription.planName;

  const catalogPlan = (catalogPlans ?? []).find((plan) => plan.id === summary?.effectivePlanId);
  if (catalogPlan?.name) return catalogPlan.name;

  return currentPlan?.name ?? currentPlan?.id ?? summary?.effectivePlanId ?? null;
}
