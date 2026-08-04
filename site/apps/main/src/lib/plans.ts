export interface PlanTier {
  id: "solo" | "team" | "pro";
  name: string;
  price: number;
  agents: string;
  memory: string;
  tokensPerDay: string;
  models: string[];
  gaugePercent: number;
  highlighted?: boolean;
  cta: string;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "solo",
    name: "Solo",
    price: 39,
    agents: "1 agent",
    memory: "2 GB",
    tokensPerDay: "25M tokens/day",
    models: ["Kimi K2.6", "Qwen Embeddings", "Qwen TTS"],
    gaugePercent: 25,
    cta: "Get started",
  },
  {
    id: "team",
    name: "Team",
    price: 79,
    agents: "Up to 3 agents",
    memory: "4 GB",
    tokensPerDay: "50M tokens/day, pooled",
    models: ["Kimi K2.6", "Qwen Embeddings", "Qwen TTS", "Render"],
    gaugePercent: 50,
    highlighted: true,
    cta: "Start free trial",
  },
  {
    id: "pro",
    name: "Pro",
    price: 149,
    agents: "Up to 3 dev-grade agents",
    memory: "8 GB",
    tokensPerDay: "100M tokens/day, pooled",
    models: ["Kimi K3", "Qwen Embeddings", "Qwen TTS", "Render"],
    gaugePercent: 100,
    cta: "Go Pro",
  },
];

export const BEYOND_PRO = [
  { name: "Scale", price: "from $500/mo", blurb: "More agents, more pool, same flat rate." },
  { name: "Private cloud", price: "from $5,000/mo", blurb: "Dedicated infrastructure, our cloud, your rules." },
  { name: "Self-hosted", price: "from $20,000/mo", blurb: "The whole platform, inside your walls." },
] as const;

export const PILOT_PROGRAM_PRICE = "$15,000 fixed";

export const TRIAL_COPY =
  "7-day free trial on Team. Card down at checkout, nothing charged until it ends.";

export const OVERAGE_COPY =
  "Hit the cap? We applaud you. You throttle until tomorrow — never a surprise bill. You can always add another plan to keep going.";

export const POOL_COPY = "API key draws from the same pool on every tier.";

export const NO_PER_SEAT_COPY = "No per-seat pricing, ever.";

export const FLAT_RATE_FROM = "Flat rate from $39/mo.";
