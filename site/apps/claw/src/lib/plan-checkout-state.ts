import type {
  HyperAgentCurrentPlan,
  HyperAgentPlan,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import {
  getEffectivePlanIdFromSummary,
  getLaunchSlotInventoryFromSummary,
  hasLaunchEntitlementSlots,
  mergeLaunchSlotInventories,
} from "@/lib/agent-launch-state";
import { bundleKey, compactBundle, subscriptionSlotBundle, type SlotBundle } from "@/lib/subscriptions";

export {
  getEffectivePlanIdFromSummary,
  getLaunchSlotInventoryFromSummary,
  hasLaunchEntitlementSlots,
  mergeLaunchSlotInventories,
};

const PENDING_CHECKOUT_KEY = "hyperclaw.pendingPlanCheckout.v1";

function pendingCheckoutKey(principalId: string): string {
  return `${PENDING_CHECKOUT_KEY}:${encodeURIComponent(principalId)}`;
}

export interface PendingPlanCheckout {
  principalId: string;
  planId: string;
  planName: string;
  ownedCount: number;
  startedAt: number;
  returnSessionId?: string;
  bundle?: SlotBundle;
  baselineGrantedSlots?: Record<string, number>;
}

export interface StripeCheckoutReturnState {
  status: "success" | "cancelled";
  sessionId: string | null;
}

export type CheckoutReflectionStatus = "waiting-payment" | "waiting-entitlement" | "ready";

export function writePendingPlanCheckout(checkout: PendingPlanCheckout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pendingCheckoutKey(checkout.principalId), JSON.stringify(checkout));
  } catch {}
}

export function readPendingPlanCheckout(expectedPrincipalId?: string | null): PendingPlanCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = expectedPrincipalId
      ? window.localStorage.getItem(pendingCheckoutKey(expectedPrincipalId)) ?? window.localStorage.getItem(PENDING_CHECKOUT_KEY)
      : window.localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPlanCheckout>;
    if (!parsed.principalId || !parsed.planId || !parsed.planName) return null;
    if (expectedPrincipalId && parsed.principalId !== expectedPrincipalId) return null;
    return {
      principalId: parsed.principalId,
      planId: parsed.planId,
      planName: parsed.planName,
      ownedCount: Number.isFinite(Number(parsed.ownedCount)) ? Number(parsed.ownedCount) : 0,
      startedAt: Number.isFinite(Number(parsed.startedAt)) ? Number(parsed.startedAt) : Date.now(),
      ...(typeof parsed.returnSessionId === "string" && parsed.returnSessionId.trim()
        ? { returnSessionId: parsed.returnSessionId.trim() }
        : {}),
      ...(parsed.bundle && typeof parsed.bundle === "object"
        ? { bundle: compactBundle(parsed.bundle as SlotBundle) }
        : {}),
      ...(parsed.baselineGrantedSlots && typeof parsed.baselineGrantedSlots === "object"
        ? {
            baselineGrantedSlots: Object.fromEntries(
              Object.entries(parsed.baselineGrantedSlots)
                .map(([tier, count]) => [tier, Math.max(Number(count || 0), 0)] as const)
                .filter(([, count]) => Number.isFinite(count)),
            ),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function markPendingPlanCheckoutReturned(
  principalId: string,
  sessionId: string,
): PendingPlanCheckout | null {
  const pending = readPendingPlanCheckout(principalId);
  const normalizedSessionId = sessionId.trim();
  if (!pending || !normalizedSessionId) return null;
  const returned = { ...pending, returnSessionId: normalizedSessionId };
  writePendingPlanCheckout(returned);
  return returned;
}

export function clearPendingPlanCheckout(expectedPrincipalId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (expectedPrincipalId) {
      window.localStorage.removeItem(pendingCheckoutKey(expectedPrincipalId));
      const legacy = readPendingPlanCheckout();
      if (legacy?.principalId === expectedPrincipalId) window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
      return;
    }
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
  if (checkoutStatus === "success" && sessionId) {
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
  if (count === 0 && getEffectivePlanIdFromSummary(summary) === planId && activeEntitlementCount > 0) {
    count = activeEntitlementCount;
  }

  return count;
}

export function getCheckoutOwnedCountFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  checkout: { planId: string; bundle?: SlotBundle | null } | null | undefined,
): number {
  if (!summary || !checkout) return 0;
  const checkoutBundleKey = bundleKey(checkout.bundle);
  let count = getPlanOwnedCountFromSummary(summary, checkout.planId);
  if (checkoutBundleKey === "{}") return count;

  for (const subscription of summary.activeSubscriptions ?? []) {
    if (subscription.planId === checkout.planId) continue;
    if (bundleKey(subscriptionSlotBundle(subscription)) === checkoutBundleKey) {
      count += Math.max(subscription.quantity || 1, 1);
    }
  }
  return count;
}

export function getGrantedLaunchSlotCountFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): number {
  return Object.values(getLaunchSlotInventoryFromSummary(summary)).reduce(
    (total, entry) => total + Math.max(Number(entry?.granted ?? 0), 0),
    0,
  );
}

export function getGrantedLaunchSlotsByTier(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(getLaunchSlotInventoryFromSummary(summary)).map(([tier, entry]) => [
      tier,
      Math.max(Number(entry?.granted ?? 0), 0),
    ]),
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
  const summaryEffectivePlanId = getEffectivePlanIdFromSummary(summary);
  const effectivePlanId = summaryEffectivePlanId && summaryEffectivePlanId !== "free" ? summaryEffectivePlanId : "";
  const planReflected = pending
    ? getCheckoutOwnedCountFromSummary(summary, pending) > pending.ownedCount
    : activeEntitlementCount > 0 || Boolean(effectivePlanId);

  if (!planReflected) return "waiting-payment";
  if (pending?.baselineGrantedSlots) {
    const currentGrantedSlots = getGrantedLaunchSlotsByTier(summary);
    const purchasedTiers = Object.entries(compactBundle(pending.bundle));
    const slotsReflected = purchasedTiers.length > 0
      ? purchasedTiers.every(([tier, count]) => (
          Math.max(currentGrantedSlots[tier] ?? 0, 0) >=
          Math.max(pending.baselineGrantedSlots?.[tier] ?? 0, 0) + Math.max(Number(count || 0), 0)
        ))
      : Object.values(currentGrantedSlots).reduce((total, count) => total + count, 0) >
        Object.values(pending.baselineGrantedSlots).reduce((total, count) => total + count, 0);
    if (!slotsReflected) return "waiting-entitlement";
  }
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
  const effectivePlanId = getEffectivePlanIdFromSummary(summary);
  const currentSubscription = (summary?.activeSubscriptions ?? []).find((subscription) =>
    subscription.isCurrent ||
    subscription.id === summary?.currentSubscriptionId ||
    subscription.planId === effectivePlanId
  );
  if (currentSubscription?.planName) return currentSubscription.planName;

  const catalogPlan = (catalogPlans ?? []).find((plan) => plan.id === effectivePlanId);
  if (catalogPlan?.name) return catalogPlan.name;

  return currentPlan?.name ?? currentPlan?.id ?? (effectivePlanId || null);
}
