import {
  hasActivePlan,
  type HyperAgentCurrentPlan,
  type HyperAgentEntitlement,
  type HyperAgentPlan,
  type HyperAgentSubscription,
  type HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import { getActiveAgentTrial } from "@/lib/agent-trial";
import {
  getEffectivePlanIdFromSummary,
  getLaunchSlotInventoryFromSummary,
  hasLaunchEntitlementSlots,
  mergeLaunchSlotInventories,
} from "@/lib/agent-launch-state";
import { bundleKey, compactBundle, subscriptionSlotBundle, type SlotBundle } from "@/lib/subscriptions";
import type { TrialCheckoutRequest, TrialCheckoutResponse } from "@/lib/trial-checkout";

export {
  getEffectivePlanIdFromSummary,
  getLaunchSlotInventoryFromSummary,
  hasLaunchEntitlementSlots,
  mergeLaunchSlotInventories,
};

const PENDING_CHECKOUT_KEY = "hyperclaw.pendingPlanCheckout.v1";
export const TEAM_TRIAL_PLAN_ID = "team";
const TEAM_TRIAL_PLAN_NAME = "Team";

function pendingCheckoutKey(principalId: string): string {
  return `${PENDING_CHECKOUT_KEY}:${encodeURIComponent(principalId)}`;
}

function pendingCheckoutCorrelationKey(
  principalId: string,
  kind: "attempt" | "session",
  value: string,
): string {
  return `${pendingCheckoutKey(principalId)}:${kind}:${encodeURIComponent(value)}`;
}

export interface PendingPlanCheckout {
  principalId: string;
  planId: string;
  planName: string;
  ownedCount: number;
  startedAt: number;
  checkoutAttemptId?: string;
  checkoutSessionId?: string;
  returnSessionId?: string;
  bundle?: SlotBundle;
  baselineGrantedSlots?: Record<string, number>;
  flow?: "first-agent-setup" | "team-trial" | "first-agent-trial";
  setupId?: string;
  workspaceId?: string;
  knowledgeCollectionId?: string | null;
  agentSize?: string;
  agentCreateStartedAt?: number;
}

export interface FirstAgentTrialCheckoutContext {
  setupId: string;
  workspaceId?: string;
  knowledgeCollectionId?: string | null;
  agentSize: string;
}

export type TeamTrialCheckoutPending = PendingPlanCheckout & {
  flow: "team-trial" | "first-agent-trial";
};

export function isTeamTrialCheckoutFlow(
  pending: PendingPlanCheckout | null | undefined,
): pending is TeamTrialCheckoutPending {
  return pending?.flow === "team-trial" || pending?.flow === "first-agent-trial";
}

export function catalogPlanOffersTeamTrial(
  planId: string,
  ownedCount: number,
  trialAvailable: boolean,
): boolean {
  return trialAvailable
    && planId.trim().toLowerCase() === TEAM_TRIAL_PLAN_ID
    && Math.max(Number(ownedCount || 0), 0) === 0;
}

function provisionedSlotBundle(
  source: Pick<HyperAgentSubscription | HyperAgentEntitlement, "slotGrants" | "agentSlots">,
): SlotBundle {
  const slotGrants = compactBundle(source.slotGrants as SlotBundle | null | undefined);
  if (Object.keys(slotGrants).length > 0) return slotGrants;

  const fromSlots: Record<string, number> = {};
  for (const slot of source.agentSlots ?? []) {
    const tier = String(slot.size ?? "").trim().toLowerCase();
    if (tier) fromSlots[tier] = (fromSlots[tier] ?? 0) + 1;
  }
  return compactBundle(fromSlots as SlotBundle);
}

function provisionedTrialSlotBundle(
  summary: HyperAgentSubscriptionSummary,
  subscription: HyperAgentSubscription,
): SlotBundle {
  const subscriptionBundle = provisionedSlotBundle(subscription);
  const entitlementById = new Map<string, HyperAgentEntitlement>();
  for (const entitlement of subscription.entitlements ?? []) {
    entitlementById.set(entitlement.id, entitlement);
  }
  for (const entitlement of summary.entitlementItems ?? []) {
    if (entitlement.subscriptionId !== subscription.id) continue;
    const existing = entitlementById.get(entitlement.id);
    if (!existing) {
      entitlementById.set(entitlement.id, entitlement);
      continue;
    }
    const mergedGrants: Record<string, number> = {};
    for (const bundle of [provisionedSlotBundle(existing), provisionedSlotBundle(entitlement)]) {
      for (const [tier, count] of Object.entries(bundle)) {
        mergedGrants[tier] = Math.max(mergedGrants[tier] ?? 0, Number(count ?? 0));
      }
    }
    entitlementById.set(entitlement.id, { ...existing, ...entitlement, slotGrants: mergedGrants });
  }

  const entitlementBundle: Record<string, number> = {};
  for (const entitlement of entitlementById.values()) {
    if (entitlement.status && entitlement.status.toUpperCase() !== "ACTIVE") continue;
    for (const [tier, count] of Object.entries(provisionedSlotBundle(entitlement))) {
      entitlementBundle[tier] = (entitlementBundle[tier] ?? 0) + Math.max(Number(count ?? 0), 0);
    }
  }

  const combined: Record<string, number> = { ...subscriptionBundle };
  for (const [tier, count] of Object.entries(entitlementBundle)) {
    combined[tier] = Math.max(combined[tier] ?? 0, count);
  }
  return compactBundle(combined as SlotBundle);
}

interface TeamTrialCheckoutClient {
  startTrial(request?: TrialCheckoutRequest): Promise<TrialCheckoutResponse>;
}

export async function createTeamTrialCheckoutState(
  client: TeamTrialCheckoutClient,
  request: TrialCheckoutRequest,
  options: {
    principalId: string;
    summary: HyperAgentSubscriptionSummary | null;
    catalogProduct?: { name?: string | null; bundle?: SlotBundle | null } | null;
    firstAgentSetup?: FirstAgentTrialCheckoutContext | null;
    checkoutAttemptId?: string | null;
    startedAt?: number;
  },
): Promise<{ checkout: TrialCheckoutResponse; pending: PendingPlanCheckout }> {
  const checkout = await client.startTrial(request);
  const checkoutAttemptId = options.checkoutAttemptId?.trim()
    || checkout.checkoutAttemptId?.trim()
    || null;
  const bundle = compactBundle(options.catalogProduct?.bundle);
  const checkoutPlan = {
    planId: TEAM_TRIAL_PLAN_ID,
    ...(Object.keys(bundle).length > 0 ? { bundle } : {}),
  };
  return {
    checkout,
    pending: {
      principalId: options.principalId,
      planId: TEAM_TRIAL_PLAN_ID,
      planName: options.catalogProduct?.name?.trim() || TEAM_TRIAL_PLAN_NAME,
      ownedCount: getCheckoutOwnedCountFromSummary(options.summary, checkoutPlan),
      startedAt: options.startedAt ?? Date.now(),
      ...(checkoutAttemptId ? { checkoutAttemptId } : {}),
      ...(checkout.checkoutSessionId ? { checkoutSessionId: checkout.checkoutSessionId } : {}),
      flow: options.firstAgentSetup ? "first-agent-trial" : "team-trial",
      ...(Object.keys(bundle).length > 0 ? { bundle } : {}),
      ...(options.summary
        ? { baselineGrantedSlots: getGrantedLaunchSlotsByTier(options.summary) }
        : {}),
      ...(options.firstAgentSetup
        ? {
            setupId: options.firstAgentSetup.setupId,
            ...(options.firstAgentSetup.workspaceId
              ? { workspaceId: options.firstAgentSetup.workspaceId }
              : {}),
            knowledgeCollectionId: options.firstAgentSetup.knowledgeCollectionId ?? null,
            agentSize: options.firstAgentSetup.agentSize,
          }
        : {}),
    },
  };
}

export interface StripeCheckoutReturnState {
  status: "success" | "cancelled";
  sessionId: string | null;
  attemptId: string | null;
}

export interface PendingCheckoutCorrelation {
  sessionId?: string | null;
  attemptId?: string | null;
}

export type CheckoutReflectionStatus = "waiting-payment" | "waiting-entitlement" | "ready";

function serializePendingPlanCheckout(checkout: PendingPlanCheckout): string {
  const hasCollectionContext = checkout.flow === "first-agent-setup"
    || checkout.flow === "first-agent-trial"
    || "knowledgeCollectionId" in checkout;
  const knowledgeCollectionId = checkout.knowledgeCollectionId ?? null;
  return JSON.stringify({
    ...checkout,
    // Preserve checkout recovery if a deployment rolls back while payment is in flight.
    ...(hasCollectionContext ? {
      knowledgeCollectionId,
      knowledgeDomainId: knowledgeCollectionId,
    } : {}),
  });
}

export function writePendingPlanCheckout(checkout: PendingPlanCheckout): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = serializePendingPlanCheckout(checkout);
    window.localStorage.setItem(pendingCheckoutKey(checkout.principalId), serialized);
    if (checkout.checkoutAttemptId) {
      window.localStorage.setItem(
        pendingCheckoutCorrelationKey(checkout.principalId, "attempt", checkout.checkoutAttemptId),
        serialized,
      );
    }
    if (checkout.checkoutSessionId) {
      window.localStorage.setItem(
        pendingCheckoutCorrelationKey(checkout.principalId, "session", checkout.checkoutSessionId),
        serialized,
      );
    }
  } catch {}
}

