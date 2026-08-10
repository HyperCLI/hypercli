import type { Metadata } from "next";
import Link from "next/link";
import { ChatDemo, Footer, GlassCard, Header } from "@hypercli/shared-ui";
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
import {
  BellRing,
  Check,
  Clapperboard,
  Clock,
  Laptop,
  ListChecks,
  Lock,
  Plug,
  Search,
  Users,
} from "lucide-react";
import { OVERAGE_COPY, PLAN_TIERS } from "@/lib/plans";
import { GetStartedLink } from "@/components/get-started-link";
import { PlanTierCard } from "@/components/plan-tier-card";

export const metadata: Metadata = {
  title: "HyperCLI — The teammate that never clocks out",
  description:
    "Add it to Slack or Teams. Hand it real work — research, content, follow-ups, reports. It gets done while you run the business.",
};

const CHAT_MESSAGES = [
  {
    from: "user" as const,
    author: "Jamie",
    time: "9:12 PM",
    text: "can you pull together competitor pricing for tomorrow's investor call? table + a one-pager",
  },
  {
    from: "agent" as const,
    author: "Aria",
    time: "9:12 PM",
    text: "On it. I'll check all six competitors' sites tonight and have the table, one-pager, and three talking points in this thread by 7am.",
  },
  {
    from: "agent" as const,
    author: "Aria",
    time: "6:41 AM",
    text: "Done. Two competitors changed pricing this month — flagged in red. Also noticed one killed their free tier; that's your opening. 📎 pricing-table.xlsx · one-pager.pdf",
  },
];

const JOBS = [
  {
    icon: Search,
    title: "Research and reports",
    body: "It browses the web like you do — competitor moves, prospect research, market scans — and delivers docs, not link dumps.",
  },
  {
    icon: Clapperboard,
    title: "Content and media",
    body: "Social posts, product images, even short videos and voiceovers — made in-house, on brand, on schedule.",
  },
  {
    icon: ListChecks,
    title: "Ops and follow-ups",
    body: "Chasing invoices, filling forms, prepping meeting briefs, updating the sheet nobody wants to update.",
  },
  {
    icon: BellRing,
    title: "Watching things",
    body: "\u201CTell me if a competitor changes pricing.\u201D It checks every morning and speaks up only when something matters.",
  },
];

const INTEGRATION_CHIPS = [
  "Gmail",
  "Google Drive",
  "HubSpot",
  "Notion",
  "QuickBooks",
  "Stripe",
  "Shopify",
  "Airtable",
  "Calendly",
];

const LONG_TAIL = [
  "The supplier portal built in 2009",
  "The government form with no API",
  "That internal tool only Dave understands",
];

const STEPS = [
  {
    title: "Add it to Slack or Teams.",
    body: "Two clicks, no IT ticket, no setup wizard.",
  },
  {
    title: "Tell it about your business.",
    body: "Once. It remembers — your customers, your tone, your priorities. You'll never re-explain.",
  },
  {
    title: "Delegate like you would to a person.",
    body: "In plain English, in the channel you already live in. It asks when unsure and reports back when done.",
  },
];

const DIFFS = [
  {
    icon: Laptop,
    title: "It has its own computer.",
    body: "Not a chatbot with plugins — a real machine with a browser, so its reach ends where the internet ends, not where an integration list does.",
  },
  {
    icon: Clock,
    title: "It's on when you're off.",
    body: "It lives on its own always-on machine — work you assign at 9pm is done by 7am, and it watches things without being asked twice.",
  },
  {
    icon: Users,
    title: "One price, whole team.",
    body: "No per-seat math. Everyone in your Slack can delegate to it — $79/mo flat, with generous daily usage that never surprises you.",
  },
  {
    icon: Lock,
    title: "Your business stays yours.",
    body: "What it learns about your company isn't training data. Cancel anytime and it's gone.",
  },
];

const ALL_PLAN_CHIPS = [
  { star: true, text: "Your whole team can talk to them — no per-seat pricing" },
  { star: false, text: "Spawn temporary agents on any tier" },
  { star: false, text: "Every channel — Slack to buzz" },
  { star: false, text: "Browser, voice & memory" },
  { star: false, text: "Cancel anytime" },
];

