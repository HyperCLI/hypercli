import type { Metadata } from "next";
import Link from "next/link";
import { Footer, GlassCard, Header, PricingTierCard } from "@hypercli/shared-ui";
import { Check, Users } from "lucide-react";
import { GetStartedLink } from "@/components/get-started-link";
import { BEYOND_PRO, NO_PER_SEAT_COPY, OVERAGE_COPY, PLAN_TIERS, POOL_COPY, TRIAL_COPY } from "@/lib/plans";
import { agentPlanCtaHref } from "@/lib/agent-links";

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
  { question: "Need more agents?", accent: "text-primary", cta: "Talk to us", href: "/enterprise" },
  { question: "Need more security?", accent: "text-success", cta: "Talk to engineering", href: "/enterprise" },
  { question: "Need full control?", accent: "text-chart-3", cta: "Talk to engineering", href: "/self-hosted" },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero + tiers */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[6%] h-[520px] w-[520px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[8%] h-[420px] w-[420px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[14%] right-[28%] h-[400px] w-[400px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-6xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">Pricing</p>
            <h1 className="mb-5 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Pick your <span className="gradient-text-primary">agents.</span>
            </h1>
            <p className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Flat rate. Daily tokens pooled across your agents — and your API key draws from the same pool. No meter,
              ever.
            </p>

            <div className="grid items-stretch gap-4 text-left md:grid-cols-3">
              {PLAN_TIERS.map((tier) => (
                <PricingTierCard
                  key={tier.id}
                  name={tier.name}
                  tagline={tier.tagline}
                  price={`$${tier.price}`}
                  specs={[tier.agents, `${tier.memory} memory`, tier.tokensPerDay, "API access — same pool"]}
                  models={tier.models}
                  gaugePercent={tier.gaugePercent}
                  highlighted={tier.highlighted}
                  ctaLabel={tier.cta}
                  ctaHref={agentPlanCtaHref(tier.id)}
                  ctaNote={tier.ctaNote}
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
          </div>
        </section>

        {/* Beyond Pro */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
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
                  <Link
                    href={BEYOND_PRO_META[index].href}
                    className="btn-secondary inline-block self-start rounded-full px-6 py-2.5 text-sm font-semibold"
                  >
                    {BEYOND_PRO_META[index].cta}
                  </Link>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* API comes standard */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              The API <span className="text-primary">comes standard.</span>
            </h2>
            <p className="mx-auto mb-9 max-w-xl text-lg leading-relaxed text-text-secondary">
              All paid tiers above include OpenAI- and Anthropic-compatible API keys, drawing from the same daily pool
              as your agents. Need more than 100M a day? Talk to us.
            </p>
            <Link
              href="/enterprise"
              className="btn-secondary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
            >
              Talk to us
            </Link>
          </div>
        </section>

        {/* Closer */}
        <section className="px-6 pb-18 pt-4">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-terminal-background px-8 py-20 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_70%_at_22%_0%,rgb(var(--button-primary-rgb)_/_0.24),transparent_60%),radial-gradient(50%_65%_at_82%_12%,rgb(108_232_196_/_0.15),transparent_60%),radial-gradient(45%_60%_at_55%_100%,rgb(169_126_255_/_0.15),transparent_65%)]"
            />
            <div className="relative">
              <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-terminal-foreground sm:text-5xl">
                One decision: <span className="gradient-text-primary">how much agent do you need?</span>
              </h2>
              <p className="mb-9 text-lg text-text-secondary">Everything else is included. Card down, agents up.</p>
              <GetStartedLink
                label="Start your free trial"
                trial
                className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
              />
              <p className="mt-7 text-xs text-terminal-muted">{TRIAL_COPY}</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
