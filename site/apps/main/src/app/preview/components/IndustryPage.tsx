import type { IndustryData } from "../types"
import { HeroSection } from "./HeroSection"
import { RiskSection } from "./RiskSection"
import { UseCasesGrid } from "./UseCasesGrid"
import { SocialProof } from "./SocialProof"
import { ComparisonTable } from "./ComparisonTable"
import { CTASection } from "./CTASection"

type IndustryPageProps = {
  data: IndustryData
}

export function IndustryPage({ data }: IndustryPageProps) {
  const comparisonRows = data.comparison.rows.map((row) => ({
    capability: row.capability,
    values: [row.buildInHouse, row.saas, row.hypercli],
  }))

  return (
    <>
      <HeroSection
        headline={data.hero.headline}
        subheadline={data.hero.subheadline}
        primaryCTA={data.hero.primaryCTA}
        secondaryCTA={data.hero.secondaryCTA}
        trustBadges={data.hero.trustBadges}
      />
      <RiskSection
        headline={data.risk.headline}
        body={data.risk.body}
        industryTerm={data.risk.industryTerm}
        sharedProblems={data.risk.sharedProblems}
        hypercliBenefits={data.risk.hypercliBenefits}
      />
      <UseCasesGrid headline="What You Can Build" cases={data.useCases} />
      <SocialProof
        quote={data.socialProof.quote}
        attribution={data.socialProof.attribution}
        metrics={data.socialProof.metrics}
      />
      <ComparisonTable
        headline="Why HyperCLI"
        columns={["Capability", "Build In-House", "SaaS AI", "HyperCLI"]}
        rows={comparisonRows}
      />
      <CTASection
        headline={data.cta.headline}
        body={data.cta.body}
        primaryCTA={data.cta.primaryCTA}
        secondaryCTA={data.cta.secondaryCTA}
      />
    </>
  )
}
