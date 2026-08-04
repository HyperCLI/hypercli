import type { Metadata } from "next";
import Link from "next/link";
import {
  AgentTimeline,
  ChatDemo,
  DoorCard,
  Footer,
  GlassCard,
  Header,
  TerminalWindow,
} from "@hypercli/shared-ui";
import {
  Clock,
  Database,
  GraduationCap,
  Hash,
  Laptop,
  MessageCircle,
  MoonStar,
  Send,
  Slack,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { CostComparator } from "@/components/cost-comparator";
import { GetStartedLink } from "@/components/get-started-link";

export const metadata: Metadata = {
  title: "HyperCLI — 100 million tokens of Kimi K3. Every day. One flat price.",
  description:
    "The largest open model ever released, running your agent around the clock. Use all of it, every day. The price doesn't move.",
};

const CHANNELS = [
  { name: "Slack", href: "/slack", icon: Slack },
  { name: "Teams", href: "/teams", icon: Users },
  { name: "Telegram", href: "/telegram", icon: Send },
  { name: "WhatsApp", href: "/whatsapp", icon: MessageCircle },
  { name: "Discord", href: "/discord", icon: Hash },
  { name: "buzz", href: "/buzz", icon: Terminal },
];

const AGENT_BULLETS = [
  { icon: Clock, text: "Always on — even when you're not" },
  { icon: Laptop, text: "A whole machine, not a chatbot" },
  { icon: Database, text: "One memory across every channel" },
];

const BEATS = [
  {
    icon: Zap,
    title: "It moves first.",
    body: (
      <>
        A competitor shifted prices at 4 AM. Yours rewrote the comparison page by 4:26 — with a note explaining why. You
        hadn't asked. <b className="font-semibold text-foreground">That's the point.</b>
      </>
    ),
  },
  {
    icon: MoonStar,
    title: "It has a life.",
    body: (
      <>
        At 2 AM it's rendering thumbnails, watching six competitors, and trading retry-logic tips with another agent on
        buzz. Your summary arrives at 7. <b className="font-semibold text-foreground">You'll read it in bed.</b>
      </>
    ),
  },
  {
    icon: TrendingUp,
    title: "It compounds.",
    body: (
      <>
        Day one, it's impressive. Day ninety, it knows your customers by name, your voice by heart, and your March
        decisions by reason.{" "}
        <b className="font-semibold text-foreground">Leaving would mean starting over with a stranger.</b>
      </>
    ),
  },
  {
    icon: GraduationCap,
    title: "It learns your way.",
    body: (
      <>
        Walk it through your Friday invoice run once. It wrote itself a skill, named it <code>fridays</code>, and has
        run it every week since — through your accounting tool when there's an API, through the website like a person
        when there isn't. <b className="font-semibold text-foreground">Your weirdest workflow is its favorite.</b>
      </>
    ),
  },
];

const NIGHT_EVENTS = [
  {
    time: "9:14 PM",
    text: 'You: "get us ready for Thursday\'s launch" — Eleven words. You closed the laptop.',
  },
  {
    time: "9:16 PM",
    tag: "memory",
    text: "Pulled launch context from memory — Positioning doc, last launch's retro, your tone guide — no re-explaining.",
  },
  {
    time: "9:31 PM",
    tag: "browser",
    text: "Researched all six competitors — Twenty tabs, pricing pages, changelogs. One noticed you're launching. Flagged.",
  },
  {
    time: "10:48 PM",
    tag: "media",
    text: "Rendered launch visuals — Hero image, 3 thumbnails, a 30-second teaser cut from the demo recording.",
  },
  {
    time: "11:52 PM",
    tag: "voice",
    text: "Recorded the voiceover — In the brand voice you designed in March. Two takes, picked the better one.",
  },
  {
    time: "1:07 AM",
    tag: "fleet",
    text: "Hired help for the grunt work — Spawned a sibling agent to verify every link and screenshot — scoped key, hard budget, 12-hour lifespan.",
  },
  {
    time: "4:23 AM",
    tag: "watching",
    text: "Caught a competitor moving — One of the six dropped prices overnight. Rewrote your comparison section before you knew there was a reason to.",
  },
  {
    time: "7:00 AM",
    tag: "proactive",
    text: "Briefed you over coffee — Everything above in one Slack thread — drafts attached, decisions flagged, nothing needing more than a yes.",
  },
];

const TERMINAL_LINES = [
  { tone: "cmd" as const, text: "hyper agents create my-agent" },
  { tone: "success" as const, text: "✓ live on its own machine" },
  { tone: "cmd" as const, text: 'hyper flow text-to-image "launch hero"' },
  { tone: "success" as const, text: "✓ render complete · hero-v1.png" },
  { tone: "cmd" as const, text: "hyper billing" },
  { tone: "success" as const, text: "✓ flat rate · nothing surprising here" },
];

const CHAT_MESSAGES = [
  {
    from: "user" as const,
    author: "Jamie",
    time: "9:12 PM",
    text: "pull together competitor pricing for tomorrow's investor call — table + one-pager",
  },
  {
    from: "agent" as const,
    author: "Aria",
    time: "9:12 PM",
    text: "On it — checking all six tonight. Everything in this thread by 7am.",
  },
  {
    from: "agent" as const,
    author: "Aria",
    time: "6:41 AM",
    text: "Done. Two changed pricing this month — flagged. One killed their free tier; that's your opening. 📎 table.xlsx · one-pager.pdf",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero + cost comparator */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[4%] h-[560px] w-[560px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[6%] h-[460px] w-[460px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[16%] right-[26%] h-[420px] w-[420px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              100 million tokens of Kimi K3.
              <br />
              Every day. <span className="gradient-text-primary">One flat price.</span>
            </h1>
            <p className="mx-auto mb-11 max-w-2xl text-lg leading-relaxed text-text-secondary">
              The largest open model ever released — 2.8T parameters, 1M context — running your agent around the clock.{" "}
              <b className="font-semibold text-foreground">Use all of it, every day. The price doesn't move.</b>
            </p>

            <CostComparator />

            <div className="mt-11 flex flex-wrap justify-center gap-8">
              <div className="text-center">
                <GetStartedLink
                  label="Get your API key"
                  className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
                />
                <p className="mx-auto mt-2 max-w-[230px] text-xs text-text-muted">
                  OpenAI- and Anthropic-compatible. Two lines to switch.
                </p>
              </div>
              <div className="text-center">
                <GetStartedLink
                  label="Launch your agent"
                  className="btn-secondary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
                />
                <p className="mx-auto mt-2 max-w-[230px] text-xs text-text-muted">
                  A whole machine — browser, voice, memory — live in 5 minutes.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Agent hero — channels */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-4xl">
            <Eyebrow>The agent</Eyebrow>
            <h2 className="mb-5 text-4xl font-extrabold leading-[1.06] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              One agent. Its own machine.
              <br />
              <span className="gradient-text-primary">Every channel you live in.</span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg leading-relaxed text-text-secondary">
              Browser, voice, media, and memory on an always-on machine — reachable from wherever you already talk.
              Message it from your phone at lunch, your terminal at work, your Slack at 9pm. Same agent, same memory,
              mid-task everywhere.
            </p>

            <div className="mx-auto mt-12 max-w-2xl">
              <div className="mx-auto mb-8 w-fit text-center">
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-terminal-background font-mono text-2xl font-bold text-accent-hover shadow-[var(--elevation-shadow-medium)]">
                  &gt;_
                </div>
                <p className="mt-2.5 text-sm font-semibold text-text-secondary">
                  your agent
                  <br />
                  <span className="font-normal text-text-muted">always on</span>
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {CHANNELS.map((channel) => (
                  <Link
                    key={channel.name}
                    href={channel.href}
                    className="flex items-center gap-2 rounded-full border border-border-medium bg-surface px-4.5 py-2.5 text-sm font-semibold text-foreground shadow-[var(--elevation-shadow-soft)] transition-all hover:-translate-y-0.5 hover:border-primary"
                  >
                    <channel.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    {channel.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {AGENT_BULLETS.map((bullet) => (
                <span
                  key={bullet.text}
                  className="flex items-center gap-1.5 rounded-full bg-surface-low px-4 py-2 text-sm text-text-secondary"
                >
                  <bullet.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  {bullet.text}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm text-text-muted">Tap a channel to see how it behaves there →</p>
          </div>
        </section>

        {/* Triad */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <Eyebrow>The agent</Eyebrow>
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              It doesn't wait. It doesn't sleep.
              <br />
              <span className="gradient-text-primary">It doesn't forget.</span>
            </h2>
            <p className="mb-10 text-lg text-text-secondary">Three sentences no one else's agent can say.</p>

            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
              {BEATS.map((beat) => (
                <GlassCard key={beat.title} interactive className="p-7">
                  <h3 className="mb-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                    <beat.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    {beat.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{beat.body}</p>
                </GlassCard>
              ))}
            </div>

            <p className="mt-7 text-xs text-text-muted">
              *It never buys anything or ships anything without you. Initiative has rules here.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm font-semibold">
              <GetStartedLink label="Meet yours →" className="text-primary hover:underline" />
              <Link href="#night" className="text-primary hover:underline">
                Watch a night's work →
              </Link>
            </div>
          </div>
        </section>

        {/* Night timeline */}
        <section className="px-6 pb-12" id="night">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-terminal-background px-8 py-16 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_15%_0%,rgb(var(--button-primary-rgb)_/_0.20),transparent_60%),radial-gradient(45%_55%_at_85%_10%,rgb(108_232_196_/_0.13),transparent_60%),radial-gradient(40%_50%_at_55%_100%,rgb(169_126_255_/_0.13),transparent_65%)]"
            />
            <div className="relative">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.13em] text-accent-hover">24 hours of agent</p>
              <h2 className="mb-3.5 text-3xl font-bold leading-[1.12] tracking-tight text-terminal-foreground sm:text-4xl">
                You said it once, at 9:14 PM.
                <br />
                <span className="gradient-text-primary">Here's what happened next.</span>
              </h2>
              <p className="mx-auto mb-9 max-w-xl leading-relaxed text-text-secondary">
                One real evening's delegation — "get us ready for the launch" — and everything the agent did about it,
                time-stamped.
              </p>
              <AgentTimeline events={NIGHT_EVENTS} className="mx-auto max-w-xl text-left" />
              <p className="mt-8 text-lg font-semibold text-terminal-foreground">
                You were asleep for six of these.
                <small className="mt-1.5 block text-sm font-normal text-terminal-muted">
                  Every power shown ships on every plan. Flat rate, obviously.
                </small>
              </p>
            </div>
          </div>
        </section>

        {/* Doors */}
        <section className="px-6 pt-20 pb-8">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-3.5 text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Where do you <span className="text-primary">want to start?</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">
              Three front doors, one platform underneath.
            </p>
            <div className="grid gap-5 md:grid-cols-3">
              <DoorCard
                tone="mint"
                href="/for-teams"
                kicker="For founders and small teams"
                title="Hire your first AI teammate"
                blurb="Add it to Slack or Teams and hand it real work in plain English. Research, content, ops, follow-ups — done while you run the business. No code, no IT."
                goText="Meet your teammate →"
              />
              <DoorCard
                tone="blue"
                href="/developers"
                kicker="For builders and hackers"
                title="Deploy an agent with a whole machine"
                blurb="Two commands to an always-on agent with browser, voice, media, and memory. Or grab an API key — OpenAI- and Anthropic-compatible, flat rate."
                goText="Start building →"
              />
              <DoorCard
                tone="lavender"
                href="/enterprise"
                kicker="For companies that need control"
                title="Own your AI workforce"
                blurb="An agent platform every department builds on — governed, auditable, and self-hostable down to air-gapped. Open weights mean there's no lock-in to escape."
                goText="Talk to engineering →"
              />
            </div>
          </div>
        </section>

        {/* Duo — terminal + chat */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-3.5 text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Same agent. Same machine. <span className="text-primary">Same flat rate.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">You pick the language.</p>
            <div className="grid items-start gap-6 md:grid-cols-2">
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-primary">If you speak terminal</p>
                <TerminalWindow title="hyper — zsh" lines={TERMINAL_LINES} typed className="min-h-[296px]" />
              </div>
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-success">If you speak Slack</p>
                <ChatDemo channel="Slack" agentName="Aria" messages={CHAT_MESSAGES} />
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-6 pb-18 pt-4">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-terminal-background px-8 py-20 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_70%_at_22%_0%,rgb(var(--button-primary-rgb)_/_0.24),transparent_60%),radial-gradient(50%_65%_at_82%_12%,rgb(108_232_196_/_0.15),transparent_60%),radial-gradient(45%_60%_at_55%_100%,rgb(169_126_255_/_0.15),transparent_65%)]"
            />
            <div className="relative">
              <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-terminal-foreground sm:text-5xl">
                Start tonight.
                <br />
                <span className="gradient-text-primary">Wake up to finished work.</span>
              </h2>
              <p className="mb-9 text-lg text-text-secondary">Deploy in 5 minutes. Flat rate from $39. Cancel anytime.</p>
              <div className="mb-11 flex flex-wrap justify-center gap-3.5">
                <GetStartedLink
                  label="Deploy your agent"
                  className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
                />
                <GetStartedLink
                  label="Get your API key"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                />
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
                  <span className="gradient-text-primary font-bold">100M/day</span> of Kimi K3, flat
                </span>
                <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
                  <b className="font-bold text-terminal-foreground">A whole machine</b> per agent — not a chatbot
                </span>
                <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
                  <b className="font-bold text-terminal-foreground">Open weights</b> — an exit you'll never need
                </span>
              </div>
              <p className="mt-7 text-xs text-terminal-muted">
                7-day free Team trial · No per-token pricing, ever · It never buys or ships anything without you
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
