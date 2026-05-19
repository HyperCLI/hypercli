import type {
  HyperAgentEntitlement,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";
import type { SlotInventory } from "@/lib/format";

const LAUNCH_TIERS = ["large", "medium", "small"] as const;

type LaunchTier = typeof LAUNCH_TIERS[number];

export type LaunchSourceKind = "subscription" | "direct-entitlement" | "inventory";

export interface LaunchSource {
  id: string;
  kind: LaunchSourceKind;
  planId: string;
  planName: string;
  slotGrants: Record<string, number>;
  quantity: number;
  tierIds: string[];
  inferenceOnly: boolean;
  availableCount: number;
  slotSummary: string;
  statusLabel: string;
}

export type LaunchEligibilityStatus =
  | "loading"
  | "catalog-only"
  | "waiting-entitlement"
  | "ready"
  | "exhausted"
  | "releasing";

export interface LaunchEligibilityState {
  status: LaunchEligibilityStatus;
  sources: LaunchSource[];
  launchableTiers: string[];
  totalAvailableSlots: number;
  totalGrantedSlots: number;
  totalPendingReleases: number;
}

export interface DeriveLaunchEligibilityInput {
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  slotInventory?: SlotInventory | null;
  pendingSlotReleases?: Record<string, number>;
  budgetLoaded?: boolean;
  includeInventorySources?: boolean;
}

type SubscriptionSummaryWithEntitlementItems = HyperAgentSubscriptionSummary & {
  entitlementItems?: HyperAgentEntitlement[];
  activeEntitlements?: HyperAgentEntitlement[];
};

function finiteSlotCount(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
}

function titleizeLaunchTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeSlotGrants(value: Record<string, number> | null | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([tier, count]) => [tier, finiteSlotCount(count)] as const)
      .filter(([, count]) => count > 0),
  );
}

function launchTierIds(slotGrants: Record<string, number>): string[] {
  return LAUNCH_TIERS.filter((tier) => finiteSlotCount(slotGrants[tier]) > 0);
}

function launchSlotSummary(tierIds: string[], slotGrants: Record<string, number>): string {
  if (tierIds.length === 0) return "No launchable slots";
  return tierIds
    .map((tier) => `${finiteSlotCount(slotGrants[tier])} ${tier}`)
    .join(" + ");
}

function launchSourceStatusLabel({
  inferenceOnly,
  availableCount,
  pendingReleaseCount,
}: {
  inferenceOnly: boolean;
  availableCount: number;
  pendingReleaseCount: number;
}): string {
  if (inferenceOnly) return "Inference only";
  if (availableCount > 0) return `${availableCount} launchable slot${availableCount === 1 ? "" : "s"}`;
  if (pendingReleaseCount > 0) return "Releasing slot";
  return "No free slots";
}

function sourceAvailableCount(tierIds: string[], slotInventory: SlotInventory): number {
  return tierIds.reduce((sum, tier) => sum + finiteSlotCount(slotInventory[tier]?.available), 0);
}

function sourcePendingReleaseCount(tierIds: string[], pendingSlotReleases: Record<string, number>): number {
  return tierIds.reduce((sum, tier) => sum + finiteSlotCount(pendingSlotReleases[tier]), 0);
}

function launchSourceFromSubscription(
  subscription: HyperAgentSubscription,
  slotInventory: SlotInventory,
  pendingSlotReleases: Record<string, number>,
): LaunchSource {
  const slotGrants = normalizeSlotGrants(subscription.slotGrants);
  const tierIds = launchTierIds(slotGrants);
  const availableCount = sourceAvailableCount(tierIds, slotInventory);
  const pendingReleaseCount = sourcePendingReleaseCount(tierIds, pendingSlotReleases);
  const inferenceOnly = tierIds.length === 0;

  return {
    id: subscription.id || `subscription:${subscription.planId}`,
    kind: "subscription",
    planId: subscription.planId,
    planName: subscription.planName || subscription.planId || "Current plan",
    slotGrants,
    quantity: Math.max(Number(subscription.quantity || 1), 1),
    tierIds,
    inferenceOnly,
    availableCount,
    slotSummary: launchSlotSummary(tierIds, slotGrants),
    statusLabel: launchSourceStatusLabel({ inferenceOnly, availableCount, pendingReleaseCount }),
  };
}

function launchSourceFromEntitlement(
  entitlement: HyperAgentEntitlement,
  slotInventory: SlotInventory,
  pendingSlotReleases: Record<string, number>,
): LaunchSource {
  const slotGrants = normalizeSlotGrants(entitlement.slotGrants);
  const tierIds = launchTierIds(slotGrants);
  const availableCount = sourceAvailableCount(tierIds, slotInventory);
  const pendingReleaseCount = sourcePendingReleaseCount(tierIds, pendingSlotReleases);
  const inferenceOnly = tierIds.length === 0;

  return {
    id: entitlement.id || `entitlement:${entitlement.planId}`,
    kind: "direct-entitlement",
    planId: entitlement.planId,
    planName: entitlement.planName || entitlement.planId || "Current plan",
    slotGrants,
    quantity: 1,
    tierIds,
    inferenceOnly,
    availableCount,
    slotSummary: launchSlotSummary(tierIds, slotGrants),
    statusLabel: launchSourceStatusLabel({ inferenceOnly, availableCount, pendingReleaseCount }),
  };
}

