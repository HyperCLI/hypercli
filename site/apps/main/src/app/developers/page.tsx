import type { Metadata } from "next";
import Link from "next/link";
import {
  Footer,
  GlassCard,
  Header,
  MetricCard,
  TerminalWindow,
  type TerminalLine,
} from "@hypercli/shared-ui";
import {
  AuroraFinalCta,
  AuroraGlowFrame,
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
import { Database, Images, MessageCircle, Mic, Monitor, Settings2 } from "lucide-react";
import { PLAN_TIERS } from "@/lib/plans";
import { GetStartedLink } from "@/components/get-started-link";
import { PlanTierCard } from "@/components/plan-tier-card";

export const metadata: Metadata = {
  title: "HyperCLI — Your agent gets a whole machine",
  description:
    "Cloud-hosted, always-on agents with desktop, browser, voice, and media built in. Flat-rate inference. Live in under 5 minutes.",
};

const TERMINAL_LINES: TerminalLine[] = [
  { tone: "cmd", text: "hyper agents create my-agent" },
  { tone: "success", text: "✓ live on its own machine" },
  { tone: "cmd", text: 'hyper flow text-to-image "launch hero"' },
  { tone: "success", text: "✓ render complete · hero-v1.png" },
  { tone: "cmd", text: "hyper billing" },
  { tone: "success", text: "✓ flat rate · nothing surprising here" },
];

const CAPABILITIES = [
  {
    icon: Images,
    title: "Media generation",
    body: "Text-to-image, text-to-video, lip-sync, image-to-video. Flat per-render pricing, refunded on failure.",
  },
  {
    icon: Mic,
    title: "Voice, both ways",
    body: "Instant TTS, voice cloning and design, streaming audio, built-in transcription.",
  },
  {
    icon: Monitor,
    title: "Desktop and browser",
    body: "Playwright-backed browser automation, plus a full VNC desktop on Pro pods.",
  },
  {
    icon: Settings2,
    title: "Self-managing",
    body: "Edits its own config, schedules its own cron jobs, installs skills from ClawHub.",
  },
  {
    icon: Database,
    title: "Real memory",
    body: "Qwen embeddings with vector search over notes, files, and shared workspaces.",
  },
  {
    icon: MessageCircle,
    title: "Every channel",
    body: "Slack, Teams, Telegram, and WhatsApp. Proactive messages included.",
  },
];

export default function DevelopersPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero backdropVariant="standard">
        <MarketingEyebrow>The agent platform</MarketingEyebrow>
        <AuroraHeroHeading>
          Your agent gets a<br />
          <span className="gradient-text-primary">whole machine.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead>
          Cloud-hosted, always on — desktop, browser, voice, and media generation built in. Live in under 5
          minutes. No config gymnastics, no separate inference bills.
        </AuroraHeroLead>
        <MarketingActionGroup className="mb-11">
          <GetStartedLink
            label="Deploy your first agent"
            toAgentDashboard
            className={marketingCtaClassName()}
          />
          <Link
            href="/inference"
            className={marketingCtaClassName({ variant: "secondary" })}
          >
            Get an API key
          </Link>
        </MarketingActionGroup>
        <AuroraGlowFrame>
          <TerminalWindow title="hyper — zsh" lines={TERMINAL_LINES} typed className="relative" />
        </AuroraGlowFrame>
        <p className="mt-7 text-sm text-text-muted">
          Two commands. Or skip the CLI — grab an API key and plug straight into inference.
        </p>
      </AuroraHero>

      {/* Token economics */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer width="4xl">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Up to 100 million tokens a day. <span className="text-primary">Flat rate.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Metered billing is why nobody runs agents around the clock. We removed the meter.
          </p>
          <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
            <MetricCard
              label="Daily tokens on Pro — Kimi K3"
              value="100M"
              className="p-6 text-center"
            />
            <MetricCard
              label="That volume, metered*"
              value={
                <>
                  $30,000+<span className="text-base font-normal text-text-muted">/mo</span>
                </>
              }
              className="p-6 text-center"
            />
            <MetricCard
              highlighted
              label={<span className="text-primary">Your bill</span>}
              value={
                <span className="text-primary">
                  from $39<span className="text-base font-normal">/mo</span>
                </span>
              }
              className="p-6 text-center"
            />
          </div>
          <p className="mt-6 text-xs text-text-muted">
            Run it flat out. Your bill doesn&apos;t move. &nbsp;·&nbsp; *100M/day of a frontier-class model at published
            list prices, 80/20 blend.
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Capability grid */}
      <MarketingBand bordered>
        <MarketingContainer>
          <h2 className="mb-4 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Everything OpenClaw can do. <span className="text-primary">And a lot it can&apos;t.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">
            Every capability ships with every agent — one API, one bill.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <GlassCard key={cap.title} interactive className="p-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                  <cap.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="mb-2 mt-4 text-lg font-bold tracking-tight text-foreground">{cap.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{cap.body}</p>
              </GlassCard>
            ))}
          </div>
          <p className="mt-7 text-center text-sm">
            <Link href="/capabilities" className="font-semibold text-primary hover:underline">
              Read the full spec →
            </Link>
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Pricing mini-grid */}
      <MarketingBand bordered>
        <MarketingContainer>
          <h2 className="mb-4 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Solo. Team. <span className="text-primary">Pro.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">
            Always-on agents with pooled daily tokens — and your API key draws from the same pool.
          </p>
          <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
            {PLAN_TIERS.map((tier) => (
              <PlanTierCard
                key={tier.id}
                tier={tier}
                specs={[tier.agents, tier.memory, tier.tokensPerDay]}
                source="developers-plan"
              />
            ))}
          </div>
          <p className="mt-7 text-center text-sm">
            <Link href="/pricing" className="font-semibold text-primary hover:underline">
              Full pricing, Teams, and free trial →
            </Link>
          </p>
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading={
          <>
            The most capable agent <span className="gradient-text-primary">you&apos;ll ever run.</span>
          </>
        }
        description="Card down, agent up. Cancel anytime."
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Deploy your first agent"
              toAgentDashboard
              className={marketingCtaClassName({ size: "final" })}
            />
            <Link
              href="/quickstart"
              className={marketingCtaClassName({ variant: "terminal-secondary", size: "final" })}
            >
              See the 5-minute quickstart
            </Link>
          </MarketingActionGroup>
        }
      />
    </MarketingShell>
  );
}
