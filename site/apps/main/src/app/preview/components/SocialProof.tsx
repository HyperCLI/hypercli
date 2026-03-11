"use client"

import { motion } from "framer-motion"

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
    <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
      <div className="max-w-5xl mx-auto">
        <motion.blockquote
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-2xl sm:text-3xl text-white leading-relaxed">
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
          <span className="text-white font-medium">{attribution.name}</span>
          <span className="text-muted-foreground">
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
              <p className="text-4xl text-white font-bold mb-1">
                {metric.value}
              </p>
              <p className="text-sm text-muted-foreground">{metric.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
