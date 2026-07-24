import rawProducts from "./subscriptions.json";
import type { HyperAgentSubscription } from "@hypercli.com/sdk/agent";

export interface SlotBundle {
  free?: number;
  small?: number;
  medium?: number;
  large?: number;
}

export interface ProductDefinition {
  id: string;
  name: string;
  price: number;
  bundle: SlotBundle;
  highlighted?: boolean;
  hidden?: boolean;
  features?: string[];
  subtitle?: string;
  limits: {
    tpd: number;
    burstTpm: number;
    rpm: number;
  };
}

export const CLAW_PRODUCTS: readonly ProductDefinition[] = rawProducts as ProductDefinition[];

export function compactBundle(bundle: SlotBundle | null | undefined): SlotBundle {
  const entries = Object.entries(bundle ?? {}).filter(([, count]) => Number(count || 0) > 0);
  return Object.fromEntries(entries) as SlotBundle;
}

export function bundleKey(bundle: SlotBundle | null | undefined): string {
  const normalized = compactBundle(bundle);
  return JSON.stringify(Object.keys(normalized).sort().reduce<Record<string, number>>((acc, key) => {
    acc[key] = Number((normalized as Record<string, number>)[key] || 0);
    return acc;
  }, {}));
}

export function subscriptionSlotBundle(subscription: HyperAgentSubscription): SlotBundle {
  const metaBundle = compactBundle(
    (subscription.meta?.bundle as SlotBundle | undefined) ??
      (subscription.meta?.checkout_bundle as SlotBundle | undefined),
  );
  if (Object.keys(metaBundle).length > 0) return metaBundle;

  const derived: SlotBundle = {};
  for (const [tier, granted] of Object.entries(subscription.slotGrants ?? {})) {
    const total = Math.max(Number(granted || 0), 0) * Math.max(subscription.quantity || 1, 1);
    if (total > 0) (derived as Record<string, number>)[tier] = total;
  }
  if (Object.keys(derived).length > 0) return compactBundle(derived);
  if (subscription.planId === "free") return { free: Math.max(subscription.quantity || 1, 1) };
  return {};
}

export function formatBundle(bundle: SlotBundle | null | undefined): string | null {
  const normalized = compactBundle(bundle);
  const entries = Object.entries(normalized);
  if (entries.length === 0) return null;
  return entries
    .map(([tier, count]) => `${count}x ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`)
    .join(" + ");
}
