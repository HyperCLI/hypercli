import type { Metadata } from "next";
import Link from "next/link";
import {
  AgentTimeline,
  ChatDemo,
  DoorCard,
  Footer,
  GlassCard,
  Header,
} from "@hypercli/shared-ui";
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
  Activity,
  Clock,
  Database,
  GraduationCap,
  Laptop,
  LockOpen,
  MoonStar,
  Rocket,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { CostComparator } from "@/components/cost-comparator";
import { ContactLink } from "@/components/contact-cta";
import { GetStartedLink } from "@/components/get-started-link";
import { HomeChannelNetwork } from "@/components/home-channel-network";
import { HomePricingTierCard } from "@/components/home-pricing-tier-card";
import { HomeScrollEffects } from "@/components/home-scroll-effects";
import { HomeTerminalDemo } from "@/components/home-terminal-demo";
import { PLAN_TIERS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "HyperCLI — Your agent never sleeps. Your bill never moves.",
  description:
    "An always-on agent with its own machine. Flat-rate plans start at 25M tokens a day; limited-access Pro pairs Kimi K3 with 100M a day.",
};

const AGENT_BULLETS = [
  { icon: Clock, text: "Always on — even when you're not" },
  { icon: Laptop, text: "A whole machine, not a chatbot" },
  { icon: Database, text: "One memory across every channel" },
];

const HERO_PROOF = [
  { icon: Rocket, value: "38,000+", label: "agents deployed" },
  { icon: Users, value: "2,400+", label: "teams run on HyperCLI" },
  { icon: LockOpen, value: "Apache-2.0", label: "open weights" },
  { icon: Activity, value: "99.98%", label: "uptime, last 90 days" },
];

