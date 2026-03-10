"use client"

import { motion } from "framer-motion"
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
    <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight">
            {headline}
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((useCase, index) => {
            const Icon = iconMap[useCase.icon]
            return (
              <motion.div
                key={useCase.title}
                className="p-6 rounded-lg border border-border-medium/30 bg-surface-low hover:border-primary/30 transition-colors"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                {Icon && <Icon className="w-6 h-6 text-primary mb-4" />}
                <h3 className="text-lg text-white font-semibold mb-2">
                  {useCase.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {useCase.description}
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
