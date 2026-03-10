import type { Metadata } from "next"
import { IndustryPage } from "../components"
import { defenseData } from "../data/defense"

export const metadata: Metadata = {
  title: defenseData.meta.title,
  description: defenseData.meta.description,
}

export default function DefensePage() {
  return <IndustryPage data={defenseData} />
}