function entitlementArraysFromSummary(
  subscriptionSummary: HyperAgentSubscriptionSummary | null | undefined,
): HyperAgentEntitlement[] {
  if (!subscriptionSummary) return [];
  const summary = subscriptionSummary as SubscriptionSummaryWithEntitlementItems;
  const candidates: unknown[] = [
    summary.entitlementItems,
    summary.activeEntitlements,
    subscriptionSummary.entitlements,
  ];
  const seen = new Set<string>();
  const entitlements: HyperAgentEntitlement[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (!item || typeof item !== "object") continue;
      const entitlement = item as HyperAgentEntitlement;
      const key = entitlement.id || `${entitlement.planId}:${entitlement.subscriptionId ?? "direct"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entitlements.push(entitlement);
    }
  }

  return entitlements;
}

export function getEffectivePlanIdFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): string {
  return summary?.effectivePlanId || summary?.entitlements?.effectivePlanId || "";
}

export function mergeLaunchSlotInventories(
  ...inventories: Array<Record<string, { granted?: number; used?: number; available?: number }> | null | undefined>
): SlotInventory {
  const merged: SlotInventory = {};
  for (const inventory of inventories) {
    for (const [tier, entry] of Object.entries(inventory ?? {})) {
      if (!entry) continue;
      const current = merged[tier] ?? { granted: 0, used: 0, available: 0 };
      merged[tier] = {
        granted: Math.max(finiteSlotCount(current.granted), finiteSlotCount(entry.granted)),
        used: Math.max(finiteSlotCount(current.used), finiteSlotCount(entry.used)),
        available: Math.max(finiteSlotCount(current.available), finiteSlotCount(entry.available)),
      };
    }
  }
  return merged;
}

export function getLaunchSlotInventoryFromSummary(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): SlotInventory {
  return mergeLaunchSlotInventories(summary?.slotInventory, summary?.entitlements?.slotInventory);
}

export function deriveLaunchSources({
  subscriptionSummary,
  slotInventory = {},
  pendingSlotReleases = {},
  includeInventorySources = true,
}: DeriveLaunchEligibilityInput): LaunchSource[] {
  const sources: LaunchSource[] = [];

  for (const subscription of subscriptionSummary?.activeSubscriptions ?? []) {
    sources.push(launchSourceFromSubscription(subscription, slotInventory ?? {}, pendingSlotReleases));
  }

  for (const entitlement of entitlementArraysFromSummary(subscriptionSummary)) {
    if (entitlement.subscriptionId) continue;
    sources.push(launchSourceFromEntitlement(entitlement, slotInventory ?? {}, pendingSlotReleases));
  }

  const hasSlotBackedSource = sources.some((source) => source.tierIds.length > 0);
  if (includeInventorySources && !hasSlotBackedSource) {
    const effectivePlanId = getEffectivePlanIdFromSummary(subscriptionSummary);
    for (const tier of LAUNCH_TIERS) {
      const entry = slotInventory?.[tier];
      const granted = finiteSlotCount(entry?.granted);
      const available = finiteSlotCount(entry?.available);
      if (granted <= 0 && available <= 0) continue;

      const slotGrants = { [tier]: Math.max(granted, available) };
      const tierIds: LaunchTier[] = [tier];
      const pendingReleaseCount = sourcePendingReleaseCount(tierIds, pendingSlotReleases);
      sources.push({
        id: `inventory:${effectivePlanId || tier}:${tier}`,
        kind: "inventory",
        planId: effectivePlanId,
        planName: effectivePlanId ? titleizeLaunchTier(effectivePlanId) : `${titleizeLaunchTier(tier)} plan`,
        slotGrants,
        quantity: 1,
        tierIds,
        inferenceOnly: false,
        availableCount: available,
        slotSummary: launchSlotSummary(tierIds, slotGrants),
        statusLabel: launchSourceStatusLabel({
          inferenceOnly: false,
          availableCount: available,
          pendingReleaseCount,
        }),
      });
    }
  }

  return sources;
}

export function deriveLaunchEligibilityState(input: DeriveLaunchEligibilityInput): LaunchEligibilityState {
  const slotInventory = input.slotInventory ?? {};
  const pendingSlotReleases = input.pendingSlotReleases ?? {};
  const sources = deriveLaunchSources(input);
  const launchableTiers = LAUNCH_TIERS.filter((tier) => finiteSlotCount(slotInventory[tier]?.available) > 0);
  const totalAvailableSlots = LAUNCH_TIERS.reduce((sum, tier) => sum + finiteSlotCount(slotInventory[tier]?.available), 0);
  const totalGrantedSlots = LAUNCH_TIERS.reduce((sum, tier) => sum + finiteSlotCount(slotInventory[tier]?.granted), 0);
  const totalPendingReleases = LAUNCH_TIERS.reduce((sum, tier) => sum + finiteSlotCount(pendingSlotReleases[tier]), 0);
  const hasSlotBackedSource = sources.some((source) => source.tierIds.length > 0);

  if (input.budgetLoaded === false) {
    return { status: "loading", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
  }
  if (totalAvailableSlots > 0) {
    return { status: "ready", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
  }
  if (totalPendingReleases > 0 && totalGrantedSlots > 0) {
    return { status: "releasing", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
  }
  if (hasSlotBackedSource && totalGrantedSlots === 0) {
    return { status: "waiting-entitlement", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
  }
  if (totalGrantedSlots > 0) {
    return { status: "exhausted", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
  }
  return { status: "catalog-only", sources, launchableTiers, totalAvailableSlots, totalGrantedSlots, totalPendingReleases };
}

export function hasLaunchEntitlementSlots(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): boolean {
  return Object.values(getLaunchSlotInventoryFromSummary(summary)).some((entry) => finiteSlotCount(entry.granted) > 0);
}
