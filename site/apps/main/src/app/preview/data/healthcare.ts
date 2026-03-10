import type { IndustryData } from "../types"

export const healthcareData: IndustryData = {
  slug: "healthcare",
  meta: {
    title: "HyperCLI for Healthcare & Life Sciences",
    description: "HIPAA-ready AI infrastructure. PHI never leaves your environment.",
  },
  hero: {
    headline: "AI That Treats Patient Data Like Patient Data.",
    subheadline: "HIPAA-ready infrastructure that stays inside your perimeter. PHI never leaves your environment. Full audit trails for OCR investigations.",
    primaryCTA: { label: "Schedule HIPAA Review", href: "/preview/self-hosted" },
    secondaryCTA: { label: "See Healthcare Architecture", href: "/preview/cloud" },
    trustBadges: ["HIPAA Ready", "SOC 2 Type II", "GDPR Compliant", "HITRUST In Progress"],
  },
  risk: {
    headline: "One PHI Leak. One OCR Investigation.",
    body: "Your clinical notes contain protected health information. Your imaging reports identify patients. Sending this to any external API is a compliance failure that carries $100K-$1.5M fines per violation.",
    industryTerm: "PHI",
    sharedProblems: [
      "PHI mixed with thousands of other customers",
      "No true BAA protection on shared infrastructure",
      "No audit trail for OCR investigators",
      "Unauthorized disclosure risk",
    ],
    hypercliBenefits: [
      "Dedicated GPUs — hardware exclusively yours",
      "PHI never touches other customers",
      "Full audit trail — accounting of disclosures",
      "Investigation-ready documentation",
    ],
  },
  useCases: [
    { icon: "FileText", title: "Clinical Documentation", description: "Generate structured documentation from provider notes and discharge summaries." },
    { icon: "FlaskConical", title: "Research Data Analysis", description: "Analyze clinical trial data and identify cohorts while protecting subject identifiers." },
    { icon: "Shield", title: "Pharmacovigilance & Safety", description: "Monitor drug safety signals and generate adverse event regulatory reports." },
    { icon: "MessageSquare", title: "Patient Communication", description: "Draft portal responses, appointment reminders, and care plan summaries." },
    { icon: "BarChart3", title: "Quality & Outcomes", description: "Analyze readmission patterns, identify care gaps, and improve HEDIS scores." },
    { icon: "Brain", title: "Clinical Decision Support", description: "Summarize patient histories for rounds and flag potential drug interactions." },
  ],
  socialProof: {
    quote: "HyperCLI got us to production in 2 weeks with full HIPAA compliance. Our compliance officer signed off immediately.",
    attribution: { name: "CMIO", role: "Chief Medical Information Officer", company: "800-bed Academic Medical Center" },
    metrics: [
      { value: "2 weeks", label: "To production" },
      { value: "40%", label: "Less documentation time" },
      { value: "200+", label: "Clinicians active in month 1" },
      { value: "1 review", label: "Compliance approval" },
    ],
  },
  comparison: {
    rows: [
      { capability: "Time to Production", buildInHouse: "6-12 months", saas: "Instant", hypercli: "1 week" },
      { capability: "PHI Sovereignty", buildInHouse: "yes", saas: "no", hypercli: "yes" },
      { capability: "HIPAA Audit Trail", buildInHouse: "Build it yourself", saas: "no", hypercli: "yes" },
      { capability: "Per-Dept Rate Limits", buildInHouse: "Build it yourself", saas: "no", hypercli: "yes" },
      { capability: "Year 1 Cost", buildInHouse: "$800K-$1.5M", saas: "$300K-$600K", hypercli: "$150K-$250K" },
    ],
  },
  cta: {
    headline: "Your Patients Trust You With Their Data.",
    body: "Clinical notes and patient conversations belong on dedicated infrastructure — not shared with strangers.",
    primaryCTA: { label: "Deploy Self-Hosted", href: "/preview/self-hosted" },
    secondaryCTA: { label: "Launch Cloud Instance", href: "/preview/cloud" },
  },
}
