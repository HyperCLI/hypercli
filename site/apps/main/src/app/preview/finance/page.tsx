import type { Metadata } from "next"
import { IndustryPage } from "../components"
import { financeData } from "../data/finance"

export const metadata: Metadata = {
  title: financeData.meta.title,
  description: financeData.meta.description,
}

export default function FinancePage() {
  return <IndustryPage data={financeData} />
}
