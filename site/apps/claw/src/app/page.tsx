import { ClawHeader } from "@/components/landing/ClawHeader";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { ModelsSection } from "@/components/landing/ModelsSection";
import { ComparisonSection } from "@/components/landing/ComparisonSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { TechSpecsSection } from "@/components/landing/TechSpecsSection";
import { ClawFooter } from "@/components/landing/ClawFooter";

// New copy deployment - refreshed 2026-02-23 - v2
export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <ClawHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <ModelsSection />
        <ComparisonSection />
        <PricingSection />
        <TechSpecsSection />
      </main>
      <ClawFooter />
    </div>
  );
}
