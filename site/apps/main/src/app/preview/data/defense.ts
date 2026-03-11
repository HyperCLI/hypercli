import type { IndustryData } from "../types"

export const defenseData: IndustryData = {
  slug: "defense",
  meta: {
    title: "HyperCLI for Defense & Government",
    description: "Air-gapped AI infrastructure for classified environments. ITAR-compliant. CMMC-ready.",
  },
  hero: {
    headline: "Deployable Where the Internet Isn't.",
    subheadline: "Air-gapped AI infrastructure for classified and sensitive environments. ITAR-compliant supply chain. CMMC-ready deployment. No external dependencies.",
    primaryCTA: { label: "Request Classified Briefing", href: "/preview/self-hosted" },
    secondaryCTA: { label: "See Air-Gapped Architecture", href: "/preview/cloud" },
    trustBadges: ["CMMC Level 3 Ready", "ITAR Compliant", "FedRAMP In Progress", "Air-Gap Capable"],
  },
  risk: {
    headline: "One Data Spill. One Career.",
    body: "Your intelligence reports are classified. Your operational plans are FOUO or higher. Your acquisition data is ITAR-controlled. Sending this to any external API is a security violation.",
    industryTerm: "CUI",
    sharedProblems: [
      "Classified data mixed with uncontrolled users",
      "No supply chain control — foreign components",
      "No audit trail for security officers",
      "CMMC/ITAR failure on shared infrastructure",
    ],
    hypercliBenefits: [
      "Dedicated GPUs — hardware exclusively yours",
      "Air-gap capable — zero external connectivity",
      "Full audit trail — every request attributed",
      "U.S.-controlled supply chain, SBOM available",
    ],
  },
  useCases: [
    { icon: "Search", title: "Intelligence Analysis", description: "Ingest HUMINT, SIGINT, and OSINT feeds to accelerate all-source fusion." },
    { icon: "FileText", title: "Document Exploitation", description: "Process captured documents, translate, and extract entities at scale." },
    { icon: "Scale", title: "Acquisition & Contracting", description: "Analyze RFPs, generate technical evaluations, and accelerate source selection." },
    { icon: "Map", title: "Operational Planning", description: "Generate course of action analyses and create briefing products." },
    { icon: "Truck", title: "Logistics & Maintenance", description: "Predict equipment failures and optimize parts ordering from maintenance logs." },
    { icon: "Gavel", title: "Legal & Policy Review", description: "Analyze regulations and generate compliance assessments for JAG and policy shops." },
  ],
  socialProof: {
    quote: "We were told AI was impossible in our environment. HyperCLI got us operational in a month with full air-gap compliance.",
    attribution: { name: "VP of Technology", role: "VP of Technology", company: "Cleared Defense Contractor" },
    metrics: [
      { value: "3 weeks", label: "Air-gapped deployment" },
      { value: "150+", label: "Analysts active in month 1" },
      { value: "60%", label: "Faster document processing" },
      { value: "1 assessment", label: "SSO approval" },
    ],
  },
  comparison: {
    rows: [
      { capability: "Time to Production", buildInHouse: "12-18 months", saas: "Instant", hypercli: "2-4 weeks" },
      { capability: "Data Sovereignty", buildInHouse: "yes", saas: "no", hypercli: "yes" },
      { capability: "Air-Gapped Deployment", buildInHouse: "Possible", saas: "no", hypercli: "yes" },
      { capability: "ITAR Compliance", buildInHouse: "Build it yourself", saas: "no", hypercli: "yes" },
      { capability: "Year 1 Cost", buildInHouse: "$1.2M-$2.5M", saas: "$400K-$800K", hypercli: "$200K-$350K" },
    ],
  },
  cta: {
    headline: "National Security Deserves Better.",
    body: "Intelligence reports and operational plans belong on dedicated infrastructure — not shared in someone else's cloud.",
    primaryCTA: { label: "Deploy Self-Hosted", href: "/preview/self-hosted" },
    secondaryCTA: { label: "Launch Cloud Instance", href: "/preview/cloud" },
  },
}
