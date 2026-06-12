"use client";

import { Footer, Header, MarketingPageHero } from "@hypercli/shared-ui";
import GPUPricing from "@/components/GPUPricing";

export default function GPUsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <MarketingPageHero
          title={<>State-of-the-Art <span className="text-primary">GPUs</span></>}
          description="B200, H200, H100, A100, L40S, L4 and more."
          secondaryDescription={<>On-demand and interruptible instances. Deploy in seconds. <span className="text-primary">Pay per second.</span></>}
          align="center"
          maxWidth="6xl"
          className="pb-16"
        />

        <GPUPricing />
      </main>
      <Footer />
    </div>
  );
}
