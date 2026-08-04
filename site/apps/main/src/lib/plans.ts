export interface PlanTier {
  id: "solo" | "team" | "pro";
  name: string;
  tagline: string;
  price: number;
  agents: string;
  memory: string;
  tokensPerDay: string;
  models: string[];
  gaugePercent: number;
  highlighted?: boolean;
  cta: string;
  ctaNote: string;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "solo",
    name: "Solo",
    tagline: "One agent, always on. Yours.",
    price: 39,
    agents: "1 agent",
    memory: "2 GB",
    tokensPerDay: "25M tokens/day",
    models: ["Kimi K2.6", "Qwen Embeddings", "Qwen TTS"],
    gaugePercent: 25,
    cta: "Get started",
    ctaNote: "Billed monthly · cancel anytime",
  },
  {
    id: "team",
    name: "Team",
    tagline: "Up to three agents. Expand as you grow.",
    price: 79,
    agents: "Up to 3 agents",
    memory: "4 GB",
    tokensPerDay: "50M tokens/day, pooled",
    models: ["Kimi K2.6", "Qwen Embeddings", "Qwen TTS", "Render"],
    gaugePercent: 50,
    highlighted: true,
    cta: "Start free trial",
    ctaNote: "7 days free · cancel anytime",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Three developer-grade agents, frontier brain.",
    price: 149,
    agents: "Up to 3 dev-grade agents",
    memory: "8 GB",
    tokensPerDay: "100M tokens/day, pooled",
    models: ["Kimi K3", "Qwen Embeddings", "Qwen TTS", "Render"],
    gaugePercent: 100,
    cta: "Go Pro",
    ctaNote: "Billed monthly · cancel anytime",
  },
];

export const BEYOND_PRO = [
  {
    name: "Scale",
    price: "from $500/mo",
    blurb: "Pro-grade agent fleets, shared workspaces with roles, scoped keys, central billing, priority support.",
  },
  {
    name: "Private cloud",
    price: "from $5,000/mo",
    blurb: "Managed, single-tenant deployment — isolated compute, your region, our operations.",
  },
  {
    name: "Self-hosted",
    price: "from $20,000/mo",
    blurb: "Up to air-gapped. Open weights, no egress, no meter.",
  },
] as const;

export const PILOT_PROGRAM_PRICE = "$15,000 fixed";

export const TRIAL_COPY =
  "7-day free trial on Team. Card down at checkout, nothing charged until it ends.";

export const OVERAGE_COPY =
  "Hit the cap? We applaud you. You throttle until tomorrow — never a surprise bill. You can always add another plan to keep going.";

export const POOL_COPY = "API key draws from the same pool on every tier.";

export const NO_PER_SEAT_COPY = "Your whole team can talk to them — no per-seat pricing";

export const FLAT_RATE_FROM = "Flat rate from $39/mo.";
