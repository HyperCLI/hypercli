import Link from "next/link";
import { ChannelTabs, ChatDemo, FAQBlock, Footer, GlassCard, Header, type ChatMessage, type FAQItem } from "@hypercli/shared-ui";
import { Check } from "lucide-react";

export interface ChannelBehavior {
  tag: string;
  title: string;
  body: string;
}

export interface ChannelPermission {
  title: string;
  body: string;
}

export interface ChannelStep {
  title: string;
  body: React.ReactNode;
}

export interface ChannelPageData {
  label: string;
  eyebrow: string;
  heroSub: string;
  ctaLabel: string;
  notes: string[];
  behaviorsTitle: React.ReactNode;
  behaviorsSub: string;
  behaviors: ChannelBehavior[];
  demoTitle: React.ReactNode;
  demoChannel: string;
  demoAgentName: string;
  messages: ChatMessage[];
  permsTitle: React.ReactNode;
  permsSub: string;
  perms: ChannelPermission[];
  setupTitle: React.ReactNode;
  steps: ChannelStep[];
  faqTitle: React.ReactNode;
  faq: FAQItem[];
  closerTitle: string;
  closerSub: string;
  alsoAvailable: { label: string; href: string }[];
}

const CHANNEL_TABS = [
  { label: "Slack", href: "/slack" },
  { label: "Teams", href: "/teams" },
  { label: "Telegram", href: "/telegram" },
  { label: "WhatsApp", href: "/whatsapp" },
  { label: "Discord", href: "/discord" },
  { label: "buzz", href: "/buzz" },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>
  );
}

export function ChannelPage({ data }: { data: ChannelPageData }) {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[6%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <ChannelTabs channels={CHANNEL_TABS} activeLabel={data.label} className="mb-8 justify-center" />
            <Eyebrow>{data.eyebrow}</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.06] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Your agents, <span className="gradient-text-primary">where you work.</span>
            </h1>
            <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-secondary">{data.heroSub}</p>
            <div className="mb-5 flex flex-wrap justify-center gap-3.5">
              <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold">
                {data.ctaLabel}
              </Link>
            </div>
            <p className="text-sm text-text-muted">{data.notes.join(" · ")}</p>
          </div>
        </section>

        {/* Behaviors */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl text-center">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {data.behaviorsTitle}
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">{data.behaviorsSub}</p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
              {data.behaviors.map((beh) => (
                <GlassCard key={beh.title} interactive className="p-7">
                  <span className="rounded-md bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                    {beh.tag}
                  </span>
                  <h3 className="mb-2 mt-4 text-lg font-bold tracking-tight text-foreground">{beh.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{beh.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* Chat demo */}
        <section className="px-6 py-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
            <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {data.demoTitle}
            </h2>
            <ChatDemo
              channel={data.demoChannel}
              agentName={data.demoAgentName}
              messages={data.messages}
              className="mx-auto max-w-xl text-left"
            />
          </div>
        </section>

        {/* Permissions */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {data.permsTitle}
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">{data.permsSub}</p>
            <div className="mx-auto grid max-w-3xl gap-x-8 gap-y-7 text-left sm:grid-cols-2">
              {data.perms.map((perm) => (
                <div key={perm.title} className="flex items-start gap-3.5">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-success/10">
                    <Check className="h-4.5 w-4.5 text-success" aria-hidden="true" />
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    <b className="font-semibold text-foreground">{perm.title}</b> {perm.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Setup */}
        <section className="px-6 py-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
            <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {data.setupTitle}
            </h2>
            <div className="mx-auto grid max-w-xl gap-4 text-left">
              {data.steps.map((step, index) => (
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
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {data.faqTitle}
            </h2>
            <FAQBlock items={data.faq} className="text-left" />
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
                {data.closerTitle}
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">{data.closerSub}</p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold">
                  {data.ctaLabel}
                </Link>
              </div>
              <p className="mt-8 text-xs text-terminal-muted">
                Also available for{" "}
                {data.alsoAvailable.map((channel, index) => (
                  <span key={channel.href}>
                    {index > 0 && " · "}
                    <Link href={channel.href} className="text-accent-hover">
                      {channel.label}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
