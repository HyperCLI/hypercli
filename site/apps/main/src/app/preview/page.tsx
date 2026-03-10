import type { Metadata } from "next"
import { LandingContent } from "./landing-content"

export const metadata: Metadata = {
  title: "Private AI Platform | HyperCLI",
  description:
    "Deploy private AI infrastructure on your servers or dedicated cloud GPUs. Full compliance, data sovereignty, and deploy in minutes.",
}

export default function PreviewLandingPage() {
  return <LandingContent />
}