const BEATS = [
  {
    icon: Zap,
    title: "It moves first.",
    body: (
      <>
        A competitor shifted prices at 4 AM. Yours rewrote the comparison page by 4:26 — with a note explaining why. You
        hadn&apos;t asked. <b className="font-semibold text-foreground">That&apos;s the point.</b>
      </>
    ),
  },
  {
    icon: MoonStar,
    title: "It has a life.",
    body: (
      <>
        At 2 AM it&apos;s rendering thumbnails, watching six competitors, and trading retry-logic tips with another agent on
        buzz. Your summary arrives at 7. <b className="font-semibold text-foreground">You&apos;ll read it in bed.</b>
      </>
    ),
  },
  {
    icon: TrendingUp,
    title: "It compounds.",
    body: (
      <>
        Day one, it&apos;s impressive. Day ninety, it knows your customers by name, your voice by heart, and your March
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
        run it every week since — through your accounting tool when there&apos;s an API, through the website like a person
        when there isn&apos;t. <b className="font-semibold text-foreground">Your weirdest workflow is its favorite.</b>
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

export default function Home() {
  return (
    <MarketingShell
      header={<Header homepage />}
      footer={<Footer compact />}
      headerClearance="primary"
      data-home-motion-root=""
    >
      <HomeScrollEffects />
      {/* Agent-first hero */}
      <AuroraHero
        className="home-hero"
        backdrop={
          <div aria-hidden="true" className="home-hero-backdrop">
            <span />
            <span />
            <span />
          </div>
        }
      >
        <AuroraHeroHeading>
          Your agent never sleeps.
          <br />
          <span className="gradient-text-primary">Your bill never moves.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead>
          An always-on agent with its own machine — browser, voice, media, memory — powered by{" "}
          <b className="font-semibold text-foreground">Kimi K3, the largest open model ever released</b>. 100 million
          tokens a day. One flat price.
        </AuroraHeroLead>

        <MarketingActionGroup className="gap-8">
          <div className="text-center">
            <GetStartedLink
              label="Launch your agent"
              toAgentDashboard
              className={marketingCtaClassName()}
            />
            <p className="mx-auto mt-2 max-w-[230px] text-xs text-text-muted">
              A whole machine — browser, voice, memory — live in 5 minutes.
            </p>
          </div>
          <div className="text-center">
            <GetStartedLink
              label="Get your API key"
              className={marketingCtaClassName({ variant: "secondary" })}
            />
            <p className="mx-auto mt-2 max-w-[230px] text-xs text-text-muted">
              OpenAI- and Anthropic-compatible. Two lines to switch.
            </p>
          </div>
        </MarketingActionGroup>

        <ul className="mx-auto mt-11 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-text-secondary sm:text-[15px]">
          {HERO_PROOF.map((proof) => (
            <li key={proof.label} className="inline-flex items-center gap-2 whitespace-nowrap">
              <proof.icon className="h-4 w-4 text-primary" aria-hidden="true" />
              <strong className="font-bold text-foreground">{proof.value}</strong>
              <span>{proof.label}</span>
            </li>
          ))}
        </ul>
      </AuroraHero>

      {/* Cost proof */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer width="4xl">
          <MarketingEyebrow data-home-reveal="">The math</MarketingEyebrow>
          <h2
            data-home-reveal=""
            data-home-reveal-delay={70}
            className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl"
          >
            What does your usage <span className="text-primary">actually cost?</span>
          </h2>
          <p
            data-home-reveal=""
            data-home-reveal-delay={140}
            className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-secondary"
          >
            Pick a daily volume. Here&apos;s what it costs through metered APIs — and through HyperCLI.
          </p>
          <div data-home-reveal="" data-home-reveal-delay={210}>
            <CostComparator />
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Night timeline */}
      <MarketingBand spacing="none" className="px-6 py-12" id="night">
        <MarketingContainer
          width="4xl"
          data-home-reveal=""
          className="relative overflow-hidden rounded-3xl bg-terminal-background px-8 py-16 text-center"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_15%_0%,rgb(var(--button-primary-rgb)_/_0.20),transparent_60%),radial-gradient(45%_55%_at_85%_10%,rgb(108_232_196_/_0.13),transparent_60%),radial-gradient(40%_50%_at_55%_100%,rgb(169_126_255_/_0.13),transparent_65%)]"
          />
          <div className="relative">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.13em] text-[#9DB4FF]">24 hours of agent</p>
            <h2 className="mb-3.5 text-3xl font-bold leading-[1.12] tracking-tight text-terminal-foreground sm:text-4xl">
              You said it once, at 9:14 PM.
              <br />
              <span className="gradient-text-primary">Here&apos;s what happened next.</span>
            </h2>
            <p className="mx-auto mb-9 max-w-xl leading-relaxed text-terminal-muted">
              One evening&apos;s delegation — &quot;get us ready for the launch&quot; — and everything the agent did about it,
              time-stamped.
            </p>
            <div data-home-timeline="">
              <AgentTimeline events={NIGHT_EVENTS} className="mx-auto max-w-xl text-left" />
            </div>
            <p className="mt-8 text-lg font-semibold text-terminal-foreground">
              You were asleep for six of these.
              <small className="mt-1.5 block text-sm font-normal text-terminal-muted">
                Browser, memory, media, voice, and a machine that stays on.
              </small>
            </p>
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Agent channels */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer width="4xl">
          <MarketingEyebrow data-home-reveal="" className="mb-[18px] text-[13.5px] md:mb-[22px] md:text-[17px]">
            Every channel
          </MarketingEyebrow>
          <h2
            data-home-reveal=""
            data-home-reveal-delay={70}
            className="mx-auto mb-5 text-[34px] font-extrabold leading-[1.06] tracking-[-0.035em] text-foreground sm:text-[56px] md:text-[70px]"
          >
            One agent. Its own machine.
            <br />
            <span className="gradient-text-primary">Every channel you live in.</span>
          </h2>
          <p
            data-home-reveal=""
            data-home-reveal-delay={140}
            className="mx-auto max-w-[620px] text-[18px] leading-[1.65] text-text-secondary md:max-w-[775px] md:text-[22.5px]"
          >
            Browser, voice, media, and memory on an always-on machine — reachable from wherever you already talk.
            Message it from your phone at lunch, your terminal at work, your Slack at 9pm. Same agent, same memory,
            mid-task everywhere.
          </p>

          <div data-home-reveal="" data-home-reveal-delay={210}>
            <HomeChannelNetwork />
          </div>

          <div data-home-reveal="" data-home-reveal-delay={280}>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {AGENT_BULLETS.map((bullet) => (
                <span
                  key={bullet.text}
                  className="flex items-center gap-2 rounded-full bg-surface-low px-4 py-2 text-sm text-text-secondary md:px-[21px] md:py-2.5 md:text-[16px]"
                >
                  <bullet.icon className="h-4 w-4 text-primary md:h-[18px] md:w-[18px]" aria-hidden="true" />
                  {bullet.text}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm text-text-muted md:text-[16px]">Tap a channel to see how it behaves there.</p>
            <Link href="/integrations" className="mt-4 inline-flex font-semibold text-link hover:underline md:text-[16px]">
              Browse all integrations →
            </Link>
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Differentiation */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer>
          <MarketingEyebrow data-home-reveal="" className="mb-[18px] text-[13.5px] md:mb-[22px] md:text-[17px]">
            Why it&apos;s different
          </MarketingEyebrow>
          <h2
            data-home-reveal=""
            data-home-reveal-delay={70}
            className="mb-4 text-[33px] font-extrabold leading-[1.08] tracking-[-0.04em] text-foreground sm:text-[56px] md:text-[70px]"
          >
            It doesn&apos;t wait. It doesn&apos;t sleep.
            <br />
            <span className="gradient-text-primary">It doesn&apos;t forget.</span>
          </h2>
          <p
            data-home-reveal=""
            data-home-reveal-delay={140}
            className="mb-[26px] text-[18px] text-text-secondary md:text-[22.5px]"
          >
            Three sentences no one else&apos;s agent can say.
          </p>

          <div
            data-home-reveal=""
            data-home-reveal-delay={210}
            className="mb-10 flex flex-wrap items-center justify-center gap-8 text-base font-medium md:text-[20px]"
          >
            <GetStartedLink label="Meet yours →" className="text-primary hover:underline" />
            <Link href="#night" className="text-primary hover:underline">
              Watch a night&apos;s work →
            </Link>
          </div>

          <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {BEATS.map((beat, index) => (
              <GlassCard
                key={beat.title}
                interactive
                data-home-reveal=""
                data-home-reveal-delay={index * 70}
                className="p-7"
              >
                <h3 className="mb-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <beat.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  {beat.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">{beat.body}</p>
              </GlassCard>
            ))}
          </div>

          <p data-home-reveal="" data-home-reveal-delay={280} className="mt-7 text-xs text-text-muted">
            *It never buys anything or ships anything without you. Initiative has rules here.
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Doors */}
      <MarketingBand spacing="none" className="px-6 pb-8 pt-20">
          <MarketingContainer>
            <h2
              data-home-reveal=""
              className="mb-3.5 text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
            >
              Where do you <span className="text-primary">want to start?</span>
            </h2>
            <p
              data-home-reveal=""
              data-home-reveal-delay={70}
              className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary"
            >
              Three front doors, one platform underneath.
            </p>
            <div className="grid gap-5 md:grid-cols-3">
              <div data-home-reveal="" className="h-full">
                <DoorCard
                  className="h-full"
                  tone="mint"
                  href="/for-teams"
                  kicker="For founders and small teams"
                  title="Hire your first AI teammate"
                  blurb="Add it to Slack or Teams and hand it real work in plain English. Research, content, ops, follow-ups — done while you run the business. No code, no IT."
                  goText="Meet your teammate →"
                />
              </div>
              <div data-home-reveal="" data-home-reveal-delay={70} className="h-full">
                <DoorCard
                  className="h-full"
                  tone="blue"
                  href="/developers"
                  kicker="For builders and hackers"
                  title="Deploy an agent with a whole machine"
                  blurb="Two commands to an always-on agent with browser, voice, media, and memory. Or grab an API key — OpenAI- and Anthropic-compatible, flat rate."
                  goText="Start building →"
                />
              </div>
              <div data-home-reveal="" data-home-reveal-delay={140} className="h-full">
                <ContactLink source="home-enterprise-talk-to-engineering" href="/enterprise" className="block h-full">
                  <DoorCard
                    tone="lavender"
                    className="h-full"
                    kicker="For companies that need control"
                    title="Own your AI workforce"
                    blurb="An agent platform every department builds on — governed, auditable, and self-hostable down to air-gapped. Open weights mean there's no lock-in to escape."
                    goText="Talk to engineering →"
                  />
                </ContactLink>
              </div>
            </div>
          </MarketingContainer>
      </MarketingBand>

      {/* Duo — terminal + chat */}
      <MarketingBand spacing="none" className="px-6 py-20">
          <MarketingContainer width="5xl">
            <h2
              data-home-reveal=""
              className="mb-3.5 text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
            >
              Same agent. Same machine. <span className="text-primary">Same flat rate.</span>
            </h2>
            <p
              data-home-reveal=""
              data-home-reveal-delay={70}
              className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary"
            >
              You pick the language.
            </p>
            <div className="grid items-stretch gap-6 md:grid-cols-2">
              <div data-home-reveal="" data-home-reveal-delay={140} className="flex flex-col">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-primary">If you speak terminal</p>
                <HomeTerminalDemo title="hyper — zsh" lines={TERMINAL_LINES} className="h-full" />
              </div>
              <div data-home-reveal="" data-home-reveal-delay={210} className="flex flex-col">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-success">If you speak Slack</p>
                <ChatDemo agentName="Aria" messages={CHAT_MESSAGES} className="h-full" />
              </div>
            </div>
          </MarketingContainer>
      </MarketingBand>

      {/* Pricing */}
      <MarketingBand spacing="none" className="px-6 pb-8 pt-24" id="pricing">
        <MarketingContainer>
          <h2
            data-home-reveal=""
            className="mb-3.5 text-center text-[33px] font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[56px] md:text-[70px]"
          >
            One flat price. <span className="text-primary">Pick your altitude.</span>
          </h2>
          <p
            data-home-reveal=""
            data-home-reveal-delay={70}
            className="mx-auto mb-12 max-w-[725px] text-center text-[18px] text-text-secondary md:text-[22px]"
          >
            Every plan: the whole machine, every channel, no meter.
          </p>

          <div className="mx-auto grid max-w-[1275px] items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
            {PLAN_TIERS.map((tier, index) => (
              <div key={tier.id} data-home-reveal="" data-home-reveal-delay={index * 70} className="h-full">
                <HomePricingTierCard tier={tier} />
              </div>
            ))}
          </div>

          <p
            data-home-reveal=""
            data-home-reveal-delay={210}
            className="mt-[26px] text-center text-[13px] text-text-muted md:text-[16px]"
          >
            7-day free trial on every plan · Cancel anytime · Fair use, not fine print
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Final CTA */}
      <AuroraFinalCta
        data-home-reveal=""
        heading={
          <>
            Start tonight.
            <br />
            <span className="gradient-text-primary">Wake up to finished work.</span>
          </>
        }
        description="Deploy in 5 minutes. Flat rate from $39. Cancel anytime."
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Deploy your agent"
              toAgentDashboard
              className={marketingCtaClassName({ size: "final" })}
            />
            <GetStartedLink
              label="Get your API key"
              className={marketingCtaClassName({ variant: "terminal-secondary", size: "final" })}
            />
          </MarketingActionGroup>
        }
        highlights={
          <>
            <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
              <span className="gradient-text-primary font-bold">100M/day</span> of Kimi K3, flat
            </span>
            <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
              <b className="font-bold text-terminal-foreground">A whole machine</b> per agent — not a chatbot
            </span>
            <span className="rounded-full border border-border-medium px-4.5 py-2.5 text-sm text-text-secondary">
              <b className="font-bold text-terminal-foreground">Open weights</b>{" "}— an exit you&apos;ll never need
            </span>
          </>
        }
        footnote="7-day free trial · No per-token pricing, ever · It never buys or ships anything without you"
      />
    </MarketingShell>
  );
}
