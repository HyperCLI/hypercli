import { ClawHeader } from "@/components/landing/ClawHeader";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { ModelsSection } from "@/components/landing/ModelsSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { TechSpecsSection } from "@/components/landing/TechSpecsSection";
import { ClawFooter } from "@/components/landing/ClawFooter";

export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <ClawHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <ModelsSection />
        <PricingSection />
        <TechSpecsSection />
      </main>
      <ClawFooter />
    </div>
  );
}
