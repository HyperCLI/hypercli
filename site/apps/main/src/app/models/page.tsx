"use client";

import { Footer, Header, MarketingPageHero } from "@hypercli/shared-ui";
import ModelPricing from "@/components/ModelPricing";

export default function ModelsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <MarketingPageHero
          title={<>State-of-the-Art <span className="text-primary">AI Models</span></>}
          description="API access to the latest models. Claude, GPT-5, Gemini, Qwen, and more."
          secondaryDescription={<>Drop-in replacement for OpenAI and Anthropic APIs. Hosted on our <span className="text-primary">B200 GPU fleet</span>.</>}
          align="center"
          maxWidth="6xl"
          className="pb-16"
        />

        <ModelPricing />
      </main>
      <Footer />
    </div>
  );
}
