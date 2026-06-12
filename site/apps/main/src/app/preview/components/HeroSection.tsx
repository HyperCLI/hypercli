"use client"

import { motion } from "framer-motion"
import { CTAButtonGroup } from "@hypercli/shared-ui"
import type { CTA } from "../types"

type HeroSectionProps = {
  headline: string
  subheadline: string
  primaryCTA: CTA
  secondaryCTA: CTA
  trustBadges?: string[]
}

export function HeroSection({
  headline,
  subheadline,
  primaryCTA,
  secondaryCTA,
  trustBadges,
}: HeroSectionProps) {
  return (
    <section className="pt-32 pb-24 px-4 sm:px-6 lg:px-8">
      <motion.div
        className="max-w-5xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="text-5xl sm:text-6xl lg:text-7xl text-foreground font-bold leading-[1.1] tracking-tight max-w-4xl mb-6">
          {headline}
        </h1>

        <p className="text-xl text-text-secondary leading-relaxed mb-10 max-w-2xl">
          {subheadline}
        </p>

        <CTAButtonGroup
          align="left"
          className="mb-10 flex-wrap"
          actions={[
            { label: primaryCTA.label, href: primaryCTA.href, variant: "primary", showArrow: true },
            { label: secondaryCTA.label, href: secondaryCTA.href, variant: "secondary" },
          ]}
        />

        {trustBadges && trustBadges.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {trustBadges.map((badge) => (
              <span
                key={badge}
                className="text-sm text-primary border border-border-medium/50 rounded-full px-3 py-1.5"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  )
}
