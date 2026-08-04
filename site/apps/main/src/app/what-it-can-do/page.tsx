import type { Metadata } from "next";
import Link from "next/link";
import { Footer, Header } from "@hypercli/shared-ui";
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>
  );
}

export default function WhatItCanDoPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero + pipeline */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[6%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>What it can do</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.07] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Hand it off. <span className="gradient-text-primary">It's just done.</span>
            </h1>
            <p className="mx-auto mb-11 max-w-2xl text-lg leading-relaxed text-text-secondary">
              If you'd give it to a person, you can give it to your agent — in Slack, in plain English. It takes the
              task, works it on its own machine, and delivers back to the thread. Off your plate, out of your head.
            </p>
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
          </div>
        </section>

        {/* What you can hand it — tabs */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-5xl text-center">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What you can <span className="text-primary">hand it.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Real messages you could send this afternoon.
            </p>
            <CapabilityTabs />
          </div>
        </section>

        {/* A week with your agent, by role */}
        <section className="px-6 py-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              A week with your agent, <span className="text-primary">by role.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              One agent, every seat — it knows whose thread is whose.
            </p>
            <RoleTabs />
          </div>
        </section>

        {/* It finishes the job in your tools */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              It finishes the job <span className="text-primary">in your tools.</span>
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-lg text-text-secondary">
              Integrations aren't a feature list — they're how tasks actually get done. Mid-task, your agent moves
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
          </div>
        </section>

        {/* Delegate without doing math */}
        <section className="px-6 py-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
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
                No meter. No per-task tax. Delegation you don't have to think about — which is the entire point of
                delegation.
              </p>
            </div>
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
                All of it, on every plan. No feature gates, ever.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                The plan changes how much it can think — never what it can do.
              </p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <GetStartedLink
                  label="Add to Slack"
                  className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
                />
                <Link
                  href="/pricing"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                >
                  See pricing
                </Link>
              </div>
              <p className="mt-8 text-xs text-terminal-muted">
                Technical founder?{" "}
                <Link href="/capabilities" className="text-accent-hover">
                  Read the full spec →
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
