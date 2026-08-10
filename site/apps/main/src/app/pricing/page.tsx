import type { Metadata } from "next";
import { Footer, GlassCard, Header } from "@hypercli/shared-ui";
import {
  AuroraFinalCta,
  AuroraHero,
  AuroraHeroHeading,
  AuroraHeroLead,
  MarketingActionGroup,
  MarketingBand,
  MarketingContainer,
  MarketingEyebrow,
  MarketingShell,
  marketingCtaClassName,
} from "@hypercli/shared-ui/marketing";
import { Check, Users } from "lucide-react";
import { ContactLink } from "@/components/contact-cta";
import { GetStartedLink } from "@/components/get-started-link";
import { PlanTierCard } from "@/components/plan-tier-card";
import { BEYOND_PRO, NO_PER_SEAT_COPY, OVERAGE_COPY, PLAN_TIERS, POOL_COPY, TRIAL_COPY } from "@/lib/plans";

export const metadata: Metadata = {
  title: "HyperCLI Pricing — Solo, Team, Pro. Flat rate, no meter.",
  description:
    "Solo $39, Team $79, Pro $149 — always-on agents with pooled daily tokens, API access from the same pool, and no per-seat pricing. Ever.",
};

const ALL_PLAN_CHIPS = [
  POOL_COPY,
  "Tokens pool across agents",
  "Spawn temporary agents on any tier",
  "Every channel — Slack to buzz",
  "Browser, voice & memory",
  "Cancel anytime",
];

const BEYOND_PRO_META = [
  { question: "Need more agents?", accent: "text-primary", cta: "Talk to us", source: "pricing-beyond-pro-scale" },
  { question: "Need more security?", accent: "text-success", cta: "Talk to engineering", source: "pricing-beyond-pro-private-cloud" },
  { question: "Need full control?", accent: "text-chart-3", cta: "Talk to engineering", source: "pricing-beyond-pro-self-hosted" },
];

export default function PricingPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero + tiers */}
      <AuroraHero
        width="6xl"
        backdrop={
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[6%] h-[520px] w-[520px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[8%] h-[420px] w-[420px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[14%] right-[28%] h-[400px] w-[400px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
        }
      >
        <MarketingEyebrow>Pricing</MarketingEyebrow>
        <AuroraHeroHeading className="mb-5">
          Pick your <span className="gradient-text-primary">agents.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mb-12">
          Flat rate. Daily tokens pooled across your agents — and your API key draws from the same pool. No meter,
          ever.
        </AuroraHeroLead>

        <div className="grid items-stretch gap-4 text-left md:grid-cols-3">
          {PLAN_TIERS.map((tier) => (
            <PlanTierCard
              key={tier.id}
              tier={tier}
              specs={[tier.agents, `${tier.memory} memory`, tier.tokensPerDay, "API access — same pool"]}
              source="pricing-plan"
            />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          <span className="flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            <Users className="h-4 w-4" aria-hidden="true" />
            {NO_PER_SEAT_COPY}
          </span>
          {ALL_PLAN_CHIPS.map((chip) => (
            <span
              key={chip}
              className="flex items-center gap-1.5 rounded-full border border-border-medium px-4 py-2 text-sm text-text-secondary"
            >
              <Check className="h-4 w-4 text-success" aria-hidden="true" />
              {chip}
            </span>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-text-secondary">{OVERAGE_COPY}</p>
      </AuroraHero>

      {/* Beyond Pro */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer>
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Beyond <span className="text-primary">Pro</span>
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-text-secondary">
            Three doors up from here — pick the one that matches your bottleneck.
          </p>
          <div className="grid items-stretch gap-4 text-left md:grid-cols-3">
            {BEYOND_PRO.map((card, index) => (
              <GlassCard key={card.name} interactive className="flex flex-col p-7">
                <p
                  className={`mb-3 text-xs font-bold uppercase tracking-[0.1em] ${BEYOND_PRO_META[index].accent}`}
                >
                  {BEYOND_PRO_META[index].question}
                </p>
                <h3 className="mb-1 text-lg font-bold tracking-tight text-foreground">{card.name}</h3>
                <p className="mb-2 font-mono text-sm font-semibold text-text-secondary">{card.price}</p>
                <p className="mb-6 flex-1 text-sm leading-relaxed text-text-secondary">{card.blurb}</p>
                <ContactLink
                  source={BEYOND_PRO_META[index].source}
                  className="btn-secondary inline-block self-start rounded-full px-6 py-2.5 text-sm font-semibold"
                >
                  {BEYOND_PRO_META[index].cta}
                </ContactLink>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* API comes standard */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer width="3xl">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            The API <span className="text-primary">comes standard.</span>
          </h2>
          <p className="mx-auto mb-9 max-w-xl text-lg leading-relaxed text-text-secondary">
            All paid tiers above include OpenAI- and Anthropic-compatible API keys, drawing from the same daily pool
            as your agents. Need more than 100M a day? Talk to us.
          </p>
          <MarketingActionGroup>
            <ContactLink source="pricing-api-overage" className={marketingCtaClassName({ variant: "secondary" })}>
              Talk to us
            </ContactLink>
          </MarketingActionGroup>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading={
          <>
            One decision: <span className="gradient-text-primary">how much agent do you need?</span>
          </>
        }
        description="Everything else is included. Card down, agents up."
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Start your free trial"
              trial
              className={marketingCtaClassName({ size: "final" })}
            />
          </MarketingActionGroup>
        }
        footnote={TRIAL_COPY}
      />
    </MarketingShell>
  );
}
