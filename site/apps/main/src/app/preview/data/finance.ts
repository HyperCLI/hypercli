import type { IndustryData } from "../types"

export const financeData: IndustryData = {
  slug: "finance",
  meta: {
    title: "HyperCLI for Financial Services",
    description: "AI infrastructure that keeps MNPI inside your perimeter. Full SEC/FINRA audit trails.",
  },
  hero: {
    headline: "Your Alpha Doesn't Leak.",
    subheadline: "AI infrastructure that stays inside your perimeter. Full SEC/FINRA audit trails. Per-team governance. Deploy in days, not months.",
    primaryCTA: { label: "Schedule Compliance Review", href: "/preview/self-hosted" },
    secondaryCTA: { label: "See Finance Architecture", href: "/preview/cloud" },
    trustBadges: ["SOC 2 Type II", "FINRA Compliant", "SEC Audit Ready", "MNPI Protected"],
  },
  risk: {
    headline: "One Leak Ends Everything.",
    body: "Your trade signals are your edge. Your expert network transcripts contain material non-public information. Sending this to OpenAI or any external API is an existential risk.",
    industryTerm: "MNPI",
    sharedProblems: [
      "Your MNPI mixed with thousands of other customers",
      "No audit trail for SEC/FINRA examiners",
      "No data isolation or sovereignty",
      "Fails compliance requirements",
    ],
    hypercliBenefits: [
      "Dedicated GPUs — hardware exclusively yours",
      "Complete data isolation, never shared",
      "Full audit trail — every request logged",
      "Exam-ready compliance documentation",
    ],
  },
  useCases: [
    { icon: "Search", title: "Research Analyst Copilots", description: "Ingest earnings calls, 10-Ks, and expert network transcripts to generate initial analysis." },
    { icon: "FileText", title: "Risk Model Documentation", description: "Auto-generate model risk documentation and audit-ready compliance reports." },
    { icon: "Shield", title: "Compliance & Surveillance", description: "Analyze trader communications and flag potential violations." },
    { icon: "BarChart3", title: "Trading Strategy Narratives", description: "Summarize backtest results and generate strategy rationale documentation." },
    { icon: "Code", title: "Quant Code Generation", description: "Generate Python/R backtesting code and optimize database queries." },
    { icon: "Scale", title: "Document Processing", description: "Automate regulatory filings, counterparty analysis, and risk reports." },
  ],
  socialProof: {
    quote: "We were 6 months into building this ourselves. HyperCLI got us to production in a week with full compliance coverage.",
    attribution: { name: "CTO", role: "Chief Technology Officer", company: "$2B AUM Quantitative Fund" },
    metrics: [
      { value: "3 days", label: "To production" },
      { value: "65%", label: "Cost reduction" },
      { value: "40+", label: "Active users in month 1" },
      { value: "100%", label: "Compliance approval" },
    ],
  },
  comparison: {
    rows: [
      { capability: "Time to Production", buildInHouse: "6-12 months", saas: "Instant", hypercli: "1 week" },
      { capability: "Data Sovereignty", buildInHouse: "yes", saas: "no", hypercli: "yes" },
      { capability: "SEC/FINRA Audit Trail", buildInHouse: "Build it yourself", saas: "no", hypercli: "yes" },
      { capability: "Per-Team Rate Limits", buildInHouse: "Build it yourself", saas: "no", hypercli: "yes" },
      { capability: "Year 1 Cost", buildInHouse: "$800K-$1.5M", saas: "$300K-$600K", hypercli: "$150K-$250K" },
    ],
  },
  cta: {
    headline: "Your Alpha Deserves Better.",
    body: "Trade signals and proprietary models belong on dedicated infrastructure — not shared with strangers.",
    primaryCTA: { label: "Deploy Self-Hosted", href: "/preview/self-hosted" },
    secondaryCTA: { label: "Launch Cloud Instance", href: "/preview/cloud" },
  },
}
