"use client"

import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"
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
          <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight leading-tight max-w-3xl mb-6">
            {headline}
          </h2>

          <p className="text-lg text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            {body}
          </p>

          <div className="flex flex-wrap gap-4">
            <Link
              href={primaryCTA.href}
              className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2"
            >
              {primaryCTA.label}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href={secondaryCTA.href}
              className="px-8 py-4 bg-surface-low/40 text-white rounded-lg hover:bg-surface-low/60 transition-colors border border-border-medium/50"
            >
              {secondaryCTA.label}
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
