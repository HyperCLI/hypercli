import type { Metadata } from "next"
import { CloudContent } from "./content"

export const metadata: Metadata = {
  title: "Dedicated Cloud GPUs | HyperCLI",
  description:
    "Dedicated GPU instances with zero DevOps. SOC 2, GDPR, HIPAA compliant. Per-second billing with auto-shutdown. Launch in minutes.",
}

export default function CloudPage() {
  return <CloudContent />
}
