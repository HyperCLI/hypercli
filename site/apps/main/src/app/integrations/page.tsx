import type { Metadata } from "next";
import { Footer, Header } from "@hypercli/shared-ui";
import {
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
import { ContactLink } from "@/components/contact-cta";
import { GetStartedLink } from "@/components/get-started-link";
import { IntegrationCatalog } from "@/components/integrations/integration-catalog";
import { INTEGRATIONS } from "@/content/integrations";

export const metadata: Metadata = {
  title: "Integrations — Connect HyperCLI to the tools where work happens",
  description:
    "Explore HyperCLI integrations for messaging, files, productivity, developer tools, and Google Workspace previews.",
};

export default function IntegrationsPage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer compact />} headerClearance="primary">
      {/*
        THESIS: One persistent agent carries context across tools; this is a truthful directory, not a logo wall.
        OWN-WORLD: Aurora light/dark surfaces, restrained brand color, linked catalog cards, and terminal-dark proof panels.
        STORY: Understand the connection model, inspect availability, explore a detail, then launch an agent.
        FIRST VIEWPORT: Direct promise, status-aware explanation, and category controls leading immediately into the catalog.
        FORM: Product directory inside the incumbent marketing system, with status as first-class information.
      */}
      <AuroraHero backdrop={false} width="5xl" className="integrations-catalog-hero pb-0">
        <MarketingEyebrow className="mb-4 text-[13.5px]">Integrations</MarketingEyebrow>
        <AuroraHeroHeading className="mb-5 text-[36px] leading-[1.06] tracking-[-0.04em] sm:text-[58px] lg:text-[58px]">
          Plug your agent into
          <br />
          <span className="gradient-text-primary">everything you already use.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead className="mb-0 max-w-[650px] text-[18.5px] leading-[1.55]">
          Same agent, same memory, every tool. Connect once — it carries context from your{" "}
          <b className="font-semibold text-foreground">Drive</b> into your{" "}
          <b className="font-semibold text-foreground">Docs</b>, your{" "}
          <b className="font-semibold text-foreground">Calendar</b> into your Slack, without you re-explaining a thing.
        </AuroraHeroLead>
      </AuroraHero>

      <MarketingBand spacing="none" className="px-6 pb-9 pt-11">
        <MarketingContainer width="7xl">
          <IntegrationCatalog integrations={INTEGRATIONS} />
        </MarketingContainer>
      </MarketingBand>

      <MarketingBand spacing="none" className="px-6 pb-24 pt-6">
        <MarketingContainer
          width="5xl"
          className="relative overflow-hidden rounded-[32px] border border-primary/15 bg-terminal-background px-8 pb-[60px] pt-[72px] text-center"
        >
          <div
            aria-hidden="true"
            className="aurora-final-cta-backdrop pointer-events-none absolute inset-0"
          />
          <div className="relative">
            <h2
              data-slot="integration-fallback-heading"
              className="mx-auto max-w-4xl text-[28px] font-extrabold leading-[1.08] tracking-[-0.03em] text-terminal-foreground sm:text-[40px]"
            >
              Don&apos;t see yours?
              <br />
              <span className="gradient-text-primary">It can drive a browser like a person.</span>
            </h2>
            <p className="mx-auto mb-8 mt-5 max-w-[560px] text-[16.5px] leading-relaxed text-terminal-muted">
              No API, no problem. Walk it through the website once and it writes itself a skill — your weirdest internal
              tool is its favorite.
            </p>
            <MarketingActionGroup>
              <GetStartedLink
                label="Deploy your agent"
                toAgentDashboard
                className={marketingCtaClassName({ size: "hero" })}
              />
              <ContactLink
                source="integrations-request"
                className={marketingCtaClassName({ variant: "terminal-secondary", size: "hero" })}
              >
                Request an integration
              </ContactLink>
            </MarketingActionGroup>
          </div>
        </MarketingContainer>
      </MarketingBand>
    </MarketingShell>
  );
}
