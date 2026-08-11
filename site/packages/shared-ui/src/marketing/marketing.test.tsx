import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AuroraFinalCta,
  AuroraHeroBackdrop,
  MarketingActionGroup,
  MarketingShell,
  marketingCtaClassName,
} from "./index";

describe("shared marketing primitives", () => {
  it("renders a single semantic main with section navigation clearance", () => {
    const html = renderToStaticMarkup(
      <MarketingShell
        header={<header>Header</header>}
        footer={<footer>Footer</footer>}
        headerClearance="section-nav"
      >
        <section>Content</section>
      </MarketingShell>,
    );

    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('data-slot="marketing-main"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain("Skip to main content");
    expect(html).toContain("marketing-header-clearance-section-nav");
    expect(html).toContain("<header>Header</header>");
    expect(html).toContain("<footer>Footer</footer>");
  });

  it("supports a custom main target and skip-link label", () => {
    const html = renderToStaticMarkup(
      <MarketingShell
        header={<header>Header</header>}
        mainId="documentation"
        skipLinkLabel="Skip to documentation"
      >
        Content
      </MarketingShell>,
    );

    expect(html).toContain('href="#documentation"');
    expect(html).toContain('id="documentation"');
    expect(html).toContain("Skip to documentation");
  });

  it("keeps the Aurora hero backdrop decorative", () => {
    const html = renderToStaticMarkup(<AuroraHeroBackdrop variant="swapped" />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-slot="aurora-hero-backdrop"');
    expect(html.match(/rounded-full/g)).toHaveLength(3);
    expect(html).toContain("bg-chart-3/15");
    expect(html).toContain("bg-success/15");
  });

  it("styles app-owned actions without creating navigation", () => {
    expect(marketingCtaClassName()).toContain("btn-primary");
    const terminalSecondary = marketingCtaClassName({
      variant: "terminal-secondary",
      size: "final",
    });
    expect(terminalSecondary).toContain("border-terminal-border");
    expect(terminalSecondary).toContain("hover:text-terminal-live");

    const html = renderToStaticMarkup(
      <MarketingActionGroup>
        <a href="/inference" target="_blank" rel="noreferrer">
          Get an API key
        </a>
      </MarketingActionGroup>,
    );

    expect(html).toContain('href="/inference"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("preserves rendered actions inside the terminal final CTA", () => {
    const html = renderToStaticMarkup(
      <AuroraFinalCta
        heading="Start tonight."
        description="Wake up to finished work."
        actions={<a href="/dashboard/agents">Deploy your agent</a>}
        highlights={<span>100M/day</span>}
        footnote="Cancel anytime"
      />,
    );

    expect(html).toContain('data-slot="aurora-final-cta"');
    expect(html).toContain("aurora-final-cta-backdrop");
    expect(html).toContain('data-slot="aurora-final-cta-description"');
    expect(html).toContain("text-terminal-muted");
    expect(html).toContain('href="/dashboard/agents"');
    expect(html).toContain("100M/day");
    expect(html).toContain("Cancel anytime");
  });
});
