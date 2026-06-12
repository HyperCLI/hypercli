"use client"

import { motion } from "framer-motion"
import { CTAButtonGroup } from "@hypercli/shared-ui"
import type { CTA } from "../types"

type CTASectionProps = {
  headline: string
  body: string
  primaryCTA: CTA
  secondaryCTA: CTA
}

export function CTASection({
  headline,
  body,
  primaryCTA,
  secondaryCTA,
}: CTASectionProps) {
  return (
    <section className="pt-24 pb-32 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-4xl sm:text-5xl text-foreground font-bold tracking-tight leading-tight max-w-3xl mb-6">
            {headline}
          </h2>

          <p className="text-lg text-text-secondary mb-10 max-w-2xl leading-relaxed">
            {body}
          </p>

          <CTAButtonGroup
            align="left"
            className="flex-wrap"
            actions={[
              { label: primaryCTA.label, href: primaryCTA.href, variant: "primary", showArrow: true },
              { label: secondaryCTA.label, href: secondaryCTA.href, variant: "secondary" },
            ]}
          />
        </motion.div>
      </div>
    </section>
  )
}
