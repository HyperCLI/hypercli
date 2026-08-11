import Link from "next/link";
import { ChannelTabs, ChatDemo, FAQBlock, Footer, GlassCard, Header, type ChatMessage, type FAQItem } from "@hypercli/shared-ui";
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
import { Check } from "lucide-react";
import { GetStartedLink } from "@/components/get-started-link";

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

export function ChannelPage({ data }: { data: ChannelPageData }) {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero backdropVariant="balanced">
        <ChannelTabs channels={CHANNEL_TABS} activeLabel={data.label} className="mb-8 justify-center" />
        <MarketingEyebrow>{data.eyebrow}</MarketingEyebrow>
        <AuroraHeroHeading className="leading-[1.06]">
          Your agents, <span className="gradient-text-primary">where you work.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mb-9">{data.heroSub}</AuroraHeroLead>
        <MarketingActionGroup className="mb-5">
          <GetStartedLink label={data.ctaLabel} className={marketingCtaClassName()} />
        </MarketingActionGroup>
        <p className="text-sm text-text-muted">{data.notes.join(" · ")}</p>
      </AuroraHero>

      {/* Behaviors */}
      <MarketingBand bordered>
        <MarketingContainer className="text-center">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            {data.behaviorsTitle}
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">{data.behaviorsSub}</p>
          <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {data.behaviors.map((beh) => (
              <GlassCard key={beh.title} interactive className="p-7">
                <span className="rounded-md bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-link">
                  {beh.tag}
                </span>
                <h3 className="mb-2 mt-4 text-lg font-bold tracking-tight text-foreground">{beh.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{beh.body}</p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Chat demo */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
          <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            {data.demoTitle}
          </h2>
          <ChatDemo
            channel={data.demoChannel}
            agentName={data.demoAgentName}
            messages={data.messages}
            className="mx-auto max-w-xl text-left"
          />
        </MarketingContainer>
      </MarketingBand>

      {/* Permissions */}
      <MarketingBand bordered>
        <MarketingContainer width="4xl" className="text-center">
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
        </MarketingContainer>
      </MarketingBand>

      {/* Setup */}
      <MarketingBand spacing="tight">
        <MarketingContainer className="rounded-3xl bg-surface-low px-6 py-16 text-center sm:px-12">
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
        </MarketingContainer>
      </MarketingBand>

      {/* FAQ */}
      <MarketingBand bordered>
        <MarketingContainer width="3xl" className="text-center">
          <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            {data.faqTitle}
          </h2>
          <FAQBlock items={data.faq} className="text-left" />
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading={data.closerTitle}
        description={data.closerSub}
        descriptionClassName="mx-auto max-w-xl"
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label={data.ctaLabel}
              className={marketingCtaClassName({ size: "final" })}
            />
          </MarketingActionGroup>
        }
        footnote={
          <>
            Also available for{" "}
            {data.alsoAvailable.map((channel, index) => (
              <span key={channel.href}>
                {index > 0 && " · "}
                <Link href={channel.href} className="text-accent-hover">
                  {channel.label}
                </Link>
              </span>
            ))}
          </>
        }
        footnoteClassName="mt-8"
      />
    </MarketingShell>
  );
}