function parsePendingPlanCheckout(
  raw: string | null,
  expectedPrincipalId?: string | null,
): PendingPlanCheckout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPlanCheckout> & {
      knowledgeDomainId?: unknown;
    };
    if (!parsed.principalId || !parsed.planId || !parsed.planName) return null;
    if (expectedPrincipalId && parsed.principalId !== expectedPrincipalId) return null;
    const canonicalKnowledgeCollectionId = typeof parsed.knowledgeCollectionId === "string"
      && parsed.knowledgeCollectionId.trim()
      ? parsed.knowledgeCollectionId.trim().slice(0, 100)
      : null;
    const legacyKnowledgeCollectionId = typeof parsed.knowledgeDomainId === "string"
      && parsed.knowledgeDomainId.trim()
      ? parsed.knowledgeDomainId.trim().slice(0, 100)
      : null;
    return {
      principalId: parsed.principalId,
      planId: parsed.planId,
      planName: parsed.planName,
      ownedCount: Number.isFinite(Number(parsed.ownedCount)) ? Number(parsed.ownedCount) : 0,
      startedAt: Number.isFinite(Number(parsed.startedAt)) ? Number(parsed.startedAt) : Date.now(),
      ...(typeof parsed.checkoutAttemptId === "string" && parsed.checkoutAttemptId.trim()
        ? { checkoutAttemptId: parsed.checkoutAttemptId.trim().slice(0, 255) }
        : {}),
      ...(typeof parsed.checkoutSessionId === "string" && parsed.checkoutSessionId.trim()
        ? { checkoutSessionId: parsed.checkoutSessionId.trim().slice(0, 255) }
        : {}),
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
      ...(
        parsed.flow === "first-agent-setup"
        || parsed.flow === "team-trial"
        || parsed.flow === "first-agent-trial"
          ? { flow: parsed.flow }
          : {}
      ),
      ...(typeof parsed.setupId === "string" && parsed.setupId.trim()
        ? { setupId: parsed.setupId.trim().slice(0, 100) }
        : {}),
      ...(typeof parsed.workspaceId === "string" && parsed.workspaceId.trim()
        ? { workspaceId: parsed.workspaceId.trim().slice(0, 100) }
        : {}),
      ...(parsed.flow === "first-agent-setup" || parsed.flow === "first-agent-trial"
        ? {
            knowledgeCollectionId: canonicalKnowledgeCollectionId ?? legacyKnowledgeCollectionId,
          }
        : {}),
      ...(typeof parsed.agentSize === "string" && parsed.agentSize.trim()
        ? { agentSize: parsed.agentSize.trim().slice(0, 40) }
        : {}),
      ...(Number.isFinite(Number(parsed.agentCreateStartedAt)) && Number(parsed.agentCreateStartedAt) > 0
        ? { agentCreateStartedAt: Number(parsed.agentCreateStartedAt) }
        : {}),
    };
  } catch {
    return null;
  }
}

