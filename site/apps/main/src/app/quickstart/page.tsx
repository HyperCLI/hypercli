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
import { CheckCircle2, Clock, Key, MessageCircle, Mic, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "HyperCLI Quickstart — Deploy your first agent in 5 minutes",
  description:
    "Install the CLI, sign in, create, deploy, and talk to your always-on agent — about five minutes end to end.",
};

type SnipPart = { tone: "cmd" | "ok" | "cm" | "text"; text: string };
type SnipLine = SnipPart[];

const STEPS: { title: string; time: string; body?: string; snip: SnipLine[]; note?: string }[] = [
  {
    title: "Install the CLI",
    time: "~30 sec",
    snip: [[{ tone: "cmd", text: "npm install -g hypercli" }]],
  },
  {
    title: "Sign in",
    time: "~30 sec",
    body: "Opens your browser, links the CLI to your account. Your trial starts here — card down, agent up.",
    snip: [
      [{ tone: "cmd", text: "hyper configure" }],
      [{ tone: "ok", text: "✓ Signed in" }],
    ],
  },
  {
    title: "Create your agent",
    time: "~90 sec",
    body: "A name, a model, and what your agent should care about — that becomes its standing instructions. Change everything later.",
    snip: [
      [{ tone: "cmd", text: "hyper agents create my-agent" }],
      [{ tone: "cm", text: "? Model: kimi-k2.6" }],
      [{ tone: "cm", text: "? Purpose: Watch my repo, summarize activity every morning" }],
      [{ tone: "ok", text: "✓ Created my-agent" }],
    ],
  },
  {
    title: "Deploy",
    time: "~2 min",
    body: "Provisions your agent's machine, wires up inference, connects channels. This is the config work other platforms make you do — done for you.",
    snip: [
      [{ tone: "cmd", text: "hyper agents start my-agent" }],
      [
        { tone: "text", text: "Provisioning machine........... " },
        { tone: "ok", text: "done" },
      ],
      [
        { tone: "text", text: "Wiring inference (K2.6 + Qwen)... " },
        { tone: "ok", text: "done" },
      ],
      [{ tone: "ok", text: "→ my-agent is live" }],
    ],
  },
  {
    title: "Say hello",
    time: "~30 sec",
    snip: [
      [{ tone: "cmd", text: "hyper agents shell my-agent" }],
      [
        { tone: "ok", text: "my-agent: " },
        { tone: "text", text: "Hey. I'm watching the repo — first summary lands at 7am. Need anything before then?" },
      ],
    ],
    note: "That's it. It stays on when you close the terminal — that's the point.",
  },
];

const NEXT_CARDS = [
  {
    icon: Zap,
    title: "Put it on a schedule",
    description: "Your agent can write its own cron jobs — just ask it, or set one explicitly.",
  },
  {
    icon: Mic,
    title: "Give it a voice",
    description: "Clone yours, design one from a description, or pick a stock voice.",
  },
  {
    icon: MessageCircle,
    title: "Add channels",
    description: "Reach it from Slack, Teams, Telegram, or WhatsApp.",
  },
  {
    icon: Key,
    title: "Just want inference?",
    description: "Skip the agent — grab an API key and point your OpenAI or Anthropic code at us.",
  },
];

const PART_CLASSES: Record<SnipPart["tone"], string> = {
  cmd: "text-terminal-foreground",
  ok: "text-terminal-live",
  cm: "italic text-terminal-muted",
  text: "text-terminal-foreground",
};

function Snip({ lines }: { lines: SnipLine[] }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl bg-terminal-background px-5 py-4 font-mono text-[13px] leading-loose">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} className="whitespace-pre-wrap">
          {line.map((part, partIndex) =>
            part.tone === "cmd" ? (
              <span key={partIndex} className={PART_CLASSES.cmd}>
                <span className="mr-2 select-none text-accent-hover">$</span>
                {part.text}
              </span>
            ) : (
              <span key={partIndex} className={PART_CLASSES[part.tone]}>
                {part.text}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero
        width="3xl"
        className="pb-10 text-left"
        backdrop={
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[12%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[4%] right-[10%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[20%] left-[18%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
        }
      >
        <MarketingEyebrow className="mb-3">Docs / Quickstart</MarketingEyebrow>
        <AuroraHeroHeading className="mb-5 lg:text-6xl">
          Deploy your <span className="gradient-text-primary">first agent.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mx-0 mb-6">
          By the end of this page you&apos;ll have an always-on agent with its own cloud machine. You&apos;ll need a HyperCLI
          account and Node 18+.
        </AuroraHeroLead>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-5 py-2 text-sm font-semibold text-primary">
          <Clock className="h-4 w-4" aria-hidden="true" />
          About 5 minutes
        </span>
      </AuroraHero>

      {/* Steps */}
      <MarketingBand spacing="none" className="px-6 pb-16">
        <MarketingContainer width="3xl">
          <div className="grid gap-4">
            {STEPS.map((step, index) => (
              <GlassCard key={step.title} className="flex flex-col gap-3 p-6">
                <div className="flex items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {index + 1}
                  </span>
                  <p className="text-lg font-semibold text-foreground">
                    {step.title}
                    <span className="ml-2.5 rounded-full bg-success/10 px-2.5 py-0.5 align-middle text-xs font-semibold text-success">
                      {step.time}
                    </span>
                  </p>
                </div>
                {step.body && <p className="text-sm leading-relaxed text-text-secondary">{step.body}</p>}
                <Snip lines={step.snip} />
                {step.note && <p className="text-sm leading-relaxed text-text-secondary">{step.note}</p>}
              </GlassCard>
            ))}
          </div>

          <div className="mt-7 flex items-start gap-3 rounded-2xl bg-success/10 px-6 py-5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <p className="text-sm font-medium leading-relaxed text-success">
              You now have an always-on machine with browser, voice, media generation, and memory — every capability,
              no add-ons. It&apos;s already remembering this conversation.
            </p>
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Where to next */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer>
          <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Where <span className="text-primary">to next.</span>
          </h2>
          <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {NEXT_CARDS.map((card) => (
              <GlassCard key={card.title} interactive className="p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground">{card.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{card.description}</p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading={
          <>
            Stuck? <span className="gradient-text-primary">Ask your agent.</span>
          </>
        }
        description={
          <>
            It can read these docs. The full reference lives at docs.hypercli.com — the source of truth this page
            defers to.
          </>
        }
        descriptionClassName="mx-auto max-w-xl"
        actions={
          <MarketingActionGroup>
            <a
              href="https://docs.hypercli.com/cli/quickstart"
              className={marketingCtaClassName({ size: "final" })}
            >
              Read the full quickstart
            </a>
          </MarketingActionGroup>
        }
      />
    </MarketingShell>
  );
}
