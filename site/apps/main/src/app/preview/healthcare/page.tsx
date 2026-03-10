import type { Metadata } from "next"
import { IndustryPage } from "../components"
import { healthcareData } from "../data/healthcare"

export const metadata: Metadata = {
  title: healthcareData.meta.title,
  description: healthcareData.meta.description,
}

export default function HealthcarePage() {
  return <IndustryPage data={healthcareData} />
}