function pendingMatchesCorrelation(
  pending: PendingPlanCheckout,
  correlation?: PendingCheckoutCorrelation,
): boolean {
  const sessionId = correlation?.sessionId?.trim() || null;
  const attemptId = correlation?.attemptId?.trim() || null;
  if (sessionId && pending.checkoutSessionId) {
    return pending.checkoutSessionId === sessionId;
  }
  if (attemptId && pending.checkoutAttemptId) {
    return pending.checkoutAttemptId === attemptId;
  }
  if (
    sessionId
    && !attemptId
    && !pending.checkoutSessionId
    && !pending.checkoutAttemptId
  ) return true;
  return !sessionId && !attemptId;
}

function readReturnedPendingPlanCheckout(principalId: string): PendingPlanCheckout | null {
  const prefix = `${pendingCheckoutKey(principalId)}:`;
  const returned: PendingPlanCheckout[] = [];
  const keys = Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.key(index),
  );
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    const pending = parsePendingPlanCheckout(window.localStorage.getItem(key), principalId);
    if (pending?.returnSessionId) returned.push(pending);
  }
  return returned.sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
}

export function readPendingPlanCheckout(
  expectedPrincipalId?: string | null,
  correlation?: PendingCheckoutCorrelation,
): PendingPlanCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const candidates: Array<string | null> = [];
    const sessionId = correlation?.sessionId?.trim();
    const attemptId = correlation?.attemptId?.trim();
    if (expectedPrincipalId && !sessionId && !attemptId) {
      const primary = parsePendingPlanCheckout(
        window.localStorage.getItem(pendingCheckoutKey(expectedPrincipalId)),
        expectedPrincipalId,
      );
      if (primary?.returnSessionId) return primary;
      const returned = readReturnedPendingPlanCheckout(expectedPrincipalId);
      if (returned) return returned;
    }
    if (expectedPrincipalId && sessionId) {
      candidates.push(window.localStorage.getItem(
        pendingCheckoutCorrelationKey(expectedPrincipalId, "session", sessionId),
      ));
    }
    if (expectedPrincipalId && attemptId) {
      candidates.push(window.localStorage.getItem(
        pendingCheckoutCorrelationKey(expectedPrincipalId, "attempt", attemptId),
      ));
    }
    candidates.push(expectedPrincipalId
      ? window.localStorage.getItem(pendingCheckoutKey(expectedPrincipalId))
      : null);
    candidates.push(window.localStorage.getItem(PENDING_CHECKOUT_KEY));

    for (const raw of candidates) {
      const pending = parsePendingPlanCheckout(raw, expectedPrincipalId);
      if (pending && pendingMatchesCorrelation(pending, correlation)) return pending;
    }
    return null;
  } catch {
    return null;
  }
}

