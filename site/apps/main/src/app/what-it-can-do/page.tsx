import type { Metadata } from "next";
import Link from "next/link";
import { Footer, Header } from "@hypercli/shared-ui";
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
import { CheckCircle2, Cog, MessageSquare } from "lucide-react";
import { CapabilityTabs, RoleTabs } from "@/components/what-it-can-do-tabs";
import { GetStartedLink } from "@/components/get-started-link";

export const metadata: Metadata = {
  title: "HyperCLI — Hand it off. It's just done.",
  description:
    "Research, content, voice, ops, watching, memory — real delegation in Slack and Teams, flat rate, no meter.",
};

const PIPELINE = [
  {
    icon: MessageSquare,
    title: "You say it once",
    sub: "One message, where you already work",
  },
  {
    icon: Cog,
    title: "It works",
    sub: "On its own machine — browsing, making, checking",
  },
  {
    icon: CheckCircle2,
    title: "It's delivered",
    sub: "In the thread, with a receipt",
  },
];

const INT_FLOW = [
  { text: "reads the brief in", tool: "Notion" },
  { text: "pulls numbers from", tool: "Stripe" },
  { text: "updates the", tool: "HubSpot", suffix: " deal" },
  { text: "posts the doc in", tool: "Slack" },
];

export default function WhatItCanDoPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero + pipeline */}
      <AuroraHero backdropVariant="balanced">
        <MarketingEyebrow>What it can do</MarketingEyebrow>
        <AuroraHeroHeading className="leading-[1.07]">
          Hand it off. <span className="gradient-text-primary">It&apos;s just done.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead>
          If you&apos;d give it to a person, you can give it to your agent — in Slack, in plain English. It takes the
          task, works it on its own machine, and delivers back to the thread. Off your plate, out of your head.
        </AuroraHeroLead>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {PIPELINE.map((step, index) => (
            <div key={step.title} className="flex items-center gap-3">
              {index > 0 && <span className="text-lg text-text-muted">→</span>}
              <div className="rounded-2xl bg-surface-low px-6 py-4 text-center">
                <step.icon className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
                <p className="mt-1.5 text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-xs leading-snug text-text-muted">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </AuroraHero>

      {/* What you can hand it — tabs */}
      <MarketingBand bordered>
        <MarketingContainer width="5xl" className="text-center">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What you can <span className="text-primary">hand it.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Real messages you could send this afternoon.
          </p>
          <CapabilityTabs />
        </MarketingContainer>
      </MarketingBand>

      {/* A week with your agent, by role */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            A week with your agent, <span className="text-primary">by role.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            One agent, every seat — it knows whose thread is whose.
          </p>
          <RoleTabs />
        </MarketingContainer>
      </MarketingBand>

      {/* It finishes the job in your tools */}
      <MarketingBand bordered>
        <MarketingContainer width="4xl" className="text-center">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            It finishes the job <span className="text-primary">in your tools.</span>
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-lg text-text-secondary">
            Integrations aren&apos;t a feature list — they&apos;re how tasks actually get done. Mid-task, your agent moves
            through whatever the work touches:
          </p>
          <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
            {INT_FLOW.map((chip, index) => (
              <div key={chip.tool} className="flex items-center gap-2">
                {index > 0 && <span className="text-text-muted">→</span>}
                <span className="rounded-full border border-border-medium/40 bg-surface px-4 py-2 text-sm text-text-secondary">
                  {chip.text} <b className="font-semibold text-foreground">{chip.tool}</b>
                  {chip.suffix}
                </span>
              </div>
            ))}
          </div>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-text-secondary">
            3,000+ tools connect natively. And when something has no integration — the supplier portal, the
            government form — it opens the website and does it the way you would.{" "}
            <b className="font-semibold text-foreground">If the work touches it, the agent can finish it.</b>
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Delegate without doing math */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Delegate without <span className="text-primary">doing math.</span>
            </h2>
            <p className="mb-5 text-lg leading-relaxed text-text-secondary">
              Most agents make you bring your own API key — so every task you hand off quietly bills you, and you
              start rationing your own assistant. Yours is flat rate. The tenth task costs what the first one did:
              nothing extra.
            </p>
            <p className="text-base font-semibold text-foreground">
              No meter. No per-task tax. Delegation you don&apos;t have to think about — which is the entire point of
              delegation.
            </p>
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading="All of it, on every plan. No feature gates, ever."
        description="The plan changes how much it can think — never what it can do."
        descriptionClassName="mx-auto max-w-xl"
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Add to Slack"
              className={marketingCtaClassName({ size: "final" })}
            />
            <Link
              href="/pricing"
              className={marketingCtaClassName({ variant: "terminal-secondary", size: "final" })}
            >
              See pricing
            </Link>
          </MarketingActionGroup>
        }
        footnote={
          <>
            Technical founder?{" "}
            <Link href="/capabilities" className="text-accent-hover">
              Read the full spec →
            </Link>
          </>
        }
        footnoteClassName="mt-8"
      />
    </MarketingShell>
  );
}
