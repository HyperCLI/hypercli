import {
  HeroSection,
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
    <div className="min-h-screen bg-[#0B0D0E] overflow-x-hidden">
      <Header />
      <main className="pt-16">
        {/* Hero Section */}
        <HeroSection />

        {/* Instant Deployment / PLG Features */}
        <InstantDeploymentSection />

        {/* What HyperCLI Is */}
        <WhatIsHyperCLISection />

        {/* Why Hyper Is So Fast */}
        <WhyFastSection />

        {/* Templates & Deployment Blueprints */}
        <TemplatesSection />

        {/* Playground CTA */}
        <PlaygroundCTASection />

        {/* Pricing Teaser */}
        <PricingSection />

        {/* Enterprise Solutions */}
        <EnterpriseTeaserSection />
      </main>
      <Footer />
    </div>
  );
}
