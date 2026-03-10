import type { Metadata } from "next"
import { IndustryPage } from "../components"
import { saasData } from "../data/saas"

export const metadata: Metadata = {
  title: saasData.meta.title,
  description: saasData.meta.description,
}

export default function SaaSPage() {
  return <IndustryPage data={saasData} />
}
