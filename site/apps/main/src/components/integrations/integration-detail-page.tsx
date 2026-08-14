import Link from "next/link";
import { Footer, Header } from "@hypercli/shared-ui";
import {
  AuroraHero,
  MarketingActionGroup,
  MarketingContainer,
  MarketingShell,
  marketingCtaClassName,
} from "@hypercli/shared-ui/marketing";
import { ArrowRight, Check, Clock3, DollarSign } from "lucide-react";
import { GetStartedLink } from "@/components/get-started-link";
import { HomeScrollEffects } from "@/components/home-scroll-effects";
import type { IntegrationDetail } from "@/content/integration-details";
import { IntegrationIcon } from "./integration-icon";

function AccentHeading({ title, accent }: { title: string; accent?: string }) {
  if (!accent) return title;
  const index = title.indexOf(accent);
  if (index === -1) return title;

  return (
    <>
      {title.slice(0, index)}
      <span className="text-primary">{accent}</span>
      {title.slice(index + accent.length)}
    </>
  );
}

function CopyWithEmphasis({ text, emphasis }: { text: string; emphasis?: string }) {
  if (!emphasis) return text;
  const index = text.indexOf(emphasis);
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <strong className="font-semibold text-foreground">{emphasis}</strong>
      {text.slice(index + emphasis.length)}
    </>
  );
}

