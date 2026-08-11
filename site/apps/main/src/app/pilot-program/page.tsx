import type { Metadata } from "next";
import { Footer, GlassCard, Header } from "@hypercli/shared-ui";
import {
  AuroraFinalCta,
  AuroraHero,
  AuroraHeroHeading,
  AuroraHeroLead,
  MarketingBand,
  MarketingContainer,
  MarketingEyebrow,
  MarketingShell,
} from "@hypercli/shared-ui/marketing";
import { Check, CircleCheck, CircleMinus, Code, Gem, Minus, Users } from "lucide-react";
import { PILOT_PROGRAM_PRICE } from "@/lib/plans";
import { ContactCta } from "@/components/contact-cta";

export const metadata: Metadata = {
  title: "The Agent Pilot Program — Generic agents are a party trick. Yours will run your business.",
  description:
    "In four weeks, our team builds, tests, and launches your first production agents with you. Then your people build the rest. Limited to 10 companies per quarter.",
};

const GENERIC_POINTS = [
  "Knows everything about nothing in particular",
  "You adapt your process to what it can do",
  "Impressive in a demo, ignored by week three",
];

const PURPOSE_BUILT_POINTS = [
  "Knows your process, your systems, your edge cases",
  "Fits how you already work — nothing changes but the workload",
  "Fine-tuned on your data when the job demands it",
];

const WEEKS = [
  {
    week: "Week 1",
    lead: "Map the workflows.",
    body: "We sit with the people who do the work and pick 2–3 processes where an agent pays for itself fastest — usually the repetitive, documented, nobody-loves-it work.",
  },
  {
    week: "Week 2–3",
    lead: "Build and test.",
    body: "Our experts build the agents — connected to your tools, tuned to your edge cases, fine-tuned on your data if the job needs it. Your team watches and learns; the process is the training.",
  },
  {
    week: "Week 4",
    lead: "Launch and hand over the keys.",
    body: "Agents go live in your Slack or Teams. You get the playbook, the configs, and a team that's seen exactly how it's done. They're yours — clone them, extend them, build the next ten.",
  },
];

const ALTITUDES = [
  {
    icon: Users,
    title: "Anyone",
    body: "Describe the job in plain English, in Slack. Ops, sales, finance — no code, no ticket.",
  },
  {
    icon: Code,
    title: "Your engineers",
    body: "Full SDK and CLI — advanced agents, custom tools, deep integrations with internal systems.",
  },
  {
    icon: Gem,
    title: "Our experts",
    body: "For the hard ones: complex workflows, fine-tuning, high-stakes launches. Build, test, launch — with your team, not for the shelf.",
  },
];

const WALK_AWAY_WITH = [
  {
    lead: "2–3 production agents",
    body: "running your actual workflows — not prototypes",
  },
  {
    lead: "Fine-tuned models",
    body: "where the work demanded it — yours to keep",
  },
  {
    lead: "The playbook",
    body: "how each agent works, how to extend it, how to build the next one",
  },
  {
    lead: "A trained team",
    body: "your people watched every step; the next agents are theirs",
  },
];

export default function PilotProgramPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero backdropVariant="standard">
        <MarketingEyebrow>The Agent Pilot Program</MarketingEyebrow>
        <AuroraHeroHeading>
          Generic agents are a party trick.
          <br />
          <span className="gradient-text-primary">Yours will run your business.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mb-4">
          The real value isn&apos;t AI that does everything okay — it&apos;s agents built completely around your
          workflows. In four weeks, our team builds, tests, and launches your first ones with you. Then your people
          build the rest.
        </AuroraHeroLead>
        <p className="mb-8 text-sm text-text-muted">
          4 weeks · Production agents, not demos · Limited to 10 companies per quarter
        </p>
        <ContactCta source="pilot-program-hero" primaryLabel="Apply for a pilot" />
      </AuroraHero>

      {/* Generic vs purpose-built */}
      <MarketingBand bordered>
        <MarketingContainer width="4xl" className="grid gap-4 md:grid-cols-2">
          <GlassCard className="p-7">
            <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-text-secondary">
              <CircleMinus className="h-5 w-5 text-text-muted" aria-hidden="true" />A generic agent
            </h3>
            <ul className="space-y-3.5">
              {GENERIC_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </GlassCard>
          <GlassCard className="border-2 border-primary p-7">
            <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
              <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
              An agent built for your workflow
            </h3>
            <ul className="space-y-3.5">
              {PURPOSE_BUILT_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </GlassCard>
        </MarketingContainer>
      </MarketingBand>

      {/* Four weeks to production */}
      <MarketingBand spacing="compact">
        <MarketingContainer className="rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Four weeks <span className="text-primary">to production.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Not a strategy deck. Working agents, launched, with your team trained to build more.
          </p>
          <div className="mx-auto grid max-w-2xl gap-4 text-left">
            {WEEKS.map((week) => (
              <GlassCard key={week.week} className="flex items-start gap-4 p-6">
                <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-bold whitespace-nowrap text-primary">
                  {week.week}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  <b className="font-semibold text-foreground">{week.lead}</b> {week.body}
                </p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Everyone can build */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer>
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Everyone in your company <span className="text-primary">can build.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            The pilot isn&apos;t a dependency — it&apos;s ignition. After it, agent-building lives at three altitudes:
          </p>
          <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {ALTITUDES.map((altitude) => (
              <GlassCard key={altitude.title} interactive className="p-7">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <altitude.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{altitude.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{altitude.body}</p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* What you walk away with */}
      <MarketingBand spacing="compact">
        <MarketingContainer className="rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
          <h2 className="mb-12 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What you <span className="text-primary">walk away with.</span>
          </h2>
          <div className="mx-auto grid max-w-4xl gap-6 text-left sm:grid-cols-2">
            {WALK_AWAY_WITH.map((item) => (
              <div key={item.lead} className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/15">
                  <Check className="h-4.5 w-4.5 text-success" aria-hidden="true" />
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  <b className="font-semibold text-foreground">{item.lead}</b> — {item.body}
                </p>
              </div>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Price card */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer>
          <GlassCard className="mx-auto inline-block border-2 border-primary px-10 py-10 sm:px-14">
            <p className="mb-1 text-sm text-text-secondary">The pilot</p>
            <p className="mb-3 text-5xl font-extrabold tracking-tight text-foreground">
              {PILOT_PROGRAM_PRICE.split(" ")[0]}
              <span className="ml-2 text-base font-normal text-text-muted">fixed</span>
            </p>
            <p className="mx-auto mb-7 max-w-sm text-sm leading-relaxed text-text-secondary">
              4 weeks · 2–3 production agents · team training included.
              <br />
              <b className="font-semibold text-foreground">Fully credited</b> toward a Teams or Self-Hosted plan if you
              continue.
            </p>
            <ContactCta source="pilot-program-price-card" primaryLabel="Apply for a pilot" />
          </GlassCard>
          <p className="mx-auto mt-6 max-w-md text-sm text-text-muted">
            10 companies per quarter — our experts build alongside you, and that doesn&apos;t scale infinitely.
            That&apos;s the point.
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading="Your workflows. Working."
        description="Tell us the process you'd most love to never do manually again. We'll tell you if an agent can own it."
        descriptionClassName="mx-auto max-w-xl"
        actions={<ContactCta source="pilot-program-final" primaryLabel="Apply for a pilot" />}
      />
    </MarketingShell>
  );
}
