import type { Metadata } from "next";
import { Footer, GlassCard, Header } from "@hypercli/shared-ui";
import { ArrowRight, Check, Gift, Mic, Rss, Twitter, Video, Youtube } from "lucide-react";
import { ContactCta } from "@/components/contact-cta";

export const metadata: Metadata = {
  title: "The HyperCLI Builders Program — Build something cool. We'll cover the compute.",
  description:
    "Free Agent Pro + GPU credits for people who build in public — video, stream, thread, podcast. No scripts, no talking points, ever.",
};

// PLACEHOLDER BUILDERS: replace Mira/@dougruns/Sena with real program members before launch.
const CREATORS = [
  {
    initials: "MK",
    avatarClass: "bg-warning/15 text-warning",
    name: "Mira K.",
    platform: "84K subscribers",
    platformIcon: Youtube,
    body: "Devlog series: an agent that edits her podcast end to end — transcription, cuts, show notes, thumbnail.",
    link: "Episode 14 of the series →",
  },
  {
    initials: "DR",
    avatarClass: "bg-primary/10 text-primary",
    name: "@dougruns",
    platform: "Build-in-public thread",
    platformIcon: Twitter,
    body: "Day 23 of a 30-day experiment: his agent researches, writes, and ships his newsletter — he only approves sends.",
    link: "Open rate up 11% since day 1 →",
  },
  {
    initials: "SL",
    avatarClass: "bg-chart-3/15 text-chart-3",
    name: "Sena L.",
    platform: "Live streams",
    platformIcon: Rss,
    body: "Streams with a voice-designed co-host that watches chat, pulls clips, and argues with her about code.",
    link: "Community of 3,200 →",
  },
];

const WHO_ITS_FOR = [
  {
    icon: Video,
    title: "Video + streams",
    body: "YouTube devlogs, build-with-me streams, TikTok demos of what your agent did overnight.",
  },
  {
    icon: Twitter,
    title: "Threads + posts",
    body: 'Build-in-public threads, ship logs, "day 12 of my agent running my newsletter."',
  },
  {
    icon: Mic,
    title: "Podcasts + writing",
    body: "Shows and newsletters that dig into how things get built — with your own agent as a running experiment.",
  },
];

const YOU_GET = [
  { lead: "Agent Pro, free", body: "K3, 100M tokens/day, every capability" },
  { lead: "GPU credits", body: "For the builds that need real hardware" },
  { lead: "Early access", body: "New models and features before launch" },
  { lead: "Distribution", body: "We feature your builds on our channels" },
  { lead: "A direct line", body: "Real engineers answer your questions" },
];

const WE_ASK = [
  { lead: "Build real things", body: "Projects, not product tours" },
  { lead: "Show your process", body: "Including what breaks; we can take it" },
  {
    lead: "Say what you used",
    body: "A natural mention that HyperCLI runs your agent. No scripts, no talking points, ever",
  },
];

const STEPS = [
  {
    lead: "Apply with something you've made.",
    body: "A video, a thread, a repo, an episode — anything that shows you build and share. No follower minimums.",
  },
  {
    lead: "Get your agent.",
    body: "Approved creators get Agent Pro and GPU credits within a week. Deploy in 5 minutes, same as everyone.",
  },
  {
    lead: "Build and show your work.",
    body: "Ship whatever you want. Tag us when you post and we'll put real distribution behind the good ones.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function BuildersProgramPage() {
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
            <Eyebrow>The Builders Program</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Build something cool.
              <br />
              <span className="gradient-text-primary">We'll cover the compute.</span>
            </h1>
            <p className="mx-auto mb-4 max-w-2xl text-lg leading-relaxed text-text-secondary">
              We're not buying ads, and we don't want scripted shout-outs. If you build in public — video, stream,
              thread, podcast — we'd rather fund your next build than your next sponsor read.
            </p>
            <p className="mb-8 text-sm text-text-muted">
              Free Agent Pro + GPU credits, for people actively making things.
            </p>
            <ContactCta source="builders-program" primaryLabel="Apply in 5 minutes" />
          </div>
        </section>

        {/* Shipping right now */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Shipping <span className="text-primary">right now.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Builds currently running on program compute — follow along.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {CREATORS.map((creator) => (
                <GlassCard key={creator.name} interactive className="p-7">
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold ${creator.avatarClass}`}
                    >
                      {creator.initials}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{creator.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-text-muted">
                        <creator.platformIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {creator.platform}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary">{creator.body}</p>
                  <p className="mt-3">
                    <a href="#" className="text-sm font-semibold text-primary hover:underline">
                      {creator.link}
                    </a>
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* Who this is for */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Who this <span className="text-primary">is for.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Platform doesn't matter. Audience size matters less than you'd think. What matters: you actually build,
              and you show your work.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {WHO_ITS_FOR.map((card) => (
                <GlassCard key={card.title} interactive className="p-7">
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{card.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* What you get / what we ask */}
        <section className="px-6 py-12">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            <GlassCard className="p-7">
              <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                <Gift className="h-5 w-5 text-success" aria-hidden="true" />
                What you get
              </h3>
              <ul className="space-y-4">
                {YOU_GET.map((item) => (
                  <li key={item.lead} className="flex items-start gap-2.5 text-sm leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <span className="text-text-secondary">
                      <b className="block font-semibold text-foreground">{item.lead}</b>
                      {item.body}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
            <GlassCard className="p-7">
              <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                <ArrowRight className="h-5 w-5 text-primary" aria-hidden="true" />
                What we ask
              </h3>
              <ul className="space-y-4">
                {WE_ASK.map((item) => (
                  <li key={item.lead} className="flex items-start gap-2.5 text-sm leading-relaxed">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="text-text-secondary">
                      <b className="block font-semibold text-foreground">{item.lead}</b>
                      {item.body}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-text-muted">
                That's the whole deal. Your opinions stay yours — critical takes don't get you removed from the
                program.
              </p>
            </GlassCard>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-12 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              How it <span className="text-primary">works.</span>
            </h2>
            <div className="mx-auto grid max-w-2xl gap-4 text-left">
              {STEPS.map((step, index) => (
                <GlassCard key={step.lead} className="flex items-start gap-4 p-6">
                  <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    <b className="font-semibold text-foreground">{step.lead}</b> {step.body}
                  </p>
                </GlassCard>
              ))}
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
                Your next sponsor is a computer.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                Free compute for people who make things. Show us what you'd build.
              </p>
              <ContactCta source="builders-program" primaryLabel="Apply in 5 minutes" />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
