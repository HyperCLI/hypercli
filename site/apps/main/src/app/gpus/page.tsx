"use client";

import { Header, Footer } from "@hypercli/shared-ui";
import GPUPricing from "@/components/GPUPricing";

export default function GPUsPage() {
  return (
    <div className="min-h-screen bg-[#0B0D0E]">
      <Header />
      <main className="pt-16">
        {/* Hero Section */}
        <div className="relative py-20 sm:py-28 overflow-hidden">
          {/* Grain texture */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />

          {/* Subtle green glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#38D39F]/5 blur-[120px] rounded-full" />

          <div className="relative z-20 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white mb-6">
              State-of-the-Art <span className="text-[#38D39F]">GPUs</span>
            </h1>
            <p className="text-xl md:text-2xl text-[#D4D6D7] font-medium mb-4">
              B200, H200, H100, A100, L40S, L4 and more.
            </p>
            <p className="text-lg text-[#9BA0A2] max-w-3xl mx-auto">
              On-demand and interruptible instances. Deploy in seconds. <span className="text-[#38D39F]">Pay per second.</span>
            </p>
          </div>
        </div>

        <GPUPricing />
      </main>
      <Footer />
    </div>
  );
}
