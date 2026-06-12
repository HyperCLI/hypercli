"use client"

import { motion } from "framer-motion"
import { MarketingSection, MetricCard } from "@hypercli/shared-ui"

type SocialProofProps = {
  quote: string
  attribution: { name: string; role: string; company: string }
  metrics: Array<{ value: string; label: string }>
}

export function SocialProof({
  quote,
  attribution,
  metrics,
}: SocialProofProps) {
  return (
    <MarketingSection bordered className="py-24 sm:py-24" innerClassName="max-w-5xl">
        <motion.blockquote
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-2xl sm:text-3xl text-foreground leading-relaxed">
            &ldquo;{quote}&rdquo;
          </p>
        </motion.blockquote>

        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <span className="text-foreground font-medium">{attribution.name}</span>
          <span className="text-text-secondary">
            {" "}&mdash; {attribution.role}, {attribution.company}
          </span>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {metrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.05 }}
            >
              <MetricCard label={metric.label} value={metric.value} />
            </motion.div>
          ))}
        </div>
    </MarketingSection>
  )
}
