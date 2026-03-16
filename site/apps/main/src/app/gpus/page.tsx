"use client";

import { Header, Footer } from "@hypercli/shared-ui";
import GPUPricing from "@/components/GPUPricing";

export default function GPUsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-16">
        {/* Hero Section */}
        <div className="relative py-20 sm:py-28 overflow-hidden">
          {/* Grain texture */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

          {/* Subtle green glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/5 blur-[120px] rounded-full" />

          <div className="relative z-20 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white mb-6">
              State-of-the-Art <span className="text-primary">GPUs</span>
            </h1>
            <p className="text-xl md:text-2xl text-secondary-foreground font-medium mb-4">
              B200, H200, H100, A100, L40S, L4 and more.
            </p>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              On-demand and interruptible instances. Deploy in seconds. <span className="text-primary">Pay per second.</span>
            </p>
          </div>
        </div>

        <GPUPricing />
      </main>
      <Footer />
    </div>
  );
}
