import type { IndustryData } from "../types"

export const saasData: IndustryData = {
  slug: "saas",
  meta: {
    title: "HyperCLI for Enterprise SaaS",
    description: "Add AI features without shipping your customer's data to OpenAI. SOC 2 and GDPR compliant.",
  },
  hero: {
    headline: "Stop Shipping Your Customer's Data to OpenAI.",
    subheadline: "Add AI features to your SaaS product without the liability. Your customers' data stays in your infrastructure. SOC 2 and GDPR compliant by default.",
    primaryCTA: { label: "See SaaS Architecture", href: "/preview/self-hosted" },
    secondaryCTA: { label: "Schedule Technical Review", href: "/preview/cloud" },
    trustBadges: ["SOC 2 Type II", "GDPR Compliant", "Multi-Tenant Ready", "White-Label Capable"],
  },
  risk: {
    headline: "Your AI Feature Is Your Liability.",
    body: "Your customers trust you with their data. When you build AI features on OpenAI, you're shipping their data to someone else's infrastructure. You're the weak link in their security chain.",
    industryTerm: "customer data",
    sharedProblems: [
      "Customer data mixed with unknown users",
      "No audit trail for enterprise buyers",
      "GDPR compliance becomes questionable",
      "Enterprise deals stall in security review",
    ],
    hypercliBenefits: [
      "Dedicated GPUs — hardware exclusively yours",
      "Customer data never touches other API users",
      "Full audit trail — per-customer attribution",
      "Enterprise sales accelerator, not blocker",
    ],
  },
  useCases: [
    { icon: "MessageSquare", title: "Customer-Facing Chat", description: "Add AI-powered chat to your product without exposing user data externally." },
    { icon: "FileText", title: "Document Summarization", description: "Summarize uploaded contracts and reports while keeping documents in your infrastructure." },
    { icon: "Search", title: "Semantic Search", description: "Power intelligent search across user content without exposing data externally." },
    { icon: "Zap", title: "Workflow Automation", description: "Suggest next actions and auto-complete forms by learning from internal patterns." },
    { icon: "BarChart3", title: "Analytics & Insights", description: "Generate AI-powered reports and surface trends from user data." },
    { icon: "Target", title: "Recommendations", description: "Personalize user experience and drive engagement without privacy liability." },
  ],
  socialProof: {
    quote: "We were losing enterprise deals because we couldn't answer 'where does our data go?' HyperCLI let us say 'your data never leaves our infrastructure' — and prove it.",
    attribution: { name: "VP of Engineering", role: "VP of Engineering", company: "B2B Collaboration Platform" },
    metrics: [
      { value: "2 weeks", label: "Migration from OpenAI" },
      { value: "$450K", label: "ARR from recovered deals" },
      { value: "60%", label: "Faster security reviews" },
      { value: "<5%", label: "Deal loss rate" },
    ],
  },
  comparison: {
    rows: [
      { capability: "Time to Production", buildInHouse: "6-12 months", saas: "Instant", hypercli: "1 week" },
      { capability: "Customer Data Control", buildInHouse: "yes", saas: "no", hypercli: "yes" },
      { capability: "Enterprise Sales Impact", buildInHouse: "Neutral", saas: "Deal killer", hypercli: "Accelerator" },
      { capability: "GDPR Compliance", buildInHouse: "Build it yourself", saas: "Complex DPA", hypercli: "yes" },
      { capability: "Year 1 Cost", buildInHouse: "$800K-$1.5M", saas: "$200K-$500K", hypercli: "$100K-$200K" },
    ],
  },
  cta: {
    headline: "Your Customers Deserve Better.",
    body: "Your customers' data belongs in your infrastructure — not shared with strangers in someone else's cloud.",
    primaryCTA: { label: "Deploy Self-Hosted", href: "/preview/self-hosted" },
    secondaryCTA: { label: "Launch Cloud Instance", href: "/preview/cloud" },
  },
}