export function IntegrationDetailPage({ detail }: { detail: IntegrationDetail }) {
  return (
    <MarketingShell
      header={<Header />}
      footer={<Footer compact />}
      headerClearance="primary"
      data-home-motion-root=""
    >
      <HomeScrollEffects />
      <AuroraHero
        backdrop={false}
        width="6xl"
        className="integration-detail-hero pb-5"
        containerClassName="max-w-[1120px]"
      >
        <nav aria-label="Breadcrumb" className="mb-[30px] text-left text-[13.5px] text-text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/integrations" className="font-semibold text-link hover:underline">
                Integrations
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{detail.name}</li>
          </ol>
        </nav>

        <span
          className="mx-auto mb-6 flex h-[76px] w-[76px] items-center justify-center rounded-[22px] shadow-[0_14px_34px_-14px_rgba(31,41,55,0.25)] sm:h-24 sm:w-24 sm:rounded-[28px] dark:shadow-[0_14px_34px_-14px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: detail.tint, color: detail.accent }}
        >
          <IntegrationIcon name={detail.icon} className="h-[38px] w-[38px] sm:h-12 sm:w-12" />
        </span>
        <h1
          data-slot="aurora-hero-heading"
          className="mb-4 text-[36px] font-extrabold leading-[1.05] tracking-[-0.04em] text-foreground sm:text-[54px]"
        >
          {detail.name}
        </h1>
        <p
          data-slot="aurora-hero-lead"
          className="mx-auto mb-[34px] max-w-[600px] text-[18.5px] leading-[1.55] text-text-secondary"
        >
          <CopyWithEmphasis text={detail.title} emphasis={detail.titleEmphasis} />
        </p>
        <MarketingActionGroup>
          <GetStartedLink
            label={detail.primaryActionLabel ?? "Launch your agent"}
            toAgentDashboard
            className={marketingCtaClassName()}
          />
          <a href="#workflow" className={marketingCtaClassName({ variant: "secondary" })}>
            {detail.workflowActionLabel ?? "See the workflow"}
          </a>
        </MarketingActionGroup>
        {detail.isPreview === false ? (
          <div
            data-slot="integration-availability-meta"
            className="mx-auto mt-[26px] flex flex-wrap justify-center gap-x-7 gap-y-3 text-[13.5px] text-text-secondary"
          >
            <span className="inline-flex items-center gap-[7px]">
              <Check className="h-[15px] w-[15px]" style={{ color: detail.accent }} aria-hidden="true" />
              Available now
            </span>
            <span className="inline-flex items-center gap-[7px]">
              <span className="relative h-[15px] w-[15px]" style={{ color: detail.accent }} aria-hidden="true">
                <DollarSign className="h-[15px] w-[15px]" />
                <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 -rotate-45 bg-current" />
              </span>
              Ships on every plan, flat rate
            </span>
            <span className="inline-flex items-center gap-[7px]">
              <Clock3 className="h-[15px] w-[15px]" style={{ color: detail.accent }} aria-hidden="true" />
              Connects in ~20 seconds
            </span>
          </div>
        ) : null}
        {detail.isPreview !== false ? (
          <p data-slot="integration-preview-notice" className="sr-only">
            {detail.previewNotice}
          </p>
        ) : null}
      </AuroraHero>

      <div className="px-6 pb-20">
        <MarketingContainer width="6xl" className="max-w-[1120px]">
          <section className="pb-2.5 pt-[76px] text-center">
            <h2 data-home-reveal="" className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
              <AccentHeading title={detail.capabilitiesTitle} accent={detail.capabilitiesAccent} />
            </h2>
            <p data-home-reveal="" data-home-reveal-delay={70} className="mx-auto mb-[46px] max-w-[600px] text-[17px] leading-relaxed text-text-secondary">
              {detail.capabilitiesSubtitle}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] items-stretch gap-[18px] text-left">
              {detail.capabilities.map((capability, index) => (
                <article
                  key={capability.title}
                  data-home-reveal=""
                  data-home-reveal-delay={index * 70}
                  className="rounded-[22px] bg-surface-low px-[30px] py-7"
                >
                  <h3 className="mb-2 flex items-center gap-[9px] text-[17px] font-bold tracking-[-0.01em] text-foreground">
                    <span className="shrink-0" style={{ color: detail.accent }}>
                      <IntegrationIcon name={capability.icon} className="h-[19px] w-[19px]" />
                    </span>
                    {capability.title}
                  </h3>
                  <p className="text-sm leading-[1.65] text-text-secondary">
                    <CopyWithEmphasis text={capability.body} emphasis={capability.emphasis} />
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section id="workflow" className="scroll-mt-20 pb-2.5 pt-[76px] text-center">
            <h2 data-home-reveal="" className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
              <AccentHeading title={detail.workflowTitle} accent={detail.workflowAccent} />
            </h2>
            <p data-home-reveal="" data-home-reveal-delay={70} className="mx-auto mb-[46px] max-w-[600px] text-[17px] leading-relaxed text-text-secondary">
              {detail.workflowSubtitle}
            </p>
            <div data-home-reveal="" data-home-reveal-delay={140} className="mx-auto max-w-[640px] rounded-[22px] border border-border bg-surface px-7 py-[26px] text-left shadow-[var(--elevation-shadow-soft),0_24px_60px_-30px_rgba(79,124,255,0.25)] dark:shadow-[0_24px_70px_-24px_rgba(0,0,0,0.75)]">
              {detail.messages.map((message, index) => (
                <div key={`${message.time ?? "message"}-${index}`} className="mb-4 flex gap-3 last:mb-0">
                  <span
                    aria-hidden="true"
                    className={
                      message.from === "agent"
                        ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#EEF2FF] text-[12.5px] font-semibold text-[#4F7CFF] dark:bg-[rgba(79,124,255,0.22)] dark:text-[#9DB4FF]"
                        : "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#FFF6DC] text-[12.5px] font-semibold text-[#8A6410] dark:bg-[rgba(255,215,106,0.18)] dark:text-[#FFD76A]"
                    }
                  >
                    {message.from === "agent" ? "AG" : "JD"}
                  </span>
                  <div className="min-w-0">
                    <p className="mb-px text-sm font-semibold text-foreground">
                      {message.author}
                      {message.time ? (
                        <span className="ml-[7px] text-[11.5px] font-normal text-text-muted">{message.time}</span>
                      ) : null}
                    </p>
                    <p className="text-[13.5px] leading-relaxed text-text-secondary">
                      <CopyWithEmphasis text={message.text} emphasis={detail.messageEmphasis?.[index]} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="pb-2.5 pt-[76px] text-center">
            <h2 data-home-reveal="" className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
              <AccentHeading title={detail.setupTitle} accent={detail.setupAccent} />
            </h2>
            <p data-home-reveal="" data-home-reveal-delay={70} className="mx-auto mb-[46px] max-w-[600px] text-[17px] leading-relaxed text-text-secondary">
              {detail.setupSubtitle}
            </p>
            <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] items-stretch gap-[18px] text-left">
              {detail.steps.map((step, index) => (
                <li
                  key={step.title}
                  data-home-reveal=""
                  data-home-reveal-delay={index * 70}
                  className="rounded-[22px] border border-border bg-surface px-[30px] pb-[26px] pt-[30px] shadow-[var(--elevation-shadow-soft)]"
                >
                  <span
                    data-slot="integration-setup-number"
                    className="mb-4 flex h-10 w-10 items-center justify-center rounded-[13px] text-[17px] font-extrabold text-[#1F2937]"
                    style={{ backgroundColor: detail.tint }}
                  >
                    {index + 1}
                  </span>
                  <h3 className="mb-2 text-lg font-bold tracking-[-0.01em] text-foreground">{step.title}</h3>
                  <p className="text-[14.5px] leading-[1.65] text-text-secondary">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section data-home-reveal="" className="relative mt-[76px] overflow-hidden rounded-[28px] bg-terminal-background px-[26px] pb-9 pt-10 sm:px-11 sm:pb-12 sm:pt-[54px] dark:bg-[#1A2230]">
            <div aria-hidden="true" className="integration-guardrails-backdrop pointer-events-none absolute inset-0" />
            <div className="relative mx-auto max-w-[720px]">
              <h2 className="mb-[22px] text-left text-[26px] font-bold leading-[1.1] tracking-[-0.03em] text-terminal-foreground sm:text-[34px]">
                {detail.guardrailsTitle}
              </h2>
              <ul>
                {detail.guardrails.map((guardrail) => (
                  <li
                    key={guardrail.title}
                    className="relative py-[9px] pl-[30px] text-[15px] leading-[1.65] text-terminal-muted"
                  >
                    <span className="absolute left-0 font-bold text-terminal-live" aria-hidden="true">✓</span>
                    <b className="font-semibold text-terminal-foreground">{guardrail.title}</b>{" "}
                    {guardrail.body}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="pb-2.5 pt-[76px] text-center">
            <h2 data-home-reveal="" className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
              Pairs well <span className="text-primary">with</span>
            </h2>
            <p data-home-reveal="" data-home-reveal-delay={70} className="mx-auto mb-[46px] max-w-[600px] text-[17px] leading-relaxed text-text-secondary">
              {detail.relatedSubtitle}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4 text-left">
              {detail.related.map((related, index) => (
                <Link
                  key={related.href}
                  href={related.href}
                  data-home-reveal=""
                  data-home-reveal-delay={index * 70}
                  className="group flex items-center gap-4 rounded-[20px] border border-border bg-surface px-6 py-[22px] shadow-[var(--elevation-shadow-soft)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--elevation-shadow-medium)]"
                >
                  <span className="shrink-0" style={{ color: related.accent }}>
                    <IntegrationIcon name={related.icon} className="h-[30px] w-[30px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16.5px] font-bold tracking-[-0.01em] text-foreground">
                      {related.name}
                    </span>
                    <span className="block text-[13.5px] leading-relaxed text-text-secondary">
                      {related.description}
                    </span>
                  </span>
                  <ArrowRight className="h-[19px] w-[19px] shrink-0 text-text-muted transition-colors group-hover:text-primary" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>

          <section
            data-slot="aurora-final-cta"
            data-home-reveal=""
            className="relative mt-[76px] overflow-hidden rounded-[32px] bg-terminal-background px-8 pb-16 pt-[76px] text-center dark:bg-[#1A2230]"
          >
            <div aria-hidden="true" className="aurora-final-cta-backdrop pointer-events-none absolute inset-0" />
            <div className="relative">
              <h2 className="mb-[30px] text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-terminal-foreground sm:text-[40px]">
                {detail.closerTitle}
                {detail.closerAccent ? (
                  <>
                    <br />
                    <span className="gradient-text-primary">{detail.closerAccent}</span>
                  </>
                ) : (
                  <>
                    {" "}
                    <span className="gradient-text-primary">Put an agent to work.</span>
                  </>
                )}
              </h2>
              {detail.closerDescription ? (
                <p data-slot="aurora-final-cta-description" className="mx-auto mb-8 max-w-2xl text-base text-terminal-muted">
                  {detail.closerDescription}
                </p>
              ) : null}
              <GetStartedLink
                label={detail.closerActionLabel ?? "Launch your agent"}
                toAgentDashboard
                className={marketingCtaClassName({ size: "hero" })}
              />
              {detail.closerFootnote || detail.isPreview !== false ? (
                <p className="mt-[22px] text-[12.5px] text-terminal-muted">
                  {detail.closerFootnote ?? "Preview only · Native connection behavior remains subject to verification"}
                </p>
              ) : null}
            </div>
          </section>
        </MarketingContainer>
      </div>
    </MarketingShell>
  );
}