export function markPendingPlanCheckoutReturned(
  principalId: string,
  sessionId: string,
  attemptId?: string | null,
): PendingPlanCheckout | null {
  const normalizedSessionId = sessionId.trim();
  const pending = readPendingPlanCheckout(principalId, {
    sessionId: normalizedSessionId,
    attemptId,
  });
  if (!pending || !normalizedSessionId) return null;
  const returned = {
    ...pending,
    returnSessionId: normalizedSessionId,
    ...(pending.checkoutSessionId ? {} : { checkoutSessionId: normalizedSessionId }),
  };
  try {
    const serialized = serializePendingPlanCheckout(returned);
    if (returned.checkoutAttemptId) {
      window.localStorage.setItem(
        pendingCheckoutCorrelationKey(principalId, "attempt", returned.checkoutAttemptId),
        serialized,
      );
    }
    if (returned.checkoutSessionId) {
      window.localStorage.setItem(
        pendingCheckoutCorrelationKey(principalId, "session", returned.checkoutSessionId),
        serialized,
      );
    }
    const primaryKey = pendingCheckoutKey(principalId);
    const primary = parsePendingPlanCheckout(window.localStorage.getItem(primaryKey), principalId);
    if (primary && pendingMatchesCorrelation(primary, {
      sessionId: returned.checkoutSessionId,
      attemptId: returned.checkoutAttemptId,
    })) {
      window.localStorage.setItem(primaryKey, serialized);
    }
  } catch {}
  return returned;
}

export function clearPendingPlanCheckout(
  expectedPrincipalId?: string | null,
  pending?: PendingPlanCheckout | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (expectedPrincipalId) {
      const primaryKey = pendingCheckoutKey(expectedPrincipalId);
      if (pending) {
        if (pending.checkoutAttemptId) {
          window.localStorage.removeItem(
            pendingCheckoutCorrelationKey(expectedPrincipalId, "attempt", pending.checkoutAttemptId),
          );
        }
        if (pending.checkoutSessionId) {
          window.localStorage.removeItem(
            pendingCheckoutCorrelationKey(expectedPrincipalId, "session", pending.checkoutSessionId),
          );
        }
        const primary = parsePendingPlanCheckout(window.localStorage.getItem(primaryKey), expectedPrincipalId);
        if (primary && pendingMatchesCorrelation(primary, {
          sessionId: pending.checkoutSessionId,
          attemptId: pending.checkoutAttemptId,
        })) {
          window.localStorage.removeItem(primaryKey);
        }
      } else {
        const prefix = `${primaryKey}:`;
        const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
        for (const key of keys) {
          if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
        }
        window.localStorage.removeItem(primaryKey);
      }
      const legacy = readPendingPlanCheckout();
      if (
        legacy?.principalId === expectedPrincipalId
        && (!pending || pendingMatchesCorrelation(legacy, {
          sessionId: pending.checkoutSessionId,
          attemptId: pending.checkoutAttemptId,
        }))
      ) window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
      return;
    }
    window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {}
}

