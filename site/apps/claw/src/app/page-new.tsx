import { ClawHeader } from "@/components/landing/ClawHeader";
import { HeroSectionNew } from "@/components/landing/HeroSectionNew";
import { FeaturesSectionNew } from "@/components/landing/FeaturesSectionNew";
import { ModelsSection } from "@/components/landing/ModelsSection";
import { ComparisonSection } from "@/components/landing/ComparisonSection";
import { PricingSectionNew } from "@/components/landing/PricingSectionNew";
import { TechSpecsSection } from "@/components/landing/TechSpecsSection";
import { ClawFooter } from "@/components/landing/ClawFooter";

export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <ClawHeader />
      <main>
        <HeroSectionNew />
        <FeaturesSectionNew />
        <ModelsSection />
        <ComparisonSection />
        <PricingSectionNew />
        <TechSpecsSection />
      </main>
      <ClawFooter />
    </div>
  );
}
