import type { Metadata } from "next"
import { SelfHostedContent } from "./content"

export const metadata: Metadata = {
  title: "Self-Hosted AI Platform | HyperCLI",
  description:
    "Deploy private AI infrastructure on your own servers. Full data sovereignty, SOC 2, GDPR, HIPAA, ITAR compliance. Deploy in 30 minutes.",
}

export default function SelfHostedPage() {
  return <SelfHostedContent />
}
