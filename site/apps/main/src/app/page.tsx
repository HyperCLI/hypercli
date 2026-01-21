import {
  HeroSection,
  TrustedBySection,
  InstantDeploymentSection,
  WhatIsHyperCLISection,
  WhyFastSection,
  TemplatesSection,
  PlaygroundCTASection,
  PricingSection,
  EnterpriseTeaserSection,
  Header,
  Footer,
} from "@hypercli/shared-ui";

export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden snap-y snap-mandatory">
      <Header />
      <main>
        {/* Hero Section */}
        <section className="snap-start">
          <HeroSection />
        </section>

        {/* Trusted By Section */}
        <section className="snap-start">
          <TrustedBySection />
        </section>

        {/* Instant Deployment / PLG Features */}
        <section className="snap-start">
          <InstantDeploymentSection />
        </section>

        {/* What HyperCLI Is */}
        <section className="snap-start">
          <WhatIsHyperCLISection />
        </section>

        {/* Why Hyper Is So Fast */}
        <section className="snap-start">
          <WhyFastSection />
        </section>

        {/* Templates & Deployment Blueprints */}
        <section className="snap-start">
          <TemplatesSection />
        </section>

        {/* Playground CTA */}
        <section className="snap-start">
          <PlaygroundCTASection />
        </section>

        {/* Pricing Teaser */}
        <section className="snap-start">
          <PricingSection />
        </section>

        {/* Enterprise Solutions */}
        <section className="snap-start">
          <EnterpriseTeaserSection />
        </section>
      </main>
      <section className="snap-start">
        <Footer />
      </section>
    </div>
  );
}
