"use client"

import { motion } from "framer-motion"
import { FeatureCard, MarketingSection, SectionHeading } from "@hypercli/shared-ui"
import {
  Search,
  Shield,
  FileText,
  Zap,
  BarChart3,
  Target,
  Brain,
  Code,
  Scale,
  MessageSquare,
  Truck,
  FlaskConical,
  Crosshair,
  Map,
  Wrench,
  Gavel,
  Heart,
  Activity,
  type LucideIcon,
} from "lucide-react"

const iconMap: Record<string, LucideIcon> = {
  Search,
  Shield,
  FileText,
  Zap,
  BarChart3,
  Target,
  Brain,
  Code,
  Scale,
  MessageSquare,
  Truck,
  FlaskConical,
  Crosshair,
  Map,
  Wrench,
  Gavel,
  Heart,
  Activity,
}

type UseCasesGridProps = {
  headline: string
  cases: Array<{
    icon: string
    title: string
    description: string
  }>
}

export function UseCasesGrid({ headline, cases }: UseCasesGridProps) {
  return (
    <MarketingSection bordered className="py-24 sm:py-24" innerClassName="max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <SectionHeading title={headline} align="left" />
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((useCase, index) => {
            const Icon = iconMap[useCase.icon]
            return (
              <FeatureCard
                key={useCase.title}
                icon={Icon}
                title={useCase.title}
                description={useCase.description}
                reveal={false}
                index={index}
              />
            )
          })}
        </div>
    </MarketingSection>
  )
}
