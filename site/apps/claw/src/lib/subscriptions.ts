export interface ProductDefinition {
  id: string;
  name: string;
  planId: string;
  quantity: number;
  highlighted?: boolean;
  hidden?: boolean;
  features?: string[];
  subtitle?: string;
}

export const CLAW_PRODUCTS: readonly ProductDefinition[] = [
  {
    id: "free",
    name: "Free",
    planId: "free",
    quantity: 1,
    subtitle: "1 free agent per Privy user when no paid entitlement is active.",
    features: ["1 free agent", "Community support"],
  },
  {
    id: "starter",
    name: "Starter",
    planId: "1aiu",
    quantity: 1,
    subtitle: "1x Small",
  },
  {
    id: "pro",
    name: "Pro",
    planId: "5aiu",
    quantity: 1,
    highlighted: true,
    subtitle: "1x Large",
  },
  {
    id: "team",
    name: "Team",
    planId: "5aiu",
    quantity: 2,
    subtitle: "2x Large",
    features: ["2 large slots", "Pooled inference", "Shared team capacity"],
  },
] as const;
