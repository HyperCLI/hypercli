"use client"

import { motion } from "framer-motion"
import { Check, X } from "lucide-react"

type RiskSectionProps = {
  headline: string
  body: string
  industryTerm: string
  sharedProblems: string[]
  hypercliBenefits: string[]
}

export function RiskSection({
  headline,
  body,
  industryTerm,
  sharedProblems,
  hypercliBenefits,
}: RiskSectionProps) {
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
          <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-6">
            {headline}
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
            {body}
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Shared AI APIs column */}
          <motion.div
            className="rounded-lg border border-red-500/20 bg-red-500/5 p-6"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-red-400 mb-1">
              Shared AI APIs
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Your {industryTerm} on shared infrastructure
            </p>
            <ul className="space-y-3">
              {sharedProblems.map((problem, index) => (
                <motion.li
                  key={index}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.2 + index * 0.05 }}
                >
                  <X className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{problem}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* HyperCLI column */}
          <motion.div
            className="rounded-lg border border-primary/20 bg-primary/5 p-6"
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-primary mb-1">
              HyperCLI
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Your {industryTerm} on dedicated infrastructure
            </p>
            <ul className="space-y-3">
              {hypercliBenefits.map((benefit, index) => (
                <motion.li
                  key={index}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.2 + index * 0.05 }}
                >
                  <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-white">{benefit}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
