import type { Metadata } from "next";
import Link from "next/link";
import { Footer, GlassCard, Header } from "@hypercli/shared-ui";
import { Check, CircleCheck, CircleMinus, Code, Gem, Minus, Users } from "lucide-react";
import { PILOT_PROGRAM_PRICE } from "@/lib/plans";

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function PilotProgramPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>The Agent Pilot Program</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Generic agents are a party trick.
              <br />
              <span className="gradient-text-primary">Yours will run your business.</span>
            </h1>
            <p className="mx-auto mb-4 max-w-2xl text-lg leading-relaxed text-text-secondary">
              The real value isn't AI that does everything okay — it's agents built completely around your workflows.
              In four weeks, our team builds, tests, and launches your first ones with you. Then your people build the
              rest.
            </p>
            <p className="mb-8 text-sm text-text-muted">
              4 weeks · Production agents, not demos · Limited to 10 companies per quarter
            </p>
            <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold">
              Apply for a pilot
            </Link>
          </div>
        </section>

        {/* Generic vs purpose-built */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
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
          </div>
        </section>

        {/* Four weeks to production */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
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
          </div>
        </section>

        {/* Everyone can build */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Everyone in your company <span className="text-primary">can build.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              The pilot isn't a dependency — it's ignition. After it, agent-building lives at three altitudes:
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
          </div>
        </section>

        {/* What you walk away with */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
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
          </div>
        </section>

        {/* Price card */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <GlassCard className="mx-auto inline-block border-2 border-primary px-10 py-10 sm:px-14">
              <p className="mb-1 text-sm text-text-secondary">The pilot</p>
              <p className="mb-3 text-5xl font-extrabold tracking-tight text-foreground">
                {PILOT_PROGRAM_PRICE.split(" ")[0]}
                <span className="ml-2 text-base font-normal text-text-muted">fixed</span>
              </p>
              <p className="mx-auto mb-7 max-w-sm text-sm leading-relaxed text-text-secondary">
                4 weeks · 2–3 production agents · team training included.
                <br />
                <b className="font-semibold text-foreground">Fully credited</b> toward a Teams or Self-Hosted plan if
                you continue.
              </p>
              <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold">
                Apply for a pilot
              </Link>
            </GlassCard>
            <p className="mx-auto mt-6 max-w-md text-sm text-text-muted">
              10 companies per quarter — our experts build alongside you, and that doesn't scale infinitely. That's
              the point.
            </p>
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
                Your workflows. Working.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                Tell us the process you'd most love to never do manually again. We'll tell you if an agent can own it.
              </p>
              <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold">
                Apply for a pilot
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
