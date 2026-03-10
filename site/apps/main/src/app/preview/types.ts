export type CTA = { label: string; href: string }

export type IndustryData = {
  slug: string
  meta: { title: string; description: string }
  hero: {
    headline: string
    subheadline: string
    primaryCTA: CTA
    secondaryCTA: CTA
    trustBadges: string[]
  }
  risk: {
    headline: string
    body: string
    industryTerm: string
    sharedProblems: string[]
    hypercliBenefits: string[]
  }
  useCases: Array<{
    icon: string
    title: string
    description: string
  }>
  socialProof: {
    quote: string
    attribution: { name: string; role: string; company: string }
    metrics: Array<{ value: string; label: string }>
  }
  comparison: {
    rows: Array<{
      capability: string
      buildInHouse: string
      saas: string
      hypercli: string
    }>
  }
  cta: {
    headline: string
    body: string
    primaryCTA: CTA
    secondaryCTA: CTA
  }
}