export default function ForTeamsPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero backdropVariant="balanced">
        <MarketingEyebrow>For founders and small teams</MarketingEyebrow>
        <AuroraHeroHeading className="leading-[1.06]">
          The teammate that
          <br />
          <span className="gradient-text-primary">never clocks out.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mb-9">
          Add it to Slack or Teams. Hand it real work — research, content, follow-ups, reports. It gets done while you
          run the business. No code, no IT, no new tab to check.
        </AuroraHeroLead>
        <MarketingActionGroup className="mb-12">
          <GetStartedLink label="Add to Slack" className={marketingCtaClassName()} />
          <GetStartedLink
            label="Add to Teams"
            className={marketingCtaClassName({ variant: "secondary" })}
          />
        </MarketingActionGroup>
        <ChatDemo channel="Slack" agentName="Aria" messages={CHAT_MESSAGES} className="mx-auto max-w-xl text-left" />
        <p className="mt-5 text-sm text-text-muted">It worked while Jamie slept. That&apos;s the whole product.</p>
      </AuroraHero>

      {/* What you can hand it */}
      <MarketingBand bordered>
        <MarketingContainer className="text-center">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What you can <span className="text-primary">hand it.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Real delegation — not prompts. If you&apos;d give it to a sharp new hire, give it to your agent.
          </p>
          <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {JOBS.map((job) => (
              <GlassCard key={job.title} interactive className="p-7">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <job.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-lg font-bold tracking-tight text-foreground">{job.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{job.body}</p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Works with your tools */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Works with your tools. <span className="text-primary">And everything else.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Other assistants stop where their integration list ends. Yours has a computer.
          </p>
          <div className="grid gap-5 text-left md:grid-cols-2">
            <GlassCard className="p-8">
              <h3 className="mb-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                <Plug className="h-5 w-5 text-primary" aria-hidden="true" />
                3,000+ integrations
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-text-secondary">
                Native connections to the tools your business already runs on — reads, writes, and acts with your
                permission.
              </p>
              <div className="flex flex-wrap gap-2">
                {INTEGRATION_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    {chip}
                  </span>
                ))}
                <span className="rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
                  +3,000 more
                </span>
              </div>
            </GlassCard>
            <GlassCard highlighted className="p-8">
              <h3 className="mb-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                <Laptop className="h-5 w-5 text-primary" aria-hidden="true" />A computer for everything else
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-text-secondary">
                No integration? No problem. It opens the website and does the work the way you would — sign in, click,
                type, download.
              </p>
              <ul className="space-y-2.5">
                {LONG_TAIL.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-text-secondary">
                    <Check className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </div>
          <p className="mt-8 text-base font-semibold text-foreground">
            If you can do it on a computer, you can delegate it.
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Onboarding steps */}
      <MarketingBand bordered>
        <MarketingContainer width="4xl" className="text-center">
          <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Up and running before <span className="text-primary">your coffee&apos;s done.</span>
          </h2>
          <div className="mx-auto grid max-w-xl gap-4 text-left">
            {STEPS.map((step, index) => (
              <GlassCard key={step.title} className="flex items-start gap-4.5 p-6">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {index + 1}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  <b className="font-semibold text-foreground">{step.title}</b> {step.body}
                </p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Why this one's different */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 sm:px-12">
          <h2 className="mb-10 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Why this one&apos;s <span className="text-primary">different.</span>
          </h2>
          <div className="mx-auto grid max-w-4xl gap-x-10 gap-y-8 sm:grid-cols-2">
            {DIFFS.map((diff) => (
              <div key={diff.title} className="flex items-start gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <diff.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <p className="text-sm leading-relaxed text-text-secondary">
                  <b className="font-semibold text-foreground">{diff.title}</b> {diff.body}
                </p>
              </div>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Plans */}
      <MarketingBand id="plans" bordered>
        <MarketingContainer className="text-center">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Pick your <span className="text-primary">agents.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Flat rate. Daily tokens pooled across your agents — and your API key draws from the same pool. No meter,
            ever.
          </p>
          <div className="grid items-stretch gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {PLAN_TIERS.map((tier) => (
              <PlanTierCard
                key={tier.id}
                tier={tier}
                specs={[tier.agents, `${tier.memory} memory`, tier.tokensPerDay, "API access — same pool"]}
                source="teams-plan"
              />
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            {ALL_PLAN_CHIPS.map((chip) => (
              <span
                key={chip.text}
                className={
                  chip.star
                    ? "flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-4 py-2 text-xs font-semibold text-primary"
                    : "flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-xs text-text-secondary"
                }
              >
                {chip.star ? (
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                )}
                {chip.text}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-sm text-text-secondary">{OVERAGE_COPY}</p>
          <p className="mt-6 text-sm text-text-muted">
            Need more agents, more security, or full control?{" "}
            <Link href="/pricing" className="font-semibold text-primary">
              See full pricing →
            </Link>
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading="Your first hire that starts today."
        description="Add it to Slack, hand it something real, and see what comes back by morning."
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Add to Slack"
              className={marketingCtaClassName({ size: "final" })}
            />
            <GetStartedLink
              label="Add to Teams"
              className={marketingCtaClassName({ variant: "terminal-secondary", size: "final" })}
            />
          </MarketingActionGroup>
        }
      />
    </MarketingShell>
  );
}