export function createPlanCheckoutAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildStripeCheckoutReturnUrl(
  status: "success" | "cancelled",
  attemptId?: string | null,
  returnHref?: string | null,
): string {
  const current = new URL(returnHref?.trim() || window.location.href, window.location.origin);
  const params = new URLSearchParams(current.search);
  params.delete("checkout");
  params.delete("session_id");
  params.delete("cancelled");
  params.delete("checkout_attempt");
  params.set("checkout", status);
  if (attemptId?.trim()) params.set("checkout_attempt", attemptId.trim());

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
  const attemptId = params.get("checkout_attempt")?.trim() || null;
  const cancelled = checkoutStatus === "cancelled" || params.get("cancelled") === "true";
  if (cancelled) {
    return { status: "cancelled", sessionId: null, attemptId };
  }

  const sessionId = params.get("session_id");
  if (checkoutStatus === "success" && sessionId) {
    return { status: "success", sessionId, attemptId };
  }

  return null;
}

export function clearStripeCheckoutReturnState(): void {
  if (typeof window === "undefined") return;

  const current = new URL(window.location.href);
  current.searchParams.delete("checkout");
  current.searchParams.delete("session_id");
  current.searchParams.delete("cancelled");
  current.searchParams.delete("checkout_attempt");

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
  const trialSubscription = isTeamTrialCheckoutFlow(pending) ? [
    ...(summary.activeSubscriptions ?? []),
    ...(summary.subscriptions ?? []),
  ].find((subscription) => (
    subscription.planId.trim().toLowerCase() === pending.planId.trim().toLowerCase()
    && subscription.trial?.active === true
  )) : null;
  const planReflected = isTeamTrialCheckoutFlow(pending)
    ? Boolean(trialSubscription)
    : pending
      ? getCheckoutOwnedCountFromSummary(summary, pending) > pending.ownedCount
      : activeEntitlementCount > 0 || Boolean(effectivePlanId);

  if (!planReflected) return "waiting-payment";
  if (trialSubscription) {
    const grantedTrialBundle = provisionedTrialSlotBundle(summary, trialSubscription);
    const expectedTrialBundle = compactBundle(pending?.bundle);
    const trialSlotsReady = Object.keys(expectedTrialBundle).length > 0
      ? Object.entries(expectedTrialBundle).every(([tier, count]) => (
          Math.max(Number((grantedTrialBundle as Record<string, number>)[tier] ?? 0), 0) >=
          Math.max(Number(count ?? 0), 0)
        ))
      : Object.values(grantedTrialBundle).some((count) => Number(count ?? 0) > 0);
    if (!trialSlotsReady) return "waiting-entitlement";
    return "ready";
  }
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

export function summaryCanStartTeamTrial(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): boolean {
  if (!summary) return false;
  return (
    (summary.subscriptions?.length ?? 0) === 0
    && (summary.activeSubscriptions?.length ?? 0) === 0
    && Math.max(summary.activeSubscriptionCount ?? 0, 0) === 0
  );
}

export type TeamTrialEligibility = "loading" | "eligible" | "ineligible";

export function getTeamTrialEligibility(
  principalId: string | null | undefined,
  billingDataPrincipalId: string | null | undefined,
  summary: HyperAgentSubscriptionSummary | null | undefined,
): TeamTrialEligibility {
  if (!principalId || billingDataPrincipalId !== principalId) return "loading";
  return summaryCanStartTeamTrial(summary) ? "eligible" : "ineligible";
}

export interface TeamTrialStartState {
  principalId: string | null | undefined;
  billingDataPrincipalId: string | null | undefined;
  summary: HyperAgentSubscriptionSummary | null | undefined;
  hasBillingHistory: boolean | null | undefined;
  now?: number;
  observedAt?: number;
}

export function canStartTeamTrialForPrincipal(state: TeamTrialStartState): boolean {
  return (
    !getActiveAgentTrial(state.summary, state.now, state.observedAt)
    && getTeamTrialEligibility(state.principalId, state.billingDataPrincipalId, state.summary) === "eligible"
    && !(state.summary ? hasActivePlan(state.summary) : false)
    && state.hasBillingHistory === false
  );
}

export type ProductUseAccessDecision = "loading" | "allow" | "trial" | "upgrade";

export function resolveProductUseAccess(state: TeamTrialStartState): ProductUseAccessDecision {
  if (
    !state.principalId
    || state.billingDataPrincipalId !== state.principalId
    || !state.summary
  ) return "loading";
  if (hasActivePlan(state.summary)) return "allow";
  return canStartTeamTrialForPrincipal(state) ? "trial" : "upgrade";
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
