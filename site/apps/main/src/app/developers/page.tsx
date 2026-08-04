import type { Metadata } from "next";
import Link from "next/link";
import {
  Footer,
  GlassCard,
  Header,
  MetricCard,
  NAV_URLS,
  PricingTierCard,
  TerminalWindow,
  type TerminalLine,
} from "@hypercli/shared-ui";
import { Database, Images, MessageCircle, Mic, Monitor, Settings2 } from "lucide-react";
import { PLAN_TIERS } from "@/lib/plans";
import { GetStartedLink } from "@/components/get-started-link";

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>
  );
}

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
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
            <Eyebrow>The agent platform</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Your agent gets a<br />
              <span className="gradient-text-primary">whole machine.</span>
            </h1>
            <p className="mx-auto mb-11 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Cloud-hosted, always on — desktop, browser, voice, and media generation built in. Live in under 5
              minutes. No config gymnastics, no separate inference bills.
            </p>
            <div className="mb-11 flex flex-wrap justify-center gap-3.5">
              <GetStartedLink
                label="Deploy your first agent"
                toAgentDashboard
                className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
              />
              <Link
                href="/inference"
                className="btn-secondary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
              >
                Get an API key
              </Link>
            </div>
            <div className="relative mx-auto max-w-[660px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-[-7%] bottom-[-12%] top-[6%] bg-[radial-gradient(50%_65%_at_32%_60%,rgb(var(--button-primary-rgb)_/_0.20),transparent_70%),radial-gradient(50%_65%_at_72%_55%,rgb(108_232_196_/_0.16),transparent_70%)] blur-[34px]"
              />
              <TerminalWindow title="hyper — zsh" lines={TERMINAL_LINES} typed className="relative" />
            </div>
            <p className="mt-7 text-sm text-text-muted">
              Two commands. Or skip the CLI — grab an API key and plug straight into inference.
            </p>
          </div>
        </section>

        {/* Token economics */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-4xl">
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
              Run it flat out. Your bill doesn't move. &nbsp;·&nbsp; *100M/day of a frontier-class model at published
              list prices, 80/20 blend.
            </p>
          </div>
        </section>

        {/* Capability grid */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Everything OpenClaw can do. <span className="text-primary">And a lot it can't.</span>
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
          </div>
        </section>

        {/* Pricing mini-grid */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Solo. Team. <span className="text-primary">Pro.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">
              Always-on agents with pooled daily tokens — and your API key draws from the same pool.
            </p>
            <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
              {PLAN_TIERS.map((tier) => (
                <PricingTierCard
                  key={tier.id}
                  name={tier.name}
                  tagline={tier.tagline}
                  price={`$${tier.price}`}
                  specs={[tier.agents, tier.memory, tier.tokensPerDay]}
                  models={tier.models}
                  gaugePercent={tier.gaugePercent}
                  highlighted={tier.highlighted}
                  ctaLabel={tier.cta}
                  ctaHref={`${NAV_URLS.agents}?plan=${tier.id}`}
                  ctaNote={tier.ctaNote}
                />
              ))}
            </div>
            <p className="mt-7 text-center text-sm">
              <Link href="/pricing" className="font-semibold text-primary hover:underline">
                Full pricing, Teams, and free trial →
              </Link>
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
                The most capable agent <span className="gradient-text-primary">you'll ever run.</span>
              </h2>
              <p className="mb-9 text-lg text-text-secondary">Card down, agent up. Cancel anytime.</p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <GetStartedLink
                  label="Deploy your first agent"
                  toAgentDashboard
                  className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
                />
                <Link
                  href="/quickstart"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                >
                  See the 5-minute quickstart
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
